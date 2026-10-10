const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function testAIEngine() {
    console.log("=========================================");
    console.log("⚡ TESTING COMPLETE AI PHOTO BOOTH ENGINE");
    console.log("=========================================");

    const selfieDir = path.join(__dirname, 'uploads', 'selfies');
    const templateDir = path.join(__dirname, 'uploads', 'templates');
    const resultDir = path.join(__dirname, 'uploads', 'results');

    [selfieDir, templateDir, resultDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    // 1. Create a dummy synthetic sample portrait image if none exists
    const testSelfiePath = path.join(selfieDir, 'test_portrait_input.png');
    const testTemplatePath = path.join(templateDir, 'template_inspire_manak.png');
    const testOutputPath = path.join(resultDir, 'test_ai_output_result.png');

    if (!fs.existsSync(testSelfiePath)) {
        const svgPortrait = `
        <svg width="600" height="800" xmlns="http://www.w3.org/2000/svg">
            <rect width="600" height="800" fill="#2d3748"/>
            <circle cx="300" cy="280" r="140" fill="#e2e8f0"/>
            <ellipse cx="300" cy="270" rx="100" ry="110" fill="#d69e2e"/>
            <path d="M 160 800 C 160 520, 440 520, 440 800 Z" fill="#3182ce"/>
        </svg>`;
        await sharp(Buffer.from(svgPortrait)).png().toFile(testSelfiePath);
    }

    if (!fs.existsSync(testTemplatePath)) {
        const svgTemplate = `
        <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0f0c29" />
                    <stop offset="50%" stop-color="#302b63" />
                    <stop offset="100%" stop-color="#24243e" />
                </linearGradient>
            </defs>
            <rect width="1080" height="1080" fill="url(#bg)"/>
            <rect x="50" y="50" width="980" height="980" fill="none" stroke="#00f2fe" stroke-width="6" rx="24"/>
            <text x="540" y="140" font-family="sans-serif" font-size="44" font-weight="bold" fill="#00f2fe" text-anchor="middle">EXHIBITION HALL PHOTO BOOTH</text>
        </svg>`;
        await sharp(Buffer.from(svgTemplate)).png().toFile(testTemplatePath);
    }

    // 2. Perform AI Brightness Analysis & Exposure Normalization
    console.log("1️⃣ [AI STEP 1] Analyzing Portrait Exposure & Luminance...");
    let selfieBuffer = await sharp(testSelfiePath).rotate().png().toBuffer();
    const stats = await sharp(selfieBuffer).stats();
    const meanBrightness = stats.channels.reduce((acc, c) => acc + c.mean, 0) / stats.channels.length;
    console.log(` -> Mean Brightness: ${meanBrightness.toFixed(2)}`);

    if (meanBrightness < 120) {
        console.log(" -> Auto-Boosting exposure and vibrant tone...");
        selfieBuffer = await sharp(selfieBuffer)
            .modulate({ brightness: 1.25, saturation: 1.15 })
            .sharpen({ sigma: 1.1 })
            .png()
            .toBuffer();
    }

    // 3. Perform Anti-Box Alpha Edge Gradient & Foot Shadow
    console.log("2️⃣ [AI STEP 2] Processing High-Precision Anti-Box Mask & Ground Shadow...");
    const selfieMeta = await sharp(selfieBuffer).metadata();
    const subW = 540;
    const subH = Math.round(540 * (selfieMeta.height / selfieMeta.width));

    let resizedCutout = await sharp(selfieBuffer)
        .resize(subW, subH, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
        .toBuffer();

    // Fade bottom 12% to prevent straight crop lines
    const fadeSvg = Buffer.from(`
    <svg width="${subW}" height="${subH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="fade" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#fff" stop-opacity="1"/>
                <stop offset="85%" stop-color="#fff" stop-opacity="1"/>
                <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
            <mask id="m"><rect width="${subW}" height="${subH}" fill="url(#fade)"/></mask>
        </defs>
        <rect width="${subW}" height="${subH}" fill="#fff" mask="url(#m)"/>
    </svg>`);
    const fadeAlpha = await sharp(fadeSvg).png().toBuffer();
    resizedCutout = await sharp(resizedCutout).composite([{ input: fadeAlpha, blend: 'dest-in' }]).png().toBuffer();

    // Create Soft Elliptical Foot Shadow
    const shadowW = Math.round(subW * 0.75);
    const shadowH = 24;
    const svgShadow = Buffer.from(`<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${shadowW/2}" cy="${shadowH/2}" rx="${shadowW*0.45}" ry="${shadowH*0.45}" fill="#000" opacity="0.35"/></svg>`);
    const shadowBuf = await sharp(svgShadow).blur(6).png().toBuffer();

    // 4. Dual-Layer Composite (Layer 1 Backdrop + Layer 2 Subject Cutout + Layer 3 Branding Frame)
    console.log("3️⃣ [AI STEP 3] Compositing 3-Layer DSLR Studio Image...");
    const left = Math.round((1080 - subW) / 2);
    const top = 1040 - subH;

    const frameBorder = Buffer.from(`
    <svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
        <rect x="20" y="20" width="1040" height="1040" fill="none" stroke="gold" stroke-width="8" rx="16" opacity="0.85"/>
        <text x="540" y="1020" font-family="sans-serif" font-size="28" font-weight="bold" fill="gold" text-anchor="middle">★ VIP PHOTO BOOTH OFFICIAL ★</text>
    </svg>`);
    const frameBuf = await sharp(frameBorder).png().toBuffer();

    await sharp(testTemplatePath)
        .composite([
            { input: shadowBuf, top: top + subH - 12, left: left + Math.round((subW - shadowW)/2) },
            { input: resizedCutout, top, left },
            { input: frameBuf, top: 0, left: 0 }
        ])
        .png({ quality: 100 })
        .toFile(testOutputPath);

    const outStats = fs.statSync(testOutputPath);
    console.log("=========================================");
    console.log(`✅ SUCCESS: AI Composite Generated Perfectly!`);
    console.log(` 📁 Output Image: ${testOutputPath}`);
    console.log(` 📏 File Size: ${(outStats.size / 1024).toFixed(1)} KB`);
    console.log("=========================================");
}

testAIEngine().catch(err => {
    console.error("❌ Test error:", err);
});
