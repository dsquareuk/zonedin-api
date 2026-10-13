// POST /api/portal  with  Authorization: Bearer <user token>
// Returns { url } for Stripe's customer portal (change plan, update card, cancel).
const { APP_URL, authUser, stripe, getSub } = require("./_zi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: "payments_not_configured" });
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const sub = await getSub(user.id);
  if (!sub || !sub.stripe_customer_id) return res.status(404).json({ error: "no_customer" });
  try {
    const s = await stripe("billing_portal/sessions", { customer: sub.stripe_customer_id, return_url: `${APP_URL}/` });
    return res.status(200).json({ url: s.url });
  } catch (e) {
    console.log("portal error:", e.message);
    return res.status(502).json({ error: "portal_failed" });
  }
};
