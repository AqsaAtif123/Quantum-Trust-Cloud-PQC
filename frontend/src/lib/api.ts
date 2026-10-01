import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useKeyStore } from '../store/keyStore';
import { disconnectSocket } from './socket';

const apiOrigin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

export const api = axios.create({
  baseURL: apiOrigin ? `${apiOrigin}/api` : '/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clear();
      useKeyStore.getState().clear();
      disconnectSocket();
    }
    return Promise.reject(error);
  },
);
