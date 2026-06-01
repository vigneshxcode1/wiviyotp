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

/**
 * Always returns a 12-digit number with 91 prefix (91XXXXXXXXXX).
 * This is the canonical format stored in otp_sessions and users tables.
 *
 * Input:  "+917338821735" / "917338821735" / "7338821735"
 * Output: "917338821735"
 */
const normalizeTo12 = (phone) => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10) return `91${digits.slice(-10)}`;
  return `91${digits}`;
};

/**
 * Fast2SMS expects only the 10-digit local number (no country code).
 */
const toLocal10 = (phone) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

app.get("/", (req, res) => {
  res.send("Fast2SMS OTP Server Running 🚀");
});

// ── SEND OTP ──────────────────────────────────────────────────────────────────

app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number required",
      });
    }

    // Canonical format for DB storage
    const phone12 = normalizeTo12(phone);
    // 10-digit format for Fast2SMS API
    const phone10 = toLocal10(phone12);

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/send",
      {
        mobile: phone10,       // Fast2SMS expects 10 digits
        otp_id: "45d6bbbddb",
      },
      {
        headers: {
          accept: "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    const requestId = response.data.request_id;

    // Store session with 12-digit phone
    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone12);

    await supabase
      .from("otp_sessions")
      .insert({
        phone: phone12,        // stored as 91XXXXXXXXXX
        session_id: requestId,
        created_at: new Date().toISOString(),
      });

    return res.json({
      success: true,
      request_id: requestId,
    });

  } catch (err) {
    console.error("SEND OTP ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// ── VERIFY OTP ────────────────────────────────────────────────────────────────

app.post("/verify-otp", async (req, res) => {
  try {
    let { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        error: "Phone and OTP required",
      });
    }

    // Canonical format — must match what was stored during send-otp
    const phone12 = normalizeTo12(phone);
    // 10-digit format for Fast2SMS API
    const phone10 = toLocal10(phone12);

    const { data: sessionData } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone", phone12)      // look up by 12-digit phone
      .maybeSingle();

    if (!sessionData) {
      return res.status(400).json({
        success: false,
        error: "OTP session not found",
      });
    }

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/verify",
      {
        mobile: phone10,         // Fast2SMS expects 10 digits
        otp,
        otp_id: "45d6bbbddb",
      },
      {
        headers: {
          accept: "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    if (response.data.return !== true && response.data.status_code !== 200) {
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    // Clean up session — user creation is Flutter's job
    await supabase.from("otp_sessions").delete().eq("phone", phone12);

    return res.json({ success: true, message: "OTP verified successfully" });

  } catch (err) {
    console.error("VERIFY ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
