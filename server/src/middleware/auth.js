const jwt = require('jsonwebtoken');

// Generate a secure secret for JWT (in production, use an environment variable)
const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');

/**
 * Generate a JWT token for an admin user
 * @param {Object} admin - Admin object
 * @returns {string} - JWT token
 */
function generateToken(admin) {
  return jwt.sign(
    { 
      id: admin._id.toString(), 
      email: admin.email 
    },
    JWT_SECRET,
    { expiresIn: '7d' } // Token valid for 7 days
  );
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded token or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware to require authentication
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware to optionally check authentication (doesn't block if not authenticated)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  JWT_SECRET
};
