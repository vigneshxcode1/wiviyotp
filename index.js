// const express = require("express");
// const axios = require("axios");
// const cors = require("cors");
// const dotenv = require("dotenv");
// const crypto = require("crypto");
// const { createClient } = require("@supabase/supabase-js");

// dotenv.config();

// const app = express();

// app.use(cors());
// app.use(express.json());

// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_KEY
// );

// // Normalize phone
// const normalizePhone = (phone) =>
//   phone.replace(/\D/g, '').trim();

// /// SEND OTP
// app.post("/send-otp", async (req, res) => {
//   try {
//     let { phone } = req.body;

//     phone = normalizePhone(phone);

//     console.log("📤 Sending OTP to:", phone);

//     const response = await axios.get(
//       // `https://2factor.in/API/V1/${process.env.API_KEY}/SMS/+${phone}/AUTOGEN`
//       `https://2factor.in/API/V1/${process.env.API_KEY}/SMS/${phone}/AUTOGEN`
//     );


// console.log("2Factor Response:");
// console.log(JSON.stringify(response.data, null, 2));

//     const sessionId = response.data.Details;

//     console.log("✅ Session ID:", sessionId);

//     await supabase
//       .from("otp_sessions")
//       .delete()
//       .eq("phone", phone);

//     const { error: insertError } = await supabase
//       .from("otp_sessions")
//       .insert({
//         phone,
//         session_id: sessionId,
//         created_at: new Date().toISOString(),
//       });

//     if (insertError) {
//       console.error(insertError);

//       return res.status(500).json({
//         error: "Failed to save OTP session",
//       });
//     }

//     res.json({ success: true });

//   } catch (err) {
//     console.error("❌ send-otp error:", err.message);

//     res.status(500).json({
//       error: "Failed to send OTP",
//     });
//   }
// });

// /// VERIFY OTP
// app.post("/verify-otp", async (req, res) => {
//   try {
//     let { phone, otp } = req.body;

//     phone = normalizePhone(phone);

//     console.log("📲 Verifying OTP for phone:", phone);

//     const { data: sessionData, error: sessionError } = await supabase
//       .from("otp_sessions")
//       .select("*")
//       .eq("phone", phone)
//       .order("created_at", { ascending: false })
//       .limit(1)
//       .maybeSingle();

//     if (sessionError) {
//       console.error("Session lookup error:", sessionError);

//       return res.status(500).json({
//         error: "Session lookup failed",
//       });
//     }

//     if (!sessionData) {
//       return res.status(400).json({
//         error: "OTP session expired",
//       });
//     }

//     console.log("✅ Session found:", sessionData.session_id);

//     const response = await axios.get(
//       `https://2factor.in/API/V1/${process.env.API_KEY}/SMS/VERIFY/${sessionData.session_id}/${otp}`
//     );

//     console.log("2Factor response:", response.data);

//     if (response.data.Status !== "Success") {
//       return res.status(400).json({
//         error: "Invalid OTP",
//       });
//     }


//     // Check if user exists
//     const { data: existingUser, error: userError } = await supabase
//       .from("users")
//       .select("*")
//       .eq("phone", phone) // 917338821735
//       .maybeSingle();

//     // Create user if not exists
//     if (!existingUser) {
//       const newUserId = crypto.randomUUID();

//       const { error: insertUserError } = await supabase
//         .from("users")
//         .insert({
//           id: newUserId,
//           phone: phone, 
//           created_at: new Date().toISOString(),
//         });
//     }

//     // Delete OTP session
//     await supabase
//       .from("otp_sessions")
//       .delete()
//       .eq("phone", phone);

//     res.json({ success: true });

//   } catch (err) {
//     console.error("❌ verify-otp error:", err.message);

//     res.status(500).json({
//       error: "OTP verification failed",
//     });
//   }
// });

// app.listen(3000, () => {
//   console.log("🚀 Server running on port 3000");
// });



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
  phone.replace(/\D/g, "").trim();

/// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;

phone = normalizePhone(phone);

if (!phone.startsWith("91")) {
  phone = `91${phone}`;
}
    console.log("📤 Sending OTP to:", phone);

    const response = await axios.post(
      "https://control.msg91.com/api/v5/otp",
      {
        mobile: phone,
        authkey: process.env.MSG91_AUTH_KEY,
        template_id: process.env.MSG91_TEMPLATE_ID,
        otp_expiry: 10, // minutes
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("MSG91 Response:");
console.log("FULL RESPONSE:");
console.dir(response.data, { depth: null });

    if (response.data.type !== "success") {
      throw new Error(response.data.message || "MSG91 failed to send OTP");
    }

    // MSG91 manages OTP session internally via mobile number
    // We store the phone so verify-otp knows a session exists
    await supabase
      .from("otp_sessions")
      .delete()
      .eq("phone", phone);

    const { error: insertError } = await supabase
      .from("otp_sessions")
      .insert({
        phone,
        session_id: phone, // MSG91 uses mobile as the session key
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
  console.error("❌ SEND OTP ERROR");

  if (err.response) {
    console.error("STATUS:", err.response.status);
    console.error(
      "DATA:",
      JSON.stringify(err.response.data, null, 2)
    );
  }

  console.error(err.message);

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

if (!phone.startsWith("91")) {
  phone = `91${phone}`;
}
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

    console.log("✅ Session found for phone:", phone);

    const response = await axios.get(
      "https://control.msg91.com/api/v5/otp/verify",
      {
        params: {
          mobile: phone,
          otp: otp,
          authkey: process.env.MSG91_AUTH_KEY,
        },
      }
    );

console.log(
  "MSG91 VERIFY:",
  JSON.stringify(response.data, null, 2)
);

    if (response.data.type !== "success") {
      return res.status(400).json({
        error: "Invalid OTP",
      });
    }

    // Check if user exists
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("phone", phone)
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

      if (insertUserError) {
        console.error("User insert error:", insertUserError);
      }
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


console.log(
  "MSG91_AUTH_KEY:",
  process.env.MSG91_AUTH_KEY
    ? "Loaded ✅"
    : "Missing ❌"
);

console.log(
  "MSG91_TEMPLATE_ID:",
  process.env.MSG91_TEMPLATE_ID
    ? process.env.MSG91_TEMPLATE_ID
    : "Missing ❌"
);

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});
