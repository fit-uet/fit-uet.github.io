// Read-only source -> disposable workerd D1 copy. No production credentials,
// notification bodies, student IDs or account emails appear in the report.
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,readdir,rm,chmod,writeFile,realpath,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {transform} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

async function main(){
 const arg=(key:string)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3);
 const input=arg('database');if(!input||/^[a-z]+:\/\//i.test(input))throw Error('Use --database=/path/verified.db [--baseline-ref=commit] [--output=report.json]. Local files only.');
 const path=await realpath(resolve(input));if(!(await stat(path)).isFile())throw Error('A local SQLite backup is required.');
 const directory=await mkdtemp(join(tmpdir(),'unread-cost-'));await chmod(directory,0o700);
 const source=new DatabaseSync(path,{readOnly:true});let mf:Miniflare|undefined;
 try{
  const actors=['admin','lecturer','student'].map(role=>source.prepare('SELECT * FROM users WHERE role=? LIMIT 1').get(role));
  if(actors.some(a=>!a))throw Error('The source needs an administrator, lecturer and student.');
  const options=convertV4MiniflareOptions({modules:true,script:'export default{fetch(){return new Response("local profile");}}',d1Databases:{DB:'local-unread-cost'}});options.resourcePersistencePath=join(directory,'state');
  mf=new Miniflare(options);await(await mf.getD1Database('DB')).prepare('SELECT 1').all();await mf.dispose();mf=undefined;
  async function files(path:string):Promise<string[]>{return(await Promise.all((await readdir(path,{withFileTypes:true})).map(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)]))).flat();}
  const file=(await files(options.resourcePersistencePath)).find(p=>p.includes('D1DatabaseObject')&&p.endsWith('.sqlite')&&!p.endsWith('metadata.sqlite'))!;
  if(!file)throw Error('Local D1 storage was not initialized.');
  await rm(file);await rm(file+'-wal',{force:true});await rm(file+'-shm',{force:true});await backup(source,file);
  mf=new Miniflare(options);const local=await mf.getD1Database('DB');
  await local.prepare("CREATE INDEX IF NOT EXISTS academic_enrollment_email ON academic_enrollments(lower(json_extract(data,'$.email')))").all();
  const {setDb}=await import('../server/db'),current=await import('../server/services/unread');let metrics:any[]=[];
  setDb({execute:async(input:any)=>{
   const sql=typeof input==='string'?input:input.sql,args=typeof input==='string'?[]:input.args||[];
   if(!/^\s*(SELECT|WITH|EXPLAIN)/i.test(sql))throw Error('Profile attempted a write through a reader.');
   const result=await local.prepare(sql).bind(...args).all();metrics.push(result.meta);return{rows:result.results};
  }}as any);
  const versions:Array<[string,typeof current]>=[],baseline=arg('baseline-ref');
  if(baseline){
   let code=execFileSync('git',['show',`${baseline}:server/services/unread.ts`],{encoding:'utf8'});
   code=(await transform(code,{loader:'ts',format:'esm',target:'es2022'})).code.replace(/from\s*(["'])(\.[^"']+)\1/g,(_whole,_q,p)=>{let full=resolve('server/services',p);if(existsSync(full+'.ts'))full+='.ts';return 'from '+JSON.stringify(pathToFileURL(full).href);});
   versions.push(['baseline',await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))]);
  }
  versions.push(['current',current]);
  const output:any[]=[],results=new Map<string,unknown>();
  const measure=async(version:string,reader:typeof current,actor:any,operation:string)=>{
   metrics=[];const value=await reader.unreadCounts(actor);const row={version,role:actor.role,operation,queries:metrics.length,rowsRead:metrics.reduce((n,m)=>n+m.rows_read,0),rowsWritten:metrics.reduce((n,m)=>n+m.rows_written,0)};
   output.push(row);return value;
  };
  for(const[version,reader]of versions){
   if(version==='current')for(const sql of[
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_unbound_recipient_created ON notifications(recipient_email COLLATE NOCASE,created_at DESC) WHERE user_id IS NULL',
    'CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_unread ON chat_messages(student_user_id,lecturer_id,read_at,sender_user_id)',
    'CREATE INDEX IF NOT EXISTS academic_message_lecturer ON academic_messages(lecturer_id,enrollment_id,class_id)',
   ])await local.prepare(sql).all();
   for(const actor of actors){
    reader.invalidateUnreadCountsCache();const value=await measure(version,reader,actor,'cold');results.set(`${version}:${actor!.role}`,value);
    if(version==='current'){
     if(baseline)assert.deepEqual(value,results.get(`baseline:${actor!.role}`),'Unread counts changed.');
     assert.deepEqual(await measure(version,reader,actor,'warm'),value);
    }
   }
  }
  // Synthetic unrelated history exists only in this throwaway copy. Its growth
  // must not turn the header count back into a scan of everybody's messages.
  const excluded=new Set<number>();
  for(const actor of actors){
   const l=source.prepare('SELECT id FROM lecturers WHERE lower(trim(email))=?').get(String(actor!.email).trim().toLowerCase());if(l)excluded.add(Number(l.id));
   if(actor!.role==='student'){
    for(const r of source.prepare('SELECT lecturer_id id FROM advisor_assignments WHERE user_id=?').all(actor!.id))excluded.add(Number(r.id));
    for(const r of source.prepare("SELECT json_extract(a.value,'$.lecturerId') id FROM academic_enrollments e,json_each(e.data,'$.assignments') a WHERE lower(json_extract(e.data,'$.email'))=?").all(String(actor!.email).toLowerCase()))excluded.add(Number(r.id));
   }
  }
  const otherLecturer=source.prepare('SELECT id FROM lecturers WHERE id NOT IN (SELECT value FROM json_each(?)) LIMIT 1').get(JSON.stringify([...excluded]));
  const otherStudent=source.prepare("SELECT id FROM users WHERE role='student' AND id NOT IN (SELECT value FROM json_each(?)) LIMIT 1").get(JSON.stringify(actors.map(a=>a!.id)));
  const otherClass=source.prepare('SELECT id FROM academic_classes LIMIT 1').get();
  for(let batch=0;batch<10;batch++){
   const statements=[];
   for(let i=0;i<100;i++){
    const n=batch*100+i;
    statements.push(local.prepare("INSERT INTO notifications(recipient_email,type,subject,body,status,created_at) VALUES('unrelated@local.invalid','notice','Local cost rehearsal','Local cost rehearsal','website_only','2099-01-01')"));
    if(otherLecturer&&otherStudent&&otherClass){
     statements.push(local.prepare("INSERT INTO chat_messages(student_user_id,lecturer_id,sender_user_id,body,created_at) VALUES(?,?,?,'Local cost rehearsal','2099-01-01')").bind(otherStudent.id,otherLecturer.id,actors[0]!.id));
     statements.push(local.prepare("INSERT INTO chat_group_messages(lecturer_id,sender_user_id,body,created_at) VALUES(?,?,'Local cost rehearsal','2099-01-01')").bind(otherLecturer.id,actors[0]!.id));
     statements.push(local.prepare("INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at) VALUES(?,?,?,?,'Local cost rehearsal','2099-01-01')").bind('local-unread-cost-'+n,otherClass.id,otherLecturer.id,actors[0]!.id));
    }
   }
   await local.batch(statements);
  }
  for(const actor of actors){current.invalidateUnreadCountsCache();assert.deepEqual(await measure('current',current,actor,'+1000-unrelated-per-source'),results.get(`current:${actor!.role}`));}
  for(const row of output){
   assert.equal(row.rowsWritten,0);
   if(row.version!=='current')continue;
   if(row.operation==='warm')assert.ok(row.rowsRead<=2,'Warm header counts exceeded 2 rows.');
   if(row.operation==='cold'&&baseline){const before=output.find(x=>x.version==='baseline'&&x.role===row.role)!;assert.ok(row.rowsRead<=before.rowsRead/10,'Cold header count did not reduce reads by 90%.');}
   if(row.operation==='+1000-unrelated-per-source'){const before=output.find(x=>x.version==='current'&&x.role===row.role&&x.operation==='cold')!;assert.ok(row.rowsRead<=before.rowsRead+64,'Header count grew with unrelated history.');}
  }
  const report={runtime:'local workerd D1; production SQL plans can differ',sourceReadOnly:true,baseline:baseline||null,measurements:output};
  if(arg('output'))await writeFile(resolve(arg('output')!),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
 }finally{source.close();await mf?.dispose();await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error('Unread profile failed:',String(error?.message||error).slice(0,350));process.exitCode=1;});
