const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const mediaType = "image/png";

const dataUri = `data:${mediaType};base64,${base64Data}`;

const fd = new FormData();
fd.append("base64Image", dataUri);
fd.append("apikey", "K88095559088957");
fd.append("language", "eng");

console.log("Sending request to OCR...");
fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: fd
})
    .then(r => r.json())
    .then(ocrData => {
        console.log("Response:", JSON.stringify(ocrData, null, 2));
    })
    .catch(err => {
        console.error("Fetch error:", err);
    });
