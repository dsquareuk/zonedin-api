// Called by a Supabase trigger when someone joins the beta. Emails the founder.
// Auth: Authorization: Bearer <CRON_SECRET> (same secret the scheduled jobs use).
// Env: CRON_SECRET, RESEND_API_KEY, EMAIL_FROM, FOUNDER_EMAIL.
const crypto = require("crypto");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const want = `Bearer ${process.env.CRON_SECRET || ""}`, got = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).end();
  if (!process.env.RESEND_API_KEY || !process.env.FOUNDER_EMAIL || !process.env.EMAIL_FROM) return res.status(503).json({ error: "email not configured" });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const r = body.record || body;
  if (body.type === "feedback") {
    const label = { confusing: "😕 Confusing", annoying: "😤 Annoying", idea: "💡 Idea", bug: "🐞 Bug", love: "❤️ Love it" }[r.kind] || r.kind;
    const fhtml = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0F141C">
      <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#007A70;font-weight:700;margin:0 0 8px">Beta feedback · ${esc(label)}</p>
      <p style="font-size:18px;margin:0 0 14px;white-space:pre-wrap">${esc(r.message)}</p>
      <p style="margin:0;color:#555">${esc(r.name)} &lt;${esc(r.email)}&gt;<br>Screen: ${esc(r.screen || "–")} · Trial day ${esc(r.trial_day || "–")} · ${esc(r.platform || "–")}</p>
      <p style="margin:14px 0 0;color:#555">Reply to this email to answer them directly.</p></div>`;
    const fs = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: process.env.FOUNDER_EMAIL, subject: `Feedback (${String(label)}): ${String(r.message || "").slice(0, 50)}`, html: fhtml, reply_to: r.email || undefined })
    });
    if (!fs.ok) { console.log("feedback alert error:", fs.status, await fs.text()); return res.status(502).json({ error: "send failed" }); }
    return res.status(200).json({ ok: true });
  }
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0F141C">
    <p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#007A70;font-weight:700;margin:0 0 8px">New ZonedIn beta sign-up</p>
    <p style="font-size:20px;font-weight:700;margin:0 0 12px">${esc(r.name)} &lt;${esc(r.email)}&gt;</p>
    <p style="margin:0"><b>Group:</b> ${esc(r.role || "–")}<br><b>Phone:</b> ${esc(r.phone || "–")}<br><b>Came from:</b> ${esc(r.source || "direct")}</p>
    <p style="margin:12px 0 0"><b>Keeps meaning to:</b> ${esc(r.goal || "(not given)")}</p>
    <p style="margin:16px 0 0;color:#555">Send their invite today, and make that their first Gold.</p></div>`;
  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: process.env.FOUNDER_EMAIL, subject: `New beta sign-up: ${String(r.name || "someone").slice(0, 40)}`, html, reply_to: r.email || undefined })
  });
  if (!send.ok) { console.log("signup alert error:", send.status, await send.text()); return res.status(502).json({ error: "send failed" }); }
  return res.status(200).json({ ok: true });
};
