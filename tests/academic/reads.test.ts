import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {createAcademicFixture} from './fixture';
import {db,setDb} from '../../server/db';
import {JWT_SECRET} from '../../server/config';
import {commit,snapshot} from '../../server/academic/store';
import {createSemester,createClass} from '../../server/academic/service';
import {newEnrollment,newClass,newSemester,currentVersion,getClass} from '../../server/academic/domain';
import {campaignDetail,campaignEnrollments,updateCampaign} from '../../server/academic/campaigns';
import {readCampaignDetail,readCampaignCatalog,readCampaignEnrollments,readEnrollment,readCommunicationContext,readContext,recordCte,accessRecordCte} from '../../server/academic/reads';
import {academicRouter} from '../../server/academic/routes';
import {legacyRows,legacyPagingMiddleware} from '../../server/services/legacyPaging';
import {jsonCacheMiddleware} from '../../server/services/httpCache';
import {campaignExport} from '../../server/academic/campaignExports';
import {unreadCounts} from '../../server/services/unread';
import type {AuthenticatedUser} from '../../server/types';
let client:Awaited<ReturnType<typeof createAcademicFixture>>,campaignId:string,firstClass:string;
const admin:AuthenticatedUser={id:1,email:'admin@vnu.edu.vn',role:'admin',name:'Khoa'};
const alpha:AuthenticatedUser={id:2,email:'alpha@vnu.edu.vn',role:'lecturer',name:'Alpha'};
const sv:AuthenticatedUser={id:100,email:'24020000@vnu.edu.vn',role:'student',name:'Đỗ Ánh'};
beforeEach(async()=>{
 client=await createAcademicFixture();const sem=await createSemester(admin,2026,'1');
 const a=await createClass(admin,{semesterId:sem.id,courseCode:'INT3132',section:'1'}),b=await createClass(admin,{semesterId:sem.id,courseCode:'INT3131',section:'1'});
 campaignId=a.campaignId;firstClass=a.id;
 let s=await snapshot();await updateCampaign(admin,campaignId,{expectedRevision:s.campaigns!.find(p=>p.id===campaignId)!.revision,status:'active'});s=await snapshot();
 const enrollments=Array.from({length:84},(_,i)=>{
  const c=getClass(s,i<80?a.id:b.id),e=newEnrollment(c,{studentId:String(24020000+(i<80?i:i-80)),name:i%80===0?'Đỗ Ánh':`Sinh viên ${i}`});
  e.topic=`Đề tài ${i}`;e.topicReview!.status='approved';e.topicReview!.version=1;
  e.assignments=[{id:`p-${i}`,role:'primary',lecturerId:i%2===0?1:3,assignedAt:'2026-09-01T00:00:00Z'},{id:`r-${i}`,role:'reviewer',lecturerId:2,assignedAt:'2026-09-01T00:00:00Z'}];
  if(i%4!==0){const v=currentVersion(e);v.state='submitted';v.topicVersion=1;v.title=e.topic;v.objectKey=`fake/${i}.pdf`;v.filename='report.pdf';v.size=10;v.slidesUrl='https://drive.google.com/file/d/slides/view';v.demoUrl='https://drive.google.com/file/d/demo/view';}
  if(i%4===2||i%4===3){const v=currentVersion(e);e.evaluations[v.id]={advisor:{score:8,comment:'OK',lecturerId:i%2===0?1:3,assignmentId:`p-${i}`,submittedAt:'2026-12-14',updatedAt:'2026-12-14'}};if(i%4===3)e.evaluations[v.id].reviewer={score:8.5,comment:'OK',lecturerId:2,assignmentId:`r-${i}`,submittedAt:'2026-12-14',updatedAt:'2026-12-14'};}
  if(i===3)e.lockedAt='2026-12-20';if(i===5)e.status='withdrawn';return e;
 });
 await commit(s,1,'admin.test.seed',{enrollments,users:enrollments.slice(0,80).map(e=>({studentId:e.studentId,email:e.email,name:e.name,dob:'',className:''}))});
});
afterEach(()=>client.close());
test('read models scope rows before hydration and lightweight access never joins legacy reports or grades',async()=>{
 for(const [actor,expected]of [[admin,84],[alpha,42],[sv,2]] as const){const row=(await db.execute({sql:`${recordCte} SELECT count(*) n FROM raw`,args:[actor.role,actor.email,actor.role==='student'?0:1,campaignId,'']})).rows[0];assert.equal(Number(row.n),expected);}
 assert.ok(!accessRecordCte.includes('JOIN final_reports'));assert.ok(!accessRecordCte.includes('JOIN grades'));
 const rows=(await db.execute({sql:`${accessRecordCte} SELECT j FROM records`,args:[sv.role,sv.email,0,campaignId,'']})).rows;assert.equal(rows.length,2);
 for(const row of rows){const data=JSON.parse(String(row.j));assert.equal(data.email,sv.email);for(const field of['versions','evaluations','internshipGrade'])assert.equal(data[field],undefined);}
});
test('project page revalidation reuses current revisions, honors refresh and never returns stale data on database failure',async()=>{
 const original=db,calls:string[]=[];let blocked=false;
 setDb({...original,execute:async(input:any)=>{const sql=typeof input==='string'?input:input.sql;calls.push(sql);if(blocked)throw Error('daily row read limit');return original.execute(input);}});
 const fullReads=()=>calls.filter(sql=>sql.includes("'pageCount'")).length;
 try{
  const first=await readCampaignEnrollments(sv,campaignId,{projection:'student-list'},false,undefined,false);const before=fullReads();assert.equal(before,1);
  assert.deepEqual(await readCampaignEnrollments(sv,campaignId,{projection:'student-list'}),first);assert.equal(fullReads(),before);
  await readCampaignEnrollments(sv,campaignId,{projection:'student-list'},false,undefined,false);assert.equal(fullReads(),before+1);
  const state=await snapshot(),changed=structuredClone(state.enrollments.find(e=>e.id===first.items[0].id)!);changed.name='Tên đã cập nhật';await commit(state,1,'admin.fixture.cache',{enrollments:[changed]});
  const updated=await readCampaignEnrollments(sv,campaignId,{projection:'student-list'});assert.equal(updated.items.find(e=>e.id===changed.id).name,changed.name);assert.equal(fullReads(),before+2);
  blocked=true;await assert.rejects(readCampaignEnrollments(sv,campaignId,{projection:'student-list'}),/daily row read limit/);
 }finally{setDb(original);}
});
test('scoped SQL lists preserve existing permission, filter, count and grading semantics',async()=>{
 for(const actor of [admin,alpha,sv])for(const filter of [{},{classId:firstClass},{status:'missing'},{status:'partial'},{status:'complete'},{status:'locked'},{status:'notSubmitted'},{status:'advisorMissing'},{status:'reviewerMissing'},{lecturerId:'2'},{topicStatus:'approved'},{q:'đỗ ánh'}]){
  const expected=await campaignEnrollments(actor,campaignId,filter);const actual=await readCampaignEnrollments(actor,campaignId,filter);
  assert.equal(actual.total,expected.total,JSON.stringify({role:actor.role,filter}));assert.equal(actual.studentCount,expected.studentCount);
  assert.deepEqual(actual.items.map(e=>e.id),expected.items.map(e=>e.id));
  assert.deepEqual(actual.items.map(e=>e.gradeStatus),expected.items.map(e=>e.gradeStatus));
 }
});
test('read projections only return a page, omit history and never expose student grades',async()=>{
 const page=await readCampaignEnrollments(admin,campaignId,{projection:'students',page:2,limit:25});assert.equal(page.items.length,25);assert.equal(page.total,84);
 assert.ok(page.items.every(e=>e.versions.length===1&&!('evaluations'in e)&&!('finalScore'in e)));
 const own=await readCampaignEnrollments(sv,campaignId,{projection:'grades'});assert.equal(own.total,2);assert.ok(own.items.every(e=>e.email===sv.email&&!('evaluations'in e)&&!('finalScore'in e)));
 const details=await readEnrollment(sv,own.items[0].id);assert.equal(details.view.id,own.items[0].id);
 await assert.rejects(readEnrollment(sv,page.items.find(e=>e.email!==sv.email)!.id),(e:any)=>e.code==='CLASS_ACCESS_DENIED');
});
test('separate roster omits numerical grades and grading progress aggregates all filtered pages',async()=>{
 const roster=await readCampaignEnrollments(admin,campaignId,{projection:'students'});
 for(const e of roster.items)for(const field of ['evaluations','internshipGrade','finalScore'])assert.ok(!(field in e));
 const grades=await readCampaignEnrollments(admin,campaignId,{projection:'grades',limit:1,classId:firstClass});
 assert.equal(grades.items.length,1);assert.deepEqual((grades as any).gradingSummary,{advisorSubmitted:40,reviewerSubmitted:20,completed:20,locked:1});
});
test('light campaign sections omit content and summary counts match the old model',async()=>{
 const old=await campaignDetail(admin,campaignId);const light=await readCampaignDetail(admin,campaignId,'base'),overview=await readCampaignDetail(admin,campaignId,'overview');
 assert.equal(light.campaign.enrollmentCount,old.campaign.enrollmentCount);assert.equal(light.campaign.studentCount,old.campaign.studentCount);assert.deepEqual(light.stats,{});assert.equal(light.campaign.settings.plan,'');
 for(const key of ['studentCount','enrollmentCount','submitted','graded','advisorMissing','reviewerMissing'])assert.equal(overview.stats[key],old.stats[key],key);
 const catalog=await readCampaignCatalog(sv);assert.equal(catalog.campaigns.find(p=>p.id===campaignId)!.enrollmentCount,2);
});
test('base, content and catalog never execute a submission/grade read and indexed student/detail lookups stay bounded',async()=>{
 const original=db,sqls:string[]=[];
 setDb({...original,execute:async(input:any)=>{const sql=typeof input==='string'?input:input.sql;sqls.push(sql);return original.execute(input);}});
 try{
  for(const section of ['base','content','management']){
   sqls.length=0;await readCampaignDetail(sv,campaignId,section,false);
   const query=sqls.find(sql=>sql.includes("SELECT 'revision' kind"))!;
   // An unused MATERIALIZED CTE is safe; referencing records even under a
   // false scalar WHERE forces its expensive hydration on D1.
   assert.ok(!query.includes("SELECT 'enrollments',j FROM records"));
   assert.match(query,/lower\(json_extract\(e.data,'\$\.email'\)\)=actor.email/);
   const plan=(await original.execute({sql:'EXPLAIN QUERY PLAN '+query,args:[sv.role,sv.email,0,campaignId,'']})).rows;
   assert.ok(plan.some(r=>String(r.detail).includes('academic_enrollment_email')));
   assert.ok(!plan.some(r=>/SEARCH (fr|g) |SCAN (fr|g)\b/.test(String(r.detail))));
  }
  sqls.length=0;const own=await readCampaignEnrollments(sv,campaignId);
  sqls.length=0;await readEnrollment(sv,own.items[0].id);
  assert.ok(sqls.some(sql=>sql.includes('e.id=actor.enrollmentId')));
 }finally{setDb(original);}
});

test('metadata cache rechecks lecturer identity, isolates databases and honors explicit refresh',async()=>{
 await readCampaignDetail(alpha,campaignId,'base');
 await db.execute("UPDATE lecturers SET email='revoked@vnu.edu.vn' WHERE id=1");
 await assert.rejects(readCampaignDetail(alpha,campaignId,'base'),(e:any)=>e.code==='CAMPAIGN_ACCESS_DENIED');
 const original=db;let reads=0;
 setDb({...original,execute:async input=>{const sql=typeof input==='string'?input:input.sql;if(sql.includes("SELECT 'revision' kind"))reads++;return original.execute(input);}});
 try{await readCampaignDetail(admin,campaignId,'base');assert.equal(reads,1);await readCampaignDetail(admin,campaignId,'base');assert.equal(reads,1);await readCampaignDetail(admin,campaignId,'base',false);assert.equal(reads,2);}finally{setDb(original);}
});

test('legacy access is revalidated without an academic revision change and project scopes never hydrate unrelated legacy rows',async()=>{
 const sem=newSemester(2025,'summer'),c={...newClass(sem.id,'INT4002','legacy'),legacy:true,status:'active' as const};
 const e={...newEnrollment(c,{studentId:'23999999',name:'Legacy student'}),legacy:true};
 let s=await snapshot();await commit(s,admin.id,'admin.test.legacy',{semesters:[sem],classes:[c],users:[{studentId:e.studentId,email:e.email,name:e.name,dob:'',className:''}],enrollments:[e]});
 s=await snapshot();await commit(s,admin.id,'admin.test.legacy.campaign',{campaigns:[{...s.campaigns!.find(p=>p.id===c.campaignId)!,legacy:true}]});
 const u=(await db.execute({sql:'SELECT id FROM users WHERE student_id=?',args:[e.studentId]})).rows[0];
 await db.execute({sql:"INSERT INTO advisor_assignments(user_id,lecturer_id,role) VALUES(?,1,'primary')",args:[u.id]});
 await readCampaignDetail(alpha,c.campaignId,'base');await readCampaignCatalog(alpha,'base');
 const revision=(await db.execute('SELECT revision FROM academic_meta')).rows[0].revision;
 await db.execute({sql:'DELETE FROM advisor_assignments WHERE user_id=?',args:[u.id]});
 assert.equal((await db.execute('SELECT revision FROM academic_meta')).rows[0].revision,revision);
 await assert.rejects(readCampaignDetail(alpha,c.campaignId,'base'),(err:any)=>err.code==='CAMPAIGN_ACCESS_DENIED');
 assert.ok(!(await readCampaignCatalog(alpha,'base')).campaigns.some(p=>p.id===c.campaignId));
 const rows=(await db.execute({sql:`${recordCte} SELECT count(*) n FROM legacy_rows`,args:[admin.role,admin.email,1,campaignId,'']})).rows;
 assert.equal(Number(rows[0].n),0);
 const ctx=await readContext(alpha,campaignId,'management');assert.ok(ctx.classes.every(c=>c.campaignId===campaignId));
});
test('ordinary project reads use bounded database calls and never run broad snapshot hydration',async()=>{
 const original=db;let calls=0;const sqls:string[]=[];
 setDb({...original,execute:async input=>{calls++;sqls.push(typeof input==='string'?input:input.sql);return original.execute(input);}});
 try{await readCampaignCatalog(admin);assert.equal(calls,1);calls=0;await readCampaignDetail(admin,campaignId,'overview');assert.equal(calls,1);calls=0;await readCampaignEnrollments(admin,campaignId,{projection:'reports'});assert.equal(calls,1);calls=0;const row=await readCampaignEnrollments(sv,campaignId);calls=0;await readEnrollment(sv,row.items[0].id);assert.equal(calls,1);assert.ok(!sqls.some(sql=>sql.includes("SELECT 'enrollments',data FROM academic_enrollments")));}finally{setDb(original);}
});
async function serve(app:express.Express,run:(base:string)=>Promise<void>){const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));try{await run(`http://127.0.0.1:${(server.address()as{port:number}).port}`);}finally{await new Promise<void>(r=>server.close(()=>r()));}}
test('ETag validates actual data and permission changes before returning 304',async()=>{
 const original=db,queries:string[]=[];
 setDb({...original,execute:async(input:any)=>{queries.push(typeof input==='string'?input:input.sql);return original.execute(input);}});
 const app=express();app.use(academicRouter);const headers={Authorization:`Bearer ${jwt.sign({email:alpha.email},JWT_SECRET)}`,'Cache-Control':'max-age=0'};
 try{await serve(app,async base=>{
  const path=`${base}/api/campaigns/${campaignId}/enrollments?projection=students`;
  const first=await fetch(path,{headers});assert.equal(first.status,200);const tag=first.headers.get('ETag')!;assert.ok(tag);await first.text();
  queries.length=0;
  const unchanged=await fetch(path,{headers:{...headers,'If-None-Match':tag}});assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  assert.ok(!queries.some(sql=>sql.includes("'pageCount'")),'Warm 304 must not re-run the full page query.');
  const forced=await fetch(path,{headers:{...headers,'If-None-Match':tag,'Cache-Control':'no-cache'}});assert.equal(forced.status,304);
  assert.ok(queries.some(sql=>sql.includes("'pageCount'")),'Force refresh must re-read the page even when it ultimately returns 304.');
  await db.execute("UPDATE lecturers SET email='removed@vnu.edu.vn' WHERE id=1");
  const denied=await fetch(path,{headers:{...headers,'If-None-Match':tag}});assert.equal(denied.status,403);
 });}finally{setDb(original);}
});
test('legacy opt-in pages filter canonical courses and Unicode names and expose full totals',async()=>{
 await db.execute("UPDATE users SET course_code='Thực tập Doanh nghiệp INT4002' WHERE student_id IS NOT NULL");
 const req:any={query:{pagination:'1',page:'2',limit:'25',courseCode:'INT4002'}};
 const sql="SELECT id user_id,student_id,name student_name,email,class_name,course_code FROM users WHERE role='student'";
 let rows=await legacyRows(req,sql);assert.equal(rows.length,25);assert.equal(req.legacyPage.total,80);
 req.query={pagination:'1',q:'đỗ ÁNH',courseCode:'INT4002'};rows=await legacyRows(req,sql);assert.equal(rows.length,1);
 const compatibility=await legacyRows({query:{}},sql);assert.equal(compatibility.length,80);
 req.query={pagination:'1',classId:firstClass};assert.equal((await legacyRows(req,sql)).length,0);assert.equal(req.legacyFilterError,true);
});
test('legacy page responses keep array compatibility and apply conditional JSON caching',async()=>{
 const app=express();app.use(jsonCacheMiddleware,legacyPagingMiddleware);app.get('/api/legacy',async(req,res)=>{res.json(await legacyRows(req,"SELECT id user_id,student_id,name student_name,email,class_name,COALESCE(course_code,'') course_code FROM users WHERE role='student'"));});
 await serve(app,async base=>{const old=await(await fetch(base+'/api/legacy')).json();assert.equal(old.length,80);const page=await fetch(base+'/api/legacy?pagination=1&limit=25&page=2');const tag=page.headers.get('ETag')!;const data=await page.json();assert.equal(data.items.length,25);assert.equal(data.total,80);assert.equal((await fetch(base+'/api/legacy?pagination=1&limit=25&page=2',{headers:{'If-None-Match':tag}})).status,304);});
});
test('unread count endpoint logic returns counts without notification bodies or thread payloads',async()=>{
 await db.executeMultiple(`CREATE TABLE system_notifications(id INTEGER PRIMARY KEY,target_role TEXT,active INTEGER,type TEXT,subject TEXT,body TEXT,created_at TEXT);
 CREATE TABLE system_notification_reads(system_notification_id INTEGER,user_id INTEGER,read_at TEXT);
 CREATE TABLE chat_messages(id INTEGER PRIMARY KEY,student_user_id INTEGER,lecturer_id INTEGER,sender_user_id INTEGER,read_at TEXT);
 CREATE TABLE chat_group_messages(id INTEGER PRIMARY KEY,lecturer_id INTEGER,sender_user_id INTEGER);
 CREATE TABLE chat_group_message_reads(message_id INTEGER,user_id INTEGER);
 INSERT INTO system_notifications VALUES(1,'all',1,'notice','Private subject','Private body','2026-10-29');`);
 const result=await unreadCounts(admin);assert.deepEqual(result,{notifications:1,chats:0});
});

 test('exports use the same SQL filters and include all pages; communication rosters omit grades and files',async()=>{
  const all=await campaignExport(admin,campaignId,'students',{page:2,limit:25});assert.equal(all.length,84);
  const filtered=await campaignExport(admin,campaignId,'students',{classId:firstClass,q:'đỗ ánh'});assert.equal(filtered.length,1);
  const ctx=await readCommunicationContext(sv,firstClass);assert.equal(ctx.s.enrollments.length,2);assert.ok(ctx.s.enrollments.every(e=>e.email===sv.email&&!('evaluations' in e)&&!('versions' in e)));
 });

 test('legacy adviser sorting selects the correct global page rather than sorting one page locally',async()=>{
  const req:any={path:'/api/admin/advisor-assignments',query:{pagination:'1',limit:'1',sort:'primary_assignments',direction:'asc'}};
  const sql="SELECT id user_id,student_id,name student_name,email,class_name,CASE WHEN student_id='24020079' THEN 'Alpha' ELSE 'Zulu' END primary_assignment_names, '1|GV|gv@vnu.edu.vn|' primary_assignments FROM users WHERE role='student'";
  const rows=await legacyRows(req,sql);assert.equal(rows[0].student_id,'24020079');assert.equal(req.legacyPage.total,80);
 });
