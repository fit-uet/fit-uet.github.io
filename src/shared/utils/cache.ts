import { requestJson, clearRequestCache, invalidateRequestCache } from './requestCache';
export const isAuthExpiredResponse = (res: Response, data?: any) =>
  res.status === 401 || (res.status === 403 && /token|hết hạn|unauthorized/i.test(String(data?.error || '')));

export const jwtExpiresAtMs = (token: string | null | undefined) => {
  try {
    const base64Url = String(token || '').split('.')[1] || '';
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64));
    const exp = Number(payload?.exp || 0);
    return exp > 0 ? exp * 1000 : null;
  } catch (e) {
    return null;
  }
};

export const JSON_CACHE_PREFIX = 'irs-cache:json:';
if (typeof window !== 'undefined') { try { Object.keys(localStorage).filter(key => key.startsWith(JSON_CACHE_PREFIX)).forEach(key => localStorage.removeItem(key)); } catch {} }

export const CACHE_TTL = {
  campaign: 5 * 60 * 1000,
  companies: 5 * 60 * 1000,
  lecturers: 30 * 60 * 1000,
  markdown: 30 * 60 * 1000,
  lecturerStudents: 60 * 1000,
};

export type JsonCacheEntry<T = any> = {
  data: T;
  savedAt: number;
  expiresAt: number;
};

export const jsonCacheStorageKey = (key: string) => `${JSON_CACHE_PREFIX}${key}`;

// Legacy storage is purged; business data is cached only in memory now.
export const readJsonCache = <T,>(_key: string, _allowExpired = false): T | null => null;
export const writeJsonCache = (_key: string, _data: any, _ttlMs: number) => {};
export const clearJsonCache = (_prefix = '') => {
  clearRequestCache(_prefix || undefined);
  try { Object.keys(localStorage).filter(key => key.startsWith(JSON_CACHE_PREFIX)).forEach(key => localStorage.removeItem(key)); } catch {}
};

export const cachedJsonFetch = async <T,>(
  url: string,
  {
    cacheKey,
    ttlMs,
    headers,
    forceRefresh = false,
    onAuthExpired,
  }: {
    cacheKey: string;
    ttlMs: number;
    headers?: HeadersInit;
    forceRefresh?: boolean;
    onAuthExpired?: () => void;
  }
): Promise<T> => {
  return requestJson<T>(url, { headers, forceRefresh, scope: cacheKey }).catch(error => { if (error.status === 401) onAuthExpired?.(); throw error; });
};
