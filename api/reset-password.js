import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  // Use service role key — this bypasses RLS and can update any user's password
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Look up the user by email
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) return res.status(500).json({ error: listErr.message });

  const user = users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: "User not found" });

  // Update their password to the one we just generated and stored in auth_bridge
  const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({ ok: true });
}
