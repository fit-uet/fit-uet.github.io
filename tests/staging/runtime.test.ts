import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAcademicFixture } from '../academic/fixture';
import { db, setDb } from '../../server/db';
import { healthRouter } from '../../server/routes/health.routes';
import { stagingConfigIssues, stagingJobsEnabled, stagingEmailRecipient } from '../../server/staging/config';
import { getAllowedOrigins } from '../../server/middlewares/cors';
import { sendNotificationEmail } from '../../server/services/email';
import { cronRouter } from '../../server/routes/cron.routes';

let saved: NodeJS.ProcessEnv; let client: Awaited<ReturnType<typeof createAcademicFixture>>; let originalFetch: typeof fetch;
beforeEach(async () => { saved = { ...process.env }; originalFetch = globalThis.fetch; client = await createAcademicFixture(); });
afterEach(() => { client.close(); globalThis.fetch = originalFetch; for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
async function serve(run: (base: string) => Promise<void>) {
  const app = express(); app.use(healthRouter); app.use(cronRouter); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { await new Promise<void>(r => server.close(() => r())); }
}
test('staging config rejects production defaults and incomplete credentials without printing secrets', () => {
  const issues = stagingConfigIssues({ APP_ENV: 'staging', NODE_ENV: 'development', JWT_SECRET: 'sensitive', DB_PROVIDER: 'd1', CLOUDFLARE_DATABASE_ID: '866e23b7-3b49-43e4-ab90-59dceb4c4f76', R2_BUCKET: 'internship-final-reports', CORS_ORIGIN: 'https://fit-uet.github.io', EMAIL_PROVIDER: 'brevo' });
  for (const name of ['NODE_ENV', 'JWT_SECRET', 'CLOUDFLARE_DATABASE_ID', 'R2_BUCKET', 'CORS_ORIGIN', 'STAGING_EMAIL_RECIPIENT']) assert.ok(issues.some(i => i.field === name));
  assert.ok(!JSON.stringify(issues).includes('sensitive'));
});
test('local staging disables scheduled jobs and excludes the production frontend origin', () => {
  process.env.APP_ENV = 'local-staging'; process.env.CORS_ORIGIN = 'http://127.0.0.1:4319';
  assert.equal(stagingJobsEnabled(), false); assert.deepEqual(getAllowedOrigins(), ['http://127.0.0.1:4319']);
  assert.equal(stagingJobsEnabled({ APP_ENV: 'production' }), true); assert.equal(stagingEmailRecipient({ STAGING_EMAIL_RECIPIENT: 'test@example.org,real@example.org' }), '');
});
test('health checks distinguish liveness from DB readiness and never expose DB errors', async () => {
  process.env.APP_ENV = 'local-staging';
  await serve(async base => {
    assert.equal((await originalFetch(`${base}/api/health`)).status, 200); assert.equal((await originalFetch(`${base}/api/ready`)).status, 200);
    await db.execute('DELETE FROM academic_schema_migrations WHERE version=4');
    assert.equal((await originalFetch(`${base}/api/ready`)).status, 503);
    setDb({ execute: async () => { throw new Error('private-database-credential'); }, executeMultiple: async () => {}, batch: async () => [] });
    const result = await originalFetch(`${base}/api/ready`); assert.equal(result.status, 503); assert.ok(!(await result.text()).includes('private-database-credential'));
    assert.equal((await originalFetch(`${base}/api/health`)).status, 200);
  });
});
test('cron endpoints are disabled on local staging even when a valid cron secret is present', async () => {
  process.env.APP_ENV = 'local-staging'; process.env.CRON_SECRET = 'test';
  await serve(async base => { assert.equal((await originalFetch(`${base}/api/cron/process-email-queue`, { method: 'POST', headers: { 'X-Cron-Secret': 'test' } })).status, 409); });
});
test('email delivery in staging targets only the test inbox and strips all copied CC recipients', async () => {
  await db.executeMultiple("ALTER TABLE notifications ADD COLUMN provider TEXT; ALTER TABLE notifications ADD COLUMN provider_message_id TEXT; ALTER TABLE notifications ADD COLUMN attempt_count INTEGER; ALTER TABLE notifications ADD COLUMN last_attempt_at TEXT; INSERT INTO notifications(id,status) VALUES(1,'queued')");
  process.env.APP_ENV = 'staging'; process.env.EMAIL_PROVIDER = 'brevo'; process.env.EMAIL_FROM = 'sender@example.org'; process.env.BREVO_API_KEY = 'unit-test-key'; process.env.STAGING_EMAIL_RECIPIENT = 'qa@example.org';
  const requests: any[] = []; globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ messageId: 'fake-provider-id' }), { status: 201 }); };
  const data = { recipient_email: 'student@vnu.edu.vn', cc_emails: ['real-company@example.org'], subject: 'Đánh giá', body: 'Nội dung nghiệm thu.' };
  assert.equal(await sendNotificationEmail(1, data), 'sent'); assert.deepEqual(requests[0].to, [{ email: 'qa@example.org' }]); assert.equal(requests[0].cc, undefined); assert.ok(requests[0].subject.startsWith('[STAGING]'));
  process.env.STAGING_EMAIL_RECIPIENT = ''; assert.equal(await sendNotificationEmail(1, data), 'queued'); assert.equal(requests.length, 1);
});
