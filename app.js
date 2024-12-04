const express = require('express');
const mongoose = require('mongoose');
const config = require('./utils/config');
const cors = require('cors');
const userServices=require('./controllers/userLogin')
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const app = express();
require('dotenv').config();

mongoose.connect(config.MONGODB_URL)
  .then(() => console.log('Connecté à MongoDB'))
  .catch((error) => console.error('Erreur de connexion à MongoDB:', error));

  
  // Initialisation de l'application Express
  
  
  // Utilisation de body-parser pour analyser le corps des requêtes
  app.use(bodyParser.json());
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
  
  // Fonction pour envoyer une notification via FCM
  const sendNotification = async (token, title, body) => {
    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: token, // Le token FCM de l'appareil
    };
  
    try {
      const response = await admin.messaging().send(message);
      console.log('Notification envoyée avec succès:', response);
      return response;
    } catch (error) {
      console.error('Erreur lors de l\'envoi de la notification:', error);
      throw error;
    }
  };
  
  // API pour envoyer des notifications
  app.post('/send-notification', async (req, res) => {
    const { token, title, body } = req.body;
  
    // Vérification des données
    if (!token || !title || !body) {
      return res.status(400).send({ error: 'Token, title et body sont nécessaires' });
    }
  
    try {
      const response = await sendNotification(token, title, body);
      res.status(200).send({ success: true, response });
    } catch (error) {
      res.status(500).send({ success: false, error: error.message });
    }
  });
  
 
  

app.use(cors());
app.use(express.json());
app.use('/api/userServices',userServices)

module.exports = app 
