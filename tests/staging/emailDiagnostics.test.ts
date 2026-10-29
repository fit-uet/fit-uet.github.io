import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAcademicFixture } from '../academic/fixture';
import { db } from '../../server/db';
import { JWT_SECRET } from '../../server/config';
import { checkEmailConnection } from '../../server/services/emailDiagnostics';
import { emailDiagnosticsRouter } from '../../server/routes/emailDiagnostics.routes';

const configured = { EMAIL_PROVIDER: 'brevo', EMAIL_FROM: 'Khoa <sender@example.org>', BREVO_API_KEY: 'private-test-key' };
let originalFetch: typeof fetch;
let saved: NodeJS.ProcessEnv;
beforeEach(() => { originalFetch = globalThis.fetch; saved = { ...process.env }; });
afterEach(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });

test('disabled and incomplete configuration never contact a provider', async () => {
  const fetcher = (async () => { throw new Error('Provider must not be called'); }) as typeof fetch;
  assert.equal((await checkEmailConnection({ env: { EMAIL_PROVIDER: 'none' }, fetcher })).status, 'disabled');
  for (const env of [{ ...configured, EMAIL_FROM: 'invalid' }, { ...configured, BREVO_API_KEY: '' }, { ...configured, EMAIL_PROVIDER: 'unknown' }]) assert.equal((await checkEmailConnection({ env, fetcher })).status, 'missing_config');
  assert.equal((await checkEmailConnection({ env: { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@example.org', RESEND_API_KEY: 'sending-only' }, fetcher })).status, 'not_checked');
});

test('Brevo diagnostics only read account metadata and never expose provider data or credentials', async () => {
  let requests = 0;
  const fetcher = (async (url, init) => {
    requests++; assert.equal(url, 'https://api.brevo.com/v3/account'); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('api-key'), configured.BREVO_API_KEY); assert.ok(init?.signal); assert.equal(init?.body, undefined);
    return Response.json({ email: 'account-owner@example.org', relay: { enabled: true, data: { password: 'private-provider-password' } }, plan: [{ credits: 300 }] });
  }) as typeof fetch;
  const result = await checkEmailConnection({ env: configured, fetcher });
  assert.equal(result.status, 'connected'); assert.equal(requests, 1); assert.equal(result.sender, 'sender@example.org');
  for (const secret of ['private-test-key', 'private-provider-password', 'account-owner@example.org', 'credits']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('IP restrictions are distinguished from invalid credentials and access permissions', async () => {
  const check = (status: number, message: string) => checkEmailConnection({ env: configured, fetcher: (async () => Response.json({ message }, { status })) as typeof fetch });
  for (const ip of ['192.0.2.44', '2001:db8::1']) {
    const result = await check(401, `We have detected you are using an unrecognised IP address ${ip}. Visit https://app.brevo.com/security/authorised_ips. private-test-key`);
    assert.equal(result.status, 'ip_blocked'); assert.equal(result.blockedIp, ip); assert.ok(!JSON.stringify(result).includes('private-test-key'));
  }
  assert.equal((await check(401, 'Key not found: private-test-key')).status, 'authentication_failed');
  assert.equal((await check(403, 'Not enough permissions')).status, 'access_denied');
  assert.equal((await check(429, 'Slow down')).status, 'rate_limited');
});

test('malformed responses, disabled sending and connection failures are not reported as a working mail service', async () => {
  for (const response of [new Response('<html>Unavailable</html>'), Response.json({ status: 'ok' }), Response.json({ error: 'private-test-key' }, { status: 503 })]) {
    const result = await checkEmailConnection({ env: configured, fetcher: (async () => response) as typeof fetch });
    assert.equal(result.status, 'unavailable'); assert.ok(!JSON.stringify(result).includes('private-test-key'));
  }
  assert.equal((await checkEmailConnection({ env: configured, fetcher: (async () => Response.json({ email: 'owner@example.org', relay: { enabled: false } })) as typeof fetch })).status, 'sending_disabled');
  const result = await checkEmailConnection({ env: configured, fetcher: (async () => { throw new Error('private-test-key timeout'); }) as typeof fetch });
  assert.equal(result.status, 'unavailable'); assert.ok(!JSON.stringify(result).includes('private-test-key'));
});

test('HTTP diagnostics require Khoa and leave notification rows, outbox and grade data unchanged', async () => {
  const client = await createAcademicFixture();
  await db.execute("INSERT INTO users(id,email,name,role) VALUES(100,'24020001@vnu.edu.vn','SV','student')");
  const app = express(); app.use(emailDiagnosticsRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  Object.assign(process.env, configured);
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; return Response.json({ email: 'owner@example.org' }); }) as typeof fetch;
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/email/diagnostics`;
    assert.equal((await originalFetch(url)).status, 401);
    for (const email of ['24020001@vnu.edu.vn', 'alpha@vnu.edu.vn']) {
      const response = await originalFetch(url, { headers: { Authorization: `Bearer ${jwt.sign({ email }, JWT_SECRET)}` } }); assert.equal(response.status, 403);
    }
    assert.equal(providerCalls, 0);
    const response = await originalFetch(url, { headers: { Authorization: `Bearer ${jwt.sign({ email: 'admin@vnu.edu.vn' }, JWT_SECRET)}` } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal((await response.json()).status, 'connected'); assert.equal(providerCalls, 1);
    for (const table of ['notifications', 'academic_outbox', 'grades']) assert.equal(Number((await db.execute(`SELECT count(*) n FROM ${table}`)).rows[0].n), 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); client.close(); }
});
