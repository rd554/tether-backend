const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const Team = require('../models/Team');
const Link = require('../models/Link');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google', async (req, res) => {
  console.log('Received idToken:', req.body.idToken);
  console.log('Using GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
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

// Test user authentication route
router.post('/test', async (req, res) => {
  const { username, password } = req.body;
  const validUsers = ['test1', 'test2', 'test3'];
  const validPassword = 'test@123';

  if (validUsers.includes(username) && password === validPassword) {
    // Clean up all teams and links for this test user
    const email = `${username}@test.com`;
    const user = await User.findOne({ email });
    if (user) {
      await Team.deleteMany({ owner: user._id });
      await Link.deleteMany({ 'participants.userId': user._id });
    }
    // Return a fake user object
    return res.json({
      success: true,
      user: {
        username,
        email,
        name: `Test User ${username.slice(-1)}`,
        role: 'PM', // Always PM
      }
    });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Test user sign out route (placeholder for future extensibility)
router.post('/signout', (req, res) => {
  res.json({ success: true });
});

module.exports = router; 