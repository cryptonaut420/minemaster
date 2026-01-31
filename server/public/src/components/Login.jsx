import React, { useState } from 'react';
import { authAPI } from '../services/auth';
import './Auth.css';

function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);

    try {
      const response = await authAPI.login(email, password);
      onSuccess(response.admin);
    } catch (err) {
      
      // Show specific error messages
      const errorMessage = err.response?.data?.error || 'Login failed. Please try again.';
      
      if (err.response?.status === 429) {
        setError('Too many login attempts. Please wait 15 minutes before trying again.');
      } else if (err.response?.status === 401) {
        setError('Invalid email or password');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>⛏️ MineMaster</h1>
          <h2>Admin Login</h2>
          <p>Enter your credentials to access the dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              disabled={loading}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="auth-footer">
          <p>Forgot your password? Use the reset script on the server.</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
