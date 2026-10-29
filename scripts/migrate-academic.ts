import { createClient } from '@libsql/client';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { setDb } from '../server/db';
import { initAcademicSchema } from '../server/academic/schema';
import { snapshot, commit, type Snapshot } from '../server/academic/store';
import { planLegacyMapping } from '../server/academic/legacy';
import { libsqlDatabase } from '../server/academic/libsql';

const args = process.argv.slice(2);
const database = args.find(a => a.startsWith('--database='))?.slice('--database='.length);
if (!database || !database.startsWith('file:') || database.includes(':memory:')) {
  throw new Error('Chỉ chạy với bản sao SQLite local: npm run academic:migrate -- --database=file:/path/copy.db [--apply]. Không đọc URL production từ môi trường.');
}
const file = resolve(database.slice(5));
if (!existsSync(file)) throw new Error('Bản sao database không tồn tại.');
const client = createClient({ url: `file:${file}` }); const databaseClient = libsqlDatabase(client); setDb(databaseClient);
const apply = args.includes('--apply');
try {
  const hasSchema = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='academic_meta'")).rows.length > 0;
  const initial: Snapshot = hasSchema ? await snapshot() : { revision: 0, semesters: [], classes: [], enrollments: [], quotas: [], lecturers: (await client.execute("SELECT id,name,COALESCE(email,'') email,COALESCE(work_unit,'') work_unit FROM lecturers")).rows as any };
  if (!apply) {
    // Read-only planning: even the additive schema is not created in dry-run mode.
    const plan = await planLegacyMapping(initial); console.log(JSON.stringify({ mode: 'dry-run', ...plan.summary }, null, 2));
  } else {
    const backup = `${file}.academic-backup-${Date.now()}`;
    await client.execute(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    await initAcademicSchema(databaseClient);
    const s = await snapshot(); const plan = await planLegacyMapping(s);
    await commit(s, 0, 'system.legacy.map', plan.changes, 'Ánh xạ từ bản sao SQLite; giữ nguyên bảng/file gốc.');
    console.log(JSON.stringify({ mode: 'applied', backup, ...plan.summary }, null, 2));
  }
} finally { client.close(); }
