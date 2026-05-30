const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// IMPORTANT: Use service_role key (not anon key) so RLS
// does NOT block column writes like is_verified, verified_at
// In .env set: SUPABASE_KEY=your_service_role_key
// ─────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Normalize phone — last 10 digits only
const normalizePhone = (phone) =>
  phone.replace(/\D/g, "").slice(-10);

// ─────────────────────────────────────────
/// SEND OTP
// ─────────────────────────────────────────
app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number required",
      });
    }

    phone = normalizePhone(phone);

    if (phone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number — must be 10 digits",
      });
    }

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/send",
      {
        mobile: phone,
        otp_id: process.env.FAST2SMS_OTP_ID,
      },
      {
        headers: {
          accept: "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    if (!response.data?.request_id) {
      console.error("Fast2SMS no request_id:", response.data);
      return res.status(502).json({
        success: false,
        message: "SMS provider did not return a request ID",
      });
    }

    const requestId = response.data.request_id;

    // Clear any existing session for this phone
    const { error: deleteError } = await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    if (deleteError) {
      console.error("OTP session delete error:", deleteError.message);
    }

    // Save new session — id and created_at handled by DB defaults
    const { error: insertError } = await supabase
      .from("otp_sessions")
      .insert({
        phone,
        session_id: requestId,
      });

    if (insertError) {
      console.error("OTP session insert error:", insertError.message);
      return res.status(500).json({
        success: false,
        message: "Failed to save OTP session",
      });
    }

    return res.json({
      success: true,
      request_id: requestId,
    });

  } catch (err) {
    console.error("SEND OTP ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: err.response?.data || err.message,
    });
  }
});

// ─────────────────────────────────────────
/// VERIFY OTP
// ─────────────────────────────────────────
app.post("/verify-otp", async (req, res) => {
  try {
    let { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone and OTP are required",
      });
    }

    phone = normalizePhone(phone);

    if (phone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number — must be 10 digits",
      });
    }

    // Get latest OTP session for this phone
    const { data: sessionData, error: sessionError } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      console.error("Session lookup error:", sessionError.message);
      return res.status(500).json({
        success: false,
        message: "Session lookup failed",
      });
    }

    if (!sessionData) {
      return res.status(400).json({
        success: false,
        message: "OTP session not found or expired — please request a new OTP",
      });
    }

    // Verify OTP with Fast2SMS
    let verifyResponse;
    try {
      verifyResponse = await axios.post(
        "https://www.fast2sms.com/dev/otp/verify",
        {
          mobile: phone,
          otp: String(otp),
          otp_id: process.env.FAST2SMS_OTP_ID,
        },
        {
          headers: {
            accept: "application/json",
            authorization: process.env.FAST2SMS_API_KEY,
            "content-type": "application/json",
          },
        }
      );
    } catch (verifyErr) {
      console.error("Fast2SMS verify error:", verifyErr.response?.data || verifyErr.message);
      return res.status(400).json({
        success: false,
        message: "OTP verification failed",
        error: verifyErr.response?.data || verifyErr.message,
      });
    }

    console.log("Fast2SMS verify response:", verifyResponse.data);

    // Fast2SMS returns return:true and status_code:200 on success
    const isValid =
      verifyResponse.data.return === true ||
      verifyResponse.data.status_code === 200;

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP — please try again",
      });
    }

    const now = new Date().toISOString();

    // Check if user already exists
    const { data: existingUser, error: userLookupError } = await supabase
      .from("users")
      .select("id, phone, is_verified")
      .eq("phone", phone)
      .maybeSingle();

    if (userLookupError) {
      console.error("User lookup error:", userLookupError.message);
      return res.status(500).json({
        success: false,
        message: "User lookup failed",
      });
    }

    let userId;
    let isNewUser = false;

    if (!existingUser) {
      // ── NEW USER ──────────────────────────────
      isNewUser = true;
      userId = crypto.randomUUID();

      const { data: insertedUser, error: insertUserError } = await supabase
        .from("users")
        .insert({
          id: userId,
          phone,
          is_verified: true,
          verified_at: now,
          created_at: now,
        })
        .select("id, phone, is_verified, verified_at, created_at")
        .single();

      if (insertUserError) {
        console.error("User insert error:", insertUserError.message, insertUserError.details);
        return res.status(500).json({
          success: false,
          message: "Failed to create user",
          error: insertUserError.message,
        });
      }

      console.log("New user created:", insertedUser);

    } else {
      // ── EXISTING USER ─────────────────────────
      userId = existingUser.id;

      if (!existingUser.is_verified) {
        const { error: updateError } = await supabase
          .from("users")
          .update({
            is_verified: true,
            verified_at: now,
          })
          .eq("id", userId);

        if (updateError) {
          console.error("User update error:", updateError.message);
        }
      }

      console.log("Existing user logged in:", userId);
    }

    // Always clean up OTP session after successful verify
    const { error: sessionDeleteError } = await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    if (sessionDeleteError) {
      console.error("Session delete error:", sessionDeleteError.message);
    }

    return res.json({
      success: true,
      message: "OTP verified successfully",
      user_id: userId,
      is_new_user: isNewUser,
    });

  } catch (err) {
    console.error("VERIFY ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
      error: err.response?.data || err.message,
    });
  }
});

// ─────────────────────────────────────────
/// DEBUG — remove before production
// ─────────────────────────────────────────
app.get("/debug-user/:phone", async (req, res) => {
  const phone = req.params.phone.replace(/\D/g, "").slice(-10);
  const { data, error } = await supabase
    .from("users")
    .select("id, phone, is_verified, verified_at, created_at")
    .eq("phone", phone)
    .maybeSingle();
  res.json({ phone, data, error });
});

// ─────────────────────────────────────────
/// HEALTH CHECK
// ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Fast2SMS OTP Server",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
