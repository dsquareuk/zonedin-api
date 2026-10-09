// Morning push — "Your Gold is waiting".
//   GET /api/morning-push?publicKey=1  → { key } (public VAPID key, safe to expose)
//   GET /api/morning-push  with  Authorization: Bearer CRON_SECRET  → sends due reminders (run every 15 min)
// Sends at most one per user per day, only to opted-in users who haven't committed to today's three yet.
//
// Vercel env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@yourdomain.com),
//                  CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY. Needs the "web-push" package (see package.json).
const webpush = require("web-push");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";
const APP_URL = process.env.APP_URL || "https://zonedin-api.vercel.app";
const POSTHOG_KEY = "phc_yS3gvBMbLsgRe9YrUTmEUqPfHyFQP4pKuTbgfv7YdVmf";
const WINDOW_MIN = 120;

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
const addDays = (d, n) => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const capture = (event, id, props) => fetch("https://eu.i.posthog.com/capture/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: id, properties: props || {} }) }).catch(() => {});

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.query && req.query.publicKey) return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "missing env vars" });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@zonedin.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const pr = await sb("/rest/v1/profiles?select=id,user_timezone,morning_push_time,morning_push_last_sent&morning_push_opt_in=eq.true");
  if (!pr.ok) return res.status(500).json({ error: "profiles query failed", detail: await pr.text() });
  const profiles = await pr.json();
  let sent = 0, skipped = 0, gone = 0;
  for (const p of profiles) {
    let local;
    try { local = localParts(p.user_timezone || "Europe/London"); } catch (e) { local = localParts("Europe/London"); }
    if (p.morning_push_last_sent === local.day) { skipped++; continue; }
    const [hh, mm] = String(p.morning_push_time || "07:30").split(":").map(Number);
    const since = local.minutes - (hh * 60 + mm);
    if (since < 0 || since > WINDOW_MIN) continue;
    const zr = await sb(`/rest/v1/zones?select=date,gold,committed_at,tomorrow_gold&user_id=eq.${p.id}&date=in.(${addDays(local.day, -1)},${local.day})`);
    const zones = zr.ok ? await zr.json() : [];
    const today = zones.find((z) => z.date === local.day);
    const yesterday = zones.find((z) => z.date !== local.day);
    if (today && today.committed_at) { skipped++; continue; } // already committed — say nothing
    // Claim today's send first so overlapping runs can't double-send.
    const claim = await sb(`/rest/v1/profiles?id=eq.${p.id}&or=(morning_push_last_sent.is.null,morning_push_last_sent.neq.${local.day})`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ morning_push_last_sent: local.day }) });
    const claimed = claim.ok ? await claim.json() : [];
    if (!claimed.length) continue;
    const gold = (today && today.gold) || (yesterday && yesterday.tomorrow_gold) || "";
    const payload = JSON.stringify(gold
      ? { title: "Your Gold is waiting", body: gold, url: `${APP_URL}/?from=push` }
      : { title: "Commit to today’s three", body: "Choose what matters. Commit to it. See it through.", url: `${APP_URL}/?from=push` });
    const sr = await sb(`/rest/v1/push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.${p.id}`);
    const subs = sr.ok ? await sr.json() : [];
    let ok = false;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 4 * 3600 });
        ok = true;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { gone++; await sb(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }); }
      }
    }
    if (ok) { sent++; capture("morning_push_sent", p.id, { has_gold: !!gold }); }
  }
  res.status(200).json({ sent, skipped, expired_subscriptions: gone });
};
