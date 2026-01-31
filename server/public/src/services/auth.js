import axios from 'axios';

const API_URL = window.REACT_APP_API_URL || 'http://localhost:3001/api';

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
  baseURL: API_URL
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
    // If we get a 401, remove the token and redirect to login
    if (error.response?.status === 401) {
      removeToken();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  checkSetupRequired: async () => {
    const response = await axios.get(`${API_URL}/auth/setup-required`);
    return response.data;
  },

  register: async (email, password) => {
    const response = await axios.post(`${API_URL}/auth/register`, { email, password });
    if (response.data.token) {
      setToken(response.data.token);
    }
    return response.data;
  },

  login: async (email, password) => {
    const response = await axios.post(`${API_URL}/auth/login`, { email, password });
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
