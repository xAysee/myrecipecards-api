export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, code, name } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Missing email or code" });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Gathered <onboarding@resend.dev>",
      to: email,
      subject: "Your Gathered verification code",
      html: `
        <div style="font-family: Georgia, serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="color: #C4622D; font-size: 28px; margin-bottom: 8px;">gathered</h1>
          <p style="color: #6B5F4E; margin-bottom: 32px;">Your personal recipe collection</p>
          <p style="color: #2A2118;">Hi ${name || "there"}, here is your verification code:</p>
          <div style="background: #F5EFE0; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-family: monospace; font-size: 36px; font-weight: bold; letter-spacing: 0.3em; color: #C4622D;">${code}</span>
          </div>
          <p style="color: #6B5F4E; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Resend error:", err);
    return res.status(500).json({ error: "Failed to send email" });
  }

  return res.status(200).json({ ok: true });
}
