import { useState, useRef, useEffect } from "react";

// -- Fonts ---------------------------------------------------------------------
// Font injection moved to component level to avoid build issues

// -- Constants -----------------------------------------------------------------
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
function fmt(n){if(n==null||isNaN(n))return"-";return"$"+Math.round(n).toLocaleString();}
function scoreColor(s){if(s==null)return"#888";if(s>=75)return"#22c55e";if(s>=55)return"#84cc16";if(s>=40)return"#f59e0b";if(s>=25)return"#f97316";return"#ef4444";}
function scoreEmoji(s){if(s==null)return"";if(s>=75)return"🟢";if(s>=55)return"🟡";if(s>=40)return"🟠";return"🔴";}
function urgencyColor(u){return{URGENT:"#ef4444",SOON:"#f59e0b",MONITOR:"#22c55e"}[u]||"#888";}

// -- AI Prompts ----------------------------------------------------------------
const EST_SYS = `You are a senior automotive service advisor with 25 years of experience. Use neutral, factual language - never say "rip-off", say "above market rate."

ONLY return valid JSON, no markdown, no code fences:
{
  "jobTitle":"string",
  "oneLiner":"string - single sentence answer to 'is this fair?'",
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
  "oneLiner":"string - single sentence verdict",
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
  "oneLiner":"string - one sentence summary of situation",
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
    throw new Error("Could not read AI response - please try again.");
  }
}

// -- Loading messages per mode -------------------------------------------------
const LOAD_MSGS = {
  scan: ["Reading your estimate ","Comparing parts prices ","Checking labor hours ","Almost done "],
  manual: ["Researching repair data ","Calculating fair range ","Checking regional rates ","Almost done "],
  code: ["Decoding your DTC ","Ranking likely causes ","Finding cheapest fixes first ","Almost done "],
};

// -- CSS -----------------------------------------------------------------------
const CSS = "\n:root {\n  --bg: #0a0b0d;\n  --surf: #111318;\n  --card: #181b22;\n  --border: #22262f;\n  --muted: #2e3340;\n  --text: #edf0f5;\n  --sub: #636878;\n  --accent: #f59e0b;\n  --accent-dim: rgba(245,158,11,.12);\n  --green: #22c55e;\n  --yellow: #f59e0b;\n  --orange: #f97316;\n  --red: #ef4444;\n  --blue: #3b82f6;\n}\n\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\nhtml, body { height: 100%; }\nbody {\n  background: var(--bg);\n  color: var(--text);\n  font-family: 'Sora', sans-serif;\n  -webkit-font-smoothing: antialiased;\n  overscroll-behavior: none;\n}\n\n/*    APP SHELL    */\n.ff-app {\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  background: var(--bg);\n}\n\n/*                                            \n   HOME SCREEN\n                                            */\n.ff-home {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  min-height: 100vh;\n  position: relative;\n  overflow: hidden;\n}\n\n/* Atmospheric background */\n.ff-home::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background:\n    radial-gradient(ellipse 90% 45% at 50% -10%, rgba(245,158,11,.11) 0%, transparent 60%),\n    radial-gradient(ellipse 60% 30% at 10% 80%, rgba(245,158,11,.04) 0%, transparent 50%);\n  pointer-events: none;\n  z-index: 0;\n}\n\n/* Subtle grid texture */\n.ff-home::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background-image:\n    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);\n  background-size: 48px 48px;\n  pointer-events: none;\n  z-index: 0;\n}\n\n.ff-home > * { position: relative; z-index: 1; }\n\n/* Top bar */\n.ff-topbar {\n  padding: 20px 22px 0;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  max-width: 500px;\n  margin: 0 auto;\n  width: 100%;\n}\n\n.ff-logo {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.55rem;\n  letter-spacing: 4px;\n  color: var(--text);\n  line-height: 1;\n}\n.ff-logo em { color: var(--accent); font-style: normal; }\n\n.ff-checks-pill {\n  font-family: 'DM Mono', monospace;\n  font-size: .62rem;\n  color: var(--sub);\n  background: var(--card);\n  border: 1px solid var(--border);\n  padding: 4px 10px;\n  border-radius: 20px;\n  cursor: pointer;\n  transition: border-color .15s;\n}\n.ff-checks-pill:hover { border-color: var(--muted); }\n.ff-checks-pill b { color: var(--accent); }\n\n/* Hero text */\n.ff-hero-text {\n  padding: 28px 24px 0;\n  max-width: 500px;\n  margin: 0 auto;\n  width: 100%;\n  text-align: center;\n}\n\n.ff-headline {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: clamp(2.6rem, 11vw, 4.2rem);\n  line-height: .92;\n  letter-spacing: 1.5px;\n  color: var(--text);\n  margin-bottom: 12px;\n}\n.ff-headline em { color: var(--accent); font-style: normal; display: block; }\n\n.ff-subline {\n  font-size: .88rem;\n  color: var(--sub);\n  font-weight: 300;\n  line-height: 1.7;\n  max-width: 300px;\n  margin: 0 auto;\n}\n\n/*    BIG SCAN BUTTON    */\n.ff-cta-zone {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 28px 24px 12px;\n  max-width: 500px;\n  margin: 0 auto;\n  width: 100%;\n  gap: 16px;\n}\n\n.ff-scan-btn {\n  width: 100%;\n  max-width: 380px;\n  background: var(--accent);\n  border: none;\n  border-radius: 20px;\n  padding: 0;\n  cursor: pointer;\n  position: relative;\n  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease;\n  box-shadow:\n    0 0 0 0 rgba(245,158,11,0),\n    0 20px 60px rgba(245,158,11,.25),\n    0 4px 16px rgba(0,0,0,.4);\n  overflow: hidden;\n}\n\n.ff-scan-btn::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: linear-gradient(135deg, rgba(255,255,255,.15) 0%, transparent 60%);\n  border-radius: 20px;\n  pointer-events: none;\n}\n\n.ff-scan-btn:hover {\n  transform: translateY(-3px) scale(1.01);\n  box-shadow:\n    0 0 0 6px rgba(245,158,11,.15),\n    0 28px 70px rgba(245,158,11,.35),\n    0 8px 24px rgba(0,0,0,.5);\n}\n\n.ff-scan-btn:active {\n  transform: translateY(1px) scale(.99);\n  box-shadow: 0 8px 30px rgba(245,158,11,.2), 0 2px 8px rgba(0,0,0,.3);\n}\n\n.ff-scan-inner {\n  padding: 32px 24px 28px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 10px;\n}\n\n.ff-scan-icon {\n  font-size: 2.6rem;\n  line-height: 1;\n  filter: drop-shadow(0 2px 8px rgba(0,0,0,.3));\n  animation: pulse-icon 2.5s ease-in-out infinite;\n}\n\n@keyframes pulse-icon {\n  0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.06); }\n}\n\n.ff-scan-label {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.9rem;\n  letter-spacing: 2px;\n  color: #000;\n  line-height: 1;\n}\n\n.ff-scan-desc {\n  font-size: .8rem;\n  color: rgba(0,0,0,.55);\n  font-weight: 500;\n  letter-spacing: .2px;\n}\n\n/*    SECONDARY ACTIONS    */\n.ff-secondary {\n  width: 100%;\n  max-width: 380px;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.ff-sec-divider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  font-family: 'DM Mono', monospace;\n  font-size: .65rem;\n  color: var(--muted);\n  text-transform: uppercase;\n  letter-spacing: 1px;\n}\n.ff-sec-divider::before, .ff-sec-divider::after {\n  content: '';\n  flex: 1;\n  height: 1px;\n  background: var(--border);\n}\n\n.ff-sec-actions {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n}\n\n.ff-sec-btn {\n  background: var(--card);\n  border: 1.5px solid var(--border);\n  border-radius: 12px;\n  padding: 14px 12px;\n  cursor: pointer;\n  transition: all .18s;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 6px;\n  text-align: center;\n}\n.ff-sec-btn:hover {\n  border-color: var(--accent);\n  background: var(--accent-dim);\n  transform: translateY(-1px);\n}\n\n.ff-sec-btn-icon { font-size: 1.3rem; line-height: 1; }\n.ff-sec-btn-label {\n  font-family: 'Sora', sans-serif;\n  font-size: .74rem;\n  font-weight: 600;\n  color: var(--text);\n  line-height: 1.3;\n}\n.ff-sec-btn-sub {\n  font-size: .65rem;\n  color: var(--sub);\n  line-height: 1.3;\n}\n\n/*    BOTTOM STRIP    */\n.ff-bottom-strip {\n  padding: 16px 22px 24px;\n  max-width: 500px;\n  margin: 0 auto;\n  width: 100%;\n}\n\n.ff-history-peek {\n  background: var(--card);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  overflow: hidden;\n}\n\n.ff-hist-hd {\n  padding: 10px 14px;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.ff-hist-title {\n  font-family: 'DM Mono', monospace;\n  font-size: .62rem;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n  color: var(--sub);\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.ff-hist-dot {\n  width: 5px; height: 5px;\n  border-radius: 50%;\n  background: var(--accent);\n}\n.ff-hist-count {\n  font-family: 'DM Mono', monospace;\n  font-size: .6rem;\n  color: var(--sub);\n  background: var(--muted);\n  padding: 2px 7px;\n  border-radius: 10px;\n}\n\n.ff-hist-row {\n  padding: 10px 14px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  border-bottom: 1px solid rgba(34,38,47,.6);\n  cursor: pointer;\n  transition: background .12s;\n}\n.ff-hist-row:last-child { border-bottom: none; }\n.ff-hist-row:hover { background: rgba(245,158,11,.04); }\n\n.ff-hist-job {\n  font-size: .82rem;\n  font-weight: 500;\n  color: var(--text);\n  margin-bottom: 2px;\n}\n.ff-hist-meta {\n  font-family: 'DM Mono', monospace;\n  font-size: .62rem;\n  color: var(--sub);\n}\n.ff-hist-score {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.15rem;\n  letter-spacing: 1px;\n}\n\n.ff-no-history {\n  padding: 18px 14px;\n  text-align: center;\n  font-size: .78rem;\n  color: var(--sub);\n  line-height: 1.6;\n}\n\n/*                                            \n   FLOW SCREENS (shared)\n                                            */\n.ff-screen {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  max-width: 560px;\n  margin: 0 auto;\n  width: 100%;\n  padding: 0 18px 40px;\n}\n\n.ff-screen-hdr {\n  padding: 18px 0 16px;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n\n.ff-back {\n  background: var(--card);\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  width: 34px; height: 34px;\n  display: flex; align-items: center; justify-content: center;\n  cursor: pointer;\n  font-size: .9rem;\n  color: var(--sub);\n  transition: all .15s;\n  flex-shrink: 0;\n}\n.ff-back:hover { border-color: var(--text); color: var(--text); }\n\n.ff-screen-title {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.4rem;\n  letter-spacing: 2px;\n  color: var(--text);\n  line-height: 1;\n}\n.ff-screen-title em { color: var(--accent); font-style: normal; }\n\n/*    FORM ELEMENTS    */\n.ff-form { display: flex; flex-direction: column; gap: 13px; }\n\n.ff-r3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px; }\n.ff-r2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }\n@media(max-width:460px) {\n  .ff-r3 { grid-template-columns: 1fr 1fr; }\n  .ff-r3 > *:last-child { grid-column: 1/-1; }\n  .ff-r2 { grid-template-columns: 1fr; }\n}\n\n.ff-fld { display: flex; flex-direction: column; gap: 5px; }\n.ff-lbl {\n  font-size: .6rem; font-weight: 600;\n  text-transform: uppercase; letter-spacing: 1px;\n  color: var(--sub); font-family: 'DM Mono', monospace;\n}\n\n.ff-inp, .ff-sel, .ff-ta {\n  background: var(--surf);\n  border: 1.5px solid var(--border);\n  border-radius: 8px;\n  color: var(--text);\n  font-family: 'Sora', sans-serif;\n  font-size: .86rem;\n  padding: 9px 11px;\n  width: 100%;\n  outline: none;\n  transition: border-color .18s;\n}\n.ff-inp:focus, .ff-sel:focus, .ff-ta:focus { border-color: var(--accent); }\n.ff-sel option { background: var(--surf); }\n.ff-ta { resize: vertical; min-height: 82px; line-height: 1.55; }\n\n.ff-pw { position: relative; }\n.ff-ps {\n  position: absolute; left: 11px; top: 50%;\n  transform: translateY(-50%);\n  color: var(--sub); font-family: 'DM Mono', monospace;\n  font-size: .85rem; pointer-events: none;\n}\n.ff-pw .ff-inp { padding-left: 20px; }\n\n/* Upload zone */\n.ff-upzone {\n  border: 2px dashed var(--border);\n  border-radius: 12px;\n  padding: 28px 16px;\n  text-align: center;\n  cursor: pointer;\n  transition: all .18s;\n  background: var(--surf);\n}\n.ff-upzone:hover { border-color: var(--accent); background: rgba(245,158,11,.04); }\n.ff-upzone-icon { font-size: 1.8rem; margin-bottom: 7px; }\n.ff-upzone-title { font-size: .88rem; font-weight: 600; color: var(--text); margin-bottom: 3px; }\n.ff-upzone-sub { font-size: .74rem; color: var(--sub); }\n.ff-preview { max-width: 100%; max-height: 160px; border-radius: 8px; margin-top: 10px; object-fit: contain; }\n\n/* Submit btn */\n.ff-submit {\n  background: var(--accent);\n  color: #000;\n  border: none;\n  border-radius: 10px;\n  padding: 13px 18px;\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.15rem;\n  letter-spacing: 1.5px;\n  cursor: pointer;\n  transition: all .18s;\n  width: 100%;\n  display: flex; align-items: center; justify-content: center; gap: 7px;\n}\n.ff-submit:hover:not(:disabled) {\n  background: #fbbf24;\n  transform: translateY(-1px);\n  box-shadow: 0 6px 20px rgba(245,158,11,.25);\n}\n.ff-submit:disabled { opacity: .38; cursor: not-allowed; transform: none; }\n\n/*    LOADING    */\n.ff-loading {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 40px 24px;\n  text-align: center;\n  gap: 20px;\n}\n\n.ff-spinner-ring {\n  width: 64px; height: 64px;\n  border-radius: 50%;\n  border: 3px solid var(--border);\n  border-top-color: var(--accent);\n  animation: spin .7s linear infinite;\n  position: relative;\n}\n.ff-spinner-ring::after {\n  content: ' ';\n  position: absolute;\n  top: 50%; left: 50%;\n  transform: translate(-50%, -50%);\n  font-size: 1.2rem;\n  animation: spin-rev .7s linear infinite;\n}\n@keyframes spin { to { transform: rotate(360deg); } }\n@keyframes spin-rev { to { transform: translate(-50%,-50%) rotate(-360deg); } }\n\n.ff-load-msg {\n  font-family: 'DM Mono', monospace;\n  font-size: .85rem;\n  color: var(--sub);\n  min-height: 1.4em;\n}\n.ff-load-msg b { color: var(--accent); }\n\n.ff-load-steps {\n  display: flex;\n  gap: 6px;\n}\n.ff-step-dot {\n  width: 6px; height: 6px;\n  border-radius: 50%;\n  background: var(--border);\n  transition: background .3s;\n}\n.ff-step-dot.active { background: var(--accent); }\n.ff-step-dot.done { background: var(--green); }\n\n/*                                            \n   RESULT SCREEN\n                                            */\n.ff-result { display: flex; flex-direction: column; gap: 11px; }\n\n/* Answer-first hero */\n.ff-answer-hero {\n  background: var(--surf);\n  border-radius: 16px;\n  padding: 22px 20px 18px;\n  position: relative;\n  overflow: hidden;\n}\n.ff-answer-hero::before {\n  content: '';\n  position: absolute;\n  top: 0; left: 0; right: 0;\n  height: 3px;\n  background: linear-gradient(90deg, var(--accent), #f97316);\n}\n\n.ff-answer-vehicle {\n  font-family: 'DM Mono', monospace;\n  font-size: .63rem;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n  color: var(--sub);\n  margin-bottom: 4px;\n}\n\n.ff-answer-job {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.5rem;\n  letter-spacing: 1.5px;\n  color: var(--text);\n  line-height: 1;\n  margin-bottom: 16px;\n}\n\n.ff-price-block {\n  margin-bottom: 14px;\n}\n.ff-price-label {\n  font-family: 'DM Mono', monospace;\n  font-size: .62rem;\n  text-transform: uppercase;\n  letter-spacing: 1.5px;\n  color: var(--sub);\n  margin-bottom: 5px;\n}\n.ff-price-range {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 3rem;\n  letter-spacing: 1px;\n  color: var(--text);\n  line-height: 1;\n}\n.ff-price-range em { color: var(--accent); font-style: normal; }\n\n/* Quote compare row */\n.ff-compare {\n  display: flex;\n  gap: 0;\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  overflow: hidden;\n  margin-top: 14px;\n}\n.ff-compare-cell {\n  flex: 1;\n  padding: 12px 14px;\n  background: var(--card);\n}\n.ff-compare-cell + .ff-compare-cell {\n  border-left: 1px solid var(--border);\n}\n.ff-compare-label {\n  font-family: 'DM Mono', monospace;\n  font-size: .58rem;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n  color: var(--sub);\n  margin-bottom: 4px;\n}\n.ff-compare-val {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.5rem;\n  letter-spacing: 1px;\n  line-height: 1;\n}\n.ff-compare-val.green { color: var(--green); }\n.ff-compare-val.red { color: var(--red); }\n.ff-compare-val.yellow { color: var(--yellow); }\n.ff-compare-val.neutral { color: var(--text); }\n\n/* Score strip */\n.ff-score-strip {\n  display: flex;\n  align-items: center;\n  gap: 13px;\n  padding: 14px 16px;\n  border-radius: 12px;\n  border: 1px solid;\n}\n\n.ff-score-num {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 2.4rem;\n  letter-spacing: 1px;\n  line-height: 1;\n  flex-shrink: 0;\n}\n.ff-score-info { flex: 1; min-width: 0; }\n.ff-score-label {\n  font-size: .84rem;\n  font-weight: 600;\n  margin-bottom: 3px;\n}\n.ff-score-note {\n  font-size: .76rem;\n  color: var(--sub);\n  line-height: 1.45;\n}\n.ff-gauge {\n  height: 5px;\n  background: var(--muted);\n  border-radius: 3px;\n  margin-top: 8px;\n  position: relative;\n}\n.ff-gauge-fill {\n  height: 100%;\n  border-radius: 3px;\n  transition: width .9s cubic-bezier(.16,1,.3,1);\n}\n.ff-gauge-pin {\n  position: absolute;\n  top: 50%;\n  transform: translate(-50%, -50%);\n  width: 11px; height: 11px;\n  border-radius: 50%;\n  border: 2px solid var(--bg);\n  transition: left .9s cubic-bezier(.16,1,.3,1);\n}\n\n/* One liner */\n.ff-one-liner {\n  font-size: .9rem;\n  color: var(--text);\n  line-height: 1.6;\n  padding: 14px 16px;\n  background: var(--card);\n  border-radius: 10px;\n  border-left: 3px solid var(--accent);\n  margin-top: 4px;\n}\n\n/* Detail card */\n.ff-card {\n  background: var(--card);\n  border: 1px solid var(--border);\n  border-radius: 13px;\n  overflow: hidden;\n}\n.ff-card-hd {\n  padding: 10px 15px;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n.ff-card-hd-left {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-family: 'DM Mono', monospace;\n  font-size: .61rem;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n  color: var(--sub);\n}\n.ff-card-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }\n.ff-card-body { padding: 15px; }\n\n/* \"See details\" toggle */\n.ff-expand-btn {\n  font-family: 'DM Mono', monospace;\n  font-size: .6rem;\n  text-transform: uppercase;\n  letter-spacing: .8px;\n  color: var(--accent);\n  background: none;\n  border: none;\n  cursor: pointer;\n  padding: 0;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  white-space: nowrap;\n}\n.ff-expand-btn:hover { opacity: .8; }\n\n/* Need this? */\n.ff-need {\n  border-radius: 10px;\n  padding: 12px;\n  border: 1px solid;\n  margin-bottom: 8px;\n}\n.ff-need:last-child { margin-bottom: 0; }\n.ff-need.green { background: rgba(34,197,94,.07); border-color: rgba(34,197,94,.25); }\n.ff-need.yellow { background: rgba(245,158,11,.07); border-color: rgba(245,158,11,.25); }\n.ff-need.red { background: rgba(239,68,68,.07); border-color: rgba(239,68,68,.2); }\n.ff-need-verdict {\n  font-family: 'DM Mono', monospace;\n  font-size: .63rem;\n  text-transform: uppercase;\n  letter-spacing: .8px;\n  font-weight: 700;\n  margin-bottom: 3px;\n}\n.ff-need.green .ff-need-verdict { color: var(--green); }\n.ff-need.yellow .ff-need-verdict { color: var(--yellow); }\n.ff-need.red .ff-need-verdict { color: var(--red); }\n.ff-need-repair { font-size: .88rem; font-weight: 600; color: var(--text); margin-bottom: 3px; }\n.ff-need-reason { font-size: .78rem; color: var(--sub); line-height: 1.5; }\n.ff-need-alt { font-size: .75rem; color: var(--blue); margin-top: 5px; }\n\n/* Cheaper causes */\n.ff-cause-alt {\n  background: var(--surf);\n  border-radius: 9px;\n  padding: 12px;\n  border-left: 3px solid var(--blue);\n  margin-bottom: 8px;\n}\n.ff-cause-alt:last-child { margin-bottom: 0; }\n.ff-cause-alt-head {\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  margin-bottom: 5px;\n  gap: 8px;\n}\n.ff-cause-alt-name { font-size: .83rem; font-weight: 600; color: var(--text); }\n.ff-cause-alt-tip { font-size: .76rem; color: var(--blue); margin-bottom: 3px; }\n.ff-cause-alt-save { font-size: .72rem; color: var(--sub); }\n\n/* Badge */\n.ff-badge {\n  display: inline-flex; align-items: center; gap: 3px;\n  padding: 2px 8px;\n  border-radius: 20px;\n  font-size: .63rem; font-weight: 600;\n  font-family: 'DM Mono', monospace;\n  text-transform: uppercase; letter-spacing: .4px;\n  flex-shrink: 0;\n}\n.ff-badge.green { background: rgba(34,197,94,.12); color: var(--green); border: 1px solid rgba(34,197,94,.25); }\n.ff-badge.yellow { background: rgba(245,158,11,.12); color: var(--yellow); border: 1px solid rgba(245,158,11,.25); }\n.ff-badge.orange { background: rgba(249,115,22,.12); color: var(--orange); border: 1px solid rgba(249,115,22,.25); }\n.ff-badge.red { background: rgba(239,68,68,.12); color: var(--red); border: 1px solid rgba(239,68,68,.25); }\n.ff-badge.blue { background: rgba(59,130,246,.12); color: var(--blue); border: 1px solid rgba(59,130,246,.25); }\n.ff-badge.muted { background: rgba(46,51,64,.5); color: var(--sub); border: 1px solid var(--border); }\n\n/* Table */\n.ff-tbl { width: 100%; border-collapse: collapse; }\n.ff-tbl th {\n  font-family: 'DM Mono', monospace; font-size: .58rem;\n  text-transform: uppercase; letter-spacing: 1px;\n  color: var(--sub); padding: 6px 8px;\n  text-align: left; border-bottom: 1px solid var(--border);\n}\n.ff-tbl td {\n  padding: 9px 8px; font-size: .8rem;\n  border-bottom: 1px solid rgba(34,38,47,.6);\n  vertical-align: top;\n}\n.ff-tbl tr:last-child td { border-bottom: none; }\n\n/* List */\n.ff-lst { list-style: none; display: flex; flex-direction: column; gap: 7px; }\n.ff-li { display: flex; align-items: flex-start; gap: 8px; font-size: .83rem; line-height: 1.55; color: var(--text); }\n.ff-bul { flex-shrink: 0; margin-top: 3px; font-size: .7rem; }\n\n/* Breakdown grid */\n.ff-breakdown {\n  display: grid;\n  grid-template-columns: 1fr 1fr 1fr;\n  gap: 8px;\n  margin-bottom: 12px;\n}\n@media(max-width:400px) { .ff-breakdown { grid-template-columns: 1fr 1fr; } }\n.ff-bdown-cell {\n  background: var(--surf);\n  border-radius: 8px;\n  padding: 11px;\n  text-align: center;\n}\n.ff-bdown-label {\n  font-family: 'DM Mono', monospace;\n  font-size: .56rem; text-transform: uppercase; letter-spacing: 1px;\n  color: var(--sub); margin-bottom: 4px;\n}\n.ff-bdown-val {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: 1.05rem; color: var(--text); line-height: 1;\n}\n\n/* Parts links */\n.ff-parts-row { display: flex; flex-wrap: wrap; gap: 6px; }\n.ff-plink {\n  padding: 7px 12px;\n  background: var(--surf);\n  border: 1px solid var(--border);\n  border-radius: 7px;\n  color: var(--text);\n  font-size: .76rem; font-weight: 500;\n  cursor: pointer; text-decoration: none;\n  display: flex; align-items: center; gap: 4px;\n  transition: all .13s;\n}\n.ff-plink:hover { border-color: var(--accent); color: var(--accent); }\n\n/* Affiliate */\n.ff-aff {\n  background: linear-gradient(135deg, rgba(245,158,11,.06), rgba(249,115,22,.03));\n  border: 1px solid rgba(245,158,11,.18);\n  border-radius: 13px;\n  padding: 16px;\n}\n.ff-aff-title {\n  font-family: 'Bebas Neue', sans-serif;\n  font-size: .95rem; letter-spacing: 1.5px;\n  color: var(--accent); margin-bottom: 8px;\n}\n\n/* Action row */\n.ff-action-row {\n  display: flex; gap: 8px;\n}\n.ff-action-btn {\n  flex: 1;\n  background: var(--card);\n  border: 1.5px solid var(--border);\n  border-radius: 10px;\n  padding: 12px 10px;\n  cursor: pointer;\n  transition: all .15s;\n  display: flex; flex-direction: column; align-items: center; gap: 5px;\n  text-align: center;\n}\n.ff-action-btn:hover { border-color: var(--accent); background: var(--accent-dim); }\n.ff-action-btn-icon { font-size: 1.2rem; }\n.ff-action-btn-label { font-size: .72rem; font-weight: 600; color: var(--text); line-height: 1.3; }\n\n/* Show mechanic overlay */\n.ff-mech {\n  position: fixed; inset: 0;\n  background: #fff;\n  z-index: 9999;\n  overflow-y: auto;\n  font-family: 'Sora', sans-serif;\n  color: #111;\n  animation: slideUp .25s ease;\n}\n@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: none; opacity: 1; } }\n\n.ff-mech-close {\n  position: fixed; top: 12px; right: 12px;\n  background: #111; color: #fff;\n  border: none; border-radius: 50%;\n  width: 34px; height: 34px;\n  font-size: .85rem; cursor: pointer;\n  z-index: 10000;\n  display: flex; align-items: center; justify-content: center;\n}\n.ff-mech-inner { max-width: 440px; margin: 0 auto; padding: 36px 22px 60px; }\n.ff-mech-logo { font-family: 'Bebas Neue', sans-serif; font-size: 1.2rem; letter-spacing: 3px; color: #111; margin-bottom: 3px; }\n.ff-mech-logo em { color: #e67e00; font-style: normal; }\n.ff-mech-ts { font-family: 'DM Mono', monospace; font-size: .61rem; color: #aaa; margin-bottom: 26px; }\n.ff-mech-vehicle { font-family: 'DM Mono', monospace; font-size: .68rem; color: #777; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 3px; }\n.ff-mech-job { font-size: 1.25rem; font-weight: 700; color: #111; margin-bottom: 22px; line-height: 1.2; }\n.ff-mech-sec { font-family: 'DM Mono', monospace; font-size: .59rem; text-transform: uppercase; letter-spacing: 1.5px; color: #aaa; margin-bottom: 7px; padding-bottom: 5px; border-bottom: 1px solid #eee; }\n.ff-mech-range { font-family: 'Bebas Neue', sans-serif; font-size: 2.8rem; letter-spacing: 1px; color: #111; line-height: 1; margin-bottom: 3px; }\n.ff-mech-range-sub { font-size: .78rem; color: #666; margin-bottom: 16px; }\n.ff-mech-qrow { display: flex; justify-content: space-between; align-items: center; background: #fff8f0; border: 1.5px solid #e67e00; border-radius: 9px; padding: 12px 15px; margin-bottom: 16px; }\n.ff-mech-ql { font-family: 'DM Mono', monospace; font-size: .6rem; text-transform: uppercase; letter-spacing: 1px; color: #888; }\n.ff-mech-qv { font-family: 'Bebas Neue', sans-serif; font-size: 1.7rem; letter-spacing: 1px; }\n.ff-mech-qv.over { color: #e53e3e; } .ff-mech-qv.ok { color: #276749; }\n.ff-mech-score { display: flex; align-items: center; gap: 10px; padding: 12px; background: #f9f9f9; border-radius: 9px; margin-bottom: 18px; }\n.ff-mech-score-n { font-family: 'Bebas Neue', sans-serif; font-size: 2.2rem; letter-spacing: 1px; line-height: 1; }\n.ff-mech-score-l { font-size: .82rem; font-weight: 600; }\n.ff-mech-disc { font-size: .63rem; color: #bbb; line-height: 1.6; margin-top: 20px; padding-top: 14px; border-top: 1px solid #eee; }\n.ff-mech-btns { display: flex; gap: 7px; margin-top: 14px; }\n.ff-mech-btn { flex: 1; padding: 11px; border-radius: 8px; border: 1.5px solid #ddd; background: #fff; color: #333; font-family: 'Sora', sans-serif; font-size: .78rem; font-weight: 600; cursor: pointer; transition: all .15s; display: flex; align-items: center; justify-content: center; gap: 5px; }\n.ff-mech-btn:hover { border-color: #111; background: #111; color: #fff; }\n\n/* Savings overlay */\n.ff-sav-overlay {\n  position: fixed; inset: 0;\n  background: rgba(0,0,0,.88);\n  z-index: 9998;\n  display: flex; align-items: center; justify-content: center;\n  padding: 20px;\n  animation: fadeIn .2s ease;\n}\n@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n.ff-sav-card {\n  background: #fff; border-radius: 18px;\n  padding: 32px 26px;\n  max-width: 360px; width: 100%;\n  text-align: center;\n  font-family: 'Sora', sans-serif; color: #111;\n}\n.ff-sav-logo { font-family: 'Bebas Neue', sans-serif; font-size: 1.1rem; letter-spacing: 3px; margin-bottom: 14px; }\n.ff-sav-logo em { color: #e67e00; font-style: normal; }\n.ff-sav-big { font-family: 'Bebas Neue', sans-serif; font-size: 2.4rem; letter-spacing: 1px; line-height: 1; margin-bottom: 3px; }\n.ff-sav-on { font-size: .82rem; color: #888; margin-bottom: 18px; }\n.ff-sav-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: .83rem; }\n.ff-sav-row:last-of-type { border-bottom: none; }\n.ff-sav-row-l { color: #888; } .ff-sav-row-v { font-weight: 600; }\n.ff-sav-row-v.green { color: #22c55e; } .ff-sav-row-v.red { color: #e53e3e; }\n.ff-sav-inp { border: 1.5px solid #e5e7eb; border-radius: 7px; padding: 8px 11px; width: 100%; margin: 8px 0 4px; font-family: 'Sora', sans-serif; font-size: .86rem; color: #111; outline: none; }\n.ff-sav-inp:focus { border-color: #e67e00; }\n.ff-sav-share { width: 100%; margin-top: 16px; padding: 12px; background: #111; color: #fff; border: none; border-radius: 9px; font-family: 'Bebas Neue', sans-serif; font-size: 1rem; letter-spacing: 1.5px; cursor: pointer; }\n.ff-sav-share:hover { background: #333; }\n.ff-sav-close { margin-top: 8px; background: none; border: none; color: #aaa; font-size: .75rem; cursor: pointer; font-family: 'Sora', sans-serif; }\n\n/* Symptom causes */\n.ff-cause {\n  background: var(--surf);\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  padding: 13px;\n  margin-bottom: 8px;\n}\n.ff-cause:last-child { margin-bottom: 0; }\n.ff-cause-rank { font-family: 'DM Mono', monospace; font-size: .6rem; color: var(--sub); margin-bottom: 3px; }\n.ff-cause-name { font-size: .9rem; font-weight: 600; color: var(--text); margin-bottom: 4px; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }\n.ff-cause-desc { font-size: .78rem; color: var(--sub); line-height: 1.5; margin-bottom: 8px; }\n.ff-cause-check { font-size: .75rem; color: var(--blue); background: rgba(59,130,246,.08); border: 1px solid rgba(59,130,246,.18); border-radius: 7px; padding: 7px 10px; margin-top: 7px; line-height: 1.5; }\n\n/* Gate */\n.ff-gate { background: var(--card); border: 1.5px solid var(--accent); border-radius: 13px; padding: 28px 18px; text-align: center; margin: 18px; }\n.ff-gate-icon { font-size: 2rem; margin-bottom: 9px; }\n.ff-gate-t { font-family: 'Bebas Neue', sans-serif; font-size: 1.6rem; letter-spacing: 2px; color: var(--accent); margin-bottom: 6px; }\n.ff-gate-s { color: var(--sub); font-size: .84rem; line-height: 1.6; margin-bottom: 16px; }\n.ff-gate-plans { display: flex; gap: 7px; justify-content: center; margin-bottom: 12px; }\n.ff-plan { background: var(--surf); border: 1px solid var(--border); border-radius: 9px; padding: 12px 16px; cursor: pointer; transition: border-color .15s; min-width: 110px; }\n.ff-plan:hover { border-color: var(--accent); }\n.ff-plan-p { font-family: 'Bebas Neue', sans-serif; font-size: 1.4rem; color: var(--accent); }\n.ff-plan-n { font-size: .67rem; color: var(--sub); font-family: 'DM Mono', monospace; text-transform: uppercase; }\n\n/* Div + reset */\n.ff-div { height: 1px; background: var(--border); margin: 10px 0; }\n.ff-reset { background: transparent; border: 1px solid var(--border); color: var(--sub); border-radius: 7px; padding: 8px 14px; font-family: 'Sora', sans-serif; font-size: .78rem; cursor: pointer; transition: all .13s; display: flex; align-items: center; gap: 4px; margin: 0 auto; }\n.ff-reset:hover { border-color: var(--text); color: var(--text); }\n\n/* Animations */\n@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }\n.a0 { animation: fadeUp .3s ease both; }\n.a1 { animation: fadeUp .3s .05s ease both; }\n.a2 { animation: fadeUp .3s .1s ease both; }\n.a3 { animation: fadeUp .3s .15s ease both; }\n.a4 { animation: fadeUp .3s .2s ease both; }\n.a5 { animation: fadeUp .3s .25s ease both; }\n";


// -----------------------------------------------------------------------------
// SHOW MECHANIC OVERLAY
// -----------------------------------------------------------------------------
function MechOverlay({ result, form, onClose }) {
  const d = result?.data;
  const fairLow = d?.totalLow ?? d?.totalFairLow;
  const fairHigh = d?.totalHigh ?? d?.totalFairHigh;
  const quoted = parseFloat(form.quote) || d?.totalQuoted;
  const sc = d?.fairnessScore;
  const scC = scoreColor(sc);
  const isOver = quoted && fairHigh && quoted > fairHigh * 1.05;
  const vehicle = [form.year, form.make, form.model].filter(Boolean).join(" ");
  const ts = new Date().toLocaleString("en-US", { month:"long", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit" });

  function share() {
    const txt = `FixFair Report\n${d?.jobTitle||"Repair"} - ${vehicle}\n\nTypical fair price: ${fmt(fairLow)}-${fmt(fairHigh)}${quoted ? `\nShop quote: ${fmt(quoted)}` : ""}\n\nVerified at fixfair.app`;
    if (navigator.share) navigator.share({ text: txt });
    else { navigator.clipboard?.writeText(txt); alert("Report copied!"); }
  }

  return (
    <div className="ff-mech">
      <button className="ff-mech-close" onClick={onClose}> </button>
      <div className="ff-mech-inner">
        <div className="ff-mech-logo">Fix<em>Fair</em></div>
        <div className="ff-mech-ts">Generated {ts}</div>
        {vehicle && <div className="ff-mech-vehicle">{vehicle}</div>}
        <div className="ff-mech-job">{d?.jobTitle || "Repair Estimate"}</div>

        <div className="ff-mech-sec">Typical Fair Price Range</div>
        <div className="ff-mech-range">{fmt(fairLow)} - {fmt(fairHigh)}</div>
        <div className="ff-mech-range-sub">Based on {d?.laborHours || "typical"} labor hours at ${d?.laborRateLow||95}-${d?.laborRateHigh||150}/hr plus market parts pricing</div>

        {quoted && (<>
          <div className="ff-mech-sec" style={{marginTop:16}}>This Estimate</div>
          <div className="ff-mech-qrow">
            <div>
              <div className="ff-mech-ql">Quote Amount</div>
              <div className={`ff-mech-qv ${isOver ? "over" : "ok"}`}>{fmt(quoted)}</div>
            </div>
            <div style={{fontSize:"1.5rem"}}>{isOver ? "  " : " "}</div>
          </div>
        </>)}

        {sc != null && (<>
          <div className="ff-mech-sec">Fairness Rating</div>
          <div className="ff-mech-score">
            <div className="ff-mech-score-n" style={{color:scC}}>{sc}</div>
            <div>
              <div className="ff-mech-score-l" style={{color:scC}}>{scoreEmoji(sc)} {d?.fairnessLabel}</div>
              <div style={{fontSize:".72rem",color:"#888",marginTop:"2px"}}>{d?.verdictNote || "vs. regional market rates"}</div>
            </div>
          </div>
        </>)}

        {d?.misdiagnoses?.length > 0 && (<>
          <div className="ff-mech-sec" style={{marginTop:16}}>Possible Cheaper Alternatives</div>
          {d.misdiagnoses.slice(0,2).map((m,i) => (
            <div key={i} style={{background:"#f0f7ff",borderRadius:"8px",padding:"10px 12px",marginBottom:"7px",borderLeft:"3px solid #3b82f6"}}>
              <div style={{fontSize:".78rem",fontWeight:600,color:"#1e40af",marginBottom:"3px"}}>Instead of: {m.expensiveFix}</div>
              <div style={{fontSize:".74rem",color:"#374151"}}>Check first: {m.cheaperAlternative} - saves {m.savingsRange}</div>
            </div>
          ))}
        </>)}

        <div className="ff-mech-disc">FixFair provides educational repair cost estimates based on typical US market data. Actual costs vary by vehicle condition, location, and shop. This report is for informational purposes only and does not constitute professional automotive advice.</div>
        <div className="ff-mech-btns">
          <button className="ff-mech-btn" onClick={share}>  Share Report</button>
          <button className="ff-mech-btn" onClick={onClose}>  Back</button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SAVINGS OVERLAY
// -----------------------------------------------------------------------------
function SavingsOverlay({ result, form, onClose }) {
  const d = result?.data;
  const fairLow = d?.totalLow ?? d?.totalFairLow;
  const fairHigh = d?.totalHigh ?? d?.totalFairHigh;
  const quoted = parseFloat(form.quote) || d?.totalQuoted;
  const [paidStr, setPaidStr] = useState(quoted ? String(Math.round(quoted * 0.78)) : "");
  const paid = parseFloat(paidStr);
  const saved = quoted && paid && paid < quoted ? Math.round(quoted - paid) : null;
  const potential = quoted && fairHigh && quoted > fairHigh ? Math.round(quoted - ((fairLow + fairHigh) / 2)) : null;
  const repairName = d?.jobTitle || "Car Repair";

  function share() {
    const txt = saved
      ? `  I saved ${fmt(saved)} on my car repair!\n\nRepair: ${repairName}\nOriginal quote: ${fmt(quoted)}\nWhat I paid: ${fmt(paid)}\n\nChecked with FixFair   fixfair.app`
      : `FixFair says ${repairName} should cost ${fmt(fairLow)}-${fmt(fairHigh)}.\nI was quoted ${fmt(quoted)}.\n\nGet your fair price   fixfair.app`;
    if (navigator.share) navigator.share({ text: txt });
    else { navigator.clipboard?.writeText(txt); alert("Copied to clipboard!"); }
  }

  return (
    <div className="ff-sav-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ff-sav-card">
        <div className="ff-sav-logo">Fix<em>Fair</em></div>
        {saved ? (<>
          <div className="ff-sav-big" style={{color:"#22c55e"}}>{fmt(saved)}</div>
          <div className="ff-sav-on">saved on {repairName}</div>
        </>) : (<>
          <div className="ff-sav-big" style={{color:"#e67e00"}}>Up to {fmt(potential || (fairHigh ? Math.round(fairHigh * 0.3) : 200))}</div>
          <div className="ff-sav-on">potential savings on {repairName}</div>
        </>)}
        <div className="ff-sav-row"><span className="ff-sav-row-l">Fair price range</span><span className="ff-sav-row-v">{fmt(fairLow)}-{fmt(fairHigh)}</span></div>
        {quoted && <div className="ff-sav-row"><span className="ff-sav-row-l">Original quote</span><span className="ff-sav-row-v red">{fmt(quoted)}</span></div>}
        {saved && <div className="ff-sav-row"><span className="ff-sav-row-l">What I paid</span><span className="ff-sav-row-v">{fmt(paid)}</span></div>}
        {saved && <div className="ff-sav-row"><span className="ff-sav-row-l">Total saved</span><span className="ff-sav-row-v green">+{fmt(saved)}</span></div>}
        {!saved && quoted && (<>
          <div style={{fontSize:".76rem",color:"#888",margin:"10px 0 4px",textAlign:"left"}}>Enter what you actually paid:</div>
          <input className="ff-sav-inp" type="number" placeholder={`e.g. ${Math.round(quoted * 0.75)}`} value={paidStr} onChange={e => setPaidStr(e.target.value)} />
        </>)}
        <button className="ff-sav-share" onClick={share}>  Share My Savings</button>
        <button className="ff-sav-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// RESULT VIEW
// -----------------------------------------------------------------------------
function ResultView({ result, form, onReset, onShowMech, onShowSavings }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));

  if (result.type === "estimate" || result.type === "quote") {
    const d = result.data;
    const isEstimate = result.type === "estimate";
    const fairLow = isEstimate ? d.totalLow : d.totalFairLow;
    const fairHigh = isEstimate ? d.totalHigh : d.totalFairHigh;
    const quoted = parseFloat(form.quote) || d?.totalQuoted;
    const hasQuote = !!quoted && !isNaN(quoted);
    const sc = d.fairnessScore;
    const scC = scoreColor(sc);
    const vehicle = [form.year, form.make, form.model].filter(Boolean).join(" ");

    const quoteColor = hasQuote
      ? (quoted > (fairHigh || 0) * 1.1 ? "red" : quoted < (fairLow || 0) * 0.95 ? "green" : "yellow")
      : "neutral";

    return (
      <div className="ff-result">
        {/* -- ANSWER HERO -- */}
        <div className="ff-answer-hero a0">
          {vehicle && <div className="ff-answer-vehicle">{vehicle}</div>}
          <div className="ff-answer-job">{d.jobTitle || "Repair Analysis"}</div>

          <div className="ff-price-block">
            <div className="ff-price-label">Typical Fair Price Range</div>
            <div className="ff-price-range">{fmt(fairLow)} <span style={{color:"var(--sub)"}}>-</span> <em>{fmt(fairHigh)}</em></div>
          </div>

          {hasQuote && (
            <div className="ff-compare">
              <div className="ff-compare-cell">
                <div className="ff-compare-label">Fair Range</div>
                <div className="ff-compare-val green">{fmt(fairLow)}-{fmt(fairHigh)}</div>
              </div>
              <div className="ff-compare-cell">
                <div className="ff-compare-label">Your Quote</div>
                <div className={`ff-compare-val ${quoteColor}`}>{fmt(quoted)}</div>
              </div>
              {quoted > (fairHigh || 0) && (
                <div className="ff-compare-cell">
                  <div className="ff-compare-label">Could Save</div>
                  <div className="ff-compare-val" style={{color:"var(--green)"}}>up to {fmt(Math.round(quoted - fairLow))}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* -- SCORE -- */}
        {sc != null && hasQuote && (
          <div className="ff-score-strip a1" style={{background:`${scC}11`, borderColor:`${scC}33`}}>
            <div className="ff-score-num" style={{color:scC}}>{sc}</div>
            <div className="ff-score-info">
              <div className="ff-score-label" style={{color:scC}}>{scoreEmoji(sc)} {d.fairnessLabel}</div>
              {d.verdictNote && <div className="ff-score-note">{d.verdictNote}</div>}
              <div className="ff-gauge">
                <div className="ff-gauge-fill" style={{width:`${sc}%`, background:`linear-gradient(90deg,${scC}88,${scC})`}} />
                <div className="ff-gauge-pin" style={{left:`${sc}%`, background:scC}} />
              </div>
            </div>
          </div>
        )}

        {/* -- ONE LINER -- */}
        {d.oneLiner && <div className="ff-one-liner a1">{d.oneLiner}</div>}

        {/* -- DO YOU NEED THIS -- */}
        {d.doYouNeedThis?.length > 0 && (
          <div className="ff-card a2">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--blue)"}}/>Do You Actually Need This?</div>
            </div>
            <div className="ff-card-body" style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {d.doYouNeedThis.map((item, i) => {
                const c = {"Likely Needed":"green","Verify First":"yellow","Get Second Opinion":"red"}[item.verdict] || "muted";
                return (
                  <div key={i} className={`ff-need ${c}`}>
                    <div className="ff-need-verdict">{item.verdict}</div>
                    <div className="ff-need-repair">{item.repair}</div>
                    <div className="ff-need-reason">{item.reason}</div>
                    {item.cheaperAlternative && <div className="ff-need-alt">  Check first: {item.cheaperAlternative} ({item.alternativeCost})</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* -- CHEAPER CAUSES -- */}
        {d.misdiagnoses?.length > 0 && (
          <div className="ff-card a2">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--blue)"}}/>Cheaper Causes to Rule Out First</div>
              <button className="ff-expand-btn" onClick={() => toggle("misdiag")}>{expanded.misdiag ? "  hide" : "  show"}</button>
            </div>
            {expanded.misdiag && (
              <div className="ff-card-body">
                {d.misdiagnoses.map((m, i) => (
                  <div key={i} className="ff-cause-alt">
                    <div className="ff-cause-alt-head">
                      <div className="ff-cause-alt-name">Instead of: {m.expensiveFix}</div>
                      <span className={`ff-badge ${m.likelihood==="Common"?"red":m.likelihood==="Possible"?"yellow":"muted"}`}>{m.likelihood}</span>
                    </div>
                    <div className="ff-cause-alt-tip">  Check first: {m.cheaperAlternative}</div>
                    <div className="ff-cause-alt-save">Potential savings: {m.savingsRange}   {m.checkFirst}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* -- LINE ITEMS (quote mode) -- */}
        {result.type === "quote" && d.lineItems?.length > 0 && (
          <div className="ff-card a2">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot"/>Line-by-Line</div>
              <button className="ff-expand-btn" onClick={() => toggle("items")}>{expanded.items ? "  hide" : "  show"}</button>
            </div>
            {expanded.items && (
              <div className="ff-card-body" style={{padding:"0 0 4px"}}>
                <table className="ff-tbl">
                  <thead><tr><th>Item</th><th>Quoted</th><th>Fair</th><th></th></tr></thead>
                  <tbody>
                    {d.lineItems.map((item, i) => {
                      const sc2 = {FAIR:"green",SLIGHTLY_HIGH:"yellow",HIGH:"orange",VERY_HIGH:"red",SUSPICIOUS:"red",UNKNOWN:"muted"}[item.status]||"muted";
                      return (
                        <tr key={i}>
                          <td>
                            <div style={{fontWeight:500}}>{item.description}</div>
                            {item.laborHoursQuoted && item.laborHoursFair && Math.abs(item.laborHoursQuoted - item.laborHoursFair) > 0.5 && (
                              <div style={{fontSize:".68rem",color:"var(--orange)",marginTop:"2px"}}>  {item.laborHoursQuoted}h vs {item.laborHoursFair}h typical</div>
                            )}
                            {item.note && <div style={{fontSize:".7rem",color:"var(--sub)",marginTop:"2px",lineHeight:1.4}}>{item.note}</div>}
                          </td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:".76rem"}}>{fmt(item.quotedPrice)}</td>
                          <td style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem",color:"var(--sub)"}}>{item.fairLow != null ? `${fmt(item.fairLow)}-${fmt(item.fairHigh)}` : "-"}</td>
                          <td><span className={`ff-badge ${sc2}`}>{item.markupPct && item.markupPct > 15 ? `+${Math.round(item.markupPct)}%` : ({FAIR:" ",SLIGHTLY_HIGH:"~",HIGH:" ",VERY_HIGH:"  ",SUSPICIOUS:" ",UNKNOWN:"?"}[item.status]||"?")}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* -- DETAILS (estimate mode) - progressive disclosure -- */}
        {isEstimate && (
          <div className="ff-card a3">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot"/>How We Calculated This</div>
              <button className="ff-expand-btn" onClick={() => toggle("breakdown")}>{expanded.breakdown ? "  hide" : "  see details"}</button>
            </div>
            {expanded.breakdown && (
              <div className="ff-card-body">
                <div className="ff-breakdown">
                  {[
                    {l:"Parts", v:`${fmt(d.partsLow)}-${fmt(d.partsHigh)}`},
                    {l:`Labor (${d.laborHours}h)`, v:`${fmt(d.laborLow)}-${fmt(d.laborHigh)}`},
                    {l:"Labor Rate", v:`$${d.laborRateLow}-$${d.laborRateHigh}/hr`},
                  ].map((c,i) => (
                    <div key={i} className="ff-bdown-cell">
                      <div className="ff-bdown-label">{c.l}</div>
                      <div className="ff-bdown-val">{c.v}</div>
                    </div>
                  ))}
                </div>
                {d.partsNotes && <p style={{fontSize:".78rem",color:"var(--sub)",lineHeight:1.5,marginBottom:"8px"}}>{d.partsNotes}</p>}
                {d.regionalNote && <p style={{fontSize:".76rem",color:"var(--sub)",lineHeight:1.5}}>  {d.regionalNote}</p>}
              </div>
            )}
          </div>
        )}

        {/* -- RED FLAGS + TIPS -- */}
        {(d.redFlags?.length > 0 || d.negotiationTips?.length > 0 || d.recommendations?.length > 0) && (
          <div className="ff-card a3">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--green)"}}/>What To Do</div>
              <button className="ff-expand-btn" onClick={() => toggle("tips")}>{expanded.tips ? "  hide" : "  show"}</button>
            </div>
            {expanded.tips && (
              <div className="ff-card-body" style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                {d.redFlags?.length > 0 && (
                  <div>
                    <div style={{fontSize:".65rem",fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"1px",color:"var(--red)",marginBottom:"7px"}}>Watch For</div>
                    <ul className="ff-lst">{d.redFlags.map((f,i) => <li key={i} className="ff-li"><span className="ff-bul" style={{color:"var(--red)"}}> </span>{f}</li>)}</ul>
                  </div>
                )}
                {(d.negotiationTips?.length > 0 || d.recommendations?.length > 0) && (
                  <div>
                    <div style={{fontSize:".65rem",fontFamily:"'DM Mono',monospace",textTransform:"uppercase",letterSpacing:"1px",color:"var(--green)",marginBottom:"7px"}}>Negotiation Tips</div>
                    <ul className="ff-lst">{(d.negotiationTips || d.recommendations || []).map((t,i) => <li key={i} className="ff-li"><span className="ff-bul" style={{color:"var(--green)"}}> </span>{t}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* -- DIY -- */}
        {isEstimate && d.diyDifficulty && (
          <div className="ff-card a4">
            <div className="ff-card-hd">
              <div className="ff-card-hd-left"><div className="ff-card-dot"/>DIY vs Shop</div>
              <button className="ff-expand-btn" onClick={() => toggle("diy")}>{expanded.diy ? "  hide" : "  show"}</button>
            </div>
            {expanded.diy && (
              <div className="ff-card-body">
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px",flexWrap:"wrap"}}>
                  <span style={{fontSize:".8rem",color:"var(--sub)"}}>Difficulty:</span>
                  <span className={`ff-badge ${d.diyDifficulty==="Easy"?"green":d.diyDifficulty==="Moderate"?"yellow":"red"}`}>{d.diyDifficulty}</span>
                  {d.diySavings && <span style={{fontSize:".76rem",color:"var(--green)"}}>{d.diySavings}</span>}
                </div>
                <p style={{fontSize:".8rem",color:"var(--sub)",lineHeight:1.5}}>{d.diyNote}</p>
              </div>
            )}
          </div>
        )}

        {/* -- PARTS + AFFILIATES -- */}
        {d.partsLinks?.length > 0 && (
          <div className="ff-aff a4">
            <div className="ff-aff-title">  Source Parts & Get Second Opinions</div>
            <div className="ff-parts-row">
              {d.partsLinks.map((p,i) => (
                <a key={i} className="ff-plink" href={`https://www.rockauto.com/en/catalog/#${encodeURIComponent(p.rockAuto||p.name)}`} target="_blank" rel="noreferrer">  {p.name}  </a>
              ))}
              <a className="ff-plink" href="https://www.yourmechanic.com" target="_blank" rel="noreferrer">YourMechanic  </a>
              <a className="ff-plink" href="https://repairpal.com" target="_blank" rel="noreferrer">RepairPal  </a>
            </div>
          </div>
        )}

        {/* -- ACTIONS -- */}
        <div className="ff-action-row a5">
          <button className="ff-action-btn" onClick={onShowMech}>
            <div className="ff-action-btn-icon"> </div>
            <div className="ff-action-btn-label">Show My Mechanic</div>
          </button>
          <button className="ff-action-btn" onClick={onShowSavings}>
            <div className="ff-action-btn-icon"> </div>
            <div className="ff-action-btn-label">Savings Receipt</div>
          </button>
          <button className="ff-action-btn" onClick={onReset}>
            <div className="ff-action-btn-icon"> </div>
            <div className="ff-action-btn-label">New Check</div>
          </button>
        </div>
      </div>
    );
  }

  // -- SYMPTOM RESULT --
  if (result.type === "symptom") {
    const d = result.data;
    const vehicle = [form.year, form.make, form.model].filter(Boolean).join(" ");
    return (
      <div className="ff-result">
        <div className="ff-answer-hero a0">
          {vehicle && <div className="ff-answer-vehicle">{vehicle}</div>}
          <div className="ff-answer-job">Second Opinion</div>
          <div className="ff-price-block">
            <div className="ff-price-label">Estimated Repair Range</div>
            <div className="ff-price-range">{fmt(d.totalRangeLow)} <span style={{color:"var(--sub)"}}>-</span> <em>{fmt(d.totalRangeHigh)}</em></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"12px",flexWrap:"wrap"}}>
            <span className={`ff-badge ${d.urgency==="URGENT"?"red":d.urgency==="SOON"?"yellow":"green"}`}>
              {d.urgency==="URGENT"?"  Urgent":d.urgency==="SOON"?"  Fix Soon":"  Monitor"}
            </span>
            <span style={{fontSize:".78rem",color:"var(--sub)"}}>{d.urgencyNote}</span>
          </div>
        </div>

        {d.oneLiner && <div className="ff-one-liner a1">{d.oneLiner}</div>}

        {d.dtcExplanation && (
          <div className="ff-card a1">
            <div className="ff-card-hd"><div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--blue)"}}/>What That Code Means</div></div>
            <div className="ff-card-body" style={{fontSize:".86rem",lineHeight:1.6,color:"var(--text)"}}>{d.dtcExplanation}</div>
          </div>
        )}

        <div className="ff-card a2">
          <div className="ff-card-hd"><div className="ff-card-hd-left"><div className="ff-card-dot"/>Most Likely Causes - Cheapest First</div></div>
          <div className="ff-card-body">
            {d.causes?.map((c, i) => {
              const lc = {"Very Likely":"red","Likely":"yellow","Possible":"blue","Unlikely":"muted"}[c.likelihood]||"muted";
              return (
                <div key={i} className="ff-cause">
                  <div className="ff-cause-rank">#{c.rank} Most Likely Cause</div>
                  <div className="ff-cause-name">
                    {c.name}
                    <span className={`ff-badge ${lc}`}>{c.likelihood}</span>
                  </div>
                  <div className="ff-cause-desc">{c.description}</div>
                  <div style={{display:"flex",gap:"7px",alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"1.1rem",color:"var(--accent)",letterSpacing:"1px"}}>{fmt(c.repairLow)}-{fmt(c.repairHigh)}</span>
                    <span className={`ff-badge ${c.diyDifficulty==="Easy"?"green":c.diyDifficulty==="Moderate"?"yellow":"red"}`}>DIY: {c.diyDifficulty}</span>
                    <span style={{fontSize:".7rem",color:"var(--sub)"}}>{c.timeToFix}</span>
                  </div>
                  <div className="ff-cause-check">  Check first: {c.checkFirst}</div>
                </div>
              );
            })}
          </div>
        </div>

        {d.diagnosticTips?.length > 0 && (
          <div className="ff-card a3">
            <div className="ff-card-hd"><div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--green)"}}/>Check These Before Going to a Shop</div></div>
            <div className="ff-card-body"><ul className="ff-lst">{d.diagnosticTips.map((t,i) => <li key={i} className="ff-li"><span className="ff-bul" style={{color:"var(--green)"}}> </span>{t}</li>)}</ul></div>
          </div>
        )}

        {d.redFlags?.length > 0 && (
          <div className="ff-card a3">
            <div className="ff-card-hd"><div className="ff-card-hd-left"><div className="ff-card-dot" style={{background:"var(--red)"}}/>Signs a Shop May Be Upselling</div></div>
            <div className="ff-card-body"><ul className="ff-lst">{d.redFlags.map((f,i) => <li key={i} className="ff-li"><span className="ff-bul" style={{color:"var(--red)"}}> </span>{f}</li>)}</ul></div>
          </div>
        )}

        <div className="ff-aff a4">
          <div className="ff-aff-title">  Find a Vetted Shop</div>
          <div className="ff-parts-row" style={{marginTop:"6px"}}>
            <a className="ff-plink" href="https://www.yourmechanic.com" target="_blank" rel="noreferrer">YourMechanic  </a>
            <a className="ff-plink" href="https://repairpal.com" target="_blank" rel="noreferrer">RepairPal  </a>
          </div>
        </div>

        <button className="ff-reset a4" style={{marginTop:"8px"}} onClick={onReset}>  New Check</button>
      </div>
    );
  }

  return null;
}

// -----------------------------------------------------------------------------
// MAIN APP
// -----------------------------------------------------------------------------
export default function FixFair() {
  // Inject Google Fonts
  useEffect(() => {
    const existing = document.getElementById("ff-fonts");
    if (!existing) {
      const link = document.createElement("link");
      link.id = "ff-fonts";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // nav: "home" | "scan" | "manual" | "code" | "loading" | "result" | "gate"
  const [nav, setNav] = useState("home");
  const [form, setForm] = useState({ year:"", make:"", model:"", mileage:"", zip:"", issue:"", quote:"", dtc:"", symptoms:"" });
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [loadMsg, setLoadMsg] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [uses, setUses] = useState(getUses());
  const [showMech, setShowMech] = useState(false);
  const [showSavings, setShowSavings] = useState(false);
  const [history, setHistory] = useState(getHistory());
  const fileRef = useRef();
  const upd = (k, v) => setForm(f => ({...f, [k]: v}));

  const remainingChecks = Math.max(0, FREE_CHECKS - uses);

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = e => { const b64 = e.target.result.split(",")[1]; setImage({b64, mime:file.type, preview:e.target.result}); };
    r.readAsDataURL(file);
  }

  const canSubmit = {
    scan: form.year && form.make && form.model && image,
    manual: form.year && form.make && form.model && form.issue.trim().length > 4,
    code: form.symptoms.trim().length > 3,
  }[nav] || false;

  async function submit() {
    if (uses >= FREE_CHECKS) { setNav("gate"); return; }
    const mode = nav;
    setNav("loading");
    setLoadStep(0);
    setError(null);
    setResult(null);

    const steps = LOAD_MSGS[mode] || LOAD_MSGS.manual;
    steps.forEach((msg, i) => setTimeout(() => { setLoadMsg(msg); setLoadStep(i); }, i * 1100));

    const vehicle = `${form.year} ${form.make} ${form.model}${form.mileage ? ` (${parseInt(form.mileage).toLocaleString()} miles)` : ""}`;
    const loc = form.zip ? `ZIP: ${form.zip}` : "";

    try {
      let data, type;
      if (mode === "scan") {
        data = await aiCall(QUOTE_SYS, `Vehicle: ${vehicle}\n${loc}\nAnalyze this repair estimate. Flag items above market rate. Compare labor hours to typical.`, image.b64, image.mime);
        type = "quote";
      } else if (mode === "manual") {
        data = await aiCall(EST_SYS, `Vehicle: ${vehicle}\n${loc}\n${form.dtc ? `DTC: ${form.dtc}\n` : ""}Repair described: ${form.issue}${form.quote ? `\nShop's quote: $${form.quote}` : ""}`, null, null);
        type = "estimate";
      } else {
        data = await aiCall(SYMPTOM_SYS, `Vehicle: ${vehicle}\n${loc}\n${form.dtc ? `DTC: ${form.dtc}\n` : ""}Symptoms: ${form.symptoms}\nStart with cheapest most common causes.`, null, null);
        type = "symptom";
      }

      const fairLow = data.totalLow || data.totalFairLow || data.totalRangeLow;
      const fairHigh = data.totalHigh || data.totalFairHigh || data.totalRangeHigh;
      const entry = {
        job: data.jobTitle || "Repair",
        vehicle: [form.year, form.make, form.model].filter(Boolean).join(" "),
        date: new Date().toLocaleDateString("en-US", {month:"short", day:"numeric"}),
        fairLow, fairHigh,
        score: data.fairnessScore,
        quoted: parseFloat(form.quote) || data.totalQuoted || null,
      };
      addHistory(entry);
      setHistory(getHistory());
      setResult({ type, data });
      incUses();
      setUses(getUses());
      setNav("result");
    } catch (e) {
      setError("Analysis failed - please try again.");
      console.error(e);
      setNav(mode);
    }
  }

  function goHome() {
    setNav("home");
    setResult(null);
    setError(null);
    setImage(null);
    setForm({ year:"", make:"", model:"", mileage:"", zip:"", issue:"", quote:"", dtc:"", symptoms:"" });
  }

  const LOAD_STEPS = LOAD_MSGS[nav === "loading" ? "scan" : nav] || LOAD_MSGS.manual;

  // -- VEHICLE ROW (shared between scan/manual) ------------------------------
  const VehicleRow = () => (
    <>
      <div className="ff-r3">
        <div className="ff-fld"><label className="ff-lbl">Year</label>
          <select className="ff-sel" value={form.year} onChange={e => upd("year", e.target.value)}>
            <option value="">Year</option>{YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="ff-fld"><label className="ff-lbl">Make</label>
          <select className="ff-sel" value={form.make} onChange={e => upd("make", e.target.value)}>
            <option value="">Make</option>{MAKES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="ff-fld"><label className="ff-lbl">Model</label>
          <input className="ff-inp" placeholder="e.g. Jetta" value={form.model} onChange={e => upd("model", e.target.value)} />
        </div>
      </div>
      <div className="ff-r2">
        <div className="ff-fld"><label className="ff-lbl">Mileage (opt)</label>
          <input className="ff-inp" type="number" placeholder="e.g. 87000" value={form.mileage} onChange={e => upd("mileage", e.target.value)} />
        </div>
        <div className="ff-fld"><label className="ff-lbl">ZIP Code (opt)</label>
          <input className="ff-inp" placeholder="e.g. 28201" value={form.zip} onChange={e => upd("zip", e.target.value)} maxLength={5} />
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>

      {showMech && result && <MechOverlay result={result} form={form} onClose={() => setShowMech(false)} />}
      {showSavings && result && <SavingsOverlay result={result} form={form} onClose={() => setShowSavings(false)} />}

      <div className="ff-app">

        {/* --- HOME SCREEN --- */}
        {nav === "home" && (
          <div className="ff-home">
            {/* Top bar */}
            <div className="ff-topbar">
              <div className="ff-logo">Fix<em>Fair</em></div>
              <div className="ff-checks-pill" title="Free checks remaining"><b>{remainingChecks}</b> free checks left</div>
            </div>

            {/* Headline */}
            <div className="ff-hero-text">
              <div className="ff-headline">
                AI Second Opinion
                <em>For Car Repairs.</em>
              </div>
              <p className="ff-subline">Know the fair repair price before you approve anything.</p>
            </div>

            {/* CTA Zone */}
            <div className="ff-cta-zone">
              {/* PRIMARY: Big scan button */}
              <button className="ff-scan-btn" onClick={() => setNav("scan")}>
                <div className="ff-scan-inner">
                  <div className="ff-scan-icon"> </div>
                  <div className="ff-scan-label">Scan Repair Estimate</div>
                  <div className="ff-scan-desc">Photo or screenshot of any mechanic quote</div>
                </div>
              </button>

              {/* SECONDARY: Two smaller options */}
              <div className="ff-secondary">
                <div className="ff-sec-divider">or</div>
                <div className="ff-sec-actions">
                  <button className="ff-sec-btn" onClick={() => setNav("manual")}>
                    <div className="ff-sec-btn-icon"> </div>
                    <div className="ff-sec-btn-label">Enter Repair Manually</div>
                    <div className="ff-sec-btn-sub">Type the repair or issue</div>
                  </button>
                  <button className="ff-sec-btn" onClick={() => setNav("code")}>
                    <div className="ff-sec-btn-icon">  </div>
                    <div className="ff-sec-btn-label">Check Engine Light</div>
                    <div className="ff-sec-btn-sub">Symptoms or DTC code</div>
                  </button>
                </div>
              </div>
            </div>

            {/* History strip */}
            <div className="ff-bottom-strip">
              <div className="ff-history-peek">
                <div className="ff-hist-hd">
                  <div className="ff-hist-title"><div className="ff-hist-dot"/>Your Repair History</div>
                  {history.length > 0 && <div className="ff-hist-count">{history.length} saved</div>}
                </div>
                {history.length === 0 ? (
                  <div className="ff-no-history">
                    Your checked repairs will appear here.<br />
                    <span style={{color:"var(--accent)"}}>Run your first check above.</span>
                  </div>
                ) : (
                  history.slice(0, 3).map((h, i) => (
                    <div key={i} className="ff-hist-row">
                      <div>
                        <div className="ff-hist-job">{h.job}</div>
                        <div className="ff-hist-meta">{h.vehicle}   {h.date}</div>
                      </div>
                      <div>
                        <div className="ff-hist-score" style={{color: h.score ? scoreColor(h.score) : "var(--sub)", textAlign:"right"}}>
                          {h.score != null ? `${scoreEmoji(h.score)} ${h.score}` : `${fmt(h.fairLow)}-${fmt(h.fairHigh)}`}
                        </div>
                        {h.quoted && h.fairHigh && h.quoted > h.fairHigh && (
                          <div style={{fontSize:".62rem",color:"var(--green)",textAlign:"right",marginTop:"1px"}}>saved up to {fmt(Math.round(h.quoted - h.fairLow))}</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- SCAN SCREEN --- */}
        {nav === "scan" && (
          <div className="ff-screen">
            <div className="ff-screen-hdr">
              <button className="ff-back" onClick={goHome}> </button>
              <div className="ff-screen-title">Scan <em>Estimate</em></div>
            </div>
            <div className="ff-form">
              <VehicleRow />
              <div className="ff-fld">
                <label className="ff-lbl">Photo of Mechanic's Quote</label>
                <div className="ff-upzone" onClick={() => fileRef.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
                  {image ? (<>
                    <div style={{fontSize:".78rem",color:"var(--green)",marginBottom:"6px"}}>  Ready to analyze</div>
                    <img src={image.preview} alt="" className="ff-preview" />
                    <div style={{marginTop:"8px",fontSize:".7rem",color:"var(--sub)"}}>Tap to change photo</div>
                  </>) : (<>
                    <div className="ff-upzone-icon"> </div>
                    <div className="ff-upzone-title">Tap to upload estimate</div>
                    <div className="ff-upzone-sub">Photo or screenshot of the mechanic's quote</div>
                  </>)}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e => handleFile(e.target.files[0])} />
              </div>
              {error && <div style={{color:"var(--red)",fontSize:".82rem",padding:"9px",background:"rgba(239,68,68,.08)",borderRadius:"7px",border:"1px solid rgba(239,68,68,.22)"}}>{error}</div>}
              <button className="ff-submit" onClick={submit} disabled={!canSubmit}>  Analyze My Quote</button>
              <p style={{textAlign:"center",fontSize:".68rem",color:"var(--sub)"}}>{remainingChecks} of {FREE_CHECKS} free checks remaining</p>
            </div>
          </div>
        )}

        {/* --- MANUAL SCREEN --- */}
        {nav === "manual" && (
          <div className="ff-screen">
            <div className="ff-screen-hdr">
              <button className="ff-back" onClick={goHome}> </button>
              <div className="ff-screen-title">Get <em>Estimate</em></div>
            </div>
            <div className="ff-form">
              <VehicleRow />
              <div className="ff-fld">
                <label className="ff-lbl">Repair or Issue</label>
                <textarea className="ff-ta" placeholder="e.g. Shop says I need a turbocharger replacement. Car loses power uphill, throwing P2263." value={form.issue} onChange={e => upd("issue", e.target.value)} />
              </div>
              <div className="ff-r2">
                <div className="ff-fld">
                  <label className="ff-lbl">Their Quote (opt)</label>
                  <div className="ff-pw"><span className="ff-ps">$</span>
                    <input className="ff-inp" type="number" placeholder="e.g. 1450" value={form.quote} onChange={e => upd("quote", e.target.value)} />
                  </div>
                </div>
                <div className="ff-fld">
                  <label className="ff-lbl">DTC Code (opt)</label>
                  <input className="ff-inp" placeholder="e.g. P2263" value={form.dtc} onChange={e => upd("dtc", e.target.value.toUpperCase())} maxLength={6} />
                </div>
              </div>
              {error && <div style={{color:"var(--red)",fontSize:".82rem",padding:"9px",background:"rgba(239,68,68,.08)",borderRadius:"7px",border:"1px solid rgba(239,68,68,.22)"}}>{error}</div>}
              <button className="ff-submit" onClick={submit} disabled={!canSubmit}>  Get Fair Price Estimate</button>
              <p style={{textAlign:"center",fontSize:".68rem",color:"var(--sub)"}}>{remainingChecks} of {FREE_CHECKS} free checks remaining</p>
            </div>
          </div>
        )}

        {/* --- CODE / SYMPTOM SCREEN --- */}
        {nav === "code" && (
          <div className="ff-screen">
            <div className="ff-screen-hdr">
              <button className="ff-back" onClick={goHome}> </button>
              <div className="ff-screen-title">Second <em>Opinion</em></div>
            </div>
            <div className="ff-form">
              <div className="ff-r3">
                <div className="ff-fld"><label className="ff-lbl">Year</label>
                  <select className="ff-sel" value={form.year} onChange={e => upd("year", e.target.value)}>
                    <option value="">Year</option>{YEARS.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div className="ff-fld"><label className="ff-lbl">Make</label>
                  <select className="ff-sel" value={form.make} onChange={e => upd("make", e.target.value)}>
                    <option value="">Make</option>{MAKES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="ff-fld"><label className="ff-lbl">Model</label>
                  <input className="ff-inp" placeholder="e.g. Jetta" value={form.model} onChange={e => upd("model", e.target.value)} />
                </div>
              </div>
              <div className="ff-r2">
                <div className="ff-fld"><label className="ff-lbl">Mileage (opt)</label>
                  <input className="ff-inp" type="number" placeholder="e.g. 87000" value={form.mileage} onChange={e => upd("mileage", e.target.value)} />
                </div>
                <div className="ff-fld"><label className="ff-lbl">DTC Code (opt)</label>
                  <input className="ff-inp" placeholder="e.g. P2263" value={form.dtc} onChange={e => upd("dtc", e.target.value.toUpperCase())} maxLength={6} />
                </div>
              </div>
              <div className="ff-fld">
                <label className="ff-lbl">Describe Symptoms</label>
                <textarea className="ff-ta" style={{minHeight:"96px"}} placeholder="e.g. Car loses power going uphill, engine light on, throwing P2263. Turbo seems to kick in late. Shop wants $1,400 for a new turbo." value={form.symptoms} onChange={e => upd("symptoms", e.target.value)} />
              </div>
              {error && <div style={{color:"var(--red)",fontSize:".82rem",padding:"9px",background:"rgba(239,68,68,.08)",borderRadius:"7px",border:"1px solid rgba(239,68,68,.22)"}}>{error}</div>}
              <button className="ff-submit" onClick={submit} disabled={!canSubmit}>  Get Second Opinion</button>
              <p style={{textAlign:"center",fontSize:".68rem",color:"var(--sub)"}}>{remainingChecks} of {FREE_CHECKS} free checks remaining</p>
            </div>
          </div>
        )}

        {/* --- LOADING SCREEN --- */}
        {nav === "loading" && (
          <div className="ff-screen">
            <div className="ff-loading">
              <div className="ff-spinner-ring" />
              <div className="ff-load-msg"><b>{loadMsg || "Analyzing "}</b></div>
              <div className="ff-load-steps">
                {(LOAD_MSGS.scan).map((_, i) => (
                  <div key={i} className={`ff-step-dot ${i < loadStep ? "done" : i === loadStep ? "active" : ""}`} />
                ))}
              </div>
              <p style={{fontSize:".76rem",color:"var(--sub)",maxWidth:"260px",textAlign:"center",lineHeight:1.6}}>
                Checking market parts prices, typical labor hours, and regional rates
              </p>
            </div>
          </div>
        )}

        {/* --- RESULT SCREEN --- */}
        {nav === "result" && result && (
          <div className="ff-screen">
            <div className="ff-screen-hdr">
              <button className="ff-back" onClick={goHome}> </button>
              <div className="ff-logo" style={{fontSize:"1.1rem",letterSpacing:"3px"}}>Fix<em>Fair</em></div>
            </div>
            <ResultView
              result={result}
              form={form}
              onReset={goHome}
              onShowMech={() => setShowMech(true)}
              onShowSavings={() => setShowSavings(true)}
            />
          </div>
        )}

        {/* --- GATE SCREEN --- */}
        {nav === "gate" && (
          <div className="ff-screen">
            <div className="ff-screen-hdr">
              <button className="ff-back" onClick={goHome}> </button>
            </div>
            <div className="ff-gate">
              <div className="ff-gate-icon"> </div>
              <div className="ff-gate-t">Free Checks Used</div>
              <p className="ff-gate-s">You've used all {FREE_CHECKS} free checks this month. Upgrade to keep protecting yourself from overcharges - it pays for itself after one repair.</p>
              <div className="ff-gate-plans">
                <div className="ff-plan"><div className="ff-plan-p">$4.99</div><div className="ff-plan-n">/ month</div></div>
                <div className="ff-plan"><div className="ff-plan-p">$29</div><div className="ff-plan-n">/ year</div></div>
              </div>
              <p style={{fontSize:".7rem",color:"var(--sub)",marginBottom:"14px"}}>Upgrade flow coming soon - checks reset monthly for now.</p>
              <button className="ff-reset" onClick={goHome}>  Go Back</button>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
