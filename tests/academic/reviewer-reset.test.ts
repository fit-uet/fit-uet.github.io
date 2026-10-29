import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createAcademicFixture} from './fixture';
import {db} from '../../server/db';
import {commit,snapshot} from '../../server/academic/store';
import {createSemester,createClass,reviewerPreview,applyReviewers} from '../../server/academic/service';
import {updateCampaign} from '../../server/academic/campaigns';
import {newEnrollment} from '../../server/academic/domain';
import {reviewerResetPreview,resetProjectReviewers} from '../../server/academic/reviewerReset';
const admin={id:1,email:'admin@vnu.edu.vn',role:'admin' as const,name:'Khoa'};
let client:Awaited<ReturnType<typeof createAcademicFixture>>;
beforeEach(async()=>{client=await createAcademicFixture();});afterEach(()=>client.close());
async function seed(year=2026,code='INT3132',studentId='24020001'){
  await createSemester(admin,year,'1');const c=await createClass(admin,{semesterId:`${year}-${year+1}-1`,courseCode:code,section:'1'}),p=(await snapshot()).campaigns!.find(p=>p.id===c.campaignId)!;
  if(p.status!=='active')await updateCampaign(admin,p.id,{expectedRevision:p.revision,status:'active'});
  const s=await snapshot(),e=newEnrollment(c,{studentId,name:'SV kiểm thử'});e.topic='Đề tài giữ nguyên';
  e.assignments=[{id:'p-'+e.id,lecturerId:1,role:'primary',assignedAt:'2026-09-01'},{id:'c-'+e.id,lecturerId:3,role:'co',assignedAt:'2026-09-01'},{id:'r-'+e.id,lecturerId:2,role:'reviewer',assignedAt:'2026-09-01'}];await commit(s,1,'admin.fixture',{enrollments:[e]});return{c,e};
}
const reason='Gỡ phân công cũ; người phụ trách phân công lại khi sẵn sàng.';
test('reset removes only reviewers in the chosen project campaign, preserves content and audits before/after',async()=>{
  const a=await seed(),b=await seed(2026,'INT3131','24020002');await seed(2027,'INT3132','24020003');
  const before=await snapshot(),preview=await reviewerResetPreview(admin,a.c.campaignId);assert.equal(preview.assignments,2);assert.deepEqual((await snapshot()).enrollments,before.enrollments);
  assert.equal((await resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:preview.revision,reason})).changed,2);
  const after=await snapshot();for(const old of before.enrollments)assert.deepEqual(after.enrollments.find(e=>e.id===old.id),[a.e.id,b.e.id].includes(old.id)?{...old,assignments:old.assignments.filter(a=>a.role!=='reviewer'),revision:old.revision+1}:old);
  const command=(await db.execute("SELECT * FROM academic_commands WHERE action='admin.reviewers.reset'")).rows[0];assert.equal(command.reason,reason);const payload=JSON.parse(String(command.payload));assert.equal(payload.before.enrollments.length,2);assert.ok(payload.before.enrollments.every(e=>e.assignments.some(a=>a.role==='reviewer')));assert.equal(payload.events,undefined);
  assert.equal((await resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:after.revision,reason})).changed,0);assert.equal((await snapshot()).revision,after.revision);
});
test('graded zero or locked enrollment blocks the whole reset without partial changes',async()=>{
  const a=await seed(),b=await seed(2026,'INT3131','24020002');let s=await snapshot();const e=structuredClone(s.enrollments.find(e=>e.id===b.e.id)!);
  e.evaluations[e.versions[0].id]={reviewer:{score:0,comment:'Bỏ môn',lecturerId:2,assignmentId:e.assignments.find(a=>a.role==='reviewer')!.id,submittedAt:'2026-10-01',updatedAt:'2026-10-01'}};await commit(s,1,'admin.fixture.grade',{enrollments:[e]});
  let before=await snapshot();await assert.rejects(resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:before.revision,reason}),{code:'EVALUATED_ASSIGNMENT'});assert.deepEqual(await snapshot(),before);
  s=await snapshot();e.evaluations={};e.lockedAt='2026-10-01';await commit(s,1,'admin.fixture.lock',{enrollments:[e]});before=await snapshot();await assert.rejects(resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:before.revision,reason}),{code:'EVALUATED_ASSIGNMENT'});assert.deepEqual(await snapshot(),before);
});
test('reset enforces admin, revision, reason and campaign status and invalidates older assignment previews',async()=>{
  const a=await seed();await assert.rejects(reviewerResetPreview({...admin,id:2,role:'lecturer'},a.c.campaignId),{code:'ADMIN_ONLY'});
  const preview=await reviewerResetPreview(admin,a.c.campaignId);await assert.rejects(resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:preview.revision-1,reason}),{code:'REVISION_CONFLICT'});await assert.rejects(resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:preview.revision,reason:''}),{code:'REASON_REQUIRED'});
  const old=await reviewerPreview(admin,a.c.semesterId,{});await resetProjectReviewers(admin,a.c.campaignId,{expectedRevision:preview.revision,reason});await assert.rejects(applyReviewers(admin,old.id),{code:'STALE_PREVIEW'});
  let s=await snapshot();const internship=s.campaigns!.find(p=>p.id===`${a.c.semesterId}:internship`)!;await updateCampaign(admin,internship.id,{expectedRevision:internship.revision,status:'active'});await assert.rejects(reviewerResetPreview(admin,internship.id),{code:'PROJECT_REQUIRED'});
  s=await snapshot();const p=s.campaigns!.find(p=>p.id===a.c.campaignId)!;await updateCampaign(admin,p.id,{expectedRevision:p.revision,status:'archived',reason:'Kết thúc đợt'});await assert.rejects(reviewerResetPreview(admin,p.id),{code:'CAMPAIGN_READ_ONLY'});
});
