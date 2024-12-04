const axios = require('axios'); // Pour appeler l'API de ThingSpeak

const express=require('express') // Pour hasher le mot de passe
const notifs = express.Router();
const app = express();
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

require('dotenv').config();

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


module.exports=notifs