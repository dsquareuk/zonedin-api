// POST /api/checkout  { interval: "year" | "month" }  with  Authorization: Bearer <user token>
// Returns { url } for Stripe Checkout. Env: STRIPE_SECRET_KEY, STRIPE_PRICE_YEARLY, STRIPE_PRICE_MONTHLY.
const { APP_URL, authUser, stripe, getSub, upsertSub, isActive, readJson } = require("./_zi");

module.exports = async function handler(req, res) {
  // GET: is the paywall live? (No secrets returned.)
  if (req.method === "GET") return res.status(200).json({ enabled: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_YEARLY && process.env.STRIPE_PRICE_MONTHLY && process.env.STRIPE_WEBHOOK_SECRET) });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_YEARLY || !process.env.STRIPE_PRICE_MONTHLY) {
    return res.status(503).json({ error: "payments_not_configured" });
  }
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const { interval } = await readJson(req);
  const price = interval === "month" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_YEARLY;

  try {
    const sub = await getSub(user.id);
    if (isActive(sub)) return res.status(409).json({ error: "already_subscribed" });
    let customer = sub && sub.stripe_customer_id;
    if (!customer) {
      const c = await stripe("customers", { email: user.email || "", "metadata[user_id]": user.id });
      customer = c.id;
      await upsertSub({ user_id: user.id, stripe_customer_id: customer, status: (sub && sub.status) || "none" });
    }
    const session = await stripe("checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "metadata[user_id]": user.id,
      "subscription_data[metadata][user_id]": user.id,
      success_url: `${APP_URL}/?paid=1`,
      cancel_url: `${APP_URL}/?paywall=1`
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.log("checkout error:", e.message);
    return res.status(502).json({ error: "checkout_failed" });
  }
};
