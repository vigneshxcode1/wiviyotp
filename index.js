require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, "").slice(-10);
}

// Send OTP
app.post("/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number required",
      });
    }

    const otp = generateOtp();

    const otpHash = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    const expiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    ).toISOString();

    const { error } = await supabase
      .from("otp_verifications")
      .upsert({
        phone,
        otp_hash: otpHash,
        expires_at: expiresAt,
      });

    if (error) throw error;

    // FAST2SMS SMART OTP
    const smsResponse = await axios.post(
      "https://www.fast2sms.com/dev/otp",
      {
        otp_id: "45d6bbbddb", // Your approved OTP ID
        variables_values: otp,
        route: "otp",
        numbers: phone,
      },
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      success: true,
      message: "OTP sent successfully",
      data: smsResponse.data,
    });

  } catch (e) {
    console.error(
      "OTP Error:",
      e.response?.data || e.message || e
    );

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: e.response?.data || e.message,
    });
  }
});

// Verify OTP
app.post("/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const otp = req.body.otp;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone and OTP required",
      });
    }

    const { data, error } = await supabase
      .from("otp_verifications")
      .select("*")
      .eq("phone", phone)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: "OTP not found",
      });
    }

    if (
      new Date(data.expires_at) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    const otpHash = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    if (otpHash !== data.otp_hash) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await supabase
      .from("otp_verifications")
      .delete()
      .eq("phone", phone);

    return res.json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
});

app.get("/", (req, res) => {
  res.send("Fast2SMS OTP Server Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
