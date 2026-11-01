import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Client, InStatement} from '@libsql/client';

const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_'";
type SchemaObject = {type: string; name: string; tbl_name: string; sql: string};
type Table = {name: string; columns: string[]; rows: any[][]};
function value(v: any): any {
  if (v instanceof ArrayBuffer) return ['blob', Buffer.from(v).toString('hex')];
  if (v instanceof Uint8Array) return ['blob', Buffer.from(v).toString('hex')];
  if (typeof v === 'bigint') return ['number', String(v)];
  if (typeof v === 'number') return ['number', String(v)];
  return v;
}
const hashRows = (rows: any[][]) => createHash('sha256').update(rows.map(r => JSON.stringify(r.map(value))).sort().join('\n')).digest('hex');
function describe(source: DatabaseSync) {
  if (source.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw Error('SOURCE_INTEGRITY');
  const objects = source.prepare(schemaSql + ' ORDER BY type,name').all() as SchemaObject[];
  if (objects.some(o => /CREATE\s+VIRTUAL\s+TABLE/i.test(o.sql))) throw Error('UNSUPPORTED_VIRTUAL_TABLE');
  const tables: Table[] = objects.filter(o => o.type === 'table').map(o => {
    const columns = source.prepare('PRAGMA table_info(' + quote(o.name) + ')').all().map(r => String(r.name));
    const statement = source.prepare('SELECT ' + columns.map(quote).join(',') + ' FROM ' + quote(o.name));
    statement.setReadBigInts(true);
    const rows = statement.all().map(r => columns.map(c => r[c]));
    return {name: o.name, columns, rows};
  });
  const pending = new Set(tables.map(t => t.name)), order: string[] = [];
  while (pending.size) {
    let changed = false;
    for (const name of pending) {
      const parents = source.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all().map(r => String(r.table)).filter(p => p !== name);
      if (parents.some(p => pending.has(p))) continue;
      order.push(name); pending.delete(name); changed = true;
    }
    if (!changed) throw Error('FOREIGN_KEY_CYCLE');
  }
  const hasSequence = !!source.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get();
  const sequenceStatement = hasSequence ? source.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name') : null;
  sequenceStatement?.setReadBigInts(true);
  const sequence = sequenceStatement?.all().map(r => [r.name, r.seq]) || [];
  return {objects, tables, order, sequence, hasSequence};
}
export async function verifyLibsqlCopy(source: DatabaseSync, target: Pick<Client, 'execute'>) {
  const plan = describe(source);
  const actualSchema = (await target.execute(schemaSql + ' ORDER BY type,name')).rows;
  const schemaFields = ['type', 'name', 'tbl_name', 'sql'];
  if (hashRows(actualSchema.map(r => schemaFields.map(c => r[c]))) !== hashRows(plan.objects.map(r => schemaFields.map(c => r[c])))) throw Error('SCHEMA_MISMATCH');
  const tables = [];
  for (const table of plan.tables) {
    const actual: any[][] = [];
    // Audit/preview payloads can approach the per-response limit individually.
    const limit = ['academic_commands', 'academic_previews'].includes(table.name) ? 1 : 250;
    const fields = table.columns.map(quote).join(',');
    for (let offset = 0;; offset += limit) {
      const rows = (await target.execute('SELECT ' + fields + ' FROM ' + quote(table.name) + ' ORDER BY ' + fields + ' LIMIT ' + limit + ' OFFSET ' + offset)).rows;
      actual.push(...rows.map(r => table.columns.map(c => r[c])));
      if (rows.length < limit) break;
    }
    const sha256 = hashRows(actual);
    if (actual.length !== table.rows.length || sha256 !== hashRows(table.rows)) throw Error('DATA_MISMATCH:' + table.name);
    tables.push({name: table.name, rows: actual.length, sha256});
  }
  const hasSequence = (await target.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'")).rows.length;
  const sequence = hasSequence ? (await target.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name')).rows.map(r => [r.name, r.seq]) : [];
  if (hashRows(sequence) !== hashRows(plan.sequence)) throw Error('SEQUENCE_MISMATCH');
  if ((await target.execute('PRAGMA foreign_key_check')).rows.length) throw Error('TARGET_FOREIGN_KEYS');
  return {tables, rows: tables.reduce((n, t) => n + t.rows, 0), integrity: 'ok', foreignKeyIssues: 0};
}
const payloadBytes = (s: InStatement) => Buffer.byteLength(JSON.stringify(s, (_k, v) => typeof v === 'bigint' ? String(v) : v));
async function upload(target: Client, table: Table, name: string) {
  const prefix = 'INSERT INTO ' + quote(name) + '(' + table.columns.map(quote).join(',') + ') VALUES ';
  let rows: any[][] = [], bytes = 0;
  const flush = async () => {
    if (!rows.length) return;
    const stmt = {sql: prefix + rows.map(r => '(' + r.map(() => '?').join(',') + ')').join(','), args: rows.flat()};
    await target.execute(stmt); rows = []; bytes = 0;
  };
  for (const row of table.rows) {
    const n = payloadBytes({sql: '', args: row});
    if (rows.length && (bytes + n > 400_000 || (rows.length + 1) * table.columns.length > 900)) await flush();
    rows.push(row); bytes += n;
  }
  await flush();
}
function identical(a: string, b: string, columns: string[]) {
  const fields = columns.map(quote).join(',');
  const grouped = (name: string) => 'SELECT ' + fields + ',count(*) FROM ' + quote(name) + ' GROUP BY ' + fields;
  return '(SELECT count(*) FROM ' + quote(a) + ')=(SELECT count(*) FROM ' + quote(b) + ')'
    + ' AND NOT EXISTS(' + grouped(a) + ' EXCEPT ' + grouped(b) + ')'
    + ' AND NOT EXISTS(' + grouped(b) + ' EXCEPT ' + grouped(a) + ')';
}
// Upload into isolated, unreferenced staging tables, then perform one short
// atomic batch. This avoids holding an interactive write transaction across
// network roundtrips or replaying historic command triggers during import.
// Every old row and schema object is checked again inside the same transaction.
export async function restoreLibsql(source: DatabaseSync, expectedTarget: DatabaseSync, target: Client, progress = (_message: string) => {}) {
  const plan = describe(source), before = describe(expectedTarget);
  const prefix = 'turso_return_' + randomUUID().replace(/-/g, '') + '_';
  const staged: string[] = [];
  const stage = async (table: Table) => {
    const name = prefix + staged.length; staged.push(name);
    await target.execute('CREATE TABLE ' + quote(name) + '(' + table.columns.map(quote).join(',') + ')');
    await upload(target, table, name);
    return name;
  };
  try {
    const old = new Map<string, string>(), incoming = new Map<string, string>();
    const schemaColumns = ['type', 'name', 'tbl_name', 'sql'];
    const oldSchema = await stage({name: '', columns: schemaColumns, rows: before.objects.map(r => schemaColumns.map(c => r[c]))});
    const oldSequence = await stage({name: '', columns: ['name', 'seq'], rows: before.sequence});
    for (const t of before.tables) {old.set(t.name, await stage(t)); progress('Staged backup guard: ' + t.name);}
    for (const t of plan.tables) {incoming.set(t.name, await stage(t)); progress('Staged incoming: ' + t.name);}
    const guard = quote(prefix + 'guard'), statements: InStatement[] = [
      'PRAGMA defer_foreign_keys=ON',
      'CREATE TEMP TABLE ' + guard + '(ok INTEGER NOT NULL CHECK(ok=1))',
    ];
    const assert = (condition: string) => statements.push('INSERT INTO ' + guard + '(ok) SELECT CASE WHEN ' + condition + ' THEN 1 ELSE 0 END');
    const currentSchema = '(' + schemaSql + " AND substr(name,1," + prefix.length + ")!='" + prefix + "')";
    const fields = schemaColumns.map(quote).join(',');
    assert('NOT EXISTS(SELECT ' + fields + ' FROM ' + currentSchema + ' EXCEPT SELECT ' + fields + ' FROM ' + quote(oldSchema) + ') AND NOT EXISTS(SELECT ' + fields + ' FROM ' + quote(oldSchema) + ' EXCEPT SELECT ' + fields + ' FROM ' + currentSchema + ')');
    for (const t of before.tables) assert(identical(t.name, old.get(t.name)!, t.columns));
    if (before.hasSequence) assert(identical('sqlite_sequence', oldSequence, ['name', 'seq']));
    for (const o of before.objects.filter(o => ['trigger', 'view'].includes(o.type))) statements.push('DROP ' + o.type.toUpperCase() + ' ' + quote(o.name));
    for (const name of [...before.order].reverse()) statements.push('DROP TABLE ' + quote(name));
    for (const o of plan.objects.filter(o => o.type === 'table')) statements.push(o.sql);
    for (const name of plan.order) {
      const t = plan.tables.find(t => t.name === name)!, columns = t.columns.map(quote).join(',');
      statements.push('INSERT INTO ' + quote(name) + '(' + columns + ') SELECT ' + columns + ' FROM ' + quote(incoming.get(name)!));
    }
    if (plan.sequence.length) {
      statements.push('DELETE FROM sqlite_sequence');
      for (const row of plan.sequence) statements.push({sql: 'INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)', args: row});
    }
    for (const o of plan.objects.filter(o => o.type !== 'table')) statements.push(o.sql);
    for (const t of plan.tables) assert(identical(t.name, incoming.get(t.name)!, t.columns));
    assert('NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)');
    for (const name of staged) statements.push('DROP TABLE ' + quote(name));
    statements.push('DROP TABLE ' + guard);
    progress('Applying atomic guarded replacement.');
    await target.batch(statements, 'write');
    progress('Verifying all restored rows, schema and sequences.');
    return await verifyLibsqlCopy(source, target);
  } finally {
    // On a failed batch the original schema/data remains intact. Only our
    // uniquely named staging tables are disposable; never drop user tables here.
    for (let i = 0; i < staged.length; i += 15) await target.batch(staged.slice(i, i + 15).map(name => 'DROP TABLE IF EXISTS ' + quote(name)), 'write');
  }
}
