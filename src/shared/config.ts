export const GOOGLE_CLIENT_ID = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || '109463395923-mock.apps.googleusercontent.com';
export const GOOGLE_API_KEY = (import.meta as any).env.VITE_GOOGLE_API_KEY || '';
const configuredApiBase = (import.meta as any).env.VITE_API_BASE_URL;
export const API_BASE = typeof configuredApiBase === 'string'
  ? configuredApiBase.trim().replace(/\/$/, '')
  : ((import.meta as any).env.DEV ? '' : 'https://internship-api-dplz.onrender.com');
