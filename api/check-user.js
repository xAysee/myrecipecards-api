import { createClient } from "@supabase/supabase-js";
import { handleCors } from "../_cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  // Return only existence — never expose the actual user id or any other data
  return res.status(200).json({ exists: !!data });
}
