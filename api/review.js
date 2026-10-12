// POST /api/review  { kind: "two_week" | "monthly" }  with  Authorization: Bearer <user token>
// Builds the user's review from their own records (server-side, so numbers can't be invented),
// asks Claude for a forward-looking read, stores it in public.reviews and returns it.
// Two-week review: once, from trial day 14. Monthly: subscribers, at most every 28 days.
const { sb, authUser, getSub, isActive, readJson } = require("./_zi");

const TZ_FALLBACK = "Europe/London";
const localDay = (d, tz) => {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
};
const localHour = (d, tz) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.UTC(...b.split("-").map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...a.split("-").map((v, i) => i === 1 ? v - 1 : +v))) / 864e5);
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekday = (s) => WD[new Date(s + "T12:00:00Z").getUTCDay()];
const pct = (k, n) => (n ? Math.round((k / n) * 100) : null);
const bucketOf = (h) => (h < 9 ? "before 9am" : h < 12 ? "9am to noon" : h < 17 ? "the afternoon" : "the evening");

// Pure: turn zones + sessions into review stats. Exported for tests.
function buildStats(zones, sessions, start, end, tz) {
  const days = diffDays(start, end) + 1;
  const inRange = zones.filter((z) => z.date >= start && z.date <= end);
  const committed = inRange.filter((z) => z.committed_at);
  const goldKept = committed.filter((z) => z.outcomes && z.outcomes.gold === "kept").length;
  let commitments = 0, kept = 0;
  committed.forEach((z) => Object.values(z.outcomes || {}).forEach((o) => { commitments++; if (o === "kept") kept++; }));

  const byBucket = {}, byDay = {};
  committed.forEach((z) => {
    const b = bucketOf(localHour(new Date(z.committed_at), tz));
    const w = weekday(z.date);
    const g = z.outcomes && z.outcomes.gold === "kept" ? 1 : 0;
    (byBucket[b] = byBucket[b] || { n: 0, k: 0 }).n++; byBucket[b].k += g;
    (byDay[w] = byDay[w] || { n: 0, k: 0 }).n++; byDay[w].k += g;
  });
  const rank = (o) => Object.entries(o).filter(([, v]) => v.n >= 2).map(([k, v]) => ({ name: k, n: v.n, kept: v.k, rate: pct(v.k, v.n) })).sort((a, b) => b.rate - a.rate || b.n - a.n);
  const buckets = rank(byBucket), wdays = rank(byDay);

  // Weekdays with no commitment at all in the period.
  const allDates = []; for (let i = 0; i < days; i++) allDates.push(addDays(start, i));
  const committedSet = new Set(committed.map((z) => z.date));
  const missedByWeekday = {};
  allDates.filter((d) => !committedSet.has(d)).forEach((d) => { const w = weekday(d); missedByWeekday[w] = (missedByWeekday[w] || 0) + 1; });
  const mostMissed = Object.entries(missedByWeekday).sort((a, b) => b[1] - a[1])[0] || null;

  // Focus sessions on Gold vs kept rate.
  const sess = sessions.filter((s) => s.date >= start && s.date <= end && !s.reckoned_without_session);
  const goldSessionDates = new Set(sess.filter((s) => (s.zone_key || "gold") === "gold").map((s) => s.date));
  const withS = committed.filter((z) => goldSessionDates.has(z.date)), withoutS = committed.filter((z) => !goldSessionDates.has(z.date));
  const keptRate = (arr) => pct(arr.filter((z) => z.outcomes && z.outcomes.gold === "kept").length, arr.length);
  const focusMinutes = sess.reduce((a, s) => a + (s.minutes || 0), 0);
  const breaks = sess.filter((s) => s.focus_breaks != null);

  // Longest run of consecutive days with Gold kept.
  let run = 0, best = 0;
  allDates.forEach((d) => { const z = committed.find((x) => x.date === d); if (z && z.outcomes && z.outcomes.gold === "kept") { run++; best = Math.max(best, run); } else run = 0; });

  // Forecast for the next 14 days: if nothing changes, and if they follow their best pattern.
  const commitRate = committed.length / days;
  const goldRate = committed.length ? goldKept / committed.length : 0;
  const baseline = Math.round(14 * commitRate * goldRate);
  const bestRate = buckets[0] ? buckets[0].rate / 100 : goldRate;
  const reachableDays = Math.min(14, Math.round(14 * commitRate) + (mostMissed ? Math.min(2, Math.round(mostMissed[1] * 14 / days)) : 0));
  // Credible, not hopeful: close half the gap to their best pattern, and never promise more than +4.
  const improvedRate = goldRate + 0.5 * Math.max(0, bestRate - goldRate);
  const improved = Math.min(14, baseline + 4, Math.max(baseline, Math.round(reachableDays * improvedRate)));

  return {
    period: { start, end, days },
    committed_days: committed.length,
    gold_kept: goldKept,
    commitments, kept, kept_rate: pct(kept, commitments), gold_rate: pct(goldKept, committed.length),
    best_run: best,
    best_time: buckets[0] || null, worst_time: buckets.length > 1 ? buckets[buckets.length - 1] : null,
    best_weekday: wdays[0] || null, worst_weekday: wdays.length > 1 ? wdays[wdays.length - 1] : null,
    most_missed_weekday: mostMissed ? { name: mostMissed[0], days: mostMissed[1] } : null,
    focus: { sessions: sess.length, minutes: focusMinutes, avg_breaks: breaks.length ? +(breaks.reduce((a, s) => a + s.focus_breaks, 0) / breaks.length).toFixed(1) : null,
             kept_with_session: keptRate(withS), kept_without_session: keptRate(withoutS), n_with: withS.length, n_without: withoutS.length },
    forecast: { next_days: 14, baseline_gold_kept: baseline, improved_gold_kept: improved },
    enough_data: committed.length >= 5
  };
}

function prompt(stats, ctx, kind) {
  const golds = ctx.golds.slice(-10).map((g) => `- ${g.date}: "${g.gold}" (${g.outcome})`).join("\n");
  return `You are ZonedIn's reviewer. ZonedIn helps people cut through the noise, commit to their top three tasks each day (Gold, Diamond, Platinum) and see them through. Brand line: "Clarity beats chaos." Tone: warm, direct, specific, never shaming, British English, no emojis.

This is the user's ${kind === "two_week" ? "first two-week review" : "monthly review"}. Name: ${ctx.name || "unknown"}. ${ctx.identity ? `They want to become: "${ctx.identity}".` : ""}

THEIR NUMBERS (calculated from their records; use only these, never invent figures):
${JSON.stringify(stats)}

THEIR RECENT GOLD COMMITMENTS:
${golds || "(none)"}

Write a review that looks FORWARD. The point is to predict how they can get more done in the next 14 days, based on the patterns above. Use forecast.baseline_gold_kept (if nothing changes) and forecast.improved_gold_kept (if they follow their best pattern) as the prediction. If enough_data is false, say plainly there isn't enough yet for patterns and give one concrete step to build the data.

Return ONLY valid JSON with exactly these keys:
{
 "headline": "one short line naming their result, e.g. '11 of 14 days, Gold kept.'",
 "what_worked": ["2 short, specific observations from the numbers or their own Gold wording"],
 "pattern": "one sentence naming the single most useful pattern (time of day, weekday, or focus sessions)",
 "prediction": "one or two sentences: where the next 14 days land if nothing changes vs if they act on the pattern, using the two forecast numbers",
 "next_14_days": ["3 concrete, forward-looking actions for the next two weeks, each tied to a pattern above, each under 20 words"],
 "one_line": "a closing line in the brand voice"
}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  const { kind } = await readJson(req);
  if (!["two_week", "monthly"].includes(kind)) return res.status(400).json({ error: "bad kind" });

  const [pr, rv] = await Promise.all([
    sb(`/rest/v1/profiles?id=eq.${user.id}&select=created_at,user_timezone,user_name,identity_statement`).then((r) => r.json()),
    sb(`/rest/v1/reviews?user_id=eq.${user.id}&select=kind,created_at&order=created_at.desc&limit=20`).then((r) => r.json())
  ]);
  const profile = Array.isArray(pr) && pr[0];
  if (!profile) return res.status(404).json({ error: "no profile" });
  const tz = profile.user_timezone && profile.user_timezone !== "UTC" ? profile.user_timezone : TZ_FALLBACK;
  const today = localDay(new Date(), tz);
  const trialDay = diffDays(localDay(new Date(profile.created_at), tz), today) + 1;
  const reviews = Array.isArray(rv) ? rv : [];

  let start, end;
  if (kind === "two_week") {
    if (reviews.some((r) => r.kind === "two_week")) return res.status(409).json({ error: "already_done" });
    if (trialDay < 14) return res.status(403).json({ error: "too_early", trial_day: trialDay });
    end = today; start = addDays(today, -13);
  } else {
    if (!isActive(await getSub(user.id))) return res.status(402).json({ error: "subscription_required" });
    const last = reviews[0];
    if (last && (Date.now() - new Date(last.created_at).getTime()) < 28 * 864e5) return res.status(409).json({ error: "not_due" });
    end = today; start = addDays(today, -29);
  }

  const [zones, sessions] = await Promise.all([
    sb(`/rest/v1/zones?user_id=eq.${user.id}&date=gte.${start}&date=lte.${end}&select=date,gold,committed_at,outcomes`).then((r) => r.json()),
    sb(`/rest/v1/sessions?user_id=eq.${user.id}&date=gte.${start}&date=lte.${end}&select=date,zone_key,minutes,focus_breaks,reckoned_without_session`).then((r) => r.json())
  ]);
  const zs = Array.isArray(zones) ? zones : [], ss = Array.isArray(sessions) ? sessions : [];
  const stats = buildStats(zs, ss, start, end, tz);
  const golds = zs.filter((z) => z.committed_at && z.gold).sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((z) => ({ date: z.date, gold: String(z.gold).slice(0, 120), outcome: (z.outcomes && z.outcomes.gold) === "kept" ? "kept" : (z.outcomes && z.outcomes.gold) === "not_kept" ? "not kept" : "not reckoned" }));

  let content = null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 900, messages: [{ role: "user", content: prompt(stats, { golds, name: profile.user_name, identity: profile.identity_statement }, kind) }] })
    });
    const data = await r.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) content = JSON.parse(m[0]);
  } catch (e) { console.log("review ai error:", e.message); }

  if (!content || !content.headline) {
    // Plain fallback built from the numbers, so the review always arrives.
    const s = stats;
    content = {
      headline: `${s.gold_kept} of ${s.period.days} days, Gold kept.`,
      what_worked: [s.best_time ? `Your Gold was kept ${s.best_time.rate}% of the time when you committed ${s.best_time.name}.` : `You committed on ${s.committed_days} of ${s.period.days} days.`, s.best_run ? `Your longest run was ${s.best_run} days in a row.` : "You've started building a record."],
      pattern: s.best_time ? `Committing ${s.best_time.name} is your strongest pattern.` : "Commit at the same time each day to find your pattern.",
      prediction: `If nothing changes, expect about ${s.forecast.baseline_gold_kept} Golds kept in the next 14 days. Act on your pattern and ${s.forecast.improved_gold_kept} is within reach.`,
      next_14_days: [s.best_time ? `Commit to your Gold ${s.best_time.name} every day.` : "Commit to your Gold before 9am.", s.most_missed_weekday ? `Set a reminder for ${s.most_missed_weekday.name}s, your most-missed day.` : "Close every day, even the hard ones.", "Start a focus session on your Gold before anything else."],
      one_line: "Clarity beats chaos."
    };
  }

  const ins = await sb(`/rest/v1/reviews`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: user.id, kind, period_start: start, period_end: end, stats, content }) });
  const saved = ins.ok ? (await ins.json())[0] : null;
  if (!saved) return res.status(409).json({ error: "already_done" });
  return res.status(200).json({ review: saved });
};

module.exports.buildStats = buildStats;
