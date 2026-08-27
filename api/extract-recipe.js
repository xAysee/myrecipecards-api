import { createClient } from "@supabase/supabase-js";
import { handleCors } from "../_cors.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// System prompt lives entirely on the server — never sent from or exposed to the client
const SYSTEM_PROMPT = `You are a recipe extraction assistant. Extract the recipe from the provided content and return ONLY valid JSON with this exact structure, no other text, no markdown, no backticks:
{
  "title": "Recipe Title",
  "description": "Brief description",
  "prepTime": "X mins",
  "cookTime": "X mins",
  "servings": 4,
  "tags": ["tag1", "tag2"],
  "notes": "Any additional notes",
  "imageUrl": "https://... (only if a real image URL is found in the content)",
  "ingredients": [
    { "amount": "1", "unit": "cup", "name": "ingredient name" }
  ],
  "steps": [
    "Step 1 description",
    "Step 2 description"
  ]
}
Rules:
- Return ONLY the JSON object, nothing else
- If you cannot find a clear recipe, return { "error": "No recipe found" }
- Do not invent ingredients or steps not present in the source
- Normalize amounts to numbers or simple fractions (1/2, 1/4 etc)
- Tags should be lowercase, descriptive (cuisine type, meal type, dietary info, cooking method)`;

async function verifyJwt(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Require valid Supabase JWT ─────────────────────────────────────────────
  const user = await verifyJwt(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized. A valid session is required." });
  }

  const { userContent, hasImage } = req.body;
  if (!userContent) return res.status(400).json({ error: "Missing userContent" });

  // Limit payload size to prevent abuse
  const MAX_CONTENT_LENGTH = 50000; // 50KB of text is plenty for any recipe
  const contentStr = typeof userContent === "string" 
    ? userContent 
    : JSON.stringify(userContent);
  if (contentStr.length > MAX_CONTENT_LENGTH) {
    return res.status(413).json({ error: "Content too large. Please paste a shorter excerpt." });
  }
  
  if (typeof userContent !== "string" && !Array.isArray(userContent)) {
    return res.status(400).json({ error: "Invalid userContent format." });
  }

  // ── Forward to Groq with server-side system prompt ─────────────────────────
  try {
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        max_tokens: 2048,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text();
      console.error("Groq error:", groqResp.status, errText);

      // Parse retry-after from Groq's rate limit response
      if (groqResp.status === 429) {
        try {
          const errJson = JSON.parse(errText);
          const msg = errJson?.error?.message || "";
          const secondsMatch = msg.match(/try again in ([\d.]+)s/i);
          const seconds = secondsMatch ? Math.ceil(parseFloat(secondsMatch[1])) : null;
          return res.status(429).json({
            error: seconds
              ? `You're importing too quickly. Please wait ${seconds} second${seconds !== 1 ? "s" : ""} and try again.`
              : "You're importing too quickly. Please wait a few seconds and try again.",
          });
        } catch(e) {
          return res.status(429).json({
            error: "You're importing too quickly. Please wait a few seconds and try again.",
          });
        }
      }

      return res.status(502).json({ error: "Recipe extraction service unavailable. Please try again." });
    }

    const groqData = await groqResp.json();
    const raw = groqData.choices?.[0]?.message?.content || "";

    // ── Parse and validate the JSON before returning ──────────────────────────
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON in Groq response:", raw);
      return res.status(422).json({ error: "Could not extract a recipe from that content. Try pasting the recipe text directly." });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {
      console.error("JSON parse error:", e, raw);
      return res.status(422).json({ error: "Recipe extraction produced invalid data. Please try again." });
    }

    if (parsed.error) {
      return res.status(422).json({ error: parsed.error });
    }

    // Return only the parsed recipe object — never the raw Groq response
    return res.status(200).json({ recipe: parsed });

  } catch(e) {
    console.error("Extract error:", e);
    return res.status(500).json({ error: "Recipe extraction failed. Please try again." });
  }
}
