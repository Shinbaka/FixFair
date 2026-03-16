import { useState, useRef, useEffect } from "react";

// ── Fonts ─────────────────────────────────────────────────────────────────────
const fl = document.createElement("link");
fl.rel = "stylesheet";
fl.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap";
document.head.appendChild(fl);

// ── Constants ─────────────────────────────────────────────────────────────────
const MAKES = ["Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC","Honda","Hyundai","Infiniti","Jeep","Kia","Lexus","Lincoln","Mazda","Mercedes-Benz","Mitsubishi","Nissan","Ram","Subaru","Tesla","Toyota","Volkswagen","Volvo","Other"];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({length:35},(_,i)=>CURRENT_YEAR-i);
const FREE_CHECKS = 3;
const SK = "fixfair_v3";
const HIST_SK = "fixfair_hist";

function getUses(){try{return parseInt(localStorage.getItem(SK)||"0");}catch{return 0;}}
function incUses(){try{localStorage.setItem(SK,String(getUses()+1));}catch{}}
function getHistory(){try{return JSON.parse(localStorage.getItem(HIST_SK)||"[]");}catch{return[];}}
function addHistory(e){try{const h=getHistory();h.unshift(e);localStorage.setItem(HIST_SK,JSON.stringify(h.slice(0,30)));}catch{}}
function fmt(n){if(n==null||isNaN(n))return"—";return"$"+Math.round(n).toLocaleString();}
function scoreColor(s){if(s==null)return"#888";if(s>=75)return"#22c55e";if(s>=55)return"#84cc16";if(s>=40)return"#f59e0b";if(s>=25)return"#f97316";return"#ef4444";}
function scoreEmoji(s){if(s==null)return"●";if(s>=75)return"🟢";if(s>=55)return"🟡";if(s>=40)return"🟠";return"🔴";}
function urgencyColor(u){return{URGENT:"#ef4444",SOON:"#f59e0b",MONITOR:"#22c55e"}[u]||"#888";}

// ── AI Prompts ────────────────────────────────────────────────────────────────
const EST_SYS = `You are a senior automotive service advisor with 25 years of experience. Use neutral, factual language — never say "rip-off", say "above market rate."

ONLY return valid JSON, no markdown, no code fences:
{
  "jobTitle":"string",
  "oneLiner":"string — single sentence answer to 'is this fair?'",
  "totalLow":number,"totalHigh":number,
  "partsLow":number,"partsHigh":number,
  "laborHours":number,"laborRateLow":number,"laborRateHigh":number,
  "laborLow":number,"laborHigh":number,
  "fairnessScore":number|null,
  "fairnessLabel":"Fair"|"Slightly Above Average"|"Above Average"|"Well Above Average"|null,
  "verdictNote":"string|null",
  "doYouNeedThis":[{"repair":"string","verdict":"Likely Needed"|"Verify First"|"Get Second Opinion","reason":"string","cheaperAlternative":"string|null","alternativeCost":"string|null"}],
  "misdiagnoses":[{"expensiveFix":"string","cheaperAlternative":"string","savingsRange":"string","likelihood":"Common|Possible|Rare","checkFirst":"string"}],
  "partsNotes":"string",
  "partsMarkup":[{"part":"string","estimatedWholesale":"string","typicalShopPrice":"string"}],
  "regionalNote":"string",
  "redFlags":["string"],
  "negotiationTips":["string"],
  "partsLinks":[{"name":"string","rockAuto":"string"}],
  "diyDifficulty":"Easy"|"Moderate"|"Hard"|"Expert Only",
  "diyNote":"string","diySavings":"string",
  "urgency":"URGENT"|"SOON"|"MONITOR","urgencyNote":"string",
  "confidence":"High"|"Medium"|"Low","confidenceNote":"string"
}`;

const QUOTE_SYS = `You are an automotive consumer advocate. Neutral, factual analysis only. Say "above market rate" not "rip-off."

ONLY return valid JSON, no markdown, no code fences:
{
  "jobTitle":"string","shopName":"string|null","vehicleDetected":"string|null","totalQuoted":number|null,
  "oneLiner":"string — single sentence verdict",
  "lineItems":[{"description":"string","quotedPrice":number|null,"fairLow":number|null,"fairHigh":number|null,"laborHoursQuoted":number|null,"laborHoursFair":number|null,"status":"FAIR"|"SLIGHTLY_HIGH"|"HIGH"|"VERY_HIGH"|"SUSPICIOUS"|"UNKNOWN","markupPct":number|null,"note":"string"}],
  "doYouNeedThis":[{"repair":"string","verdict":"Likely Needed"|"Verify First"|"Get Second Opinion","reason":"string","cheaperAlternative":"string|null","alternativeCost":"string|null"}],
  "misdiagnoses":[{"expensiveFix":"string","cheaperAlternative":"string","savingsRange":"string","likelihood":"Common|Possible|Rare","checkFirst":"string"}],
  "overallVerdict":"FAIR"|"SLIGHTLY_ABOVE"|"ABOVE_AVERAGE"|"WELL_ABOVE_AVERAGE",
  "fairnessScore":number,"fairnessLabel":"Fair"|"Slightly Above Average"|"Above Average"|"Well Above Average",
  "totalFairLow":number|null,"totalFairHigh":number|null,
  "savingsLow":number|null,"savingsHigh":number|null,
  "summary":"string","redFlags":["string"],"recommendations":["string"],
  "partsLinks":[{"name":"string","rockAuto":"string"}]
}`;

const SYMPTOM_SYS = `You are an expert automotive diagnostic technician. List causes cheapest first.

ONLY return valid JSON, no markdown, no code fences:
{
  "symptomSummary":"string","dtcExplanation":"string|null",
  "oneLiner":"string — one sentence summary of situation",
  "causes":[{"rank":number,"name":"string","likelihood":"Very Likely"|"Likely"|"Possible"|"Unlikely","description":"string","repairLow":number,"repairHigh":number,"diyDifficulty":"Easy"|"Moderate"|"Hard"|"Expert Only","checkFirst":"string","timeToFix":"string"}],
  "diagnosticTips":["string"],"redFlags":["string"],
  "totalRangeLow":number,"totalRangeHigh":number,
  "urgency":"URGENT"|"SOON"|"MONITOR","urgencyNote":"string"
}`;

async function aiCall(system, userMsg, imgB64, imgMime) {
  const parts = [];
  if (imgB64) {
    parts.push({ inlineData: { mimeType: imgMime, data: imgB64 } });
  }
  parts.push({ text: userMsg });
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, parts })
  });
  if (!r.ok) throw new Error("API error: " + r.status);
  const d = await r.json();
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!raw) throw new Error("Empty response from AI");
  const stripped = raw.replace(/```json|```/g,"").trim();
  const s = stripped.indexOf("{");
  const e = stripped.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("No JSON found in AI response");
  try {
    return JSON.parse(stripped.slice(s, e + 1));
  } catch(err) {
    console.error("JSON parse error:", err);
    throw new Error("Could not read AI response — please try again.");
  }
}

// ── Loading messages per mode ─────────────────────────────────────────────────
const LOAD_MSGS = {
  scan: ["Reading your estimate…","Comparing parts prices…","Checking labor hours…","Almost done…"],
  manual: ["Researching repair data…","Calculating fair range…","Checking regional rates…","Almost done…"],
  code: ["Decoding your DTC…","Ranking likely causes…","Finding cheapest fixes first…","Almost done…"],
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
:root {
  --bg: #0a0b0d;
  --surf: #111318;
  --card: #181b22;
  --border: #22262f;
  --muted: #2e3340;
  --text: #edf0f5;
  --sub: #636878;
  --accent: #f59e0b;
  --accent-dim: rgba(245,158,11,.12);
  --green: #22c55e;
  --yellow: #f59e0b;
  --orange: #f97316;
  --red: #ef4444;
  --blue: #3b82f6;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Sora', sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

/* ── APP SHELL ── */
.ff-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ═══════════════════════════════════════════
   HOME SCREEN
═══════════════════════════════════════════ */
.ff-home {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}

/* Atmospheric background */
.ff-home::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 90% 45% at 50% -10%, rgba(245,158,11,.11) 0%, transparent 60%),
    radial-gradient(ellipse 60% 30% at 10% 80%, rgba(245,158,11,.04) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

/* Subtle grid texture */
.ff-home::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  z-index: 0;
}

.ff-home > * { position: relative; z-index: 1; }

/* Top bar */
.ff-topbar {
  padding: 20px 22px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
}

.ff-logo {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.55rem;
  letter-spacing: 4px;
  color: var(--text);
  line-height: 1;
}
.ff-logo em { color: var(--accent); font-style: normal; }

.ff-checks-pill {
  font-family: 'DM Mono', monospace;
  font-size: .62rem;
  color: var(--sub);
  background: var(--card);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 20px;
  cursor: pointer;
  transition: border-color .15s;
}
.ff-checks-pill:hover { border-color: var(--muted); }
.ff-checks-pill b { color: var(--accent); }

/* Hero text */
.ff-hero-text {
  padding: 28px 24px 0;
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
  text-align: center;
}

.ff-headline {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(2.6rem, 11vw, 4.2rem);
  line-height: .92;
  letter-spacing: 1.5px;
  color: var(--text);
  margin-bottom: 12px;
}
.ff-headline em { color: var(--accent); font-style: normal; display: block; }

.ff-subline {
  font-size: .88rem;
  color: var(--sub);
  font-weight: 300;
  line-height: 1.7;
  max-width: 300px;
  margin: 0 auto;
}

/* ── BIG SCAN BUTTON ── */
.ff-cta-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 24px 12px;
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
  gap: 16px;
}

.ff-scan-btn {
  width: 100%;
  max-width: 380px;
  background: var(--accent);
  border: none;
  border-radius: 20px;
  padding: 0;
  cursor: pointer;
  position: relative;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease;
  box-shadow:
    0 0 0 0 rgba(245,158,11,0),
    0 20px 60px rgba(245,158,11,.25),
    0 4px 16px rgba(0,0,0,.4);
  overflow: hidden;
}

.ff-scan-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,.15) 0%, transparent 60%);
  border-radius: 20px;
  pointer-events: none;
}

.ff-scan-btn:hover {
  transform: translateY(-3px) scale(1.01);
  box-shadow:
    0 0 0 6px rgba(245,158,11,.15),
    0 28px 70px rgba(245,158,11,.35),
    0 8px 24px rgba(0,0,0,.5);
}

.ff-scan-btn:active {
  transform: translateY(1px) scale(.99);
  box-shadow: 0 8px 30px rgba(245,158,11,.2), 0 2px 8px rgba(0,0,0,.3);
}

.ff-scan-inner {
  padding: 32px 24px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ff-scan-icon {
  font-size: 2.6rem;
  line-height: 1;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,.3));
  animation: pulse-icon 2.5s ease-in-out infinite;
}

@keyframes pulse-icon {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

.ff-scan-label {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.9rem;
  letter-spacing: 2px;
  color: #000;
  line-height: 1;
}

.ff-scan-desc {
  font-size: .8rem;
  color: rgba(0,0,0,.55);
  font-weight: 500;
  letter-spacing: .2px;
}

/* ── SECONDARY ACTIONS ── */
.ff-secondary {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ff-sec-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'DM Mono', monospace;
  font-size: .65rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.ff-sec-divider::before, .ff-sec-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.ff-sec-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ff-sec-btn {
  background: var(--card);
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 14px 12px;
  cursor: pointer;
  transition: all .18s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.ff-sec-btn:hover {
  border-color: var(--accent);
  background: var(--accent-dim);
  transform: translateY(-1px);
}

.ff-sec-btn-icon { font-size: 1.3rem; line-height: 1; }
.ff-sec-btn-label {
  font-family: 'Sora', sans-serif;
  font-size: .74rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}
.ff-sec-btn-sub {
  font-size: .65rem;
  color: var(--sub);
  line-height: 1.3;
}

/* ── BOTTOM STRIP ── */
.ff-bottom-strip {
  padding: 16px 22px 24px;
  max-width: 500px;
  margin: 0 auto;
  width: 100%;
}

.ff-history-peek {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.ff-hist-hd {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ff-hist-title {
  font-family: 'DM Mono', monospace;
  font-size: .62rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--sub);
  display: flex;
  align-items: center;
  gap: 6px;
}
.ff-hist-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
.ff-hist-count {
  font-family: 'DM Mono', monospace;
  font-size: .6rem;
  color: var(--sub);
  background: var(--muted);
  padding: 2px 7px;
  border-radius: 10px;
}

.ff-hist-row {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(34,38,47,.6);
  cursor: pointer;
  transition: background .12s;
}
.ff-hist-row:last-child { border-bottom: none; }
.ff-hist-row:hover { background: rgba(245,158,11,.04); }

.ff-hist-job {
  font-size: .82rem;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 2px;
}
.ff-hist-meta {
  font-family: 'DM Mono', monospace;
  font-size: .62rem;
  color: var(--sub);
}
.ff-hist-score {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.15rem;
  letter-spacing: 1px;
}

.ff-no-history {
  padding: 18px 14px;
  text-align: center;
  font-size: .78rem;
  color: var(--sub);
  line-height: 1.6;
}

/* ═══════════════════════════════════════════
   FLOW SCREENS (shared)
═══════════════════════════════════════════ */
.ff-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
  padding: 0 18px 40px;
}

.ff-screen-hdr {
  padding: 18px 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ff-back {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: .9rem;
  color: var(--sub);
  transition: all .15s;
  flex-shrink: 0;
}
.ff-back:hover { border-color: var(--text); color: var(--text); }

.ff-screen-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.4rem;
  letter-spacing: 2px;
  color: var(--text);
  line-height: 1;
}
.ff-screen-title em { color: var(--accent); font-style: normal; }

/* ── FORM ELEMENTS ── */
.ff-form { display: flex; flex-direction: column; gap: 13px; }

.ff-r3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px; }
.ff-r2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
@media(max-width:460px) {
  .ff-r3 { grid-template-columns: 1fr 1fr; }
  .ff-r3 > *:last-child { grid-column: 1/-1; }
  .ff-r2 { grid-template-columns: 1fr; }
}

.ff-fld { display: flex; flex-direction: column; gap: 5px; }
.ff-lbl {
  font-size: .6rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--sub); font-family: 'DM Mono', monospace;
}

.ff-inp, .ff-sel, .ff-ta {
  background: var(--surf);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: 'Sora', sans-serif;
  font-size: .86rem;
  padding: 9px 11px;
  width: 100%;
  outline: none;
  transition: border-color .18s;
}
.ff-inp:focus, .ff-sel:focus, .ff-ta:focus { border-color: var(--accent); }
.ff-sel option { background: var(--surf); }
.ff-ta { resize: vertical; min-height: 82px; line-height: 1.55; }

.ff-pw { position: relative; }
.ff-ps {
  position: absolute; left: 11px; top: 50%;
  transform: translateY(-50%);
  color: var(--sub); font-family: 'DM Mono', monospace;
  font-size: .85rem; pointer-events: none;
}
.ff-pw .ff-inp { padding-left: 20px; }

/* Upload zone */
.ff-upzone {
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 28px 16px;
  text-align: center;
  cursor: pointer;
  transition: all .18s;
  background: var(--surf);
}
.ff-upzone:hover { border-color: var(--accent); background: rgba(245,158,11,.04); }
.ff-upzone-icon { font-size: 1.8rem; margin-bottom: 7px; }
.ff-upzone-title { font-size: .88rem; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.ff-upzone-sub { font-size: .74rem; color: var(--sub); }
.ff-preview { max-width: 100%; max-height: 160px; border-radius: 8px; margin-top: 10px; object-fit: contain; }

/* Submit btn */
.ff-submit {
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: 10px;
  padding: 13px 18px;
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.15rem;
  letter-spacing: 1.5px;
  cursor: pointer;
  transition: all .18s;
  width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 7px;
}
.ff-submit:hover:not(:disabled) {
  background: #fbbf24;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(245,158,11,.25);
}
.ff-submit:disabled { opacity: .38; cursor: not-allowed; transform: none; }

/* ── LOADING ── */
.ff-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
  gap: 20px;
}

.ff-spinner-ring {
  width: 64px; height: 64px;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: spin .7s linear infinite;
  position: relative;
}
.ff-spinner-ring::after {
  content: '🔍';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.2rem;
  animation: spin-rev .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes spin-rev { to { transform: translate(-50%,-50%) rotate(-360deg); } }

.ff-load-msg {
  font-family: 'DM Mono', monospace;
  font-size: .85rem;
  color: var(--sub);
  min-height: 1.4em;
}
.ff-load-msg b { color: var(--accent); }

.ff-load-steps {
  display: flex;
  gap: 6px;
}
.ff-step-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--border);
  transition: background .3s;
}
.ff-step-dot.active { background: var(--accent); }
.ff-step-dot.done { background: var(--green); }

/* ═══════════════════════════════════════════
   RESULT SCREEN
═══════════════════════════════════════════ */
.ff-result { display: flex; flex-direction: column; gap: 11px; }

/* Answer-first hero */
.ff-answer-hero {
  background: var(--surf);
  border-radius: 16px;
  padding: 22px 20px 18px;
  position: relative;
  overflow: hidden;
}
.ff-answer-hero::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), #f97316);
}

.ff-answer-vehicle {
  font-family: 'DM Mono', monospace;
  font-size: .63rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--sub);
  margin-bottom: 4px;
}

.ff-answer-job {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 1.5rem;
  letter-spacing: 1.5px;
  color: var(--text);
  line-height: 1;
  margin-bottom: 16px;
}

.ff-price-block {
