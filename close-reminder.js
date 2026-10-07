// DL-13 — "Close your day" evening email.
// Call every 15 minutes (Supabase pg_cron, or Vercel Cron on a Pro plan).
// Sends once per user per day, only if they committed today, haven't closed, and opted in.
//
// Vercel env vars required:
//   CRON_SECRET                 any long random string (also sent by the scheduler)
//   SUPABASE_SERVICE_ROLE_KEY   Supabase → Project settings → API → service_role (server only, never in index.html)
//   RESEND_API_KEY              resend.com → API keys
//   EMAIL_FROM                  e.g. "ZonedIn <close@yourdomain.com>" (domain verified in Resend)
// Optional: APP_URL (default https://zonedin-api.vercel.app), SUPABASE_URL
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";
const APP_URL = process.env.APP_URL || "https://zonedin-api.vercel.app";
const POSTHOG_KEY = "phc_yS3gvBMbLsgRe9YrUTmEUqPfHyFQP4pKuTbgfv7YdVmf";
const WINDOW_MIN = 120; // send if reminder time passed within the last 2 hours

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}${path}`, {
  ...init,
  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }
});
const localParts = (tz) => {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
};
const sign = (uid) => crypto.createHmac("sha256", process.env.CRON_SECRET).update(uid).digest("hex").slice(0, 32);
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const capture = (event, distinctId, props) => fetch("https://eu.i.posthog.com/capture/", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: distinctId, properties: props || {} })
}).catch(() => {});

const emailHtml = (name, zone, uid) => {
  const tiers = [["Gold", zone.gold, "#F59E0B"], ["Diamond", zone.diamond, "#60A5FA"], ["Platinum", zone.platinum, "#A78BFA"]]
    .filter(([k]) => zone.outcomes && zone.outcomes[k.toLowerCase()]);
  const rows = tiers.map(([label, task, color]) => {
    const o = zone.outcomes[label.toLowerCase()];
    const mark = o === "kept" ? "&#10003; Kept" : o === "not_kept" ? "Not kept" : "Not reckoned yet";
    return `<tr><td style="padding:10px 14px;border:1px solid #1f2733;border-radius:10px;background:#111720">
      <div style="font:700 10px Arial;letter-spacing:1px;color:${color};text-transform:uppercase">${label}</div>
      <div style="font:600 15px Arial;color:#F0F4F8;margin-top:3px">${esc(task)}</div>
      <div style="font:12px Arial;color:#8a929c;margin-top:3px">${mark}</div></td></tr><tr><td style="height:8px"></td></tr>`;
  }).join("");
  const sig = sign(uid);
  return `<!doctype html><html><body style="margin:0;background:#0a0e14;padding:28px 16px">
  <table role="presentation" width="100%" style="max-width:460px;margin:0 auto"><tr><td>
  <div style="font:900 22px Arial;color:#F0F4F8;margin-bottom:6px">${name ? esc(name) + ", close" : "Close"} your day.</div>
  <div style="font:14px Arial;color:#8a929c;margin-bottom:20px">This morning you made a promise. See if you kept your word.</div>
  <table role="presentation" width="100%">${rows}</table>
  <a href="${APP_URL}/?close=today" style="display:block;text-align:center;margin-top:14px;padding:15px;border-radius:50px;background:#00C2B2;color:#fff;font:700 16px Arial;text-decoration:none">Close today &rarr;</a>
  <div style="font:11px Arial;color:#5b636d;margin-top:26px;text-align:center">Keep your word to yourself. &middot;
  <a href="${APP_URL}/api/email-event?a=unsub&u=${uid}&s=${sig}" style="color:#5b636d">Unsubscribe from evening emails</a></div>
  <img src="${APP_URL}/api/email-event?a=open&u=${uid}&s=${sig}" width="1" height="1" alt="" style="display:block;border:0">
  </td></tr></table></body></html>`;
};

module.exports = async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return res.status(500).json({ error: "missing env vars" });
  // Any timezone's "today" is within ±1 day of UTC.
  const now = new Date();
  const d0 = now.toISOString().slice(0, 10);
  const dm = new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  const dp = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
  const zr = await sb(`/rest/v1/zones?select=user_id,date,gold,diamond,platinum,outcomes&committed_at=not.is.null&closed_at=is.null&close_email_sent_at=is.null&date=in.(${dm},${d0},${dp})`);
  if (!zr.ok) return res.status(500).json({ error: "zones query failed", detail: await zr.text() });
  const zones = await zr.json();
  if (!zones.length) return res.status(200).json({ sent: 0 });
  const ids = [...new Set(zones.map((z) => z.user_id))];
  const pr = await sb(`/rest/v1/profiles?select=id,user_name,user_timezone,close_reminder_time,close_email_opt_in&id=in.(${ids.join(",")})`);
  const profiles = pr.ok ? await pr.json() : [];
  let sent = 0;
  const results = [];
  for (const p of profiles) {
    if (p.close_email_opt_in === false) continue;
    let local;
    try { local = localParts(p.user_timezone || "Europe/London"); } catch (e) { local = localParts("Europe/London"); }
    const zone = zones.find((z) => z.user_id === p.id && z.date === local.day);
    if (!zone) continue;
    const [hh, mm] = String(p.close_reminder_time || "20:30").split(":").map(Number);
    const since = local.minutes - (hh * 60 + mm);
    if (since < 0 || since > WINDOW_MIN) continue;
    // Claim the send first so overlapping runs can't double-send (at most one per user per day).
    const claim = await sb(`/rest/v1/zones?user_id=eq.${p.id}&date=eq.${zone.date}&close_email_sent_at=is.null&closed_at=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ close_email_sent_at: new Date().toISOString() }) });
    const claimed = claim.ok ? await claim.json() : [];
    if (!claimed.length) continue;
    const ur = await sb(`/auth/v1/admin/users/${p.id}`);
    const u = ur.ok ? await ur.json() : null;
    if (!u || !u.email) continue;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [u.email], subject: "Close your day", html: emailHtml(p.user_name, zone, p.id),
        headers: { "List-Unsubscribe": `<${APP_URL}/api/email-event?a=unsub&u=${p.id}&s=${sign(p.id)}>` } })
    });
    if (r.ok) { sent++; capture("close_email_sent", p.id, { local_time: `${hh}:${String(mm).padStart(2, "0")}` }); }
    else { results.push({ id: p.id, status: r.status }); await sb(`/rest/v1/zones?user_id=eq.${p.id}&date=eq.${zone.date}`, { method: "PATCH", body: JSON.stringify({ close_email_sent_at: null }) }); }
  }
  res.status(200).json({ sent, failed: results.length });
};
