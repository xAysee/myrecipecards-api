// _cors.js — shared CORS helper for all API routes
const ALLOWED_ORIGIN = "https://myrecipecards.vercel.app";

export function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN || (origin && origin.endsWith(".vercel.app"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

export function handleCors(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.status(200).end(); return true; }
  return false;
}
