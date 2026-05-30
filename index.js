
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

const normalizePhone = (phone) =>
  phone.replace(/\D/g, "").slice(-10);

app.get("/", (req, res) => {
  res.send("Fast2SMS OTP Server Running 🚀");
});

/// SEND OTP
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

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/send",
      {
        mobile: phone,
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

    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    await supabase
      .from("otp_sessions")
      .insert({
        phone,
        session_id: requestId,
        created_at: new Date().toISOString(),
      });

    return res.json({
      success: true,
      request_id: requestId,
    });

  } catch (err) {
    console.error(
      "SEND OTP ERROR:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

/// VERIFY OTP
app.post("/verify-otp", async (req, res) => {
  try {
    let { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        error: "Phone and OTP required",
      });
    }

    phone = normalizePhone(phone);

    const { data: sessionData } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone", phone)
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
        mobile: phone,
        otp: otp,
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

    if (
      response.data.return !== true &&
      response.data.status_code !== 200
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
      });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (!existingUser) {
      await supabase
        .from("users")
        .insert({
          id: crypto.randomUUID(),
          phone,
          is_verified: true,
          verified_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });
    }

    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    return res.json({
      success: true,
      message: "OTP verified successfully",
    });

  } catch (err) {
    console.error(
      "VERIFY ERROR:",
      err.response?.data || err.message
    );

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
