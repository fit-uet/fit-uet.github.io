import type { Client } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

// All remote reads share one read transaction. Restore into a new local file;
// never execute migrations, writes, or restore statements against the source.
export async function backupLibsql(client: Client, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // Exclusive creation also prevents replacing an earlier backup by accident.
  await writeFile(destination, '', { flag: 'wx', mode: 0o600 });
  let local: DatabaseSync | undefined;
  let transaction: Awaited<ReturnType<Client['transaction']>> | undefined;
  try {
    transaction = await client.transaction('read');
    const schema = (await transaction.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")).rows;
    const tables = schema.filter(row => row.type === 'table');
    local = new DatabaseSync(destination);
    local.exec('PRAGMA foreign_keys=OFF; BEGIN');
    const counts: Record<string, number> = {};
    const fingerprints: Record<string, string> = {};
    for (const table of tables) local.exec(String(table.sql));
    for (const table of tables) {
      const name = String(table.name);
      const columns = (await transaction.execute(`PRAGMA table_info(${quote(name)})`)).rows.map(row => String(row.name));
      const fields = columns.map(quote).join(',');
      const insert = local.prepare(`INSERT INTO ${quote(name)}(${fields}) VALUES(${columns.map(() => '?').join(',')})`);
      const hash = createHash('sha256');
      let offset = 0;
      while (true) {
        const rows = (await transaction.execute(`SELECT ${fields} FROM ${quote(name)} LIMIT 500 OFFSET ${offset}`)).rows;
        for (const row of rows) {
          const values = columns.map(column => row[column]);
          insert.run(...values.map(value => value instanceof ArrayBuffer ? Buffer.from(value) : value));
          hash.update(JSON.stringify(values, (_key, value) => typeof value === 'bigint' ? value.toString() : value instanceof ArrayBuffer ? { hex: Buffer.from(value).toString('hex') } : value) + '\n');
        }
        offset += rows.length;
        if (rows.length < 500) break;
      }
      counts[name] = offset;
      fingerprints[name] = hash.digest('hex');
      if (Number(local.prepare(`SELECT count(*) n FROM ${quote(name)}`).get()!.n) !== offset) throw new Error('BACKUP_ROW_COUNT');
    }
    const sequenceExists = (await transaction.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'")).rows.length;
    if (sequenceExists) {
      const sequence = (await transaction.execute('SELECT name,seq FROM sqlite_sequence')).rows;
      local.exec('DELETE FROM sqlite_sequence');
      const insert = local.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)');
      for (const row of sequence) insert.run(String(row.name), row.seq as number);
    }
    // Indexes, triggers, and views are restored after data so triggers cannot
    // duplicate side effects while rebuilding the backup.
    for (const object of schema.filter(row => row.type !== 'table')) local.exec(String(object.sql));
    local.exec('COMMIT');
    const integrity = local.prepare('PRAGMA integrity_check').get()!.integrity_check;
    if (integrity !== 'ok') throw new Error('BACKUP_INTEGRITY');
    const foreignKeyIssues = local.prepare('PRAGMA foreign_key_check').all().length;
    await transaction.rollback();
    local.close(); local = undefined;
    await chmod(destination, 0o600);
    return { generatedAt: new Date().toISOString(), destination, integrity, foreignKeyIssues, counts, fingerprints };
  } catch (error) {
    try { await transaction?.rollback(); } catch { /* retain the original failure */ }
    local?.close(); local = undefined;
    await rm(destination, { force: true });
    throw error;
  } finally { transaction?.close(); }
}
