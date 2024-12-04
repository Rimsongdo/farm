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
notifs.post('/send-notification', async (req, res) => {
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


notifs.post('/fetchData', async (req, res) => {
    try {
      const { thingSpeakChannelId, thingSpeakApiKey, fcmToken, userId } = req.body;
  
      if (!thingSpeakChannelId || !thingSpeakApiKey || !fcmToken || !userId) {
        return res.status(400).json({ message: 'Channel ID, API Key, Token FCM, et ID utilisateur sont requis.' });
      }
  
      // Récupération des données ThingSpeak
      const results = 1;
      const response = await axios.get(
        `https://api.thingspeak.com/channels/${thingSpeakChannelId}/fields/1.json`,
        {
          params: { api_key: thingSpeakApiKey, results },
        }
      );
  
      const feeds = response.data.feeds;
      if (feeds.length === 0) {
        return res.status(404).json({ message: 'Aucune donnée disponible.' });
      }
  
      const latestData = feeds[0];
      const temperature = parseFloat(latestData.field1);
  
      if (isNaN(temperature)) {
        return res.status(400).json({ message: 'La donnée de température est invalide.' });
      }
  
      console.log(`Température mesurée : ${temperature}°C`);
  
      // Récupération de l'état des notifications pour cet utilisateur
      const user = await User.findById(userId);
  
      if (!user) {
        return res.status(404).json({ message: 'Utilisateur non trouvé.' });
      }
  
      let shouldSendNotification = false;
  
      // Vérification des seuils et état précédent
      if (temperature < TEMPERATURE_MIN_THRESHOLD) {
        if (!user.alerts.temperatureLow) {
          shouldSendNotification = true;
          user.alerts.temperatureLow = true; // Marquer comme envoyé
        }
      } else if (temperature > TEMPERATURE_MAX_THRESHOLD) {
        if (!user.alerts.temperatureHigh) {
          shouldSendNotification = true;
          user.alerts.temperatureHigh = true; // Marquer comme envoyé
        }
      } else {
        // Réinitialisation des alertes si la température revient à la normale
        user.alerts.temperatureLow = false;
        user.alerts.temperatureHigh = false;
      }
  
      // Sauvegarder les modifications dans la base de données
      await user.save();
  
      // Envoyer une notification si nécessaire
      if (shouldSendNotification) {
        const alertType =
          temperature < TEMPERATURE_MIN_THRESHOLD
            ? { title: 'Température basse', body: `La température est tombée à ${temperature}°C.` }
            : { title: 'Température élevée', body: `La température a atteint ${temperature}°C.` };
  
        await sendNotification(fcmToken, alertType.title, alertType.body);
      }
  
      // Retourner les données au client
      res.status(200).json({
        message: 'Données récupérées avec succès.',
        temperature,
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des données :', error.message);
      res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
    }
  });


module.exports=notifs