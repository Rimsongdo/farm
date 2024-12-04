const axios = require('axios');
const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const User = require('../models/user'); // Modèle utilisateur
require('dotenv').config();

const notifs = express.Router();

// Middleware pour analyser les requêtes JSON
notifs.use(bodyParser.json());

// Configuration Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Seuils prédéfinis
const TEMPERATURE_MIN_THRESHOLD = 15; // Seuil minimum
const TEMPERATURE_MAX_THRESHOLD = 35; // Seuil maximum

// Fonction pour envoyer une notification via FCM
const sendNotification = async (token, title, body) => {
  const message = {
    notification: { title, body },
    token, // Token FCM de l'appareil
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Notification envoyée avec succès:', response);
    return response;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification:', error.message);
    // Enregistrer l'erreur pour une analyse ultérieure, si nécessaire
  }
};

// Route pour récupérer les données et vérifier les seuils
notifs.post('/fetchData', async (req, res) => {
  try {
    const { thingSpeakChannelId, thingSpeakApiKey, fcmToken, userId } = req.body;

    // Vérification des champs obligatoires
    if (!thingSpeakChannelId || !thingSpeakApiKey || !fcmToken || !userId) {
      return res.status(400).json({
        message: 'Channel ID, API Key, Token FCM, et ID utilisateur sont requis.',
      });
    }

    // Appel API ThingSpeak pour récupérer les données
    const results = 10; // Nombre de résultats
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
      {
        params: { api_key: thingSpeakApiKey, results },
      }
    );

    const feeds = response.data.feeds;
    if (feeds.length === 0) {
      return res.status(404).json({ message: 'Aucune donnée disponible.' });
    }

    // Dernière température mesurée
    const latestData = feeds[0];
    const temperature = parseFloat(latestData.field1);

    if (isNaN(temperature)) {
      return res.status(400).json({ message: 'La donnée de température est invalide.' });
    }

    console.log(`Température mesurée : ${temperature}°C`);

    // Récupération de l'utilisateur
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

    // Sauvegarde des modifications dans la base de données
    await user.save();

    // Envoi de la notification si nécessaire
    if (shouldSendNotification) {
      const alertType =
        temperature < TEMPERATURE_MIN_THRESHOLD
          ? { title: 'Température basse', body: `La température est tombée à ${temperature}°C.` }
          : { title: 'Température élevée', body: `La température a atteint ${temperature}°C.` };

      await sendNotification(fcmToken, alertType.title, alertType.body);
    }

    // Retour des données au frontend
    res.status(200).json(response.data)
  } catch (error) {
    console.error('Erreur lors de la récupération des données :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

module.exports = notifs;
