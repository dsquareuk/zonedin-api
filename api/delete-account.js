// Delete the signed-in user's account (the sign-in itself).
// POST /api/delete-account  with  Authorization: Bearer <user access token>
// The app deletes the user's rows first; this removes the auth user so nothing is left behind.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://takormabbagvdckpxpox.supabase.co";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: "missing env vars" });
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+\S+$/.test(auth)) return res.status(401).json({ error: "unauthorized" });

  // Who is asking? Verified by Supabase from their own access token.
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } });
  if (!who.ok) return res.status(401).json({ error: "unauthorized" });
  const user = await who.json();
  if (!user || !user.id) return res.status(401).json({ error: "unauthorized" });

  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  // Belt and braces: remove any rows the app couldn't (e.g. a dropped connection mid-delete).
  for (const [table, col] of [["sessions", "user_id"], ["zones", "user_id"], ["insights", "user_id"], ["push_subscriptions", "user_id"], ["profiles", "id"]]) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${user.id}`, { method: "DELETE", headers: h }).catch(() => {});
  }
  const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: h });
  if (!del.ok) return res.status(502).json({ error: "could not delete sign-in" });
  return res.status(200).json({ ok: true });
};
