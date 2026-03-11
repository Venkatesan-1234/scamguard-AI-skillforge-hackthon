const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_KEY = "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";

async function testGroq() {
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
                messages: [{
                    role: "user",
                    content: "Test"
                }]
            }),
        });
        const d = await res.json();
        console.log("Response:", JSON.stringify(d, null, 2));
    } catch (err) {
        console.error("Network Error:", err);
    }
}

testGroq();
