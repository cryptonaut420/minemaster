# MineMaster Authentication System

A comprehensive authentication system has been successfully implemented for the MineMaster server!

## What's Been Added

### Backend Components

1. **Admin Model** (`server/src/models/Admin.js`)
   - User account management with bcrypt password hashing
   - Email validation
   - Password strength requirements (8+ characters)
   - Single admin user design

2. **Auth Middleware** (`server/src/middleware/auth.js`)
   - JWT token generation and validation
   - `requireAuth` middleware for protected routes
   - 7-day token expiration

3. **Auth API** (`server/src/api/auth.js`)
   - `GET /api/auth/setup-required` - Check if initial setup needed
   - `POST /api/auth/register` - Create first admin account
   - `POST /api/auth/login` - Authenticate user
   - `GET /api/auth/me` - Get current user info
   - `POST /api/auth/logout` - Logout endpoint

4. **Rate Limiting** (`server/src/server.js`)
   - Login: 5 attempts per 15 minutes
   - API: 100 requests per minute
   - Protection against brute force attacks

5. **Password Reset Script** (`server/scripts/reset-password.js`)
   - Command-line tool for password recovery
   - Usage: `node scripts/reset-password.js email@example.com NewPassword123`

### Frontend Components

1. **Register Component** (`server/public/src/components/Register.jsx`)
   - Beautiful registration screen
   - Form validation
   - Only shown when no admin exists

2. **Login Component** (`server/public/src/components/Login.jsx`)
   - Secure login form
   - Rate limit error handling
   - Clear error messages

3. **Auth Service** (`server/public/src/services/auth.js`)
   - Token management (localStorage)
   - API integration
   - Automatic logout on 401 errors

4. **Updated App** (`server/public/src/App.jsx`)
   - Auth state management
   - Automatic auth checking on load
   - Protected routes
   - User info display in navbar
   - Logout button

5. **Styling** (`server/public/src/components/Auth.css`)
   - Modern gradient design
   - Smooth animations
   - Responsive layout

## How It Works

### First Time Setup
1. Start the server: `npm start`
2. Navigate to your dashboard URL
3. See the registration screen (no admin exists)
4. Create your admin account
5. Automatically logged in

### Subsequent Access
1. Navigate to dashboard URL
2. See login screen if not authenticated
3. Login with your credentials
4. Access full dashboard

### Protected Routes
All API endpoints now require authentication:
- `/api/miners/*`
- `/api/configs/*`
- `/api/stats/*`

### Rate Limiting
- **5 login attempts per 15 minutes** - prevents brute force
- **100 API requests per minute** - prevents abuse
- Clear error messages when limits exceeded

## Security Features

1. **Password Hashing**: bcrypt with 12 rounds
2. **JWT Tokens**: Secure, signed, 7-day expiration
3. **Rate Limiting**: Login and API protection
4. **Input Validation**: Email format, password strength
5. **Single Admin**: Only one admin can exist
6. **Automatic Logout**: On token expiration or manual logout

## Installation & Setup

### Install Dependencies
```bash
cd /var/www/Ironclad/minemaster/server
npm install
```

The following packages were installed:
- `bcrypt` - Password hashing
- `jsonwebtoken` - JWT token management
- `express-rate-limit` - Rate limiting

### Environment Variables

Add to your `.env` file:

```bash
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

Generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Production Deployment

1. Generate strong JWT secret
2. Set `NODE_ENV=production`
3. **Use HTTPS** (required for secure auth)
4. Consider additional security:
   - IP whitelisting
   - VPN access
   - Firewall rules

## Password Reset

If you forget your password:

```bash
cd /var/www/Ironclad/minemaster/server
node scripts/reset-password.js admin@example.com NewPassword123
```

## Testing

1. Start the server
2. Navigate to `http://localhost:3001`
3. You should see the registration screen
4. Create an admin account
5. Verify you're logged in and see the dashboard
6. Logout and try logging back in
7. Try wrong password (should fail after 5 attempts)

## Next Steps

You're all set! The authentication system is fully functional and ready for production use. Just remember to:

1. Set a strong JWT_SECRET in production
2. Use HTTPS when deployed to a domain
3. Keep the reset password script secure (only accessible on server)

Enjoy your secure MineMaster dashboard!
