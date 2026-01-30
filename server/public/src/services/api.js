import axios from 'axios';

const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

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

// Health check
export const healthAPI = {
  check: () => api.get('/health')
};

export default api;
