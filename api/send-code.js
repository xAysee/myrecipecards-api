import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const IP_MAX = 10;                   // max requests per IP per window
const IP_COOLDOWN_MS = 15 * 60 * 1000;

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// In-memory IP rate limit store (resets on cold start, good enough for serverless)
// For persistent IP limiting across instances, move this to a Redis/Upstash store
const ipStore = new Map();

function getClientIp(req) {
  // Vercel sets x-forwarded-for; take the first (original client) IP
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function checkIpLimit(ip) {
  const now = Date.now();
  const entry = ipStore.get(ip);

  if (!entry || (now - entry.windowStart) >= IP_COOLDOWN_MS) {
    // No entry or window expired — start fresh
    ipStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= IP_MAX) {
    const retryMins = Math.ceil((IP_COOLDOWN_MS - (now - entry.windowStart)) / 60000);
    return { allowed: false, retryMins };
  }

  entry.count += 1;
  return { allowed: true };
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

  // ── Strict mode allowlist ──────────────────────────────────────────────────
  if (mode !== "login" && mode !== "signup") {
    return res.status(400).json({ error: "Invalid mode." });
  }

  if (!email) return res.status(400).json({ error: "Missing email" });

  // Basic email format check server-side
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const key = email.trim().toLowerCase();
  const now = Date.now();

  // ── Per-IP rate limit ──────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const ipCheck = checkIpLimit(ip);
  if (!ipCheck.allowed) {
    console.warn(`IP rate limit hit: ${ip}`);
    return res.status(429).json({
      error: `Too many requests from your network. Please wait ${ipCheck.retryMins} minute${ipCheck.retryMins !== 1 ? "s" : ""} before trying again.`,
    });
  }

  // ── Per-email rate limit ───────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("auth_bridge")
    .select("attempt_count, attempt_window_start")
    .eq("email", key)
    .maybeSingle();

  const windowStart = existing?.attempt_window_start
    ? new Date(existing.attempt_window_start).getTime()
    : null;
  const windowActive = windowStart && (now - windowStart) < COOLDOWN_MS;

  if (windowActive && (existing?.attempt_count || 0) >= MAX_ATTEMPTS) {
    const retryAfterMs = COOLDOWN_MS - (now - windowStart);
    const retryMins = Math.ceil(retryAfterMs / 60000);
    return res.status(429).json({
      error: `Too many attempts for this email. Please wait ${retryMins} minute${retryMins !== 1 ? "s" : ""} before trying again.`,
    });
  }

  // ── Increment per-email counter BEFORE account existence check ────────────
  if (existing && windowActive) {
    await supabase.from("auth_bridge").update({
      attempt_count: existing.attempt_count + 1,
    }).eq("email", key);
  } else if (!existing) {
    await supabase.from("auth_bridge").upsert({
      email: key,
      current_password: "placeholder",
      attempt_count: 1,
      attempt_window_start: new Date(now).toISOString(),
    });
  } else {
    await supabase.from("auth_bridge").update({
      attempt_count: 1,
      attempt_window_start: new Date(now).toISOString(),
    }).eq("email", key);
  }

  // ── Account existence check ────────────────────────────────────────────────
  const { data: existingUser } = await supabase
    .from("users").select("id").eq("email", key).maybeSingle();

  if (mode === "login" && !existingUser) {
    return res.status(404).json({ error: "No account found for this email. Sign up first." });
  }
  if (mode === "signup" && existingUser) {
    return res.status(409).json({ error: "An account already exists for this email. Log in instead." });
  }
  if (mode === "signup" && !name?.trim()) {
    return res.status(400).json({ error: "Please enter your name." });
  }

  // ── Generate code, hash, store ────────────────────────────────────────────
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hashed = hashCode(code);
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  const password = crypto.randomBytes(32).toString("hex") + "Aa1!";

  const { error: upsertErr } = await supabase.from("auth_bridge").upsert({
    email: key,
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

  // ── Send email ────────────────────────────────────────────────────────────
  try {
    await sendEmail(key, name, code);
  } catch(e) {
    console.error("Email error:", e);
    return res.status(500).json({ error: "Failed to send email. Please try again." });
  }

  return res.status(200).json({ ok: true });
}
