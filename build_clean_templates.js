const fs = require('fs');
const path = require('path');

async function buildCleanTemplates() {
    console.log("Cleaning default templates config...");
    const configPath = path.join(__dirname, 'template_config.json');
    fs.writeFileSync(configPath, JSON.stringify({ templates: [] }, null, 2));

    const dbStorePath = path.join(__dirname, 'uploads', 'data', 'db_store.json');
    if (fs.existsSync(dbStorePath)) {
        try {
            const dbData = JSON.parse(fs.readFileSync(dbStorePath, 'utf8'));
            dbData.templates = [];
            fs.writeFileSync(dbStorePath, JSON.stringify(dbData, null, 2));
        } catch(e) {}
    }
    console.log("Cleaned all default templates!");
}

buildCleanTemplates().catch(console.error);
