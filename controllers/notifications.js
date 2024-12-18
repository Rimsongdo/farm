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
    // Récupération de tous les utilisateurs
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

      // Envoi de notifications en fonction des seuils
      if (temperature < TEMPERATURE_MIN_THRESHOLD && !user.alerts.temperatureLow) {
        user.alerts.temperatureLow = true;
        await user.save();
        await sendNotification(Token, 'Température basse', `La température est tombée à ${temperature}°C.`);
      } else if (temperature > TEMPERATURE_MAX_THRESHOLD && !user.alerts.temperatureHigh) {
        user.alerts.temperatureHigh = true;
        await user.save();
        await sendNotification(Token, 'Température élevée', `La température a atteint ${temperature}°C.`);
      } else if (temperature >= TEMPERATURE_MIN_THRESHOLD && temperature <= TEMPERATURE_MAX_THRESHOLD) {
        user.alerts.temperatureLow = false;
        user.alerts.temperatureHigh = false;
        await user.save();
      }

      if (humidity < HUMIDITY_MIN_THRESHOLD && !user.alerts.humidityLow) {
        user.alerts.humidityLow = true;
        await user.save();
        await sendNotification(Token, 'Humidité air basse', `L'humidité air est tombée à ${humidity}%.`);
      } else if (humidity > HUMIDITY_MAX_THRESHOLD && !user.alerts.humidityHigh) {
        user.alerts.humidityHigh = true;
        await user.save();
        await sendNotification(Token, 'Humidité air élevée', `L'humidité air a atteint ${humidity}%.`);
      } else if (humidity >= HUMIDITY_MIN_THRESHOLD && humidity <= HUMIDITY_MAX_THRESHOLD) {
        user.alerts.humidityLow = false;
        user.alerts.humidityHigh = false;
        await user.save();
      }

      if (moisture < MOISTURE_MIN_THRESHOLD && !user.alerts.moistureLow) {
        user.alerts.moistureLow = true;
        await user.save();
        await sendNotification(Token, 'Humidité du sol basse', `L'humidité du sol est tombée à ${moisture}%.`);
      } else if (moisture > MOISTURE_MAX_THRESHOLD && !user.alerts.moistureHigh) {
        user.alerts.moistureHigh = true;
        await user.save();
        await sendNotification(Token, 'Humidité du sol élevée', `L'humidité du sol a atteint ${moisture}%.`);
      } else if (moisture >= MOISTURE_MIN_THRESHOLD && moisture <= MOISTURE_MAX_THRESHOLD) {
        user.alerts.moistureLow = false;
        user.alerts.moistureHigh = false;
        await user.save();
      }

      if (npk < NPK_MIN_THRESHOLD && !user.alerts.npkLow) {
        user.alerts.npkLow = true;
        await user.save();
        await sendNotification(Token, 'NPK faible', `Les niveaux de NPK sont tombés à ${npk}.`);
      } else if (npk > NPK_MAX_THRESHOLD && !user.alerts.npkHigh) {
        user.alerts.npkHigh = true;
        await user.save();
        await sendNotification(Token, 'NPK élevé', `Les niveaux de NPK ont atteint ${npk}.`);
      } else if (npk >= NPK_MIN_THRESHOLD && npk <= NPK_MAX_THRESHOLD) {
        user.alerts.npkLow = false;
        user.alerts.npkHigh = false;
        await user.save();
      }
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

    // Récupération des données depuis ThingSpeak
    const results = 1; // Nombre de résultats à récupérer
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`,
      { params: { api_key: thingSpeakApiKey, results } }
    );

    const jsonData = response.data.feeds[0];

    // Vérification si les données existent dans jsonData
    const headersOrder = ["field3", "field1", "field2"];
    if (!headersOrder.every(field => field in jsonData)) {
      return res.status(400).json({ message: 'Certaines données sont manquantes dans la réponse de ThingSpeak.' });
    }

    // Créer la première ligne avec les entêtes dans l'ordre souhaité
    const headerLine = headersOrder.join(",");

    // Créer la ligne suivante avec les valeurs dans le même ordre que headersOrder
    const valuesLine = headersOrder.map(header => jsonData[header]).join(",");

    // Combiner les entêtes et les valeurs pour former le CSV final
    const csv = `${valuesLine}`;

    // Log des données CSV avant l'envoi
    console.log("CSV envoyé:", csv);

    // Envoi du CSV au service de prédiction
    const predictions = await axios.post(
      'https://k0yahuavu4.execute-api.us-east-1.amazonaws.com/stage_1/predire', 
      csv, 
      {
        headers: {
          'Content-Type': 'text/csv',  // Indiquer que le contenu est du CSV
        }
      }
    );

    // Log de la réponse du service de prédiction
    console.log("Réponse du service de prédiction:", predictions.data);

    // Retourner les prédictions du service
    res.status(200).send(predictions.data);
  } catch (error) {
    // Log des erreurs pour débogage
    console.error('Erreur lors de la récupération des données :', error.message);

    // Affichage de la réponse d'erreur si disponible
    if (error.response) {
      console.error('Réponse d\'erreur du serveur:', error.response.data);
    }

    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});



module.exports = notifs;
