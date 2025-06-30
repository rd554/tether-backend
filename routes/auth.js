const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.create({
        email: payload.email,
        firstName: payload.given_name,
        lastName: payload.family_name,
        avatar: payload.picture,
        onboarded: false,
        role: 'PM',
      });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(401).json({ error: 'Invalid Google token', details: err.message });
  }
});

module.exports = router; 