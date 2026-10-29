import { createHash } from 'node:crypto';
export function validateJsonCache(req: any, res: any, data: unknown) {
  if (req.method !== 'GET' || res.statusCode !== 200 || /\/api\/(health|ready)$/.test(req.path)) return false;
  const identity = req.user ? `${req.user.id}:${req.user.role}:${req.user.is_lecturer || 0}` : 'public';
  const etag = `"${createHash('sha256').update(identity).update(JSON.stringify(data) || 'null').digest('base64url')}"`;
  res.setHeader('Cache-Control', 'private, no-cache'); res.setHeader('ETag', etag); res.vary('Authorization');
  if (String(req.headers['if-none-match'] || '').split(/,\s*/).includes(etag)) { res.status(304).end(); return true; }
  return false;
}
export function jsonCacheMiddleware(req: any, res: any, next: any) {
  if (!req.path.startsWith('/api/')) return next();
  const started = performance.now();
  const send = res.json.bind(res);
  res.json = (data: unknown) => { res.setHeader('Server-Timing', `app;dur=${(performance.now()-started).toFixed(1)}`); if (validateJsonCache(req, res, data)) return res; return send(data); };
  next();
}
