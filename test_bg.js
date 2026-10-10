const fs = require('fs');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

async function test() {
    console.log("Starting BG removal test...");
    try {
        const dummyBuffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'blue' } }).jpeg().toBuffer();
        console.log("Image created. Running removeBackground...");
        const bgBlob = await removeBackground(new Blob([dummyBuffer], { type: "image/jpeg" }));
        const outBuffer = Buffer.from(await bgBlob.arrayBuffer());
        console.log("Success! Output size:", outBuffer.length);
    } catch(e) {
        console.error("BG Removal Error:", e);
    }
}
test();
