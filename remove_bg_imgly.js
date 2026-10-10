const { removeBackground } = require('@imgly/background-removal-node');
const fs = require('fs');
const path = require('path');

async function run() {
    const inputPath = process.argv[2];
    const outputPath = process.argv[3];
    
    if (!inputPath || !outputPath) {
        console.error("Usage: node remove_bg_imgly.js <inputPath> <outputPath>");
        process.exit(1);
    }
    
    try {
        const absInput = path.resolve(inputPath);
        const fileUrl = 'file:///' + absInput.replace(/\\/g, '/');
        
        let publicPath = undefined;
        const localDataDir = path.resolve(__dirname, 'node_modules/@imgly/background-removal-data/dist');
        if (fs.existsSync(localDataDir)) {
            publicPath = 'file:///' + localDataDir.replace(/\\/g, '/') + '/';
        }

        console.log(`[IsolatedRemoveBG] Starting BG removal with publicPath: ${publicPath || 'CDN'}...`);
        const blob = await removeBackground(fileUrl, { publicPath, model: 'medium' });
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        fs.writeFileSync(outputPath, buffer);
        console.log("SUCCESS");
        process.exit(0);
    } catch(e) {
        console.error("ERROR:", e.message);
        process.exit(1);
    }
}

run();
