const User = require('../models/user'); // Import du modèle User
const axios = require('axios'); // Pour appeler l'API de ThingSpeak
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // Pour générer des tokens JWT
const express=require('express') // Pour hasher le mot de passe
const userLogin = express.Router();
const tools = require('../utils/config');
const Device = require('../models/device'); // Import the Device model
const multer = require('multer');

const upload = multer({ dest: 'uploads/' }); // Save files in the 'uploads' directory 

const getTokenFrom = (request) => {
  const authorization = request.get('authorization');
  if (authorization && authorization.startsWith('Bearer ')) {
      return authorization.replace('Bearer ', '');
  }
  return null;
};


userLogin.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email déjà utilisé.' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      devices: [], // Initialize with an empty array of devices
      alerts: {
        temperatureLow: false,
        temperatureHigh: false,
        humidityLow: false,
        humidityHigh: false,
        moistureLow: false,
        moistureHigh: false,
        npkLow: false,
        npkHigh: false,
      },
      notifications: [], // Initialize with an empty array of notifications
    });

    // Save the user to the database
    await user.save();

    // Respond with success message and user details (excluding sensitive data)
    res.status(201).json({
      message: 'Utilisateur créé avec succès.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la création de l’utilisateur.' });
  }
});


userLogin.post('/login', async (req, res) => {
  const { email, password, fcmToken } = req.body; // Retrieve FCM token from the client

  try {
    // Check if the user exists
    const user = await User.findOne({ email }).populate('devices'); // Populate the devices array
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Check if the password is correct
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    // Update the user's FCM token
    if (fcmToken) {
      user.Token = fcmToken; // Save the FCM token
      await user.save(); // Save the changes
    }

    // Generate a JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      tools.SECRET,
      { expiresIn: '1d' } // Token expiration (1 day here)
    );

    // Prepare the response with user details and device information
    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      devices: user.devices.map(device => ({
        id: device._id,
        name: device.name,
        type: device.type,
        thingSpeakChannelId: device.thingSpeakChannelId,
        thingSpeakApiKey: device.thingSpeakApiKey,
        image: device.image,
      })),
    };

    res.status(200).json({
      message: 'Connexion réussie.',
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la connexion.' });
  }
});


userLogin.post('/fetchData', async (req, res) => {
  try {
    const { userId, deviceId } = req.body; // Get userId and deviceId from the request

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    // Check if the device exists and belongs to the user
    const device = await Device.findOne({ _id: deviceId, userId: user._id });
    if (!device) {
      return res.status(404).json({ message: "Appareil introuvable ou n'appartient pas à l'utilisateur" });
    }

    // Fetch data from ThingSpeak
    const results = 10; // Number of results to fetch
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${device.thingSpeakChannelId}/feeds.json?api_key=${device.thingSpeakApiKey}&results=${results}`
    );

    // Respond with the fetched data
    res.status(200).json(response.data);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.', error: error.message });
  }
});
userLogin.post('/addDevice', async (req, res) => {
  try {
    // Retrieve data from the request
    const { serialNumber, userId, channelId, readApiKey,name } = req.body;

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    // Check if a device with the same serialNumber already exists
    const existingDevice = await Device.findOne({ serialNumber });
    if (existingDevice) {
      return res.status(400).json({ message: "Un appareil avec ce numéro de série existe déjà" });
    }

    // Create a new device
    const newDevice = new Device({
      serialNumber,
      thingSpeakChannelId: channelId,
      thingSpeakApiKey: readApiKey,
      userId: user._id,
      name:name // Associate the device with the user
    });

    // Save the new device to the database
    await newDevice.save();

    // Add the device to the user's devices array
    user.devices.push(newDevice._id);
    await user.save();

    // Respond with success message and the new device details
    return res.status(201).json({
      message: "Appareil ajouté avec succès",
      device: {
        id: newDevice._id,
        serialNumber: newDevice.serialNumber,
        thingSpeakChannelId: newDevice.thingSpeakChannelId,
        thingSpeakApiKey: newDevice.thingSpeakApiKey,
        name:newDevice.name
      },
    });

  } catch (error) {
    // Handle errors
    console.error(error);
    return res.status(500).json({ message: "Erreur du serveur", error: error.message });
  }
});

userLogin.post('/fetchDevices', async (req, res) => {
  const { userId } = req.body; // Get userId from the request body

  try {
    // Find the user and populate the devices array
    const user = await User.findById(userId).populate('devices');

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Extract the devices from the user object
    const devices = user.devices;

    // Respond with the list of devices
    res.status(200).json(devices);
  } catch (error) {
    console.error('Erreur lors de la récupération des appareils:', error.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des appareils.' });
  }
});

userLogin.put('/updateUser', async (req, res) => {
  const { userId, name, email, password } = req.body;

  try {
    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Update the user's name if provided
    if (name) {
      user.name = name;
    }

    // Update the user's email if provided
    if (email) {
      // Check if the new email is already in use
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== userId) {
        return res.status(400).json({ message: 'Email déjà utilisé.' });
      }
      user.email = email;
    }

    // Update the user's password if provided
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
    }

    // Save the updated user to the database
    await user.save();

    // Respond with success message and updated user details (excluding sensitive data)
    res.status(200).json({
      message: 'Utilisateur mis à jour avec succès.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de l’utilisateur.' });
  }
});



userLogin.put('/updateDevice', async (req, res) => {
  try {
    const { deviceId, name, imageUrl } = req.body;

    // Find the device by ID
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Update the device's name if provided
    if (name) {
      device.name = name;
    }

    // Update the device's image URL if provided
    if (imageUrl) {
      device.image = imageUrl;
    }

    // Save the updated device
    await device.save();

    res.status(200).json(device);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


module.exports=userLogin; 