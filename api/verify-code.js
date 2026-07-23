import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Missing email or code." });

  const { data: bridge, error: fetchErr } = await supabase
    .from("auth_bridge").select("*").eq("email", email).maybeSingle();

  if (fetchErr || !bridge) return res.status(400).json({ error: "No pending verification found. Please request a new code." });
  if (!bridge.pending_code) return res.status(400).json({ error: "No pending code. Please request a new one." });
  if (new Date(bridge.pending_code_expires_at) < new Date()) return res.status(400).json({ error: "Code expired. Please request a new one." });

  // Compare hashes — raw code never touches the server after generation
  const submittedHash = hashCode(code.trim());
  if (submittedHash !== bridge.pending_code) {
    return res.status(401).json({ error: "Incorrect code. Please check and try again." });
  }

  // Code is valid — sign up or sign in via Supabase Auth
  let authUser;
  if (bridge.is_new_signup) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: bridge.current_password,
      email_confirm: true,
      user_metadata: { name: bridge.pending_signup_name },
    });
    if (error && error.message?.includes("already registered")) {
      // User exists in auth but not our users table — sign in instead
      const { data: d2, error: e2 } = await supabase.auth.admin.getUserByEmail(email).catch(()=>({data:null,error:true}));
      if (e2 || !d2?.user) return res.status(500).json({ error: "Account setup failed. Please try again." });
      authUser = d2.user;
    } else if (error) {
      console.error("createUser error:", error);
      return res.status(500).json({ error: error.message });
    } else {
      authUser = data.user;
    }
    // Ensure user row exists
    await supabase.from("users").upsert({ id: authUser.id, email, name: bridge.pending_signup_name || email.split("@")[0] });
  } else {
    // Login: reset password to our generated one then sign in
    const { data: listData } = await supabase.auth.admin.listUsers({ page:1, perPage:1000 });
    const existing = listData?.users?.find(u => u.email === email);
    if (!existing) return res.status(404).json({ error: "Account not found." });
    await supabase.auth.admin.updateUserById(existing.id, { password: bridge.current_password });
    authUser = existing;
  }

  // Generate a session for the client
  const { data: sessionData, error: sessionErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: req.headers.origin || "https://myrecipecards.vercel.app" },
  });
  if (sessionErr) {
    console.error("generateLink error:", sessionErr);
    return res.status(500).json({ error: "Verification succeeded but session creation failed." });
  }

  // Clear the used code
  await supabase.from("auth_bridge").update({
    pending_code: null, pending_code_expires_at: null, is_new_signup: false,
  }).eq("email", email);

  // Return the magic link — client uses it to establish a real session
  return res.status(200).json({ ok: true, link: sessionData.properties?.action_link });
}
