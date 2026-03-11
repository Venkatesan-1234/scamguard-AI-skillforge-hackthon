const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const VISION_KEY = "AIzaSyDyh2mYfNaCNxRiqDfK3jRt_gvfJNnifFU";

console.log("Sending request to Google Cloud Vision API...");
fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        requests: [
            {
                image: { content: base64Data },
                features: [{ type: "TEXT_DETECTION" }]
            }
        ]
    })
})
    .then(r => r.json())
    .then(visionData => {
        console.log("Response:", JSON.stringify(visionData, null, 2));
    })
    .catch(err => {
        console.error("Fetch error:", err);
    });
