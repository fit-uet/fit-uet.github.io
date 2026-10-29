// Execute the real schema/command trigger in Wrangler's isolated local D1.
// Every argument is --local with a temporary config and a dummy database ID.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createAcademicFixture } from '../tests/academic/fixture';
import { db } from '../server/db';
import { createClass, createSemester, updateClass } from '../server/academic/service';
import { commit, snapshot } from '../server/academic/store';
import { updateCampaign } from '../server/academic/campaigns';
import { newEnrollment, newSemester } from '../server/academic/domain';

const directory = await mkdtemp(join(tmpdir(), 'academic-d1-'));
const client = await createAcademicFixture();
const literal = (v: unknown) => v == null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const insert = (table: string, row: Record<string, unknown>) => `INSERT INTO "${table}"(${Object.keys(row).map(k => `"${k}"`).join(',')}) VALUES(${Object.values(row).map(literal).join(',')});`;
const wrangler = resolve('node_modules/.bin/wrangler'); const config = join(directory, 'wrangler.toml');
const exec = promisify(execFile);
const run = async (args: string[]) => {
  try { return JSON.parse((await exec(wrangler, ['d1', 'execute', 'ACADEMIC_DB', '--local', '--config', config, '--persist-to', join(directory, 'state'), '--json', ...args], { cwd: directory, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 2 * 1024 * 1024 })).stdout); }
  catch (e) { let detail = ''; try { detail = JSON.parse(e.stdout).error?.text || ''; } catch {} throw new Error(detail || e.message); }
};
try {
  const schema = (await db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END")).rows;
  const sql = schema.filter(r => r.type === 'table').map(r => `${r.sql};`);
  for (const t of schema.filter(r => r.type === 'table')) for (const row of (await db.execute(`SELECT * FROM "${t.name}"`)).rows) sql.push(insert(String(t.name), row));
  sql.push(...schema.filter(r => r.type !== 'table').map(r => `${r.sql};`));
  const admin = { id: 1, role: 'admin' as const, name: 'Khoa', email: 'admin@vnu.edu.vn' };
  const sem = await createSemester(admin, 2026, '1');
  const c = await createClass(admin, { semesterId: sem.id, courseCode: 'INT3132', section: '1' });
  const p = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!;
  await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'active' });
  const e = newEnrollment(c, { studentId: '24020001', name: 'D1 fixture' });
  await commit(await snapshot(), admin.id, 'admin.fixture', { enrollments: [e], users: [{ studentId: e.studentId, email: e.email, name: e.name, dob: '', className: '' }] });
  const commands = (await db.execute('SELECT * FROM academic_commands ORDER BY rowid')).rows;
  sql.push(...commands.map(row => insert('academic_commands', row)));
  await writeFile(config, 'name="academic-local-check"\ncompatibility_date="2026-10-01"\n[[d1_databases]]\nbinding="ACADEMIC_DB"\ndatabase_name="academic-local-check"\ndatabase_id="00000000-0000-0000-0000-000000000000"\n');
  const setup = join(directory, 'setup.sql'); await writeFile(setup, sql.join('\n')); await run(['--file', setup]);
  const inspect = async () => (await run(['--command', "SELECT (SELECT revision FROM academic_meta) revision,(SELECT count(*) FROM academic_enrollments) enrollments,(SELECT count(*) FROM academic_commands) commands,(SELECT count(*) FROM academic_semesters) semesters,(SELECT legacy_internship_access FROM users WHERE student_id='24020001') project_only"]))[0].results[0];
  const before = await inspect(); assert.deepEqual(before, { revision: 4, enrollments: 1, commands: 4, semesters: 1, project_only: 0 });
  await assert.rejects(run(['--command', insert('academic_commands', { ...commands.at(-1), id: 'stale-command-check' })]), e => /ACADEMIC_STALE/.test(String(e)));
  const payload = { semesters: [newSemester(2027, '1')], users: ['first', 'second'].map(name => ({ studentId: '24020002', email: `${name}@vnu.edu.vn`, name, dob: '', className: '' })) };
  await assert.rejects(run(['--command', insert('academic_commands', { ...commands.at(-1), id: 'atomic-rollback-check', expected_revision: 4, payload: JSON.stringify(payload) })]), e => /UNIQUE constraint failed.*users.student_id/i.test(String(e)));
  assert.deepEqual(await inspect(), before);
  await run(['--command', `INSERT INTO academic_messages(id,class_id,enrollment_id,lecturer_id,sender_id,body,created_at) VALUES('private',${literal(c.id)},${literal(e.id)},1,1,'Delete','now'); INSERT INTO academic_message_reads VALUES('private',1); INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at) VALUES('group',${literal(c.id)},1,1,'Keep','now');`]);
  const deletion = { deletedEnrollmentIds: [e.id], purgeCommands: [{id:commands.at(-1)!.id,paths:['$.enrollments[0]']}], cleanupFiles: [{id:'file',jobId:'delete-check',kind:'report',objectKey:'test/key'}], deletionJob: {id:'delete-check',campaignId:c.campaignId,enrollmentIds:[e.id]} };
  await run(['--command', insert('academic_commands', { ...commands.at(-1), id: 'delete-check', expected_revision: 4, action:'admin.project.delete',reason:'D1 local only',payload:JSON.stringify(deletion) })]);
  const removed=(await run(['--command',"SELECT (SELECT count(*) FROM academic_enrollments) enrollments,(SELECT count(*) FROM academic_messages WHERE enrollment_id IS NOT NULL) private,(SELECT count(*) FROM academic_messages WHERE enrollment_id IS NULL) groups,(SELECT count(*) FROM academic_message_reads) reads,(SELECT count(*) FROM academic_file_cleanup) files,(SELECT count(*) FROM academic_deletions) jobs"]))[0].results[0];
  assert.deepEqual(removed,{enrollments:0,private:0,groups:1,reads:0,files:1,jobs:1});
  const audit=(await run(['--command',`SELECT payload FROM academic_commands WHERE id=${literal(commands.at(-1)!.id)}`]))[0].results[0];assert.equal(JSON.parse(audit.payload).enrollments.length,0);
  const minimal=(await run(['--command',"SELECT payload FROM academic_commands WHERE id='delete-check'"]))[0].results[0];assert.deepEqual(JSON.parse(minimal.payload),{deletedEnrollmentIds:[e.id],jobId:'delete-check'});
  console.log('D1 local: schema, admissions, stale-command rejection, full rollback, scoped deletion and durable cleanup passed.');
} finally { client.close(); await rm(directory, { recursive: true, force: true }); }
