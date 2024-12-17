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
const fetchAndNotify = async () => {
  try {
    // Récupération de tous les utilisateurs
    const users = await User.find();

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

      // Appel API ThingSpeak pour récupérer les données
      const results = 10; // Nombre de résultats
      const response = await axios.get(
        `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
        { params: { api_key: thingSpeakApiKey, results } }
      );

      const feeds = response.data.feeds;
      if (feeds.length === 0) {
        console.log('Aucune donnée disponible pour l\'utilisateur', user._id);
        continue;
      }

      // Dernière mesure pour chaque donnée
      const latestData = feeds[results - 1];
      const temperature = parseFloat(latestData.field1);
      const humidity = parseFloat(latestData.field2);
      const moisture = parseFloat(latestData.field3);
      const npk = parseFloat(latestData.field4);

      if (isNaN(temperature) || isNaN(humidity) || isNaN(moisture) || isNaN(npk)) {
        console.log('Données invalides pour l\'utilisateur', user._id);
        continue;
      }

      console.log(`Température: ${temperature}°C, Humidité: ${humidity}%, Humidité du sol: ${moisture}%, NPK: ${npk}`);

      const now = new Date();
      

// Fonction pour formater la date en jj/mm/aa
      function formatDate(date) {
        const day = String(date.getDate()).padStart(2, '0'); // Ajoute un 0 si le jour est inférieur à 10
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Mois commence à 0, donc ajouter 1
        const year = String(date.getFullYear()).slice(2); // Récupère les 2 derniers chiffres de l'année

        return `${day}/${month}/${year}`;
      }

      // Fonction pour formater l'heure en hh:mm
      function formatTime(date) {
        const hours = String(date.getHours()).padStart(2, '0'); // Ajoute un 0 si l'heure est inférieure à 10
        const minutes = String(date.getMinutes()).padStart(2, '0'); // Ajoute un 0 si les minutes sont inférieures à 10

        return `${hours}:${minutes}`;
      }

// Combine la date et l'heure dans une seule variable
    const formattedDate = `${formatDate(now)} ${formatTime(now)}`;



      // Vérifications et envoi des notifications
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
          // Envoyer la notification via FCM
          await sendNotification(Token, 'Alerte Critique', alert.message);

          // Sauvegarder la notification dans la base de données
          user.notifications.push({
            message: alert.message,
            date: formattedDate,
            isRead: false,
          });

          // Mettre à jour l'état des alertes
          user.alerts[alert.key] = true;
        } else if (!alert.condition && user.alerts[alert.key]) {
          user.alerts[alert.key] = false; // Réinitialiser l'état de l'alerte
        }
      }

      // Sauvegarder les modifications de l'utilisateur
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

notifs.post('/getPrediction',async (req,res)=>{
  try{
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

    const results = 1; // Nombre de résultats
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
      { params: { api_key: thingSpeakApiKey, results } }
    );
    const laData=response.feeds[0];
    const headersOrder = ["field3", "field1", "field2"];
    const headerLine = headersOrder.join(",");

    // Créer la ligne suivante avec les valeurs dans le même ordre que headersOrder
    const valuesLine = headersOrder.map(header => laData[header]).join(",");

    // Combiner les entêtes et les valeurs pour former le CSV final
    const csv = `${headerLine}\n${valuesLine}`;
    const donnee=laData.field3
    res.json(donnee)

  }
  catch(e){
    res.json(e);
  }
  
})

module.exports = notifs;
