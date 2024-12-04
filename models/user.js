const mongoose = require('mongoose');


const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  serialNumber: {
    type: String,
    required: false,
    unique: true,
    trim: true,
  },
  thingSpeakChannelId: {
    type: String,
    required: false,
  },
  thingSpeakApiKey: {
    type: String,
    required: false, 
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  Token:{
    required:false,
    type:String,
  }
},{
  collection: 'Farmers' // Nom de la collection personnalisée
});



module.exports = mongoose.model('User', userSchema);
