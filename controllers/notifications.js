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
const HUMIDITY_MIN_THRESHOLD = 30; // Seuil minimum
const HUMIDITY_MAX_THRESHOLD = 80; // Seuil maximum
const MOISTURE_MIN_THRESHOLD = 20; // Seuil minimum
const MOISTURE_MAX_THRESHOLD = 80; // Seuil maximum
const NPK_MIN_THRESHOLD = 5; // Seuil minimum
const NPK_MAX_THRESHOLD = 10; // Seuil maximum

// Fonction pour formater la date et l'heure
const formatDateTime = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Les mois commencent à 0
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

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
  }
};

// Fonction pour récupérer les données de ThingSpeak et envoyer des notifications
const fetchAndNotify = async () => {
  try {
    const users = await User.find(); // Trouver tous les utilisateurs dans la base de données

    if (!users || users.length === 0) {
      console.log('Aucun utilisateur trouvé.');
      return;
    }

    for (let user of users) {
      const { thingSpeakChannelId, thingSpeakApiKey, Token } = user;

      if (!thingSpeakChannelId || !thingSpeakApiKey || !Token) {
        console.log(`Informations manquantes pour l'utilisateur ${user._id}`);
        continue; // Passer à l'utilisateur suivant si des informations manquent
      }

      const results = 10; // Nombre de résultats
      const response = await axios.get(
        `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
        {
          params: { api_key: thingSpeakApiKey, results },
        }
      );

      const feeds = response.data.feeds;
      if (feeds.length === 0) {
        console.log('Aucune donnée disponible pour l\'utilisateur', user._id);
        continue;
      }

      const latestData = feeds[results - 1];
      const temperature = parseFloat(latestData.field1);
      const humidity = parseFloat(latestData.field2);
      const moisture = parseFloat(latestData.field3);
      const npk = parseFloat(latestData.field4);

      if (isNaN(temperature) || isNaN(humidity) || isNaN(moisture) || isNaN(npk)) {
        console.log('Données invalides pour l\'utilisateur', user._id);
        continue;
      }

      const alerts = [
        { key: 'temperatureLow', condition: temperature < TEMPERATURE_MIN_THRESHOLD, message: `La température est trop basse (${temperature}°C).` },
        { key: 'temperatureHigh', condition: temperature > TEMPERATURE_MAX_THRESHOLD, message: `La température est trop élevée (${temperature}°C).` },
        { key: 'humidityLow', condition: humidity < HUMIDITY_MIN_THRESHOLD, message: `L'humidité est trop basse (${humidity}%).` },
        { key: 'humidityHigh', condition: humidity > HUMIDITY_MAX_THRESHOLD, message: `L'humidité est trop élevée (${humidity}%).` },
        { key: 'moistureLow', condition: moisture < MOISTURE_MIN_THRESHOLD, message: `L'humidité du sol est trop basse (${moisture}%).` },
        { key: 'moistureHigh', condition: moisture > MOISTURE_MAX_THRESHOLD, message: `L'humidité du sol est trop élevée (${moisture}%).` },
        { key: 'npkLow', condition: npk < NPK_MIN_THRESHOLD, message: `Les niveaux de NPK sont trop bas (${npk}).` },
        { key: 'npkHigh', condition: npk > NPK_MAX_THRESHOLD, message: `Les niveaux de NPK sont trop élevés (${npk}).` },
      ];

      for (const alert of alerts) {
        if (alert.condition && !user.alerts[alert.key]) {
          const formattedDateTime = formatDateTime();

          await sendNotification(Token, 'Alerte Critique', alert.message);

          user.notifications.push({
            message: alert.message,
            date: formattedDateTime, // Date avec heure
            isRead: false,
          });

          user.alerts[alert.key] = true;
        } else if (!alert.condition && user.alerts[alert.key]) {
          user.alerts[alert.key] = false;
        }
      }

      await user.save();
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des données ou de l\'envoi de la notification :', error.message);
  }
};

// Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs
cron.schedule('* * * * *', () => {
  console.log('Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs...');
  fetchAndNotify();
});

module.exports = notifs;