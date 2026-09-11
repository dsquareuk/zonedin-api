module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: { message: "Missing prompt" } });
  }

  // Server owns model, token limits, and rate limiting
  // Client cannot override these
  const MAX_PROMPT_LENGTH = 4000;
  const truncatedPrompt = prompt.slice(0, MAX_PROMPT_LENGTH);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: truncatedPrompt }]
      }),
    });

    const data = await response.json();
    console.log("STATUS:", response.status);
    if (!response.ok) {
      console.log("ERROR:", JSON.stringify(data));
    }
    res.status(response.status).json(data);

  } catch (err) {
    console.log("CATCH ERROR:", err.message);
    res.status(500).json({ error: { message: "Internal server error" } });
  }
};
