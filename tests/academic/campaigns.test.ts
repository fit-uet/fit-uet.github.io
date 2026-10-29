import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAcademicFixture } from './fixture';
import { db } from '../../server/db';
import { commit, snapshot, readPreview } from '../../server/academic/store';
import { createSemester, createClass, enrollmentAction, updateClass, updateQuotas } from '../../server/academic/service';
import { campaignKey, EMPTY_CLASS_SETTINGS } from '../../src/shared/academic';
import { newClass, newEnrollment } from '../../server/academic/domain';
import { campaignDetail, campaignEnrollments, campaignSummaries, updateCampaign, campaignMigrationPreview, applyCampaignMigration } from '../../server/academic/campaigns';
import { campaignExport, campaignAutoAdvisors } from '../../server/academic/campaignExports';
import { planImport } from '../../server/academic/imports';
import { legacyAcademicWriteGuard, legacyCampaignArchived } from '../../server/academic/legacyGuard';
import { sendChat, chatMessages } from '../../server/academic/chat';
import { announce, announcementPreview, applyAnnouncementPreview, askQuestion, classQuestions, answerQuestion } from '../../server/academic/communications';
import { deliverAcademicOutbox } from '../../server/academic/outbox';
import { visibleAcademicNotifications } from '../../server/academic/notificationAccess';
import { legacyPreview, applyLegacy } from '../../server/academic/legacy';
import type { AuthenticatedUser } from '../../server/types';
import type { AcademicClass } from '../../src/shared/academic';

const admin: AuthenticatedUser = { id: 1, role: 'admin', name: 'Khoa', email: 'admin@vnu.edu.vn' };
const alpha: AuthenticatedUser = { id: 2, role: 'lecturer', name: 'TS. Alpha', email: 'alpha@vnu.edu.vn' };
let client: Awaited<ReturnType<typeof createAcademicFixture>>;
beforeEach(async () => { client = await createAcademicFixture(); }); afterEach(() => client.close());
async function cls(code = 'INT3132', section = '1', year = 2026) {
  const s = await createSemester(admin, year, '1'); const c = await createClass(admin, { semesterId: s.id, courseCode: code, section });
  const p = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!;
  if (p.status !== 'active') await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'active' });
  return (await snapshot()).classes.find(x => x.id === c.id)!;
}
async function admit(c: AcademicClass, sid = '24020001', primary = 1) {
  const s = await snapshot(); const e = newEnrollment(c, { studentId: sid, name: `SV ${sid}` }); e.assignments = [{ id: `p-${e.id}`, lecturerId: primary, role: 'primary', assignedAt: new Date().toISOString() }];
  await commit(s, 1, 'admin.fixture', { enrollments: [e], users: [{ studentId: sid, email: e.email, name: e.name, dob: '', className: '' }] });
  const u = (await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [e.email] })).rows[0];
  return { e, actor: { id: Number(u.id), email: e.email, name: e.name, role: 'student' as const } };
}
test('eight project classes share one campaign; a student in two courses retains two enrollments', async () => {
  const classes = []; for (const code of ['INT3132', 'INT3131']) for (let i = 1; i <= 4; i++) classes.push(await cls(code, String(i)));
  const a = await admit(classes[0]); await admit(classes[4]);
  const detail = await campaignDetail(admin, classes[0].campaignId); assert.equal(detail.classes.length, 8); assert.equal(detail.stats.studentCount, 1); assert.equal(detail.stats.enrollmentCount, 2);
  const rows = await campaignEnrollments(a.actor, classes[0].campaignId); assert.equal(rows.items.length, 2); assert.ok(rows.items.every(e => !('evaluations' in e) && !('finalScore' in e)));
  assert.notEqual(rows.items[0].id, rows.items[1].id);
});
test('campaign settings and archive apply to all its classes, independent of other groups and years', async () => {
  const a = await cls(), b = await cls('INT3131'), other = await cls('INT4002'), later = await cls('INT3132', '1', 2027); await admit(a);
  let s = await snapshot(); const p = s.campaigns!.find(p => p.id === a.campaignId)!;
  await updateCampaign(admin, p.id, { expectedRevision: p.revision, settings: { plan: 'Một kế hoạch chung', gradingCloseAt: '2099-01-01T00:00:00Z' } });
  s = await snapshot(); assert.equal(s.classes.find(c => c.id === b.id)!.settings.plan, 'Một kế hoạch chung'); assert.equal(s.classes.find(c => c.id === other.id)!.settings.plan, '');
  const fresh = s.campaigns!.find(x => x.id === p.id)!; await updateCampaign(admin, p.id, { expectedRevision: fresh.revision, status: 'archived', reason: 'Chốt cả đợt' });
  s = await snapshot(); assert.ok(s.classes.filter(c => c.campaignId === p.id).every(c => c.status === 'archived')); assert.equal(s.classes.find(c => c.id === later.id)!.status, 'active');
  await assert.rejects(updateClass(admin, a.id, { expectedRevision: 1, status: 'active' }), (e: any) => e.code === 'CAMPAIGN_CONTEXT_REQUIRED');
  assert.throws(() => planImport(s, a.semesterId, Buffer.from('')), (e: any) => e.code === 'CAMPAIGN_READ_ONLY');
  await assert.rejects(updateQuotas(admin, a.semesterId, [{ lecturerId: 1, maxReviews: 3 }]), (e: any) => e.code === 'CAMPAIGN_READ_ONLY');
  await updateQuotas(admin, other.semesterId, [{ lecturerId: 1, internshipMax: 3 }]);
});
test('campaign internship auto-assignment respects the selected course and leaves other courses unchanged', async () => {
  const a = await cls('INT4002'), b = await cls('INT3508'); const x = await admit(a), y = await admit(b, '24020002');
  const s = await snapshot(); const rows = s.enrollments.map(e => ({ ...e, assignments: [] })); await commit(s, 1, 'admin.fixture', { enrollments: rows });
  const result = await campaignAutoAdvisors(admin, a.campaignId, { filters: { courseCode: a.courseCode } }); assert.equal(result.assigned, 1);
  const after = await snapshot(); assert.equal(after.enrollments.find(e => e.id === x.e.id)!.assignments.length, 1); assert.equal(after.enrollments.find(e => e.id === y.e.id)!.assignments.length, 0);
});
test('campaign filters reject another campaign and XLSX sources include all filtered pages', async () => {
  const a = await cls(), b = await cls('INT3132', '2'), later = await cls('INT3132', '1', 2027);
  for (let i = 0; i < 31; i++) await admit(a, String(24020001 + i)); await admit(b, '24020100');
  const page = await campaignEnrollments(admin, a.campaignId, { classId: a.id }); assert.equal(page.items.length, 25); assert.equal(page.total, 31);
  const exported = await campaignExport(admin, a.campaignId, 'students', { classId: a.id }); assert.equal(exported.length, 31); assert.ok(exported.every(r => r['Lớp học phần'] === a.code));
  await assert.rejects(campaignEnrollments(admin, a.campaignId, { classId: later.id }), (e: any) => e.code === 'INVALID_CAMPAIGN_FILTER');
  await assert.rejects(campaignExport({ id: 100, email: '24020001@vnu.edu.vn', role: 'student', name: 'A' }, a.campaignId, 'grades', {}), (e: any) => e.code === 'EXPORT_DENIED');
});
test('lecturer campaign lists exclude unassigned enrollments across every class', async () => {
  const a = await cls(), b = await cls('INT3131'); await admit(a); await admit(b, '24020002', 2);
  const rows = await campaignEnrollments(alpha, a.campaignId); assert.equal(rows.total, 1); assert.equal(rows.items[0].classId, a.id);
});
test('migration exposes configuration and status conflicts and applies only the explicit resolution', async () => {
  const sem = { id: '2026-2027-1', year: 2026, term: '1', name: 'HKI' }; await db.execute({ sql: 'INSERT INTO academic_semesters VALUES(?,?)', args: [sem.id, JSON.stringify(sem)] });
  const a = newClass(sem.id, 'INT3132', '1'), b = newClass(sem.id, 'INT3131', '1'); a.status = 'active'; a.settings.plan = 'A'; b.settings.plan = 'B';
  for (const c of [a, b]) { delete (c as any).campaignId; await db.execute({ sql: 'INSERT INTO academic_classes VALUES(?,?,?,?)', args: [c.id, sem.id, c.code, JSON.stringify(c)] }); }
  const e = newEnrollment(a, { studentId: '24020001', name: 'Hồ sơ cần giữ' }); const at = '2026-01-01T00:00:00Z';
  e.assignments = [{ id: 'old-primary', lecturerId: 1, role: 'primary', assignedAt: at }, { id: 'old-reviewer', lecturerId: 2, role: 'reviewer', assignedAt: at }];
  Object.assign(e.versions[0], { objectKey: 'original/report.pdf', filename: 'report.pdf', state: 'submitted', submittedAt: at });
  e.evaluations[e.versions[0].id] = { advisor: { score: 8, comment: 'Lịch sử', lecturerId: 1, assignmentId: 'old-primary', submittedAt: at, updatedAt: at }, reviewer: { score: 8.5, comment: 'Lịch sử NX', lecturerId: 2, assignmentId: 'old-reviewer', submittedAt: at, updatedAt: at } };
  const data = JSON.stringify(e); await db.execute({ sql: 'INSERT INTO academic_enrollments VALUES(?,?,?,?)', args: [e.id, a.id, e.studentId, data] });
  await db.execute({ sql: 'INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at,attachment_key) VALUES(?,?,?,?,?,?,?)', args: ['preserved-message', a.id, 1, 2, 'Lịch sử chat', at, 'original/chat.pdf'] });
  await db.execute("INSERT INTO academic_message_reads VALUES('preserved-message',1)");
  const p = await campaignMigrationPreview(admin); assert.equal(p.rows[0].issues.length, 2); await assert.rejects(applyCampaignMigration(admin, p.id), (e: any) => e.code === 'CAMPAIGN_CONFLICTS');
  const id = campaignKey(sem.id, 'project'); const resolved = await campaignMigrationPreview(admin, { [id]: { sourceClassId: b.id, status: 'active' } });
  const result = await applyCampaignMigration(admin, resolved.id); assert.equal(result.migrated, 1); assert.deepEqual(await applyCampaignMigration(admin, resolved.id), result);
  const s = await snapshot(); assert.ok(s.classes.every(c => c.settings.plan === 'B' && c.status === 'active')); assert.equal((await campaignMigrationPreview(admin)).rows.length, 0);
  assert.equal((await db.execute({ sql: 'SELECT data FROM academic_enrollments WHERE id=?', args: [e.id] })).rows[0].data, data);
  assert.equal((await db.execute("SELECT attachment_key FROM academic_messages WHERE id='preserved-message'")).rows[0].attachment_key, 'original/chat.pdf');
  assert.equal((await db.execute("SELECT count(*) n FROM academic_message_reads WHERE message_id='preserved-message' AND user_id=1")).rows[0].n, 1);
});
test('group chat merges classes in one campaign without merging private chats or other semesters', async () => {
  const a = await cls(), b = await cls('INT3131'), later = await cls('INT3132', '1', 2027); const x = await admit(a), y = await admit(b, '24020002'); await admit(later, '24020003');
  await sendChat(x.actor, a.id, 1, undefined, 'A'); await sendChat(y.actor, b.id, 1, undefined, 'B'); await sendChat(alpha, later.id, 1, undefined, 'Kỳ sau');
  assert.equal((await chatMessages(y.actor, b.id, 1)).length, 2); assert.equal((await chatMessages(alpha, later.id, 1)).length, 1);
  await sendChat(x.actor, a.id, 1, x.e.id, 'Riêng A'); await assert.rejects(chatMessages(y.actor, a.id, 1, x.e.id));
  await enrollmentAction(admin, y.e.id, { expectedRevision: (await snapshot()).enrollments.find(e => e.id === y.e.id)!.revision, status: 'withdrawn', reason: 'Rút' }, 'status');
  await assert.rejects(chatMessages(y.actor, b.id, 1));
});
test('merged storage over quota retains history and still permits a text message', async () => {
  const a = await cls(), x = await admit(a);
  await db.execute({ sql: 'INSERT INTO academic_messages(id,class_id,lecturer_id,sender_id,body,created_at,attachment_size) VALUES(?,?,?,?,?,?,?)', args: ['old', a.id, 1, alpha.id, 'Lịch sử', new Date().toISOString(), 300 * 1024 * 1024] });
  await sendChat(x.actor, a.id, 1, undefined, 'Vẫn gửi được chữ'); assert.equal((await chatMessages(alpha, a.id, 1)).length, 2);
});
test('group announcements deduplicate two enrollments and retain visibility while one enrollment remains', async () => {
  const a = await cls(), b = await cls('INT3131'); const x = await admit(a); const y = await admit(b);
  const r = await announce(admin, a.campaignId, { subject: 'Nhóm', body: 'Chung', deliveryMode: 'website_only' }); assert.equal(r.created, 1); await deliverAcademicOutbox();
  const notifications = (await db.execute("SELECT * FROM notifications WHERE type='course_announcement'")).rows;
  await enrollmentAction(admin, x.e.id, { expectedRevision: (await snapshot()).enrollments.find(e => e.id === x.e.id)!.revision, status: 'withdrawn', reason: 'Rút một môn' }, 'status');
  assert.equal((await visibleAcademicNotifications(notifications, x.actor.email)).length, 1);
  await enrollmentAction(admin, y.e.id, { expectedRevision: (await snapshot()).enrollments.find(e => e.id === y.e.id)!.revision, status: 'withdrawn', reason: 'Rút môn còn lại' }, 'status');
  assert.equal((await visibleAcademicNotifications(notifications, x.actor.email)).length, 0);
});
test('announcement preview lists the actual scoped recipients, rejects changes and applies idempotently', async () => {
  const a = await cls(), b = await cls('INT3131'); const x = await admit(a); await admit(b, '24020002');
  const input = { subject: 'Riêng lớp A', body: 'Nội dung', deliveryMode: 'website_only', classId: a.id, includeLecturers: true };
  const preview = await announcementPreview(admin, a.campaignId, input); assert.deepEqual(preview.recipients.map(r => r.email).sort(), [x.e.email, alpha.email].sort());
  assert.equal(Number((await db.execute('SELECT count(*) n FROM academic_outbox')).rows[0].n), 0);
  await updateQuotas(admin, a.semesterId, [{ lecturerId: 1, maxReviews: 3 }]);
  await assert.rejects(applyAnnouncementPreview(admin, preview.id), (e: any) => e.code === 'STALE_PREVIEW');
  const fresh = await announcementPreview(admin, a.campaignId, input); const result = await applyAnnouncementPreview(admin, fresh.id); assert.equal(result.created, 2); assert.deepEqual(await applyAnnouncementPreview(admin, fresh.id), result);
  assert.equal(Number((await db.execute('SELECT count(*) n FROM academic_outbox')).rows[0].n), 2);
  await assert.rejects(announcementPreview(x.actor, a.campaignId, input), (e: any) => e.code === 'ADMIN_ONLY');
});
test('group questions are shared only after an answer, and legacy settings write to their original source', async () => {
  const a = await cls(), b = await cls('INT3131'); const x = await admit(a), y = await admit(b, '24020002');
  const q = await askQuestion(x.actor, a.campaignId, 'Hỏi chung'); assert.equal((await classQuestions(y.actor, a.campaignId)).length, 0); await answerQuestion(admin, a.campaignId, q.id, { answer: 'Trả lời chung', expectedRevision: 0 }); assert.equal((await classQuestions(y.actor, b.id)).length, 1);
  await db.execute("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(50,'22020001@vnu.edu.vn','Cũ','student','22020001','INT4002')");
  const before = await legacyPreview(admin); await applyLegacy(admin, before.id); const s = await snapshot(); const p = s.campaigns!.find(p => p.legacy)!;
  await updateCampaign(admin, p.id, { expectedRevision: p.revision, settings: { plan: 'Kế hoạch cũ cập nhật chung', submissionCloseAt: '2099-01-01T10:00:00+07:00' } });
  const settings = Object.fromEntries((await db.execute('SELECT * FROM settings')).rows.map(r => [r.key, r.value])); assert.equal(settings.implementation_plan_md, 'Kế hoạch cũ cập nhật chung'); assert.equal(settings.final_report_close_at, '2099-01-01T10:00');
});

test('legacy chat history and read state appear in the unified campaign without copying message IDs', async () => {
  await db.executeMultiple(`CREATE TABLE chat_group_messages(id INTEGER PRIMARY KEY,lecturer_id INTEGER,sender_user_id INTEGER,body TEXT,created_at TEXT,attachment_key TEXT,attachment_name TEXT,attachment_size INTEGER);
    ALTER TABLE chat_group_messages ADD COLUMN attachment_mime TEXT;
    CREATE TABLE chat_group_message_reads(message_id INTEGER,user_id INTEGER,PRIMARY KEY(message_id,user_id));
    INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(50,'22020001@vnu.edu.vn','SV cũ','student','22020001','INT4002');
    INSERT INTO advisor_assignments(id,user_id,lecturer_id,role,assigned_at) VALUES(50,50,1,'primary','2026-01-01');
    INSERT INTO chat_group_messages(id,lecturer_id,sender_user_id,body,created_at,attachment_key,attachment_name,attachment_size) VALUES(7,1,2,'Tin nhắn gốc','2026-01-01 08:00:00','old/file.pdf','file.pdf',20);
    INSERT INTO chat_group_message_reads VALUES(7,50);`);
  const p = await legacyPreview(admin); await applyLegacy(admin, p.id); const s = await snapshot(); const c = s.classes.find(c => c.legacy)!;
  const messages = await chatMessages(alpha, c.id, 1); assert.equal(messages[0].id, 'legacy-group-7'); assert.equal(messages[0].attachment_name, 'file.pdf');
  assert.equal(Number((await db.execute('SELECT count(*) n FROM chat_group_messages')).rows[0].n), 1);
  assert.ok((await db.execute('SELECT 1 FROM chat_group_message_reads WHERE message_id=7 AND user_id=50')).rows.length);
  const sent = await sendChat(alpha, c.id, 1, undefined, 'Ghi vào nguồn cũ'); assert.ok(sent.id.startsWith('legacy-group-'));
  assert.equal(Number((await db.execute('SELECT count(*) n FROM chat_group_messages')).rows[0].n), 2);
  assert.equal(Number((await db.execute('SELECT count(*) n FROM academic_messages')).rows[0].n), 0);
});

test('historical legacy questions retain their private audience and are answered in their original table', async () => {
  await db.executeMultiple(`CREATE TABLE faq_questions(id INTEGER PRIMARY KEY,user_id INTEGER,role TEXT,question TEXT,answer TEXT,status TEXT,created_at TEXT,answered_at TEXT,answered_by INTEGER);
    INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(50,'22020001@vnu.edu.vn','SV A','student','22020001','INT4002'),(51,'22020002@vnu.edu.vn','SV B','student','22020002','INT3508');
    INSERT INTO faq_questions VALUES(1,50,'student','Câu hỏi riêng','Câu trả lời riêng','answered','2026-01-01','2026-01-02',1);`);
  const preview = await legacyPreview(admin); await applyLegacy(admin, preview.id); const s = await snapshot(); const p = s.campaigns!.find(p => p.legacy)!;
  const a: AuthenticatedUser = { id: 50, email: '22020001@vnu.edu.vn', name: 'A', role: 'student' }, b: AuthenticatedUser = { ...a, id: 51, email: '22020002@vnu.edu.vn' };
  assert.equal((await classQuestions(a, p.id)).length, 1); assert.equal((await classQuestions(b, p.id)).length, 0);
  const q = (await classQuestions(admin, p.id))[0]; await answerQuestion(admin, p.id, String(q.id), { expectedRevision: Number(q.revision), answer: 'Cập nhật riêng' });
  assert.equal((await db.execute('SELECT answer FROM faq_questions WHERE id=1')).rows[0].answer, 'Cập nhật riêng');
  await assert.rejects(answerQuestion(admin, p.id, String(q.id), { expectedRevision: Number(q.revision), answer: 'Ghi đè bản cũ' }), (e: any) => e.code === 'STALE_QUESTION');
});
test('legacy endpoints honor campaign archive and pending migration while catalogs remain writable', async () => {
  const preview = await legacyPreview(admin); await applyLegacy(admin, preview.id); let s = await snapshot(); const p = s.campaigns!.find(p => p.legacy)!;
  assert.equal(await legacyCampaignArchived(), false);
  await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'archived', reason: 'Kết thúc đợt' }); assert.equal(await legacyCampaignArchived(), true);
  const check = async (path: string, method = 'PUT') => { let status = 0; let passed = false; await legacyAcademicWriteGuard({ method, path }, { status: (value: number) => { status = value; return { json: () => null }; } }, () => { passed = true; }); return { status, passed }; };
  for (const path of ['/api/admin/grades/1/lock', '/api/settings/faq', '/api/faq/questions', '/api/admin/faq/questions/1/answer', '/api/admin/notifications/final-report-reminders']) assert.equal((await check(path)).status, 403);
  assert.equal((await check('/api/settings/faq', 'GET')).passed, true); assert.equal((await check('/api/admin/lecturers/1')).passed, true);
  await db.execute({ sql: 'DELETE FROM academic_campaigns WHERE id=?', args: [p.id] }); assert.equal(await legacyCampaignArchived(), true);
});
