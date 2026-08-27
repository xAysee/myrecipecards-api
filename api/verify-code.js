import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { handleCors } from "../_cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Missing email or code." });

  const key = email.trim().toLowerCase();

  // ── Fetch bridge row ───────────────────────────────────────────────────────
  const { data: bridge, error: fetchErr } = await supabase
    .from("auth_bridge").select("*").eq("email", key).maybeSingle();

  if (fetchErr || !bridge) {
    return res.status(400).json({ error: "No pending verification found. Please request a new code." });
  }

  // ── Rate limit check ───────────────────────────────────────────────────────
  const now = Date.now();
  const windowStart = bridge.attempt_window_start
    ? new Date(bridge.attempt_window_start).getTime()
    : null;
  const windowActive = windowStart && (now - windowStart) < COOLDOWN_MS;

  if (windowActive && (bridge.attempt_count || 0) >= MAX_ATTEMPTS) {
    const retryAfterMs = COOLDOWN_MS - (now - windowStart);
    const retryMins = Math.ceil(retryAfterMs / 60000);
    return res.status(429).json({
      error: `Too many attempts. Please wait ${retryMins} minute${retryMins !== 1 ? "s" : ""} before trying again.`,
    });
  }

  // ── Code validation ────────────────────────────────────────────────────────
  if (!bridge.pending_code) {
    return res.status(400).json({ error: "No pending code. Please request a new one." });
  }
  if (new Date(bridge.pending_code_expires_at) < new Date()) {
    return res.status(400).json({ error: "Code expired. Please request a new one." });
  }

  const submittedHash = hashCode(code.trim());
  if (submittedHash !== bridge.pending_code) {
    await supabase.from("auth_bridge").update({
      attempt_count: (bridge.attempt_count || 0) + 1,
      attempt_window_start: windowActive
        ? bridge.attempt_window_start
        : new Date(now).toISOString(),
    }).eq("email", key);
    return res.status(401).json({ error: "Incorrect code. Please check and try again." });
  }

  // ── Code is valid — sign up or sign in ────────────────────────────────────
  let authUser;

  if (bridge.is_new_signup) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: key,
      password: bridge.current_password,
      email_confirm: true,
      user_metadata: { name: bridge.pending_signup_name },
    });
    if (error && error.message?.includes("already registered")) {
      const { data: d2 } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = d2?.users?.find(u => u.email === key);
      if (!found) return res.status(500).json({ error: "Account setup failed. Please try again." });
      authUser = found;
    } else if (error) {
      console.error("createUser error:", error);
      return res.status(500).json({ error: error.message });
    } else {
      authUser = data.user;
    }
    await supabase.from("users").upsert({
      id: authUser.id,
      email: key,
      name: bridge.pending_signup_name || key.split("@")[0],
    });
  } else {
    const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = listData?.users?.find(u => u.email === key);
    if (!existing) return res.status(404).json({ error: "Account not found." });
    await supabase.auth.admin.updateUserById(existing.id, {
      password: bridge.current_password,
    });
    authUser = existing;
  }

  // ── Create session directly — NO magic link, tokens returned over HTTPS only
  // signInWithPassword from the admin client establishes a real session
  // without ever putting tokens in a URL fragment
  const anonSupabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data: signInData, error: signInErr } = await anonSupabase.auth.signInWithPassword({
    email: key,
    password: bridge.current_password,
  });

  if (signInErr) {
    console.error("signIn error:", signInErr);
    return res.status(500).json({ error: "Verification succeeded but session creation failed. Please try logging in." });
  }

  // ── Clear used code + reset rate limit ────────────────────────────────────
  await supabase.from("auth_bridge").update({
    pending_code: null,
    pending_code_expires_at: null,
    is_new_signup: false,
    attempt_count: 0,
    attempt_window_start: null,
  }).eq("email", key);

  // Return session tokens directly over HTTPS — never in a URL fragment
  return res.status(200).json({
    ok: true,
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    expires_at: signInData.session.expires_at,
    user: {
      id: signInData.user.id,
      email: signInData.user.email,
      name: signInData.user.user_metadata?.name || signInData.user.email.split("@")[0],
    },
  });
}
