import {createClient} from '@libsql/client';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import {previewProjectMembership} from '../server/academic/projectMembership';
import {initAcademicSchema} from '../server/academic/schema';
import {libsqlDatabase} from '../server/academic/libsql';
import {backupLibsql} from './deployment/backup';
const args=process.argv.slice(2),option=(key:string)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);
const source=option('database'),envFile=option('env-file'),apply=args.includes('--apply');
if(!!source===!!envFile)throw Error('Chỉ định --database=file:/path/copy.db hoặc --env-file=/path/private.env.');
if(apply&&envFile)throw Error('Công cụ chỉ áp dụng trên bản sao local. Production chạy migration lúc khởi động sau khi sao lưu riêng.');
let client;
if(source){if(!source.startsWith('file:')||/:memory:|[?#\0]/.test(source))throw Error('Cần bản sao SQLite local tồn tại.');client=createClient({url:'file:'+await realpath(resolve(source.slice(5))),intMode:'bigint'});}
else{const e=parse(await readFile(resolve(envFile!)));if(e.DB_PROVIDER!=='turso'||!e.TURSO_DATABASE_URL?.startsWith('libsql://')||!e.TURSO_AUTH_TOKEN)throw Error('Cần nguồn Turso tường minh.');client=createClient({url:e.TURSO_DATABASE_URL,authToken:e.TURSO_AUTH_TOKEN,intMode:'bigint'});}
try{
 const preview=await previewProjectMembership(libsqlDatabase(client));
 if(preview.conflicts.length){console.log(JSON.stringify({mode:'blocked',conflicts:preview.conflicts},null,2));process.exitCode=1;}
 else{
  let backup:string|undefined;
  if(apply){backup=resolve(source!.slice(5))+'.membership-backup-'+Date.now()+'.db';const report=await backupLibsql(client,backup);await writeFile(backup+'.report.json',JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});await initAcademicSchema(libsqlDatabase(client));}
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',changes:preview.changes.length,conflicts:0,backup},null,2));
 }
}finally{client.close();}
