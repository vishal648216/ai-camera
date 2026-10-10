const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function createAnchorFace(width, height) {
    // Generate a clean, well-lit target anchor face PNG buffer
    const svgFace = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="skinGrad" cx="50%" cy="45%" r="50%">
                <stop offset="0%" stop-color="#f5d0a9" />
                <stop offset="70%" stop-color="#e0ac69" />
                <stop offset="100%" stop-color="#c68642" />
            </radialGradient>
            <linearGradient id="hairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#2c1d11" />
                <stop offset="100%" stop-color="#1a110b" />
            </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="none"/>
        <!-- Hair background -->
        <ellipse cx="${width * 0.5}" cy="${height * 0.42}" rx="${width * 0.42}" ry="${height * 0.45}" fill="url(#hairGrad)" />
        <!-- Head / Face Oval -->
        <ellipse cx="${width * 0.5}" cy="${height * 0.5}" rx="${width * 0.36}" ry="${height * 0.42}" fill="url(#skinGrad)" />
        <!-- Eyebrows -->
        <path d="M ${width * 0.25} ${height * 0.38} Q ${width * 0.35} ${height * 0.34} ${width * 0.42} ${height * 0.38}" stroke="#2c1d11" stroke-width="${width * 0.03}" fill="none" stroke-linecap="round" />
        <path d="M ${width * 0.58} ${height * 0.38} Q ${width * 0.65} ${height * 0.34} ${width * 0.75} ${height * 0.38}" stroke="#2c1d11" stroke-width="${width * 0.03}" fill="none" stroke-linecap="round" />
        <!-- Eyes -->
        <ellipse cx="${width * 0.34}" cy="${height * 0.44}" rx="${width * 0.07}" ry="${height * 0.05}" fill="#ffffff" />
        <ellipse cx="${width * 0.66}" cy="${height * 0.44}" rx="${width * 0.07}" ry="${height * 0.05}" fill="#ffffff" />
        <circle cx="${width * 0.34}" cy="${height * 0.44}" r="${width * 0.035}" fill="#3d2314" />
        <circle cx="${width * 0.66}" cy="${height * 0.44}" r="${width * 0.035}" fill="#3d2314" />
        <circle cx="${width * 0.35}" cy="${height * 0.43}" r="${width * 0.012}" fill="#ffffff" />
        <circle cx="${width * 0.67}" cy="${height * 0.43}" r="${width * 0.012}" fill="#ffffff" />
        <!-- Nose -->
        <path d="M ${width * 0.5} ${height * 0.44} L ${width * 0.47} ${height * 0.58} L ${width * 0.53} ${height * 0.58}" stroke="#b07236" stroke-width="${width * 0.02}" fill="none" stroke-linecap="round" />
        <!-- Lips -->
        <path d="M ${width * 0.38} ${height * 0.68} Q ${width * 0.5} ${height * 0.65} ${width * 0.62} ${height * 0.68} Q ${width * 0.5} ${height * 0.76} ${width * 0.38} ${height * 0.68} Z" fill="#d9777f" />
    </svg>`;
    return await sharp(Buffer.from(svgFace)).png().toBuffer();
}

async function createFeatheredMask(width, height) {
    // Generate soft elliptical mask for seamless blending
    const svgMask = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="feather" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="1" />
                <stop offset="75%" stop-color="#ffffff" stop-opacity="0.9" />
                <stop offset="90%" stop-color="#ffffff" stop-opacity="0.4" />
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
            </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="none"/>
        <ellipse cx="${width * 0.5}" cy="${height * 0.5}" rx="${width * 0.48}" ry="${height * 0.48}" fill="url(#feather)" />
    </svg>`;
    return await sharp(Buffer.from(svgMask)).png().toBuffer();
}

async function generateAllAnchors() {
    const configPath = path.join(__dirname, 'template_config.json');
    if (!fs.existsSync(configPath)) return;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    for (const t of config.templates) {
        for (const region of t.face_regions) {
            const anchorPath = path.join(__dirname, region.anchor_image.replace(/^\//, ''));
            const maskPath = path.join(__dirname, region.mask.replace(/^\//, ''));

            fs.mkdirSync(path.dirname(anchorPath), { recursive: true });

            const w = region.width || 340;
            const h = region.height || 400;

            const anchorBuf = await createAnchorFace(w, h);
            await sharp(anchorBuf).toFile(anchorPath);
            console.log(`Generated Target Face Anchor: ${anchorPath}`);

            const maskBuf = await createFeatheredMask(w, h);
            await sharp(maskBuf).toFile(maskPath);
            console.log(`Generated Feathered Face Mask: ${maskPath}`);
        }
    }
}

generateAllAnchors().then(() => console.log("All target anchors and masks successfully generated.")).catch(console.error);
