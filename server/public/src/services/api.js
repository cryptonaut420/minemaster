import axios from 'axios';
import { getToken } from './auth';

// In production, use relative /api path (same origin, served by Express)
// In development, Vite proxy handles /api -> localhost:3001
const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

// Add auth token to all requests
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

// Miners API
export const minersAPI = {
  getAll: () => api.get('/miners'),
  getById: (id) => api.get(`/miners/${id}`),
  register: (data) => api.post('/miners', data),
  update: (id, data) => api.put(`/miners/${id}`, data),
  delete: (id) => api.delete(`/miners/${id}`),
  sendCommand: (id, command, params) => api.post(`/miners/${id}/command`, { command, params }),
  restart: (id) => api.post(`/miners/${id}/restart`),
  stop: (id) => api.post(`/miners/${id}/stop`),
  start: (id, minerType, config) => api.post(`/miners/${id}/start`, { minerType, config }),
  // Device toggle endpoints
  toggleCpu: (id, enabled) => api.post(`/miners/${id}/toggle-cpu`, { enabled }),
  toggleGpu: (id, enabled, gpuId = null) => api.post(`/miners/${id}/toggle-gpu`, { enabled, gpuId }),
  getDevices: (id) => api.get(`/miners/${id}/devices`)
};

// Configs API
export const configsAPI = {
  getAll: () => api.get('/configs'),
  getByType: (type) => api.get(`/configs/${type}`),
  update: (type, config) => api.put(`/configs/${type}`, config),
  apply: (type) => api.post(`/configs/${type}/apply`)
};

// Stats API
export const statsAPI = {
  getHashrateTimeseries: (timeframe = '7d') => api.get('/stats/hashrates-timeseries', { params: { timeframe } })
};

// Health check
export const healthAPI = {
  check: () => api.get('/health')
};

export default api;
