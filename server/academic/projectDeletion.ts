import {randomUUID} from 'node:crypto';
import {db} from '../db';
import type {AuthenticatedUser} from '../types';
import {commit,fail,readPreview,savePreview,snapshot} from './store';
import {getClass,getEnrollment,requireAdmin,requireRevision,text} from './domain';
import {requireCampaign} from './campaigns';
import {drainProjectCleanup} from './projectCleanup';

export async function previewProjectDeletion(actor:AuthenticatedUser,campaignId:string,input:any){
  requireAdmin(actor);const s=await snapshot(),p=requireCampaign(s,campaignId,actor,true);
  if(p.group!=='project')fail(422,'PROJECT_REQUIRED','Chỉ xóa lần học Thực hành nghiên cứu.');
  if(!Array.isArray(input.enrollmentIds)||!input.enrollmentIds.length||input.enrollmentIds.length>100||new Set(input.enrollmentIds).size!==input.enrollmentIds.length)fail(422,'INVALID_ROWS','Chọn từ 1 đến 100 lần học khác nhau.');
  const ids=input.enrollmentIds as string[];const rows=[];
  for(const id of ids){const e=getEnrollment(s,id),c=getClass(s,e.classId);if(c.campaignId!==campaignId)fail(403,'CAMPAIGN_ACCESS_DENIED','Hồ sơ ngoài phạm vi nhóm môn.');const messages=(await db.execute({sql:'SELECT attachment_key FROM academic_messages WHERE enrollment_id=?',args:[id]})).rows;rows.push({enrollmentId:id,revision:e.revision,studentId:e.studentId,name:e.name,classCode:c.code,versions:e.versions.length,evaluations:Object.values(e.evaluations).reduce((n,p)=>n+Object.values(p).filter(Boolean).length,0),files:new Set([...e.versions.map(v=>v.objectKey),...messages.map(m=>m.attachment_key)].filter(Boolean)).size,privateMessages:messages.length});}
  const preview=await savePreview(actor.id,'project-deletion',s,{campaignId,rows});return {...preview,rows};
}
function purgePaths(value:any,ids:Set<string>,keys:Set<string>,codes:Set<string>,path='$',out:string[]=[]):string[]{
  if(value&&typeof value==='object'){
    if(!Array.isArray(value)&&(ids.has(value.id)||ids.has(value.enrollmentId)||ids.has(value.academic_enrollment_id)||keys.has(`${value.studentId}|${value.classId}`)||codes.has(`${value.studentId}|${value.classCode}`)||codes.has(value.key))){out.push(path);return out;}
    if(Array.isArray(value))value.forEach((v,i)=>purgePaths(v,ids,keys,codes,`${path}[${i}]`,out));
    else for(const [k,v]of Object.entries(value))purgePaths(v,ids,keys,codes,`${path}.${JSON.stringify(k)}`,out);
  }
  return out;
}
export async function applyProjectDeletion(actor:AuthenticatedUser,campaignId:string,previewId:string,input:any){
  requireAdmin(actor);if(!text(input.reason))fail(422,'REASON_REQUIRED','Cần lý do xóa khỏi danh sách.');
  const prior=(await db.execute({sql:'SELECT id FROM academic_deletions WHERE id=? AND campaign_id=? AND actor_id=?',args:[previewId,campaignId,actor.id]})).rows[0];
  if(prior)return projectDeletionStatus(actor,campaignId,previewId);
  const p=await readPreview(actor.id,previewId,'project-deletion');if(p.payload.campaignId!==campaignId)fail(403,'CAMPAIGN_ACCESS_DENIED','Bản xem trước thuộc nhóm khác.');
  const s=await snapshot(),campaign=requireCampaign(s,campaignId,actor,true);if(campaign.group!=='project')fail(422,'PROJECT_REQUIRED','Chỉ xóa lần học Thực hành nghiên cứu.');
  if(s.revision!==p.revision)fail(409,'STALE_PREVIEW','Dữ liệu thay đổi; xem trước lại trước khi xóa.');
  const ids=new Set<string>(p.payload.rows.map(r=>r.enrollmentId)),keys=new Set<string>(),codes=new Set<string>(),files=new Map<string,string>();
  for(const row of p.payload.rows){const e=getEnrollment(s,row.enrollmentId),c=getClass(s,e.classId);requireRevision(e.revision,row.revision);if(c.campaignId!==campaignId)fail(403,'CAMPAIGN_ACCESS_DENIED','Hồ sơ ngoài phạm vi.');keys.add(`${e.studentId}|${e.classId}`);codes.add(`${e.studentId}|${c.code}`);for(const v of e.versions)if(v.objectKey)files.set(v.objectKey,'report');}
  const pathsFor=(value:any,preview=false)=>{
    const semesters=new Set([value.semesterId,...(value.changes?.classes||[]).map(c=>c.semesterId),...(value.changes?.enrollments||[]).map(e=>s.classes.find(c=>c.id===e.classId)?.semesterId)].filter(Boolean));
    // Old all-unchanged import previews have no semester metadata. Invalidate
    // ambiguous previews, but never scrub historical records of another term.
    const scopedCodes=semesters.has(campaign.semesterId)||(!semesters.size&&preview)?codes:new Set<string>();
    return purgePaths(value,ids,keys,scopedCodes);
  };
  const messages=(await db.execute({sql:'SELECT attachment_key FROM academic_messages WHERE enrollment_id IN (SELECT value FROM json_each(?))',args:[JSON.stringify([...ids])]})).rows;for(const m of messages)if(m.attachment_key)files.set(String(m.attachment_key),'chat');
  const purgeCommands=[];
  for(const row of (await db.execute('SELECT id,payload FROM academic_commands')).rows){const paths=pathsFor(JSON.parse(String(row.payload))).reverse();if(paths.length)purgeCommands.push({id:row.id,paths});}
  const deletePreviews=[];
  for(const row of (await db.execute('SELECT id,payload FROM academic_previews')).rows){const value=JSON.parse(String(row.payload));if(row.id===previewId||pathsFor(value,true).length>0)deletePreviews.push(row.id);}
  const jobId=previewId;
  await commit(s,actor.id,'admin.project.delete',{deletedEnrollmentIds:[...ids],purgeCommands,deletePreviewIds:deletePreviews.map(String),cleanupFiles:[...files].map(([objectKey,kind])=>({id:randomUUID(),jobId,kind,objectKey})),deletionJob:{id:jobId,campaignId,actorId:actor.id,enrollmentIds:[...ids],reason:text(input.reason)}},text(input.reason));
  // The command must not retain rewritten payloads or file keys after applying.
  await drainProjectCleanup();return projectDeletionStatus(actor,campaignId,jobId);
}
export async function projectDeletionStatus(actor:AuthenticatedUser,campaignId:string,jobId:string){
  requireAdmin(actor);const row=(await db.execute({sql:'SELECT id,enrollment_ids FROM academic_deletions WHERE id=? AND campaign_id=?',args:[jobId,campaignId]})).rows[0];if(!row)fail(404,'DELETION_NOT_FOUND','Không tìm thấy lần xóa.');
  const pending=Number((await db.execute({sql:'SELECT count(*) n FROM academic_file_cleanup WHERE job_id=?',args:[jobId]})).rows[0].n);
  return {jobId,enrollmentIds:JSON.parse(String(row.enrollment_ids)),pendingFiles:pending,status:pending?'files_pending':'complete'};
}
