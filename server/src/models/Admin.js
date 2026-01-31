const bcrypt = require('bcrypt');

class Admin {
  constructor(data) {
    this._id = data._id;
    this.email = data.email;
    this.passwordHash = data.passwordHash;
    this.createdAt = data.createdAt || new Date();
    this.lastLogin = data.lastLogin || null;
  }

  /**
   * Hash a plain text password
   * @param {string} password - Plain text password
   * @returns {Promise<string>} - Hashed password
   */
  static async hashPassword(password) {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  /**
   * Compare a plain text password with a hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} - True if password matches
   */
  static async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Create a new admin user
   * @param {Object} db - MongoDB connection
   * @param {string} email - Admin email
   * @param {string} password - Plain text password
   * @returns {Promise<Admin>} - Created admin
   */
  static async create(db, email, password) {
    // Check if any admin already exists
    const existingAdmin = await db.collection('admins').findOne({});
    if (existingAdmin) {
      throw new Error('Admin user already exists');
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const passwordHash = await this.hashPassword(password);
    
    const adminData = {
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date(),
      lastLogin: null
    };

    const result = await db.collection('admins').insertOne(adminData);
    return new Admin({ ...adminData, _id: result.insertedId });
  }

  /**
   * Find admin by email
   * @param {Object} db - MongoDB connection
   * @param {string} email - Admin email
   * @returns {Promise<Admin|null>} - Admin or null
   */
  static async findByEmail(db, email) {
    const adminData = await db.collection('admins').findOne({ 
      email: email.toLowerCase().trim() 
    });
    return adminData ? new Admin(adminData) : null;
  }

  /**
   * Check if any admin exists
   * @param {Object} db - MongoDB connection
   * @returns {Promise<boolean>} - True if admin exists
   */
  static async exists(db) {
    const count = await db.collection('admins').countDocuments();
    return count > 0;
  }

  /**
   * Update last login time
   * @param {Object} db - MongoDB connection
   * @returns {Promise<void>}
   */
  async updateLastLogin(db) {
    this.lastLogin = new Date();
    await db.collection('admins').updateOne(
      { _id: this._id },
      { $set: { lastLogin: this.lastLogin } }
    );
  }

  /**
   * Update password
   * @param {Object} db - MongoDB connection
   * @param {string} newPassword - New plain text password
   * @returns {Promise<void>}
   */
  async updatePassword(db, newPassword) {
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }
    
    this.passwordHash = await Admin.hashPassword(newPassword);
    await db.collection('admins').updateOne(
      { _id: this._id },
      { $set: { passwordHash: this.passwordHash } }
    );
  }

  /**
   * Convert to JSON (exclude sensitive data)
   */
  toJSON() {
    return {
      id: this._id.toString(),
      email: this.email,
      createdAt: this.createdAt,
      lastLogin: this.lastLogin
    };
  }
}

module.exports = Admin;
