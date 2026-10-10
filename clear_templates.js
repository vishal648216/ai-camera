const mongoose = require('mongoose');
const atlasUri = 'mongodb+srv://aipersona:aipersona@cluster0.g4wl0mi.mongodb.net/aipersona?retryWrites=true&w=majority&appName=Cluster0';

const templateSchema = new mongoose.Schema({ id: String }, { strict: false });
const Template = mongoose.model('Template', templateSchema);

async function clear() {
  await mongoose.connect(atlasUri);
  console.log("Connected to MongoDB Atlas");
  const res = await Template.deleteMany({});
  console.log("SUCCESS: Deleted all templates from MongoDB Atlas:", res);
  await mongoose.disconnect();
}

clear().catch(console.error);
