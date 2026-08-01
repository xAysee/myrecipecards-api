export default async function handler(req, res) {
  // Just confirm the function runs and env vars are present
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  console.log("Ping called at", new Date().toISOString());
  console.log("Has SUPABASE_URL:", hasUrl);
  console.log("Has SUPABASE_SERVICE_ROLE_KEY:", hasKey);
  
  return res.status(200).json({ 
    ok: true, 
    time: new Date().toISOString(),
    hasUrl,
    hasKey
  });
}
