

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Normalize phone
const normalizePhone = (phone) =>
  phone.replace(/\D/g, '').trim();

/// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

    phone = normalizePhone(phone);

    console.log("📤 Sending OTP to:", phone);

    const response = await axios.get(
      `https://www.fast2sms.com/dev/otp/send`
    );

    const sessionId = response.data.Details;

    console.log("✅ Session ID:", sessionId);

    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    const { error: insertError } = await supabase
      .from("otp_sessions")
      .insert({
        phone,
        session_id: sessionId,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error(insertError);

      return res.status(500).json({
        error: "Failed to save OTP session",
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ send-otp error:", err.message);

    res.status(500).json({
      error: "Failed to send OTP",
    });
  }
});

/// VERIFY OTP
app.post("/verify-otp", async (req, res) => {
  try {
    let { phone, otp } = req.body;

    phone = normalizePhone(phone);

    console.log("📲 Verifying OTP for phone:", phone);

    const { data: sessionData, error: sessionError } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      console.error("Session lookup error:", sessionError);

      return res.status(500).json({
        error: "Session lookup failed",
      });
    }

    if (!sessionData) {
      return res.status(400).json({
        error: "OTP session expired",
      });
    }

    console.log("✅ Session found:", sessionData.session_id);

    const response = await axios.get(
      `https://www.fast2sms.com/dev/otp/verify`
    );

    console.log("2Factor response:", response.data);

    if (response.data.Status !== "Success") {
      return res.status(400).json({
        error: "Invalid OTP",
      });
    }


    // Check if user exists
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone) // 917338821735
      .maybeSingle();

    // Create user if not exists
    if (!existingUser) {
      const newUserId = crypto.randomUUID();

      const { error: insertUserError } = await supabase
        .from("users")
        .insert({
          id: newUserId,
          phone: phone, 
          created_at: new Date().toISOString(),
        });
    }

    // Delete OTP session
    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ verify-otp error:", err.message);

    res.status(500).json({
      error: "OTP verification failed",
    });
  }
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
