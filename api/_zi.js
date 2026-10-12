// Shared server helpers (files starting with "_" are not routes on Vercel).
const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";
const APP_URL = process.env.APP_URL || "https://zonedin-api.vercel.app";
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}${path}`, {
  ...init,
  headers: { apikey: SERVICE(), Authorization: `Bearer ${SERVICE()}`, "Content-Type": "application/json", ...(init.headers || {}) }
});

// Who is calling? Verified by Supabase from the user's own access token.
async function authUser(req) {
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+\S+$/.test(auth) || !SERVICE()) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE(), Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// Stripe REST without the SDK. body is a flat object of form fields.
async function stripe(path, body, method) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? new URLSearchParams(body).toString() : undefined
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.error && data.error.message) || `stripe ${r.status}`);
  return data;
}

async function getSub(userId) {
  const r = await sb(`/rest/v1/subscriptions?user_id=eq.${userId}&select=*`);
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

async function upsertSub(row) {
  return sb(`/rest/v1/subscriptions?on_conflict=user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() })
  });
}

const ACTIVE = ["active", "trialing", "past_due", "comp"];
const isActive = (s) => !!(s && ACTIVE.includes(s.status));

const readJson = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; }
};

module.exports = { SUPABASE_URL, APP_URL, sb, authUser, stripe, getSub, upsertSub, isActive, readJson };
