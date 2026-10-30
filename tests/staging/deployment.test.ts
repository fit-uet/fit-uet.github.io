import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupLibsql } from '../../scripts/deployment/backup';
import { apiOrigin, verifyRelease } from '../../scripts/deployment/readiness';

test('remote backup restores data, binary files, triggers and deleted high-water IDs without modifying the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-backup-'));
  const source = createClient({ url: `file:${join(dir, 'source.db')}`, intMode: 'bigint' });
  try {
    await source.executeMultiple(`CREATE TABLE people(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,score REAL,pdf BLOB);
      CREATE TABLE history(id INTEGER);
      CREATE TRIGGER trace AFTER INSERT ON people BEGIN INSERT INTO history VALUES(NEW.id); END;
      INSERT INTO people(id,name,score,pdf) VALUES(1,'Tên có dấu',7.999,X'0027ff'),(900,'Đã xóa',NULL,NULL);
      DELETE FROM people WHERE id=900; CREATE INDEX by_name ON people(name); CREATE VIEW names AS SELECT name FROM people;`);
    const destination = join(dir, 'copy.db');
    const report = await backupLibsql(source, destination);
    assert.equal(report.integrity, 'ok'); assert.equal(report.foreignKeyIssues, 0); assert.equal(report.counts.people, 1); assert.equal(report.counts.history, 2);
    const restored = new DatabaseSync(destination);
    try {
      const person = restored.prepare('SELECT * FROM people').get()!;
      assert.equal(person.name, 'Tên có dấu'); assert.equal(person.score, 7.999); assert.deepEqual(Buffer.from(person.pdf as Uint8Array), Buffer.from('0027ff', 'hex'));
      assert.equal(restored.prepare('SELECT count(*) n FROM history').get()!.n, 2);
      assert.equal(restored.prepare('SELECT name FROM names').get()!.name, 'Tên có dấu');
      assert.equal(restored.prepare("INSERT INTO people(name) VALUES('Mới')").run().lastInsertRowid, 901);
      assert.equal(restored.prepare('SELECT count(*) n FROM history').get()!.n, 3);
    } finally { restored.close(); }
    assert.equal((await source.execute('SELECT count(*) n FROM people')).rows[0].n, 1n);
    const bytes = await readFile(destination);
    await assert.rejects(backupLibsql(source, destination), /EEXIST/);
    assert.deepEqual(await readFile(destination), bytes);
  } finally { source.close(); await rm(dir, { recursive: true, force: true }); }
});
const sha = 'a'.repeat(40);
function fixture(overrides: Record<string, unknown> = {}) {
  return (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const payload = path === '/api/me/campaigns' ? { error: 'Unauthorized' } : { status: path === '/api/ready' ? 'ready' : 'up', environment: 'production', release: sha, database: 'ok', academicSchema: 4, ...overrides };
    return Response.json(payload, { status: path === '/api/me/campaigns' ? 401 : 200 });
  }) as typeof fetch;
}
test('release checks require the deployed SHA, production schema and protected API; HTML fallbacks never pass', async () => {
  assert.equal((await verifyRelease({ base: 'https://api.example.org', release: sha, fetcher: fixture() })).ok, true);
  for (const overrides of [{ release: 'b'.repeat(40) }, { environment: 'local-staging' }, { academicSchema: 1 }, { academicSchema: 2 }, { database: 'failed' }]) {
    assert.equal((await verifyRelease({ base: 'https://api.example.org', release: sha, fetcher: fixture(overrides) })).ok, false);
  }
  const html = (async () => new Response('<html>Old app</html>', { headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
  assert.equal((await verifyRelease({ base: 'https://api.example.org', release: sha, fetcher: html })).ok, false);
  for (const url of ['http://api.example.org', 'https://user:secret@api.example.org', 'https://api.example.org/path', 'https://api.example.org?token=secret']) assert.throws(() => apiOrigin(url));
});
