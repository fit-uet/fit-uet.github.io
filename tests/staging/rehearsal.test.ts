import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../../server/db/initDb';
import { db } from '../../server/db';
import { prepareStagingCopy } from '../../server/staging/rehearsal';

let directory: string; let source: string; let previous: Record<string, string | undefined>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stage-rehearsal-test-')); source = join(directory, 'source.db');
  const values = { DB_PROVIDER: 'turso', TURSO_DATABASE_URL: `file:${source}`, TURSO_AUTH_TOKEN: '', FORCE_DB_INIT: 'false', NODE_ENV: 'test' };
  previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]])); Object.assign(process.env, values);
  await initDb();
  await db.executeMultiple(`INSERT INTO lecturers(id,name,email,work_unit) VALUES(1,'TS. Test','test@vnu.edu.vn','BM A');
    INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(20,'22020001@vnu.edu.vn','SV kiểm thử','student','22020001','INT4002');
    INSERT INTO advisor_assignments(user_id,lecturer_id,role) VALUES(20,1,'primary');
    INSERT INTO grades(user_id,lecturer_id,progress_score,report_score,company_score,final_score) VALUES(20,1,8,8,8,8);
    INSERT INTO final_reports(user_id,object_key,original_filename,file_size,mime_type) VALUES(20,'reports/2026/22020001/final.pdf','test.pdf',42,'application/pdf');`);
  (db as any).close();
});
afterEach(async () => { (db as any).close?.(); for (const key in previous) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; await rm(directory, { recursive: true, force: true }); });

test('a real startup rehearsal preserves every original row, grade, assignment and PDF reference', async () => {
  const original = await readFile(source);
  const report = await prepareStagingCopy({ source: `file:${source}`, outputRoot: join(directory, 'copies') });
  assert.equal(report.sourceUnchanged, true); assert.equal(report.preserved, true); assert.equal(report.sourceHasInternshipData, true);
  assert.equal(report.legacy.created, 1); assert.equal(report.rerunCreated, 0); assert.ok(report.comparisons.every(t => t.preserved));
  assert.deepEqual(await readFile(source), original);
  const target = new DatabaseSync(report.databasePath, { readOnly: true });
  try { assert.equal(target.prepare('SELECT final_score FROM grades').get()!.final_score, 8); assert.equal(target.prepare('SELECT object_key FROM final_reports').get()!.object_key, 'reports/2026/22020001/final.pdf'); assert.equal(target.prepare('SELECT count(*) n FROM academic_enrollments').get()!.n, 1); }
  finally { target.close(); }
});
test('the backup captures committed WAL rows rather than copying only the main SQLite file', async () => {
  const live = new DatabaseSync(source); live.exec("PRAGMA journal_mode=WAL; INSERT INTO users(email,name,role,student_id,course_code) VALUES('22020002@vnu.edu.vn','SV trong WAL','student','22020002','INT3508')");
  try {
    const report = await prepareStagingCopy({ source: `file:${source}`, outputRoot: join(directory, 'copies') });
    assert.equal(report.legacy.created, 2); assert.equal(report.comparisons.find(t => t.table === 'users')!.before, 2);
    assert.equal(report.sourceUnchanged, true);
  } finally { live.close(); }
});
test('startup and mapping preserve historical score precision without rewriting saved grades', async () => {
  const original = new DatabaseSync(source); original.exec('UPDATE grades SET final_score=7.999'); original.close(); const bytes = await readFile(source);
  const report = await prepareStagingCopy({ source: `file:${source}`, outputRoot: join(directory, 'copies') });
  assert.equal(report.comparisons.find(t => t.table === 'grades')!.preserved, true);
  assert.deepEqual(await readFile(source), bytes);
  const target = new DatabaseSync(report.databasePath, { readOnly: true });
  try { assert.equal(target.prepare('SELECT final_score FROM grades').get()!.final_score, 7.999); }
  finally { target.close(); }
});
test('remote and missing sources are rejected without creating or modifying a source database', async () => {
  await assert.rejects(prepareStagingCopy({ source: 'libsql://production.invalid' }), /Chỉ nhận/);
  await assert.rejects(prepareStagingCopy({ source: `file:${join(directory, 'missing.db')}` }), /ENOENT/);
});
