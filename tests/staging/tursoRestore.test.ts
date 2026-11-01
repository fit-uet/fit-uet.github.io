import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createClient} from '@libsql/client';
import {restoreLibsql, verifyLibsqlCopy} from '../../scripts/deployment/tursoRestore';

function fixture() {
  const source = new DatabaseSync(':memory:'), before = new DatabaseSync(':memory:');
  before.exec("CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT); CREATE TABLE audit(value TEXT); CREATE TABLE child(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id)); CREATE TRIGGER trace AFTER INSERT ON users BEGIN INSERT INTO audit VALUES(NEW.name); END; INSERT INTO users VALUES(1,'Old'); INSERT INTO child VALUES(1,1);");
  source.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,payload BLOB); CREATE TABLE audit(value TEXT); CREATE TABLE child(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id)); CREATE TABLE newer(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO users VALUES(2,'Tên có dấu',X'0001ff'); INSERT INTO child VALUES(2,2); INSERT INTO audit VALUES('Preserved history'); UPDATE sqlite_sequence SET seq=999 WHERE name='users'; CREATE VIEW names AS SELECT name FROM users; CREATE INDEX by_name ON users(name); CREATE TRIGGER trace AFTER INSERT ON users BEGIN INSERT INTO audit VALUES(NEW.name); END;");
  source.prepare('INSERT INTO newer VALUES(?,?)').run(1,"Đề tài? ' Unicode\n".repeat(50000));
  return {source, before};
}
async function targetFor(before: DatabaseSync) {
  const target = createClient({url: 'file::memory:', intMode: 'bigint'});
  // Seed the original target using the same DDL, with historical side effects preserved.
  await target.executeMultiple("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT); CREATE TABLE audit(value TEXT); CREATE TABLE child(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id)); CREATE TRIGGER trace AFTER INSERT ON users BEGIN INSERT INTO audit VALUES(NEW.name); END; INSERT INTO users VALUES(1,'Old'); INSERT INTO child VALUES(1,1);");
  await verifyLibsqlCopy(before, target);
  return target;
}
test('Turso replacement preserves rows, new schema, long values, blobs and sequences without replaying triggers', async () => {
  const {source, before} = fixture(), target = await targetFor(before);
  try {
    const result = await restoreLibsql(source, before, target);
    assert.equal(result.rows, 4);
    assert.equal((await target.execute('SELECT name FROM names')).rows[0].name, 'Tên có dấu');
    assert.equal((await target.execute('SELECT count(*) n FROM audit')).rows[0].n, 1n);
    await target.execute("INSERT INTO users(name) VALUES('New')");
    assert.equal((await target.execute("SELECT id FROM users WHERE name='New'")).rows[0].id, 1000n);
    assert.equal((await target.execute('SELECT count(*) n FROM audit')).rows[0].n, 2n);
    assert.equal((await target.execute("SELECT name FROM sqlite_master WHERE name GLOB 'turso_return_*'")).rows.length, 0);
  } finally {source.close(); before.close(); target.close();}
});
test('a late SQL failure rolls back table drops, replacement rows and DDL to the complete original target', async () => {
  const {source, before} = fixture(), target = await targetFor(before);
  const original = target.batch.bind(target);
  target.batch = async (statements, mode) => {
    if (statements.some(s => typeof s === 'string' && s.startsWith('CREATE TEMP TABLE '))) {
      const copy = [...statements]; copy.splice(copy.length - 1, 0, 'INSERT INTO definitely_missing_table VALUES(1)');
      return original(copy, mode);
    }
    return original(statements, mode);
  };
  try {
    await assert.rejects(restoreLibsql(source, before, target), /missing_table/);
    await verifyLibsqlCopy(before, target);
    assert.equal((await target.execute("SELECT name FROM sqlite_master WHERE name GLOB 'turso_return_*'")).rows.length, 0);
    await target.execute("INSERT INTO users(name) VALUES('Still original')");
    assert.equal((await target.execute('SELECT count(*) n FROM audit')).rows[0].n, 2n);
  } finally {source.close(); before.close(); target.close();}
});
test('transaction-time guards reject target changes after backup and preserve concurrent writes and high-water IDs', async () => {
  const {source, before} = fixture(), target = await targetFor(before);
  try {
    await target.execute("UPDATE users SET name='Concurrent change' WHERE id=1");
    await target.execute("UPDATE sqlite_sequence SET seq=5000 WHERE name='users'");
    await assert.rejects(restoreLibsql(source, before, target), /CHECK/);
    assert.equal((await target.execute('SELECT name FROM users')).rows[0].name, 'Concurrent change');
    assert.equal((await target.execute("SELECT seq FROM sqlite_sequence WHERE name='users'")).rows[0].seq, 5000n);
    assert.equal((await target.execute("SELECT name FROM sqlite_master WHERE name='newer'")).rows.length, 0);
  } finally {source.close(); before.close(); target.close();}
});

test('guards detect changed duplicate multiplicities even when row counts and distinct values are unchanged', async () => {
  const {source, before} = fixture(), target = await targetFor(before);
  try {
    before.exec("INSERT INTO audit VALUES('A'),('A'),('B')");
    await target.execute("INSERT INTO audit VALUES('A'),('B'),('B')");
    await assert.rejects(restoreLibsql(source, before, target), /CHECK/);
    assert.equal((await target.execute("SELECT count(*) n FROM audit WHERE value='B'")).rows[0].n, 2n);
  } finally {source.close(); before.close(); target.close();}
});
