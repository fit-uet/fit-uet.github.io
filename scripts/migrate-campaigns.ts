import { DatabaseSync, backup } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setDb } from '../server/db';
import { initAcademicSchema } from '../server/academic/schema';
import { libsqlDatabase } from '../server/academic/libsql';
import { campaignMigrationPreview, applyCampaignMigration } from '../server/academic/campaigns';

const args = process.argv.slice(2), option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const url = option('database');
if (!url?.startsWith('file:') || /:memory:|[?#\0]/.test(url)) throw new Error('Chỉ nhận bản sao SQLite local: npm run academic:campaign-migrate -- --database=file:/path/copy.db [--resolutions=/path/choices.json] [--apply]. Dừng server ghi vào bản sao trước --apply.');
const source = await realpath(resolve(url.slice(5))); const apply = args.includes('--apply');
const directory = await mkdtemp(join(tmpdir(), 'campaign-migration-'));
const backupPath = apply ? `${source}.campaign-backup-${Date.now()}` : join(directory, 'preview.db');
const readonly = new DatabaseSync(source, { readOnly: true }); try { await backup(readonly, backupPath); } finally { readonly.close(); }
const client = createClient({ url: `file:${apply ? source : backupPath}` }); setDb(libsqlDatabase(client));
try {
  await initAcademicSchema(libsqlDatabase(client));
  const resolutions = option('resolutions') ? JSON.parse(await readFile(resolve(option('resolutions')!), 'utf8')) : {};
  const actor = { id: 0, email: 'local-migration@local.invalid', role: 'admin' as const, name: 'Migration local' };
  const preview = await campaignMigrationPreview(actor, resolutions);
  const summary = { mode: apply ? 'apply' : 'dry-run', backup: apply ? backupPath : undefined, created: preview.created, groups: preview.rows.map(r => ({ id: r.id, issues: r.issues, classes: r.sources.map(c => ({ id: c.id, code: c.code, status: c.status, settings: c.settings })) })) };
  if (apply) console.log(JSON.stringify({ ...summary, result: await applyCampaignMigration(actor, preview.id, true) }, null, 2));
  else console.log(JSON.stringify(summary, null, 2));
} finally { client.close(); await rm(directory, { recursive: true, force: true }); }
