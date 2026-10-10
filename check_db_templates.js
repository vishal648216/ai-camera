const mongoose = require('mongoose');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
require('dotenv').config();

const atlasUri = 'mongodb+srv://aipersona:aipersona@cluster0.g4wl0mi.mongodb.net/aipersona?retryWrites=true&w=majority&appName=Cluster0';

async function check() {
    await mongoose.connect(process.env.MONGODB_URI || atlasUri);
    const templateSchema = new mongoose.Schema({ id: String, name: String }, { strict: false });
    const Template = mongoose.model('Template', templateSchema);

    const list = await Template.find().lean();
    console.log("Templates Count:", list.length);
    list.forEach(t => {
        console.log({
            id: t.id,
            name: t.name,
            mode: t.mode,
            circleX: t.circleX,
            circleY: t.circleY,
            circleSize: t.circleSize,
            hasImageData: Boolean(t.imageData),
            imageDataLen: t.imageData ? t.imageData.length : 0,
            hasImageUrl: Boolean(t.imageUrl),
            imageUrl: t.imageUrl ? t.imageUrl.substring(0, 40) : null
        });
    });

    process.exit(0);
}

check();
