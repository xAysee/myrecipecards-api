export default async function handler(req, res) {
  // Use direct REST API call instead of the JS client
  // This bypasses any client library issues
  const url = `${process.env.SUPABASE_URL}/rest/v1/auth_bridge?select=email&limit=1`;
  
  try {
    const resp = await fetch(url, {
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Ping REST error:", resp.status, text);
      return res.status(500).json({ ok: false, status: resp.status, error: text });
    }

    console.log("Supabase pinged successfully at", new Date().toISOString());
    return res.status(200).json({ ok: true, time: new Date().toISOString() });
  } catch(e) {
    console.error("Ping fetch error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
