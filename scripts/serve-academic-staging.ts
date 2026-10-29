// Only a prepared, private copy is served; this script is never a production entrypoint.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const args = process.argv.slice(2);
const port = Number(args.find(x => x.startsWith('--port='))?.slice(7) || 4319);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port không hợp lệ.');

const input = args.find(x => x.startsWith('--directory='))?.slice('--directory='.length);
if (!input) throw new Error('Dùng npm run academic:stage:serve -- --directory=/path/to/prepared-staging');
const directory = await realpath(resolve(input));
const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
const path = await realpath(join(directory, 'staging.db'));
if (!report.preserved || !report.sourceUnchanged || path !== report.databasePath) throw new Error('Chỉ chạy thư mục bản sao đã đối soát đạt bằng academic:stage.');
process.env.APP_ENV = 'local-staging'; process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(48).toString('base64url'); process.env.EMAIL_PROVIDER = 'none';
process.env.STAGING_RUN_JOBS = 'false'; process.env.VITE_API_BASE_URL = ''; process.env.CORS_ORIGIN = `http://127.0.0.1:${port}`;
for (const k of Object.keys(process.env)) if (/^(?:R2_|CLOUDFLARE_|GOOGLE_SERVICE_|GOOGLE_PRIVATE_|BREVO_|RESEND_)/.test(k)) delete process.env[k];
const { createClient } = await import('@libsql/client'); const { setDb } = await import('../server/db');
const { libsqlDatabase } = await import('../server/academic/libsql');
const { createApp } = await import('../server/app'); const { default: express } = await import('express'); const { default: jwt } = await import('jsonwebtoken');
const { createServer } = await import('node:http');
const { default: react } = await import('@vitejs/plugin-react'); const { default: tailwindcss } = await import('@tailwindcss/vite');
const client = createClient({ url: `file:${path}` }); setDb(libsqlDatabase(client));
const adminEmail = 'academic-staging-admin@local.invalid';
await client.execute({ sql: "INSERT INTO users(email,name,role) VALUES(?,'Khoa · Staging local','admin') ON CONFLICT(email) DO NOTHING", args: [adminEmail] });
const app = express();
const server = createServer(app);
app.use((req, res, next) => {
  if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).send('Local staging only.');
  next();
});
app.get('/__local_staging/login', async (req, res) => {
  // Admin by default. Other existing copied/imported accounts can be inspected explicitly.
  const email = String(req.query.email || adminEmail).trim().toLowerCase();
  const user = (await client.execute({ sql: 'SELECT * FROM users WHERE lower(email)=?', args: [email] })).rows[0];
  if (!user) return res.status(404).send('Tài khoản chưa có trong bản sao staging. Import/xác nhận danh sách trước khi thử tài khoản SV.');
  const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET!, { expiresIn: '8h' });
  const literal = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');
  res.setHeader('Cache-Control', 'no-store'); res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Local staging</title><script>localStorage.setItem('token',${literal(token)});localStorage.setItem('user',${literal(JSON.stringify(user))});location.replace('/#/classes');</script>`);
});
app.post('/api/auth/google', (_req, res) => res.status(409).json({ error: 'Staging local dùng /__local_staging/login. OAuth thật được nghiệm thu riêng trên staging HTTPS.' }));
// File fallback also belongs to this copy rather than the original workspace.
// Keep the Vite root fixed before changing the working directory.
const projectRoot = process.cwd(); const storage = join(directory, '.storage'); await mkdir(storage, { recursive: true, mode: 0o700 });
app.use(await createApp({ vite: { root: projectRoot, configFile: false, envDir: false, cacheDir: join(directory, '.vite'), plugins: [react(), tailwindcss()], server: {
  hmr: { server },
  fs: { deny: ['.env', '.env.*', '**/*.env', '*.{crt,pem}', '**/.git/**', '**/*.db*', '**/*.sqlite*', '**/.storage/**', '**/report.json', '**/import-preview.json', '**/REPORT.md', '**/*.xlsx'] },
}, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') } } }));
process.chdir(directory);
server.listen(port, '127.0.0.1', () => console.log(`Local staging: http://127.0.0.1:${port}/__local_staging/login`));
server.on('error', error => { console.error(error.message); client.close(); process.exitCode = 1; });
const close = () => { server.close(() => { client.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
