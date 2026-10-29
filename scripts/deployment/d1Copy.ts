import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {DatabaseClient} from '../../server/types';
const quote=(value:string)=>'"'+value.replace(/"/g,'""')+'"';
const canonical=(values:unknown[])=>JSON.stringify(values.map(v=>v instanceof ArrayBuffer?Array.from(new Uint8Array(v)):v instanceof Uint8Array?Array.from(v):v));
const literal=(value:any):string=>value==null?'NULL':typeof value==='number'||typeof value==='bigint'?String(value):value instanceof Uint8Array?`X'${Buffer.from(value).toString('hex')}'`:String(value).includes('\0')?`CAST(X'${Buffer.from(String(value)).toString('hex')}' AS TEXT)`:`'${String(value).replace(/'/g,"''")}'`;
export async function copySqliteToD1(source:DatabaseSync,target:DatabaseClient,apply=false,progress=(message:string)=>{}){
 const objects=source.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as any[];
 const names=objects.filter(o=>o.type==='table').map(o=>String(o.name));
 if(source.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok'||source.prepare('PRAGMA foreign_key_check').all().length)throw Error('SOURCE_INTEGRITY');
 const pending=new Set(names),order:string[]=[];
 while(pending.size){let changed=false;for(const name of pending){const parents=source.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all().map(r=>String(r.table)).filter(p=>p!==name);if(parents.some(p=>pending.has(p)))continue;order.push(name);pending.delete(name);changed=true;}if(!changed)throw Error('FOREIGN_KEY_CYCLE');}
 const plan=order.map(name=>{const info=source.prepare(`PRAGMA table_info(${quote(name)})`).all();const columns=info.map(r=>String(r.name));const pk=info.filter(r=>Number(r.pk)).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(r=>String(r.name));const sort=(pk.length?pk:columns).map(quote).join(',');const rows=source.prepare(`SELECT ${columns.map(quote)} FROM ${quote(name)} ORDER BY ${sort}`).all().map(r=>columns.map(c=>r[c]));for(const row of rows)if(Buffer.byteLength(canonical(row))>1_900_000)throw Error('ROW_TOO_LARGE:'+name);return{name,columns,sort,rows};});
 const summary={tables:plan.map(t=>({name:t.name,rows:t.rows.length})),rows:plan.reduce((n,t)=>n+t.rows.length,0)};
 if(!apply)return summary;
 const existing=(await target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")).rows;
 if(existing.length)throw Error('TARGET_NOT_EMPTY: refusing to overwrite an existing database');
 for(const o of objects.filter(o=>o.type==='table'))await target.execute(String(o.sql));
 for(const table of plan){
  const prefix=`INSERT INTO ${quote(table.name)}(${table.columns.map(quote)}) VALUES `;const statements:{sql:string;args?:any[]}[]=[];let tuples:string[]=[],bytes=Buffer.byteLength(prefix);
  const flush=()=>{if(tuples.length){statements.push({sql:prefix+tuples.join(',')});tuples=[];bytes=Buffer.byteLength(prefix);}};
  for(const row of table.rows){const tuple='('+row.map(literal).join(',')+')',size=Buffer.byteLength(tuple)+1;if(size+Buffer.byteLength(prefix)>80_000){flush();statements.push({sql:prefix+'('+row.map(()=>'?').join(',')+')',args:row});}else{if(bytes+size>80_000)flush();tuples.push(tuple);bytes+=size;}}
  flush();
  for(let i=0;i<statements.length;i+=3){const outcomes=await Promise.allSettled(statements.slice(i,i+3).map(s=>target.execute(s)));for(const result of outcomes)if(result.status==='rejected')throw result.reason;}
  progress(`${table.name}: ${table.rows.length}`);
 }
 // Explicit IDs do not preserve sequences above MAX(id), so restore counters too.
 if(source.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get())for(const row of source.prepare('SELECT name,seq FROM sqlite_sequence').all()){await target.execute({sql:'DELETE FROM sqlite_sequence WHERE name=?',args:[row.name]});await target.execute({sql:'INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)',args:[row.name,row.seq]});}
 // Triggers are restored last: historical academic commands must never replay.
 for(const o of objects.filter(o=>o.type==='index'||o.type==='view'||o.type==='trigger'))await target.execute(String(o.sql));
 const verification=[];
 for(const table of plan){const actualHash=createHash('sha256'),expectedHash=createHash('sha256');for(const row of table.rows)expectedHash.update(canonical(row)+'\n');let count=0;
  const limit=table.name==='academic_commands'?1:100;
  for(let offset=0;;offset+=limit){const rows=(await target.execute(`SELECT ${table.columns.map(quote)} FROM ${quote(table.name)} ORDER BY ${table.sort} LIMIT ${limit} OFFSET ${offset}`)).rows;for(const row of rows){actualHash.update(canonical(table.columns.map(c=>row[c]))+'\n');count++;}if(rows.length<limit)break;}
  const expected=expectedHash.digest('hex'),actual=actualHash.digest('hex');if(count!==table.rows.length||expected!==actual)throw Error('DATA_MISMATCH:'+table.name);verification.push({table:table.name,rows:count,sha256:actual});
 }
 if((await target.execute('PRAGMA foreign_key_check')).rows.length)throw Error('TARGET_FOREIGN_KEYS');
 const sequenceSource=source.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all();const sequenceTarget=(await target.execute('SELECT name,seq FROM sqlite_sequence ORDER BY name')).rows;
 if(JSON.stringify(sequenceSource)!==JSON.stringify(sequenceTarget))throw Error('SEQUENCE_MISMATCH');
 progress('All data and sequences verified.');return{...summary,verification,foreignKeyIssues:0};
}
