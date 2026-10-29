import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
import {createHash} from 'node:crypto';
import {CloudflareD1Client} from '../server/db';
import {copySqliteToD1} from './deployment/d1Copy';
const option=(key:string)=>process.argv.slice(2).find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3);
const input=option('source'),envFile=option('env-file'),target=option('target'),report=option('report');
if(!input?.startsWith('file:')||!envFile||!target||!report)throw Error('Use --source=file:/verified/backup.db --env-file=/private/env --target=NEW-D1-ID --report=/private/report.json [--apply]');
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target))throw Error('Target must be an explicit D1 UUID');
const path=await realpath(resolve(input.slice(5))),env=parse(await readFile(resolve(envFile)));
if(target==='866e23b7-3b49-43e4-ab90-59dceb4c4f76')throw Error('Do not overwrite the old D1 database. Create a separate failover target.');
if(!env.CLOUDFLARE_ACCOUNT_ID||!env.CLOUDFLARE_API_TOKEN)throw Error('Missing D1 credentials');
const before=createHash('sha256').update(await readFile(path)).digest('hex'),source=new DatabaseSync(path,{readOnly:true});
try{const result=await copySqliteToD1(source,new CloudflareD1Client(env.CLOUDFLARE_ACCOUNT_ID,target,env.CLOUDFLARE_API_TOKEN),process.argv.includes('--apply'),m=>console.log(m));const after=createHash('sha256').update(await readFile(path)).digest('hex');if(before!==after)throw Error('SOURCE_CHANGED');await writeFile(resolve(report),JSON.stringify({target,sourceHash:before,sourceUnchanged:true,at:new Date().toISOString(),...result},null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({target,sourceUnchanged:true,tables:result.tables.length,rows:result.rows,applied:process.argv.includes('--apply')}));}finally{source.close();}
