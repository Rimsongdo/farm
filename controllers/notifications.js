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
const NPK_MIN_THRESHOLD = 0; // Seuil minimum pour npk (pluie)
const NPK_MAX_THRESHOLD = 1; // Seuil maximum pour npk (pluie)

// Fonction pour envoyer une notification via FCM
const sendNotification = async (user, device, title, body) => {
  const message = {
    notification: { title, body },
    token: user.Token, // Token FCM de l'appareil
  };

  try {
    // Sauvegarder la notification dans la base de données
    user.notifications.push({
      message: body,
      deviceId: device._id, // Sauvegarder l'ID de l'appareil pour référence
      deviceName: device.name, // Sauvegarder le nom de l'appareil pour référence
      date: new Date(),
      isRead: false, // Marquer comme non lu par défaut
    });
    await user.save();

    // Envoyer la notification via FCM
    const response = await admin.messaging().send(message);
    console.log('Notification envoyée avec succès:', response);
    return response;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification:', error.message);
  }
};

// Fonction pour traiter les alertes
const processAlert = async (user, device, field, value, minThreshold, maxThreshold, label) => {
  const alertFieldLow = `${field}Low`;
  const alertFieldHigh = `${field}High`;

  // Traitement spécifique pour npk (pluie)
  if (field === 'npk') {
    const previousNpk = device.previousNpk !== undefined ? device.previousNpk : null;

    // Vérifier si l'état de la pluie a changé
    if (value !== previousNpk) {
      const rainStatus = value === 1 ? 'déclenchée' : 'arrêtée';
      await sendNotification(
        user,
        device,
        `Pluie ${rainStatus} sur ${device.name}`,
        `La pluie vient de se ${rainStatus} sur l'appareil ${device.name}.`
      );

      // Mettre à jour l'état précédent
      device.previousNpk = value;
      await device.save();
    }
    return; // Sortir de la fonction après avoir traité npk
  }

  // Traitement normal pour les autres champs
  if (value < minThreshold && !user.alerts[alertFieldLow]) {
    user.alerts[alertFieldLow] = true;
    user.alerts[alertFieldHigh] = false;
    await user.save();
    await sendNotification(
      user,
      device,
      `${label} basse sur ${device.name}`,
      `${label} est tombée à ${value} sur l'appareil ${device.name}.`
    );
  } else if (value > maxThreshold && !user.alerts[alertFieldHigh]) {
    user.alerts[alertFieldHigh] = true;
    user.alerts[alertFieldLow] = false;
    await user.save();
    await sendNotification(
      user,
      device,
      `${label} élevée sur ${device.name}`,
      `${label} a atteint ${value} sur l'appareil ${device.name}.`
    );
  } else if (value >= minThreshold && value <= maxThreshold) {
    user.alerts[alertFieldLow] = false;
    user.alerts[alertFieldHigh] = false;
    await user.save();
  }
};

// Fonction pour récupérer les données et envoyer des notifications
const fetchAndNotify = async () => {
  try {
    // Récupérer tous les utilisateurs
    const users = await User.find().populate('devices'); // Récupérer les appareils associés

    if (!users || users.length === 0) {
      console.log('Aucun utilisateur trouvé.');
      return;
    }

    for (let user of users) {
      // Vérifier si l'utilisateur a des appareils
      if (!user.devices || user.devices.length === 0) {
        console.log(`Aucun appareil trouvé pour l'utilisateur ${user._id}`);
        continue;
      }

      for (let device of user.devices) {
        const { thingSpeakChannelId, thingSpeakApiKey } = device;

        // Vérifier les informations manquantes
        if (!thingSpeakChannelId || !thingSpeakApiKey || !user.Token) {
          console.log(`Informations manquantes pour l'appareil ${device._id} de l'utilisateur ${user._id}`);
          continue;
        }

        // Récupérer les données depuis ThingSpeak
        const results = 10;
        const response = await axios.get(`https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json`, {
          params: { api_key: thingSpeakApiKey, results },
        });

        const feeds = response.data.feeds;
        if (feeds.length === 0) {
          console.log('Aucune donnée disponible pour l\'appareil', device._id);
          continue;
        }

        // Extraire la dernière donnée
        const latestData = feeds[results - 1];
        const data = {
          temperature: parseFloat(latestData.field1),
          humidity: parseFloat(latestData.field2),
          moisture: parseFloat(latestData.field3),
          npk: parseFloat(latestData.field4),
        };

        // Vérifier la validité des données
        if (Object.values(data).some(isNaN)) {
          console.log('Données invalides pour l\'appareil', device._id);
          continue;
        }

        console.log(`Appareil: ${device.name}, Température: ${data.temperature}°C, Humidité: ${data.humidity}%, Humidité du sol: ${data.moisture}%, NPK: ${data.npk}`);

        // Traitement des alertes
        await processAlert(user, device, 'temperature', data.temperature, TEMPERATURE_MIN_THRESHOLD, TEMPERATURE_MAX_THRESHOLD, 'Température');
        await processAlert(user, device, 'humidity', data.humidity, HUMIDITY_MIN_THRESHOLD, HUMIDITY_MAX_THRESHOLD, 'Humidité air');
        await processAlert(user, device, 'moisture', data.moisture, MOISTURE_MIN_THRESHOLD, MOISTURE_MAX_THRESHOLD, 'Humidité du sol');
        await processAlert(user, device, 'npk', data.npk, NPK_MIN_THRESHOLD, NPK_MAX_THRESHOLD, 'NPK');
      }
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des données ou de l\'envoi de la notification :', error.message);
  }
};

// Exécution périodique de la vérification des données et des notifications
cron.schedule('* * * * *', () => {
  console.log('Exécution périodique de la vérification des données et des notifications...');
  fetchAndNotify();
});

// Route pour récupérer les données manuellement
notifs.post('/fetchData', async (req, res) => {
  try {
    const { userId, deviceId } = req.body;

    // Valider les entrées
    if (!userId || !deviceId) {
      return res.status(400).json({
        message: 'User ID and Device ID are required.',
      });
    }

    // Vérifier si l'utilisateur existe
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Vérifier si l'appareil existe et appartient à l'utilisateur
    const device = await Device.findOne({ _id: deviceId, userId: user._id });
    if (!device) {
      return res.status(404).json({ message: "Appareil introuvable ou n'appartient pas à l'utilisateur" });
    }

    // Récupérer les données depuis ThingSpeak
    const results = 10; // Nombre de résultats à récupérer
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${device.thingSpeakChannelId}/feeds.json`,
      { params: { api_key: device.thingSpeakApiKey, results } }
    );

    // Répondre avec les données récupérées
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Erreur lors de la récupération des données :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

// Route pour récupérer les notifications non lues
notifs.post('/getNotifications', async (req, res) => {
  try {
    const { userId } = req.body;

    // Vérifier si l'utilisateur existe
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

// Route pour récupérer une prédiction
notifs.post('/fetchPrediction', async (req, res) => {
  try {
    const { userId, deviceId } = req.body;

    // Valider les entrées
    if (!userId || !deviceId) {
      return res.status(400).json({
        message: 'User ID and Device ID are required.',
      });
    }

    // Vérifier si l'utilisateur existe
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Vérifier si l'appareil existe et appartient à l'utilisateur
    const device = await Device.findOne({ _id: deviceId, userId: user._id });
    if (!device) {
      return res.status(404).json({ message: "Appareil introuvable ou n'appartient pas à l'utilisateur" });
    }

    // Récupérer les données depuis ThingSpeak
    const results = 1; // Récupérer uniquement la dernière donnée
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${device.thingSpeakChannelId}/feeds.json`,
      { params: { api_key: device.thingSpeakApiKey, results } }
    );

    const jsonData = response.data.feeds[0];
    if (!jsonData) {
      return res.status(404).json({ message: 'No data available for prediction.' });
    }

    // Préparer les données pour la prédiction
    const predictionData = {
      soil_humidity_2: parseFloat(jsonData.field3),
      air_temperature: parseFloat(jsonData.field2),
      air_humidity: parseFloat(jsonData.field2),
    };

    // Valider les données de prédiction
    if (Object.values(predictionData).some(isNaN)) {
      return res.status(400).json({ message: 'Invalid data for prediction.' });
    }

    // Envoyer les données au service d'IA
    const prediction = await axios.post('https://farmpred-mt5y.onrender.com/predict', predictionData);

    // Valider la réponse de l'IA
    if (!prediction.data || !prediction.data.prediction) {
      return res.status(500).json({ message: 'Invalid response from AI service.' });
    }

    // Retourner la prédiction
    res.status(200).json(prediction.data);
  } catch (error) {
    console.error('Error fetching prediction:', error.message);
    res.status(500).json({ message: 'Error fetching prediction.' });
  }
});

module.exports = notifs;
