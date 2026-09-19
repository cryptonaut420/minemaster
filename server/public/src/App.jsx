import React, { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
const Dashboard = lazy(() => import("./components/Dashboard"));
const Configs = lazy(() => import("./components/Configs"));
const ApiKeys = lazy(() => import("./components/ApiKeys"));
import Login from "./components/Login";
import Register from "./components/Register";
import { authAPI, removeToken } from "./services/auth";
import "./App.css";
import NotificationProvider from "./components/Notifications";

class ViewBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="view-error" role="alert">
          <h2>This view could not load</h2>
          <p>
            The connection may have failed or a new admin version may be
            available. Reload to try again. Unsaved edits in this page may be
            lost.
          </p>
          <button onClick={() => window.location.reload()}>Reload admin</button>
        </section>
      );
    return this.props.children;
  }
}

function App() {
  const location = useLocation();
  const [authError, setAuthError] = useState("");
  const [authState, setAuthState] = useState({
    loading: true,
    authenticated: false,
    setupRequired: false,
    user: null,
  });

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    setAuthError("");
    setAuthState((previous) => ({ ...previous, loading: true }));
    try {
      const { setupRequired } = await authAPI.checkSetupRequired();
      if (setupRequired) {
        setAuthState({
          loading: false,
          authenticated: false,
          setupRequired: true,
          user: null,
        });
        return;
      }
      try {
        const { admin } = await authAPI.getCurrentUser();
        setAuthState({
          loading: false,
          authenticated: true,
          setupRequired: false,
          user: admin,
        });
      } catch (error) {
        if (![401, 404].includes(error.response?.status)) throw error;
        setAuthState({
          loading: false,
          authenticated: false,
          setupRequired: false,
          user: null,
        });
      }
    } catch (error) {
      setAuthError(
        "The admin service is unavailable. Check the server connection and retry.",
      );
      setAuthState((previous) => ({ ...previous, loading: false }));
    }
  };

  const handleAuthSuccess = (user) => {
    setAuthState({
      loading: false,
      authenticated: true,
      setupRequired: false,
      user,
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
        user: null,
      });
    }
  };

  // Show loading state
  if (authState.loading) {
    return (
      <div className="app loading-screen">
        <div className="loading-content">
          <h1>⛏️</h1>
          <p>Loading MineMaster...</p>
        </div>
      </div>
    );
  }

  if (authError)
    return (
      <div className="app loading-screen">
        <div className="loading-content" role="alert">
          <h1>MineMaster</h1>
          <p>{authError}</p>
          <button onClick={checkAuth}>Retry connection</button>
        </div>
      </div>
    );

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
    <NotificationProvider>
      <div className="app">
        <nav className="navbar">
          <div className="navbar-brand">
            <h1>MineMaster</h1>
          </div>

          <div className="navbar-links">
            <Link to="/" className={location.pathname === "/" ? "active" : ""}>
              Fleet
            </Link>
            <Link
              to="/configs"
              className={location.pathname === "/configs" ? "active" : ""}
            >
              Configurations
            </Link>
            <Link
              to="/api-access"
              className={location.pathname === "/api-access" ? "active" : ""}
            >
              API access
            </Link>
          </div>

          <div className="navbar-right">
            <div className="user-info">
              <div className="user-avatar">
                {authState.user?.email?.charAt(0).toUpperCase() || "?"}
              </div>
              <span className="user-email">{authState.user?.email}</span>
              <button className="logout-button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </nav>

        <main className="main-content">
          <ViewBoundary key={location.pathname}>
            <Suspense fallback={<p role="status">Loading view…</p>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/configs" element={<Configs />} />
                <Route path="/api-access" element={<ApiKeys />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ViewBoundary>
        </main>
      </div>
    </NotificationProvider>
  );
}

export default App;
