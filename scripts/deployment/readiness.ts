export type ReleaseCheck = { name: string; ok: boolean; detail: string };
export function apiOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('API phải là HTTPS origin, không có đường dẫn, query hoặc thông tin đăng nhập.');
  return url.origin;
}
export async function verifyRelease(input: { base: string; release: string; fetcher?: typeof fetch }) {
  const base = apiOrigin(input.base);
  if (!/^[a-f0-9]{40}$/.test(input.release)) throw new Error('Cần SHA đầy đủ của commit triển khai.');
  const fetcher = input.fetcher || fetch;
  const checks: ReleaseCheck[] = [];
  for (const [path, expectedStatus] of [['/api/health', 200], ['/api/ready', 200], ['/api/me/campaigns', 401]] as const) {
    try {
      const response = await fetcher(`${base}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (response.status !== expectedStatus || !response.headers.get('content-type')?.includes('application/json')) {
        checks.push({ name: path, ok: false, detail: `HTTP ${response.status}; cần JSON và HTTP ${expectedStatus}.` }); continue;
      }
      const body = await response.json();
      const ok = expectedStatus === 401
        ? !!body.error && !body.data && !body.enrollments
        : body.environment === 'production' && body.release === input.release && (path === '/api/ready' ? body.status === 'ready' && body.database === 'ok' && body.academicSchema === 3 : body.status === 'up');
      checks.push({ name: path, ok, detail: ok ? 'Đạt.' : 'Chưa có đúng phiên bản production/schema hoặc API chưa bảo vệ quyền.' });
    } catch { checks.push({ name: path, ok: false, detail: 'Không nhận được JSON hợp lệ qua HTTPS.' }); }
  }
  return { ok: checks.every(check => check.ok), release: input.release, checks };
}
