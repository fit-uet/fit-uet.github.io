import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { parse } from 'csv-parse/sync';
import { setDb } from '../db';
import { libsqlDatabase } from '../academic/libsql';
import { initAcademicSchema } from '../academic/schema';
import { commit, snapshot } from '../academic/store';
import { planLegacyMapping } from '../academic/legacy';
import { newSemester } from '../academic/domain';
import { planImport } from '../academic/imports';
import { initDb } from '../db/initDb';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
function tableSnapshot(database: DatabaseSync, columns?: Record<string, string[]>) {
  const tables = columns ? Object.keys(columns) : (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'academic_%'").all() as { name: string }[]).map(x => x.name);
  return Object.fromEntries(tables.map(name => {
    const fields = columns?.[name] || (database.prepare(`PRAGMA table_info(${quoted(name)})`).all() as { name: string }[]).map(x => x.name);
    const rows = database.prepare(`SELECT ${fields.map(quoted).join(',')} FROM ${quoted(name)}`).all().map(row => digest(JSON.stringify(row, (_k, v) => typeof v === 'bigint' ? v.toString() : v))).sort();
    return [name, { columns: fields, count: rows.length, hash: digest(rows.join('\n')), rows }];
  }));
}

export async function prepareStagingCopy(input: { source: string; outputRoot?: string; workbook?: string; lecturers?: string; resolutions?: string }) {
  if (!input.source.startsWith('file:') || /:memory:|[?#\0]/.test(input.source)) throw new Error('Chỉ nhận --source=file:/path/database-copy.db có sẵn; không dùng kết nối remote từ môi trường.');
  const source = await realpath(resolve(input.source.slice(5)));
  if (!(await stat(source)).isFile()) throw new Error('Nguồn phải là file SQLite có sẵn.');
  const sourceHash = digest(await readFile(source));
  const root = resolve(input.outputRoot || '.staging'); await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'academic-')); await chmod(directory, 0o700);
  const baselinePath = join(directory, 'before.db'), databasePath = join(directory, 'staging.db');
  // SQLite backup API captures a consistent snapshot, including committed WAL data.
  const original = new DatabaseSync(source, { readOnly: true });
  try { await backup(original, baselinePath); } finally { original.close(); }
  await chmod(baselinePath, 0o600); await copyFile(baselinePath, databasePath, constants.COPYFILE_EXCL); await chmod(databasePath, 0o600);
  const baselineDb = new DatabaseSync(baselinePath, { readOnly: true });
  let before: ReturnType<typeof tableSnapshot>;
  try {
    const integrity = baselineDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error('Bản sao không đạt integrity_check.');
    before = tableSnapshot(baselineDb);
  } finally { baselineDb.close(); }
  // Rehearse the actual application startup migrations on the copy as well.
  const keys = ['DB_PROVIDER', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'FORCE_DB_INIT', 'NODE_ENV'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  process.env.DB_PROVIDER = 'turso'; process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
  process.env.TURSO_AUTH_TOKEN = ''; process.env.FORCE_DB_INIT = 'false'; process.env.NODE_ENV = 'test';
  try { await initDb(); } finally { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  // initDb owns its connection. Close it before opening the adapter used below.
  const database = await import('../db'); (database.db as any).close?.();
  const client = createClient({ url: `file:${databasePath}` }); setDb(libsqlDatabase(client));
  let seededLecturers = 0;
  try {
    await initAcademicSchema(libsqlDatabase(client));
    if (input.lecturers) {
      if (Number((await client.execute('SELECT count(*) n FROM lecturers')).rows[0].n)) throw new Error('Danh mục giảng viên đã có dữ liệu; không ghi đè bằng CSV trong diễn tập.');
      const rows = parse(await readFile(resolve(input.lecturers), 'utf8'), { bom: true, trim: true, skip_empty_lines: true }) as string[][];
      if (!rows.length || rows.some(r => !r[0] || !/^[^\s@]+@vnu\.edu\.vn$/i.test(r[1] || '') || r.length !== 3)) throw new Error('CSV giảng viên cần ba cột: tên, email VNU, đơn vị.');
      await client.batch(rows.map(row => ({ sql: 'INSERT INTO lecturers(name,email,work_unit) VALUES(?,?,?)', args: row })), 'write'); seededLecturers = rows.length;
    }
    const initial = await snapshot(); const legacy = await planLegacyMapping(initial);
    await commit(initial, 0, 'system.staging.legacy', legacy.changes, 'Diễn tập trên bản sao SQLite mới, không thay nguồn.');
    const rerun = await planLegacyMapping(await snapshot());
    let project: { summary: ReturnType<typeof planImport>['summary']; rows: ReturnType<typeof planImport>['rows']; classes: string[] } | null = null;
    if (input.workbook) {
      const s = await snapshot(); const semester = newSemester(2026, '1');
      if (!s.semesters.some(x => x.id === semester.id)) await commit(s, 0, 'system.staging.semester', { semesters: [semester] });
      const resolutions = input.resolutions ? JSON.parse(await readFile(resolve(input.resolutions), 'utf8')) : {};
      const p = planImport(await snapshot(), semester.id, await readFile(resolve(input.workbook)), resolutions);
      project = { summary: p.summary, rows: p.rows, classes: [...new Set(p.rows.filter(r => !r.excluded).map(r => r.classCode))].sort() };
      // Preview only: no project admission, no automatic lecturer mapping, no email.
      await writeFile(join(directory, 'import-preview.json'), JSON.stringify(project, null, 2), { mode: 0o600 });
    }
    const comparisonDb = new DatabaseSync(databasePath, { readOnly: true });
    let comparisons: { table: string; before: number; after: number; preserved: boolean; added: number }[];
    try {
      const after = tableSnapshot(comparisonDb, Object.fromEntries(Object.entries(before).map(([name, x]) => [name, x.columns])));
      comparisons = Object.entries(before).map(([table, old]) => {
        const additive = table === 'settings' || table === 'lecturers' && seededLecturers > 0;
        const counts = new Map<string, number>(); for (const hash of after[table].rows) counts.set(hash, (counts.get(hash) || 0) + 1);
        const retained = old.rows.every(hash => { const count = counts.get(hash) || 0; counts.set(hash, count - 1); return count > 0; });
        return { table, before: old.count, after: after[table].count, added: after[table].count - old.count, preserved: additive ? retained : old.hash === after[table].hash };
      });
    } finally { comparisonDb.close(); }
    const preserved = comparisons.every(x => x.preserved);
    const sourceUnchanged = digest(await readFile(source)) === sourceHash;
    const report = { generatedAt: new Date().toISOString(), runId: randomUUID(), sourceHash, sourceUnchanged, sourceStudents: legacy.summary.sourceStudents, sourceHasInternshipData: legacy.summary.sourceStudents > 0 || ['advisor_assignments', 'final_reports', 'grades'].some(t => (before[t]?.count || 0) > 0), legacy: legacy.summary, rerunCreated: rerun.summary.created, preserved, seededLecturers, comparisons, project: project ? { summary: project.summary, classes: project.classes } : null, databasePath, baselinePath };
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await writeFile(join(directory, 'REPORT.md'), `# Diễn tập chuyển học vụ\n\n- Nguồn mở chỉ đọc; file nguồn ${sourceUnchanged ? 'giữ nguyên SHA-256' : 'đã thay đổi bởi tiến trình khác trong lúc chạy; cần chạy lại từ bản sao tĩnh'}.\n- ${comparisons.length} bảng nguồn được đối soát: ${preserved ? 'đạt' : 'CÓ SAI KHÁC'}.\n- ${legacy.summary.created} hồ sơ TT ánh xạ; ${legacy.summary.blocked.length} hồ sơ cần đối soát; chạy lại tạo ${rerun.summary.created}.\n- ${seededLecturers} GV được thêm vào danh mục bản sao từ CSV được chỉ định.\n- ${report.sourceHasInternshipData ? 'Có dữ liệu nguồn để diễn tập; xem report.json để đối soát từng bảng.' : 'Nguồn local trống: chưa chứng minh bảo toàn hồ sơ Thực tập production.'}\n${project ? `- Import chỉ xem trước: ${project.summary.rows} dòng, ${project.summary.errors} nhóm lỗi; chưa tiếp nhận sinh viên Dự án.\n` : ''}\nChi tiết và dữ liệu đối soát nằm trong report.json/import-preview.json tại thư mục riêng này. Chưa gọi OAuth, R2, email hoặc database remote.\n`, { mode: 0o600 });
    if (!preserved || !sourceUnchanged || rerun.summary.created) throw new Error(`Đối soát chưa đạt; xem báo cáo tại ${directory}.`);
    return { directory, ...report };
  } finally { client.close(); }
}
