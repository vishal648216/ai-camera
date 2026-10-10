const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/ai_persona_app')
  .then(async () => {
    const Config = mongoose.model('Config', new mongoose.Schema({}, { strict: false }));
    const conf = await Config.findOne({ id: 'main' });
    console.log("Config from DB:");
    console.log(JSON.stringify(conf, null, 2));

    const Template = mongoose.model('Template', new mongoose.Schema({}, { strict: false }));
    const temps = await Template.find();
    console.log("Templates Count:", temps.length);
    if(temps.length > 0) console.log(temps[0].name);

    const Reg = mongoose.model('Registration', new mongoose.Schema({}, { strict: false }));
    const regs = await Reg.find();
    console.log("Leads Count:", regs.length);

    process.exit(0);
  })
  .catch(console.error);
