const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.NEXTAUTH_SECRET;

async function jwtAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Find or create user in DB
    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.create({
        email: payload.email,
        firstName: payload.name?.split(' ')[0] || '',
        lastName: payload.name?.split(' ')[1] || '',
        avatar: payload.picture || null,
        role: 'PM',
        onboarded: false,
      });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', details: err.message });
  }
}

module.exports = jwtAuthMiddleware; 