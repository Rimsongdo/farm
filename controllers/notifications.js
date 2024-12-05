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

      let shouldSendNotification = false;

      // Vérifications des seuils et gestion des alertes pour chaque donnée

      // Température
      if (temperature < TEMPERATURE_MIN_THRESHOLD) {
        if (!user.alerts.temperatureLow) {
          shouldSendNotification = true;
          user.alerts.temperatureLow = true;
          user.alerts.temperatureHigh = false;
        }
      } else if (temperature > TEMPERATURE_MAX_THRESHOLD) {
        if (!user.alerts.temperatureHigh) {
          shouldSendNotification = true;
          user.alerts.temperatureHigh = true;
          user.alerts.temperatureLow = false;
        }
      } else {
        if (user.alerts.temperatureLow || user.alerts.temperatureHigh) {
          user.alerts.temperatureLow = false;
          user.alerts.temperatureHigh = false;
        }
      }

      // Humidité
      if (humidity < HUMIDITY_MIN_THRESHOLD) {
        if (!user.alerts.humidityLow) {
          shouldSendNotification = true;
          user.alerts.humidityLow = true;
          user.alerts.humidityHigh = false;
        }
      } else if (humidity > HUMIDITY_MAX_THRESHOLD) {
        if (!user.alerts.humidityHigh) {
          shouldSendNotification = true;
          user.alerts.humidityHigh = true;
          user.alerts.humidityLow = false;
        }
      } else {
        if (user.alerts.humidityLow || user.alerts.humidityHigh) {
          user.alerts.humidityLow = false;
          user.alerts.humidityHigh = false;
        }
      }

      // Humidité du sol
      if (moisture < MOISTURE_MIN_THRESHOLD) {
        if (!user.alerts.moistureLow) {
          shouldSendNotification = true;
          user.alerts.moistureLow = true;
          user.alerts.moistureHigh = false;
        }
      } else if (moisture > MOISTURE_MAX_THRESHOLD) {
        if (!user.alerts.moistureHigh) {
          shouldSendNotification = true;
          user.alerts.moistureHigh = true;
          user.alerts.moistureLow = false;
        }
      } else {
        if (user.alerts.moistureLow || user.alerts.moistureHigh) {
          user.alerts.moistureLow = false;
          user.alerts.moistureHigh = false;
        }
      }

      // NPK
      if (npk < NPK_MIN_THRESHOLD) {
        if (!user.alerts.npkLow) {
          shouldSendNotification = true;
          user.alerts.npkLow = true;
          user.alerts.npkHigh = false;
        }
      } else if (npk > NPK_MAX_THRESHOLD) {
        if (!user.alerts.npkHigh) {
          shouldSendNotification = true;
          user.alerts.npkHigh = true;
          user.alerts.npkLow = false;
        }
      } else {
        if (user.alerts.npkLow || user.alerts.npkHigh) {
          user.alerts.npkLow = false;
          user.alerts.npkHigh = false;
        }
      }

      // Sauvegarde des modifications dans la base de données
      await user.save();

      // Envoi de la notification si nécessaire
      if (shouldSendNotification) {
        let alertType;

        // Notifications en fonction des seuils pour chaque donnée
        if (temperature < TEMPERATURE_MIN_THRESHOLD) {
          alertType = {
            title: 'Température basse',
            body: `La température est tombée à ${temperature}°C.`,
          };
        } else if (temperature > TEMPERATURE_MAX_THRESHOLD) {
          alertType = {
            title: 'Température élevée',
            body: `La température a atteint ${temperature}°C.`,
          };
        } else if (humidity < HUMIDITY_MIN_THRESHOLD) {
          alertType = {
            title: 'Humidité air basse',
            body: `L'humidité air est tombée à ${humidity}%.`,
          };
        } else if (humidity > HUMIDITY_MAX_THRESHOLD) {
          alertType = {
            title: 'Humidité air élevée',
            body: `L'humidité air a atteint ${humidity}%.`,
          };
        } else if (moisture < MOISTURE_MIN_THRESHOLD) {
          alertType = {
            title: 'Humidité du sol basse',
            body: `L'humidité du sol est tombée à ${moisture}%.`,
          };
        } else if (moisture > MOISTURE_MAX_THRESHOLD) {
          alertType = {
            title: 'Humidité du sol élevée',
            body: `L'humidité du sol a atteint ${moisture}%.`,
          };
        } else if (npk < NPK_MIN_THRESHOLD) {
          alertType = {
            title: 'NPK faible',
            body: `Les niveaux de NPK sont tombés à ${npk}.`,
          };
        } else if (npk > NPK_MAX_THRESHOLD) {
          alertType = {
            title: 'NPK élevé',
            body: `Les niveaux de NPK ont atteint ${npk}.`,
          };
        }

        // Envoi de la notification
        await sendNotification(Token, alertType.title, alertType.body);
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

notifs.post('/fetchData', async (req, res) => {
  try {
    const { thingSpeakChannelId, thingSpeakApiKey, userId } = req.body;
    // Vérification des champs obligatoires
    if (!thingSpeakChannelId || !thingSpeakApiKey || !userId) {
      return res.status(400).json({
        message: 'Channel ID, API Key, Token FCM, et ID utilisateur sont requis.',
      });
    }
    // Récupération de l'utilisateur et des données
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
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
