import {beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createAcademicFixture} from './fixture';
import {db} from '../../server/db';
import {unreadCounts,invalidateUnreadCountsCache} from '../../server/services/unread';
import {createSemester,createClass} from '../../server/academic/service';
import {newEnrollment} from '../../server/academic/domain';
import {commit,snapshot} from '../../server/academic/store';
import {accessRecordCteFor} from '../../server/academic/reads';
import type {AuthenticatedUser} from '../../server/types';

let client:Awaited<ReturnType<typeof createAcademicFixture>>;
const admin:AuthenticatedUser={id:1,email:'admin@vnu.edu.vn',role:'admin',name:'Khoa'};
const student:AuthenticatedUser={id:100,email:'24020001@vnu.edu.vn',role:'student',name:'Sinh viên',personal_email:'sv@example.org'};
beforeEach(async()=>{
 client=await createAcademicFixture();invalidateUnreadCountsCache();
 await db.executeMultiple(`
  CREATE TABLE system_notifications(id INTEGER PRIMARY KEY,target_role TEXT,active INTEGER,created_at TEXT);
  CREATE TABLE system_notification_reads(system_notification_id INTEGER,user_id INTEGER,read_at TEXT,PRIMARY KEY(system_notification_id,user_id));
  CREATE TABLE chat_messages(id INTEGER PRIMARY KEY,student_user_id INTEGER,lecturer_id INTEGER,sender_user_id INTEGER,read_at TEXT);
  CREATE TABLE chat_group_messages(id INTEGER PRIMARY KEY,lecturer_id INTEGER,sender_user_id INTEGER,created_at TEXT);
  CREATE TABLE chat_group_message_reads(message_id INTEGER,user_id INTEGER,PRIMARY KEY(message_id,user_id));
  CREATE INDEX idx_notifications_user_created ON notifications(user_id,created_at DESC);
  CREATE INDEX idx_notifications_unbound_recipient_created ON notifications(recipient_email COLLATE NOCASE,created_at DESC) WHERE user_id IS NULL;
  CREATE INDEX idx_chat_messages_thread_unread ON chat_messages(student_user_id,lecturer_id,read_at,sender_user_id);
  CREATE INDEX idx_chat_group_messages_lecturer_created ON chat_group_messages(lecturer_id,created_at);
  INSERT INTO users(id,email,name,role,student_id) VALUES(100,'24020001@vnu.edu.vn','Sinh viên','student','24020001'),(101,'24020002@vnu.edu.vn','Sinh viên khác','student','24020002');
 `);
});
afterEach(()=>{invalidateUnreadCountsCache();client.close();});

test('unread notices retain the newest 100 across account, primary/alias email and system sources',async()=>{
 for(let i=0;i<60;i++)await db.execute({sql:"INSERT INTO notifications(user_id,type,created_at) VALUES(100,'notice','2026-01-01')",args:[]});
 for(let i=0;i<50;i++)await db.execute("INSERT INTO notifications(recipient_email,type,created_at,read_at) VALUES('SV@EXAMPLE.ORG','notice','2026-01-02','read')");
 for(let i=0;i<200;i++)await db.execute("INSERT INTO notifications(recipient_email,type,created_at) VALUES('other@example.org','notice','2026-01-04')");
 for(let i=0;i<5;i++)await db.execute("INSERT INTO system_notifications(target_role,active,created_at) VALUES('student',1,'2026-01-03')");
 await db.execute("INSERT INTO system_notifications(target_role,active,created_at) VALUES('admin',1,'2026-01-05')");
 await db.execute("INSERT INTO notifications(user_id,type,created_at) VALUES(100,'advisor_quota_exceeded','2026-01-05'),(100,'faq_question_created','2026-01-05')");
 assert.deepEqual(await unreadCounts(student),{notifications:50,chats:0});
});

test('case-equivalent primary and personal emails never double count unbound notices',async()=>{
 await db.execute("INSERT INTO notifications(recipient_email,type,created_at) VALUES('24020001@VNU.EDU.VN','notice','now')");
 assert.deepEqual(await unreadCounts({...student,personal_email:'24020001@VNU.EDU.VN'}),{notifications:1,chats:0});
});

test('notification permissions apply before the per-recipient limit and project revocation bypasses cached counts',async()=>{
 const semester=await createSemester(admin,2026,'1'),a=await createClass(admin,{semesterId:semester.id,courseCode:'INT3132',section:'1'}),b=await createClass(admin,{semesterId:semester.id,courseCode:'INT3131',section:'1'});
 let s=await snapshot();const enrollment=newEnrollment(a,{studentId:student.student_id||'24020001',name:student.name});
 await commit(s,1,'admin.test.membership',{campaigns:[{...s.campaigns!.find(p=>p.id===a.campaignId)!,status:'active'}],enrollments:[enrollment]});
 assert.deepEqual((await db.execute({sql:`${accessRecordCteFor(student)} SELECT class_id FROM records`,args:['student',student.email,0,'','']})).rows.map(r=>r.class_id),[a.id]);
 for(let i=0;i<105;i++)await db.execute({sql:"INSERT INTO notifications(user_id,recipient_email,type,created_at,academic_class_id,academic_campaign_id,academic_audience_class_ids) VALUES(100,?,'course_announcement','2026-01-02',?,?,?)",args:[student.email,b.id,b.campaignId,JSON.stringify([b.id])]});
 await db.execute({sql:"INSERT INTO notifications(user_id,recipient_email,type,created_at,academic_class_id,academic_campaign_id,academic_audience_class_ids) VALUES(100,?,'course_announcement','2026-01-01',?,?,?)",args:[student.email,a.id,a.campaignId,JSON.stringify([a.id])]});
 assert.deepEqual(await unreadCounts(student),{notifications:1,chats:0});
 s=await snapshot();await commit(s,1,'admin.test.remove',{deletedEnrollmentIds:[enrollment.id]});
 assert.deepEqual(await unreadCounts(student),{notifications:0,chats:0});
});

test('legacy chat seeks only assigned threads, deduplicates co assignments and respects sender/read flags',async()=>{
 await db.executeMultiple(`
  INSERT INTO advisor_assignments(user_id,lecturer_id,role) VALUES(100,1,'primary'),(100,1,'co'),(100,2,'co'),(101,3,'primary');
  INSERT INTO chat_messages VALUES(1,100,1,2,NULL),(2,100,1,100,NULL),(3,100,2,3,NULL),(4,100,3,4,NULL),(5,101,3,101,NULL),(6,100,1,2,'read');
  INSERT INTO chat_group_messages VALUES(1,1,2,'now'),(2,1,100,'now'),(3,3,4,'now'),(4,2,3,'now');
  INSERT INTO chat_group_message_reads VALUES(4,100);
 `);
 assert.deepEqual(await unreadCounts(student),{notifications:0,chats:3});
 assert.deepEqual(await unreadCounts({id:2,email:'alpha@vnu.edu.vn',name:'Alpha',role:'lecturer'}),{notifications:0,chats:2});
 assert.deepEqual(await unreadCounts({id:4,email:'gamma@vnu.edu.vn',name:'Gamma',role:'lecturer'}),{notifications:0,chats:1});
 assert.deepEqual(await unreadCounts(admin),{notifications:0,chats:0});
});

test('academic header counts share advisor groups across classes, isolate private enrollments and exclude reviewer chat',async()=>{
 const semester=await createSemester(admin,2026,'1'),a=await createClass(admin,{semesterId:semester.id,courseCode:'INT3132',section:'1'}),b=await createClass(admin,{semesterId:semester.id,courseCode:'INT3131',section:'1'}),other=await createClass(admin,{semesterId:semester.id,courseCode:'INT3132',section:'2'});
 const s=await snapshot(),own=[a,b].map(c=>newEnrollment(c,{studentId:'24020001',name:'Sinh viên'})),foreign=newEnrollment(other,{studentId:'24020002',name:'Sinh viên khác'});
 for(const e of [...own,foreign])e.assignments=[{id:'primary-'+e.id,role:'primary',lecturerId:1,assignedAt:'now'},{id:'co-'+e.id,role:'co',lecturerId:3,assignedAt:'now'},{id:'reviewer-'+e.id,role:'reviewer',lecturerId:2,assignedAt:'now'}];
 await commit(s,1,'admin.test.chat',{campaigns:[{...s.campaigns!.find(p=>p.id===a.campaignId)!,status:'active'}],enrollments:[...own,foreign]});
 for(const [id,enrollment,lecturer,sender]of [['group',null,1,2],['own',own[0].id,1,2],['foreign',foreign.id,1,101],['reviewer',null,2,101],['co',null,3,101]]as const){
  await db.execute({sql:"INSERT INTO academic_messages(id,class_id,enrollment_id,lecturer_id,sender_id,body,created_at) VALUES(?,?,?,?,?,'Fixture','now')",args:[id,other.id,enrollment,lecturer,sender]});
 }
 assert.deepEqual(await unreadCounts(student),{notifications:0,chats:3});
 assert.deepEqual(await unreadCounts({id:2,email:'alpha@vnu.edu.vn',name:'Alpha',role:'lecturer'}),{notifications:0,chats:1});
 assert.deepEqual(await unreadCounts({id:3,email:'beta@vnu.edu.vn',name:'Beta',role:'lecturer'}),{notifications:0,chats:0});
 assert.deepEqual(await unreadCounts({id:4,email:'gamma@vnu.edu.vn',name:'Gamma',role:'lecturer'}),{notifications:0,chats:1});
});
