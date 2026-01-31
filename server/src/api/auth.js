const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const { generateToken, requireAuth } = require('../middleware/auth');

/**
 * Check if setup is required (no admin exists)
 * GET /api/auth/setup-required
 */
router.get('/setup-required', async (req, res) => {
  try {
    const adminExists = await Admin.exists(req.app.locals.db);
    res.json({ setupRequired: !adminExists });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

/**
 * Register the first admin user
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create the admin user
    const admin = await Admin.create(req.app.locals.db, email, password);
    
    // Generate token
    const token = generateToken(admin);

    res.status(201).json({
      message: 'Admin account created successfully',
      token,
      admin: admin.toJSON()
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.message === 'Admin user already exists') {
      return res.status(409).json({ error: error.message });
    }
    if (error.message.includes('Invalid email') || error.message.includes('Password must')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find admin by email
    const admin = await Admin.findByEmail(req.app.locals.db, email);
    
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await Admin.comparePassword(password, admin.passwordHash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await admin.updateLastLogin(req.app.locals.db);

    // Generate token
    const token = generateToken(admin);

    res.json({
      message: 'Login successful',
      token,
      admin: admin.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Verify token and get current user
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const admin = await Admin.findByEmail(req.app.locals.db, req.user.email);
    
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    res.json({ admin: admin.toJSON() });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

/**
 * Logout (client-side token removal, but endpoint for consistency)
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, (req, res) => {
  res.json({ message: 'Logout successful' });
});

module.exports = router;
