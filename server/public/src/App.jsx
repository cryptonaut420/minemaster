import React, { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Miners from './components/Miners';
import Configs from './components/Configs';
import Login from './components/Login';
import Register from './components/Register';
import { useWebSocket } from './hooks/useWebSocket';
import { authAPI, removeToken } from './services/auth';
import './App.css';

function App() {
  const location = useLocation();
  const [wsConnected, setWsConnected] = useState(false);
  const [authState, setAuthState] = useState({
    loading: true,
    authenticated: false,
    setupRequired: false,
    user: null
  });

  const handleWsMessage = useCallback((message) => {
    // Handle global WebSocket messages if needed
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  React.useEffect(() => {
    setWsConnected(connected);
  }, [connected]);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // First check if setup is required
      const { setupRequired } = await authAPI.checkSetupRequired();
      
      if (setupRequired) {
        setAuthState({
          loading: false,
          authenticated: false,
          setupRequired: true,
          user: null
        });
        return;
      }

      // Try to get current user (validates token)
      try {
        const { admin } = await authAPI.getCurrentUser();
        setAuthState({
          loading: false,
          authenticated: true,
          setupRequired: false,
          user: admin
        });
      } catch (err) {
        // Token invalid or expired
        setAuthState({
          loading: false,
          authenticated: false,
          setupRequired: false,
          user: null
        });
      }
    } catch (error) {
      setAuthState({
        loading: false,
        authenticated: false,
        setupRequired: false,
        user: null
      });
    }
  };

  const handleAuthSuccess = (user) => {
    setAuthState({
      loading: false,
      authenticated: true,
      setupRequired: false,
      user
    });
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      // Silent fail - will remove token anyway
    } finally {
      removeToken();
      setAuthState({
        loading: false,
        authenticated: false,
        setupRequired: false,
        user: null
      });
    }
  };

  // Show loading state
  if (authState.loading) {
    return (
      <div className="app loading-screen">
        <div className="loading-content">
          <h1>⛏️ MineMaster</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show registration if setup required
  if (authState.setupRequired) {
    return <Register onSuccess={handleAuthSuccess} />;
  }

  // Show login if not authenticated
  if (!authState.authenticated) {
    return <Login onSuccess={handleAuthSuccess} />;
  }

  // Show main app if authenticated
  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand">
          <h1>⛏️ MineMaster</h1>
        </div>
        
        <div className="navbar-links">
          <Link 
            to="/" 
            className={location.pathname === '/' ? 'active' : ''}
          >
            📊 Dashboard
          </Link>
          <Link 
            to="/miners" 
            className={location.pathname === '/miners' ? 'active' : ''}
          >
            💻 Miners
          </Link>
          <Link 
            to="/configs" 
            className={location.pathname === '/configs' ? 'active' : ''}
          >
            ⚙️ Configs
          </Link>
        </div>

        <div className="navbar-right">
          <div className="user-info">
            <span className="user-email">{authState.user?.email}</span>
            <button className="logout-button" onClick={handleLogout}>
              🚪 Logout
            </button>
          </div>
          
          <div className={`connection-status ${wsConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {wsConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/miners" element={<Miners />} />
          <Route path="/configs" element={<Configs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
