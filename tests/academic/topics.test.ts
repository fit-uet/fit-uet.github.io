import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import XLSX from 'xlsx';
import { createAcademicFixture } from './fixture';
import { db } from '../../server/db';
import { JWT_SECRET } from '../../server/config';
import { commit, snapshot, AcademicError } from '../../server/academic/store';
import { newEnrollment, getEnrollment, getClass, currentVersion } from '../../server/academic/domain';
import { createSemester, createClass, enrollmentAction, enrollmentView, grade } from '../../server/academic/service';
import { campaignEnrollments, updateCampaign } from '../../server/academic/campaigns';
import { campaignExport } from '../../server/academic/campaignExports';
import { submitBundle } from '../../server/academic/submissions';
import { planImport } from '../../server/academic/imports';
import { migrateProjectTopics, previewTopicMigration } from '../../server/academic/topicMigration';
import { academicRouter } from '../../server/academic/routes';
import type { AcademicClass, CourseEnrollment } from '../../src/shared/academic';
import type { AuthenticatedUser } from '../../server/types';

const admin: AuthenticatedUser = { id: 1, role: 'admin', name: 'Khoa', email: 'admin@vnu.edu.vn' };
const alpha: AuthenticatedUser = { id: 2, role: 'lecturer', name: 'TS. Alpha', email: 'alpha@vnu.edu.vn' };
const beta: AuthenticatedUser = { id: 3, role: 'lecturer', name: 'TS. Beta', email: 'beta@vnu.edu.vn' };
let client: Client, directory: string, previousCwd: string, c: AcademicClass, e: CourseEnrollment, sv: AuthenticatedUser;
const errorCode = (code: string) => (error: unknown) => error instanceof AcademicError && error.code === code;
const fresh = async () => getEnrollment(await snapshot(), e.id);
const action = async (actor: AuthenticatedUser, kind: 'topic' | 'topicApprove', title?: string, reason?: string) => enrollmentAction(actor, e.id, { expectedRevision: (await fresh()).revision, title, reason }, kind);
const pdf = { bytes: Buffer.from('%PDF-1.4\n%%EOF'), name: 'report.pdf', mime: 'application/pdf' };
async function submit(reuse = false) {
  const current = await fresh();
  return submitBundle(sv, e.id, { expectedRevision: current.revision, slidesUrl: 'https://docs.google.com/presentation/d/slide/edit', demoUrl: 'https://drive.google.com/file/d/demo/view', reusePdfVersionId: reuse ? currentVersion(current).id : undefined }, reuse ? undefined : pdf);
}
async function mark(value: number, comment = 'Đánh giá') { const row = await fresh(); return grade(alpha, e.id, 'advisor', { expectedRevision: row.revision, submissionVersionId: currentVersion(row).id, score: value, comment }); }
async function settings(input: Record<string, string>) { const s = await snapshot(); const p = s.campaigns!.find(p => p.id === c.campaignId)!; await updateCampaign(admin, p.id, { expectedRevision: p.revision, settings: input }); c = getClass(await snapshot(), c.id); }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'project-topics-')); previousCwd = process.cwd(); process.chdir(directory);
  client = await createAcademicFixture();
  const semester = await createSemester(admin, 2026, '1');
  c = await createClass(admin, { semesterId: semester.id, courseCode: 'INT3132', section: '1' });
  let s = await snapshot(); await updateCampaign(admin, c.campaignId, { expectedRevision: s.campaigns!.find(p => p.id === c.campaignId)!.revision, status: 'active' });
  s = await snapshot(); c = getClass(s, c.id); e = newEnrollment(c, { studentId: '24020001', name: 'SV Dự án' });
  e.assignments = [{ id: 'primary', lecturerId: 1, role: 'primary', assignedAt: new Date().toISOString() }, { id: 'co', lecturerId: 2, role: 'co', assignedAt: new Date().toISOString() }];
  await commit(s, 1, 'admin.test.admit', { enrollments: [e], users: [{ studentId: e.studentId, name: e.name, email: e.email, dob: '', className: '' }] });
  sv = { id: Number((await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [e.email] })).rows[0].id), email: e.email, role: 'student', name: e.name };
});
afterEach(async () => { client.close(); process.chdir(previousCwd); await rm(directory, { recursive: true, force: true }); });

test('student proposal is pending, cannot write a PDF until approved, and no-op preserves approval', async () => {
  assert.equal((await fresh()).topicReview?.status, 'unregistered');
  await action(sv, 'topic', 'Đề tài A');
  assert.equal((await fresh()).topicReview?.status, 'pending');
  await assert.rejects(submit(), errorCode('TOPIC_PENDING'));
  assert.deepEqual(await readdir(directory), []);
  await action(alpha, 'topicApprove'); await submit();
  const approved = (await fresh()).topicReview;
  await action(sv, 'topic', 'Đề tài A');
  assert.deepEqual((await fresh()).topicReview, approved);
  await action(sv, 'topic', 'Đề tài B');
  assert.equal((await fresh()).topicReview?.status, 'pending');
  assert.equal((await fresh()).topicReview?.version, 2);
  const view = enrollmentView(await snapshot(), c, await fresh(), sv);
  assert.equal(view.topicPermissions?.requiresResubmission, true);
  for (const field of ['evaluations', 'internshipGrade', 'finalScore']) assert.ok(!(field in view));
});
test('only current primary adviser can approve/edit; admin correction remains pending with a reason', async () => {
  await action(sv, 'topic', 'Đề tài A');
  await assert.rejects(action(beta, 'topicApprove'), errorCode('TOPIC_APPROVAL_DENIED'));
  await assert.rejects(action(beta, 'topic', 'Không hợp lệ'), errorCode('TOPIC_EDIT_DENIED'));
  await assert.rejects(action(admin, 'topicApprove'), errorCode('TOPIC_APPROVAL_DENIED'));
  await assert.rejects(action(admin, 'topic', 'Đề tài Khoa'), errorCode('REASON_REQUIRED'));
  await action(admin, 'topic', 'Đề tài Khoa', 'Hiệu chỉnh tên');
  assert.equal((await fresh()).topicReview?.status, 'pending');
  await action(alpha, 'topic', 'Đề tài GV sửa');
  assert.equal((await fresh()).topicReview?.approvedByLecturerId, 1);
  assert.equal((await fresh()).topicReview?.approvedById, alpha.id);
});
test('admin who is the assigned adviser edits with automatic approval and assignments preserve approval', async () => {
  await db.execute("INSERT INTO lecturers(id,name,email,work_unit) VALUES(99,'TS. Khoa','admin@vnu.edu.vn','Bộ môn A')");
  let row = await fresh(); await enrollmentAction(admin, e.id, { expectedRevision: row.revision, assignments: [{ role: 'primary', lecturerId: 99 }] }, 'assignments');
  await action(admin, 'topic', 'Đề tài của Khoa/GV');
  const approval = (await fresh()).topicReview;
  assert.equal(approval?.approvedByLecturerId, 99);
  row = await fresh(); await enrollmentAction(admin, e.id, { expectedRevision: row.revision, assignments: [{ role: 'primary', lecturerId: 2 }] }, 'assignments');
  assert.deepEqual((await fresh()).topicReview, approval);
  await assert.rejects(action(alpha, 'topicApprove'), errorCode('CLASS_ACCESS_DENIED'));
});
test('stale approval and stale submission cannot approve or submit a changed topic', async () => {
  await action(sv, 'topic', 'Tên A'); const old = await fresh(); await action(sv, 'topic', 'Tên B');
  await assert.rejects(enrollmentAction(alpha, e.id, { expectedRevision: old.revision }, 'topicApprove'), errorCode('REVISION_CONFLICT'));
  assert.equal((await fresh()).topicReview?.status, 'pending');
  await action(alpha, 'topicApprove');
  await assert.rejects(submitBundle(sv, e.id, { expectedRevision: old.revision }, pdf), errorCode('REVISION_CONFLICT'));
});
test('changed title, including a change back, needs a new submitted snapshot before nonzero grading', async () => {
  await action(alpha, 'topic', 'Tên A'); await submit();
  const original = currentVersion(await fresh());
  await action(sv, 'topic', 'Tên B'); await action(sv, 'topic', 'Tên A'); await action(alpha, 'topicApprove');
  await assert.rejects(mark(8), errorCode('TOPIC_SUBMISSION_REQUIRED'));
  await submit(true); const row = await fresh();
  assert.equal(row.versions.length, 3); assert.equal(row.versions[1].id, original.id);
  assert.equal(currentVersion(row).objectKey, original.objectKey);
  assert.equal(currentVersion(row).topicVersion, 3);
  await mark(8); await assert.rejects(action(alpha, 'topic', 'Tên C'), errorCode('SUBMISSION_LOCKED'));
  const r = await fresh(); await enrollmentAction(admin, e.id, { expectedRevision: r.revision, reason: 'Mở lại để sửa', submissionUntil: new Date(Date.now() + 3600000).toISOString() }, 'reopen');
  await action(alpha, 'topic', 'Tên C'); assert.equal((await fresh()).topicReview?.status, 'approved');
});
test('zero with a reason remains available for missing/pending work', async () => {
  await action(sv, 'topic', 'Tên pending');
  await assert.rejects(mark(0, ''), errorCode('COMMENT_REQUIRED'));
  await mark(0, 'Sinh viên bỏ môn'); assert.equal((await fresh()).evaluations[currentVersion(await fresh()).id].advisor?.score, 0);
});
test('late approval grants only submission until grading close, never student topic editing', async t => {
  await action(sv, 'topic', 'Tên A');
  await settings({ topicOpenAt: '2026-09-07T00:00:00+07:00', topicCloseAt: '2026-12-20T23:59:59+07:00', submissionOpenAt: '2026-12-14T00:00:00+07:00', submissionCloseAt: '2026-12-20T23:59:59+07:00', gradingCloseAt: '2026-12-27T23:59:59+07:00' });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-21T12:00:00+07:00') });
  await action(alpha, 'topicApprove'); const row = await fresh();
  assert.equal(row.topicSubmissionUntil, c.settings.gradingCloseAt); assert.equal(row.reopenUntil, null);
  assert.equal(enrollmentView(await snapshot(), c, row, sv).topicPermissions?.canSubmit, true);
  await assert.rejects(action(sv, 'topic', 'SV sửa muộn'), errorCode('OUTSIDE_WINDOW')); await submit();
  await action(alpha, 'topic', 'GV sửa muộn'); assert.equal((await fresh()).topicSubmissionUntil, c.settings.gradingCloseAt); await submit(true);
  t.mock.timers.tick(7 * 86400000);
  await assert.rejects(submit(true), errorCode('OUTSIDE_WINDOW'));
  await assert.rejects(action(alpha, 'topic', 'Quá hạn'), errorCode('OUTSIDE_WINDOW'));
});
test('missing grading close does not create an unlimited submission exception', async t => {
  await action(sv, 'topic', 'Tên A'); await settings({ submissionCloseAt: '2026-12-20T23:59:59+07:00' });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-21T12:00:00+07:00') });
  await action(alpha, 'topicApprove'); assert.equal((await fresh()).topicSubmissionUntil, null);
  await assert.rejects(submit(), errorCode('OUTSIDE_WINDOW'));
});
test('unassigned, archived and withdrawn records cannot bypass topic approval', async () => {
  let row = await fresh(); await enrollmentAction(admin, e.id, { expectedRevision: row.revision, assignments: [] }, 'assignments');
  await action(sv, 'topic', 'Chưa có GVHD'); await assert.rejects(submit(), errorCode('TOPIC_PENDING'));
  row = await fresh(); await assert.rejects(enrollmentAction(admin, e.id, { expectedRevision: row.revision, status: 'withdrawn', reason: 'Rút lớp' }, 'status'), errorCode('PROJECT_MEMBERSHIP_ONLY'));
  const s = await snapshot(); const p = s.campaigns!.find(p => p.id === c.campaignId)!; await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'archived', reason: 'Lưu trữ' });
  await assert.rejects(action(admin, 'topic', 'Sửa', 'Có lý do'), errorCode('CLASS_READ_ONLY'));
});
test('metadata migration recognizes old topics without inventing an approver and reruns safely', async () => {
  const raw = await fresh(); raw.topic = 'Tên lịch sử'; delete raw.topicReview; delete raw.topicSubmissionUntil;
  raw.versions[0].title = 'Snapshot cũ khác tên';
  await db.execute({ sql: 'UPDATE academic_enrollments SET data=? WHERE id=?', args: [JSON.stringify(raw), e.id] });
  const preview = await previewTopicMigration(db); assert.equal(preview.length, 1); assert.equal((await fresh()).topicReview, undefined);
  assert.equal(preview[0].after.topicReview?.source, 'legacy');
  await migrateProjectTopics(db); const after = await fresh();
  assert.equal(after.topicReview?.approvedById, null); assert.equal(after.topicReview?.approvedByLecturerId, null);
  assert.equal(after.topic, raw.topic); assert.equal(after.versions[0].title, raw.versions[0].title);
  const restored = structuredClone(after); delete restored.topicReview; delete restored.topicSubmissionUntil; restored.revision--; for (const v of restored.versions) delete v.topicVersion;
  assert.deepEqual(restored, raw); assert.equal((await migrateProjectTopics(db)).migrated, 0);
  assert.deepEqual(await fresh(), after);
});
test('imports are pending, repeated identical imports retain approval, and filtered exports use topicStatus', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mã SV','Họ và tên','Lớp khóa học','Mã LMH','Chủ đề'],[e.studentId,e.name,'','INT3132 1','Tên import']]), 'DACN');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  let s = await snapshot(); let plan = planImport(s, c.semesterId, bytes); assert.equal(plan.summary.errors, 0);
  assert.equal(plan.changes.enrollments![0].topicReview?.status, 'pending'); await commit(s, 1, 'admin.enrollments.import', plan.changes);
  await action(alpha, 'topicApprove'); s = await snapshot(); plan = planImport(s, c.semesterId, bytes);
  assert.equal(plan.summary.unchanged, 1); assert.equal(plan.changes.enrollments!.length, 0);
  assert.equal((await campaignEnrollments(alpha, c.campaignId, { topicStatus: 'pending' })).total, 0);
  assert.equal((await campaignEnrollments(alpha, c.campaignId, { topicStatus: 'approved' })).total, 1);
  const rows = await campaignExport(admin, c.campaignId, 'students', { topicStatus: 'approved' });
  assert.equal(rows.length, 1); assert.equal(rows[0]['Trạng thái đề tài'], 'Đã duyệt');
});
test('GET/PUT/approve topic API exposes state, protects adviser permissions and preserves independent records', async () => {
  const app = express(); app.use(express.json(), academicRouter); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/enrollments/${e.id}/topic`;
  const headers = (who: AuthenticatedUser) => ({ Authorization: `Bearer ${jwt.sign({email:who.email},JWT_SECRET)}`, 'Content-Type':'application/json' });
  try {
    const put = await fetch(url,{method:'PUT',headers:headers(sv),body:JSON.stringify({title:'API topic',expectedRevision:(await fresh()).revision})}); assert.equal(put.status,200);
    const pending = await (await fetch(url,{headers:headers(sv)})).json(); assert.equal(pending.topicReview.status,'pending'); assert.equal(pending.topicPermissions.canSubmit,false);
    const deny = await fetch(url+'/approve',{method:'POST',headers:headers(beta),body:JSON.stringify({expectedRevision:pending.revision})}); assert.equal(deny.status,403);
    const ok = await fetch(url+'/approve',{method:'POST',headers:headers(alpha),body:JSON.stringify({expectedRevision:pending.revision})}); assert.equal(ok.status,200);
    const second = await createClass(admin,{semesterId:c.semesterId,courseCode:'INT3131',section:'1'}); const s = await snapshot(); const other = newEnrollment(second,{studentId:e.studentId,name:e.name}); await commit(s,1,'admin.test.second',{enrollments:[other]});
    assert.equal(getEnrollment(await snapshot(),other.id).topicReview?.status,'unregistered'); assert.equal((await fresh()).topicReview?.status,'approved');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('metadata migration rejects a concurrent user edit rather than overwriting it', async () => {
  const raw = await fresh(); raw.topic = 'Đề tài cũ'; delete raw.topicReview; delete raw.topicSubmissionUntil;
  await db.execute({sql:'UPDATE academic_enrollments SET data=? WHERE id=?',args:[JSON.stringify(raw),e.id]});
  let injected = false;
  const racing = { ...db, execute: async (stmt: Parameters<typeof db.execute>[0]) => {
    if (!injected && typeof stmt !== 'string' && stmt.sql.startsWith('INSERT INTO academic_commands')) {
      injected = true; await action(sv, 'topic', 'Tên do người dùng vừa sửa');
    }
    return db.execute(stmt);
  }};
  await assert.rejects(migrateProjectTopics(racing), /ACADEMIC_STALE/);
  const row = await fresh(); assert.equal(row.topic, 'Tên do người dùng vừa sửa'); assert.equal(row.topicReview?.status, 'pending');
  assert.equal((await migrateProjectTopics(db)).migrated, 0); assert.deepEqual(await fresh(), row);
});

test('approval deadline is inclusive and reviewer role never grants approval', async t => {
  await action(sv, 'topic', 'Đề tài A');
  const s = await snapshot(); const row = await fresh(); row.assignments = row.assignments.map(a=>a.role==='co'?{...a,role:'reviewer' as const}:a); await commit(s,1,'admin.test.reviewer',{enrollments:[row]});
  await assert.rejects(action(beta,'topicApprove'),errorCode('TOPIC_APPROVAL_DENIED'));
  await settings({topicOpenAt:'2026-09-07T00:00:00+07:00',submissionCloseAt:'2026-12-20T23:59:59+07:00',gradingCloseAt:'2026-12-27T23:59:59+07:00'});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-27T23:59:59+07:00')});
  await action(alpha,'topicApprove'); assert.equal((await fresh()).topicSubmissionUntil,c.settings.gradingCloseAt);
  t.mock.timers.tick(1); await assert.rejects(action(alpha,'topic','Quá hạn 1 ms'),errorCode('OUTSIDE_WINDOW'));
});

test('shortening the campaign grading deadline also ends the automatic submission extension', async t => {
  await action(sv,'topic','Đề tài A');
  await settings({submissionCloseAt:'2026-12-20T23:59:59+07:00',gradingCloseAt:'2026-12-27T23:59:59+07:00'});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-22T12:00:00+07:00')});
  await action(alpha,'topicApprove'); assert.equal(enrollmentView(await snapshot(),c,await fresh(),sv).topicPermissions?.canSubmit,true);
  await settings({gradingCloseAt:'2026-12-21T23:59:59+07:00'});
  assert.equal(enrollmentView(await snapshot(),c,await fresh(),sv).topicPermissions?.canSubmit,false);
  await assert.rejects(submit(),errorCode('OUTSIDE_WINDOW'));
});
