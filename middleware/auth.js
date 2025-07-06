// Placeholder for authentication middleware. Clerk logic removed.

// Add your own authentication logic here if needed. 

module.exports = function (req, res, next) {
  console.log('Auth middleware running. Header:', req.headers.authorization);
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer testuser-')) {
    // Extract username from token
    const username = authHeader.replace('Bearer testuser-', '');
    req.user = { email: `${username}@test.com`, firstName: username, role: 'PM' };
    return next();
  }
  // If not a test user, block access (or add other auth logic here)
  return res.status(401).json({ error: 'Unauthorized' });
}; 