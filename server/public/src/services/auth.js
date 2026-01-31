import axios from 'axios';

// Use same URL detection pattern as api.js
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001/api' 
  : '/api';

// Auth token management
const TOKEN_KEY = 'minemaster_auth_token';

export const getToken = () => {
  return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token) => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const removeToken = () => {
  localStorage.removeItem(TOKEN_KEY);
};

// Create axios instance with auth interceptor
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000
});

api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // If we get a 401, just reject - let the app handle the redirect
    if (error.response?.status === 401) {
      removeToken();
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  checkSetupRequired: async () => {
    const response = await api.get('/auth/setup-required');
    return response.data;
  },

  register: async (email, password) => {
    const response = await api.post('/auth/register', { email, password });
    if (response.data.token) {
      setToken(response.data.token);
    }
    return response.data;
  },

  login: async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    if (response.data.token) {
      setToken(response.data.token);
    }
    return response.data;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      removeToken();
    }
  },

  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  }
};

export default api;
