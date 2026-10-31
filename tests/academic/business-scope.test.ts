import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import {createAcademicFixture} from './fixture';
import {db} from '../../server/db';
import {JWT_SECRET} from '../../server/config';
import {academicRouter} from '../../server/academic/routes';
import {commonRouter} from '../../server/routes/common.routes';
import {adminRouter} from '../../server/routes/admin.routes';
import {snapshot,commit} from '../../server/academic/store';
import {createSemester,createClass,joinInternship,reviewerPreview} from '../../server/academic/service';
import {newEnrollment,currentVersion} from '../../server/academic/domain';
import {campaignExport,campaignAutoAdvisors} from '../../server/academic/campaignExports';
import type {AcademicClass} from '../../src/shared/academic';
const admin={id:1,email:'admin@vnu.edu.vn',role:'admin' as const,name:'Khoa'};
let client:Awaited<ReturnType<typeof createAcademicFixture>>,project:AcademicClass,internship:AcademicClass;
const projectEmail='24020001@vnu.edu.vn';
beforeEach(async()=>{
 client=await createAcademicFixture();await createSemester(admin,2026,'1');
 project=await createClass(admin,{semesterId:'2026-2027-1',courseCode:'INT3132',section:'1'});
 internship=await createClass(admin,{semesterId:project.semesterId,courseCode:'INT4002',section:'1'});
 const s=await snapshot(),a=newEnrollment(project,{studentId:'24020001',name:'Sinh viên Dự án'}),b=newEnrollment(internship,{studentId:'24020002',name:'Sinh viên Thực tập'});
 for(const e of [a,b]){e.assignments=[{id:'p-'+e.id,lecturerId:1,role:'primary',assignedAt:'now'}];const v=currentVersion(e);v.state='submitted';v.objectKey='fixture/report.pdf';v.filename='report.pdf';e.topic=v.title='Đề tài';}
 a.assignments.push({id:'r-'+a.id,lecturerId:2,role:'reviewer',assignedAt:'now'});a.topicReview!.status='approved';a.topicReview!.version=1;currentVersion(a).topicVersion=1;
 a.evaluations[currentVersion(a).id]={advisor:{score:8,comment:'HD',lecturerId:1,assignmentId:'p-'+a.id,submittedAt:'now',updatedAt:'now'},reviewer:{score:8.5,comment:'NX',lecturerId:2,assignmentId:'r-'+a.id,submittedAt:'now',updatedAt:'now'}};
 b.internshipGrade={progress:5,report:6,company:9,comment:'TT',lecturerId:1,assignmentId:'p-'+b.id,submittedAt:'now',updatedAt:'now'};
 await commit(s,1,'admin.test.business',{campaigns:s.campaigns!.map(p=>({...p,status:'active'})),enrollments:[a,b],users:[a,b].map(e=>({studentId:e.studentId,name:e.name,email:e.email,dob:'',className:''}))});
});
afterEach(()=>client.close());
async function serve(run:(base:string,headers:(email?:string)=>Record<string,string>)=>Promise<void>){
 const app=express();app.use(express.json(),academicRouter,commonRouter,adminRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{await run(`http://127.0.0.1:${(server.address()as{port:number}).port}`,email=>({Authorization:'Bearer '+jwt.sign({email:email||admin.email},JWT_SECRET)}));}finally{await new Promise<void>(r=>server.close(()=>r()));}
}

test('campaign exports use project and internship fields without mixing their grading or submission rules',async()=>{
 for(const dataset of ['students','assignments','reports','grades','student-list']){
  const rows=await campaignExport(admin,project.campaignId,dataset,{});assert.equal(rows.length,1);
  for(const key of ['Tư cách','Tiến độ','Đơn vị','Doanh nghiệp','Nơi thực tập','Nguyện vọng'])assert.equal(Object.hasOwn(rows[0],key),false,`${dataset}/${key}`);
 }
 const grades=(await campaignExport(admin,project.campaignId,'grades',{}))[0];assert.equal(grades['Điểm GVHD'],8);assert.equal(grades['Điểm GVNX'],8.5);assert.equal(grades['Tổng kết'],8.2);assert.equal(Object.hasOwn(grades,'Báo cáo'),false);
 const tt=(await campaignExport(admin,internship.campaignId,'grades',{}))[0];assert.equal(tt['Tiến độ'],5);assert.equal(tt['Báo cáo'],6);assert.equal(tt['Đơn vị'],9);assert.equal(tt['Tổng kết'],7.6);
 for(const dataset of ['students','assignments','reports','grades','student-list']){
  const row=(await campaignExport(admin,internship.campaignId,dataset,{}))[0];for(const key of ['GVNX','Điểm GVHD','Điểm GVNX','Slide','Video','Video demo','Trạng thái đề tài'])assert.equal(Object.hasOwn(row,key),false,`${dataset}/${key}`);
 }
});

test('class and semester grade workbooks have correctly aligned group-specific columns, including empty classes',async()=>{
 const empty=await createClass(admin,{semesterId:project.semesterId,courseCode:'INT3132',section:'empty'});
 await serve(async(base,headers)=>{
  const workbook=async(path:string)=>{const r=await fetch(base+path,{headers:headers()});assert.equal(r.status,200);const w=XLSX.read(Buffer.from(await r.arrayBuffer()));return{columns:(XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{header:1})as string[][])[0],rows:XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]])as any[]};};
  for(const c of [project,empty]){const w=await workbook(`/api/admin/classes/${c.id}/grades/export.xlsx`);assert.ok(w.columns.includes('Điểm GVHD (60%)')&&w.columns.includes('Điểm GVNX (40%)'));assert.ok(!w.columns.includes('Tư cách')&&!w.columns.includes('Doanh nghiệp (60%)'));}
  const w=await workbook(`/api/admin/semesters/${project.semesterId}/grades/export.xlsx`),a=w.rows.find(r=>r.MSSV==='24020001'),b=w.rows.find(r=>r.MSSV==='24020002');assert.equal(a['Điểm GVHD (60%)'],8);assert.equal(a['Điểm GVNX (40%)'],8.5);assert.equal(a['Tổng kết'],8.2);assert.equal(a['Tư cách'],undefined);assert.equal(a['Doanh nghiệp (60%)'],undefined);assert.equal(b['Doanh nghiệp (60%)'],9);assert.equal(b['Tổng kết'],7.6);assert.equal(b['Điểm GVNX (40%)'],undefined);
  const r=await fetch(`${base}/api/admin/classes/${project.id}/grades`,{headers:headers()});const rows=await r.json();assert.equal(rows[0].advisorScore,8);for(const field of ['status','progress','report','company'])assert.equal(field in rows[0],false);
 });
});

test('project-only profile edits neither require nor change a legacy course, enrollments or internship access',async()=>{
 const before=(await snapshot()).enrollments;
 await serve(async(base,headers)=>{
  const put=(body:any)=>fetch(base+'/api/users/profile',{method:'PUT',headers:{...headers(projectEmail),'Content-Type':'application/json'},body:JSON.stringify(body)});
  const bad=await put({name:'Sinh viên Dự án',course_code:'INT4002'});assert.equal(bad.status,409);
  const valid=await put({name:'Sinh viên Dự án',phone:'0912345678',legacy_internship_access:1});assert.equal(valid.status,200);const user=await valid.json();assert.equal(user.legacy_internship_access,0);assert.equal(user.course_code,null);assert.equal(user.student_id,'24020001');
 });
 assert.deepEqual((await snapshot()).enrollments,before);
});

test('project and internship commands reject the other groups enrollment and assignment workflows',async()=>{
 const actor=(await db.execute({sql:'SELECT * FROM users WHERE email=?',args:[projectEmail]})).rows[0]as any;
 const before=(await snapshot()).enrollments;
 await assert.rejects(joinInternship(actor,project.id),(e:any)=>e.code==='WRONG_COURSE');
 await assert.rejects(campaignAutoAdvisors(admin,project.campaignId,{}),(e:any)=>e.code==='WRONG_COURSE');
 await assert.rejects(reviewerPreview(admin,project.semesterId,{classIds:[internship.id]}),(e:any)=>e.code==='INVALID_CLASSES');
 assert.deepEqual((await snapshot()).enrollments,before);
});

test('global student deletion cannot delete a shared account that still has academic enrollments',async()=>{
 const before=(await snapshot()).enrollments;
 await serve(async(base,headers)=>{
  const result=await fetch(base+'/api/admin/students/24020001',{method:'DELETE',headers:headers()});assert.equal(result.status,409);assert.match((await result.json()).error,/tài khoản dùng chung/);
 });
 assert.equal((await db.execute({sql:'SELECT count(*) n FROM users WHERE email=?',args:[projectEmail]})).rows[0].n,1);
 assert.deepEqual((await snapshot()).enrollments,before);
});

test('lecturer self-service preserves official qualifications and does not synchronize unrelated accounts',async()=>{
 await db.execute("INSERT INTO users(email,name,role,is_lecturer) VALUES('delta@vnu.edu.vn','CN. Delta','lecturer',1)");
 const others=(await db.execute("SELECT * FROM users WHERE email NOT IN ('delta@vnu.edu.vn','alpha@vnu.edu.vn') ORDER BY id")).rows;
 await serve(async(base,headers)=>{
  const update=(email:string,name:string)=>fetch(base+'/api/users/profile',{method:'PUT',headers:{...headers(email),'Content-Type':'application/json'},body:JSON.stringify({name})});
  const cn=await update('delta@vnu.edu.vn','PGS.TS. Delta mới');assert.equal(cn.status,200);assert.equal((await cn.json()).name,'CN. Delta mới');
  const ts=await update('alpha@vnu.edu.vn','Alpha mới');assert.equal(ts.status,200);assert.equal((await ts.json()).name,'TS. Alpha mới');
 });
 assert.equal((await db.execute('SELECT name FROM lecturers WHERE id=4')).rows[0].name,'CN. Delta mới');
 assert.deepEqual((await db.execute("SELECT * FROM users WHERE email NOT IN ('delta@vnu.edu.vn','alpha@vnu.edu.vn') ORDER BY id")).rows,others);
});
