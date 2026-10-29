export function normalizeOrigin(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function isCorsAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalized)) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return false;
}

export function getAllowedOrigins() {
  return Array.from(new Set([
    ...(['staging', 'local-staging'].includes(process.env.APP_ENV || '') ? [] : ['https://fit-uet.github.io']),
    ...(process.env.CORS_ORIGIN || '').split(',')
  ].map(normalizeOrigin).filter(Boolean)));
}

export function createCorsOptions() {
  const allowedOrigins = getAllowedOrigins();
  return {
    origin: (origin: string | undefined, callback: any) => {
      if (isCorsAllowed(origin, allowedOrigins)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['ETag', 'Content-Disposition', 'Server-Timing'],
  };
}
