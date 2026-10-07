// DL-13 — open pixel (close_email_opened) and one-click unsubscribe (close_email_opt_in = false).
// Links are signed with CRON_SECRET so nobody can unsubscribe someone else.
const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";
const POSTHOG_KEY = "phc_yS3gvBMbLsgRe9YrUTmEUqPfHyFQP4pKuTbgfv7YdVmf";
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const valid = (u, s) => {
  if (!u || !s || !process.env.CRON_SECRET || !/^[0-9a-f-]{36}$/i.test(u)) return false;
  const expect = crypto.createHmac("sha256", process.env.CRON_SECRET).update(u).digest("hex").slice(0, 32);
  return s.length === expect.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect));
};

module.exports = async function handler(req, res) {
  const { a, u, s } = req.query || {};
  const ok = valid(String(u || ""), String(s || ""));
  if (a === "open") {
    if (ok) await fetch("https://eu.i.posthog.com/capture/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: POSTHOG_KEY, event: "close_email_opened", distinct_id: u }) }).catch(() => {});
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(GIF);
  }
  if (a === "unsub") {
    if (!ok) return res.status(400).send("Invalid link.");
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${u}`, {
      method: "PATCH",
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ close_email_opt_in: false })
    });
    await fetch("https://eu.i.posthog.com/capture/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: POSTHOG_KEY, event: "close_email_unsubscribed", distinct_id: u }) }).catch(() => {});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#0a0e14;color:#F0F4F8;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px"><div><h2>You're unsubscribed.</h2><p style="color:#8a929c">No more evening emails. You can turn them back on in Progress &rarr; Settings.</p></div></body>`);
  }
  res.status(404).end();
};
