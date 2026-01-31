# MineMaster Server Authentication

A secure authentication system has been implemented for the MineMaster server dashboard.

## Features

- **First-Time Setup**: When no admin user exists, a registration screen allows you to create the initial admin account
- **Login Protection**: Rate limiting prevents brute force attacks (5 attempts per 15 minutes)
- **JWT Authentication**: Secure token-based authentication with 7-day expiration
- **Password Requirements**: Minimum 8 characters
- **API Rate Limiting**: General API rate limiting (100 requests per minute per IP)
- **Password Reset**: Command-line script for password recovery

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Environment Variables

Add to your `.env` file:

```bash
# JWT Secret - Generate a secure random string
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

Generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. First Time Access

1. Start the server
2. Navigate to the dashboard URL
3. You'll see a registration screen (only shown when no admin exists)
4. Enter your email and password
5. The admin account is created and you're logged in

### 4. Subsequent Logins

After registration, the login screen will be shown to unauthenticated users.

## Password Reset

If you forget your password, use the reset script on the server:

```bash
cd server
node scripts/reset-password.js admin@example.com NewPassword123
```

## Security Features

### Rate Limiting

- **Login Attempts**: 5 attempts per 15 minutes per IP
- **API Requests**: 100 requests per minute per IP
- Automatic lockout with clear error messages

### Password Security

- Passwords hashed with bcrypt (12 rounds)
- Minimum 8 character requirement
- No password transmitted or stored in plain text

### Session Management

- JWT tokens with 7-day expiration
- Tokens stored in browser localStorage
- Automatic logout on token expiration
- Logout clears token immediately

## API Endpoints

### Authentication

- `GET /api/auth/setup-required` - Check if initial setup is needed
- `POST /api/auth/register` - Register first admin (only works if no admin exists)
- `POST /api/auth/login` - Login with email/password
- `GET /api/auth/me` - Get current authenticated user
- `POST /api/auth/logout` - Logout (client-side token removal)

### Protected Routes

All existing API routes (`/api/miners`, `/api/configs`, `/api/stats`) now require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Single User Design

Currently designed for single admin use. Only one admin account can exist at a time. If you need multiple admins in the future, the system can be extended.

## Production Deployment

1. Generate a strong JWT secret
2. Set `NODE_ENV=production`
3. Use HTTPS (required for secure authentication)
4. Consider additional security measures:
   - Firewall rules
   - VPN access
   - IP whitelisting
   - Fail2ban integration

## Troubleshooting

### Locked Out After Too Many Attempts

Wait 15 minutes for the rate limit to reset, or restart the server to clear rate limit memory.

### Forgot Password

Use the reset script:

```bash
node scripts/reset-password.js your-email@example.com NewPassword123
```

### Can't Create Admin User

If registration says "Admin user already exists" but you don't have credentials:

1. Access the MongoDB database
2. Delete the admin document from the `admins` collection
3. Restart the server
4. You'll see the registration screen again
