// Placeholder for authentication middleware. Clerk logic removed.

// Add your own authentication logic here if needed.

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(req, res, next) {
  console.log('--- verifyGoogleToken middleware START ---');
  const authHeader = req.headers['authorization'];
  console.log('Authorization header:', authHeader);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('No token provided or malformed header');
    console.log('--- verifyGoogleToken middleware END (no token) ---');
    return res.status(401).json({ message: 'No token provided or malformed header', debug: { authHeader } });
  }
  const token = authHeader.split(' ')[1];

  // Allow test users: token format 'testuser-<username>'
  if (token.startsWith('testuser-')) {
    const username = token.replace('testuser-', '');
    if (['test1', 'test2', 'test3'].includes(username)) {
      req.user = {
        email: `${username}@test.com`,
        username,
        role: 'PM', // Always PM
        firstName: 'Test',
        lastName: username,
      };
      console.log('Test user authenticated:', req.user);
      return next();
    } else {
      return res.status(401).json({ message: 'Invalid test user token' });
    }
  }

  try {
    console.log('Verifying Google ID token...');
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    console.log('Token verified. Payload:', payload);
    req.user = payload;
    console.log('Calling next() in verifyGoogleToken');
    next();
    console.log('--- verifyGoogleToken middleware END (success) ---');
  } catch (err) {
    console.error('Token verification failed:', err.message, { token, audience: process.env.GOOGLE_CLIENT_ID });
    console.log('--- verifyGoogleToken middleware END (verification failed) ---');
    return res.status(401).json({ message: 'Invalid or expired token', error: err.message, debug: { token, audience: process.env.GOOGLE_CLIENT_ID } });
  }
}

module.exports = { verifyGoogleToken }; 