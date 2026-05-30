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
  process.env.SUPABASE_KEY // SERVICE_ROLE_KEY
);

const normalizePhone = (phone) =>
  phone.replace(/\D/g, "").slice(-10);

app.get("/", (req, res) => {
  res.send("Fast2SMS OTP Server Running 🚀");
});

/// TEST FAST2SMS
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

    return res.json(response.data);
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.response?.data || e.message,
    });
  }
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

    console.log("SEND OTP:", response.data);

    return res.json({
      success: true,
      message: "OTP sent successfully",
      data: response.data,
    });
  } catch (err) {
    console.log("STATUS:", err.response?.status);
    console.log("DATA:", err.response?.data);

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
        message: "Phone and OTP required",
      });
    }

    phone = normalizePhone(phone);

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

    console.log("VERIFY OTP:", response.data);

    if (
      response.data.return !== true &&
      response.data.status_code !== 200
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const { data: existingUser, error: fetchError } =
      await supabase
        .from("users")
        .select("id, phone")
        .eq("phone", phone)
        .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingUser) {
      const { error: insertError } = await supabase
        .from("users")
        .insert({
          id: crypto.randomUUID(),
          phone: phone,
          is_verified: true,
          verified_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        throw insertError;
      }
    } else {
      const { error: updateError } = await supabase
        .from("users")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          last_verification_at:
            new Date().toISOString(),
        })
        .eq("phone", phone);

      if (updateError) {
        throw updateError;
      }
    }

    return res.json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (err) {
    console.log("VERIFY ERROR:");
    console.log(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
