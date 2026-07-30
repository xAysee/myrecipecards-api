import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { error } = await supabase.from("users").select("id").limit(1);
  if (error) {
    console.error("Ping failed:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
  console.log("Supabase pinged successfully at", new Date().toISOString());
  return res.status(200).json({ ok: true, time: new Date().toISOString() });
}
