const axios = require('axios');
const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const User = require('../models/user'); // Modèle utilisateur
require('dotenv').config();
const cron = require('node-cron'); // Import de node-cron

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
var id;
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

// Fonction pour récupérer les données de ThingSpeak et envoyer des notifications
const fetchAndNotify = async () => {
  try {
    // Paramètres (remplacer par les valeurs appropriées ou les récupérer dynamiquement)
    
    const userId = id; // Remplacer par l'ID de l'utilisateur
    const user = await User.findById(userId);
    const thingSpeakChannelId = user.thingSpeakChannelId; // Remplacer par l'ID du canal ThingSpeak
    const thingSpeakApiKey = user.thingSpeakApiKey; // Remplacer par la clé API
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
      console.log('Aucune donnée disponible.');
      return;
    }

    // Dernière température mesurée
    const latestData = feeds[results - 1];
    const temperature = parseFloat(latestData.field1);
    const humidity = parseFloat(latestData.field2);
    const moisture = parseFloat(latestData.field3);
    const npk = parseFloat(latestData.field4);

    if (isNaN(temperature)) {
      console.log('La donnée de température est invalide.');
      return;
    }

    console.log(`Température mesurée : ${temperature}°C`);

    // Récupération de l'utilisateur
    
    const fcmToken = user.Token;
    if (!user) {
      console.log('Utilisateur non trouvé.');
      return;
    }

    let shouldSendNotification = false;

    // Vérification des seuils et état précédent
    if (temperature < TEMPERATURE_MIN_THRESHOLD) {
      if (!user.alerts.temperatureLow) {
        shouldSendNotification = true;
        user.alerts.temperatureLow = true; // Marquer comme envoyé
        user.alerts.temperatureHigh = false; // Réinitialiser l'alerte de température élevée
      }
    } else if (temperature > TEMPERATURE_MAX_THRESHOLD) {
      if (!user.alerts.temperatureHigh) {
        shouldSendNotification = true;
        user.alerts.temperatureHigh = true; // Marquer comme envoyé
        user.alerts.temperatureLow = false; // Réinitialiser l'alerte de température basse
      }
    } else {
      // Si la température est de retour dans la plage normale, envoyer une notification si nécessaire
      if (user.alerts.temperatureLow || user.alerts.temperatureHigh) {
        user.alerts.temperatureLow = false; // Réinitialiser l'alerte de température basse
        user.alerts.temperatureHigh = false; // Réinitialiser l'alerte de température élevée
      }
    }

    // Sauvegarde des modifications dans la base de données
    await user.save();

    // Envoi de la notification si nécessaire
    if (shouldSendNotification) {
      let alertType;
      if (temperature < TEMPERATURE_MIN_THRESHOLD) {
        alertType = { 
          title: 'Température basse', 
          body: `La température est tombée à ${temperature}°C.` 
        };
      } else if (temperature > TEMPERATURE_MAX_THRESHOLD) {
        alertType = { 
          title: 'Température élevée', 
          body: `La température a atteint ${temperature}°C.` 
        };
      }

      await sendNotification(fcmToken, alertType.title, alertType.body);
    }

  } catch (error) {
    console.error('Erreur lors de la récupération des données ou de l\'envoi de la notification :', error.message);
  }
};


cron.schedule('* * * * *', () => {
  console.log('Exécution périodique de la vérification des données et des notifications...');
  fetchAndNotify();
});

// Route pour récupérer les données et vérifier les seuils (non affectée par cron)
notifs.post('/fetchData', async (req, res) => {
  try {
    const { thingSpeakChannelId, thingSpeakApiKey, userId } = req.body;
    id=userId;
    // Vérification des champs obligatoires
    if (!thingSpeakChannelId || !thingSpeakApiKey || !userId) {
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

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Erreur lors de la récupération des données :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

module.exports = notifs;
