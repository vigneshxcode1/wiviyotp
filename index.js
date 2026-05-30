
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

/// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

    phone = normalizePhone(phone);

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

    const response = await axios.post(
      "https://www.fast2sms.com/dev/otp",
      {
        otp_id: "45d6bbbddb",
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

    console.log("Fast2SMS:", response.data);

    res.json({
      success: true,
      message: "OTP sent successfully",
    });

  } catch (err) {
    console.error(
      "OTP Error:",
      err.response?.data || err.message
    );

    res.status(500).json({
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

    const { data, error } = await supabase
      .from("otp_verifications")
      .select("*")
      .eq("phone", phone)
      .single();

    if (error || !data) {
      return res.status(400).json({
        success: false,
        error: "OTP not found",
      });
    }

    if (
      new Date(data.expires_at) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        error: "OTP expired",
      });
    }

    const otpHash = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    if (otpHash !== data.otp_hash) {
      return res.status(400).json({
        success: false,
        error: "Invalid OTP",
      });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (!existingUser) {
      await supabase
        .from("users")
        .insert({
          id: crypto.randomUUID(),
          phone,
          created_at: new Date().toISOString(),
        });
    }

    await supabase
      .from("otp_verifications")
      .delete()
      .eq("phone", phone);

    res.json({
      success: true,
      message: "OTP verified successfully",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Verification failed",
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
