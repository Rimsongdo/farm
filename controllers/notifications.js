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
const sendNotification = async (user, device, title, body) => {
  const message = {
    notification: { title, body },
    token: user.Token, // Token FCM de l'appareil
  };

  try {
    // Save the notification to the database
    user.notifications.push({
      message: body,
      deviceId: device._id, // Save the device ID for reference
      deviceName: device.name, // Save the device name for reference
      date: new Date(),
      isRead: false, // Mark as unread by default
    });
    await user.save();

    // Send the notification via FCM
    const response = await admin.messaging().send(message);
    console.log('Notification envoyée avec succès:', response);
    return response;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification:', error.message);
  }
};

const fetchAndNotify = async () => {
  try {
    // Récupérer tous les utilisateurs
    const users = await User.find().populate('devices'); // Populate devices

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
          params: { api_key: thingSpeakApiKey, results }
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
          npk: parseFloat(latestData.field4)
        };

        // Vérifier la validité des données
        if (Object.values(data).some(isNaN)) {
          console.log('Données invalides pour l\'appareil', device._id);
          continue;
        }

        console.log(`Appareil: ${device.name}, Température: ${data.temperature}°C, Humidité: ${data.humidity}%, Humidité du sol: ${data.moisture}%, NPK: ${data.npk}`);

        // Traitement des alertes avec la logique d'activation/désactivation opposée
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
const processAlert = async (user, device, field, value, minThreshold, maxThreshold, label) => {
  
  const alertFieldLow = `${field}Low`;
  const alertFieldHigh = `${field}High`;

  
  if (value < minThreshold && !device.alerts[alertFieldLow]) {
    device.alerts[alertFieldLow] = true;
    device.alerts[alertFieldHigh] = false; 
    await device.save();
    
    await sendNotification(
      user,
      device,
      `${label} basse sur ${device.name}`,
      `${label} est tombée à ${value} sur l'appareil ${device.name}.`
    );
  } else if (value > maxThreshold && !device.alerts[alertFieldHigh]) {
    device.alerts[alertFieldHigh] = true;
    device.alerts[alertFieldLow] = false;  
    await device.save();
    await sendNotification(
      user,
      device,
      `${label} élevée sur ${device.name}`,
      `${label} a atteint ${value} sur l'appareil ${device.name}.`
    );
  } else if (value >= minThreshold && value <= maxThreshold) {
    
    device.alerts[alertFieldLow] = false;
    device.alerts[alertFieldHigh] = false;
    await user.save();
  }
};
// Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs
cron.schedule('* * * * *', () => {
  console.log('Exécution périodique de la vérification des données et des notifications pour tous les utilisateurs...');
  fetchAndNotify();
});

notifs.post('/fetchData', async (req, res) => {
  try {
    const { userId, deviceId } = req.body;

    // Validate input
    if (!userId || !deviceId) {
      return res.status(400).json({
        message: 'User ID and Device ID are required.',
      });
    }

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Check if the device exists and belongs to the user
    const device = await Device.findOne({ _id: deviceId, userId: user._id });
    if (!device) {
      return res.status(404).json({ message: "Appareil introuvable ou n'appartient pas à l'utilisateur" });
    }

    // Fetch data from ThingSpeak
    const results = 10; // Number of results to fetch
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${device.thingSpeakChannelId}/feeds.json`,
      { params: { api_key: device.thingSpeakApiKey, results } }
    );

    // Respond with the fetched data
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Erreur lors de la récupération des données :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
});

notifs.post('/getNotifications', async (req, res) => {
  try {
    const { userId } = req.body;

   
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    
    const unreadNotifications = user.notifications.filter(notif => !notif.isRead);

    res.status(200).json({ notifications: unreadNotifications });
  } catch (error) {
    console.error('Erreur lors de la récupération des notifications :', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des notifications.' });
  }
});

notifs.post('/fetchPrediction', async (req, res) => {
  try {
    const { userId, deviceId } = req.body;

    // Validate input
    if (!userId || !deviceId) {
      return res.status(400).json({
        message: 'User ID and Device ID are required.',
      });
    }

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Check if the device exists and belongs to the user
    const device = await Device.findOne({ _id: deviceId, userId: user._id });
    if (!device) {
      return res.status(404).json({ message: "Appareil introuvable ou n'appartient pas à l'utilisateur" });
    }

    // Fetch data from ThingSpeak
    const results = 1; // Fetch only the latest data point
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${device.thingSpeakChannelId}/feeds.json`,
      { params: { api_key: device.thingSpeakApiKey, results } }
    );

    const jsonData = response.data.feeds[0];
    if (!jsonData) {
      return res.status(404).json({ message: 'No data available for prediction.' });
    }

    // Prepare data for AI prediction
    const predictionData = {
      soil_humidity_2: parseFloat(jsonData.field3),
      air_temperature: parseFloat(jsonData.field2),
      air_humidity: parseFloat(jsonData.field2),
    };

    // Validate prediction data
    if (Object.values(predictionData).some(isNaN)) {
      return res.status(400).json({ message: 'Invalid data for prediction.' });
    }

    // Send data to AI service
    const prediction = await axios.post('https://farmpred-mt5y.onrender.com/predict', predictionData);

    // Validate AI response
    if (!prediction.data || !prediction.data.prediction) {
      return res.status(500).json({ message: 'Invalid response from AI service.' });
    }

    // Return prediction
    res.status(200).json(prediction.data);
  } catch (error) {
    console.error('Error fetching prediction:', error.message);
    res.status(500).json({ message: 'Error fetching prediction.' });
  }
});



module.exports = notifs;