import { createClient } from "@supabase/supabase-js";
import { handleCors } from "../_cors.js";

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Look up user directly by email — no pagination issues
  const { data, error: listErr } = await supabase.auth.admin.listUsers({ 
    page: 1, 
    perPage: 1000 
  });
  if (listErr) {
    console.error("listUsers error:", listErr);
    return res.status(500).json({ error: listErr.message });
  }

  const user = data.users.find(u => u.email === email);
  if (!user) {
    console.error("User not found for email:", email);
    return res.status(404).json({ error: "User not found" });
  }

  // Update their password
  const { error: updateErr } = await supabase.auth.admin.updateUserById(
    user.id, 
    { password }
  );
  if (updateErr) {
    console.error("updateUserById error:", updateErr);
    return res.status(500).json({ error: updateErr.message });
  }

  console.log("Password reset successfully for:", email);
  return res.status(200).json({ ok: true });
}
