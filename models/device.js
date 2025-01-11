const mongoose = require('mongoose');
const { Schema } = mongoose;

const deviceSchema = new mongoose.Schema({
    serialNumber: { type: String, required: true, unique: true, trim: true },
    thingSpeakChannelId: { type: String, required: true },
    thingSpeakApiKey: { type: String, required: true },
    name:{type:String, required:true}, 
    createdAt: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to the user who owns the device
  });
  
  module.exports = mongoose.model('Device', deviceSchema);