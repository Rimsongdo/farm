const mongoose = require('mongoose');
const { Schema } = mongoose;
const Device=require('./device')

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' }, // Reference to the device
  deviceName: { type: String }, // Name of the device
  date: { type: Date, default: Date.now }, // Timestamp
  isRead: { type: Boolean, default: false }, // Read/unread status
});




const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  createdAt: { type: Date, default: Date.now },
  Token: { type: String },
  alerts: {
    temperatureLow: { type: Boolean, default: false },
    temperatureHigh: { type: Boolean, default: false },
    humidityLow: { type: Boolean, default: false },
    humidityHigh: { type: Boolean, default: false },
    moistureLow: { type: Boolean, default: false },
    moistureHigh: { type: Boolean, default: false },
    npkLow: { type: Boolean, default: false },
    npkHigh: { type: Boolean, default: false },
  },
  notifications: [notificationSchema],
  devices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Device' }], 
}, {
  collection: 'Farmers'
});


module.exports = mongoose.model('User', userSchema);