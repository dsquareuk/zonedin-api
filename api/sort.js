// Plain-language task entry: turns "everything on my mind" into Today's Three.
// POST /api/sort  { text: string }  →  { gold, diamond, platinum, later }
// Each tier is { task, done_when } or null. The prompt lives here, so the endpoint can only sort tasks.
const MAX_INPUT = 800;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const text = req.body && typeof req.body.text === "string" ? req.body.text.trim().slice(0, MAX_INPUT) : "";
  if (!text) return res.status(400).json({ error: "missing text" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "missing env vars" });

  const prompt = `You help someone choose today's three commitments in the ZonedIn app.

They typed this, in their own words:
<input>
${text}
</input>

Pick at most three tasks from what they wrote:
- gold: the one that matters most today (the one with the biggest consequence if it slips).
- diamond: their second most important.
- platinum: a stretch task, if there is one.
For each, write "task" as a short action in their own words (max 60 characters) and "done_when" as a concrete, checkable finish line (max 70 characters), e.g. "Proposal sent to Sarah".
Put anything else they mentioned in "later" (short strings). Never invent tasks they didn't mention. If there are fewer than three tasks, use null for the missing tiers.
Reply with JSON only, no other text:
{"gold":{"task":"","done_when":""},"diamond":{"task":"","done_when":""}|null,"platinum":{"task":"","done_when":""}|null,"later":[]}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: prompt }] })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: "sort failed" });
    const raw = (data.content || []).map((b) => b.text || "").join("");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "sort failed" });
    const j = JSON.parse(m[0]);
    const clean = (t) => t && typeof t.task === "string" && t.task.trim() ? { task: t.task.trim().slice(0, 80), done_when: String(t.done_when || "").trim().slice(0, 90) } : null;
    const out = { gold: clean(j.gold), diamond: clean(j.diamond), platinum: clean(j.platinum), later: Array.isArray(j.later) ? j.later.filter((x) => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 80)) : [] };
    if (!out.gold) return res.status(422).json({ error: "no task found" });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "sort failed" });
  }
};
