import React, { useState, useCallback } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Miners from './components/Miners';
import Configs from './components/Configs';
import { useWebSocket } from './hooks/useWebSocket';
import './App.css';

function App() {
  const location = useLocation();
  const [wsConnected, setWsConnected] = useState(false);

  const handleWsMessage = useCallback((message) => {
    // Handle global WebSocket messages if needed
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  React.useEffect(() => {
    setWsConnected(connected);
  }, [connected]);

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

        <div className={`connection-status ${wsConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          {wsConnected ? 'Connected' : 'Disconnected'}
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/miners" element={<Miners />} />
          <Route path="/configs" element={<Configs />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
