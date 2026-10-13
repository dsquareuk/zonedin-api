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
  let r = req.body; if (typeof r === "string") { try { r = JSON.parse(r); } catch (_) { r = {}; } }
  r = r && r.record ? r.record : r || {};
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
