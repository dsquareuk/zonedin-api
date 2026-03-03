import { useState, useEffect, useRef, useCallback } from "react";

// ── milestone helpers ──────────────────────────────────────────────────────────
const MILESTONES = [7, 14, 30, 60, 90, 120, 150, 200];
function getNextMilestone(s) {
  const f = MILESTONES.find(m => m > s);
  return f ?? Math.ceil((s + 1) / 50) * 50;
}
function getMilestoneProgress(s) {
  const next = getNextMilestone(s);
  const prevList = MILESTONES.filter(m => m <= s);
  let prev = prevList.length ? prevList[prevList.length - 1] : 0;
  if (s >= 200) prev = Math.floor(s / 50) * 50;
  return { next, pct: Math.max(0, Math.min(100, ((s - prev) / (next - prev)) * 100)), daysLeft: next - s };
}

// ── tier helpers ───────────────────────────────────────────────────────────────
const TIER_CONFIG = {
  platinum: { label: "Platinum Streak", emoji: "🏆", color: "#A78BFA", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.35)", multiplier: 1.5  },
  diamond:  { label: "Diamond Streak",  emoji: "💎", color: "#60A5FA", bg: "rgba(96,165,250,0.10)",  border: "rgba(96,165,250,0.35)",  multiplier: 1.25 },
  gold:     { label: "Gold Streak",     emoji: "🥇", color: "#F59E0B", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.35)",  multiplier: 1.1  },
  none:     { label: "No Streak",       emoji: "—",  color: "#9CA3AF", bg: "rgba(156,163,175,0.06)", border: "rgba(156,163,175,0.2)",  multiplier: 1.0  },
};
function getStreakTier(cz) {
  const g = cz.includes("gold"), d = cz.includes("diamond"), p = cz.includes("platinum");
  if (g && d && p) return "platinum";
  if (g && d)      return "diamond";
  if (g)           return "gold";
  return "none";
}

// ── levels & points ────────────────────────────────────────────────────────────
const LEVELS = [
  { name: "Zone Novice",    min: 0,    badge: "🌱" },
  { name: "Zone Builder",   min: 200,  badge: "🔨" },
  { name: "Zone Pro",       min: 600,  badge: "⚡" },
  { name: "Zone Elite",     min: 1400, badge: "💎" },
  { name: "ZonedIn Master", min: 3000, badge: "👑" },
];
function getLevel(pts) {
  let level = LEVELS[0];
  for (const l of LEVELS) { if (pts >= l.min) level = l; }
  const idx = LEVELS.indexOf(level);
  const next = LEVELS[idx + 1] ?? null;
  const pct = next ? Math.min(100, ((pts - level.min) / (next.min - level.min)) * 100) : 100;
  return { ...level, idx, next, pct, ptsToNext: next ? next.min - pts : 0 };
}
function calcDayPoints(cz, extraSessions, sessionCompleted, hasReflection, hasInsight, hasMoodEnergy, tier) {
  let base = 0;
  const g = cz.includes("gold"), d = cz.includes("diamond"), p = cz.includes("platinum");
  if (g)       base += 10;
  if (g && d)  base += 20;
  if (g && d && p) base += 50;
  if (sessionCompleted) base += 5; else if (g) base += 2;
  if (extraSessions > 0) base += extraSessions * 3;
  if (hasReflection)  base += 10;
  if (hasInsight)     base += 5;
  if (hasMoodEnergy)  base += 3;
  return Math.round(base * (TIER_CONFIG[tier]?.multiplier ?? 1));
}

// ── utils ──────────────────────────────────────────────────────────────────────
function fmt(secs) {
  return `${String(Math.floor(secs / 60)).padStart(2,"0")}:${String(secs % 60).padStart(2,"0")}`;
}
const LS = {
  get: (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const todayStr   = () => new Date().toDateString();
const todayShort = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ── constants ──────────────────────────────────────────────────────────────────
const MOTIVATIONAL = [
  "One zone. One signal. Stay locked.",
  "Clarity is earned one minute at a time.",
  "The zone doesn't care about distractions. Neither should you.",
  "Momentum builds in silence.",
  "Every second here is a second ahead.",
  "Deep work is the competitive advantage.",
  "Zone in. The world can wait.",
];
const ONBOARDING = [
  { emoji: "🗺️", title: "Map Your Zones",  body: "Set three focused tasks each day. Gold is your must-do, Diamond is high-impact, Platinum is your stretch win. Tap a zone card to activate it." },
  { emoji: "🔥", title: "Zone In",          body: "Start a timed focus session on your active zone. The app locks out distractions so you can do your best work. Choose 15 to 90 minutes." },
  { emoji: "🧠", title: "Close the Loop",   body: "After each day, reflect on what went well. Claude analyses your patterns and tells you exactly what worked and what to try next." },
];

// ── sub-components ─────────────────────────────────────────────────────────────
function ZonedInMark({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="26" stroke="#1B1F23" strokeWidth="4" />
      <circle cx="32" cy="32" r="16" stroke="#00C2B2" strokeWidth="6" />
      <circle cx="32" cy="32" r="7"  fill="#1B1F23" />
      <text x="32" y="36" textAnchor="middle" fontSize="12" fontWeight="800" fill="#F9FAFB"
        style={{ fontFamily: '"Outfit",ui-sans-serif' }}>Z</text>
    </svg>
  );
}

function Onboarding({ onComplete, dark }) {
  const [step, setStep] = useState(0);
  const s = ONBOARDING[step];
  const bg  = dark ? "#161b22" : "#fff";
  const fg  = dark ? "#F9FAFB" : "#1B1F23";
  const sub = dark ? "rgba(249,250,251,0.55)" : "rgba(27,31,35,0.6)";
  const dot = dark ? "rgba(255,255,255,0.12)" : "#E2E8ED";
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:'"Outfit",ui-sans-serif' }}>
      <div style={{ background:bg,borderRadius:24,padding:"40px 32px",maxWidth:380,width:"100%",boxShadow:"0 24px 80px rgba(0,0,0,0.3)",textAlign:"center" }}>
        <div style={{ fontSize:56,marginBottom:16 }}>{s.emoji}</div>
        <h2 style={{ margin:"0 0 10px",fontSize:22,fontWeight:900,color:fg,letterSpacing:-0.5 }}>{s.title}</h2>
        <p  style={{ margin:"0 0 28px",fontSize:14,color:sub,lineHeight:1.75 }}>{s.body}</p>
        <div style={{ display:"flex",justifyContent:"center",gap:6,marginBottom:24 }}>
          {ONBOARDING.map((_,i)=>(
            <div key={i} style={{ width:i===step?20:6,height:6,borderRadius:99,background:i===step?"#00C2B2":dot,transition:"all 0.3s" }} />
          ))}
        </div>
        <button onClick={()=>step<ONBOARDING.length-1?setStep(x=>x+1):onComplete()} style={{ width:"100%",padding:"14px",borderRadius:50,border:"none",background:"#00C2B2",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:'"Outfit",ui-sans-serif' }}>
          {step<ONBOARDING.length-1?"Next →":"Let's Zone In ✦"}
        </button>
        {step<ONBOARDING.length-1&&<button onClick={onComplete} style={{ marginTop:12,background:"none",border:"none",color:sub,fontSize:13,cursor:"pointer",fontFamily:'"Outfit",ui-sans-serif' }}>Skip</button>}
      </div>
    </div>
  );
}

function SessionLock({ secondsLeft, activeZone, onEnd, sessionDuration }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const pct = 1 - secondsLeft / (sessionDuration * 60);
  const r = 54, circ = 2 * Math.PI * r;
  useEffect(() => {
    const id = setInterval(() => setMsgIdx(i => (i+1) % MOTIVATIONAL.length), 8000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9999,background:"linear-gradient(135deg,#0d1117 0%,#0a1a1a 60%,#001a18 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:32,fontFamily:'"Outfit",ui-sans-serif' }}>
      <div style={{ position:"relative",width:160,height:160 }}>
        <svg width="160" height="160" viewBox="0 0 120 120" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle cx="60" cy="60" r={r} fill="none" stroke="#00C2B2" strokeWidth="6"
            strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round"
            style={{ transition:"stroke-dashoffset 1s linear" }} />
        </svg>
        <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
          <span style={{ fontSize:32,fontWeight:800,color:"#F9FAFB",letterSpacing:-1 }}>{fmt(secondsLeft)}</span>
          <span style={{ fontSize:11,color:"#00C2B2",fontWeight:600,letterSpacing:2,textTransform:"uppercase" }}>remaining</span>
        </div>
      </div>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:11,color:"#00C2B2",fontWeight:700,letterSpacing:3,textTransform:"uppercase",marginBottom:8 }}>Active Zone</div>
        <div style={{ fontSize:22,fontWeight:800,color:"#F9FAFB",maxWidth:320,lineHeight:1.3 }}>{activeZone}</div>
      </div>
      <div style={{ maxWidth:340,textAlign:"center",fontSize:15,color:"rgba(249,250,251,0.55)",lineHeight:1.6,fontStyle:"italic",minHeight:48 }}>"{MOTIVATIONAL[msgIdx]}"</div>
      <button onClick={onEnd}
        onPointerEnter={e=>e.currentTarget.style.background="rgba(0,194,178,0.12)"}
        onPointerLeave={e=>e.currentTarget.style.background="transparent"}
        style={{ marginTop:8,padding:"14px 40px",borderRadius:50,border:"1.5px solid rgba(0,194,178,0.4)",background:"transparent",color:"#00C2B2",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:1,fontFamily:'"Outfit",ui-sans-serif' }}>
        End Session
      </button>
    </div>
  );
}

function SessionComplete({ session, onDismiss, dark }) {
  const bg     = dark ? "#161b22" : "#fff";
  const fg     = dark ? "#F9FAFB" : "#1B1F23";
  const sub    = dark ? "rgba(249,250,251,0.55)" : "rgba(27,31,35,0.55)";
  const cardBg = dark ? "rgba(255,255,255,0.05)" : "#F4F6F8";
  return (
    <div style={{ position:"fixed",inset:0,zIndex:9998,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:'"Outfit",ui-sans-serif' }}>
      <div style={{ background:bg,borderRadius:24,padding:"40px 32px",maxWidth:380,width:"100%",textAlign:"center",boxShadow:"0 24px 80px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize:56,marginBottom:10 }}>{session.completed?"🎯":"⏹️"}</div>
        <h2 style={{ margin:"0 0 6px",fontSize:22,fontWeight:900,color:fg,letterSpacing:-0.5 }}>{session.completed?"Zone Complete!":"Session Ended"}</h2>
        <p  style={{ margin:"0 0 24px",fontSize:14,color:sub,lineHeight:1.6 }}>{session.completed?"You locked in and delivered. Brilliant.":"Good work — every minute in the zone counts."}</p>
        <div style={{ display:"flex",gap:10,marginBottom:24 }}>
          <div style={{ flex:1,padding:"16px",borderRadius:14,background:cardBg,textAlign:"center" }}>
            <div style={{ fontSize:28,fontWeight:900,color:"#00C2B2",letterSpacing:-1 }}>{session.minutes}</div>
            <div style={{ fontSize:12,color:sub,fontWeight:600,marginTop:2 }}>minutes</div>
          </div>
          <div style={{ flex:2,padding:"16px",borderRadius:14,background:cardBg,textAlign:"left" }}>
            <div style={{ fontSize:20,marginBottom:4 }}>{session.emoji}</div>
            <div style={{ fontSize:13,color:fg,fontWeight:700,lineHeight:1.3 }}>{session.zone}</div>
          </div>
        </div>
        <div style={{ padding:"12px 16px",borderRadius:12,background:"rgba(0,194,178,0.08)",border:"1px solid rgba(0,194,178,0.2)",marginBottom:20 }}>
          <p style={{ margin:0,fontSize:13,color:sub,lineHeight:1.6 }}>Head to <strong style={{ color:"#00C2B2" }}>Close the Loop ↓</strong> to reflect and get a personalised Claude insight.</p>
        </div>
        <button onClick={onDismiss} style={{ width:"100%",padding:"14px",borderRadius:50,border:"none",background:"#00C2B2",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:'"Outfit",ui-sans-serif' }}>Back to ZonedIn →</button>
      </div>
    </div>
  );
}

// ── main app ───────────────────────────────────────────────────────────────────
export default function ZonedInMVP() {
  const [darkMode, setDarkMode] = useState(() => LS.get("zi_dark", false));

  const brand = {
    teal:"#00C2B2", tealHover:"#00A89E",
    charcoal: darkMode ? "#F9FAFB"                    : "#1B1F23",
    bg:       darkMode ? "#0d1117"                    : "#F4F6F8",
    accent:   "#FFD66B",
    card:     darkMode ? "#161b22"                    : "#FFFFFF",
    border:   darkMode ? "rgba(255,255,255,0.08)"     : "#E2E8ED",
    tealTint: "rgba(0,194,178,0.07)",
    subText:  darkMode ? "rgba(249,250,251,0.5)"      : "rgba(27,31,35,0.55)",
    inputBg:  darkMode ? "rgba(255,255,255,0.05)"     : "#FAFBFC",
  };

  // ── persisted state ──────────────────────────────────────────────────────────
  const [streak,            setStreak]           = useState(() => LS.get("zi_streak",           0));
  const [lastStreakDate,    setLastStreakDate]    = useState(() => LS.get("zi_streak_date",      null));
  const [goldZone,          setGoldZone]         = useState(() => LS.get("zi_gold",             ""));
  const [diamondZone,       setDiamondZone]      = useState(() => LS.get("zi_diamond",          ""));
  const [platinumZone,      setPlatinumZone]     = useState(() => LS.get("zi_platinum",         ""));
  const [zoneLastSet,       setZoneLastSet]      = useState(() => LS.get("zi_zone_date",        null));
  const [completedZones,    setCompletedZones]   = useState(() => LS.get("zi_completed_zones",  []));
  const [wentWell,          setWentWell]         = useState(() => LS.get("zi_went_well",        ""));
  const [insightHistory,    setInsightHistory]   = useState(() => LS.get("zi_insight_history",  []));
  const [energy,            setEnergy]           = useState(() => LS.get("zi_energy",           3));
  const [mood,              setMood]             = useState(() => LS.get("zi_mood",             null));
  const [sessionHistory,    setSessionHistory]   = useState(() => LS.get("zi_history",          []));
  const [activeZoneKey,     setActiveZoneKey]    = useState(() => LS.get("zi_active_zone_key",  "gold"));
  const [streakReport,      setStreakReport]     = useState(() => LS.get("zi_streak_report",    ""));
  const [hasOnboarded,      setHasOnboarded]     = useState(() => LS.get("zi_onboarded",        false));
  const [totalPoints,       setTotalPoints]      = useState(() => LS.get("zi_points",           0));
  const [streakTier,        setStreakTier]       = useState(() => LS.get("zi_streak_tier",      "none"));
  const [tierHistory,       setTierHistory]      = useState(() => LS.get("zi_tier_history",     []));
  const [todayPointsLogged, setTodayPointsLogged]= useState(() => LS.get("zi_points_date",      null));

  // ── ui state ─────────────────────────────────────────────────────────────────
  const [sessionActive,      setSessionActive]      = useState(false);
  const [secondsLeft,        setSecondsLeft]        = useState(90 * 60);
  const [sessionDuration,    setSessionDuration]    = useState(90);
  const [lastSession,        setLastSession]        = useState(null);
  const [loadingInsight,     setLoadingInsight]     = useState(false);
  const [insightError,       setInsightError]       = useState("");
  const [loadingStreakReport,setLoadingStreakReport] = useState(false);
  const [historyExpanded,    setHistoryExpanded]    = useState(false);
  const [showInsightHistory, setShowInsightHistory] = useState(false);
  const intervalRef = useRef(null);

  // ── persist ───────────────────────────────────────────────────────────────────
  useEffect(() => { LS.set("zi_dark",            darkMode);         }, [darkMode]);
  useEffect(() => { LS.set("zi_streak",           streak);           }, [streak]);
  useEffect(() => { LS.set("zi_streak_date",      lastStreakDate);   }, [lastStreakDate]);
  useEffect(() => { LS.set("zi_gold",             goldZone);        }, [goldZone]);
  useEffect(() => { LS.set("zi_diamond",          diamondZone);     }, [diamondZone]);
  useEffect(() => { LS.set("zi_platinum",         platinumZone);    }, [platinumZone]);
  useEffect(() => { LS.set("zi_zone_date",        zoneLastSet);     }, [zoneLastSet]);
  useEffect(() => { LS.set("zi_completed_zones",  completedZones);  }, [completedZones]);
  useEffect(() => { LS.set("zi_went_well",        wentWell);        }, [wentWell]);
  useEffect(() => { LS.set("zi_insight_history",  insightHistory);  }, [insightHistory]);
  useEffect(() => { LS.set("zi_energy",           energy);          }, [energy]);
  useEffect(() => { LS.set("zi_mood",             mood);            }, [mood]);
  useEffect(() => { LS.set("zi_history",          sessionHistory);  }, [sessionHistory]);
  useEffect(() => { LS.set("zi_active_zone_key",  activeZoneKey);   }, [activeZoneKey]);
  useEffect(() => { LS.set("zi_streak_report",    streakReport);    }, [streakReport]);
  useEffect(() => { LS.set("zi_points",           totalPoints);     }, [totalPoints]);
  useEffect(() => { LS.set("zi_streak_tier",      streakTier);      }, [streakTier]);
  useEffect(() => { LS.set("zi_tier_history",     tierHistory);     }, [tierHistory]);
  useEffect(() => { LS.set("zi_points_date",      todayPointsLogged);}, [todayPointsLogged]);

  // ── daily reset ───────────────────────────────────────────────────────────────
  const needsDailyReset = zoneLastSet && zoneLastSet !== todayStr();
  const handleDailyReset = () => {
    setGoldZone(""); setDiamondZone(""); setPlatinumZone("");
    setCompletedZones([]); setWentWell(""); setMood(null); setEnergy(3);
    setStreakTier("none"); setZoneLastSet(todayStr());
  };

  // ── zone config ───────────────────────────────────────────────────────────────
  const markZoneSet = () => { if (!zoneLastSet) setZoneLastSet(todayStr()); };
  const zoneConfig = [
    { key:"gold",     val:goldZone,     set:v=>{setGoldZone(v);    markZoneSet();}, label:"Gold Zone",     sublabel:"must-do",     emoji:"🥇", color:"#F59E0B", bg:darkMode?"rgba(245,158,11,0.12)":"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.35)", placeholder:"e.g. Finish the client proposal"      },
    { key:"diamond",  val:diamondZone,  set:v=>{setDiamondZone(v); markZoneSet();}, label:"Diamond Zone",  sublabel:"high impact", emoji:"💎", color:"#60A5FA", bg:darkMode?"rgba(96,165,250,0.12)":"rgba(96,165,250,0.08)",   border:"rgba(96,165,250,0.35)",  placeholder:"e.g. Review and respond to key emails" },
    { key:"platinum", val:platinumZone, set:v=>{setPlatinumZone(v);markZoneSet();}, label:"Platinum Zone", sublabel:"stretch win",  emoji:"🏆", color:"#A78BFA", bg:darkMode?"rgba(167,139,250,0.12)":"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.35)",placeholder:"e.g. Start the new product research doc" },
  ];

  const activeZone      = zoneConfig.find(z => z.key === activeZoneKey);
  const activeZoneLabel = activeZone?.val?.trim() || activeZone?.label || "Gold Zone";
  const isZoneDone      = k => completedZones.includes(k);

  const toggleZoneDone = (e, k) => {
    e.stopPropagation();
    setCompletedZones(prev => {
      const next   = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
      const newTier = getStreakTier(next);
      setStreakTier(newTier);
      const t = todayStr();
      setTierHistory(hist => [{ date:t, tier:newTier }, ...hist.filter(h => h.date !== t)].slice(0, 30));
      return next;
    });
  };

  // ── timer ─────────────────────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    if (!activeZone?.val?.trim()) return;
    setSecondsLeft(sessionDuration * 60);
    setSessionActive(true);
  }, [sessionDuration, activeZone]);

  const endSession = useCallback(() => {
    setSessionActive(false);
    clearInterval(intervalRef.current);
    const completed   = secondsLeft === 0;
    const minutesDone = Math.round((sessionDuration * 60 - secondsLeft) / 60);
    const session = { date:todayShort(), zone:activeZoneLabel, emoji:activeZone?.emoji||"🥇", minutes:minutesDone, completed };
    setSessionHistory(prev => [session, ...prev.slice(0, 19)]);
    setLastSession(session);
    const t = todayStr();
    if (lastStreakDate !== t) { setStreak(s => s + 1); setLastStreakDate(t); }
  }, [secondsLeft, sessionDuration, activeZoneLabel, activeZone, lastStreakDate]);

  useEffect(() => {
    if (sessionActive) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft(s => { if (s <= 1) { endSession(); return 0; } return s - 1; });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [sessionActive, endSession]);

  // ── points ────────────────────────────────────────────────────────────────────
  const logTodayPoints = (hasInsight) => {
    const t = todayStr();
    if (todayPointsLogged === t) return 0;
    const todaySess = sessionHistory.filter(s => s.date === todayShort());
    const pts = calcDayPoints(
      completedZones,
      Math.max(0, todaySess.length - 1),
      todaySess.some(s => s.completed),
      !!wentWell.trim(),
      hasInsight,
      !!(mood && energy),
      streakTier
    );
    setTotalPoints(p => p + pts);
    setTodayPointsLogged(t);
    return pts;
  };

  // ── AI insight ────────────────────────────────────────────────────────────────
  const generateInsight = async () => {
    if (!wentWell.trim()) return;
    setLoadingInsight(true); setInsightError("");
    const zones          = [goldZone, diamondZone, platinumZone].filter(Boolean).join(", ");
    const recentSessions = sessionHistory.slice(0, 5)
      .map(s => `${s.date}: ${s.minutes} min on "${s.zone}" (${s.completed?"completed":"partial"})`).join("\n");
    const prompt = `You are ZonedIn, a sharp productivity coach. Give a personalised insight in exactly two parts:

1. WHAT WORKED: One observation about what they did well — specific, affirming, rooted in their own words.
2. WHAT TO TRY: One concrete, actionable suggestion for tomorrow.

1-2 sentences each. Direct, not generic. No fluff.

Today's zones: ${zones||"not set"}
Went well: ${wentWell}
Energy: ${energy}/5  Mood: ${mood||"not recorded"}
Recent sessions:\n${recentSessions||"No sessions yet"}

Format exactly:
✅ What worked: [observation]
🔧 What to try: [suggestion]`;

    try {
      const res  = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text||"").join("") || "";
      if (text) {
        logTodayPoints(true);
        setInsightHistory(prev => [{ date:todayShort(), text:text.trim(), energy, mood }, ...prev.slice(0,6)]);
      } else setInsightError("No insight returned. Try again.");
    } catch { setInsightError("Couldn't reach Claude. Check your connection."); }
    finally   { setLoadingInsight(false); }
  };

  // ── streak report ─────────────────────────────────────────────────────────────
  const generateStreakReport = async () => {
    setLoadingStreakReport(true);
    const zones       = [goldZone, diamondZone, platinumZone].filter(Boolean);
    const compSess    = sessionHistory.filter(s => s.completed);
    const platDays    = sessionHistory.filter(s => platinumZone && s.zone === platinumZone).length;
    const avgMins     = sessionHistory.length ? Math.round(sessionHistory.reduce((a,s)=>a+s.minutes,0)/sessionHistory.length) : 0;
    const prompt = `You are ZonedIn, a performance coach. ${streak}-day streak analysis.

Data: ${sessionHistory.length} sessions, ${compSess.length} completed, avg ${avgMins} min, ${platDays} platinum days, zones: ${zones.join(", ")||"not set"}

Write 3 punchy sections (no filler):
WHAT'S WORKING: (2 sentences)
YOUR EDGE: (1 sentence)
NEXT 7 DAYS: (2 sentences)`;
    try {
      const res  = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] }),
      });
      const data = await res.json();
      const text = data.content?.map(b=>b.text||"").join("") || "";
      if (text) setStreakReport(text.trim());
    } catch { console.error("Streak report failed"); }
    finally   { setLoadingStreakReport(false); }
  };

  // ── derived ───────────────────────────────────────────────────────────────────
  const isStreakMilestone  = streak > 0 && (MILESTONES.includes(streak) || (streak > 200 && streak % 50 === 0));
  const { next:nextMilestone, pct:milestonePct, daysLeft } = getMilestoneProgress(streak);
  const currentLevel   = getLevel(totalPoints);
  const currentTierCfg = TIER_CONFIG[streakTier] ?? TIER_CONFIG.none;
  const latestInsight  = insightHistory[0];

  // ── styles ────────────────────────────────────────────────────────────────────
  const inputStyle = {
    width:"100%", padding:"12px 14px", borderRadius:12, outline:"none",
    border:`1.5px solid ${brand.border}`, background:brand.inputBg,
    fontSize:14, fontFamily:'"Outfit",ui-sans-serif',
    color:brand.charcoal, boxSizing:"border-box", transition:"border-color 0.2s",
  };
  const cardStyle = {
    background:brand.card, borderRadius:20, padding:"20px 24px",
    border:`1px solid ${brand.border}`, boxShadow:darkMode?"none":"0 2px 12px rgba(0,0,0,0.05)",
  };
  const btnPrimary = {
    background:brand.teal, color:"#fff", border:"none", borderRadius:50,
    padding:"12px 28px", fontWeight:700, fontSize:14, cursor:"pointer",
    fontFamily:'"Outfit",ui-sans-serif', letterSpacing:0.3, transition:"all 0.2s",
  };

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap');
        * { box-sizing:border-box; }
        body { margin:0; background:${brand.bg}; }
        input:focus, textarea:focus { border-color:#00C2B2 !important; box-shadow:0 0 0 3px rgba(0,194,178,0.12); }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes popIn  { 0%{transform:scale(0.92);opacity:0} 100%{transform:scale(1);opacity:1} }
        .card-anim { animation:fadeUp 0.35s ease both; }
        .pop-in    { animation:popIn  0.25s ease both; }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:rgba(0,194,178,0.3); border-radius:99px; }
      `}</style>

      {!hasOnboarded && <Onboarding dark={darkMode} onComplete={()=>{ setHasOnboarded(true); LS.set("zi_onboarded",true); }} />}
      {sessionActive  && <SessionLock secondsLeft={secondsLeft} activeZone={activeZoneLabel} onEnd={endSession} sessionDuration={sessionDuration} />}
      {lastSession && !sessionActive && <SessionComplete session={lastSession} dark={darkMode} onDismiss={()=>setLastSession(null)} />}

      <div style={{ minHeight:"100vh", background:brand.bg, color:brand.charcoal, fontFamily:'"Outfit",ui-sans-serif', padding:"24px 16px" }}>
        <div style={{ maxWidth:680, margin:"0 auto", display:"flex", flexDirection:"column", gap:20 }}>

          {/* ── Header ── */}
          <header className="card-anim" style={cardStyle}>
            <div style={{ display:"flex", alignItems:"flex-end", gap:14 }}>
              <ZonedInMark size={48} />
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                  <h1 style={{ margin:0, fontSize:26, fontWeight:900, letterSpacing:-0.5, lineHeight:1 }}>ZonedIn</h1>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ background:brand.inputBg, border:`1px solid ${brand.border}`, borderRadius:50, padding:"4px 10px", fontSize:12, fontWeight:800, color:brand.teal, whiteSpace:"nowrap" }}>
                      {currentLevel.badge} {currentLevel.name}
                    </span>
                    <button onClick={()=>setDarkMode(d=>!d)} style={{ background:brand.inputBg, border:`1px solid ${brand.border}`, borderRadius:50, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:16 }}>
                      {darkMode?"☀️":"🌙"}
                    </button>
                    <span style={{ background:brand.accent, color:"#1B1F23", fontSize:11, fontWeight:800, padding:"4px 12px", borderRadius:50, whiteSpace:"nowrap" }}>
                      Clarity Beats Chaos
                    </span>
                  </div>
                </div>
                <p style={{ margin:0, fontSize:13, color:brand.subText, fontWeight:500 }}>Zone in. Gain clarity. Level up.</p>
              </div>
            </div>
          </header>

          {/* ── Daily reset banner ── */}
          {needsDailyReset && (
            <div className="card-anim pop-in" style={{ padding:"14px 20px", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", background:darkMode?"rgba(245,158,11,0.1)":"rgba(255,214,107,0.2)", border:"1.5px solid rgba(245,158,11,0.35)" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14 }}>🌅 New day, new zones</div>
                <div style={{ fontSize:12, color:brand.subText, marginTop:2 }}>Yesterday's zones are still saved. Ready to start fresh?</div>
              </div>
              <button onClick={handleDailyReset} style={{ ...btnPrimary, fontSize:12, padding:"8px 18px", background:"#F59E0B", flexShrink:0 }}>Reset Zones</button>
            </div>
          )}

          {/* ── Zone Mapping ── */}
          <section className="card-anim" style={{ ...cardStyle, animationDelay:"0.05s" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>🗺️ Zone Mapping</h2>
              <span style={{ fontSize:11, color:brand.subText, fontWeight:600 }}>Tap a zone to activate</span>
            </div>
            <p style={{ margin:"4px 0 14px", fontSize:13, color:brand.subText }}>Set your three tasks. Tap a card to select your focus zone. Tick ✓ when done.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {zoneConfig.map(({ key, val, set, label, sublabel, emoji, color, bg, border:zb, placeholder }) => {
                const isActive = activeZoneKey === key;
                const isDone   = isZoneDone(key);
                return (
                  <div key={key} onClick={()=>!isDone&&setActiveZoneKey(key)} style={{ borderRadius:14, border:`2px solid ${isDone?brand.border:isActive?color:brand.border}`, background:isDone?brand.inputBg:isActive?bg:brand.inputBg, padding:"12px 14px", cursor:isDone?"default":"pointer", transition:"all 0.2s", boxShadow:isActive&&!isDone?`0 0 0 3px ${zb}`:"none", opacity:isDone?0.55:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                      <span style={{ fontSize:18 }}>{emoji}</span>
                      <div style={{ flex:1 }}>
                        <span style={{ fontWeight:800, fontSize:13, color:isDone?brand.subText:isActive?color:brand.charcoal }}>{label}</span>
                        <span style={{ fontSize:11, color:brand.subText, marginLeft:6 }}>{sublabel}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        {isActive&&!isDone&&<span style={{ fontSize:10, fontWeight:800, letterSpacing:1, textTransform:"uppercase", color, border:`1px solid ${color}`, padding:"2px 8px", borderRadius:50 }}>Active</span>}
                        {(isDone || val.trim()) && (
                          <button onClick={e=>toggleZoneDone(e,key)} title={isDone?"Mark incomplete":"Mark complete"} disabled={!isDone && !val.trim()} style={{ fontSize:15, background:isDone?"rgba(0,194,178,0.1)":"transparent", border:`1.5px solid ${isDone?brand.teal:brand.border}`, borderRadius:8, padding:"3px 7px", cursor:"pointer", transition:"all 0.15s", color:isDone?brand.teal:brand.subText }}>
                            {isDone?"✓":"○"}
                          </button>
                        )}
                      </div>
                    </div>
                    <input type="text" value={val} onChange={e=>{e.stopPropagation();set(e.target.value);}} onClick={e=>e.stopPropagation()} placeholder={placeholder} disabled={isDone}
                      style={{ ...inputStyle, background:"transparent", border:`1.5px solid ${isActive&&!isDone?color:brand.border}`, borderRadius:10, fontSize:13, textDecoration:isDone?"line-through":"none", color:isDone?brand.subText:brand.charcoal }} />
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Zone In ── */}
          <section className="card-anim" style={{ ...cardStyle, animationDelay:"0.1s" }}>
            <h2 style={{ margin:"0 0 6px", fontSize:18, fontWeight:800 }}>🔥 Zone In</h2>
            <p style={{ margin:"0 0 14px", fontSize:13, color:brand.subText }}>One zone. One signal. No noise.</p>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, padding:"12px 14px", borderRadius:12, background:activeZone?.val?.trim()?activeZone.bg:brand.inputBg, border:`1.5px solid ${activeZone?.val?.trim()?activeZone.color:brand.border}`, transition:"all 0.25s" }}>
              <span style={{ fontSize:20 }}>{activeZone?.emoji}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1.5, marginBottom:2 }}>Focusing on</div>
                <div style={{ fontWeight:800, fontSize:14, color:activeZone?.val?.trim()?activeZone.color:brand.subText, fontStyle:activeZone?.val?.trim()?"normal":"italic" }}>
                  {activeZone?.val?.trim() ? activeZoneLabel : "No task set — add one in Zone Mapping above"}
                </div>
              </div>
              {!activeZone?.val?.trim() && <span style={{ fontSize:11, fontWeight:700, color:"#F59E0B", background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.3)", padding:"3px 9px", borderRadius:50, whiteSpace:"nowrap" }}>↑ Add task</span>}
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              {[15,30,45,60,90].map(d=>(
                <button key={d} onClick={()=>setSessionDuration(d)} style={{ padding:"8px 16px", borderRadius:50, fontSize:13, fontWeight:700, cursor:"pointer", transition:"all 0.15s", fontFamily:'"Outfit",ui-sans-serif', background:sessionDuration===d?brand.teal:"transparent", color:sessionDuration===d?"#fff":brand.charcoal, border:`1.5px solid ${sessionDuration===d?brand.teal:brand.border}` }}>
                  {d} min
                </button>
              ))}
            </div>
            <button style={{ ...btnPrimary, width:"100%", padding:"14px", fontSize:15, opacity:activeZone?.val?.trim()?1:0.4, cursor:activeZone?.val?.trim()?"pointer":"not-allowed", background:activeZone?.val?.trim()?brand.teal:"#9CA3AF" }}
              onClick={startSession}
              onPointerEnter={e=>{ if(activeZone?.val?.trim()) e.currentTarget.style.background=brand.tealHover; }}
              onPointerLeave={e=>{ e.currentTarget.style.background=activeZone?.val?.trim()?brand.teal:"#9CA3AF"; }}>
              Start {sessionDuration}-Min Session on {activeZone?.label||"Gold Zone"} →
            </button>
            {!activeZone?.val?.trim() && <p style={{ margin:"8px 0 0", fontSize:12, color:"#F59E0B", fontWeight:600, textAlign:"center" }}>⚠️ Add a task to your {activeZone?.label||"Gold Zone"} above to start</p>}
          </section>

          {/* ── Session History ── */}
          <section className="card-anim" style={{ ...cardStyle, animationDelay:"0.13s" }}>
            <div onClick={()=>sessionHistory.length>0&&setHistoryExpanded(h=>!h)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, cursor:sessionHistory.length>0?"pointer":"default" }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>📋 Session History</h2>
              {sessionHistory.length>3 && <span style={{ fontSize:12, fontWeight:700, color:brand.teal }}>{historyExpanded?"Show less ↑":`View all ${sessionHistory.length} ↓`}</span>}
            </div>
            {sessionHistory.length===0 ? (
              <div style={{ textAlign:"center", padding:"28px 0" }}>
                <div style={{ fontSize:40, marginBottom:10 }}>🎯</div>
                <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>No sessions yet</div>
                <div style={{ fontSize:13, color:brand.subText, lineHeight:1.6 }}>Complete your first zone session and it'll appear here.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {(historyExpanded?sessionHistory:sessionHistory.slice(0,3)).map((s,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderRadius:12, background:brand.bg, border:`1px solid ${brand.border}`, fontSize:13 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
                      <span>{s.emoji||"🥇"}</span>
                      <span style={{ fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.zone}</span>
                      <span style={{ color:brand.subText, flexShrink:0 }}>{s.date}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                      <span style={{ fontWeight:600, color:brand.teal }}>{s.minutes} min</span>
                      <span>{s.completed?"✅":"⏹️"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Close the Loop ── */}
          <section className="card-anim" style={{ ...cardStyle, animationDelay:"0.15s" }}>
            <h2 style={{ margin:"0 0 4px", fontSize:18, fontWeight:800 }}>🧠 Close the Loop</h2>
            <p style={{ margin:"0 0 14px", fontSize:13, color:brand.subText }}>Reflection builds clarity. Clarity builds momentum.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <textarea value={wentWell} onChange={e=>setWentWell(e.target.value)}
                placeholder="What went well today? Be specific — the more detail, the better your insight."
                style={{ ...inputStyle, minHeight:90, resize:"vertical" }} />
              <div style={{ padding:"12px 14px", borderRadius:12, border:`1.5px solid ${brand.border}`, background:brand.inputBg }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <span style={{ fontSize:13, fontWeight:700, minWidth:60 }}>⚡ Energy</span>
                  <input type="range" min="1" max="5" value={energy} onChange={e=>setEnergy(Number(e.target.value))} style={{ flex:1, accentColor:brand.teal }} />
                  <span style={{ fontSize:14, fontWeight:800, color:brand.teal, minWidth:28 }}>{energy}/5</span>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {["😊","😐","😔","😴","😎"].map(m=>(
                    <button key={m} onClick={()=>setMood(m)} style={{ fontSize:22, padding:"7px 11px", borderRadius:10, cursor:"pointer", border:`2px solid ${mood===m?brand.teal:brand.border}`, background:mood===m?brand.tealTint:"transparent", transition:"all 0.15s" }}>{m}</button>
                  ))}
                </div>
              </div>
              <button style={{ ...btnPrimary, alignSelf:"flex-start", opacity:loadingInsight||!wentWell.trim()?0.5:1, cursor:!wentWell.trim()?"not-allowed":"pointer" }}
                onClick={generateInsight} disabled={loadingInsight||!wentWell.trim()}
                onPointerEnter={e=>{ if(!loadingInsight&&wentWell.trim()) e.currentTarget.style.background=brand.tealHover; }}
                onPointerLeave={e=>e.currentTarget.style.background=brand.teal}>
                {loadingInsight?"Getting insight...":"Save & Get Claude Insight ✦"}
              </button>
              {insightError && <p style={{ margin:0, fontSize:13, color:"#EF4444" }}>{insightError}</p>}
              {latestInsight && !loadingInsight && (
                <div style={{ borderRadius:14, border:`1px solid rgba(0,194,178,0.2)`, overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px", background:"rgba(0,194,178,0.07)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:brand.teal, textTransform:"uppercase", letterSpacing:1 }}>{latestInsight.date}</span>
                      {latestInsight.mood && <span style={{ fontSize:14 }}>{latestInsight.mood}</span>}
                      {latestInsight.energy && <span style={{ fontSize:11, color:brand.subText }}>⚡{latestInsight.energy}/5</span>}
                    </div>
                    {insightHistory.length>1 && <button onClick={()=>setShowInsightHistory(h=>!h)} style={{ fontSize:11, fontWeight:700, color:brand.teal, background:"none", border:"none", cursor:"pointer", padding:0 }}>{showInsightHistory?"Hide history ↑":`${insightHistory.length-1} past insight${insightHistory.length>2?"s":""} ↓`}</button>}
                  </div>
                  <div style={{ padding:"14px", fontSize:14, lineHeight:1.8, color:brand.charcoal, whiteSpace:"pre-wrap" }}>{latestInsight.text}</div>
                  {showInsightHistory && insightHistory.slice(1).map((ins,i)=>(
                    <div key={i} style={{ borderTop:`1px solid ${brand.border}`, padding:"12px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <span style={{ fontSize:11, fontWeight:700, color:brand.subText }}>{ins.date}</span>
                        {ins.mood&&<span style={{ fontSize:13 }}>{ins.mood}</span>}
                        {ins.energy&&<span style={{ fontSize:11, color:brand.subText }}>⚡{ins.energy}/5</span>}
                      </div>
                      <div style={{ fontSize:13, lineHeight:1.7, color:brand.charcoal, whiteSpace:"pre-wrap" }}>{ins.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Zone Streak ── */}
          <section className="card-anim" style={{ ...cardStyle, animationDelay:"0.2s", overflow:"hidden" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <h2 style={{ margin:0, fontSize:18, fontWeight:800 }}>🏆 Zone Streak</h2>
              <span style={{ background:brand.accent, color:"#1B1F23", fontSize:11, fontWeight:800, padding:"3px 10px", borderRadius:50 }}>Level up by consistency</span>
            </div>

            {/* Tier banner */}
            <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderRadius:14, marginBottom:16, background:currentTierCfg.bg, border:`1.5px solid ${currentTierCfg.border}`, transition:"all 0.4s" }}>
              <span style={{ fontSize:28 }}>{currentTierCfg.emoji === "—" ? "🔘" : currentTierCfg.emoji}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:900, fontSize:15, color:currentTierCfg.color }}>{currentTierCfg.label}</div>
                <div style={{ fontSize:12, color:brand.subText, marginTop:2 }}>
                  {streakTier==="none"     && "Complete your Gold Zone to start a streak"}
                  {streakTier==="gold"     && "Tick Diamond Zone too to upgrade your streak"}
                  {streakTier==="diamond"  && "Complete Platinum Zone to reach the top tier"}
                  {streakTier==="platinum" && "🔥 Perfect streak — you're firing on all cylinders"}
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1 }}>Multiplier</div>
                <div style={{ fontSize:18, fontWeight:900, color:currentTierCfg.color }}>{currentTierCfg.multiplier}×</div>
              </div>
            </div>

            {/* Streak count + next milestone */}
            <div style={{ display:"flex", gap:12, marginBottom:20 }}>
              <div style={{ flex:1, padding:"14px 16px", borderRadius:14, background:`linear-gradient(135deg,${currentTierCfg.bg},transparent)`, border:`1.5px solid ${currentTierCfg.border}` }}>
                <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Current</div>
                <div style={{ fontSize:32, fontWeight:900, color:currentTierCfg.color, letterSpacing:-1, lineHeight:1 }}>{streak}</div>
                <div style={{ fontSize:13, fontWeight:600, color:brand.subText, marginTop:2 }}>day streak</div>
              </div>
              <div style={{ flex:1, padding:"14px 16px", borderRadius:14, background:brand.inputBg, border:`1.5px solid ${brand.border}`, textAlign:"right" }}>
                <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Next milestone</div>
                <div style={{ fontSize:32, fontWeight:900, color:brand.charcoal, letterSpacing:-1, lineHeight:1 }}>{nextMilestone}</div>
                <div style={{ fontSize:13, fontWeight:600, color:brand.subText, marginTop:2 }}>{daysLeft} day{daysLeft!==1?"s":""} to go</div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1 }}>Progress to Day {nextMilestone}</span>
                <span style={{ fontSize:11, fontWeight:800, color:currentTierCfg.color }}>{Math.round(milestonePct)}%</span>
              </div>
              <div style={{ position:"relative" }}>
                <div style={{ height:10, borderRadius:99, background:brand.border }}>
                  <div style={{ height:"100%", borderRadius:99, width:`${milestonePct}%`, background:`linear-gradient(90deg,${currentTierCfg.color},${currentTierCfg.color}bb)`, transition:"width 0.8s cubic-bezier(0.34,1.56,0.64,1)", boxShadow:`0 0 8px ${currentTierCfg.color}55` }} />
                </div>
                <div style={{ position:"absolute", right:-1, top:"50%", transform:"translate(0,-50%) rotate(45deg)", width:16, height:16, background:brand.card, border:`2.5px solid ${currentTierCfg.color}`, borderRadius:3, boxShadow:`0 0 0 3px ${brand.card}` }} />
              </div>
            </div>

            {streak===0 && <p style={{ margin:"10px 0 0", fontSize:13, color:brand.subText, textAlign:"center" }}>🚀 Complete your Gold Zone today to start your streak</p>}

            {/* Points & Level */}
            <div style={{ marginTop:20, padding:"16px", borderRadius:14, background:brand.inputBg, border:`1px solid ${brand.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Level</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:22 }}>{currentLevel.badge}</span>
                    <span style={{ fontWeight:900, fontSize:16, color:brand.charcoal }}>{currentLevel.name}</span>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Total Points</div>
                  <div style={{ fontSize:28, fontWeight:900, color:brand.teal, letterSpacing:-1, lineHeight:1 }}>{totalPoints.toLocaleString()}</div>
                </div>
              </div>
              {currentLevel.next ? (
                <>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:11, color:brand.subText, fontWeight:600 }}>Next: {currentLevel.next.badge} {currentLevel.next.name}</span>
                    <span style={{ fontSize:11, fontWeight:800, color:brand.teal }}>{currentLevel.ptsToNext.toLocaleString()} pts to go</span>
                  </div>
                  <div style={{ height:6, borderRadius:99, background:brand.border }}>
                    <div style={{ height:"100%", borderRadius:99, width:`${currentLevel.pct}%`, background:`linear-gradient(90deg,${brand.teal},#00E5D5)`, transition:"width 0.6s ease" }} />
                  </div>
                </>
              ) : (
                <div style={{ fontSize:13, color:brand.teal, fontWeight:700, textAlign:"center" }}>👑 Maximum level reached. Legend status.</div>
              )}

              {/* Tier history */}
              {tierHistory.length>0 && (
                <div style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${brand.border}` }}>
                  <div style={{ fontSize:11, fontWeight:700, color:brand.subText, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Recent Days</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {tierHistory.slice(0,14).map((h,i)=>{
                      const tc = TIER_CONFIG[h.tier] || TIER_CONFIG.none;
                      return <div key={i} title={`${h.date} — ${tc.label}`} style={{ width:28, height:28, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, background:tc.bg, border:`1.5px solid ${tc.border}`, cursor:"default" }}>{tc.emoji==="—"?"·":tc.emoji}</div>;
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Milestone analysis */}
            {isStreakMilestone && (
              <div style={{ marginTop:16, padding:"16px", borderRadius:14, background:`linear-gradient(135deg,${currentTierCfg.bg},rgba(255,214,107,0.08))`, border:`1.5px solid ${currentTierCfg.border}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:20 }}>🎯</span>
                  <span style={{ fontWeight:800, fontSize:15 }}>{streak}-Day Milestone Unlocked</span>
                </div>
                <p style={{ margin:"0 0 12px", fontSize:13, color:brand.subText, lineHeight:1.6 }}>You've hit {streak} days. Time to analyse your performance and level up.</p>
                {!streakReport ? (
                  <button style={{ ...btnPrimary, fontSize:13, padding:"10px 20px", opacity:loadingStreakReport?0.7:1 }}
                    onClick={generateStreakReport} disabled={loadingStreakReport}
                    onPointerEnter={e=>{ if(!loadingStreakReport) e.currentTarget.style.background=brand.tealHover; }}
                    onPointerLeave={e=>e.currentTarget.style.background=brand.teal}>
                    {loadingStreakReport?"Analysing...":"Get My Performance Analysis ✦"}
                  </button>
                ) : (
                  <div>
                    <div style={{ padding:"14px 16px", borderRadius:12, background:brand.card, border:`1px solid ${brand.border}`, fontSize:13, lineHeight:1.8, whiteSpace:"pre-wrap", color:brand.charcoal }}>{streakReport}</div>
                    <button style={{ marginTop:10, fontSize:12, background:"none", border:"none", color:brand.teal, cursor:"pointer", fontWeight:600, padding:0 }} onClick={()=>setStreakReport("")}>Refresh analysis</button>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Footer ── */}
          <footer style={{ textAlign:"center", fontSize:12, color:brand.subText, paddingBottom:24 }}>
            <span style={{ fontWeight:800, color:brand.charcoal }}>ZonedIn</span>
            <span style={{ margin:"0 8px" }}>•</span>
            <span style={{ color:brand.teal, fontWeight:700 }}>Clarity Beats Chaos</span>
            <div style={{ marginTop:4 }}>Zone in. Gain clarity. Level up.</div>
          </footer>

        </div>
      </div>
    </>
  );
}
