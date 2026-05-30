
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
  process.env.SUPABASE_KEY // Use SERVICE ROLE KEY
);

const normalizePhone = (phone) =>
  phone.replace(/\D/g, "").slice(-10);

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();


app.get("/test-fast2sms", async (req, res) => {
  try {
    const response = await axios.get(
      "https://www.fast2sms.com/dev/wallet",
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
        },
      }
    );

    res.json(response.data);
  } catch (e) {
    res.json({
      error: e.response?.data || e.message,
    });
  }
});

/// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

    phone = normalizePhone(phone);

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/send",
      {
        mobile: phone,
        otp_id: "45d6bbbddb"
      },
      {
        headers: {
          accept: "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    console.log("Fast2SMS Response:", response.data);

    return res.json({
      success: true,
      data: response.data,
    });

  } catch (err) {
    console.log("STATUS:", err.response?.status);
    console.log("DATA:", err.response?.data);
    console.log("MESSAGE:", err.message);

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

    phone = normalizePhone(phone);

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp/verify",
      {
        mobile: phone,
        otp: otp,
        otp_id: "45d6bbbddb"
      },
      {
        headers: {
          accept: "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
          "content-type": "application/json",
        },
      }
    );

    console.log("VERIFY RESPONSE:", response.data);

    if (!response.data.return) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (!existingUser) {
      await supabase.from("users").insert({
        id: crypto.randomUUID(),
        phone,
        created_at: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      message: "OTP verified successfully",
    });

  } catch (err) {
    console.log(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

app.get("/", (req, res) => {
  res.send("Fast2SMS OTP Server Running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
