const express = require('express');
const mongoose = require('mongoose');
const config = require('./utils/config');
const cors = require('cors');
const userServices=require('./controllers/userLogin');
const notifServices = require('./controllers/notifications');
const app = express();

mongoose.connect(config.MONGODB_URL)
  .then(() => console.log('Connecté à MongoDB'))
  .catch((error) => console.error('Erreur de connexion à MongoDB:', error));

app.use(cors());
app.use(express.json());
app.use('/api/userServices',userServices)
app.use('/',notifServices)

module.exports = app 
