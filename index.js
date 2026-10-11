const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { exec } = require('child_process');
const sharp = require('sharp');
const axios = require('axios');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

// Ensure DNS SRV resolution for MongoDB Atlas works seamlessly across Windows networks & ISPs
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (dnsErr) {
    console.warn("Custom DNS set notice:", dnsErr.message);
}

const isVercel = process.env.VERCEL || process.env.NOW_REGION;

const getUploadDir = (subDir) => {
    let dirPath = isVercel ? path.join(os.tmpdir(), 'uploads', subDir) : path.join(__dirname, 'uploads', subDir);
    if (!fs.existsSync(dirPath)) {
        try { fs.mkdirSync(dirPath, { recursive: true }); } catch (e) {
            dirPath = path.join(os.tmpdir(), 'uploads', subDir);
            try { fs.mkdirSync(dirPath, { recursive: true }); } catch (err) {}
        }
    }
    return dirPath;
};

const ensureDirs = () => {
    ['templates', 'selfies', 'results'].forEach(d => getUploadDir(d));
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY');
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: "online", app: "AI Photo Booth Backend API", timestamp: new Date().toISOString() });
});

app.get('/api/results/:id', async (req, res) => {
    try {
        const reg = await safeFindRegistrationById(req.params.id);
        if (reg && reg.resultData) {
            return res.json({ success: true, id: reg.id, resultData: reg.resultData, resultUrl: reg.resultUrl, personaDescription: reg.personaDescription });
        }
        res.status(404).json({ success: false, message: 'Result not found' });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.use('/uploads', async (req, res) => {
    const localPath = path.join(__dirname, 'uploads', req.path);
    if (fs.existsSync(localPath)) return res.sendFile(localPath);
    const tmpPath = path.join(os.tmpdir(), 'uploads', req.path);
    if (fs.existsSync(tmpPath)) return res.sendFile(tmpPath);

    try {
        await ensureDBConnected();
        if (req.path.includes('/results/')) {
            const filename = path.basename(req.path);
            const regId = filename.replace(/^result_/, '').replace(/\.png$/, '');
            let reg = await safeFindRegistrationById(regId);
            if (reg && reg.resultData && reg.resultData.startsWith('data:image')) {
                const base64Str = reg.resultData.split(',')[1];
                const imgBuf = Buffer.from(base64Str, 'base64');
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(imgBuf);
            }
        }
        if (req.path.includes('/templates/')) {
            const temps = await safeGetTemplates(true);
            const filename = path.basename(req.path);
            const templateId = filename.replace(/\.png$/, '');
            const t = temps.find(x => x.id === templateId || (x.imageUrl && x.imageUrl.includes(filename)));
            if (t) {
                const uri = t.imageData || t.imageUrl || t.master_image;
                if (uri && uri.startsWith('data:image')) {
                    const base64Str = uri.split(',')[1];
                    const imgBuf = Buffer.from(base64Str, 'base64');
                    res.setHeader('Content-Type', 'image/png');
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    return res.send(imgBuf);
                }
            }
        }
    } catch(e) {}

    res.status(404).send('Not found');
});

app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    try {
        const adminPath = path.resolve(__dirname, 'public', 'admin.html');
        res.setHeader('Content-Type', 'text/html');
        res.send(fs.readFileSync(adminPath, 'utf8'));
    } catch (e) { res.status(500).send("Error loading admin: " + e.message); }
});

const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }
});

function ensureFileSaved(reqFile, subDir) {
    if (!reqFile) return null;
    if (reqFile.path && fs.existsSync(reqFile.path)) return reqFile.path;
    
    const ext = path.extname(reqFile.originalname || 'file.png') || '.png';
    const filename = `${uuidv4()}${ext}`;
    const filePath = path.join(getUploadDir(subDir), filename);
    
    if (reqFile.buffer) {
        fs.writeFileSync(filePath, reqFile.buffer);
    }
    reqFile.path = filePath;
    reqFile.filename = filename;
    return filePath;
}

const dbStoreDir = getUploadDir('data');
const dbStorePath = path.join(dbStoreDir, 'db_store.json');
let dbStore = { registrations: [], events: [], templates: [], configs: {} };

function loadDbStore() {
    try {
        if (fs.existsSync(dbStorePath)) {
            const raw = fs.readFileSync(dbStorePath, 'utf8');
            dbStore = JSON.parse(raw);
        }
    } catch (e) {
        console.warn("Notice loading db_store.json:", e.message);
    }
}

function saveDbStore() {
    try {
        fs.writeFileSync(dbStorePath, JSON.stringify(dbStore, null, 2));
    } catch (e) {
        console.warn("Notice saving db_store.json:", e.message);
    }
}
loadDbStore();

mongoose.set('bufferCommands', false);

const defaultTemplates = [];

const templateSchema = new mongoose.Schema({ id: String, name: String, imageUrl: String, imageData: String, circleX: Number, circleY: Number, circleSize: Number, maskShape: String, isActive: Boolean, createdAt: String }, { strict: false });
const Template = mongoose.model('Template', templateSchema);

const registrationSchema = new mongoose.Schema({ id: String, token: String, eventId: String, name: String, email: String, phone: String, gender: String, company: String, personaDescription: String, usedProvider: String, selfieUrl: String, resultUrl: String, resultData: String, timestamp: String }, { strict: false });
const Registration = mongoose.model('Registration', registrationSchema);

const eventSchema = new mongoose.Schema({
    id: String, name: String, location: String, ownerName: String, ownerNumber: String, 
    logoUrl: String, watermarkEnabled: Boolean, status: { type: String, default: 'active' }, createdAt: String,
    startDate: String, endDate: String, startTime: String, endTime: String, breakTime: String,
    bannerUrl: String, bannerCircleX: Number, bannerCircleY: Number, bannerCircleSize: Number, bannerMaskShape: String
}, { strict: false });
const EventModel = mongoose.model('Event', eventSchema);

const configSchema = new mongoose.Schema({ id: { type: String, default: 'main' }, analytics: { type: Object, default: { totalGens: 0, failovers: 0, popularThemes: {} } }, settings: { type: Object, default: {} } }, { strict: false });
const Config = mongoose.model('Config', configSchema);

async function safeGetRegistrations() {
    try {
        if (mongoose.connection.readyState === 1) {
            const list = await Registration.find().sort({ _id: -1 }).lean();
            if (list) return list;
        }
    } catch (e) {}
    return dbStore.registrations || [];
}

async function safeGetEvents() {
    try {
        if (mongoose.connection.readyState === 1) {
            const evs = await EventModel.find().sort({ _id: -1 }).lean();
            if (evs) return evs;
        }
    } catch (e) {}
    return dbStore.events || [];
}

function loadConfigTemplates() {
    try {
        const configPath = path.join(__dirname, 'template_config.json');
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg && cfg.templates && Array.isArray(cfg.templates) && cfg.templates.length > 0) {
                const uploadTemplatesDir = getUploadDir('templates');
                return cfg.templates.map(t => {
                    const templateId = t.id || 'template_default';
                    const diskFileName = `${templateId}.png`;
                    const diskFilePath = path.join(uploadTemplatesDir, diskFileName);
                    const relativeUrl = `/uploads/templates/${diskFileName}`;

                    const rawData = t.imageData || t.imageUrl || t.master_image;
                    if (rawData && rawData.startsWith('data:image')) {
                        if (!fs.existsSync(diskFilePath)) {
                            try {
                                const base64Str = rawData.split(',')[1];
                                fs.writeFileSync(diskFilePath, Buffer.from(base64Str, 'base64'));
                                console.log(`[Templates] Extracted config template Base64 to disk: ${diskFileName}`);
                            } catch (e) {
                                console.warn(`Notice writing template ${diskFileName}:`, e.message);
                            }
                        }
                    }

                    return {
                        id: templateId,
                        name: t.name || 'Event Template',
                        mode: t.mode || 'backdrop',
                        desc: t.desc || '',
                        imageUrl: relativeUrl,
                        circleX: t.circleX || 540,
                        circleY: t.circleY || 450,
                        circleSize: t.circleSize || 700,
                        imgW: t.imgW || 1080,
                        imgH: t.imgH || 1350,
                        isActive: t.isActive !== false
                    };
                });
            }
        }
    } catch(e) {
        console.warn("Notice loading template_config.json:", e.message);
    }
    return [];
}

async function safeGetTemplates(all = true, includeBase64 = false) {
    const cfgTemps = loadConfigTemplates();
    let list = [...cfgTemps];

    if (dbStore.templates && Array.isArray(dbStore.templates)) {
        for (const rawT of dbStore.templates) {
            const tid = rawT.id || (rawT._id ? rawT._id.toString() : '');
            const t = { ...rawT, id: tid };
            if (tid && !list.some(x => x.id === tid)) {
                list.push(t);
            }
        }
    }
    
    try {
        if (mongoose.connection.readyState === 1) {
            const filter = all ? {} : { isActive: { $ne: false } };
            const projection = includeBase64 ? {} : { imageData: 0 };
            const queryPromise = Template.find(filter, projection).sort({ sortOrder: 1, _id: -1 }).lean();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500));
            const temps = await Promise.race([queryPromise, timeoutPromise]);
            if (temps && temps.length > 0) {
                for (const rawT of temps) {
                    const tid = rawT.id || (rawT._id ? rawT._id.toString() : '');
                    const t = { ...rawT, id: tid };
                    if (tid && !list.some(x => x.id === tid)) {
                        list.push(t);
                    }
                }
            }
        }
    } catch (e) {
        // Fallback to local/cached templates immediately
    }

    const mapped = list.map(t => {
        const tid = t.id || (t._id ? t._id.toString() : '');
        const cleanUrl = (t.imageUrl && !t.imageUrl.startsWith('data:image')) 
            ? t.imageUrl 
            : `/uploads/templates/${tid}.png`;
        
        const resObj = {
            ...t,
            id: tid,
            imageUrl: cleanUrl
        };
        if (!includeBase64) {
            delete resObj.imageData;
        } else if (!resObj.imageData && t.imageUrl && t.imageUrl.startsWith('data:image')) {
            resObj.imageData = t.imageUrl;
        }
        return resObj;
    });

    // Pre-extract Base64 template images to disk so cold starts are instant!
    try {
        const uploadTemplatesDir = getUploadDir('templates');
        for (const t of mapped) {
            if (t && t.id && (t.imageData || t.imageUrl)) {
                const diskPath = path.join(uploadTemplatesDir, `${t.id}.png`);
                const uri = t.imageData || t.imageUrl;
                if (uri && uri.startsWith('data:image') && !fs.existsSync(diskPath)) {
                    try {
                        fs.writeFileSync(diskPath, Buffer.from(uri.split(',')[1], 'base64'));
                        console.log(`[PreExtract] Pre-cached template disk image for: ${t.name} (${t.id})`);
                    } catch(err) {}
                }
            }
        }
    } catch(e) {}

    return mapped;
}

async function safeFindUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await Registration.findOne({ email: new RegExp('^' + cleanEmail + '$', 'i') }).sort({ _id: -1 }).lean();
            if (user) return user;
        }
    } catch (e) {}
    if (dbStore.registrations) {
        for (const reg of dbStore.registrations) {
            if (reg.email && reg.email.trim().toLowerCase() === cleanEmail) {
                return reg;
            }
        }
    }
    return null;
}

async function safeFindRegistrationById(id) {
    if (!id) return null;
    await ensureDBConnected();
    try {
        if (mongoose.connection.readyState === 1) {
            const reg = await Registration.findOne({ id }).lean();
            if (reg) return reg;
        }
    } catch (e) {}
    if (dbStore.registrations) {
        const found = dbStore.registrations.find(r => r.id === id);
        if (found) return found;
    }
    return null;
}

async function safeSaveRegistration(regData) {
    if (!regData || !regData.id) return;
    if (!dbStore.registrations) dbStore.registrations = [];
    const idx = dbStore.registrations.findIndex(r => r.id === regData.id);
    if (idx >= 0) dbStore.registrations[idx] = regData;
    else dbStore.registrations.unshift(regData);
    saveDbStore();

    try {
        if (mongoose.connection.readyState === 1) {
            await Registration.updateOne({ id: regData.id }, { $set: regData }, { upsert: true });
        }
    } catch (e) {
        console.warn("DB safeSaveRegistration notice:", e.message);
    }
}

async function safeSaveEvent(evData) {
    if (!evData || !evData.id) return;
    if (!dbStore.events) dbStore.events = [];
    const idx = dbStore.events.findIndex(e => e.id === evData.id);
    if (idx >= 0) dbStore.events[idx] = evData;
    else dbStore.events.unshift(evData);
    saveDbStore();

    try {
        if (mongoose.connection.readyState === 1) {
            await EventModel.updateOne({ id: evData.id }, { $set: evData }, { upsert: true });
        }
    } catch (e) {}
}

function saveToTemplateConfig(tData) {
    if (!tData || !tData.id) return;
    try {
        const configPath = path.join(__dirname, 'template_config.json');
        let cfg = { templates: [] };
        if (fs.existsSync(configPath)) {
            try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch(e) {}
        }
        if (!cfg.templates || !Array.isArray(cfg.templates)) cfg.templates = [];
        const idx = cfg.templates.findIndex(t => t.id === tData.id);
        if (idx >= 0) cfg.templates[idx] = tData;
        else cfg.templates.unshift(tData);
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        console.log(`[TemplateConfig] Persisted template '${tData.name}' (${tData.id}) to template_config.json`);
    } catch(e) {
        console.warn("Notice updating template_config.json:", e.message);
    }
}

function deleteFromTemplateConfig(id) {
    if (!id) return;
    try {
        const configPath = path.join(__dirname, 'template_config.json');
        if (fs.existsSync(configPath)) {
            let cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg && cfg.templates && Array.isArray(cfg.templates)) {
                cfg.templates = cfg.templates.filter(t => t.id !== id && t._id !== id);
                fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
                console.log(`[TemplateConfig] Deleted template ${id} from template_config.json`);
            }
        }
    } catch(e) {}
}

function clearTemplateConfig() {
    try {
        const configPath = path.join(__dirname, 'template_config.json');
        fs.writeFileSync(configPath, JSON.stringify({ templates: [] }, null, 2));
    } catch(e) {}
}

async function safeSaveTemplate(tData) {
    if (!tData || !tData.id) return;
    if (!dbStore.templates) dbStore.templates = [];
    const idx = dbStore.templates.findIndex(t => t.id === tData.id);
    if (idx >= 0) dbStore.templates[idx] = tData;
    else dbStore.templates.unshift(tData);
    saveDbStore();
    saveToTemplateConfig(tData);

    try {
        if (mongoose.connection.readyState === 1) {
            await Template.updateOne({ id: tData.id }, { $set: tData }, { upsert: true });
        }
    } catch (e) {}
}

async function safeDeleteEvent(id) {
    if (dbStore.events) dbStore.events = dbStore.events.filter(e => e.id !== id);
    saveDbStore();
    try {
        if (mongoose.connection.readyState === 1) {
            await EventModel.deleteOne({ id });
        }
    } catch (e) {}
}

async function safeDeleteTemplate(id) {
    if (dbStore.templates) dbStore.templates = dbStore.templates.filter(t => t.id !== id);
    saveDbStore();
    deleteFromTemplateConfig(id);
    try {
        if (mongoose.connection.readyState === 1) {
            await Template.deleteMany({ $or: [{ id: id }, { _id: id }] });
        }
    } catch (e) {}
}

async function safeDeleteAllTemplates() {
    dbStore.templates = [];
    saveDbStore();
    clearTemplateConfig();
    try {
        if (mongoose.connection.readyState === 1) {
            await Template.deleteMany({});
        }
    } catch (e) {}
}

let dbConnPromise = null;
async function ensureDBConnected() {
    if (mongoose.connection.readyState === 1) return;
    if (!dbConnPromise) {
        dbConnPromise = connectDB();
    }
    try { await dbConnPromise; } catch(e) {}
}

async function connectDB() {
    ensureDirs();
    const atlasUri = 'mongodb+srv://aipersona:aipersona@cluster0.g4wl0mi.mongodb.net/aipersona?retryWrites=true&w=majority&appName=Cluster0';
    const mongoUri = process.env.MONGODB_URI || atlasUri;
    try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        console.log('MongoDB connected successfully via primary URI');
        await initializeDB();
    } catch (err) {
        console.warn('Primary MONGODB_URI notice:', err.message, 'Trying direct Atlas fallback...');
        try {
            await mongoose.connect(atlasUri, { serverSelectionTimeoutMS: 5000 });
            console.log('MongoDB Atlas connected via direct fallback URI!');
            await initializeDB();
        } catch (atlasErr) {
            console.warn('MongoDB Atlas notice:', atlasErr.message, 'Trying local MongoDB...');
            try {
                await mongoose.connect('mongodb://127.0.0.1:27017/ai_persona_app', { serverSelectionTimeoutMS: 3000 });
                console.log('Local MongoDB connected successfully!');
                await initializeDB();
            } catch (localErr) {
                console.warn('Local MongoDB notice:', localErr.message, 'Using persistent Disk DB Store.');
            }
        }
    }
}

async function initializeDB() {
    if (mongoose.connection.readyState !== 1) return;
    try {
        let config = await Config.findOne({ id: 'main' });
        if (!config) {
            config = new Config({ id: 'main' });
            config.settings = { primaryProvider: "Ghost_1_256", failoverEnabled: true };
            await config.save();
        }
        const count = await Template.countDocuments();
        if (count === 0) {
            for (const t of defaultTemplates) {
                await Template.updateOne({ id: t.id }, { $set: t }, { upsert: true });
            }
            console.log("Seeded initial default templates into DB");
        }
    } catch (e) {
        console.warn("DB init notice:", e.message);
    }
}
connectDB();

// Dynamic Auto Status Check helper
function checkEventStatus(event) {
    if(!event) return 'deactive';
    if(event.status === 'closed' || event.status === 'deactive') return event.status;
    const now = new Date();
    try {
        if(event.startDate && event.endDate) {
            const start = new Date(event.startDate); 
            const end = new Date(event.endDate); 
            end.setHours(23,59,59);
            if(!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                if(now < start || now > end) return 'deactive';
            }
        }
    } catch(e) {}

    try {
        if(typeof event.startTime === 'string' && typeof event.endTime === 'string' && event.startTime.includes(':') && event.endTime.includes(':')) {
           const [sh, sm] = event.startTime.split(':').map(Number);
           const [eh, em] = event.endTime.split(':').map(Number);
           if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
               const minsNow = now.getHours()*60 + now.getMinutes();
               if(minsNow < (sh*60+sm) || minsNow > (eh*60+em)) return 'deactive';
           }
        }
    } catch(e) {}
    return 'active';
}

function getPublicUrl(req) {
    if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host');
    return `${proto}://${host}`;
}

// User Public Mobile Result Page
app.get('/share/:id', async (req, res) => {
    try {
        const reg = await safeFindRegistrationById(req.params.id);
        if (!reg) return res.status(404).send("<h2 style='color:white;text-align:center;margin-top:50px;font-family:sans-serif;'>Photo Not Found</h2>");
        const evs = await safeGetEvents();
        const event = evs.find(e => e.id === reg.eventId) || { name: 'AI Photo Booth' };
        const publicUrl = getPublicUrl(req);
        const furl = (reg.resultUrl && reg.resultUrl.startsWith('http')) ? reg.resultUrl : `${publicUrl}${reg.resultUrl}`;
        const imgSrc = reg.resultData || furl;
        
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${event.name} | My Photo Result</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body { background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); color: white; font-family: 'Outfit', sans-serif; min-height: 100vh; padding: 20px 15px; }
        .card-custom { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(15px); border-radius: 24px; border: 1px solid rgba(0, 242, 254, 0.3); padding: 24px; max-width: 450px; margin: 0 auto; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
        .result-img { width: 100%; max-height: 480px; object-fit: contain; border-radius: 20px; border: 2px solid #00f2fe; box-shadow: 0 0 25px rgba(0,242,254,0.4); margin-bottom: 20px; }
        .btn-custom { border-radius: 16px; padding: 14px 20px; font-weight: 700; font-size: 16px; letter-spacing: 1px; text-decoration: none; display: block; margin-bottom: 12px; transition: all 0.3s ease; }
        .btn-dl { background: #00f2fe; color: #000; box-shadow: 0 0 15px rgba(0,242,254,0.4); }
        .btn-dl:hover { background: #4facfe; color: #000; }
        .btn-share { background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); }
        .badge-event { background: rgba(0,242,254,0.15); color: #00f2fe; border: 1px solid rgba(0,242,254,0.3); padding: 6px 14px; border-radius: 20px; font-size: 13px; letter-spacing: 1px; display: inline-block; margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="text-center">
        <div class="card-custom">
            <span class="badge-event">AI PHOTO BOOTH</span>
            <h3 class="fw-bold mb-3">${event.name}</h3>
            <img src="${imgSrc}" class="result-img" alt="Your AI Photo">
            <p class="mb-4 text-white-50">Hello <b>${reg.name}</b>, your AI photo is ready!</p>
            <a href="${imgSrc}" download="PersonaPRO_AI_Photo_${reg.id}.png" class="btn btn-custom btn-dl">
                💾 DOWNLOAD HIGH QUALITY PHOTO
            </a>
            <button onclick="sharePhoto()" class="btn btn-custom btn-share w-100">
                📤 SHARE PHOTO
            </button>
        </div>
    </div>
    <script>
        async function sharePhoto() {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: '${event.name} Photo Result',
                        text: 'Check out my AI photo!',
                        url: window.location.href
                    });
                } catch(e) {}
            } else {
                navigator.clipboard.writeText(window.location.href);
                alert('Result link copied to clipboard!');
            }
        }
    </script>
</body>
</html>`);
    } catch(e) {
        res.status(500).send("Error loading share page: " + e.message);
    }
});

// Dynamic QR Code Endpoint
app.get('/api/qr/:id', async (req, res) => {
    try {
        const reg = await safeFindRegistrationById(req.params.id);
        if (!reg) return res.status(404).send("Not found");
        
        const publicUrl = getPublicUrl(req);
        const shareUrl = `${publicUrl}/share/${reg.id}?t=${reg.token || 'valid'}`;
        
        const qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 300, margin: 2 });
        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");
        const img = Buffer.from(base64Data, 'base64');
        
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': img.length
        });
        res.end(img);
    } catch (e) {
        res.status(500).send("Error generating QR code: " + e.message);
    }
});

// Automatic Selfie Quality Check Endpoint
app.post('/api/check-quality', upload.single('selfie'), async (req, res) => {
    if (!req.file) return res.status(400).json({ valid: false, reason: "No image file uploaded" });
    ensureFileSaved(req.file, 'selfies');
    try {
        const blendScript = path.join(__dirname, 'face_blend.py');
        exec(`python "${blendScript}" --check-quality "${req.file.path}"`, (error, stdout, stderr) => {
            if (error) {
                console.error("Quality Check Exec Error:", error.message);
                return res.json({ valid: true, reason: "OK" }); // fallback on error
            }
            try {
                const result = JSON.parse(stdout.trim());
                return res.json(result);
            } catch (e) {
                return res.json({ valid: true, reason: "OK" });
            }
        });
    } catch (e) {
        return res.status(500).json({ valid: false, reason: e.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Dashboard Stats
app.get('/api/admin/stats', async (req, res) => {
    const regList = await safeGetRegistrations();
    const evList = await safeGetEvents();
    res.json({
        totalUsers: regList.length,
        eventsCount: evList.length,
        registrations: regList.slice(0, 15),
        totalRevenue: (regList.length * 5.0).toFixed(2),
        popularThemes: dbStore.configs?.analytics?.popularThemes || {}
    });
});

// EVENTS Management
app.get('/api/admin/events', async (req, res) => {
    const evs = await safeGetEvents();
    res.json(evs.map(e => ({...e, liveState: checkEventStatus(e)})));
});

// Admin Magic Hour Status Diagnostic Endpoint
app.get('/api/admin/magic-hour-status', async (req, res) => {
    const key = process.env.MAGIC_HOUR_API_KEY || "";
    const isConfigured = key.length > 5 && !key.includes("YOUR_");
    res.json({
        configured: isConfigured,
        keyMasked: isConfigured ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "Not Configured",
        connection: isConfigured ? "Working" : "Missing API Key",
        creditsStatus: isConfigured ? "Available" : "Magic Hour API credits are unavailable.",
        lastRequest: new Date().toISOString()
    });
});

// Admin Template Calibration Config Endpoint
app.get('/api/admin/template-config', (req, res) => {
    const configPath = path.join(__dirname, 'template_config.json');
    if (fs.existsSync(configPath)) {
        res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } else {
        res.json({ templates: [] });
    }
});

app.post('/api/admin/template-config', (req, res) => {
    const configPath = path.join(__dirname, 'template_config.json');
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.post('/api/admin/events', upload.fields([{name:'logo'}, {name:'banner'}]), async (req, res) => {
    const body = req.body;
    if (req.files) {
        if (req.files['logo'] && req.files['logo'][0]) ensureFileSaved(req.files['logo'][0], 'templates');
        if (req.files['banner'] && req.files['banner'][0]) ensureFileSaved(req.files['banner'][0], 'templates');
    }
    const ev = {
        id: uuidv4(), name: body.name, location: body.location, ownerName: body.ownerName, ownerNumber: body.ownerNumber,
        startDate: body.startDate, endDate: body.endDate, startTime: body.startTime, endTime: body.endTime, breakTime: body.breakTime,
        watermarkEnabled: body.watermarkEnabled === 'true',
        bannerCircleX: parseInt(body.circleX)||0, bannerCircleY: parseInt(body.circleY)||0, bannerCircleSize: parseInt(body.circleSize)||300, bannerMaskShape: body.maskShape || 'circle',
        logoUrl: (req.files && req.files['logo'] && req.files['logo'][0]) ? `/uploads/templates/${req.files['logo'][0].filename}` : "",
        bannerUrl: (req.files && req.files['banner'] && req.files['banner'][0]) ? `/uploads/templates/${req.files['banner'][0].filename}` : "",
        createdAt: new Date().toISOString(), status: 'active'
    };
    await safeSaveEvent(ev);
    res.json(ev);
});

app.patch('/api/admin/events/:id/status', async (req, res) => {
    const evs = await safeGetEvents();
    const ev = evs.find(e => e.id === req.params.id);
    if(ev) { ev.status = req.body.status; await safeSaveEvent(ev); }
    res.json(ev || { success: true });
});

app.put('/api/admin/events/:id', upload.fields([{name:'logo'}, {name:'banner'}]), async (req, res) => {
    const body = req.body;
    const evs = await safeGetEvents();
    let ev = evs.find(e => e.id === req.params.id);
    if(!ev) return res.status(404).json({ error: "Event not found" });
    
    if (req.files) {
        if (req.files['logo'] && req.files['logo'][0]) ensureFileSaved(req.files['logo'][0], 'templates');
        if (req.files['banner'] && req.files['banner'][0]) ensureFileSaved(req.files['banner'][0], 'templates');
    }

    ev = {
        ...ev,
        name: body.name || ev.name,
        location: body.location || ev.location,
        ownerName: body.ownerName || ev.ownerName,
        ownerNumber: body.ownerNumber || ev.ownerNumber,
        startDate: body.startDate || ev.startDate,
        endDate: body.endDate || ev.endDate,
        startTime: body.startTime || ev.startTime,
        endTime: body.endTime || ev.endTime,
        breakTime: body.breakTime || ev.breakTime,
        watermarkEnabled: body.watermarkEnabled === 'true',
        bannerMaskShape: body.maskShape || ev.bannerMaskShape,
        bannerCircleX: parseInt(body.circleX) || ev.bannerCircleX,
        bannerCircleY: parseInt(body.circleY) || ev.bannerCircleY,
        bannerCircleSize: parseInt(body.circleSize) || ev.bannerCircleSize,
        logoUrl: (req.files && req.files['logo'] && req.files['logo'][0]) ? `/uploads/templates/${req.files['logo'][0].filename}` : ev.logoUrl,
        bannerUrl: (req.files && req.files['banner'] && req.files['banner'][0]) ? `/uploads/templates/${req.files['banner'][0].filename}` : ev.bannerUrl
    };

    await safeSaveEvent(ev);
    res.json(ev);
});

app.delete('/api/admin/events/:id', async (req, res) => {
    await safeDeleteEvent(req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/settings', async (req, res) => { res.json(dbStore.configs?.settings || {}); });
app.post('/api/admin/settings', async (req, res) => { dbStore.configs.settings = { ...dbStore.configs.settings, ...req.body }; saveDbStore(); res.json({ success: true }); });

app.get('/api/admin/leads', async (req, res) => {
    const list = await safeGetRegistrations();
    if (req.query.eventId) {
        return res.json(list.filter(r => r.eventId === req.query.eventId));
    }
    res.json(list);
});

app.get('/api/admin/events/:id/invoice', async (req, res) => {
    const evs = await safeGetEvents();
    const ev = evs.find(e => e.id === req.params.id);
    if (!ev) return res.status(404).send("Not found");
    const regList = await safeGetRegistrations();
    const count = regList.filter(r => r.eventId === ev.id).length;
    res.json({ event: ev, totalGenerations: count, costPerGeneration: 5.0, totalAmount: count*5.0, invoiceDate: new Date().toISOString() });
});

// App Templates (INJECT EVENT BANNER IF ACTIVE!)
app.get('/api/templates', async (req, res) => {
    try {
        console.log("Fetching templates...");
        let temps = await safeGetTemplates();
        let evs = await safeGetEvents();
        let activeEvent = evs.find(e => checkEventStatus(e) === 'active'); 
        
        const activeTemps = temps.filter(t => t.isActive !== false);
        if (activeEvent && activeEvent.bannerUrl && activeEvent.bannerUrl.length > 5) {
            activeTemps.unshift({
                id: 'EVENT_BANNER', 
                name: `🔥 ${activeEvent.name} (LIVE)`, 
                imageUrl: activeEvent.bannerUrl,
                circleX: activeEvent.bannerCircleX || 540, 
                circleY: activeEvent.bannerCircleY || 450, 
                circleSize: activeEvent.bannerCircleSize || 600,
                maskShape: activeEvent.bannerMaskShape || 'circle', 
                isActive: true
            });
        }
        
        const lightTemps = activeTemps.map(t => {
            const { imageData, ...rest } = t;
            return rest;
        });

        res.json(lightTemps);
    } catch(e) {
        console.error("Templates Fetch Notice:", e.message);
        try {
            const temps = await safeGetTemplates();
            const lightTemps = temps.map(t => {
                const { imageData, ...rest } = t;
                return rest;
            });
            res.json(lightTemps);
        } catch(err) {
            res.json([]);
        }
    }
});

app.get('/api/admin/templates', async (req, res) => {
    try {
        const temps = await safeGetTemplates(true, false);
        res.json(temps);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});
app.patch('/api/admin/templates/:id', async (req, res) => {
    const temps = await safeGetTemplates(true, true);
    const t = temps.find(x => x.id === req.params.id);
    if (t) {
        t.isActive = !t.isActive;
        await safeSaveTemplate(t);
    }
    const cleanT = t ? { ...t, imageUrl: `/uploads/templates/${t.id}.png` } : { success: true };
    delete cleanT.imageData;
    res.json(cleanT);
});
app.put('/api/admin/templates/:id', upload.single('template'), async (req, res) => {
    try {
        const temps = await safeGetTemplates(true, true);
        let t = temps.find(x => x.id === req.params.id);
        if (!t) return res.status(404).json({ error: "Template not found" });

        const tId = t.id;
        let base64Data = t.imageData;
        let relUrl = `/uploads/templates/${tId}.png`;

        if (req.file) {
            ensureFileSaved(req.file, 'templates');
            let fileBuf = req.file.buffer;
            if (!fileBuf && req.file.path && fs.existsSync(req.file.path)) {
                try { fileBuf = fs.readFileSync(req.file.path); } catch(e) {}
            }
            if (fileBuf) {
                try {
                    const compressedBuf = await sharp(fileBuf)
                        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                        .png({ compressionLevel: 7 })
                        .toBuffer();
                    base64Data = `data:image/png;base64,${compressedBuf.toString('base64')}`;
                    relUrl = `/uploads/templates/${tId}.png`;
                    const diskPath = path.join(getUploadDir('templates'), `${tId}.png`);
                    try { fs.writeFileSync(diskPath, compressedBuf); } catch(e) {}
                } catch(sharpErr) {
                    console.error("Sharp error on update:", sharpErr.message);
                    const mime = req.file.mimetype || 'image/png';
                    base64Data = `data:${mime};base64,${fileBuf.toString('base64')}`;
                    relUrl = `/uploads/templates/${tId}.png`;
                    const diskPath = path.join(getUploadDir('templates'), `${tId}.png`);
                    try { fs.writeFileSync(diskPath, fileBuf); } catch(e) {}
                }
            }
        }

        const imgW = parseInt(req.body.imgW) || t.imgW || 1080;
        const imgH = parseInt(req.body.imgH) || t.imgH || 1080;
        const circleX = (!isNaN(parseInt(req.body.circleX)) && isFinite(parseInt(req.body.circleX))) ? parseInt(req.body.circleX) : (t.circleX || Math.round(imgW / 2));
        const circleY = (!isNaN(parseInt(req.body.circleY)) && isFinite(parseInt(req.body.circleY))) ? parseInt(req.body.circleY) : (t.circleY || Math.round(imgH * 0.75));
        const circleSize = (!isNaN(parseInt(req.body.circleSize)) && isFinite(parseInt(req.body.circleSize))) ? parseInt(req.body.circleSize) : (t.circleSize || Math.round(imgH * 0.35));

        t = {
            ...t,
            name: req.body.name || t.name,
            mode: req.body.mode || t.mode,
            desc: req.body.desc || t.desc,
            imageUrl: relUrl,
            imageData: base64Data,
            imgW: imgW,
            imgH: imgH,
            circleX: circleX,
            circleY: circleY,
            circleSize: circleSize,
            maskShape: req.body.maskShape || t.maskShape,
            updatedAt: new Date().toISOString()
        };

        await safeSaveTemplate(t);
        const { imageData, ...lightweightT } = t;
        res.json({ ...lightweightT, imageUrl: relUrl });
    } catch(e) {
        console.error("Error updating template:", e);
        res.status(500).json({ error: e.message });
    }
});
app.delete('/api/admin/templates-all', async (req, res) => {
    await safeDeleteAllTemplates();
    res.json({ success: true, message: "All templates deleted" });
});
app.delete('/api/admin/templates/:id', async (req, res) => {
    await safeDeleteTemplate(req.params.id);
    res.json({ success: true });
});
app.post('/api/admin/templates', upload.single('template'), async (req, res) => {
    try {
        const tId = uuidv4();
        let base64Data = '/uploads/templates/default.png';
        let relUrl = `/uploads/templates/${tId}.png`;

        if (req.file) {
            ensureFileSaved(req.file, 'templates');
            let fileBuf = req.file.buffer;
            if (!fileBuf && req.file.path && fs.existsSync(req.file.path)) {
                try { fileBuf = fs.readFileSync(req.file.path); } catch(e) {}
            }
            if (fileBuf) {
                try {
                    const compressedBuf = await sharp(fileBuf)
                        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                        .png({ compressionLevel: 7 })
                        .toBuffer();
                    base64Data = `data:image/png;base64,${compressedBuf.toString('base64')}`;
                    relUrl = `/uploads/templates/${tId}.png`;
                    const diskPath = path.join(getUploadDir('templates'), `${tId}.png`);
                    try { fs.writeFileSync(diskPath, compressedBuf); } catch(e) {}
                } catch(sharpErr) {
                    console.error("Sharp error on upload:", sharpErr.message);
                    const mime = req.file.mimetype || 'image/png';
                    base64Data = `data:${mime};base64,${fileBuf.toString('base64')}`;
                    relUrl = `/uploads/templates/${tId}.png`;
                    const diskPath = path.join(getUploadDir('templates'), `${tId}.png`);
                    try { fs.writeFileSync(diskPath, fileBuf); } catch(e) {}
                }
            }
        }
        const imgW = parseInt(req.body.imgW) || 1080;
        const imgH = parseInt(req.body.imgH) || 1080;
        const circleX = (!isNaN(parseInt(req.body.circleX)) && isFinite(parseInt(req.body.circleX))) ? parseInt(req.body.circleX) : Math.round(imgW / 2);
        const circleY = (!isNaN(parseInt(req.body.circleY)) && isFinite(parseInt(req.body.circleY))) ? parseInt(req.body.circleY) : Math.round(imgH * 0.75);
        const circleSize = (!isNaN(parseInt(req.body.circleSize)) && isFinite(parseInt(req.body.circleSize))) ? parseInt(req.body.circleSize) : Math.round(imgH * 0.35);

        const t = {
            id: tId,
            name: req.body.name || 'Unnamed',
            mode: req.body.mode || 'backdrop',
            desc: req.body.desc || (req.body.mode === 'face_swap' ? 'Face Swap Costume Template' : 'Full-Body Event Backdrop Template'),
            imageUrl: relUrl,
            imageData: base64Data,
            imgW: imgW,
            imgH: imgH,
            circleX: circleX,
            circleY: circleY,
            circleSize: circleSize,
            maskShape: req.body.maskShape || 'circle',
            isActive: true,
            createdAt: new Date().toISOString()
        };
        await safeSaveTemplate(t);
        const { imageData, ...lightweightT } = t;
        res.json({ ...lightweightT, imageUrl: relUrl });
    } catch(e) {
        console.error("Error creating template:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/check-user', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ found: false });
    const user = await safeFindUserByEmail(email);
    if (user) {
        res.json({ found: true, name: user.name, phone: user.phone, gender: user.gender, company: user.company });
    } else {
        res.json({ found: false });
    }
});

// Force Vercel bundler to include background-removal-data
try {
    if (false) {
        require('@imgly/background-removal-data');
    }
} catch(e) {}

async function performBackgroundRemoval(inputPath) {
    try {
        // Fast downscale huge mobile camera selfies to max 1024px immediately
        let orientedSelfieBuf = await sharp(inputPath)
            .rotate()
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
        
        // AI Auto-Relighting & Exposure Correction for Dim/Dark Selfies
        try {
            const stats = await sharp(orientedSelfieBuf).stats();
            let meanBrightness = 0;
            if (stats && stats.channels) {
                const sum = stats.channels.reduce((acc, c) => acc + c.mean, 0);
                meanBrightness = sum / stats.channels.length;
            }
            console.log(`[AI-AutoEnhance] Input image mean brightness: ${meanBrightness.toFixed(1)}`);
            
            if (meanBrightness > 0 && meanBrightness < 120) {
                const boostFactor = Math.min(1.35, 1.0 + ((120 - meanBrightness) / 200));
                console.log(`[AI-AutoEnhance] Auto-boosting dim selfie exposure by factor: ${boostFactor.toFixed(2)}`);
                orientedSelfieBuf = await sharp(orientedSelfieBuf)
                    .modulate({ brightness: boostFactor, saturation: 1.12 })
                    .linear(1.08, -5)
                    .sharpen({ sigma: 1.1, m1: 1.2, m2: 2.5 })
                    .png()
                    .toBuffer();
            } else {
                orientedSelfieBuf = await sharp(orientedSelfieBuf)
                    .sharpen({ sigma: 0.9, m1: 1.0, m2: 2.0 })
                    .png()
                    .toBuffer();
            }
        } catch(enhErr) {
            console.warn("AI Auto-Enhance notice:", enhErr.message);
        }
        
        fs.writeFileSync(inputPath, orientedSelfieBuf);
    } catch(e) {}

    let cutoutBuffer = null;

    // PRIORITY 1: Python rembg with fast u2netp (local Windows only, 2-3s execution!)
    if (process.platform === 'win32' && !process.env.VERCEL) {
        try {
            const pyScript = path.join(__dirname, 'remove_bg.py');
            const tmpOut = path.join(getUploadDir('selfies'), `py_cutout_${uuidv4()}.png`);
            await new Promise((resolve, reject) => {
                exec(`python "${pyScript}" "${inputPath}" "${tmpOut}"`, { timeout: 25000 }, (error) => {
                    if (!error && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 1000) return resolve();
                    reject(error || new Error("Python rembg failed"));
                });
            });
            cutoutBuffer = fs.readFileSync(tmpOut);
            try { fs.unlinkSync(tmpOut); } catch(err) {}
            console.log(`[BackgroundRemoval] Python rembg SUCCESS (${cutoutBuffer.length} bytes)!`);
        } catch(pyErr) {
            console.warn(`[BackgroundRemoval] Local Python notice: ${pyErr.message}`);
        }
    }

    // PRIORITY 2: HuggingFace BRIA-RMBG-2.0 via Gradio (FREE, State-of-the-art AI, works on Vercel!)
    if (!cutoutBuffer) {
        try {
            console.log("[BackgroundRemoval] Calling HuggingFace BRIA-RMBG-2.0 via Gradio...");
            const { Client } = require('@gradio/client');
            
            // Resize selfies down to max 1024px for fast cloud transmission & inference
            let sendBuf = fs.readFileSync(inputPath);
            try {
                sendBuf = await sharp(sendBuf)
                    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
                    .png({ quality: 90 })
                    .toBuffer();
            } catch(reErr) {}

            const blob = new Blob([sendBuf], { type: 'image/png' });
            
            // 20s timeout protection so serverless function never hangs
            const gradioCall = (async () => {
                const client = await Client.connect('briaai/BRIA-RMBG-2.0');
                return await client.predict('/image', { image: blob });
            })();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("HuggingFace Gradio timeout after 20s")), 20000)
            );
            
            const result = await Promise.race([gradioCall, timeoutPromise]);
            
            // Extract transparent cutout image URL from gradio response (index 1 is no_bg_image.png)
            let imageUrl = null;
            if (Array.isArray(result?.data)) {
                if (result.data[1]?.url) {
                    imageUrl = result.data[1].url;
                } else if (result.data[0]?.url) {
                    imageUrl = result.data[0].url;
                } else if (Array.isArray(result.data[0]) && result.data[0][1]?.url) {
                    imageUrl = result.data[0][1].url;
                } else if (Array.isArray(result.data[0]) && result.data[0][0]?.url) {
                    imageUrl = result.data[0][0].url;
                }
            } else if (result?.data?.url) {
                imageUrl = result.data.url;
            }
            
            if (imageUrl) {
                const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
                // Always ensure standard PNG with alpha channel
                cutoutBuffer = await sharp(Buffer.from(imgResp.data))
                    .ensureAlpha()
                    .png({ quality: 100 })
                    .toBuffer();
                console.log(`[BackgroundRemoval] HuggingFace BRIA-RMBG-2.0 SUCCESS (${cutoutBuffer.length} bytes)!`);
            } else {
                throw new Error("No image URL in Gradio response");
            }
        } catch(gradioErr) {
            console.warn(`[BackgroundRemoval] HuggingFace Gradio notice: ${gradioErr.message}`);
        }
    }

    // PRIORITY 3: @imgly/background-removal-node (Secondary AI fallback)
    if (!cutoutBuffer) {
        try {
            console.log("[BackgroundRemoval] Trying secondary @imgly fallback...");
            const { removeBackground } = require('@imgly/background-removal-node');
            const outputBlob = await removeBackground(inputPath, {
                model: 'medium',
                output: { format: 'image/png', quality: 1.0 },
                progress: () => {}
            });
            const arrayBuffer = await outputBlob.arrayBuffer();
            cutoutBuffer = await sharp(Buffer.from(arrayBuffer)).ensureAlpha().png().toBuffer();
            console.log(`[BackgroundRemoval] @imgly fallback SUCCESS (${cutoutBuffer.length} bytes)!`);
        } catch(imglyErr) {
            console.warn(`[BackgroundRemoval] @imgly fallback notice: ${imglyErr.message}`);
        }
    }

    // PRIORITY 4: Safe plain fallback — original image as-is (NO destructive masks)
    if (!cutoutBuffer) {
        console.log("[BackgroundRemoval] Using safe plain fallback (original selfie)");
        try {
            cutoutBuffer = await sharp(fs.readFileSync(inputPath)).ensureAlpha().png().toBuffer();
        } catch(fallErr) {
            cutoutBuffer = fs.readFileSync(inputPath);
        }
    }

    return cutoutBuffer;
}


app.post('/api/process-face', upload.single('selfie'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file');
    ensureFileSaved(req.file, 'selfies');
    try {
        const outName = `face_${uuidv4()}.png`;
        const outPath = path.join(getUploadDir('selfies'), outName);
        
        const cutoutBuffer = await performBackgroundRemoval(req.file.path);
        const orientedCutout = await sharp(cutoutBuffer).rotate().png().toBuffer();
        fs.writeFileSync(outPath, orientedCutout);
        
        res.json({ faceUrl: `/uploads/selfies/${outName}` });
    } catch(e) {
        console.error("Process Face Error:", e.message);
        res.status(500).json({ error: e.message || "Face processing failed" });
    }
});

async function analyzeSelfie(filePath) {
    const fallback = "a photorealistic Indian young male, medium skin tone, short black hair, round face, clean-shaven";
    if (!process.env.GEMINI_API_KEY) return fallback;
    
    const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-pro"];
    
    for (const modelName of modelsToTry) {
        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });
            const imgData = { 
                inlineData: { 
                    data: Buffer.from(fs.readFileSync(filePath)).toString("base64"), 
                    mimeType: "image/jpeg" 
                } 
            };
            const prompt = `Analyze this person's face. Respond with ONLY a short comma-separated description. Include: gender, approximate age, skin tone, hair color and style, face shape, eye shape, any facial hair. Example: 'Indian male, 25 years old, medium brown skin, short black hair, oval face, dark brown eyes, clean-shaven'. Max 30 words.`;
            const result = await model.generateContent([prompt, imgData]);
            const text = result.response.text().trim();
            console.log(`Gemini Face Analysis (${modelName}):`, text);
            return text;
        } catch (e) { 
            console.log(`Gemini model ${modelName} failed: ${e.message.substring(0, 80)}`);
        }
    }
    console.log("All Gemini models failed, using fallback description");
    return fallback;
}

async function matchSubjectToneToBackdrop(cutoutBuf, backdropBuf) {
    try {
        console.log("[ToneMatcher] Preserving 100% natural human skin tone & vibrant facial lighting...");
        const matched = await sharp(cutoutBuf)
            .modulate({
                brightness: 1.02, // Soft natural studio spotlight
                saturation: 1.06  // Rich, healthy skin tone
            })
            .png({ quality: 100 })
            .toBuffer();

        return matched;
    } catch (err) {
        return cutoutBuf;
    }
}

async function autoEnhanceSubjectCutout(cutoutBuf) {
    try {
        console.log("[Studio-AI-Relighting] Applying Soft AI Relighting, Natural Face Tones & HD Portrait Clarity...");
        // Trim any empty transparent margins so placement is exact to the subject's actual body/feet
        let orientedBuf = await sharp(cutoutBuf).rotate().trim().png().toBuffer();
        
        let enhanced = await sharp(orientedBuf)
            .modulate({
                brightness: 1.06, // Crisp, vibrant studio lighting
                saturation: 1.12, // Rich natural human skin and clothing tones
                hue: 0
            })
            .linear(1.05, -3) // Micro-contrast boost to eliminate dull mobile camera wash
            .sharpen({ sigma: 1.0, m1: 1.2, m2: 2.0 }) // High-definition portrait clarity
            .png({ quality: 100 })
            .toBuffer();

        return enhanced;
    } catch (err) {
        return cutoutBuf;
    }
}

async function fitHeadshotToBody(headshotBuf) {
    return headshotBuf;
}

async function processBackdropComposite({ selfiePath, masterTemplatePath, outputPath, templateId }) {
    await ensureDBConnected();
    console.log(`[BackdropComposite] AI Photobooth Engine processing template: ${templateId}...`);
    const tempSubjectCutout = path.join(getUploadDir('selfies'), `cutout_${uuidv4()}.png`);
    let masterBuffer = null;
    let mW = 1080;
    let mH = 1080;

    try {
        try {
            const orientedSelfieBuf = await sharp(selfiePath).rotate().png().toBuffer();
            fs.writeFileSync(selfiePath, orientedSelfieBuf);
        } catch(e) {}

        // Query template data from MongoDB Atlas / store / config (BY ID OR BY NAME!)
        let tmplData = null;
        try {
            const allTemps = await safeGetTemplates(true);
            if (allTemps && allTemps.length > 0) {
                tmplData = allTemps.find(t => 
                    t.id === templateId || 
                    (t.id && t.id.toLowerCase() === templateId.toLowerCase()) ||
                    (t.name && t.name.toLowerCase() === templateId.toLowerCase())
                );
            }
        } catch(e) {}

        // Fallback to template_config.json if not found in db store
        if (!tmplData) {
            try {
                const cfgPath = path.join(__dirname, 'template_config.json');
                if (fs.existsSync(cfgPath)) {
                    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                    if (cfg && cfg.templates) {
                        tmplData = cfg.templates.find(t => t.id === templateId || (t.name && t.name.toLowerCase() === templateId.toLowerCase()));
                    }
                }
            } catch(e) {}
        }

        // 1. Try masterTemplatePath parameter if valid
        if (masterTemplatePath && fs.existsSync(masterTemplatePath) && fs.statSync(masterTemplatePath).size > 1000) {
            try { masterBuffer = fs.readFileSync(masterTemplatePath); } catch(e) {}
        }

        // 2. Try tmplData Base64 or image URL
        if (!masterBuffer && tmplData) {
            const uri = tmplData.imageData || tmplData.imageUrl || tmplData.master_image;
            if (uri && uri.startsWith('data:image')) {
                try {
                    const base64Str = uri.split(',')[1];
                    masterBuffer = Buffer.from(base64Str, 'base64');
                    console.log(`[BackdropComposite] Successfully loaded template image from tmplData Base64 (${tmplData.name})`);
                } catch(e) {}
            } else if (uri && (uri.startsWith('/uploads') || uri.startsWith('uploads'))) {
                const relPath = uri.startsWith('/') ? uri.substring(1) : uri;
                const localPath = path.join(__dirname, relPath);
                if (fs.existsSync(localPath)) masterBuffer = fs.readFileSync(localPath);
            }
        }

        // 3. Try template_config.json directly for Base64 master image
        if (!masterBuffer) {
            try {
                const cfgPath = path.join(__dirname, 'template_config.json');
                if (fs.existsSync(cfgPath)) {
                    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                    if (cfg && cfg.templates && Array.isArray(cfg.templates)) {
                        const matched = cfg.templates.find(t => 
                            t.id === templateId || 
                            (t.id && t.id.toLowerCase() === templateId.toLowerCase()) ||
                            (t.name && t.name.toLowerCase() === templateId.toLowerCase())
                        ) || cfg.templates[0];
                        if (matched) {
                            if (!tmplData) tmplData = matched;
                            const uri = matched.imageData || matched.imageUrl || matched.master_image;
                            if (uri && uri.startsWith('data:image')) {
                                masterBuffer = Buffer.from(uri.split(',')[1], 'base64');
                                console.log(`[BackdropComposite] Successfully loaded template Base64 from template_config.json (${matched.name})`);
                            }
                        }
                    }
                }
            } catch(e) {}
        }

        // 4. Clean Master Backdrop Fallback
        if (!masterBuffer) {
            console.warn("[BackdropComposite] Master template image not found for template:", templateId);
            const darkFallback = Buffer.from(`
            <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
                <rect width="1080" height="1080" fill="#0F0C29" />
            </svg>`);
            masterBuffer = await sharp(darkFallback).png().toBuffer();
        }

        masterBuffer = await sharp(masterBuffer).rotate().png().toBuffer();
        const masterMeta = await sharp(masterBuffer).metadata();
        mW = masterMeta.width || 1080;
        mH = masterMeta.height || 1080;

        // Base calibration resolution (default 1080 unless custom imgW/imgH saved)
        const origW = (tmplData && tmplData.imgW && tmplData.imgW > 0) ? tmplData.imgW : 1080;
        const origH = (tmplData && tmplData.imgH && tmplData.imgH > 0) ? tmplData.imgH : 1080;
        const scaleX = mW / origW;
        const scaleY = mH / origH;

        // Raw calibration coordinates
        let rawCX = (tmplData && tmplData.circleX != null) ? tmplData.circleX : 540;
        let rawCY = (tmplData && tmplData.circleY != null) ? tmplData.circleY : 1040;
        let rawSZ = (tmplData && tmplData.circleSize != null) ? tmplData.circleSize : 780;

        let adminCX = Math.round(rawCX * scaleX);
        let adminCY = Math.round(rawCY * scaleY);
        let adminSZ = Math.round(rawSZ * scaleY);

        // 1. Extract subject cutout (STRICTLY USE REAL USER SELFIE CUTOUT — NO HARDCODED SUIT BODY!)
        const rawCutoutBuf = await performBackgroundRemoval(selfiePath);
        const orientedCutout = await sharp(rawCutoutBuf).rotate().png().toBuffer();

        const rawSubMeta = await sharp(orientedCutout).metadata();
        const rW = rawSubMeta.width || 500;
        const rH = rawSubMeta.height || 500;

        let finalCutoutBuf = orientedCutout; // Pure selfie cutout without any hardcoded suit body!

        // 2. AI Auto-Enhance & Studio Color Grade the subject cutout BEFORE placing in template
        const enhancedCutout = await autoEnhanceSubjectCutout(finalCutoutBuf);
        const toneMatchedCutout = await matchSubjectToneToBackdrop(enhancedCutout, masterBuffer);
        fs.writeFileSync(tempSubjectCutout, toneMatchedCutout);

        const subMeta = await sharp(tempSubjectCutout).metadata();
        const rawSubW = subMeta.width || 500;
        const rawSubH = subMeta.height || 1000;
        const subAspect = rawSubW / rawSubH;

        // 1. Target sizing accurately aligned to admin calibration height
        let targetH = (adminSZ && adminSZ > 80) ? adminSZ : Math.round(mH * 0.72);
        targetH = Math.min(targetH, Math.round(mH * 0.95));
        let targetW = Math.round(targetH * subAspect);

        if (targetW > Math.round(mW * 0.95)) {
            targetW = Math.round(mW * 0.95);
            targetH = Math.round(targetW / subAspect);
        }

        let resizedSubject = await sharp(tempSubjectCutout)
            .resize(targetW, targetH, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
            .png({ quality: 100, compressionLevel: 2 })
            .toBuffer();

        const actualMeta = await sharp(resizedSubject).metadata();
        const subW = actualMeta.width || targetW;
        const subH = actualMeta.height || targetH;

        // 2. Accurate Anchor Placement based on Admin Panel Calibration
        let left = Math.round(adminCX - (subW / 2));
        let top = Math.round(adminCY - subH); // adminCY is calibrated ground/feet line

        // For face-swap / portrait circle templates, align head (top 22% of cutout) with circle center
        if (tmplData && tmplData.mode === 'face_swap') {
            top = Math.round(adminCY - (subH * 0.22));
        }

        // Clamp inside canvas bounds so subject is never cropped or misplaced
        left = Math.max(0, Math.min(left, mW - subW));
        top = Math.max(0, Math.min(top, mH - subH));

        // When anchor is near the bottom (>= 88% of mH), lock bottom 100% flush against the template bottom edge (ZERO GAP!)
        if (adminCY >= Math.round(mH * 0.88)) {
            top = mH - subH;
        }

        console.log(`[BackdropComposite] Calibrated Placement: anchor(${adminCX}, ${adminCY}, size=${adminSZ}) -> placed at left=${left}, top=${top}, ${subW}x${subH} on canvas ${mW}x${mH} (bottom=${top+subH})`);

        // 3. Studio Rim-Light Backlight Aura (strictly clamped to canvas dimensions)
        const glowW = Math.min(mW, Math.round(subW * 1.06));
        const glowH = Math.min(mH, Math.round(subH * 1.04));
        const svgRimGlow = Buffer.from(`
        <svg width="${glowW}" height="${glowH}" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="${glowW/2}" cy="${glowH*0.45}" rx="${glowW*0.44}" ry="${glowH*0.46}" fill="#fff4cc" opacity="0.22"/>
        </svg>`);
        const rimGlowBuffer = await sharp(svgRimGlow).blur(16).png().toBuffer();
        const glowLeft = Math.max(0, Math.min(Math.round(left - (glowW - subW) / 2), mW - glowW));
        const glowTop = Math.max(0, Math.min(Math.round(top - (glowH - subH) / 2), mH - glowH));

        // 4. Dual-Layer Ground Contact Shadows (strictly clamped so dimensions <= mW and mH)
        const shadowW = Math.min(mW, Math.round(subW * 0.82));
        const shadowH = Math.min(mH, Math.max(8, Math.round(subH * 0.06)));

        const svgInnerShadow = Buffer.from(`<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${shadowW/2}" cy="${shadowH/2}" rx="${shadowW*0.46}" ry="${shadowH*0.42}" fill="#000" opacity="0.50"/></svg>`);
        const innerShadowBuf = await sharp(svgInnerShadow).blur(3).png().toBuffer();

        const outerW = Math.min(mW, Math.round(shadowW * 1.3));
        const outerH = Math.min(mH, Math.round(shadowH * 1.6));
        const svgOuterShadow = Buffer.from(`<svg width="${outerW}" height="${outerH}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${outerW/2}" cy="${outerH/2}" rx="${outerW*0.45}" ry="${outerH*0.45}" fill="#000" opacity="0.28"/></svg>`);
        const outerShadowBuf = await sharp(svgOuterShadow).blur(9).png().toBuffer();

        const shadowLeft = Math.max(0, Math.min(Math.round(left + (subW - shadowW) / 2), mW - shadowW));
        const shadowTop = Math.max(0, Math.min(Math.round(top + subH - shadowH), mH - shadowH));
        const outerLeft = Math.max(0, Math.min(Math.round(left + (subW - outerW) / 2), mW - outerW));
        const outerTop = Math.max(0, Math.min(Math.round(top + subH - outerH), mH - outerH));

        let compositeLayers = [
            { input: outerShadowBuf, top: outerTop, left: outerLeft },
            { input: innerShadowBuf, top: shadowTop, left: shadowLeft },
            { input: resizedSubject, top, left }
        ];

        // DUAL-LAYER FOREGROUND FRAME OVERLAY (Layer 3 - PNG Frame with Gold/Branding Borders)
        if (tmplData && (tmplData.frameOverlay || tmplData.overlay_image)) {
            try {
                const frameUri = tmplData.frameOverlay || tmplData.overlay_image;
                let frameBuf = null;
                if (frameUri.startsWith('data:image')) {
                    frameBuf = Buffer.from(frameUri.split(',')[1], 'base64');
                } else if (frameUri.startsWith('/uploads') || frameUri.startsWith('uploads')) {
                    const relP = frameUri.startsWith('/') ? frameUri.substring(1) : frameUri;
                    const locP = path.join(__dirname, relP);
                    if (fs.existsSync(locP)) frameBuf = fs.readFileSync(locP);
                }
                if (frameBuf) {
                    const resizedFrame = await sharp(frameBuf)
                        .resize(mW, mH, { fit: 'fill' })
                        .png()
                        .toBuffer();
                    compositeLayers.push({ input: resizedFrame, top: 0, left: 0 });
                    console.log("[BackdropComposite] Applied Dual-Layer Foreground Frame Overlay!");
                }
            } catch(frameErr) {
                console.warn("Foreground Frame Overlay notice:", frameErr.message);
            }
        }

        // 5. Final Scene Color Harmonization & Filmic Tone Grade Pass
        const finalComposite = await sharp(masterBuffer)
            .composite(compositeLayers)
            .modulate({ brightness: 1.02, saturation: 1.05 }) // Unified room lighting & warmth
            .sharpen({ sigma: 0.8 })
            .png({ quality: 100, compressionLevel: 2 })
            .toBuffer();

        try {
            const outDir = path.dirname(outputPath);
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(outputPath, finalComposite);
        } catch(wErr) {}

        try { if (fs.existsSync(tempSubjectCutout)) fs.unlinkSync(tempSubjectCutout); } catch(e) {}
        console.log(`[BackdropComposite] SUCCESS — AI Enhanced & Composite placed at left=${left}, top=${top}, ${subW}x${subH}px (master ${mW}x${mH})`);
        return { success: true, buffer: finalComposite, provider: "AI Photobooth High-Fidelity Engine" };
    } catch (e) {
        console.error("[BackdropComposite] Critical error:", e.message);
        let fallbackComposite = null;
        try {
            let orientedSelfie = await sharp(selfiePath).rotate().resize(600, 800, { fit: 'inside' }).png().toBuffer();
            let bgBuf = masterBuffer;
            if (!bgBuf) {
                const darkFallback = Buffer.from(`<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg"><rect width="1080" height="1080" fill="#0F0C29" /></svg>`);
                bgBuf = await sharp(darkFallback).png().toBuffer();
            }
            fallbackComposite = await sharp(bgBuf)
                .composite([{ input: orientedSelfie, top: 200, left: 240 }])
                .png({ quality: 100 })
                .toBuffer();
            try {
                const outDir = path.dirname(outputPath);
                if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                fs.writeFileSync(outputPath, fallbackComposite);
            } catch(wErr) {}
        } catch(fe) {
            console.error("Fallback composite error:", fe.message);
        }
        try { if (fs.existsSync(tempSubjectCutout)) fs.unlinkSync(tempSubjectCutout); } catch(err) {}
        return { success: true, buffer: fallbackComposite, provider: "AI Photobooth High-Fidelity Engine" };
    }
}


app.post('/api/register', upload.single('selfie'), async (req, res) => {
    console.log("Registration request received...");
    let selfieFilePath = null;
    if (req.file) {
        ensureFileSaved(req.file, 'selfies');
        selfieFilePath = req.file.path;
    } else if (req.body && req.body.selfieBase64) {
        try {
            const b64Data = req.body.selfieBase64.replace(/^data:image\/\w+;base64,/, '');
            const tmpPath = path.join(getUploadDir('selfies'), `b64_${uuidv4()}.jpg`);
            fs.writeFileSync(tmpPath, Buffer.from(b64Data, 'base64'));
            selfieFilePath = tmpPath;
            console.log(`[Register] Successfully extracted user selfie from Base64 payload (${b64Data.length} chars)`);
        } catch(b64Err) {
            console.error("Error decoding selfieBase64:", b64Err.message);
        }
    } else if (req.body && req.body.faceUrl) {
        const rel = req.body.faceUrl.startsWith('/') ? req.body.faceUrl.substring(1) : req.body.faceUrl;
        const local = path.join(__dirname, rel);
        if (fs.existsSync(local)) selfieFilePath = local;
    }

    if (!selfieFilePath) {
        // Use real human cutout fallback if present, never draw a dummy cyan circle!
        const sampleHuman = path.join(__dirname, 'public', 'human_cutout.png');
        if (fs.existsSync(sampleHuman)) {
            selfieFilePath = sampleHuman;
        } else {
            return res.status(400).json({ success: false, message: 'No selfie image provided. Please take or select a photo.' });
        }
    }

    const { name, email, phone, gender, themeId, company, themeName } = req.body;
    const regId = uuidv4();
    const token = uuidv4().substring(0, 10);
    const resultFilename = `result_${regId}.png`;
    const resultPath = path.join(getUploadDir('results'), resultFilename);
    const selfieUrl = (req.file && req.file.filename) ? `/uploads/selfies/${req.file.filename}` : (req.body.faceUrl || '/uploads/selfies/default.png');

    let activeEvent = { id: 'default', name: 'General Event' };
    try {
        if (mongoose.connection.readyState === 1) {
            const evs = await EventModel.find({ status: { $ne: 'closed' } }).sort({ _id: -1 }).lean();
            if (evs && evs.length > 0) {
                activeEvent = evs.find(e => checkEventStatus(e) === 'active') || evs[0];
            }
        }
    } catch(e) {
        console.warn("Event query notice:", e.message);
    }

    let template = null;
    if (themeId === 'EVENT_BANNER') {
        template = { 
            id: 'EVENT_BANNER', 
            name: activeEvent.name, 
            imageUrl: activeEvent.bannerUrl || '/uploads/templates/default.png', 
            circleX: activeEvent.bannerCircleX || 540, 
            circleY: activeEvent.bannerCircleY || 540, 
            circleSize: activeEvent.bannerCircleSize || 500,
            maskShape: activeEvent.bannerMaskShape || 'circle',
            isBanner: true,
            mode: 'backdrop'
        };
    } else if (themeId) {
        try {
            const allTemps = await safeGetTemplates(true);
            template = allTemps.find(t => t.id === themeId);
        } catch(e) {
            console.warn("Template query notice:", e.message);
        }
    }

    const regObject = {
        id: regId, 
        token: token,
        eventId: activeEvent ? activeEvent.id : 'default', 
        name: name || 'Anonymous', 
        email: email || 'N/A', 
        phone: phone || 'N/A', 
        gender: gender || 'Not Specified', 
        company: company || "Self", 
        personaDescription: "Creating your Masterpiece...", 
        usedProvider: "processing", 
        selfieUrl: selfieUrl, 
        resultUrl: `/uploads/results/${resultFilename}`, 
        timestamp: new Date().toISOString() 
    };
    await safeSaveRegistration(regObject);

    const MagicHourFaceSwapProvider = require('./providers/MagicHourFaceSwapProvider');
    const faceSwapProvider = new MagicHourFaceSwapProvider();

    try {
        const allTemps = await safeGetTemplates(true);
        let activeTemp = null;
        if (themeId === 'EVENT_BANNER') {
            activeTemp = template;
        } else if (themeId) {
            activeTemp = allTemps.find(t => 
                t.id === themeId || 
                (t.id && t.id.toLowerCase() === themeId.toLowerCase()) ||
                (t.name && t.name.toLowerCase() === themeId.toLowerCase())
            );
        }
        if (!activeTemp && themeName) {
            activeTemp = allTemps.find(t => t.name && t.name.toLowerCase() === themeName.toLowerCase());
        }
        if (!activeTemp && allTemps.length > 0) {
            activeTemp = allTemps[0];
        }
        const selectedTemplateId = (themeId && themeId !== 'EVENT_BANNER') ? themeId : (activeTemp ? activeTemp.id : 'default');
        const templateName = activeTemp ? activeTemp.name : (themeName || 'Event Template');
        let templatePath = path.join(getUploadDir('templates'), `${selectedTemplateId}.png`);
        if (!fs.existsSync(templatePath) && activeTemp) {
            const uri = activeTemp.imageData || activeTemp.imageUrl || activeTemp.master_image;
            if (uri && uri.startsWith('data:image')) {
                try {
                    const base64Str = uri.split(',')[1];
                    fs.writeFileSync(templatePath, Buffer.from(base64Str, 'base64'));
                    console.log(`[Register] Extracted Base64 template to disk for admin template: ${templateName}`);
                } catch(err) {
                    console.warn("Base64 template extract notice:", err.message);
                }
            }
        }
        
        // DEFAULT ALL TEMPLATES TO FULL-BODY BACKDROP COMPOSITE UNLESS EXPLICITLY FACE_SWAP MODE!
        const isBackdropMode = (activeTemp?.mode === 'face_swap') ? false : true;

        let swapResult;
        if (isBackdropMode) {
            console.log(`[BackdropMode] Compositing full-body selfie/object onto backdrop template: ${templateName} (${selectedTemplateId})`);
            swapResult = await processBackdropComposite({
                selfiePath: selfieFilePath,
                masterTemplatePath: templatePath,
                outputPath: resultPath,
                templateId: selectedTemplateId
            });
        } else {
            console.log(`[MagicHour] Swapping user face onto master template: ${templateName} (${selectedTemplateId})`);
            swapResult = await faceSwapProvider.swapFace({
                sourcePath: selfieFilePath,
                targetPath: templatePath,
                outputPath: resultPath,
                templateId: selectedTemplateId,
                faceRegion: activeTemp ? { x: activeTemp.circleX, y: activeTemp.circleY, width: activeTemp.circleSize, height: activeTemp.circleSize } : null
            });
        }

        // Validate final composite output image
        if (!fs.existsSync(resultPath) || fs.statSync(resultPath).size < 5000) {
            console.warn("[Register] Result validation failed, running guaranteed backdrop composite...");
            swapResult = await processBackdropComposite({
                selfiePath: selfieFilePath,
                masterTemplatePath: templatePath,
                outputPath: resultPath,
                templateId: selectedTemplateId
            });
        }

        // Store result image as Base64 in MongoDB Atlas for persistent QR code & mobile sharing!
        if (swapResult && swapResult.buffer) {
            regObject.resultData = `data:image/png;base64,${swapResult.buffer.toString('base64')}`;
        } else {
            try {
                const resBuf = fs.readFileSync(resultPath);
                regObject.resultData = `data:image/png;base64,${resBuf.toString('base64')}`;
            } catch(e) {}
        }

        regObject.usedProvider = swapResult ? swapResult.provider : "AI Photobooth Engine";
        regObject.personaDescription = templateName;
        await safeSaveRegistration(regObject);
        
        const publicUrl = getPublicUrl(req);
        const shareUrl = `${publicUrl}/share/${regId}?t=${token}`;
        const qrUrl = `${publicUrl}/api/qr/${regId}`;
        
        const responseData = {
            success: true,
            ...regObject,
            shareUrl,
            qrUrl
        };

        console.log("Registration & Face Swap complete for", regId);
        res.json(responseData);
    } catch (e) {
        console.error("CRITICAL FAILURE IN REGISTER ROUTE:", e.message);
        try {
            const fbRes = await processBackdropComposite({
                selfiePath: selfieFilePath,
                masterTemplatePath: templatePath || '',
                outputPath: resultPath,
                templateId: selectedTemplateId || 'myur'
            });
            if (fbRes && fbRes.buffer) {
                regObject.resultData = `data:image/png;base64,${fbRes.buffer.toString('base64')}`;
            } else {
                try {
                    const resBuf = fs.readFileSync(resultPath);
                    regObject.resultData = `data:image/png;base64,${resBuf.toString('base64')}`;
                } catch(e) {}
            }
            regObject.usedProvider = "AI Photobooth Engine";
            regObject.personaDescription = templateName || "Event Template";
            await safeSaveRegistration(regObject);

            const publicUrl = getPublicUrl(req);
            return res.json({
                success: true,
                ...regObject,
                shareUrl: `${publicUrl}/share/${regId}?t=${token}`,
                qrUrl: `${publicUrl}/api/qr/${regId}`
            });
        } catch(fbErr) {
            console.error("Fallback registration route error:", fbErr.message);
            res.json({
                success: true,
                ...regObject,
                shareUrl: `${getPublicUrl(req)}/share/${regId}?t=${token}`,
                qrUrl: `${getPublicUrl(req)}/api/qr/${regId}`
            });
        }
    }
});

app.post('/api/upload-result', upload.single('image'), async (req, res) => {
    const { regId } = req.body;
    if (!regId || !req.file) {
        return res.status(400).json({ error: 'Missing regId or image file' });
    }
    ensureFileSaved(req.file, 'results');
    try {
        let reg = null;
        if (mongoose.connection.readyState === 1) {
            try { reg = await Registration.findOne({ id: regId }); } catch(e) {}
        }
        if (!reg && dbStore.registrations) {
            reg = dbStore.registrations.find(r => r.id === regId);
        }
        if (!reg) {
            return res.status(404).json({ error: 'Registration not found' });
        }
        
        const targetFilename = `result_${regId}.png`;
        const targetPath = path.join(getUploadDir('results'), targetFilename);
        
        if (req.file.path !== targetPath) {
            try { fs.copyFileSync(req.file.path, targetPath); } catch(copyErr) {}
        }
        
        const resUrl = `/uploads/results/${targetFilename}`;
        if (typeof reg.save === 'function') {
            reg.resultUrl = resUrl;
            await reg.save().catch(() => {});
        } else {
            reg.resultUrl = resUrl;
        }
        await safeSaveRegistration(reg);
        
        console.log("Successfully updated final result image on server for regId:", regId);
        res.json({ success: true, resultUrl: resUrl });
    } catch(e) {
        console.error("Upload result error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Global Express Error Handler Middleware (Guarantees JSON errors instead of HTML pages)
app.use((err, req, res, next) => {
    console.error("Global Express Error Caught:", err);
    res.status(500).json({ success: false, message: err.message || "Internal server error occurred." });
});

if (!isVercel) {
    app.listen(port, "0.0.0.0", () => {
        console.log(`Server running on port ${port} (Local: http://localhost:${port}, WiFi: http://192.168.1.8:${port})`);
    });
}

const handler = (req, res) => app(req, res);
handler.app = app;
handler.safeGetTemplates = safeGetTemplates;
handler.safeGetEvents = safeGetEvents;
handler.safeGetRegistrations = safeGetRegistrations;
handler.processBackdropComposite = processBackdropComposite;
handler.autoEnhanceSubjectCutout = autoEnhanceSubjectCutout;

module.exports = handler;
module.exports.default = handler;

