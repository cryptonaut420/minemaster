#!/usr/bin/env node

/**
 * Password Reset Script for MineMaster Server
 * 
 * Usage:
 *   node scripts/reset-password.js <email> <new-password>
 * 
 * Example:
 *   node scripts/reset-password.js admin@example.com MyNewPassword123!
 */

require('dotenv').config();
const { connect, getDb } = require('../src/db/mongodb');
const Admin = require('../src/models/Admin');

async function resetPassword(email, newPassword) {
  try {
    console.log('Connecting to database...');
    await connect();
    
    const db = getDb();
    
    console.log(`Looking for admin user: ${email}`);
    const admin = await Admin.findByEmail(db, email);
    
    if (!admin) {
      console.error(`❌ Error: No admin user found with email: ${email}`);
      process.exit(1);
    }
    
    console.log(`Found admin user: ${admin.email}`);
    console.log('Updating password...');
    
    await admin.updatePassword(db, newPassword);
    
    console.log('✅ Password updated successfully!');
    console.log(`You can now login with email: ${email}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting password:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: node scripts/reset-password.js <email> <new-password>');
  console.error('Example: node scripts/reset-password.js admin@example.com MyNewPassword123!');
  process.exit(1);
}

const [email, newPassword] = args;

if (!email || !newPassword) {
  console.error('❌ Both email and new password are required');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('❌ Password must be at least 8 characters long');
  process.exit(1);
}

resetPassword(email, newPassword);
