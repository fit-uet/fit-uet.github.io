import type { AuthenticatedUser } from '../types';
import type { CourseEnrollment } from '../../src/shared/academic';
import { applyEnrollmentAction, applyGrade, enrollmentView, event } from './service';
import { getClass, getEnrollment, requireRead, requireRevision } from './domain';
import { requireCampaign } from './campaigns';
import { AcademicError, commit, fail, snapshot, type Snapshot, type AcademicEvent } from './store';

export type ProjectPatch = {
  enrollmentId:string; expectedRevision:number;
  assignments?: {lecturerId:number;role:'primary'|'co'|'reviewer'}[];
  topic?: {title?:string;approve?:boolean;reason?:string};
  grades?: Partial<Record<'advisor'|'reviewer',{score:number;comment:string;submissionVersionId:string}>>;
  review?:{needsRevision:boolean;comment:string};
  gradeLock?:{locked:boolean;reason:string}; reopen?:{submissionUntil:string;reason:string};
};
function applyRow(s:Snapshot, actor:AuthenticatedUser, patch:ProjectPatch) {
  const e=getEnrollment(s,patch.enrollmentId),c=getClass(s,e.classId);
  requireRead(s,c,actor,e);requireRevision(e.revision,patch.expectedRevision);
  const events:AcademicEvent[]=[];let field='';
  try {
  const action=(kind:any,input:any)=>applyEnrollmentAction(s,c,e,actor,{...input,expectedRevision:patch.expectedRevision},kind);
  if(patch.assignments!==undefined){field='assignments';action('assignments',{assignments:patch.assignments});events.push(event(e,'course_assignment','Cập nhật phân công giảng viên',`Khoa đã cập nhật phân công cho lớp ${c.code}.`));}
  if(patch.topic){field='topic';const {approve,title,reason}=patch.topic;action(title===undefined&&approve?'topicApprove':'topic',{title,reason});}
  if(patch.grades){field='grades';
    for(const role of Object.keys(patch.grades)){if(!['advisor','reviewer'].includes(role))fail(422,'INVALID_GRADE_ROLE','Phần điểm không hợp lệ.');events.push(...applyGrade(s,c,e,actor,role,{...patch.grades[role],expectedRevision:patch.expectedRevision}));}
  }
  if(patch.review){field='review';action('review',patch.review);events.push(event(e,'submission_review','Phản hồi bài nộp',e.reviewComment||'Đã hủy yêu cầu sửa bài.'));}
  if(patch.gradeLock){field='gradeLock';action('gradeLock',patch.gradeLock);}
  if(patch.reopen){field='reopen';action('reopen',patch.reopen);}
  return {e,events};
  }catch(error){if(error instanceof AcademicError)error.details={field};throw error;}
}
export async function saveProjectRows(actor:AuthenticatedUser,campaignId:string,input:any) {
  if(actor.role==='student')fail(403,'MANAGEMENT_ONLY','Sinh viên sử dụng trang cá nhân.');
  const rows:ProjectPatch[]=input.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>25||new Set(rows.map(r=>r?.enrollmentId)).size!==rows.length)fail(422,'INVALID_ROWS','Mỗi lần lưu từ 1 đến 25 hồ sơ khác nhau.');
  for(const row of rows)if(!row||Object.keys(row).some(k=>!['enrollmentId','expectedRevision','assignments','topic','grades','review','gradeLock','reopen'].includes(k)))fail(422,'INVALID_PATCH','Trường cập nhật không hợp lệ.');
  for(let attempt=0;attempt<3;attempt++){
    const original=await snapshot(),p=requireCampaign(original,campaignId,actor,true);
    if(p.group!=='project')fail(422,'PROJECT_REQUIRED','Chức năng thuộc nhóm Thực hành nghiên cứu.');
    const errors=new Map<string,{code:string;message:string;field?:string}>();
    for(const row of rows){try{
      const e=getEnrollment(original,row.enrollmentId),c=getClass(original,e.classId);requireRead(original,c,actor,e);
      if(c.campaignId!==campaignId)fail(403,'CAMPAIGN_ACCESS_DENIED','Hồ sơ không thuộc nhóm đang chọn.');requireRevision(e.revision,row.expectedRevision);
      if(row.assignments!==undefined&&(!Array.isArray(row.assignments)||row.assignments.some(a=>!a||!Number.isInteger(a.lecturerId)||!['primary','co','reviewer'].includes(a.role))))fail(422,'INVALID_ASSIGNMENTS','Phân công không hợp lệ.');
    }catch(error){if(!(error instanceof AcademicError))throw error;errors.set(row.enrollmentId,{code:error.code,message:error.message,field:(error.details as any)?.field});}}
    let changed:{e:CourseEnrollment;events:AcademicEvent[]}[]=[],candidate:Snapshot;
    // Validate against the proposed final assignments, then remove rejected rows
    // and revalidate until their restored assignments no longer affect quotas.
    for(let pass=0;pass<=rows.length;pass++){
      candidate=structuredClone(original);changed=[];const before=errors.size;
      for(const row of rows.filter(r=>!errors.has(r.enrollmentId)&&r.assignments!==undefined))candidate.enrollments.find(e=>e.id===row.enrollmentId)!.assignments=row.assignments.map((a,i)=>({...a,id:`proposed-${row.enrollmentId}-${i}`,assignedAt:''}));
      for(const row of rows.filter(r=>!errors.has(r.enrollmentId))){
        try{
          const context=structuredClone(candidate);context.enrollments[context.enrollments.findIndex(e=>e.id===row.enrollmentId)]=structuredClone(getEnrollment(original,row.enrollmentId));
          const result=applyRow(context,actor,row);changed.push(result);
        }catch(error){if(!(error instanceof AcademicError))throw error;errors.set(row.enrollmentId,{code:error.code,message:error.message,field:(error.details as any)?.field});}
      }
      if(errors.size===before)break;
    }
    if(changed.length){
      try{await commit(original,actor.id,actor.role==='admin'?'admin.project.bulk':'lecturer.project.bulk',{enrollments:changed.map(r=>r.e),events:changed.flatMap(r=>r.events)});}
      catch(error){if(error instanceof AcademicError&&error.code==='STALE_PREVIEW'&&attempt<2)continue;throw error;}
    }
    const committed={...original,enrollments:original.enrollments.map(e=>changed.find(r=>r.e.id===e.id)?.e||e)};
    return {results:rows.map(row=>{const result=changed.find(r=>r.e.id===row.enrollmentId);return result?{enrollmentId:row.enrollmentId,ok:true,enrollment:enrollmentView(committed,getClass(committed,result.e.classId),result.e,actor)}:{enrollmentId:row.enrollmentId,ok:false,error:errors.get(row.enrollmentId)};})};
  }
}
