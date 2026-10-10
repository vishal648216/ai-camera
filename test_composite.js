const { removeBackground } = require('@imgly/background-removal-node');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function testComposite() {
    const selfiePath = 'C:\\Users\\ADMIN\\.gemini\\antigravity-ide\\brain\\1deab39e-8291-4cd9-9865-bbe854e8bd30\\media__1791434703618.jpg';
    const templatePath = path.join(__dirname, 'uploads', 'templates', 'template_inspire_manak.png');
    
    console.log('1. Removing selfie background via JS @imgly engine...');
    const fileUrl = 'file:///' + selfiePath.replace(/\\/g, '/');
    const blob = await removeBackground(fileUrl);
    const arrayBuffer = await blob.arrayBuffer();
    const cutoutBuffer = Buffer.from(arrayBuffer);
    
    console.log('Cutout generated! Buffer size:', cutoutBuffer.length);
    fs.writeFileSync('test_cutout_raw.png', cutoutBuffer);
    
    const masterMeta = await sharp(templatePath).metadata();
    const mW = masterMeta.width || 1024;
    const mH = masterMeta.height || 1024;
    console.log('Master dimensions:', mW, 'x', mH);
    
    const targetW = Math.round(mW * 0.60);
    const targetH = Math.round(mH * 0.70);
    
    const resizedCutout = await sharp(cutoutBuffer)
        .resize(targetW, targetH, { fit: 'inside' })
        .toBuffer();
        
    const subMeta = await sharp(resizedCutout).metadata();
    const subW = subMeta.width || targetW;
    const subH = subMeta.height || targetH;
    
    const left = Math.round((mW - subW) * 0.45);
    const top = Math.round(mH - subH - 10);
    
    const shadowW = Math.round(subW * 0.9);
    const shadowH = Math.round(subH * 0.10);
    const svgShadow = Buffer.from(`<svg width="${shadowW}" height="${shadowH}" viewBox="0 0 ${shadowW} ${shadowH}" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="${shadowW/2}" cy="${shadowH/2}" rx="${shadowW*0.45}" ry="${shadowH*0.45}" fill="#000000" opacity="0.55" />
    </svg>`);
    
    const shadowBuffer = await sharp(svgShadow).blur(12).png().toBuffer();
    
    await sharp(templatePath)
        .composite([
            { input: shadowBuffer, top: Math.round(mH - shadowH - 5), left: Math.round(left + (subW - shadowW)/2) },
            { input: resizedCutout, top, left }
        ])
        .png()
        .toFile('test_inspire_result.png');
        
    console.log('COMPOSITE SUCCESS! Output saved to test_inspire_result.png');
}

testComposite().catch(e => console.error(e));
