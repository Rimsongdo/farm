const User = require('../models/user'); // Import du modèle User
const axios = require('axios'); // Pour appeler l'API de ThingSpeak
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // Pour générer des tokens JWT
const express=require('express') // Pour hasher le mot de passe
const userLogin = express.Router();
const tools = require('../utils/config');

// Fonction pour créer un utilisateur
const getTokenFrom = (request) => {
  const authorization = request.get('authorization');
  if (authorization && authorization.startsWith('Bearer ')) {
      return authorization.replace('Bearer ', '');
  }
  return null;
};


userLogin.post('/register',async (req, res) => {
  const { name, email, password} = req.body;

  try {
    // Vérifie si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email déjà utilisé.' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();

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



// Fonction pour la connexion
userLogin.post('/login', async (req, res) => {
  const { email, password, fcmToken } = req.body; // Récupère le token FCM du client

  try {
    // Vérifie si l'utilisateur existe
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Vérifie si le mot de passe est correct
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    // Mette à jour le token FCM de l'utilisateur
    if (fcmToken) {
      user.Token = fcmToken; // Enregistre le token FCM
      await user.save(); // Sauvegarde les modifications
    }

    // Génère un token JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      tools.SECRET, 
      { expiresIn: '1d' } // Expiration du token (1 jour ici)
    );

    res.status(200).json({
      message: 'Connexion réussie.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        thingSpeakChannelId: user.thingSpeakChannelId,
        thingSpeakApiKey: user.thingSpeakApiKey,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la connexion.' });
  }
});


userLogin.post('/fetchData',async (req,res)=>{
  try{
    const thingSpeak=req.body;
    const thingSpeakChannelId=thingSpeak.thingSpeakChannelId;
    const thingSpeakApiKey=thingSpeak.thingSpeakApiKey;
    const results=10;
    const response = await axios.get(
      `https://api.thingspeak.com/channels/${thingSpeakChannelId}/feeds.json?api_key=${thingSpeakApiKey}&results=${results}`,
      
    );
    res.status(200).json(response.data);
    
  }
  catch(error){
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la récupération des données.' });
  }
})

userLogin.post('/addDevice', async (req, res) => {
  try {
    // Récupérer les données de la requête
    const { serialNumber, userId, channelId, writeApiKey } = req.body;

    // Rechercher l'utilisateur par son ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    // Mettre à jour l'utilisateur avec les nouvelles informations
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        thingSpeakChannelId: channelId,
        thingSpeakApiKey: writeApiKey,
        serialNumber: serialNumber,
      },
      { new: true } // Pour retourner le document mis à jour
    );

    // Vérifier si la mise à jour a réussi
    if (!updatedUser) {
      return res.status(400).json({ message: "La mise à jour a échoué" });
    }

    // Répondre avec l'utilisateur mis à jour
    return res.status(200).json({ message: "Utilisateur mis à jour avec succès", user: updatedUser });

  } catch (e) {
    // Gérer les erreurs
    console.error(e);
    return res.status(500).json({ message: "Erreur du serveur", error: e.message });
  }
});



module.exports=userLogin; 