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

export const readJsonCache = <T,>(key: string, allowExpired = false): T | null => {
  try {
    const raw = localStorage.getItem(jsonCacheStorageKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as JsonCacheEntry<T>;
    if (!entry || typeof entry.expiresAt !== 'number') return null;
    if (!allowExpired && Date.now() > entry.expiresAt) return null;
    return entry.data;
  } catch (e) {
    return null;
  }
};

export const writeJsonCache = (key: string, data: any, ttlMs: number) => {
  try {
    const now = Date.now();
    const entry: JsonCacheEntry = { data, savedAt: now, expiresAt: now + ttlMs };
    localStorage.setItem(jsonCacheStorageKey(key), JSON.stringify(entry));
  } catch (e) { }
};

export const clearJsonCache = (prefix = '') => {
  try {
    const fullPrefix = `${JSON_CACHE_PREFIX}${prefix}`;
    Object.keys(localStorage)
      .filter(key => key.startsWith(fullPrefix))
      .forEach(key => localStorage.removeItem(key));
  } catch (e) { }
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
  if (!forceRefresh) {
    const cached = readJsonCache<T>(cacheKey);
    if (cached !== null) return cached;
  }
  const stale = readJsonCache<T>(cacheKey, true);
  try {
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => null);
    if (isAuthExpiredResponse(res, data)) {
      clearJsonCache();
      window.dispatchEvent(new CustomEvent('auth-expired'));
      onAuthExpired?.();
      throw new Error(data?.error || 'Phiên đăng nhập không hợp lệ.');
    }
    if (!res.ok) throw new Error(data?.error || `Không tải được dữ liệu (${res.status}).`);
    writeJsonCache(cacheKey, data, ttlMs);
    return data as T;
  } catch (e) {
    if (stale !== null) return stale;
    throw e;
  }
};
