// Local-only D1 cost rehearsal. Opens the supplied SQLite backup read-only,
// profiles a separate workerd copy and prints aggregate counters without PII.
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,readdir,rm,writeFile,chmod,stat,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {transform} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import type {AuthenticatedUser} from '../server/types';

async function main(){
  const arg=(name:string)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
  const sourceArg=arg('database'),campaignId=arg('campaign');
  if(!sourceArg||!campaignId||/^[a-z]+:\/\//i.test(sourceArg))throw Error('Use --database=/path/verified-backup.db --campaign=semester:project [--baseline-ref=commit] [--assert] [--output=report.json]. Local files only.');
  const sourcePath=await realpath(resolve(sourceArg));if(!(await stat(sourcePath)).isFile())throw Error('A local SQLite backup is required.');
  const directory=await mkdtemp(join(tmpdir(),'academic-read-profile-'));await chmod(directory,0o700);
  const state=join(directory,'state'),source=new DatabaseSync(sourcePath,{readOnly:true});
  const sourceSnapshot=join(directory,'snapshot.db');
  let mf:Miniflare|undefined;
  try{
    await backup(source,sourceSnapshot);
    const campaign="COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||CASE WHEN json_extract(c.data,'$.courseCode') IN ('INT3131','INT3132') THEN ':project' ELSE ':internship' END)";
    const admin=source.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
    const student=source.prepare(`SELECT u.* FROM users u JOIN academic_enrollments e ON lower(json_extract(e.data,'$.email'))=lower(u.email) JOIN academic_classes c ON c.id=e.class_id WHERE u.role='student' AND ${campaign}=? LIMIT 1`).get(campaignId);
    const lecturer=source.prepare(`SELECT u.* FROM users u JOIN lecturers l ON lower(trim(l.email))=lower(trim(u.email)) WHERE (u.role='lecturer' OR u.is_lecturer=1) AND EXISTS(SELECT 1 FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id,json_each(e.data,'$.assignments') a WHERE ${campaign}=? AND json_extract(a.value,'$.lecturerId')=l.id) LIMIT 1`).get(campaignId);
    if(!admin||!student||!lecturer)throw Error('The chosen campaign needs an administrator, enrolled student and assigned lecturer for this rehearsal.');
    const actors:Array<[string,AuthenticatedUser]>=[['admin',admin as unknown as AuthenticatedUser],['student',student as unknown as AuthenticatedUser],['lecturer',{...lecturer,role:'lecturer'} as unknown as AuthenticatedUser]];
    const ownId=String(source.prepare(`SELECT e.id FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE lower(json_extract(e.data,'$.email'))=lower(?) AND ${campaign}=? LIMIT 1`).get(student.email,campaignId)!.id);
    const options=convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local profile");}}',d1Databases:{DB:'read-profile-local-only'}});
    options.resourcePersistencePath=state;
    mf=new Miniflare(options);await(await mf.getD1Database('DB')).prepare('SELECT 1').all();await mf.dispose();mf=undefined;
    async function files(path:string):Promise<string[]>{return(await Promise.all((await readdir(path,{withFileTypes:true})).map(entry=>entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)]))).flat();}
    const sqlite=(await files(state)).find(p=>p.includes('D1DatabaseObject')&&p.endsWith('.sqlite')&&!p.endsWith('metadata.sqlite'));
    if(!sqlite)throw Error('Local D1 storage was not initialized.');
    await rm(sqlite);await rm(sqlite+'-wal',{force:true});await rm(sqlite+'-shm',{force:true});
    const snapshotDb=new DatabaseSync(sourceSnapshot,{readOnly:true});try{await backup(snapshotDb,sqlite);}finally{snapshotDb.close();}
    mf=new Miniflare(options);const local=await mf.getD1Database('DB');
    const {setDb}=await import('../server/db');const current=await import('../server/academic/reads');
    type Readers=typeof current;
    const versions:Array<[string,Readers]>=[];
    const baseline=arg('baseline-ref');
    if(baseline){
      // Only a trusted commit in this repository. Source is compiled in RAM;
      // no checkout, source files or production connections are changed.
      const path='server/academic/reads.ts';
      let code=execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8'});
      code=(await transform(code,{loader:'ts',format:'esm',target:'es2022'})).code.replace(/from\s*(["'])(\.[^"']+)\1/g,(_whole,_q,p)=>{let full=resolve(dirname(path),p);if(existsSync(full+'.ts'))full+='.ts';return 'from '+JSON.stringify(pathToFileURL(full).href);});
      versions.push(['baseline',await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))]);
    }
    versions.push(['current',current]);
    let metrics:any[]=[];
    setDb({execute:async input=>{const sql=typeof input==='string'?input:input.sql,args=typeof input==='string'?[]:input.args||[];
      if(!/^\s*(SELECT|WITH|EXPLAIN)/i.test(sql))throw Error('Profile attempted a write.');
      const result=await local.prepare(sql).bind(...args).all();metrics.push(result.meta);return {rows:result.results};
    },executeMultiple:async()=>{throw Error('Profile attempted a write.');},batch:async()=>{throw Error('Profile attempted a write.');}});
    const output:Array<{version:string;role:string;operation:string;queries:number;rowsRead:number;rowsWritten:number;durationMs:number}>=[];
    const results=new Map<string,any>();
    for(const[version,readers]of versions){
      if(version==='current')await local.prepare("CREATE INDEX IF NOT EXISTS academic_enrollment_email ON academic_enrollments(lower(json_extract(data,'$.email')))").all();
      for(const[role,actor]of actors){
        const operations:Array<[string,()=>Promise<any>]>=[['catalog',()=>readers.readCampaignCatalog(actor,'base')],['base',()=>readers.readCampaignDetail(actor,campaignId,'base')],['overview',()=>readers.readCampaignDetail(actor,campaignId,'overview')],['roster25',()=>readers.readCampaignEnrollments(actor,campaignId,{projection:'students',limit:25},false,undefined,false)],['grades25',()=>readers.readCampaignEnrollments(actor,campaignId,{projection:'grades',limit:25},false,undefined,false)],['list25',()=>readers.readCampaignEnrollments(actor,campaignId,{projection:'student-list',limit:25},false,undefined,false)]];
        if(role!=='lecturer')operations.push(['detail',()=>readers.readEnrollment(actor,ownId)]);
        for(const[operation,run]of operations){
          readers.invalidateReadCache();metrics=[];const value=await run();results.set(`${version}:${role}:${operation}`,value);
          output.push({version,role,operation,queries:metrics.length,rowsRead:metrics.reduce((n,m)=>n+m.rows_read,0),rowsWritten:metrics.reduce((n,m)=>n+m.rows_written,0),durationMs:metrics.reduce((n,m)=>n+m.duration,0)});
          if(version==='current'&&operation==='list25'){
            metrics=[];assert.deepEqual(await readers.readCampaignEnrollments(actor,campaignId,{projection:'student-list',limit:25}),value);
            output.push({version,role,operation:'revalidate',queries:metrics.length,rowsRead:metrics.reduce((n,m)=>n+m.rows_read,0),rowsWritten:metrics.reduce((n,m)=>n+m.rows_written,0),durationMs:metrics.reduce((n,m)=>n+m.duration,0)});
          }
        }
      }
    }
    // Growing another campaign must not increase work for a project page.
    // These deliberately synthetic rows exist only in the disposable copy.
    const unrelated=await local.prepare(`SELECT e.* FROM academic_enrollments e JOIN academic_classes c ON c.id=e.class_id WHERE ${campaign}!=? AND json_extract(e.data,'$.legacy')=1 LIMIT 1`).bind(campaignId).all();
    if(unrelated.results.length){
      const row=unrelated.results[0];
      for(let batch=0;batch<10;batch++)await local.batch(Array.from({length:100},(_,i)=>{
        const number=batch*100+i,id=`local-cost-profile-${number}`,studentId=String(900000000+number);
        return local.prepare("INSERT INTO academic_enrollments(id,class_id,student_id,data) VALUES(?,?,?,json_set(?,'$.id',?,'$.studentId',?,'$.email',?))").bind(id,row.class_id,studentId,row.data,id,studentId,`${studentId}@local.invalid`);
      }));
      for(const[role,actor]of actors){
        current.invalidateReadCache();metrics=[];
        const value=await current.readCampaignEnrollments(actor,campaignId,{projection:'student-list',limit:25},false,undefined,false);
        assert.deepEqual(value,results.get(`current:${role}:list25`));
        output.push({version:'current',role,operation:'list25+1000-unrelated',queries:metrics.length,rowsRead:metrics.reduce((n,m)=>n+m.rows_read,0),rowsWritten:metrics.reduce((n,m)=>n+m.rows_written,0),durationMs:metrics.reduce((n,m)=>n+m.duration,0)});
      }
    }
    if(process.argv.includes('--assert')){
      for(const row of output){assert.equal(row.rowsWritten,0);if(row.operation==='revalidate')assert.ok(row.rowsRead<=10,'Conditional page revalidation exceeded 10 rows.');
        if(row.operation==='list25+1000-unrelated'){
          const before=output.find(v=>v.version==='current'&&v.role===row.role&&v.operation==='list25')!;
          assert.ok(row.rowsRead<=before.rowsRead+64,'Project page work grew with unrelated legacy enrollments.');continue;
        }
        if(baseline&&row.version==='current'&&row.operation!=='revalidate'){
          const before=output.find(v=>v.version==='baseline'&&v.role===row.role&&v.operation===row.operation)!;
          assert.ok(row.rowsRead<=before.rowsRead/2,`${row.role}/${row.operation}: expected at least 50% fewer rows (${row.rowsRead} vs ${before.rowsRead}).`);
          if(row.operation==='list25'){const old=results.get(`baseline:${row.role}:list25`),now=results.get(`current:${row.role}:list25`);assert.equal(now.total,old.total);assert.equal(now.studentCount,old.studentCount);assert.deepEqual(now.items,old.items);}
        }
      }
    }
    const report={runtime:'local workerd D1; production SQL plans can differ',sourceReadOnly:true,baseline:baseline||null,measurements:output};
    if(arg('output'))await writeFile(resolve(arg('output')!),JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify(report,null,2));
  }finally{source.close();await mf?.dispose();await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error('Read profile failed:',String(error?.message||error).slice(0,400));process.exitCode=1;});
