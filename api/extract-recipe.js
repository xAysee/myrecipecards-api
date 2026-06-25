export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { system, userContent, hasImage } = req.body;
  if (!userContent) return res.status(400).json({ error: "Missing userContent" });

  // Use a vision-capable model when an image is included, text model otherwise
  const model = hasImage
    ? "meta-llama/llama-4-scout-17b-16e-instruct"
    : "llama-3.3-70b-versatile";

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      max_tokens: 2000,
    }),
  });

  const data = await response.json();
  return res.status(response.ok ? 200 : 500).json(data);
}
