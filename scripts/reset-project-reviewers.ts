import { createClient } from '@libsql/client';
import { parse } from 'dotenv';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setDb } from '../server/db';
import { libsqlDatabase } from '../server/academic/libsql';
import { reviewerResetPreview, resetProjectReviewers } from '../server/academic/reviewerReset';
import { backupLibsql } from './deployment/backup';

const args=process.argv.slice(2), option=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const envFile=option('env-file'), database=option('database'), campaignId=option('campaign');
const apply=args.includes('--apply'), backup=option('backup'), reason=option('reason'), expectedRevision=Number(option('expected-revision'));
if (!campaignId || !!envFile===!!database) throw new Error('Cần --campaign và đúng một trong --env-file (Turso) hoặc --database=file:/path/copy.db. Mặc định chỉ xem trước.');
if (apply && (!backup || !reason?.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision<0)) throw new Error('--apply cần --backup, --reason và --expected-revision từ kết quả xem trước.');
const env=envFile?parse(await readFile(resolve(envFile))):{};
let url:string;
if(envFile){
  if(env.DB_PROVIDER!=='turso'||!env.TURSO_DATABASE_URL?.startsWith('libsql://')||!env.TURSO_AUTH_TOKEN)throw new Error('Cần nguồn Turso tường minh; không dùng database mặc định.');
  url=env.TURSO_DATABASE_URL;
}else{
  if(!database?.startsWith('file:')||/:memory:|[?#\0]/.test(database))throw new Error('Chỉ nhận bản sao SQLite local tồn tại.');
  url=`file:${await realpath(resolve(database.slice(5)))}`;
}
const client=createClient({url,authToken:envFile?env.TURSO_AUTH_TOKEN:undefined,intMode:'bigint'});setDb(libsqlDatabase(client));
try{
  const email=(option('actor-email')||env.ADMIN_EMAIL||'').trim().toLowerCase();
  const user=(await client.execute({sql:"SELECT id,email,name,role FROM users WHERE lower(email)=? AND role='admin'",args:[email]})).rows[0];
  if(!user)throw new Error('Cần tài khoản Khoa/Quản trị viên đang có trong database.');
  const actor={id:Number(user.id),email:String(user.email),name:String(user.name),role:'admin' as const};
  const preview=await reviewerResetPreview(actor,campaignId);
  if(apply&&(preview.revision!==expectedRevision||preview.protectedEnrollments.length))throw new Error('Dữ liệu đã thay đổi hoặc có hồ sơ được bảo vệ. Chưa gỡ phân công; xem trước lại.');
  if(apply&&preview.assignments){
    const report=await backupLibsql(client,resolve(backup!));
    await writeFile(`${resolve(backup!)}.report.json`,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
    if(report.integrity!=='ok'||report.foreignKeyIssues!==0)throw new Error('Bản sao lưu chưa đạt; chưa gỡ phân công.');
  }
  const result=apply?await resetProjectReviewers(actor,campaignId,{expectedRevision,reason:reason!}):preview;
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',...result},null,2));
}finally{client.close();}
