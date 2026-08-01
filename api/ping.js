import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Query a built-in Postgres system view -- no RLS, no grants needed
  const { data, error } = await supabase.rpc("version");

  if (error) {
    // Fallback: try a simple SQL query via the REST API
    const { error: error2 } = await supabase
      .from("auth_bridge")
      .select("email")
      .limit(1);

    if (error2) {
      console.error("Ping failed:", error2);
      return res.status(500).json({ ok: false, error: error2.message });
    }
  }

  console.log("Supabase pinged successfully at", new Date().toISOString());
  return res.status(200).json({ ok: true, time: new Date().toISOString() });
}
