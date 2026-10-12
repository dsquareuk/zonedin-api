// Stripe → ZonedIn. Keeps public.subscriptions in step with Stripe.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Stripe dashboard → Developers → Webhooks → endpoint https://<app>/api/stripe-webhook with events:
//   checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
const crypto = require("crypto");
const { stripe, upsertSub, sb } = require("./_zi");

const rawBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

function verify(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)]; }));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

const periodEnd = (s) => {
  const t = s.current_period_end || (s.items && s.items.data && s.items.data[0] && s.items.data[0].current_period_end);
  return t ? new Date(t * 1000).toISOString() : null;
};
const interval = (s) => {
  const it = s.items && s.items.data && s.items.data[0];
  const iv = it && ((it.price && it.price.recurring && it.price.recurring.interval) || (it.plan && it.plan.interval));
  return iv || null;
};

async function userFor(sub) {
  if (sub.metadata && sub.metadata.user_id) return sub.metadata.user_id;
  const r = await sb(`/rest/v1/subscriptions?stripe_customer_id=eq.${encodeURIComponent(sub.customer)}&select=user_id`);
  const rows = r.ok ? await r.json() : [];
  return rows[0] ? rows[0].user_id : null;
}

async function saveSub(sub) {
  const userId = await userFor(sub);
  if (!userId) return;
  await upsertSub({
    user_id: userId,
    status: sub.status,
    plan_interval: interval(sub),
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd(sub),
    cancel_at_period_end: !!sub.cancel_at_period_end
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const raw = await rawBody(req);
  if (!verify(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) return res.status(400).json({ error: "bad signature" });
  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch (_) { return res.status(400).end(); }
  try {
    const o = event.data && event.data.object;
    if (event.type === "checkout.session.completed" && o && o.subscription) {
      const sub = await stripe(`subscriptions/${o.subscription}`);
      if (!sub.metadata || !sub.metadata.user_id) sub.metadata = { ...(sub.metadata || {}), user_id: o.client_reference_id };
      await saveSub(sub);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type) && o) {
      await saveSub(o);
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.log("webhook error:", e.message);
    return res.status(500).json({ error: "webhook_failed" });
  }
};
