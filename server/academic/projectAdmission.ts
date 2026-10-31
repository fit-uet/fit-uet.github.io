import {db} from '../db';
import type {AuthenticatedUser} from '../types';
import {readContext} from './reads';
import {commit,fail} from './store';
import {course,getClass,newEnrollment,requireAdmin,requireRevision,text} from './domain';
import {enrollmentView} from './service';

const validId=(input:unknown)=>{
  const id=text(input);if(!/^\d{8}$/.test(id))fail(422,'INVALID_STUDENT_ID','MSSV phải gồm đúng 8 chữ số.');return id;
};
async function accountFor(studentId:string){
  const email=`${studentId}@vnu.edu.vn`;
  const rows=(await db.execute({sql:`SELECT id,email,student_id studentId,name,COALESCE(dob,'') dob,COALESCE(class_name,'') className,role
    FROM users WHERE student_id=? OR lower(email)=?`,args:[studentId,email]})).rows;
  if(rows.length>1||rows.some(u=>u.role!=='student'||u.studentId!==studentId||String(u.email).toLowerCase()!==email))fail(409,'STUDENT_IDENTITY_CONFLICT','MSSV/email đang thuộc tài khoản khác. Cần đối soát danh mục sinh viên trước khi thêm.');
  return rows[0] as {id:number;email:string;studentId:string;name:string;dob:string;className:string;role:string}|undefined;
}
async function admissionContext(actor:AuthenticatedUser,id:string){
  requireAdmin(actor);const ctx=await readContext(actor,id,'base');const p=ctx.campaigns.find(p=>p.id===id)!;
  if(p.group!=='project')fail(422,'PROJECT_REQUIRED','Chỉ thêm lần học tại nhóm Dự án.');
  if(p.pendingMigration||!['draft','active'].includes(p.status))fail(409,'CAMPAIGN_READ_ONLY','Cần mở lại hoặc hoàn tất chuyển đổi nhóm môn trước khi thêm sinh viên.');
  return {...ctx,p};
}
export async function lookupProjectStudent(actor:AuthenticatedUser,id:string,input:unknown){
  requireAdmin(actor);const studentId=validId(input),ctx=await admissionContext(actor,id),account=await accountFor(studentId);
  const existing=(await db.execute({sql:`SELECT e.id,e.class_id classId FROM academic_enrollments e WHERE e.student_id=? AND e.class_id IN (SELECT value FROM json_each(?))`,args:[studentId,JSON.stringify(ctx.s.classes.map(c=>c.id))]})).rows;
  return {revision:ctx.s.revision,found:!!account,student:account?{studentId,name:account.name,email:account.email,dob:account.dob,className:account.className}:null,enrollments:existing};
}
export async function addProjectStudent(actor:AuthenticatedUser,id:string,input:any){
  requireAdmin(actor);const studentId=validId(input?.studentId),ctx=await admissionContext(actor,id);
  requireRevision(ctx.s.revision,input.expectedRevision);
  const c=getClass(ctx.s,text(input.classId));
  if(c.campaignId!==id||c.legacy||course(c).group!=='project')fail(422,'INVALID_CAMPAIGN_FILTER','Lớp học phần không thuộc nhóm Dự án đang chọn.');
  const account=await accountFor(studentId);
  const existing=(await db.execute({sql:'SELECT id FROM academic_enrollments WHERE class_id=? AND student_id=?',args:[c.id,studentId]})).rows[0];
  if(existing)fail(409,'DUPLICATE_ENROLLMENT','Sinh viên đã có trong lớp học phần này.',{enrollmentId:existing.id});
  const name=account?.name||text(input.name),dob=account?.dob??text(input.dob),className=account?.className??text(input.className);
  if(!name||name.length>200||className.length>200)fail(422,'INVALID_STUDENT','Cần họ tên hợp lệ, tối đa 200 ký tự.');
  if(!account&&dob&&(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob||Number(dob.slice(0,4))<1900))fail(422,'INVALID_DATE','Ngày sinh không hợp lệ.');
  const e=newEnrollment(c,{studentId,name,dob,className});
  await commit(ctx.s,actor.id,'admin.project.add',{
    enrollments:[e],users:account?[]:[{studentId,email:e.email,name,dob,className}],
    projectAdmission:{campaignId:id,campaignRevision:ctx.p.revision,classId:c.id,studentId,email:e.email,account:account||null},
  },'Khoa thêm sinh viên vào lớp Dự án.');
  return {enrollment:enrollmentView({...ctx.s,enrollments:[e]},c,e,actor),createdAccount:!account};
}
