// POST /api/beta-signup  — public. Saves a beta sign-up to public.beta_signups.
// Optional env FOUNDER_EMAIL (+ RESEND_API_KEY, EMAIL_FROM): email the founder on each sign-up.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";
const sb = (path, init = {}) => fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const readJson = async (req) => { if (req.body && typeof req.body === "object") return req.body; try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; } };

const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const b = await readJson(req);
  if (b.website) return res.status(200).json({ ok: true }); // honeypot: bots fill hidden fields
  const row = {
    name: clean(b.name, 60),
    email: clean(b.email, 160).toLowerCase(),
    role: clean(b.role, 60),
    goal: clean(b.goal, 300),
    phone: ["iphone", "android"].includes(b.phone) ? b.phone : null,
    source: clean(b.source, 60) || "direct",
    consent: b.consent === "on" || b.consent === true
  };
  if (!row.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || !row.consent) return res.status(400).json({ error: "invalid" });

  const r = await sb("/rest/v1/beta_signups?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row)
  });
  if (!r.ok) { console.log("beta signup error:", r.status, await r.text()); return res.status(502).json({ error: "save_failed" }); }

  if (process.env.FOUNDER_EMAIL && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: process.env.FOUNDER_EMAIL, subject: `New beta sign-up: ${row.name}`,
        text: `${row.name} <${row.email}>\n${row.role} · ${row.phone || "?"} · from ${row.source}\n\nKeeps meaning to: ${row.goal || "(not given)"}` })
    }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
};
