const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  date: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  serialNumber: { type: String, unique: true, trim: true },
  thingSpeakChannelId: { type: String },
  thingSpeakApiKey: { type: String },
  createdAt: { type: Date, default: Date.now },
  Token: { type: String },
  alerts: {
    temperatureLow: { type: Boolean, default: false },
    temperatureHigh: { type: Boolean, default: false },
    humidityLow: { type: Boolean, default: false },
    humidityHigh: { type: Boolean, default: false },
    moistureLow: { type: Boolean, default: false },
    moistureHigh: { type: Boolean, default: false },
    npkLow: { type: Boolean, default: false },
    npkHigh: { type: Boolean, default: false },
  },
  notifications: [notificationSchema],
}, {
  collection: 'Farmers'
});

module.exports = mongoose.model('User', userSchema);
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
