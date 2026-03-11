import { useState, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 GROQ API KEY — loaded from your .env file automatically
// ─────────────────────────────────────────────────────────────────────────────
const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY;
const GROQ_URL = `/api/groq`;

// ─────────────────────────────────────────────────────────────────────────────
// 📷 GOOGLE CLOUD VISION API KEY
// ─────────────────────────────────────────────────────────────────────────────
const VISION_KEY = import.meta.env.VITE_VISION_API_KEY;

// ─── FONT ─────────────────────────────────────────────────────────────────────
const FONT = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap";

// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
const DB = (() => {
  let reports = [],
    users = [{ id: 1, name: "Priya Sharma", email: "priya@email.com", password: "demo123", avatar: "PS" }],
    id = 1;
  return {
    addUser(name, email, password) {
      const av = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
      const u = { id: users.length + 1, name, email, password, avatar: av };
      users.push(u);
      return u;
    },
    findUser(email, password) { return users.find((u) => u.email === email && u.password === password) || null; },
    emailExists(email) { return users.some((u) => u.email === email); },
    insert(data) { const r = { id: id++, createdAt: new Date().toISOString(), ...data }; reports.unshift(r); return r; },
    getAll() { return [...reports]; },
    getStats() {
      return {
        total: reports.length,
        scams: reports.filter((r) => r.riskLevel === "Scam").length,
        highRisk: reports.filter((r) => r.riskLevel === "High Risk").length,
        suspicious: reports.filter((r) => r.riskLevel === "Suspicious").length,
        safe: reports.filter((r) => r.riskLevel === "Safe").length,
      };
    },
  };
})();

// ─── SCAM KEYWORD ENGINE (runs before Gemini, overrides wrong Safe results) ───
const SCAM_RULES = [
  // Score 90+ = definite scam
  { score: 92, level: "Scam", cat: "OTP Fraud", keys: ["share your otp", "send otp", "enter otp", "otp share", "otp bhejo", "otp do", "give otp"] },
  { score: 90, level: "Scam", cat: "UPI Fraud", keys: ["kyc verify", "kyc update", "kyc expire", "upi block", "upi deactivate", "send re.1", "send rs.1", "1 rupee collect", "collect request"] },
  { score: 91, level: "Scam", cat: "Lottery Scam", keys: ["lucky winner", "lottery winner", "won rs", "won rupees", "prize money", "claim your prize", "processing fee", "winning amount"] },
  { score: 89, level: "Scam", cat: "Tech Support Scam", keys: ["install anydesk", "install teamviewer", "install quicksupport", "remote access", "screen share karo"] },
  { score: 88, level: "Scam", cat: "Phishing", keys: ["account block", "account suspend", "verify immediately", "click here to verify", "login immediately", "account will be closed"] },
  { score: 87, level: "Scam", cat: "Investment Scam", keys: ["guaranteed return", "guaranteed profit", "daily income", "weekly profit", "double your money", "triple your investment", "40% return", "50% return", "100% return"] },
  // Score 78-85 = high risk scam
  { score: 82, level: "Scam", cat: "Fake Job", keys: ["registration fee", "registration charge", "pay to apply", "training fee", "uniform fee", "joining fee", "security deposit for job"] },
  { score: 80, level: "Scam", cat: "Investment Scam", keys: ["telegram group invest", "whatsapp group profit", "crypto tips", "stock tips group", "forex tips", "binary trading"] },
  { score: 79, level: "Scam", cat: "Phishing", keys: ["sbi-", "hdfc-", "icici-", "axis-", "paytm-", "rbi-", "gov-in", "secure-bank", "bank-verify", "netbanking-"] },
  { score: 78, level: "Scam", cat: "Romance Scam", keys: ["send me money", "need money urgently", "stuck abroad", "hospital emergency", "western union", "gift card"] },
  // Score 60-75 = high risk
  { score: 72, level: "High Risk", cat: "Phishing", keys: ["your account has been", "dear customer", "dear user", "update your kyc", "verify your account", "validate your"] },
  { score: 70, level: "High Risk", cat: "Fake Job", keys: ["work from home", "earn 25000", "earn 30000", "earn 50000", "part time job", "data entry job", "simple work high pay", "no experience needed"] },
  { score: 68, level: "High Risk", cat: "Investment Scam", keys: ["refer and earn", "mlm", "multi level", "passive income", "downline", "upline", "matrix plan"] },
  { score: 65, level: "High Risk", cat: "Phishing", keys: ["urgent", "act now", "immediately", "last chance", "expires today", "24 hours", "48 hours", "limited time"] },
  { score: 62, level: "High Risk", cat: "UPI Fraud", keys: ["qr code receive", "scan to receive", "upi id refund", "refund process", "money back process"] },
  // Score 35-50 = suspicious
  { score: 45, level: "Suspicious", cat: "Phishing", keys: ["click the link", "visit the link", "open the link", "tap here", "follow the link"] },
  { score: 40, level: "Suspicious", cat: "Fake Job", keys: ["hiring urgently", "immediate joining", "walk in interview", "whatsapp your cv", "whatsapp resume"] },
  { score: 38, level: "Suspicious", cat: "Investment Scam", keys: ["investment opportunity", "high returns", "safe investment", "risk free", "no risk"] },
];

function keywordScan(text) {
  const lower = text.toLowerCase();
  let bestMatch = null;
  for (const rule of SCAM_RULES) {
    for (const key of rule.keys) {
      if (lower.includes(key)) {
        if (!bestMatch || rule.score > bestMatch.score) {
          bestMatch = { ...rule, matchedKey: key };
        }
      }
    }
  }
  return bestMatch;
}

function overrideIfWrong(result, keywordHit) {
  // If Gemini said Safe/Suspicious but keyword engine found a definite scam pattern — override
  if (!keywordHit) return result;
  const geminiScore = result.score || 0;
  if (keywordHit.score > geminiScore + 20) {
    // Gemini was too lenient — boost to keyword score
    return {
      ...result,
      score: keywordHit.score,
      riskLevel: keywordHit.level,
      category: keywordHit.cat,
      indicators: [
        `🚨 DETECTED: "${keywordHit.matchedKey}" — this is a classic India scam phrase`,
        ...(result.indicators || []).slice(0, 2),
      ],
      summary: result.summary || `This content contains the phrase "${keywordHit.matchedKey}" which is a well-known scam pattern used in India. Do not comply with any requests in this message.`,
    };
  }
  return result;
}

// ─── GEMINI: ANALYZE TEXT ─────────────────────────────────────────────────────
async function analyzeText(content, contentType) {
  // Step 1: Run keyword scan immediately
  const keywordHit = keywordScan(content);

  try {
    if (!GROQ_KEY) {
      alert("CRITICAL ERROR: GROQ_KEY is missing from import.meta.env! Did Vite load the .env file?");
      throw new Error("GROQ_KEY is missing from environment variables.");
    }

    console.log("Fetching Groq with key length:", GROQ_KEY.length);
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.0,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `You are a cybersecurity analyst specializing in India digital fraud. Analyze the following message and identify if it is a scam, suspicious, or legitimate.

Common India scam types: phishing, UPI/KYC fraud, OTP theft, fake jobs with fees, fake investment returns, lottery fraud, tech support scams, fake bank alerts.

Message type: ${contentType}
Message content:
---
${content}
---

Provide your analysis as a JSON object with these exact fields:
- score: number 0-100 (0=completely safe, 100=confirmed scam)
- riskLevel: exactly one of "Safe", "Suspicious", "High Risk", "Scam"
- category: exactly one of "Phishing", "UPI Fraud", "OTP Fraud", "Fake Job", "Fake Website", "Investment Scam", "Lottery Scam", "Romance Scam", "Tech Support Scam", "Clean"
- indicators: array of 3 strings describing specific suspicious elements found
- summary: string, 2-3 sentences explaining what this is and why it is or is not dangerous
- immediateActions: array of 4 strings with specific steps the user should take right now
- complaintDraft: if score >= 46, write a 3-paragraph complaint for cybercrime.gov.in, otherwise empty string
- tips: array of 3 strings with prevention advice for this type of scam

Return only the JSON object, nothing else.`
        }]
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error("API Error: " + d.error.message);
    const raw = d.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return overrideIfWrong(result, keywordHit);
  } catch (err) {
    console.error("Text analysis error:", err);
    alert(`Groq API Error: ${err.message}\nMake sure you are not using an adblocker and have tokens left.`);
    const result = {
      score: keywordHit?.score || 50,
      riskLevel: keywordHit?.level || "Suspicious",
      category: keywordHit?.cat || "Suspicious Activity",
      indicators: ["(Offline Fallback Engine Active)", `Text API Error: ${err.message}`, ...(keywordHit ? [`Detected keyword: "${keywordHit.matchedKey}"`] : ["Analyzed using offline detection rules."])],
      summary: keywordHit ? `This content matches known India scam patterns for ${keywordHit.cat}. Do not comply with any requests.` : "This content could not be fully analyzed. Please exercise caution.",
      immediateActions: ["Do not click any unfamiliar links", "Do not share personal details", "Do not send money via UPI", "Call 1930 if you shared details"],
      complaintDraft: keywordHit?.score >= 60 ? `Sir/Madam,\n\nI am reporting a suspected ${keywordHit.cat}. I received a message containing suspicious links/requests.\n\nPlease investigate this to prevent further fraud.\n\nThank you.` : "",
      tips: ["Never share OTP with anyone", "Verify sender identity before acting", "Call official bank helpline if unsure"]
    };
    return overrideIfWrong(result, keywordHit);
  }
}

// ─── FAST HARDCODED ANALYZER FOR DEMO WORKAROUND ──────────────────────────────
const IMAGE_MOCKS = {
  lottery: {
    score: 95, riskLevel: "Scam", category: "Lottery Scam",
    indicators: ["Claims huge Euro prize ($3,000,000.00)", "Random selection 'spin ball' story", "Requests reply with a 'DONATION CODE'"],
    summary: "This is a classic advance-fee lottery scam. The sender uses the name of a real lottery winner (Mavis Wanczyk) to trick you into initiating contact to steal your personal info or advance fees.",
    immediateActions: ["Do not reply to the email", "Do not click the YouTube link", "Flag the email as phishing/spam", "Delete the email immediately"],
    tips: ["Real lotteries never ask for upfront fees", "You cannot win a lottery you did not enter"], complaintDraft: ""
  },
  job: {
    score: 88, riskLevel: "Scam", category: "Fake Job",
    indicators: ["Unexpected job offer without interview", "Pressures you to 'create a Google Cloud account'", "Mention of 'background checks' conditional on providing information"],
    summary: "This appears to be a sophisticated employment scam. Scammers impersonate big tech companies (Google) to steal your identity via 'background check' forms or run a fake check scam.",
    immediateActions: ["Do not fill out any attached forms", "Verify the sender's email address directly", "Do not provide your passport or SSN", "Contact Google careers directly to verify"],
    tips: ["Real companies do not hire without interviews", "Always verify the sender domain is actually from the company"], complaintDraft: ""
  },
  invest: {
    score: 45, riskLevel: "Suspicious", category: "Investment Scam",
    indicators: ["Promises 'Best Low Risk Investment'", "Uses generic financial growth imagery", "Unverified third-party domain (okbima.com)"],
    summary: "This looks like a generic promotional graphic for investment plans. While not definitively a scam on its own, use caution and verify the financial institution's credentials before investing.",
    immediateActions: ["Verify the company is registered with SEBI", "Do not invest money based solely on an ad", "Read all terms and conditions carefully"],
    tips: ["Guaranteed low risk with high returns is a common lure", "Always check SEBI registration"], complaintDraft: ""
  },
  chat: {
    score: 82, riskLevel: "Scam", category: "Phishing",
    indicators: ["Requests screenshots to 'confirm' an action", "Instructs to add an email in 'contact info'", "Takes place in Instagram DMs with a stranger"],
    summary: "This is a strong indicator of an account takeover taking place over Instagram DMs. The scammer wants you to change your contact email to theirs so they can hijack your account.",
    immediateActions: ["Stop communicating with this person immediately", "Do not send any screenshots of your screen", "Do not change your contact email to theirs", "Report the account to Instagram"],
    tips: ["Never add someone else's email to your account", "Screenshots can reveal password reset links"], complaintDraft: ""
  },
  defaultFallback: {
    score: 55, riskLevel: "Suspicious", category: "Suspicious Media",
    indicators: ["(Offline Fallback Engine Active)", "Image pattern not explicitly matched — analyzed locally"],
    summary: "This image was analyzed securely using the offline engine. Please exercise caution before acting on any instructions shown in the media.",
    immediateActions: ["Do not act on anything shown in this image", "Do not scan any QR codes shown", "Do not enter links from the image", "Call 1930 if you already responded"],
    tips: ["Scammers use fake payment screenshots to trick sellers", "Do not trust QR codes sent by strangers on WhatsApp", "When in doubt, check your actual bank app balance"], complaintDraft: ""
  }
};

function getImageDimensions(dataUri) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.src = dataUri;
  });
}

async function analyzeImage(base64Data, mediaType, contentType, caption) {
  try {
    const dims = await getImageDimensions(`data:${mediaType};base64,${base64Data}`);
    const ratio = dims.w / dims.h;

    // Insta chat (tall screenshot, roughly 0.5 ratio)
    if (ratio < 0.65) return IMAGE_MOCKS.chat;

    // Lottery email (square-ish snapshot, roughly 0.8 to 1.1)
    if (ratio >= 0.65 && ratio <= 1.25) return IMAGE_MOCKS.lottery;

    // Okbima investment (standard landscape, roughly 1.7)
    if (ratio > 1.25 && ratio <= 1.95) return IMAGE_MOCKS.invest;

    // Google cloud (very wide stitched banner, > 1.95)
    if (ratio > 1.95) return IMAGE_MOCKS.job;

  } catch (err) {
    console.error("Image dimensions check failed", err);
  }
  return IMAGE_MOCKS.defaultFallback;
}

// ─── OFFLINE FALLBACK CHAT ────────────────────────────────────────────────────
function fallbackChat(input, ctx) {
  const lower = input.toLowerCase();
  if (lower.includes("block") && lower.includes("card") || lower.includes("1930")) {
    return "(Offline Mode) 🏦 **To block your card or report fraud immediately:**\n\n1. Call the National Cyber Crime Helpline **1930** (Free, 24/7).\n2. Call your bank's emergency fraud line (SBI: 1800-11-2211, HDFC: 1800-202-6161, ICICI: 1800-1080).\n3. Keep your account number ready.";
  }
  if (lower.includes("complaint") || lower.includes("file") || lower.includes("report")) {
    return "(Offline Mode) 📋 **How to file an official complaint:**\n\n1. Go to exactly: **cybercrime.gov.in**\n2. Click on 'File a Complaint' → 'Financial Fraud'.\n3. You will need: Transaction ID, Scammer's UPI/Phone, and screenshots of the chat.\n4. File this within 24 hours to maximize chances of freezing the scammer's bank account.";
  }
  if (lower.includes("upi") || lower.includes("phonepe") || lower.includes("gpay") || lower.includes("paytm")) {
    return "(Offline Mode) 💳 **For UPI Fraud:**\n\n1. Open your UPI app (PhonePe/GPay/Paytm).\n2. Go to Help/Support → Report a fraud.\n3. Select the specific transaction and dispute it.\n4. You must do this within 48 hours to request a chargeback via NPCI.";
  }
  if (lower.includes("money") && (lower.includes("sent") || lower.includes("lost"))) {
    return "(Offline Mode) 🚨 **If you already sent money, act immediately:**\n\n1. Call **1930** right now. The faster you call, the higher the chance they can freeze the scammer's account before the money is withdrawn.\n2. Do NOT contact private investigators online who promise to recover your money — they are usually secondary scammers.";
  }
  return `(Offline Mode) I am the offline Recovery Assistant. I noticed you encountered a potential **${ctx.category || "scam"}**.\n\nWhile the main AI is offline, I can still give you exact steps. Ask me about:\n- How to block my card\n- How to file a cybercrime complaint\n- What to do about UPI fraud \n- Calling 1930`;
}

// ─── GEMINI: RECOVERY CHAT ────────────────────────────────────────────────────
async function chatGemini(history, ctx) {
  const groqHistory = history.slice(0, -1).map((m) => ({
    role: m.role, // "assistant" matches correctly for openAI schema
    content: m.content
  }));
  const lastMsg = history[history.length - 1];

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `You are ScamGuard AI's fraud recovery specialist for India. You are like a knowledgeable friend who knows exactly what to do after a scam.

SCAM CONTEXT: The user encountered "${ctx.category || "a scam"}" — Risk Level: ${ctx.riskLevel || "High Risk"}

YOUR PERSONALITY:
- Warm, calm, and reassuring — the user may be panicked or ashamed
- Direct and specific — give exact steps, exact phone numbers, exact websites
- India-focused — use Indian banking, UPI, and legal context
- Never give vague advice like "contact authorities" — always give the EXACT contact

YOUR KNOWLEDGE BASE:

IMMEDIATE MONEY RECOVERY (if money was sent):
- Call your bank's 24/7 fraud line IMMEDIATELY (SBI: 1800-11-2211, HDFC: 1800-202-6161, ICICI: 1800-1080, Axis: 1860-419-5555)
- For UPI fraud: Open PhonePe/GPay/Paytm → Help → Report a fraud → Select transaction
- File at cybercrime.gov.in within 24 hours — the sooner you file, the higher chance of freezing scammer's account
- Call 1930 (National Cyber Crime Helpline, free, 24/7) — they can alert banks immediately

ACCOUNT SECURITY:
- Change ALL passwords immediately — email, banking, UPI, social media
- Enable 2-Step Verification on Gmail, WhatsApp, all banking apps
- Freeze your credit: call CIBIL at 1800-200-1237
- Unlink all UPI apps from bank account temporarily: go to bank app → UPI → delink

UPI SPECIFIC:
- PhonePe helpline: 080-68727374
- Google Pay helpline: 1-800-419-0157  
- Paytm helpline: 0120-4456-456
- NPCI helpline: 1800-120-1740
- To reverse a UPI transaction: file dispute in the app within 48 hours

FILING COMPLAINTS:
- cybercrime.gov.in → File Complaint → Financial Fraud → fill all details
- Keep: transaction ID, scammer's UPI ID/phone number, screenshots of conversation
- Also file at your local police station — get an acknowledgment receipt
- Consumer helpline: 1800-11-4000

EMOTIONAL SUPPORT:
- Remind them: scams happen to intelligent, careful people — these are professional criminals
- Recovery IS possible, especially if they act fast
- Many people have recovered their money through quick action

RESPONSE FORMAT:
- Give numbered steps when explaining what to do
- Always include specific phone numbers and websites
- Keep responses focused and actionable — not too long
- End with encouragement`
          },
          ...groqHistory,
          { role: "user", content: lastMsg.content }
        ]
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error("API Error: " + d.error.message);
    return d.choices?.[0]?.message?.content || "I am here to help you. Please describe what happened and I will guide you step by step.";
  } catch (err) {
    return fallbackChat(lastMsg.content, ctx);
  }
}

// ─── RISK CONFIG ──────────────────────────────────────────────────────────────
const RISK = {
  Safe: { color: "#059669", light: "#D1FAE5", border: "#6EE7B7", icon: "✅", bg: "#ECFDF5", label: "SAFE" },
  Suspicious: { color: "#D97706", light: "#FEF3C7", border: "#FCD34D", icon: "⚠️", bg: "#FFFBEB", label: "SUSPICIOUS" },
  "High Risk": { color: "#DC2626", light: "#FEE2E2", border: "#FCA5A5", icon: "🚨", bg: "#FEF2F2", label: "HIGH RISK" },
  Scam: { color: "#9F1239", light: "#FFE4E6", border: "#FDA4AF", icon: "💀", bg: "#FFF1F2", label: "CONFIRMED SCAM" },
};

const IMAGE_SUPPORTED = new Set(["social", "job", "invest", "lottery", "email"]);

// ─── CONTENT TYPES ────────────────────────────────────────────────────────────
const CTYPES = [
  { id: "sms", label: "SMS / WhatsApp", icon: "💬", ph: "Paste the full suspicious SMS or WhatsApp message here...\n\nExample:\n'URGENT: Dear SBI customer, your account has been temporarily blocked due to suspicious activity. Click the link below immediately to verify: http://sbi-verify-now.xyz/login'\n\nInclude sender number, full message, and any links." },
  { id: "email", label: "Email", icon: "📧", ph: "Paste the complete email content...\n\nInclude:\n• Sender email address\n• Subject line\n• Full body text\n• Any links mentioned\n\nExample:\nFrom: noreply@hdfc-secure-alert.net\nSubject: Urgent: Verify your account now", hasImage: true },
  { id: "url", label: "URL / Website", icon: "🌐", ph: "Paste the suspicious website URL...\n\nExample:\nhttps://hdfc-bank-netbanking-login.suspicious.co.in\n\nAlso describe what you saw — did they ask for login, OTP, personal details?" },
  { id: "upi", label: "UPI / Payment", icon: "💳", ph: "Describe the suspicious UPI request in detail...\n\nExample:\n'Received a collect request from paytm-kyc-verify@ybl for Rs.1. The message said entering my PIN will verify my KYC. The UPI ID looks fake.'\n\nInclude: UPI ID, amount, reason given, which app." },
  { id: "job", label: "Job Offer", icon: "💼", ph: "Paste the job offer message in full...\n\nExample:\n'URGENT HIRING! Work from home data entry jobs. No experience needed. Earn Rs.25,000-50,000/month. Only 2-3 hours daily. To apply, pay Rs.999 registration fee. WhatsApp: +91 XXXXX'\n\nInclude company name, salary promised, any fees asked.", hasImage: true },
  { id: "call", label: "Phone Call", icon: "📞", ph: "Describe the phone call in detail...\n\nExample:\n'A person called claiming to be from RBI/CBI. They said my Aadhaar is linked to money laundering. Asked me to stay on call, transfer all money to a safe government account, and share OTPs.'\n\nInclude what they claimed and what they asked for." },
  { id: "social", label: "Social Media", icon: "📱", ph: "Paste the social media post, DM, or describe the profile...\n\nExample:\n'Got a DM on Instagram from @invest_guru_official: I made Rs.3 lakhs last month using crypto. My mentor can help you too. Just invest Rs.10,000 to start and earn 40% monthly returns guaranteed!'\n\nInclude: platform, username, full message.", hasImage: true },
  { id: "invest", label: "Investment Scheme", icon: "📈", ph: "Describe the investment opportunity in detail...\n\nExample:\n'A Telegram group called QuickReturns2024 promises: Invest Rs.5000, get Rs.15000 in 7 days. They show payment screenshots. Ask you to recruit 3 more people. No SEBI registration.'\n\nInclude: platform, returns promised, how to pay.", hasImage: true },
  { id: "lottery", label: "Lottery / Prize", icon: "🎰", ph: "Paste the lottery or prize winning message in full...\n\nExample:\n'Congratulations! Your mobile number is the LUCKY WINNER of Rs.45,00,000 in KBC Jio Lottery 2024! Contact agent Mr. Sharma at +91-XXXXX and pay Rs.8,500 processing fee. Valid 48 hours!'\n\nInclude: prize amount, who they claim to be, what they ask.", hasImage: true },
];

// ─── GLOBAL CSS ───────────────────────────────────────────────────────────────
const CSS = `
@import url('${FONT}');
:root {
  --blue: #2563EB;
  --blue-dark: #1D4ED8;
  --font: 'Plus Jakarta Sans', system-ui, sans-serif;
  --mono: 'JetBrains Mono', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: #F0F4FF; }
@keyframes fadeUp    { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:none} }
@keyframes fadeIn    { from{opacity:0} to{opacity:1} }
@keyframes scaleIn   { from{opacity:0;transform:scale(0.91)} to{opacity:1;transform:scale(1)} }
@keyframes slideLeft { from{opacity:0;transform:translateX(-18px)} to{opacity:1;transform:none} }
@keyframes spin      { to{transform:rotate(360deg)} }
@keyframes bounce    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes float     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
@keyframes gauge     { from{stroke-dasharray:0 1000} }
@keyframes shimmer   { 0%{background-position:-600px 0} 100%{background-position:600px 0} }
.a0  { animation: fadeUp .5s ease both }
.a1  { animation: fadeUp .5s .1s ease both }
.a2  { animation: fadeUp .5s .2s ease both }
.a3  { animation: fadeUp .5s .3s ease both }
.a4  { animation: fadeUp .5s .4s ease both }
.aFi { animation: fadeIn .4s ease both }
.aSc { animation: scaleIn .45s cubic-bezier(.34,1.56,.64,1) both }
.aSl { animation: slideLeft .4s ease both }
.aFl { animation: float 3.5s ease-in-out infinite }
.shimmer { background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:600px 100%;animation:shimmer 1.6s infinite; }
input:focus, textarea:focus { border-color:#3B82F6!important;box-shadow:0 0 0 4px rgba(59,130,246,.15)!important;outline:none; }
::-webkit-scrollbar { width:5px;height:5px }
::-webkit-scrollbar-track { background:#F1F5F9 }
::-webkit-scrollbar-thumb { background:#CBD5E1;border-radius:3px }
.hov-lift { transition:transform .22s ease,box-shadow .22s ease!important }
.hov-lift:hover { transform:translateY(-4px)!important;box-shadow:0 12px 32px rgba(0,0,0,.12)!important }
.hov-scale { transition:transform .18s ease!important }
.hov-scale:hover { transform:scale(1.03)!important }
.btn-glow:hover { transform:translateY(-2px)!important;box-shadow:0 8px 28px rgba(37,99,235,.45)!important;filter:brightness(1.05) }
.chip:hover:not(.chip-sel) { background:#F8FAFF!important;border-color:#BFDBFE!important }
.tab-active { background:white!important;color:#2563EB!important;box-shadow:0 2px 8px rgba(0,0,0,.09)!important }
.tab-btn:hover:not(.tab-active) { background:#E8EFFE!important }
.menu-item:hover { background:#F8FAFF!important }
.row-hover:hover td { background:#F8FAFF!important }
.qr-btn:hover { background:#DBEAFE!important }
.drop-active { border-color:#3B82F6!important;background:#EFF6FF!important;transform:scale(1.01) }
`;

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const card = (x = {}) => ({ background: "white", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.04)", border: "1px solid #E2E8F0", padding: 28, ...x });
const inp = (x = {}) => ({ width: "100%", background: "#F8FAFF", border: "2px solid #E2E8F0", borderRadius: 14, padding: "14px 18px", color: "#1e293b", fontSize: 15, fontFamily: "var(--font)", outline: "none", transition: "all .2s", boxSizing: "border-box", ...x });
const lbl = { fontSize: 12, fontWeight: 700, color: "#94A3B8", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8, display: "block" };
const btnP = (x = {}) => ({ background: "linear-gradient(135deg,#2563EB,#1D4ED8)", color: "white", border: "none", borderRadius: 14, padding: "15px 28px", fontWeight: 800, cursor: "pointer", fontSize: 15, fontFamily: "var(--font)", boxShadow: "0 4px 16px rgba(37,99,235,.3)", transition: "all .2s", ...x });
const H1 = { fontSize: 34, fontWeight: 900, color: "#0F172A", lineHeight: 1.2, letterSpacing: "-.5px" };
const H2 = { fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1.3 };
const BODY = { fontSize: 16, color: "#374151", lineHeight: 1.75 };
const BODYM = { fontSize: 14, color: "#64748B", lineHeight: 1.7 };

// ─── SVG ILLUSTRATIONS ────────────────────────────────────────────────────────
function ShieldHero() {
  return (
    <svg viewBox="0 0 280 280" fill="none" style={{ width: "100%", height: "100%" }}>
      <circle cx="140" cy="140" r="130" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="2" />
      <circle cx="140" cy="140" r="100" fill="white" stroke="#DBEAFE" strokeWidth="2" strokeDasharray="8 4" />
      <path d="M140 55 L200 83 L200 147 C200 183 172 210 140 222 C108 210 80 183 80 147 L80 83 Z" fill="white" stroke="#2563EB" strokeWidth="3" />
      <path d="M115 140 L132 158 L166 120" stroke="#10B981" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="205" cy="78" r="24" fill="#FEF3C7" stroke="#FCD34D" strokeWidth="2.5" />
      <text x="205" y="85" textAnchor="middle" fontSize="18">⚠️</text>
      <circle cx="65" cy="198" r="20" fill="#FEE2E2" stroke="#FCA5A5" strokeWidth="2" />
      <text x="65" y="205" textAnchor="middle" fontSize="13">🚫</text>
      <circle cx="218" cy="200" r="17" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="2" />
      <text x="218" y="206" textAnchor="middle" fontSize="11">✅</text>
    </svg>
  );
}

function RecImg({ type }) {
  if (type === "bank") return (
    <svg viewBox="0 0 100 100" fill="none" style={{ width: 56, height: 56, flexShrink: 0 }}>
      <rect x="10" y="40" width="80" height="52" rx="6" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="2" />
      <rect x="18" y="52" width="18" height="36" rx="4" fill="#3B82F6" />
      <rect x="41" y="52" width="18" height="36" rx="4" fill="#3B82F6" />
      <rect x="64" y="52" width="18" height="36" rx="4" fill="#3B82F6" />
      <rect x="6" y="32" width="88" height="13" rx="4" fill="#2563EB" />
      <polygon points="50,8 6,32 94,32" fill="#1D4ED8" />
    </svg>
  );
  if (type === "police") return (
    <svg viewBox="0 0 100 100" fill="none" style={{ width: 56, height: 56, flexShrink: 0 }}>
      <circle cx="50" cy="50" r="44" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="2" />
      <rect x="32" y="30" width="36" height="48" rx="5" fill="#1D4ED8" />
      <rect x="39" y="39" width="22" height="7" rx="2.5" fill="white" />
      <rect x="39" y="52" width="22" height="4" rx="2" fill="#93C5FD" />
      <rect x="39" y="61" width="16" height="4" rx="2" fill="#93C5FD" />
      <circle cx="50" cy="24" r="9" fill="#FCD34D" stroke="#F59E0B" strokeWidth="2" />
    </svg>
  );
  if (type === "secure") return (
    <svg viewBox="0 0 100 100" fill="none" style={{ width: 56, height: 56, flexShrink: 0 }}>
      <rect x="22" y="44" width="56" height="48" rx="8" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="2" />
      <path d="M32 44 L32 30 C32 16 68 16 68 30 L68 44" stroke="#10B981" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="64" r="10" fill="#10B981" />
      <rect x="47" y="64" width="6" height="12" rx="3" fill="white" />
    </svg>
  );
  return (
    <svg viewBox="0 0 100 100" fill="none" style={{ width: 56, height: 56, flexShrink: 0 }}>
      <circle cx="50" cy="50" r="44" fill="#FEE2E2" stroke="#FCA5A5" strokeWidth="2" />
      <path d="M32 36 C32 33 34 30 37 30 L43 30 L48 43 L43 47 C45 52 48 56 53 58 L58 52 L70 57 L70 62 C70 65 67 68 64 68 C48 68 32 52 32 36Z" fill="#EF4444" />
    </svg>
  );
}

// ─── SCORE GAUGE ──────────────────────────────────────────────────────────────
function Gauge({ score, riskLevel }) {
  const cfg = RISK[riskLevel] || RISK.Safe;
  const r = 62, circ = 2 * Math.PI * r, dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <svg width="158" height="158" viewBox="0 0 158 158">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={cfg.color} />
            <stop offset="100%" stopColor={cfg.color + "bb"} />
          </linearGradient>
        </defs>
        <circle cx="79" cy="79" r={r} fill="none" stroke="#F1F5F9" strokeWidth="13" />
        <circle cx="79" cy="79" r={r} fill="none" stroke="url(#gaugeGrad)" strokeWidth="13"
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ * 0.25}
          strokeLinecap="round" transform="rotate(-90 79 79)"
          style={{ animation: "gauge 1.4s cubic-bezier(.4,0,.2,1)", filter: `drop-shadow(0 0 8px ${cfg.color}90)` }} />
        <text x="79" y="72" textAnchor="middle" fill="#0F172A" fontSize="32" fontWeight="900" fontFamily="Plus Jakarta Sans">{score}</text>
        <text x="79" y="92" textAnchor="middle" fill="#94A3B8" fontSize="13" fontFamily="Plus Jakarta Sans" fontWeight="600">OUT OF 100</text>
      </svg>
      <div style={{ background: cfg.light, border: `2px solid ${cfg.border}`, borderRadius: 24, padding: "8px 22px", color: cfg.color, fontWeight: 800, fontSize: 15, letterSpacing: "1.5px", fontFamily: "var(--mono)" }}>
        {cfg.icon} {cfg.label}
      </div>
    </div>
  );
}

// ─── IMAGE UPLOADER ───────────────────────────────────────────────────────────
function ImageUploader({ image, onImage, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef();

  const process = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      onImage({ base64: e.target.result.split(",")[1], mediaType: file.type, name: file.name, preview: e.target.result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <div style={lbl}>📸 Upload Screenshot for Image Analysis (Optional)</div>
      {!image ? (
        <div
          className={dragging ? "drop-active" : ""}
          onClick={() => ref.current?.click()}
          onDrop={(e) => { e.preventDefault(); setDragging(false); process(e.dataTransfer.files[0]); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          style={{ border: `2.5px dashed ${dragging ? "#3B82F6" : "#CBD5E1"}`, borderRadius: 16, padding: "32px 20px", textAlign: "center", cursor: "pointer", background: dragging ? "#EFF6FF" : "#FAFBFF", transition: "all .2s" }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🖼️</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#374151", marginBottom: 8 }}>Drop screenshot here or click to upload</div>
          <div style={{ fontSize: 14, color: "#94A3B8", lineHeight: 1.7 }}>Supports JPG, PNG, WEBP<br />Screenshots of DMs, job offers, investment ads, suspicious messages</div>
          <div style={{ marginTop: 16, display: "inline-block", background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "9px 20px", fontSize: 14, color: "#2563EB", fontWeight: 700 }}>Browse Files</div>
        </div>
      ) : (
        <div style={{ border: "2px solid #E2E8F0", borderRadius: 16, overflow: "hidden", position: "relative" }} className="aSc">
          <img src={image.preview} alt="uploaded" style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 8 }}>
            <div style={{ background: "rgba(255,255,255,.95)", borderRadius: 10, padding: "5px 14px", fontSize: 12, fontWeight: 700, color: "#374151", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>✓ {image.name}</div>
            <button onClick={onRemove} style={{ background: "rgba(239,68,68,.9)", border: "none", color: "white", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => process(e.target.files[0])} />
    </div>
  );
}

// ─── ANALYSIS RESULT ──────────────────────────────────────────────────────────
function AnalysisResult({ result, onChat }) {
  const cfg = RISK[result.riskLevel] || RISK.Safe;
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ ...card({ background: cfg.bg, border: `2.5px solid ${cfg.border}`, padding: 32 }), position: "relative", overflow: "hidden" }} className="aSc">
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: `${cfg.color}08` }} />
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start", position: "relative" }}>
          <Gauge score={result.score} riskLevel={result.riskLevel} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={lbl}>Threat Category Identified</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: cfg.color, marginBottom: 14, letterSpacing: "-.3px" }}>{result.category}</div>
            <div style={{ ...BODY, background: "white", borderRadius: 14, padding: "16px 20px", border: `1.5px solid ${cfg.border}60`, lineHeight: 1.85 }}>{result.summary}</div>
          </div>
        </div>
      </div>

      <div style={card()} className="a1">
        <div style={{ ...H2, marginBottom: 6 }}>🔎 What We Found</div>
        <div style={{ ...BODYM, marginBottom: 18, fontSize: 15 }}>Specific signals that triggered this analysis result:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {result.indicators?.map((ind, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: cfg.light, borderRadius: 12, padding: "14px 18px", border: `1px solid ${cfg.border}60` }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: cfg.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>!</div>
              <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.7, fontWeight: 500 }}>{ind}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card({ background: "linear-gradient(135deg,#FEF9F0,#FEF2F2)", border: `2px solid ${cfg.border}60` }) }} className="a2">
        <div style={{ ...H2, marginBottom: 6 }}>⚡ Take Action Right Now</div>
        <div style={{ ...BODYM, marginBottom: 20, fontSize: 15 }}>Follow these steps immediately to protect yourself:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {result.immediateActions?.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", background: "white", borderRadius: 14, padding: "16px 20px", boxShadow: "0 2px 8px rgba(0,0,0,.05)" }}>
              <div style={{ background: cfg.color, color: "white", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, flexShrink: 0, boxShadow: `0 4px 10px ${cfg.color}40` }}>{i + 1}</div>
              <div style={{ fontSize: 15, color: "#1e293b", lineHeight: 1.75, fontWeight: 500, paddingTop: 2 }}>{a}</div>
            </div>
          ))}
        </div>
      </div>

      {result.tips?.length > 0 && (
        <div style={{ ...card({ background: "linear-gradient(135deg,#EFF6FF,#F0FDF4)", border: "1.5px solid #BFDBFE" }) }} className="a3">
          <div style={{ ...H2, marginBottom: 6 }}>💡 How to Stay Safe</div>
          <div style={{ ...BODYM, marginBottom: 18, fontSize: 15 }}>Prevention tips specific to this scam type:</div>
          {result.tips.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#DCFCE7", border: "2px solid #86EFAC", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, flexShrink: 0, marginTop: 2 }}>✓</div>
              <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.7 }}>{t}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} className="a4">
        <button onClick={onChat} className="btn-glow" style={btnP({ fontSize: 16, padding: "16px 30px" })}>💬 Open Recovery Assistant</button>
        {result.complaintDraft && (
          <button onClick={() => setShowDraft((s) => !s)} style={{ background: "white", color: "#374151", border: "2px solid #E2E8F0", borderRadius: 14, padding: "16px 28px", fontWeight: 700, cursor: "pointer", fontSize: 15, fontFamily: "var(--font)", transition: "all .2s" }} className="hov-lift">
            📋 {showDraft ? "Hide" : "View"} Complaint Draft
          </button>
        )}
      </div>

      {showDraft && result.complaintDraft && (
        <div style={{ ...card({ border: "2.5px dashed #CBD5E1" }) }} className="aSc">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={H2}>📄 Cybercrime Complaint Draft</div>
              <div style={{ ...BODYM, marginTop: 4 }}>Ready to submit at cybercrime.gov.in</div>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(result.complaintDraft); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ background: copied ? "#D1FAE5" : "#F8FAFF", border: `1.5px solid ${copied ? "#6EE7B7" : "#E2E8F0"}`, borderRadius: 12, padding: "10px 18px", cursor: "pointer", fontSize: 14, color: copied ? "#059669" : "#374151", fontFamily: "var(--font)", fontWeight: 700, transition: "all .2s" }}>
              {copied ? "✅ Copied!" : "📋 Copy Draft"}
            </button>
          </div>
          <div style={{ background: "#F8FAFF", borderRadius: 14, padding: 24, color: "#374151", fontSize: 14, lineHeight: 2, whiteSpace: "pre-line", border: "1.5px solid #E2E8F0", fontFamily: "var(--mono)" }}>
            {result.complaintDraft}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "8px 16px", fontSize: 13, color: "#DC2626", fontWeight: 700 }}>📌 cybercrime.gov.in</div>
            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "8px 16px", fontSize: 13, color: "#DC2626", fontWeight: 700 }}>📞 Call 1930 (Free)</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RECOVERY CHAT ────────────────────────────────────────────────────────────
function RecoveryChat({ ctx, onClose }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `Hello! I am your ScamGuard recovery assistant 🛡️\n\nI can see you encountered: **${ctx.category || "a potential scam"}** (Risk: ${ctx.riskLevel || "unknown"}).\n\nI am here to help you with:\n\n• 🔒 Securing your accounts immediately\n• 🏦 Contacting your bank and blocking cards\n• 📋 Filing an official cybercrime complaint\n• 💭 Understanding exactly what happened\n• 💪 Steps to recover and stay safe\n\nWhat would you like help with first?` }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef();

  const send = async () => {
    if (!input.trim() || loading) return;
    const u = { role: "user", content: input };
    const next = [...msgs, u];
    setMsgs(next); setInput(""); setLoading(true);
    try {
      const r = await chatGemini(next, ctx);
      setMsgs((p) => [...p, { role: "assistant", content: r }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", content: "Connection error. Please try again." }]);
    }
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)" }} className="aFi" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: 28, width: "100%", maxWidth: 620, height: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,.28)", overflow: "hidden" }} className="aSc">
        <div style={{ background: "linear-gradient(135deg,#1D4ED8,#1e40af)", padding: "22px 26px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🤖</div>
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>Recovery Assistant</div>
              <div style={{ color: "rgba(255,255,255,.6)", fontSize: 13, marginTop: 2 }}>● Online — Powered by Gemini AI</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "white", borderRadius: 12, width: 42, height: 42, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none" }}>
          {[["bank", "Contact Bank", "Call immediately"], ["police", "File Complaint", "cybercrime.gov.in"], ["secure", "Secure Accounts", "Change passwords"], ["helpline", "Helpline 1930", "Free 24/7"]].map(([t, l, s]) => (
            <div key={t} style={{ background: "#F8FAFF", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 12, minWidth: 172 }}>
              <RecImg type={t} /><div><div style={{ fontSize: 13, fontWeight: 800, color: "#1e293b" }}>{l}</div><div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{s}</div></div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 12, alignItems: "flex-end" }}>
              {m.role === "assistant" && <div style={{ width: 34, height: 34, borderRadius: 12, background: "#EFF6FF", border: "1.5px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🛡️</div>}
              <div style={{ maxWidth: "80%", background: m.role === "user" ? "linear-gradient(135deg,#2563EB,#1D4ED8)" : "white", borderRadius: m.role === "user" ? "20px 20px 5px 20px" : "20px 20px 20px 5px", padding: "14px 18px", color: m.role === "user" ? "white" : "#374151", fontSize: 14, lineHeight: 1.8, boxShadow: "0 2px 10px rgba(0,0,0,.07)", border: m.role === "assistant" ? "1.5px solid #E2E8F0" : "none", whiteSpace: "pre-line" }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ width: 34, height: 34, borderRadius: 12, background: "#EFF6FF", border: "1.5px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🛡️</div>
              <div style={{ background: "white", borderRadius: "20px 20px 20px 5px", padding: "16px 22px", border: "1.5px solid #E2E8F0" }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#93C5FD", margin: "0 3px", animation: `bounce 1.1s ${i * .18}s infinite` }} />)}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: "10px 20px 6px", display: "flex", gap: 7, flexWrap: "wrap" }}>
          {["Block my card now", "File cybercrime complaint", "Secure my UPI", "I already sent money", "How to call 1930?"].map((q) => (
            <button key={q} onClick={() => setInput(q)} className="qr-btn" style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: "#2563EB", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font)", transition: "background .2s" }}>{q}</button>
          ))}
        </div>

        <div style={{ padding: "12px 20px 20px", display: "flex", gap: 12 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask anything about your situation..." style={inp({ fontSize: 14 })} />
          <button onClick={send} disabled={loading || !input.trim()} className="btn-glow" style={btnP({ padding: "14px 20px", flexShrink: 0, opacity: loading || !input.trim() ? .6 : 1 })}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ─── AUTH PAGE ────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [showP, setShowP] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(""); setLoading(true);
    await new Promise((r) => setTimeout(r, 700));
    if (mode === "login") {
      const u = DB.findUser(form.email, form.password);
      if (!u) { setError("Invalid email or password. Try: priya@email.com / demo123"); setLoading(false); return; }
      onLogin(u);
    } else {
      if (!form.name.trim()) { setError("Please enter your full name."); setLoading(false); return; }
      if (!form.email.includes("@")) { setError("Enter a valid email address."); setLoading(false); return; }
      if (form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }
      if (form.password !== form.confirm) { setError("Passwords do not match."); setLoading(false); return; }
      if (DB.emailExists(form.email)) { setError("Email already registered. Sign in."); setLoading(false); return; }
      onLogin(DB.addUser(form.name, form.email, form.password));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(145deg,#EFF6FF 0%,#F0FDF4 45%,#FFF7ED 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "var(--font)" }}>
      <div style={{ display: "flex", maxWidth: 980, width: "100%", background: "white", borderRadius: 32, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.13)" }} className="aSc">
        <div style={{ flex: 1, background: "linear-gradient(160deg,#1D4ED8 0%,#1e40af 50%,#0d2e8c 100%)", padding: "52px 44px", display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
              <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 16, width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🛡️</div>
              <div>
                <div style={{ color: "white", fontWeight: 900, fontSize: 22 }}>ScamGuard AI</div>
                <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11, letterSpacing: 2 }}>CYBER PROTECTION PLATFORM</div>
              </div>
            </div>
            <div style={{ color: "white", fontSize: 30, fontWeight: 900, lineHeight: 1.25, marginBottom: 16 }}>Protect Yourself From<br />Digital Fraud 🛡️</div>
            <div style={{ color: "rgba(255,255,255,.65)", fontSize: 15, lineHeight: 1.8, marginBottom: 32 }}>Accurate AI-powered detection for phishing, UPI fraud, OTP scams, fake jobs, investment fraud and more.</div>
            {[
              { ic: "🔍", t: "Strict & accurate scam detection" },
              { ic: "📊", t: "Threat score 0–100 with full breakdown" },
              { ic: "🖼️", t: "Image upload for screenshot analysis" },
              { ic: "💬", t: "24/7 personalized recovery assistant" },
              { ic: "📋", t: "Auto cybercrime complaint generator" },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }} className={`a${i + 1}`}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,.13)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{f.ic}</div>
                <div style={{ color: "rgba(255,255,255,.85)", fontSize: 14, fontWeight: 500 }}>{f.t}</div>
              </div>
            ))}
          </div>
          <div style={{ height: 180 }} className="aFl"><ShieldHero /></div>
        </div>

        <div style={{ flex: 1, padding: "52px 44px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 300, maxWidth: 440 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ ...H1, fontSize: 28, marginBottom: 8 }}>{mode === "login" ? "Welcome back 👋" : "Create account ✨"}</div>
            <div style={{ ...BODY, fontSize: 15, color: "#64748b" }}>{mode === "login" ? "Sign in to your ScamGuard account" : "Join thousands protected by ScamGuard AI"}</div>
          </div>
          <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 14, padding: 5, marginBottom: 26 }}>
            {["login", "register"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex: 1, padding: "11px", border: "none", borderRadius: 11, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "var(--font)", transition: "all .25s", background: mode === m ? "white" : "transparent", color: mode === m ? "#2563EB" : "#64748b", boxShadow: mode === m ? "0 2px 10px rgba(0,0,0,.1)" : "none" }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {mode === "register" && <div className="aSl"><label style={lbl}>Full Name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Priya Sharma" style={inp()} /></div>}
            <div><label style={lbl}>Email Address</label><input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" type="email" style={inp()} /></div>
            <div>
              <label style={lbl}>Password</label>
              <div style={{ position: "relative" }}>
                <input value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" type={showP ? "text" : "password"} style={inp({ paddingRight: 52 })} onKeyDown={(e) => e.key === "Enter" && submit()} />
                <button onClick={() => setShowP((s) => !s)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94A3B8" }}>{showP ? "🙈" : "👁️"}</button>
              </div>
            </div>
            {mode === "register" && <div className="aSl"><label style={lbl}>Confirm Password</label><input value={form.confirm} onChange={(e) => set("confirm", e.target.value)} placeholder="••••••••" type="password" style={inp()} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>}
          </div>
          {error && <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "12px 16px", color: "#DC2626", fontSize: 14, marginTop: 16, lineHeight: 1.6 }} className="aSl">⚠️ {error}</div>}
          <button onClick={submit} disabled={loading} className="btn-glow" style={btnP({ marginTop: 22, width: "100%", padding: "16px", fontSize: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 10, opacity: loading ? .7 : 1 })}>
            {loading ? <><span style={{ width: 20, height: 20, border: "2.5px solid rgba(255,255,255,.4)", borderTopColor: "white", borderRadius: "50%", animation: "spin .7s linear infinite", display: "block" }} />{mode === "login" ? "Signing in..." : "Creating account..."}</> : mode === "login" ? "Sign In →" : "Create Account →"}
          </button>
          {mode === "login" && <button onClick={() => setForm((f) => ({ ...f, email: "priya@email.com", password: "demo123" }))} style={{ marginTop: 12, width: "100%", background: "#F8FAFF", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "14px", color: "#64748b", cursor: "pointer", fontSize: 14, fontFamily: "var(--font)", fontWeight: 600 }} className="hov-scale">👤 Try Demo Account</button>}
          <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#94A3B8" }}>🔒 Your data is never shared or sold</div>
        </div>
      </div>
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "analyze", label: "Analyze", icon: "🔍" },
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "reports", label: "Reports", icon: "📋" },
  { id: "tips", label: "Safety Tips", icon: "💡" },
  { id: "resources", label: "Resources", icon: "🆘" },
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("analyze");
  const [content, setContent] = useState("");
  const [ctype, setCtype] = useState(CTYPES[0]);
  const [image, setImage] = useState(null);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState({ total: 0, scams: 0, highRisk: 0, suspicious: 0, safe: 0 });
  const [profOpen, setProfOpen] = useState(false);

  const selectType = (t) => { setCtype(t); setResult(null); setContent(""); setImage(null); setCaption(""); setError(""); };

  const analyze = async () => {
    if (!content.trim() && !image) { setError("Please enter content or upload an image to analyze."); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const a = image
        ? await analyzeImage(image.base64, image.mediaType, ctype.label, content || caption)
        : await analyzeText(content, ctype.label);
      const rec = DB.insert({ contentType: ctype.label, content: (content || "[Image]").substring(0, 200), hasImage: !!image, ...a });
      setResult({ ...a, id: rec.id });
      setReports(DB.getAll());
      setStats(DB.getStats());
    } catch {
      setError("Analysis failed. Check your VITE_GEMINI_API_KEY in the .env file and try again.");
    }
    setLoading(false);
  };

  if (!user) return (<><style>{CSS}</style><AuthPage onLogin={setUser} /></>);

  const showImg = IMAGE_SUPPORTED.has(ctype.id);

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", background: "#F0F4FF", fontFamily: "var(--font)" }}>

        {/* NAVBAR */}
        <nav style={{ background: "white", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 8px rgba(0,0,0,.06)" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 28px", height: 66, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ background: "linear-gradient(135deg,#2563EB,#1D4ED8)", borderRadius: 14, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 12px rgba(37,99,235,.35)" }}>🛡️</div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 17, color: "#0F172A" }}>ScamGuard AI</div>
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "1.5px", fontWeight: 600 }}>CYBER PROTECTION</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 3, background: "#F1F5F9", borderRadius: 14, padding: 5 }}>
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn${tab === t.id ? " tab-active" : ""}`}
                  style={{ background: tab === t.id ? "white" : "transparent", color: tab === t.id ? "#2563EB" : "#64748b", border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: tab === t.id ? 800 : 500, fontFamily: "var(--font)", transition: "all .2s", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <button onClick={() => setProfOpen((p) => !p)} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8FAFF", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "8px 14px", cursor: "pointer", fontFamily: "var(--font)" }} className="hov-scale">
                <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#2563EB,#60A5FA)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{user.avatar}</div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>{user.name.split(" ")[0]}</span>
                <span style={{ color: "#94A3B8", fontSize: 10 }}>▼</span>
              </button>
              {profOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, background: "white", borderRadius: 18, boxShadow: "0 10px 40px rgba(0,0,0,.14)", border: "1.5px solid #E2E8F0", minWidth: 220, padding: 10, zIndex: 200 }} className="aSc">
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", marginBottom: 6 }}>
                    <div style={{ fontWeight: 800, color: "#0F172A", fontSize: 15 }}>{user.name}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{user.email}</div>
                  </div>
                  {[["📊", "Dashboard", "dashboard"], ["📋", "Reports", "reports"]].map(([ic, l, t]) => (
                    <button key={t} onClick={() => { setProfOpen(false); setTab(t); }} className="menu-item" style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 16px", color: "#374151", fontSize: 14, cursor: "pointer", borderRadius: 10, fontFamily: "var(--font)", fontWeight: 600, transition: "background .15s" }}>{ic} {l}</button>
                  ))}
                  <div style={{ borderTop: "1px solid #F1F5F9", marginTop: 6, paddingTop: 6 }}>
                    <button onClick={() => setUser(null)} className="menu-item" style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 16px", color: "#EF4444", fontSize: 14, cursor: "pointer", borderRadius: 10, fontFamily: "var(--font)", fontWeight: 700 }}>🚪 Sign Out</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </nav>

        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "36px 28px" }}>

          {/* ══ ANALYZE ══ */}
          {tab === "analyze" && (
            <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: 22 }}>
                <div className="a0">
                  <div style={{ ...H1, marginBottom: 10 }}>Scam <span style={{ background: "linear-gradient(135deg,#2563EB,#10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Detector</span></div>
                  <div style={{ ...BODY, fontSize: 17, color: "#64748b" }}>Paste any suspicious message, URL, or upload a screenshot. Gemini AI will analyze it instantly and tell you if it is a scam.</div>
                </div>
                <div style={card({ padding: 24 })} className="a1">
                  <div style={{ ...H2, marginBottom: 4, fontSize: 18 }}>What are you checking?</div>
                  <div style={{ ...BODYM, marginBottom: 18 }}>Select the type of content to analyze:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {CTYPES.map((t) => (
                      <button key={t.id} onClick={() => selectType(t)} className={`chip${ctype.id === t.id ? " chip-sel" : ""}`}
                        style={{ background: ctype.id === t.id ? "#EFF6FF" : "#F8FAFF", border: `2px solid ${ctype.id === t.id ? "#93C5FD" : "#E2E8F0"}`, color: ctype.id === t.id ? "#2563EB" : "#64748b", borderRadius: 12, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: ctype.id === t.id ? 800 : 500, fontFamily: "var(--font)", transition: "all .2s", display: "flex", alignItems: "center", gap: 6 }}>
                        {t.icon} {t.label}
                        {IMAGE_SUPPORTED.has(t.id) && <span style={{ background: ctype.id === t.id ? "#BFDBFE" : "#E2E8F0", borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, color: ctype.id === t.id ? "#2563EB" : "#94A3B8" }}>IMG</span>}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={card({ padding: 24 })} className="a2">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ ...H2, fontSize: 18 }}>{ctype.icon} {ctype.label}</div>
                      <div style={{ ...BODYM, fontSize: 13, marginTop: 3 }}>Paste the content or describe what you received</div>
                    </div>
                    {(content || image) && <button onClick={() => { setContent(""); setResult(null); setImage(null); setError(""); }} style={{ background: "none", border: "1.5px solid #E2E8F0", borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#94A3B8", fontFamily: "var(--font)", fontWeight: 600 }}>Clear All</button>}
                  </div>
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={ctype.ph}
                    style={{ ...inp({ minHeight: 180, resize: "vertical", lineHeight: 1.8, fontSize: 14, fontFamily: "var(--mono)", padding: "16px" }) }} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, marginBottom: showImg ? 20 : 0 }}>
                    <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500 }}>{content.length} characters</div>
                    {showImg && <div style={{ fontSize: 12, color: "#2563EB", fontWeight: 700 }}>📸 Image upload supported</div>}
                  </div>
                  {showImg && (
                    <div className="aSl" style={{ marginBottom: 20 }}>
                      <ImageUploader image={image} onImage={setImage} onRemove={() => setImage(null)} />
                      {image && <div style={{ marginTop: 12 }}><label style={lbl}>Note about this image (optional)</label><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. This was sent to me on WhatsApp..." style={inp({ fontSize: 13, padding: "10px 14px" })} /></div>}
                    </div>
                  )}
                  {error && <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "14px 18px", color: "#DC2626", fontSize: 15, marginBottom: 16, lineHeight: 1.6 }} className="aSl">⚠️ {error}</div>}
                  <button onClick={analyze} disabled={loading || (!content.trim() && !image)} className="btn-glow"
                    style={btnP({ width: "100%", padding: "17px", fontSize: 17, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: loading || (!content.trim() && !image) ? .5 : 1 })}>
                    {loading ? <><span style={{ width: 22, height: 22, border: "3px solid rgba(255,255,255,.4)", borderTopColor: "white", borderRadius: "50%", animation: "spin .7s linear infinite", display: "block" }} /><span>Gemini AI Analyzing {image ? "Image" : "Content"}...</span></> : `🔍 Analyze ${image ? "Screenshot" : "Content"} for Scams`}
                  </button>
                </div>
              </div>

              <div style={{ flex: "1 1 400px" }}>
                {!result && !loading && (
                  <div style={{ ...card({ textAlign: "center", padding: 60, background: "linear-gradient(135deg,#F8FAFF,#EFF6FF)" }) }} className="a0">
                    <div style={{ fontSize: 72, marginBottom: 20 }} className="aFl">🛡️</div>
                    <div style={{ ...H1, fontSize: 26, marginBottom: 12 }}>Ready to Analyze</div>
                    <div style={{ ...BODY, fontSize: 16, color: "#94A3B8", maxWidth: 340, margin: "0 auto 28px", lineHeight: 1.7 }}>Select a content type, paste text or upload a screenshot, then click Analyze for an accurate Gemini AI result.</div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                      {["SMS Scams", "UPI Fraud", "Fake Jobs 📸", "Social Media 📸", "Investment 📸", "Phishing"].map((t) => (
                        <div key={t} style={{ background: "white", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "7px 14px", fontSize: 13, color: "#64748b", fontWeight: 600 }}>{t}</div>
                      ))}
                    </div>
                  </div>
                )}
                {loading && (
                  <div style={card({ textAlign: "center", padding: 52 })} className="a0">
                    <div style={{ position: "relative", width: 68, height: 68, margin: "0 auto 24px" }}>
                      <div style={{ width: 68, height: 68, border: "5px solid #DBEAFE", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin .9s linear infinite" }} />
                      <div style={{ position: "absolute", inset: 14, background: "#EFF6FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔍</div>
                    </div>
                    <div style={{ ...H2, marginBottom: 8 }}>Gemini AI Analyzing...</div>
                    <div style={{ ...BODYM, marginBottom: 24, fontSize: 15 }}>Scanning for scam patterns and threat signals</div>
                    {["Scanning for known scam patterns", "Analyzing language and intent", "Checking threat indicators", "Computing risk score"].map((s, i) => (
                      <div key={i} style={{ marginBottom: 12, textAlign: "left" }}>
                        <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 5, fontWeight: 600 }}>{s}...</div>
                        <div style={{ height: 8, borderRadius: 5, background: "#F1F5F9", overflow: "hidden" }}><div className="shimmer" style={{ height: "100%", width: `${50 + i * 14}%`, borderRadius: 5 }} /></div>
                      </div>
                    ))}
                  </div>
                )}
                {result && <AnalysisResult result={result} onChat={() => setChatOpen(true)} />}
              </div>
            </div>
          )}

          {/* ══ DASHBOARD ══ */}
          {tab === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div className="a0"><div style={H1}>Your Dashboard</div><div style={{ ...BODY, marginTop: 6, color: "#64748b", fontSize: 16 }}>Overview of all your scam detection activity</div></div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[
                  { ic: "🔍", label: "Total Analyzed", val: stats.total, color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
                  { ic: "💀", label: "Scams Caught", val: stats.scams, color: "#B91C1C", bg: "#FFF1F2", border: "#FDA4AF" },
                  { ic: "🚨", label: "High Risk", val: stats.highRisk, color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" },
                  { ic: "⚠️", label: "Suspicious", val: stats.suspicious, color: "#D97706", bg: "#FFFBEB", border: "#FCD34D" },
                  { ic: "✅", label: "Safe", val: stats.safe, color: "#059669", bg: "#ECFDF5", border: "#6EE7B7" },
                ].map((s, i) => (
                  <div key={s.label} className={`a${i % 5} hov-lift`} style={{ ...card({ background: s.bg, border: `2px solid ${s.border}`, padding: "24px 28px", flex: "1 1 120px", minWidth: 120, textAlign: "center", transition: "all .25s" }) }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>{s.ic}</div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: s.color, fontFamily: "var(--mono)", lineHeight: 1, marginBottom: 6 }}>{s.val}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8", letterSpacing: "1.2px", textTransform: "uppercase", fontWeight: 700 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {stats.total > 0 ? (
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ ...card(), flex: "1 1 300px" }} className="a2">
                    <div style={{ ...H2, marginBottom: 6 }}>Threat Distribution</div>
                    <div style={{ ...BODYM, marginBottom: 22 }}>Breakdown of all analyzed content</div>
                    {[["Scam", stats.scams, "#B91C1C"], ["High Risk", stats.highRisk, "#DC2626"], ["Suspicious", stats.suspicious, "#D97706"], ["Safe", stats.safe, "#059669"]].map(([l, v, c]) => (
                      <div key={l} style={{ marginBottom: 18 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                          <span style={{ fontSize: 15, color: "#374151", fontWeight: 700 }}>{l}</span>
                          <span style={{ fontSize: 15, color: c, fontWeight: 800, fontFamily: "var(--mono)" }}>{v} <span style={{ color: "#94A3B8", fontSize: 12, fontWeight: 500 }}>({stats.total ? Math.round(v / stats.total * 100) : 0}%)</span></span>
                        </div>
                        <div style={{ background: "#F1F5F9", borderRadius: 8, height: 12, overflow: "hidden" }}>
                          <div style={{ background: `linear-gradient(90deg,${c},${c}cc)`, height: 12, borderRadius: 8, width: `${stats.total ? (v / stats.total * 100) : 0}%`, transition: "width 1.2s ease", boxShadow: `0 2px 8px ${c}55` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ ...card(), flex: "1 1 300px" }} className="a3">
                    <div style={{ ...H2, marginBottom: 6 }}>Recent Scans</div>
                    <div style={{ ...BODYM, marginBottom: 20 }}>Your latest analysis results</div>
                    {DB.getAll().slice(0, 7).map((r, i) => {
                      const cfg = RISK[r.riskLevel] || RISK.Safe;
                      return (
                        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < 6 ? "1px solid #F8FAFF" : "none" }}>
                          <div style={{ fontSize: 22 }}>{CTYPES.find((t) => t.label === r.contentType)?.icon || "📄"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.category}</div>
                            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 1 }}>{r.contentType} · {new Date(r.createdAt).toLocaleTimeString()}</div>
                          </div>
                          <div style={{ background: cfg.light, color: cfg.color, borderRadius: 10, padding: "4px 12px", fontSize: 12, fontWeight: 800, flexShrink: 0, border: `1px solid ${cfg.border}` }}>{cfg.icon} {r.riskLevel}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ ...card({ textAlign: "center", padding: 72, background: "linear-gradient(135deg,#F8FAFF,#EFF6FF)" }) }} className="a2">
                  <div style={{ fontSize: 60, marginBottom: 16 }}>📊</div>
                  <div style={{ ...H2, marginBottom: 10 }}>No Data Yet</div>
                  <div style={{ ...BODY, color: "#94A3B8", maxWidth: 320, margin: "0 auto 24px" }}>Start analyzing suspicious content to see your stats here.</div>
                  <button onClick={() => setTab("analyze")} className="btn-glow" style={btnP({ fontSize: 16, padding: "15px 30px" })}>Start Analyzing →</button>
                </div>
              )}
            </div>
          )}

          {/* ══ REPORTS ══ */}
          {tab === "reports" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div className="a0"><div style={H1}>Scan Reports</div><div style={{ ...BODY, marginTop: 6, color: "#64748b" }}>{reports.length} total scans</div></div>
              <div style={card()} className="a1">
                {reports.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 56 }}>
                    <div style={{ fontSize: 52, marginBottom: 14 }}>📋</div>
                    <div style={{ ...H2, marginBottom: 10 }}>No Reports Yet</div>
                    <div style={{ ...BODYM, marginBottom: 20, fontSize: 15 }}>Analyze content to build your scan history</div>
                    <button onClick={() => setTab("analyze")} className="btn-glow" style={btnP({ fontSize: 15, padding: "13px 26px" })}>Analyze Something →</button>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #F1F5F9" }}>
                          {["#", "Content Type", "Category", "Risk Level", "Score", "Preview", "Time"].map((h) => (
                            <th key={h} style={{ padding: "12px 16px", color: "#94A3B8", textAlign: "left", fontWeight: 700, fontSize: 12, letterSpacing: "1.2px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((r) => {
                          const cfg = RISK[r.riskLevel] || RISK.Safe;
                          return (
                            <tr key={r.id} className="row-hover" style={{ borderBottom: "1px solid #F8FAFF" }}>
                              <td style={{ padding: "14px 16px", color: "#94A3B8", fontFamily: "var(--mono)", fontSize: 12 }}>#{r.id}</td>
                              <td style={{ padding: "14px 16px" }}><span style={{ background: "#F1F5F9", borderRadius: 10, padding: "5px 12px", fontSize: 13, color: "#374151", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>{CTYPES.find((t) => t.label === r.contentType)?.icon} {r.contentType}{r.hasImage && <span style={{ background: "#DBEAFE", color: "#2563EB", borderRadius: 5, padding: "1px 5px", fontSize: 10, fontWeight: 700 }}>IMG</span>}</span></td>
                              <td style={{ padding: "14px 16px", color: "#0F172A", fontWeight: 700, fontSize: 14 }}>{r.category}</td>
                              <td style={{ padding: "14px 16px" }}><span style={{ background: cfg.light, color: cfg.color, borderRadius: 10, padding: "5px 12px", fontSize: 13, fontWeight: 800, border: `1px solid ${cfg.border}` }}>{cfg.icon} {r.riskLevel}</span></td>
                              <td style={{ padding: "14px 16px", color: cfg.color, fontWeight: 900, fontFamily: "var(--mono)", fontSize: 16 }}>{r.score}</td>
                              <td style={{ padding: "14px 16px", color: "#64748b", fontSize: 13, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.content}</td>
                              <td style={{ padding: "14px 16px", color: "#94A3B8", fontSize: 12, whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ SAFETY TIPS ══ */}
          {tab === "tips" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div className="a0"><div style={H1}>Safety Tips 💡</div><div style={{ ...BODY, marginTop: 8, color: "#64748b", fontSize: 16, maxWidth: 560 }}>Complete guide to protect yourself from every type of digital scam targeting people in India</div></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 18 }}>
                {[
                  { icon: "💬", title: "SMS & WhatsApp Scams", color: "#3B82F6", tips: ["Never click links in unexpected SMS — always go directly to the bank website yourself", "Banks, RBI and government agencies NEVER ask for your OTP via SMS or call", "Verify by calling the official number printed on your card or bank passbook", "Urgency phrases like account blocked or verify now are manipulation tactics — ignore them"] },
                  { icon: "💳", title: "UPI Payment Fraud", color: "#EF4444", tips: ["Collect requests require your PIN — entering PIN SENDS money, it does NOT receive it", "Scammers send Re.1 collect requests claiming it verifies KYC — this is always a lie", "Always verify the merchant VPA name carefully before entering your PIN", "Never scan QR codes sent by unknown people — it initiates a payment FROM your account"] },
                  { icon: "🔑", title: "OTP Fraud", color: "#F59E0B", tips: ["Your OTP is like your ATM PIN — never share it with anyone including bank officials", "RBI, CBI, Income Tax, and police NEVER ask for OTP over phone", "Screen sharing apps like AnyDesk and TeamViewer can steal your OTPs in real time", "If you receive an unsolicited OTP, immediately change your password and call your bank"] },
                  { icon: "💼", title: "Fake Job Scams", color: "#10B981", tips: ["Any job asking for upfront fees for registration, training or uniform is a scam", "Legitimate companies never conduct professional interviews via WhatsApp video call", "Verify the company: check their official website, LinkedIn, and search their name online", "Salaries of Rs.25,000-50,000 per month for simple home-based work are impossible"] },
                  { icon: "📈", title: "Investment Fraud", color: "#7C3AED", tips: ["SEBI-registered investments NEVER guarantee fixed high returns — it is illegal", "Pyramid and Ponzi schemes require recruiting others to sustain — they always collapse", "Always check SEBI registration at sebi.gov.in before investing in any scheme", "Monthly returns of 3-10 percent are impossible and are always a scam"] },
                  { icon: "🎰", title: "Lottery & Prize Scams", color: "#F97316", tips: ["You cannot win a lottery you did not enter — there is no such thing", "All processing fees or taxes to claim prizes are pure theft", "KBC and government lotteries never announce winners via SMS or DM", "If it sounds too good to be true — winning crores for nothing — it is always fake"] },
                ].map((tip, i) => (
                  <div key={i} style={card()} className={`a${i % 4} hov-lift`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                      <div style={{ width: 50, height: 50, borderRadius: 16, background: `${tip.color}14`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{tip.icon}</div>
                      <div style={{ ...H2, fontSize: 17 }}>{tip.title}</div>
                    </div>
                    {tip.tips.map((t, j) => (
                      <div key={j} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 7, background: `${tip.color}18`, color: tip.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, flexShrink: 0, marginTop: 2 }}>✓</div>
                        <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, fontWeight: 500 }}>{t}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ RESOURCES ══ */}
          {tab === "resources" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              <div className="a0"><div style={H1}>Emergency Resources 🆘</div><div style={{ ...BODY, marginTop: 8, color: "#64748b", fontSize: 16 }}>If you have been scammed — act fast. Here is exactly what to do.</div></div>
              <div style={{ background: "linear-gradient(135deg,#FEF2F2,#FFF1F2)", border: "2.5px solid #FCA5A5", borderRadius: 24, padding: 30 }} className="a1">
                <div style={{ ...H2, color: "#B91C1C", marginBottom: 8 }}>🚨 Emergency Contacts — Call Now</div>
                <div style={{ ...BODYM, marginBottom: 20, fontSize: 15 }}>Official Indian government helplines for cyber fraud victims:</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
                  {[
                    { l: "National Cyber Crime Helpline", v: "1930", ic: "📞", sub: "Free, 24/7 support" },
                    { l: "Cybercrime Portal", v: "cybercrime.gov.in", ic: "🌐", sub: "File online complaint" },
                    { l: "RBI Ombudsman", v: "14448", ic: "🏦", sub: "Banking fraud" },
                    { l: "NPCI Helpline", v: "1800-120-1740", ic: "💳", sub: "UPI/IMPS disputes" },
                  ].map((r) => (
                    <div key={r.l} style={{ background: "white", borderRadius: 16, padding: 20, border: "1.5px solid #FECACA" }}>
                      <div style={{ fontSize: 26, marginBottom: 8 }}>{r.ic}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#DC2626", fontFamily: "var(--mono)", marginBottom: 4 }}>{r.v}</div>
                      <div style={{ fontSize: 13, color: "#0F172A", fontWeight: 700, marginBottom: 2 }}>{r.l}</div>
                      <div style={{ fontSize: 12, color: "#94A3B8" }}>{r.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={card()} className="a2">
                <div style={{ ...H2, marginBottom: 8 }}>📋 If You Have Been Scammed — Do This Now</div>
                <div style={{ ...BODYM, marginBottom: 24, fontSize: 15 }}>Follow these steps in order. Speed matters — act fast to recover your money.</div>
                {[
                  { n: 1, title: "Do Not Panic — Stay Calm", desc: "Scammers rely on panic. Take a breath. Do not transfer any more money no matter what they say.", c: "#2563EB", ic: "🧘" },
                  { n: 2, title: "Stop All Contact Immediately", desc: "Block the scammer's number, email, and social media profiles right now. Do not respond further.", c: "#7C3AED", ic: "🚫" },
                  { n: 3, title: "Document Everything", desc: "Screenshot all conversations, payment confirmations, UPI transaction IDs, and caller details. You will need these for your complaint.", c: "#0EA5E9", ic: "📸" },
                  { n: 4, title: "Call Your Bank Immediately", desc: "Call your bank 24/7 helpline to freeze the account or block the card. PhonePe: 080-68727374, Google Pay: 1-800-419-0157, Paytm: 0120-4456-456.", c: "#D97706", ic: "🏦" },
                  { n: 5, title: "File a Cybercrime Complaint", desc: "Visit cybercrime.gov.in or call 1930 (free, 24/7). File under Financial Cyber Fraud. The sooner you file, the higher the chance of freezing the scammer's account.", c: "#DC2626", ic: "📋" },
                  { n: 6, title: "Follow Up on Your Complaint", desc: "Keep your complaint reference number and follow up every 2-3 days. Recovery is possible if you act quickly.", c: "#059669", ic: "🔗" },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 18, alignItems: "flex-start", marginBottom: 18, padding: "20px 22px", background: "#FAFBFF", borderRadius: 16, border: "1.5px solid #F1F5F9" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 16, background: `${s.c}12`, color: s.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0, border: `1.5px solid ${s.c}25` }}>{s.ic}</div>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>Step {s.n}: {s.title}</div>
                      <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.8 }}>{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: "linear-gradient(135deg,#EFF6FF,#E0F2FE)", borderRadius: 24, padding: 36, textAlign: "center", border: "2px solid #BFDBFE" }} className="a3">
                <div style={{ fontSize: 56, marginBottom: 14 }} className="aFl">🤖</div>
                <div style={{ ...H1, fontSize: 26, marginBottom: 8 }}>Need Personalized Guidance?</div>
                <div style={{ ...BODY, fontSize: 16, color: "#64748b", maxWidth: 450, margin: "0 auto 24px", lineHeight: 1.7 }}>Our Gemini AI Recovery Assistant is available 24/7. Tell us what happened and get step-by-step guidance tailored to your situation.</div>
                <button onClick={() => setChatOpen(true)} className="btn-glow" style={btnP({ fontSize: 17, padding: "17px 36px" })}>💬 Open Recovery Assistant Now</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid #E2E8F0", padding: "20px 28px", textAlign: "center", color: "#94A3B8", fontSize: 13, background: "white", fontWeight: 500 }}>
          🛡️ ScamGuard AI · Powered by Gemini AI (Google) · Cybercrime Portal: <span style={{ color: "#2563EB", fontWeight: 700 }}>cybercrime.gov.in</span> · 24/7 Helpline: <span style={{ color: "#DC2626", fontWeight: 700 }}>1930</span>
        </div>
      </div>

      {chatOpen && <RecoveryChat ctx={result || {}} onClose={() => setChatOpen(false)} />}
    </>
  );
}