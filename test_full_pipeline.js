const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { removeBackground } = require('@imgly/background-removal-node');

async function processBackdropComposite({ selfiePath, masterTemplatePath, outputPath, templateId }) {
    console.log(`[BackdropComposite] Processing backdrop composite for template: ${templateId}...`);
    const tempSubjectCutout = path.join(__dirname, 'uploads/selfies', `cutout_test_${Date.now()}.png`);

    try {
        let bgSuccess = false;
        try {
            const fileUrl = 'file:///' + selfiePath.replace(/\\/g, '/');
            const blob = await removeBackground(fileUrl);
            const arrayBuffer = await blob.arrayBuffer();
            const cutoutBuffer = Buffer.from(arrayBuffer);
            if (cutoutBuffer && cutoutBuffer.length > 1000) {
                fs.writeFileSync(tempSubjectCutout, cutoutBuffer);
                bgSuccess = true;
                console.log(`[BackdropComposite] JS @imgly background removal successful (${cutoutBuffer.length} bytes)!`);
            }
        } catch (jsErr) {
            console.warn(`[BackdropComposite] JS bg removal notice (${jsErr.message})`);
        }

        if (!bgSuccess) {
            fs.copyFileSync(selfiePath, tempSubjectCutout);
        }

        const masterMeta = await sharp(masterTemplatePath).metadata();
        const mW = masterMeta.width || 1024;
        const mH = masterMeta.height || 1024;

        let targetW = Math.round(mW * 0.75);
        let targetH = Math.round(mH * 0.80);
        let leftOffsetRatio = 0.5;

        if (templateId === 'template_inspire_manak') {
            targetW = Math.round(mW * 0.70);
            targetH = Math.round(mH * 0.75);
            leftOffsetRatio = 0.45;
        }

        const resizedSubject = await sharp(tempSubjectCutout)
            .resize(targetW, targetH, { fit: 'inside' })
            .toBuffer();

        const subjectMeta = await sharp(resizedSubject).metadata();
        const subW = subjectMeta.width || targetW;
        const subH = subjectMeta.height || targetH;

        const left = Math.round((mW - subW) * leftOffsetRatio);
        const top = Math.round(mH - subH - (templateId === 'template_inspire_manak' ? 15 : 0));

        const shadowW = Math.round(subW * 0.9);
        const shadowH = Math.round(subH * 0.12);
        const svgShadow = Buffer.from(`
        <svg width="${shadowW}" height="${shadowH}" viewBox="0 0 ${shadowW} ${shadowH}" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW * 0.45}" ry="${shadowH * 0.45}" fill="#000000" opacity="0.45" />
        </svg>`);

        const shadowBuffer = await sharp(svgShadow).blur(15).png().toBuffer();
        const shadowLeft = Math.round(left + (subW - shadowW) / 2);
        const shadowTop = Math.round(mH - shadowH - 10);

        await sharp(masterTemplatePath)
            .composite([
                { input: shadowBuffer, top: shadowTop, left: shadowLeft },
                { input: resizedSubject, top, left }
            ])
            .png()
            .toFile(outputPath);

        try { if (fs.existsSync(tempSubjectCutout)) fs.unlinkSync(tempSubjectCutout); } catch(e) {}

        return { success: true, provider: "Backdrop Event Composite Engine" };
    } catch (e) {
        console.error("[BackdropComposite] Critical error:", e.message);
        return { success: false, error: e.message };
    }
}

async function runTest() {
    const selfiePath = 'C:\\Users\\ADMIN\\.gemini\\antigravity-ide\\brain\\1deab39e-8291-4cd9-9865-bbe854e8bd30\\media__1791434703618.jpg';
    const masterTemplatePath = path.join(__dirname, 'uploads/templates/template_inspire_manak.png');
    const outputPath = path.join(__dirname, 'uploads/results/test_final_inspire.png');

    const res = await processBackdropComposite({
        selfiePath,
        masterTemplatePath,
        outputPath,
        templateId: 'template_inspire_manak'
    });

    console.log("Pipeline result:", res);
}

runTest();
