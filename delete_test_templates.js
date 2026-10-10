const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
require('dotenv').config();

const atlasUri = 'mongodb+srv://aipersona:aipersona@cluster0.g4wl0mi.mongodb.net/aipersona?retryWrites=true&w=majority&appName=Cluster0';

async function clean() {
    await mongoose.connect(process.env.MONGODB_URI || atlasUri);
    console.log("Connected to Mongo");

    const templateSchema = new mongoose.Schema({ id: String, name: String }, { strict: false });
    const Template = mongoose.model('Template', templateSchema);

    // Delete default templates (template_inspire_manak and template_vip_event) from MongoDB Atlas
    const delRes = await Template.deleteMany({ id: { $in: ['template_inspire_manak', 'template_vip_event', 'template_default', 'myur', 'myur - 2', 'new parish'] } });
    console.log("Deleted default and test templates from MongoDB Atlas:", delRes.deletedCount);

    // Clean dbStore.json as well
    const dbStorePath = path.join(__dirname, 'uploads', 'data', 'db_store.json');
    if (fs.existsSync(dbStorePath)) {
        try {
            const dbStore = JSON.parse(fs.readFileSync(dbStorePath, 'utf8'));
            if (dbStore.templates) {
                dbStore.templates = dbStore.templates.filter(t => !['template_inspire_manak', 'template_vip_event', 'template_default', 'myur', 'myur - 2', 'new parish'].includes(t.id));
                fs.writeFileSync(dbStorePath, JSON.stringify(dbStore, null, 2));
                console.log("Cleaned dbStore.json templates!");
            }
        } catch(e) {
            console.warn("dbStore notice:", e.message);
        }
    }

    process.exit(0);
}

clean();
