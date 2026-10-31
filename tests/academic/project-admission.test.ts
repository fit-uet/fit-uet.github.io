import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {createAcademicFixture} from './fixture';
import {db,setDb} from '../../server/db';
import {JWT_SECRET} from '../../server/config';
import {createSemester,createClass} from '../../server/academic/service';
import {snapshot,commit} from '../../server/academic/store';
import {lookupProjectStudent,addProjectStudent} from '../../server/academic/projectAdmission';
import {updateCampaign} from '../../server/academic/campaigns';
import {academicRouter} from '../../server/academic/routes';
const admin={id:1,email:'admin@vnu.edu.vn',name:'Khoa',role:'admin' as const},gv={id:2,email:'alpha@vnu.edu.vn',name:'GV',role:'lecturer' as const};
let client:Awaited<ReturnType<typeof createAcademicFixture>>,a:any,b:any;
beforeEach(async()=>{client=await createAcademicFixture();await createSemester(admin,2026,'1');a=await createClass(admin,{semesterId:'2026-2027-1',courseCode:'INT3132',section:'1'});b=await createClass(admin,{semesterId:a.semesterId,courseCode:'INT3131',section:'1'});});
afterEach(()=>client.close());
async function add(studentId='24020001',classId=a.id,extra={}){const lookup=await lookupProjectStudent(admin,a.campaignId,studentId);return addProjectStudent(admin,a.campaignId,{studentId,classId,name:'Sinh viên mới',expectedRevision:lookup.revision,...extra});}
test('manual admission creates a project-only account and empty independent enrollments, and preserves a reused account',async()=>{
 const first=await add();assert.equal(first.createdAccount,true);assert.equal(first.enrollment.topic,'');assert.equal(first.enrollment.topicReview.status,'unregistered');assert.deepEqual(first.enrollment.assignments,[]);assert.deepEqual(first.enrollment.evaluations,{});assert.equal(first.enrollment.versions[0].objectKey,null);assert.ok(!('status'in first.enrollment));
 const before=(await db.execute("SELECT * FROM users WHERE student_id='24020001'")).rows[0];assert.equal(before.legacy_internship_access,0);
 const second=await add('24020001',b.id,{name:'Không được ghi đè',dob:'2000-01-01',className:'Sai lớp'});assert.equal(second.createdAccount,false);assert.equal(second.enrollment.name,before.name);assert.equal(second.enrollment.dob,before.dob);assert.notEqual(second.enrollment.id,first.enrollment.id);
 assert.deepEqual((await db.execute("SELECT * FROM users WHERE student_id='24020001'")).rows[0],before);
 await assert.rejects(add(),(e:any)=>e.code==='DUPLICATE_ENROLLMENT');
 assert.equal((await snapshot()).enrollments.length,2);
});
test('admission validates identity, scope, dates, role, revision and campaign state',async()=>{
 await assert.rejects(lookupProjectStudent(gv,a.campaignId,'24020001'),(e:any)=>e.code==='ADMIN_ONLY');
 await assert.rejects(lookupProjectStudent(admin,a.campaignId,'134'),(e:any)=>e.code==='INVALID_STUDENT_ID');
 await assert.rejects(add('24020001',a.id,{dob:'2026-02-30'}),(e:any)=>e.code==='INVALID_DATE');
 await assert.rejects(add('24020001',a.id,{name:''}),(e:any)=>e.code==='INVALID_STUDENT');
 const lookup=await lookupProjectStudent(admin,a.campaignId,'24020001');await createClass(admin,{semesterId:a.semesterId,courseCode:'INT3132',section:'2'});
 await assert.rejects(addProjectStudent(admin,a.campaignId,{studentId:'24020001',name:'X',classId:a.id,expectedRevision:lookup.revision}),(e:any)=>e.code==='REVISION_CONFLICT');
 await db.execute("INSERT INTO users(email,name,role,student_id) VALUES('different@vnu.edu.vn','Identity conflict','student','24020002')");
 await assert.rejects(lookupProjectStudent(admin,a.campaignId,'24020002'),(e:any)=>e.code==='STUDENT_IDENTITY_CONFLICT');
 await createSemester(admin,2027,'1');const other=await createClass(admin,{semesterId:'2027-2028-1',courseCode:'INT3132',section:'1'});
 await assert.rejects(add('24020001',other.id),(e:any)=>['CLASS_NOT_FOUND','INVALID_CAMPAIGN_FILTER'].includes(e.code));
 let s=await snapshot();await updateCampaign(admin,a.campaignId,{expectedRevision:s.campaigns.find(p=>p.id===a.campaignId).revision,status:'active'});await add();
 s=await snapshot();await updateCampaign(admin,a.campaignId,{expectedRevision:s.campaigns.find(p=>p.id===a.campaignId).revision,status:'archived',reason:'Test'});
 await assert.rejects(add('24020003'),(e:any)=>e.code==='CAMPAIGN_READ_ONLY');
});
test('concurrent admissions and a late constraint error cannot create a half account or duplicate enrollment',async()=>{
 const lookup=await lookupProjectStudent(admin,a.campaignId,'24020001'),input={studentId:'24020001',name:'Concurrent',classId:a.id,expectedRevision:lookup.revision};
 const result=await Promise.allSettled([addProjectStudent(admin,a.campaignId,input),addProjectStudent(admin,a.campaignId,input)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await snapshot()).enrollments.length,1);
 await db.execute("CREATE TRIGGER reject_admission BEFORE INSERT ON academic_enrollments WHEN NEW.student_id='24020002' BEGIN SELECT RAISE(ABORT,'late-test-constraint'); END");
 const before=(await db.execute('SELECT count(*) n FROM academic_commands')).rows[0].n;
 await assert.rejects(add('24020002'),/late-test-constraint/);
 assert.equal((await db.execute("SELECT count(*) n FROM users WHERE student_id='24020002'")).rows[0].n,0);
 assert.equal((await db.execute('SELECT count(*) n FROM academic_commands')).rows[0].n,before);
});
test('the database guard rejects account identity and campaign changes racing the command without an academic revision bump',async()=>{
 await db.execute("INSERT INTO users(email,name,role,student_id) VALUES('24020001@vnu.edu.vn','Original','student','24020001')");
 const original=db;let race='account';
 setDb({...original,execute:async(input:any)=>{
  if(typeof input!=='string'&&input.sql.startsWith('INSERT INTO academic_commands')&&input.args[3]==='admin.project.add'){
   if(race==='account')await original.execute("UPDATE users SET name='Updated elsewhere' WHERE student_id='24020001'");
   if(race==='campaign')await original.execute({sql:"UPDATE academic_campaigns SET data=json_set(data,'$.status','archived') WHERE id=?",args:[a.campaignId]});
  }
  return original.execute(input);
 }});
 try{await assert.rejects(add(),(e:any)=>e.code==='STALE_PREVIEW');race='campaign';await assert.rejects(add('24020002'),(e:any)=>e.code==='STALE_PREVIEW');}finally{setDb(original);}
 assert.equal((await snapshot()).enrollments.length,0);assert.equal((await db.execute("SELECT count(*) n FROM users WHERE student_id='24020002'")).rows[0].n,0);
});
test('lookup reads only the requested account and never a whole-system snapshot or legacy reports',async()=>{
 const original=db,queries:string[]=[];setDb({...original,execute:async q=>{queries.push(typeof q==='string'?q:q.sql);return original.execute(q);}});
 try{const result=await lookupProjectStudent(admin,a.campaignId,'24020001');assert.equal(result.found,false);assert.equal(result.student,null);assert.equal(queries.length,3);assert.ok(!queries.some(q=>q.includes("SELECT 'enrollments',data FROM academic_enrollments")||/^SELECT \* FROM users$/.test(q)));}finally{setDb(original);}
});
test('HTTP admission endpoints protect lookup and permit only Khoa to create project membership',async()=>{
 const app=express();app.use(express.json(),academicRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
 const headers=(email:string)=>({Authorization:'Bearer '+jwt.sign({email},JWT_SECRET),'Content-Type':'application/json'});
 try{
  const url=`${base}/api/admin/campaigns/${a.campaignId}`;
  assert.equal((await fetch(url+'/student-lookup?studentId=24020001',{headers:headers(gv.email)})).status,403);
  const lookup=await(await fetch(url+'/student-lookup?studentId=24020001',{headers:headers(admin.email)})).json();
  const response=await fetch(url+'/enrollments',{method:'POST',headers:headers(admin.email),body:JSON.stringify({studentId:'24020001',name:'HTTP Student',classId:a.id,expectedRevision:lookup.revision})});assert.equal(response.status,200);assert.equal((await response.json()).createdAccount,true);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
