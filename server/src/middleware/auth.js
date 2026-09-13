const jwt = require("jsonwebtoken");

if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET not set in environment — generating a random secret. Sessions will not survive restarts. Set JWT_SECRET in your .env file.",
  );
}
const JWT_SECRET =
  process.env.JWT_SECRET || require("crypto").randomBytes(64).toString("hex");

/**
 * Generate a JWT token for an admin user
 * @param {Object} admin - Admin object
 * @returns {string} - JWT token
 */
function generateToken(admin) {
  return jwt.sign(
    {
      id: admin._id.toString(),
      email: admin.email,
    },
    JWT_SECRET,
    { expiresIn: "7d" }, // Token valid for 7 days
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

// Browser sessions and integration keys share the same operational API.
async function authenticateAccess({ token, apiKey } = {}) {
  if (apiKey !== undefined)
    return require("../services/apiKeys").authenticate(apiKey);
  if (typeof token !== "string") return null;
  if (token.startsWith("mm_"))
    return require("../services/apiKeys").authenticate(token);
  const user = verifyToken(token);
  return user
    ? {
        kind: "session",
        id: user.id,
        permission: "manage",
        actor: user.email,
        expiresAt: user.exp * 1000,
        user,
      }
    : null;
}
async function requireAccess(req, res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const principal = await authenticateAccess({
      token,
      apiKey: req.headers["x-api-key"],
    });
    if (!principal)
      return res
        .status(401)
        .json({ error: "An admin session or valid API key is required" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      principal.permission !== "manage"
    )
      return res
        .status(403)
        .json({ error: "This API key has read-only access" });
    req.principal = principal;
    req.user = principal.user;
    next();
  } catch (error) {
    next(error);
  }
}
const accessActor = (req) => req.principal?.actor || req.user?.email || "admin";

/**
 * Middleware to require authentication
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware to optionally check authentication (doesn't block if not authenticated)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
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
  authenticateAccess,
  requireAccess,
  accessActor,
};
