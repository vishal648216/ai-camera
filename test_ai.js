const axios = require('axios');
const fs = require('fs');

async function testAI() {
    try {
        const prompt = "Hyper-realistic portrait";
        const aiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=1024&model=flux&nologo=true&seed=${Date.now()}`;
        console.log("Requesting: ", aiUrl);
        const aiRes = await axios.get(aiUrl, { responseType: 'arraybuffer', timeout: 50000 });
        console.log("Success! Data length: ", aiRes.data.length);
        fs.writeFileSync('test_output.jpg', aiRes.data);
    } catch(e) {
        console.error("Error:", e.message);
    }
}
testAI();
