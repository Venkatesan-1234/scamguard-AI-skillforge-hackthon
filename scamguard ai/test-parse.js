const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = "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";

async function analyzeText(content, contentType) {
    try {
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

        console.log("Raw Response Content:", d.choices?.[0]?.message?.content);

        const raw = d.choices?.[0]?.message?.content || "{}";
        const result = JSON.parse(raw.replace(/```json|```/g, "").trim());
        console.log("Parsed JSON:", result);
    } catch (err) {
        console.error("ANALYSIS FAILED:", err.message);
    }
}

analyzeText("Hello I am a prince from Nigeria and I need your help", "Email");
