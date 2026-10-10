const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { removeBackground } = require('@imgly/background-removal-node');

async function testPerfect() {
    const selfiePath = 'C:\\Users\\ADMIN\\.gemini\\antigravity-ide\\brain\\1deab39e-8291-4cd9-9865-bbe854e8bd30\\media__1791434703618.jpg';
    const templatePath = path.join(__dirname, 'uploads/templates/template_inspire_manak.png');
    const outputPath = path.join(__dirname, 'uploads/results/test_inspire_perfect.png');

    console.log("1. Running AI background removal with local bundled model data...");
    const absPath = path.resolve(selfiePath);
    const fileUrl = 'file:///' + absPath.replace(/\\/g, '/');
    const localDataDir = path.resolve(__dirname, 'node_modules/@imgly/background-removal-data/dist');
    const publicPath = 'file:///' + localDataDir.replace(/\\/g, '/') + '/';

    const start = Date.now();
    const blob = await removeBackground(fileUrl, { publicPath, model: 'small' });
    const arrayBuffer = await blob.arrayBuffer();
    const cutoutBuffer = Buffer.from(arrayBuffer);
    console.log(`AI BG removal DONE in ${Date.now() - start} ms! Cutout size: ${cutoutBuffer.length} bytes`);

    fs.writeFileSync('cutout_perfect.png', cutoutBuffer);

    // Composite onto Inspire-Manak template
    const masterMeta = await sharp(templatePath).metadata();
    const mW = masterMeta.width || 1024;
    const mH = masterMeta.height || 1024;

    const targetW = Math.round(mW * 0.65);
    const targetH = Math.round(mH * 0.70);

    const resizedCutout = await sharp(cutoutBuffer)
        .resize(targetW, targetH, { fit: 'inside' })
        .toBuffer();

    const subjectMeta = await sharp(resizedCutout).metadata();
    const subW = subjectMeta.width || targetW;
    const subH = subjectMeta.height || targetH;

    const left = Math.round((mW - subW) * 0.45);
    const top = Math.round(mH - subH - 10);

    const shadowW = Math.round(subW * 0.85);
    const shadowH = Math.round(subH * 0.10);
    const svgShadow = Buffer.from(`<svg width="${shadowW}" height="${shadowH}" viewBox="0 0 ${shadowW} ${shadowH}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW * 0.45}" ry="${shadowH * 0.45}" fill="#000000" opacity="0.4" />
    </svg>`);

    const shadowBuffer = await sharp(svgShadow).blur(12).png().toBuffer();
    const shadowLeft = Math.round(left + (subW - shadowW) / 2);
    const shadowTop = Math.round(mH - shadowH - 5);

    await sharp(templatePath)
        .composite([
            { input: shadowBuffer, top: shadowTop, left: shadowLeft },
            { input: resizedCutout, top, left }
        ])
        .png()
        .toFile(outputPath);

    console.log("SUCCESS! Output saved to:", outputPath);
}

testPerfect().catch(e => console.error(e));
