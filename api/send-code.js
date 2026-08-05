import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function sendEmail(to, name, code) {
  const resp = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "origin": "https://myrecipecards.vercel.app",
    },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to, to_name: name || to, code },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("EmailJS response:", resp.status, text);
    throw new Error(text);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, name, mode } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  const { data: existingUser } = await supabase
    .from("users").select("id").eq("email", email).maybeSingle();

  if (mode === "login" && !existingUser) {
    return res.status(404).json({ error: "No account found for this email. Sign up first." });
  }
  if (mode === "signup" && existingUser) {
    return res.status(409).json({ error: "An account already exists for this email. Log in instead." });
  }
  if (mode === "signup" && !name?.trim()) {
    return res.status(400).json({ error: "Please enter your name." });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hashed = hashCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const password = crypto.randomBytes(32).toString("hex") + "Aa1!";

  const { error: upsertErr } = await supabase.from("auth_bridge").upsert({
    email,
    current_password: password,
    pending_code: hashed,
    pending_code_expires_at: expiresAt,
    pending_signup_name: name?.trim() || null,
    is_new_signup: mode === "signup",
  });

  if (upsertErr) {
    console.error("upsert error:", upsertErr);
    return res.status(500).json({ error: "Failed to store verification code." });
  }

  try {
    await sendEmail(email, name, code);
  } catch(e) {
    console.error("Email error:", e);
    return res.status(500).json({ error: "Failed to send email. Please try again." });
  }

  return res.status(200).json({ ok: true });
}
