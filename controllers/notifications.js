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
// Fonction pour récupérer les données de ThingSpeak et envoyer des notifications
const fetchAndNotify = async () => {
  try {
    // Récupérer tous les utilisateurs
    const users = await User.find();

    if (!users || users.length === 0) {
      console.log('Aucun utilisateur trouvé.');
      return;
    }

    for (let user of users) {
      const { thingSpeakChannelId, thingSpeakApiKey, Token } = user;

      // Vérifier les informations manquantes
      if (!thingSpeakChannelId || !thingSpeakApiKey || !Token) {
        console.log(`Informations manquantes pour l'utilisateur ${user._id}`);
        continue;
      }

      // Récupérer les données depuis ThingSpeak
      const results = 10;
      const response = await axios.get(`https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`, {
        params: { api_key: thingSpeakApiKey, results }
      });

      const feeds = response.data.feeds;
      if (feeds.length === 0) {
        console.log('Aucune donnée disponible pour l\'utilisateur', user._id);
        continue;
      }

      // Extraire la dernière donnée
      const latestData = feeds[results - 1];
      const data = {
        temperature: parseFloat(latestData.field1),
        humidity: parseFloat(latestData.field2),
        moisture: parseFloat(latestData.field3),
        npk: parseFloat(latestData.field4)
      };

      // Vérifier la validité des données
      if (Object.values(data).some(isNaN)) {
        console.log('Données invalides pour l\'utilisateur', user._id);
        continue;
      }

      console.log(`Température: ${data.temperature}°C, Humidité: ${data.humidity}%, Humidité du sol: ${data.moisture}%, NPK: ${data.npk}`);

      // Traitement des alertes avec la logique d'activation/désactivation opposée
      await processAlert(user, 'temperature', data.temperature, TEMPERATURE_MIN_THRESHOLD, TEMPERATURE_MAX_THRESHOLD, 'Température');
      await processAlert(user, 'humidity', data.humidity, HUMIDITY_MIN_THRESHOLD, HUMIDITY_MAX_THRESHOLD, 'Humidité air');
      await processAlert(user, 'moisture', data.moisture, MOISTURE_MIN_THRESHOLD, MOISTURE_MAX_THRESHOLD, 'Humidité du sol');
      await processAlert(user, 'npk', data.npk, NPK_MIN_THRESHOLD, NPK_MAX_THRESHOLD, 'NPK');
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des données ou de l\'envoi de la notification :', error.message);
  }
};

// Fonction pour traiter les alertes avec la logique de désactivation opposée
const processAlert = async (user, field, value, minThreshold, maxThreshold, label) => {
  const alertFieldLow = `${field}Low`;
  const alertFieldHigh = `${field}High`;

  // Si la valeur est en dehors du seuil, activer l'alerte correspondante et désactiver l'opposée
  if (value < minThreshold && !user.alerts[alertFieldLow]) {
    user.alerts[alertFieldLow] = true;
    user.alerts[alertFieldHigh] = false;  // Désactiver l'alerte opposée
    await user.save();
    await sendNotification(user.Token, `${label} basse`, `${label} est tombée à ${value}.`);
  } else if (value > maxThreshold && !user.alerts[alertFieldHigh]) {
    user.alerts[alertFieldHigh] = true;
    user.alerts[alertFieldLow] = false;  // Désactiver l'alerte opposée
    await user.save();
    await sendNotification(user.Token, `${label} élevée`, `${label} a atteint ${value}.`);
  } else if (value >= minThreshold && value <= maxThreshold) {
    // Si la valeur est dans la plage normale, réinitialiser les deux alertes
    user.alerts[alertFieldLow] = false;
    user.alerts[alertFieldHigh] = false;
    await user.save();
  }
};


// Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs
cron.schedule('* * * * *', () => {
  console.log('Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs...');
  fetchAndNotify();
});

// Route pour tester la récupération des données
notifs.post('/fetchData', async (req, res) => {
  try {
    const { thingSpeakChannelId, thingSpeakApiKey, userId } = req.body;

    if (!thingSpeakChannelId || !thingSpeakApiKey || !userId) {
      return res.status(400).json({
        message: 'Channel ID, API Key, et ID utilisateur sont requis.',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const results = 10; // Nombre de résultats
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
      { params: { api_key: thingSpeakApiKey, results } }
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Erreur lors de la récupération des données :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

notifs.post('/getNotifications', async (req, res) => {
  try {
    const { userId } = req.body;

    // Récupérer l'utilisateur dans la base de données
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Récupérer les notifications non lues
    const unreadNotifications = user.notifications.filter(notif => !notif.isRead);

    res.status(200).json({ notifications: unreadNotifications });
  } catch (error) {
    console.error('Erreur lors de la récupération des notifications :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des notifications.' });
  }
});

notifs.post('/fetchPrediction', async (req, res) => {
  try {
    const { thingSpeakChannelId, thingSpeakApiKey, userId } = req.body;

    // Vérification des paramètres requis
    if (!thingSpeakChannelId || !thingSpeakApiKey || !userId) {
      return res.status(400).json({
        message: 'Channel ID, API Key, et ID utilisateur sont requis.',
      });
    }

    // Recherche de l'utilisateur dans la base de données
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

   
    const nombreResult = 1; 
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
      { params: { api_key: thingSpeakApiKey, results:nombreResult } }
    );

    const jsonData = response.data.feeds[0];
    
    donnee={
      soil_humidity_2:60,
      air_temperature:40,
      air_humidity:66
    };
   
    const predictions = await axios.post(
      'https://farmpred-mt5y.onrender.com/predict', 
      {
        soil_humidity_2:50,
        air_temperature:50,
        air_humidity:50
      }
    );
    res.status(200).json(predictions);
   
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});



module.exports = notifs;
