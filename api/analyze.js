export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, parts } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set" });
  }

  // Build the Gemini request
  // System prompt goes as a "system" instruction, user content as "user" turn
  const body = {
    system_instruction: {
      parts: [{ text: system }]
    },
    contents: [
      {
        role: "user",
        parts: parts  // already formatted: [{text:...}] or [{inlineData:...},{text:...}]
      }
    ],
    generationConfig: {
      temperature: 0.2,        // low temp = more consistent structured output
      maxOutputTokens: 2400,
      responseMimeType: "application/json"  // tells Gemini to return JSON directly
    }
  };

  const model = "gemini-1.5-flash";  // free tier model - fast and capable
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return res.status(response.status).json({ error: "Gemini API error", detail: errText });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
