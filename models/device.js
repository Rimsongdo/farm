const mongoose = require('mongoose');
const { Schema } = mongoose;

const deviceSchema = new mongoose.Schema({
    serialNumber: { type: String, required: true, unique: true, trim: true },
    thingSpeakChannelId: { type: String, required: true },
    thingSpeakApiKey: { type: String, required: true },
    name: { type: String, required: true }, 
    image: { type: String }, 
    alerts: {
      temperatureLow: { type: Boolean, default: false },
      temperatureHigh: { type: Boolean, default: false },
      humidityLow: { type: Boolean, default: false },
      humidityHigh: { type: Boolean, default: false },
      moistureLow: { type: Boolean, default: false },
      moistureHigh: { type: Boolean, default: false },
      pluieLow: { type: Boolean, default: false },
      pluieHigh: { type: Boolean, default: false },
    },
    createdAt: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to the user who owns the device
});

module.exports = mongoose.model('Device', deviceSchema);
