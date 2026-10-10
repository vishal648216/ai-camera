const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testProcessFace() {
    try {
        // Create a dummy image
        const dummyPath = path.join(__dirname, 'dummy.png');
        await require('sharp')({
            create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
        }).png().toFile(dummyPath);

        const form = new FormData();
        form.append('selfie', fs.createReadStream(dummyPath));

        console.log("Sending request to process-face...");
        const res = await axios.post('http://127.0.0.1:5000/api/process-face', form, {
            headers: form.getHeaders(),
        });

        console.log("Response:", res.status, res.data);
    } catch (e) {
        console.error("Error:", e.response ? `${e.response.status} ${e.response.data}` : e.message);
    }
}

testProcessFace();
