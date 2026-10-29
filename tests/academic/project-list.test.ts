import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAcademicFixture} from './fixture';
import {db} from '../../server/db';
import {commit,snapshot,AcademicError} from '../../server/academic/store';
import {createSemester,createClass,enrollmentAction} from '../../server/academic/service';
import {updateCampaign} from '../../server/academic/campaigns';
import {newEnrollment,currentVersion} from '../../server/academic/domain';
import {changeTopic,approveTopic} from '../../server/academic/topics';
import {saveProjectRows} from '../../server/academic/projectList';
import {previewProjectDeletion,applyProjectDeletion,projectDeletionStatus} from '../../server/academic/projectDeletion';
import {drainProjectCleanup} from '../../server/academic/projectCleanup';
import {readCampaignEnrollments,readEnrollment,readCampaignDetail,invalidateReadCache} from '../../server/academic/reads';
import {previewProjectMembership,migrateProjectMembership} from '../../server/academic/projectMembership';
const admin={id:1,email:'admin@vnu.edu.vn',role:'admin' as const,name:'Khoa'},alpha={id:2,email:'alpha@vnu.edu.vn',role:'lecturer' as const,name:'TS. Alpha'};
let client:Awaited<ReturnType<typeof createAcademicFixture>>;
beforeEach(async()=>{client=await createAcademicFixture();invalidateReadCache();});afterEach(()=>client.close());
async function seed(code='INT3132',sid='24020001',primary=1){
  await createSemester(admin,2026,'1');let s=await snapshot(),c=s.classes.find(c=>c.courseCode===code);if(!c)c=await createClass(admin,{semesterId:'2026-2027-1',courseCode:code,section:'1'});
  s=await snapshot();const p=s.campaigns!.find(p=>p.id===c.campaignId)!;if(p.status!=='active')await updateCampaign(admin,p.id,{expectedRevision:p.revision,status:'active'});
  s=await snapshot();c=s.classes.find(x=>x.id===c.id)!;const e=newEnrollment(c,{studentId:sid,name:'SV '+sid});e.assignments=[{id:randomUUID(),lecturerId:primary,role:'primary',assignedAt:new Date().toISOString()}];changeTopic(e,'Đề tài '+sid);approveTopic(s,c,e,{...alpha,email:s.lecturers.find(l=>l.id===primary)!.email});
  await commit(s,1,'admin.fixture.seed',{enrollments:[e],users:[{studentId:sid,email:e.email,name:e.name,dob:'',className:''}]});return{c,e,actor:{id:Number((await db.execute({sql:'SELECT id FROM users WHERE email=?',args:[e.email]})).rows[0].id),role:'student' as const,email:e.email,name:e.name}};
}
async function fresh(id:string){return(await snapshot()).enrollments.find(e=>e.id===id)!;}
async function remove(campaign:string,ids:string[]){const p=await previewProjectDeletion(admin,campaign,{enrollmentIds:ids});return applyProjectDeletion(admin,campaign,p.id,{reason:'Xóa lần học theo Khoa'});}
test('bulk saves valid rows, rejects stale/unauthorized rows and rolls back all fields of an invalid row',async()=>{
  const a=await seed(),b=await seed('INT3132','24020002'),other=await seed('INT3131','24020003',2);
  const result=await saveProjectRows(alpha,a.c.campaignId,{rows:[{enrollmentId:a.e.id,expectedRevision:a.e.revision,topic:{title:'Tên được sửa và duyệt'}},{enrollmentId:b.e.id,expectedRevision:b.e.revision,topic:{title:'Không lưu một nửa'},grades:{advisor:{score:11,comment:'Sai',submissionVersionId:currentVersion(b.e).id}}},{enrollmentId:other.e.id,expectedRevision:other.e.revision,topic:{title:'Không được sửa'}}]});
  assert.deepEqual(result.results.map(r=>r.ok),[true,false,false]);assert.equal((await fresh(a.e.id)).topic,'Tên được sửa và duyệt');assert.equal((await fresh(a.e.id)).topicReview.status,'approved');assert.equal((await fresh(b.e.id)).topic,b.e.topic);
  const stale=await saveProjectRows(alpha,a.c.campaignId,{rows:[{enrollmentId:a.e.id,expectedRevision:a.e.revision,topic:{title:'Stale'}}]});assert.equal(stale.results[0].error.code,'REVISION_CONFLICT');
  await assert.rejects(saveProjectRows(a.actor,a.c.campaignId,{rows:[]}),{code:'MANAGEMENT_ONLY'});
});
test('bulk quota checks use final assignment loads and do not depend on intermediate swaps',async()=>{
  const a=await seed(),b=await seed('INT3132','24020002',2),c=await seed('INT3131','24020003',3);let s=await snapshot();
  a.e.assignments.push({id:randomUUID(),lecturerId:2,role:'reviewer',assignedAt:'now'});b.e.assignments.push({id:randomUUID(),lecturerId:3,role:'reviewer',assignedAt:'now'});
  await commit(s,1,'admin.fixture.reviewers',{enrollments:[a.e,b.e],quotas:[{id:'q2',semesterId:a.c.semesterId,lecturerId:2,maxReviews:1,internshipMax:null},{id:'q3',semesterId:a.c.semesterId,lecturerId:3,maxReviews:1,internshipMax:null}]});
  const x=await fresh(a.e.id),y=await fresh(b.e.id);const result=await saveProjectRows(admin,a.c.campaignId,{rows:[{enrollmentId:x.id,expectedRevision:x.revision,assignments:[{role:'primary',lecturerId:1},{role:'reviewer',lecturerId:3}]},{enrollmentId:y.id,expectedRevision:y.revision,assignments:[{role:'primary',lecturerId:1},{role:'reviewer',lecturerId:2}]}]});assert.ok(result.results.every(r=>r.ok));
});
test('student-list projection filters independent stages, returns one version and never leaks grades to student/co',async()=>{
  const a=await seed();let s=await snapshot(),e=await fresh(a.e.id);e.evaluations[currentVersion(e).id]={advisor:{score:0,comment:'Bỏ môn',lecturerId:1,assignmentId:e.assignments[0].id,submittedAt:'now',updatedAt:'now'}};e.assignments.push({id:randomUUID(),lecturerId:2,role:'co',assignedAt:'now'});await commit(s,1,'admin.fixture.grade',{enrollments:[e]});
  const rows=await readCampaignEnrollments(admin,a.c.campaignId,{projection:'student-list',assignmentStatus:'missingReviewer',gradeStatus:'partial',submissionStatus:'notSubmitted'});assert.equal(rows.total,1);assert.equal(rows.items[0].versions.length,1);assert.equal(rows.items[0].evaluations[currentVersion(e).id].advisor.score,0);assert.equal(rows.items[0].status,undefined);
  for(const actor of[a.actor,{id:3,email:'beta@vnu.edu.vn',role:'lecturer' as const,name:'Beta'}]){const list=await readCampaignEnrollments(actor,a.c.campaignId,{projection:'student-list'});assert.equal(list.items[0].evaluations,undefined);assert.equal(list.items[0].finalScore,undefined);}
});
test('hard deletion purges only its course content, audits, previews, private chat and files; keeps account and group chat',async()=>{
  const a=await seed(),b=await seed('INT3131');let s=await snapshot(),e=await fresh(a.e.id);e.versions[0].objectKey='deleted/report.pdf';e.topic='SECRET_TOPIC';await commit(s,1,'admin.fixture.secret',{enrollments:[e]});
  await db.execute({sql:'INSERT INTO academic_messages(id,class_id,enrollment_id,lecturer_id,sender_id,body,created_at,attachment_key) VALUES(?,?,?,?,?,?,?,?)',args:['private',a.c.id,e.id,1,a.actor.id,'SECRET_CHAT','now','deleted/chat.pdf']});
  await db.execute({sql:'INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at) VALUES(?,?,?,?,?,?)',args:['group',a.c.id,1,a.actor.id,'GROUP_KEEP','now']});await db.execute('INSERT INTO academic_message_reads VALUES(\'private\',1)');
  const preview=await previewProjectDeletion(admin,a.c.campaignId,{enrollmentIds:[e.id]});assert.equal(preview.rows[0].files,2);const result=await applyProjectDeletion(admin,a.c.campaignId,preview.id,{reason:'Xóa'});assert.equal(result.status,'complete');
  assert.equal((await snapshot()).enrollments.some(x=>x.id===e.id),false);assert.ok(await fresh(b.e.id));assert.ok((await db.execute({sql:'SELECT id FROM users WHERE id=?',args:[a.actor.id]})).rows.length);assert.equal((await db.execute("SELECT * FROM academic_messages WHERE id='private'")).rows.length,0);assert.equal((await db.execute("SELECT * FROM academic_messages WHERE id='group'")).rows.length,1);
  for(const table of['academic_commands','academic_previews'])assert.ok(!(JSON.stringify((await db.execute('SELECT * FROM '+table)).rows)).includes('SECRET_TOPIC'));
  assert.deepEqual(await applyProjectDeletion(admin,a.c.campaignId,preview.id,{reason:'Retry'}),result);
  await assert.rejects(readEnrollment(a.actor,e.id));assert.equal((await readCampaignEnrollments(a.actor,a.c.campaignId)).total,1);
});
test('file cleanup survives failures, retries without resurrecting membership and preserves reused keys',async()=>{
  const a=await seed();await db.execute({sql:'INSERT INTO academic_file_cleanup VALUES(?,?,?,?,0,NULL)',args:['f','j','report','bad/key']});let attempts=0;
  await drainProjectCleanup(async()=>{attempts++;throw Error('network');});assert.equal(attempts,1);assert.equal(Number((await db.execute("SELECT attempts FROM academic_file_cleanup WHERE id='f'")).rows[0].attempts),1);
  await drainProjectCleanup(async()=>{attempts++;});assert.equal(attempts,2);assert.equal((await db.execute('SELECT * FROM academic_file_cleanup')).rows.length,0);
});
test('deletion enforces actor, campaign, current preview and archive; removed project blocks all access',async()=>{
  const a=await seed();await assert.rejects(previewProjectDeletion(alpha,a.c.campaignId,{enrollmentIds:[a.e.id]}),{code:'ADMIN_ONLY'});
  const p=await previewProjectDeletion(admin,a.c.campaignId,{enrollmentIds:[a.e.id]});await enrollmentAction(admin,a.e.id,{expectedRevision:a.e.revision,title:'Khác',reason:'Khoa sửa'},'topic');await assert.rejects(applyProjectDeletion(admin,a.c.campaignId,p.id,{reason:'Xóa'}),{code:'STALE_PREVIEW'});
  await readCampaignDetail(a.actor,a.c.campaignId);await remove(a.c.campaignId,[a.e.id]);await assert.rejects(readCampaignDetail(a.actor,a.c.campaignId),{code:'CAMPAIGN_ACCESS_DENIED'});
  await assert.rejects(enrollmentAction(admin,a.e.id,{expectedRevision:1,status:'active'},'status'));
});
test('membership migration previews, blocks withdrawn rows and strips only project status idempotently',async()=>{
  const a=await seed();let e=await fresh(a.e.id);e.status='withdrawn';await db.execute({sql:'UPDATE academic_enrollments SET data=? WHERE id=?',args:[JSON.stringify(e),e.id]});assert.equal((await previewProjectMembership(db)).conflicts.length,1);await assert.rejects(migrateProjectMembership(db));
  e.status='active';await db.execute({sql:'UPDATE academic_enrollments SET data=? WHERE id=?',args:[JSON.stringify(e),e.id]});await migrateProjectMembership(db);const after=await fresh(e.id);const expected={...e,revision:e.revision+1};delete expected.status;assert.deepEqual(after,expected);
  const revision=(await snapshot()).revision;await migrateProjectMembership(db);assert.equal((await snapshot()).revision,revision);
});
test('deletion scrubs its import sources and preserves the same student/class code in another semester',async()=>{
 const a=await seed();await createSemester(admin,2027,'1');const c=await createClass(admin,{semesterId:'2027-2028-1',courseCode:'INT3132',section:'1'});let s=await snapshot();const other=newEnrollment(c,{studentId:a.e.studentId,name:'Other term'});await commit(s,1,'admin.fixture.other',{enrollments:[other]});
 const {savePreview}=await import('../../server/academic/store');s=await snapshot();
 const current=await savePreview(1,'import',s,{semesterId:a.c.semesterId,rows:[{studentId:a.e.studentId,classCode:a.c.code,topic:'DELETE_IMPORT'}]});
 const future=await savePreview(1,'import',s,{semesterId:c.semesterId,rows:[{studentId:a.e.studentId,classCode:c.code,topic:'KEEP_IMPORT'}]});
 await remove(a.c.campaignId,[a.e.id]);assert.ok(await fresh(other.id));assert.equal((await db.execute({sql:'SELECT 1 FROM academic_previews WHERE id=?',args:[current.id]})).rows.length,0);assert.equal((await db.execute({sql:'SELECT 1 FROM academic_previews WHERE id=?',args:[future.id]})).rows.length,1);
});
test('cleanup preserves keys used by another enrollment, academic group chat and legacy sources',async()=>{
 const a=await seed(),b=await seed('INT3131');let s=await snapshot();b.e.versions[0].objectKey='shared/report';await commit(s,1,'admin.fixture.shared',{enrollments:[b.e]});
 await db.execute({sql:'INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at,attachment_key) VALUES(?,?,?,?,?,?,?)',args:['g',a.c.id,1,1,'Keep','now','shared/group']});
 await db.execute("INSERT INTO final_reports(id,user_id,object_key) VALUES(1,1,'shared/legacy')");
 for(const [i,key]of ['shared/report','shared/group','shared/legacy'].entries())await db.execute({sql:'INSERT INTO academic_file_cleanup VALUES(?,?,?,?,0,NULL)',args:[String(i),'j','report',key]});
 let calls=0;await drainProjectCleanup(async()=>{calls++;});assert.equal(calls,0);assert.equal((await db.execute('SELECT * FROM academic_file_cleanup')).rows.length,0);
});
test('membership migration rejects a writer racing the preview and blocks withdrawn status at the database guard',async()=>{
 const a=await seed();const e={...await fresh(a.e.id),status:'active'};await db.execute({sql:'UPDATE academic_enrollments SET data=? WHERE id=?',args:[JSON.stringify(e),e.id]});
 let raced=false;const racing={execute:async(input:any)=>{const result=await db.execute(input);if(!raced&&typeof input==='string'&&input.includes('UNION ALL SELECT e.id')){raced=true;const s=await snapshot();await commit(s,1,'admin.fixture.race',{enrollments:[{...e,status:'withdrawn'}]});}return result;}};
 await assert.rejects(migrateProjectMembership(racing as any),/ACADEMIC_STALE/);assert.equal((await fresh(e.id)).status,'withdrawn');
 const s=await snapshot();await assert.rejects(db.execute({sql:"INSERT INTO academic_commands VALUES(?,?,?,?,?,?,?)",args:[randomUUID(),s.revision,0,'system.project_membership.migrate','Guard',JSON.stringify({membershipMigration:true}),'now']}),/PROJECT_MEMBERSHIP_CONFLICT/);assert.equal((await fresh(e.id)).status,'withdrawn');
});
test('a rejected row cannot free quota for another row or pollute its audit before image',async()=>{
 const a=await seed(),b=await seed('INT3132','24020002'),pool=await seed('INT3131','24020003',3);let s=await snapshot();a.e.assignments.push({id:randomUUID(),lecturerId:2,role:'reviewer',assignedAt:'now'});await commit(s,1,'admin.fixture.load',{enrollments:[a.e],quotas:[{id:'limit',semesterId:a.c.semesterId,lecturerId:2,maxReviews:1,internshipMax:null}]});
 // Lecturer 2 must also be in the semester's eligible supervising pool.
 s=await snapshot();pool.e.assignments.push({id:randomUUID(),lecturerId:2,role:'co',assignedAt:'now'});await commit(s,1,'admin.fixture.pool',{enrollments:[pool.e]});
 const before=await fresh(a.e.id),second=await fresh(b.e.id);const result=await saveProjectRows(admin,a.c.campaignId,{rows:[{enrollmentId:before.id,expectedRevision:before.revision,assignments:[{lecturerId:1,role:'primary'},{lecturerId:3,role:'reviewer'}],topic:{title:'',reason:'Invalid'}},{enrollmentId:second.id,expectedRevision:second.revision,assignments:[{lecturerId:1,role:'primary'},{lecturerId:2,role:'reviewer'}]}]});
 assert.deepEqual(result.results.map(r=>r.ok),[false,false]);assert.deepEqual(await fresh(before.id),before);
 const good=await saveProjectRows(alpha,a.c.campaignId,{rows:[{enrollmentId:before.id,expectedRevision:before.revision,topic:{title:'Tên mới'}}]});assert.equal(good.results[0].ok,true);
 const audit=(await db.execute("SELECT payload FROM academic_commands WHERE action='lecturer.project.bulk' ORDER BY rowid DESC LIMIT 1")).rows[0];assert.equal(JSON.parse(String(audit.payload)).before.enrollments[0].topic,before.topic);
});
test('schema startup never marks failed topic metadata migration as ready',async()=>{
 const {initAcademicSchema}=await import('../../server/academic/schema');await db.execute('DELETE FROM academic_schema_migrations WHERE version IN (3,4)');
 const failing={...db,execute:async(input:any)=>{if(typeof input==='string'&&input.startsWith("SELECT 'revision' kind"))throw Error('Migration read blocked');return db.execute(input);}};
 await assert.rejects(initAcademicSchema(failing),/Migration read blocked/);assert.equal((await db.execute('SELECT version FROM academic_schema_migrations WHERE version IN (3,4)')).rows.length,0);
});
test('transient cohort read errors cannot grant legacy access to a deleted project-only account',async()=>{
 const {isListedStudentCohortException}=await import('../../server/services/cohorts');const {setDb}=await import('../../server/db');const original=db;let calls=0;
 setDb({...original,execute:async(input:any)=>{calls++;if(calls===1)throw Error('reads are blocked');return {rows:[{id:1}]} as any;}});
 try{await assert.rejects(isListedStudentCohortException('24020001@vnu.edu.vn'),/reads are blocked/);assert.equal(calls,1);}finally{setDb(original);}
});
