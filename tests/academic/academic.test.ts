import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type Client } from '@libsql/client';
import { createAcademicFixture } from './fixture';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import { setDb, db } from '../../server/db';
import { JWT_SECRET } from '../../server/config';
import { initAcademicSchema } from '../../server/academic/schema';
import { AcademicError, commit, snapshot, readPreview } from '../../server/academic/store';
import { allocateReviewers, currentVersion, getClass, getEnrollment, newEnrollment, totalScore, validateAssignments, weightedScore } from '../../server/academic/domain';
import { createSemester, createClass, updateClass, classDetail, enrollmentAction, grade, reviewerPreview, applyReviewers, updateQuotas } from '../../server/academic/service';
import { changeTopic, approveTopic } from '../../server/academic/topics';
import { updateCampaign } from '../../server/academic/campaigns';
import { dateOfBirth, planImport } from '../../server/academic/imports';
import { submitBundle } from '../../server/academic/submissions';
import { legacyPreview, applyLegacy } from '../../server/academic/legacy';
import { academicRouter } from '../../server/academic/routes';
import { assertStudentCohortAllowed } from '../../server/services/cohorts';
import { deliverAcademicOutbox } from '../../server/academic/outbox';
import { internshipAction } from '../../server/academic/internship';
import { sendChat, chatMessages, retractChat } from '../../server/academic/chat';
import { askQuestion, answerQuestion, classQuestions, announce } from '../../server/academic/communications';
import { allowedAcademicQueue, visibleAcademicNotifications } from '../../server/academic/notificationAccess';
import { lecturerRouter } from '../../server/routes/lecturer.routes';
import { commonRouter } from '../../server/routes/common.routes';
import { getActorLecturer } from '../../server/middlewares/auth';
import type { AcademicClass, CourseEnrollment } from '../../src/shared/academic';
import type { AuthenticatedUser } from '../../server/types';

let client: Client; let directory: string; let originalCwd: string;
const admin: AuthenticatedUser = { id: 1, email: 'admin@vnu.edu.vn', name: 'Khoa', role: 'admin' };
const alpha: AuthenticatedUser = { id: 2, email: 'alpha@vnu.edu.vn', name: 'TS. Alpha', role: 'lecturer' };
const beta: AuthenticatedUser = { id: 3, email: 'beta@vnu.edu.vn', name: 'TS. Beta', role: 'lecturer' };
const gamma: AuthenticatedUser = { id: 4, email: 'gamma@vnu.edu.vn', name: 'ThS. Gamma', role: 'lecturer' };
const studentIds = new Map<string, number>();
const student = (id: string): AuthenticatedUser => ({ id: studentIds.get(id) || 100, email: `${id}@vnu.edu.vn`, name: 'Sinh viên', role: 'student', student_id: id, legacy_internship_access: 0 });
const rejects = (code: string) => (error: unknown) => error instanceof AcademicError && error.code === code;

beforeEach(async () => {
  studentIds.clear();
  directory = await mkdtemp(join(tmpdir(), 'academic-test-')); originalCwd = process.cwd(); process.chdir(directory);
  client = await createAcademicFixture();
});
afterEach(async () => { client.close(); process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); });

async function activeClass(code = 'INT3132', section = '1', year = 2026) {
  const sem = await createSemester(admin, year, '1'); const c = await createClass(admin, { semesterId: sem.id, courseCode: code, section });
  const p = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!;
  await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'active' });
  return getClass(await snapshot(), c.id);
}
async function admit(c: AcademicClass, id = '24020001', primary = 1, co: number[] = []) {
  const s = await snapshot(); const e = newEnrollment(c, { studentId: id, name: `SV ${id}`, className: 'CS1' });
  e.assignments = [{ id: `primary-${e.id}`, lecturerId: primary, role: 'primary', assignedAt: new Date().toISOString() }, ...co.map(l => ({ id: `co-${e.id}-${l}`, lecturerId: l, role: 'co' as const, assignedAt: new Date().toISOString() }))];
  if (c.courseCode.startsWith('INT313')) { changeTopic(e, 'Đề tài kiểm thử'); approveTopic(s, c, e, { ...alpha, email: s.lecturers.find(l => l.id === primary)!.email }); }
  await commit(s, admin.id, 'admin.test.admit', { enrollments: [e], users: [{ studentId: id, email: e.email, name: e.name, dob: '', className: e.className }] });
  studentIds.set(id, Number((await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [e.email] })).rows[0].id)); return e;
}
async function fresh(id: string) { return getEnrollment(await snapshot(), id); }

test('campaign entry preserves an unmapped legacy student without admitting project-only students to the old workflow', async () => {
  await db.executeMultiple("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(200,'23020001@vnu.edu.vn','Chờ học phần','student','23020001',NULL),(201,'23020002@vnu.edu.vn','Đã xác định','student','23020002','INT4002')");
  const preview = await legacyPreview(admin); await applyLegacy(admin, preview.id);
  const c = await activeClass(); await admit(c, '24020001');
  const app = express(); app.use(academicRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const read = async (email: string) => {
      const token = jwt.sign({ email }, JWT_SECRET);
      const response = await fetch(`${base}/api/me/campaigns`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200); return response.json();
    };
    const unmapped = await read('23020001@vnu.edu.vn');
    assert.equal(unmapped.legacyInternshipUnmapped, true); assert.equal(unmapped.campaigns.length, 0);
    assert.equal((await read('23020002@vnu.edu.vn')).legacyInternshipUnmapped, false);
    const projectOnly = await read('24020001@vnu.edu.vn');
    assert.equal(projectOnly.legacyInternshipUnmapped, false); assert.ok(projectOnly.campaigns.every(p => !p.legacy));
    assert.equal((await read(admin.email)).legacyInternshipUnmapped, false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
async function withReviewer(c: AcademicClass, e: CourseEnrollment, reviewer = 2) {
  const v = await fresh(e.id); await enrollmentAction(admin, e.id, { expectedRevision: v.revision, assignments: [...v.assignments, { role: 'reviewer', lecturerId: reviewer }] }, 'assignments'); return fresh(e.id);
}
async function submitted(e: CourseEnrollment) {
  const latest = await fresh(e.id);
  await submitBundle(student(e.studentId), e.id, { expectedRevision: latest.revision, slidesUrl: 'https://docs.google.com/presentation/d/example/edit', demoUrl: 'https://drive.google.com/file/d/demo/view' }, { bytes: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'), name: 'report.pdf', mime: 'application/pdf' }); return fresh(e.id);
}
async function record(e: CourseEnrollment, who: AuthenticatedUser, role: string, value: number) {
  const latest = await fresh(e.id); return grade(who, e.id, role, { expectedRevision: latest.revision, submissionVersionId: currentVersion(latest).id, score: value, comment: 'Đánh giá và lý do.' });
}
function workbook(rows: unknown[][], hidden: unknown[][] = []) {
  const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'Lớp khóa học', 'Mã LMH', 'Ghi chú', 'GVHD', 'Email của GVHD', 'Chủ đề'];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'DACN');
  if (hidden.length) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...hidden]), 'MỚI-DACN'); wb.Workbook = { Sheets: [{ name: 'DACN' }, { name: 'MỚI-DACN', Hidden: 1 }] }; }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('additive schema is idempotent and preserves legacy data', async () => {
  await client.execute("INSERT INTO users(email,name,role,student_id,course_code) VALUES('22020001@vnu.edu.vn','Cũ','student','22020001','INT4002')");
  await initAcademicSchema(db); assert.equal(Number((await db.execute('SELECT count(*) n FROM users')).rows[0].n), 5);
  assert.equal((await db.execute("SELECT legacy_internship_access FROM users WHERE student_id='22020001'")).rows[0].legacy_internship_access, 1);
});
test('multiple classes, years and courses never share an enrollment', async () => {
  const a = await activeClass(); const b = await activeClass('INT3131'); const later = await activeClass('INT3132', '1', 2027);
  const ea = await admit(a); const eb = await admit(b); await admit(later);
  await enrollmentAction(student(ea.studentId), ea.id, { expectedRevision: (await fresh(ea.id)).revision, title: 'Chỉ lớp A' }, 'topic');
  assert.equal((await fresh(eb.id)).topic, 'Đề tài kiểm thử'); assert.equal((await snapshot()).enrollments.length, 3);
  await assert.rejects(createClass(admin, { semesterId: a.semesterId, courseCode: a.courseCode, section: '1' }), rejects('DUPLICATE_CLASS'));
});
test('project-only imports do not become legacy cohort exceptions', async () => {
  const c = await activeClass(); await admit(c);
  await assert.rejects(assertStudentCohortAllowed('24020001@vnu.edu.vn'));
  assert.equal((await db.execute("SELECT legacy_internship_access FROM users WHERE student_id='24020001'")).rows[0].legacy_internship_access, 0);
});
test('import groups duplicates, supports dates, ignores hidden sheets and flags MSSV 134', async () => {
  const sem = await createSemester(admin, 2026, '1'); const s = await snapshot();
  const bytes = workbook([[1, 24020001, 'SV A', 40000, 'CS1', 'INT3132 1', 'ĐK lần đầu', '', '', ''], [2, 24020001, 'SV A', 40000, 'CS1', 'INT3132 1', 'ĐK lần đầu', 'Alpha', 'alpha@vnu.edu.vn', 'Đề tài A'], [3, 134, 'SV B', '21/09/2005', 'CS1', 'INT3132 1']], [[4, 24029999, 'Ẩn', '', 'CS1', 'INT3132 9']]);
  const plan = planImport(s, sem.id, bytes);
  assert.equal(plan.rows.length, 2); assert.equal(plan.rows[0].primaryId, 1); assert.deepEqual(plan.rows[0].sources, ['DACN:2', 'DACN:3']); assert.equal(plan.summary.errors, 1);
  assert.ok(plan.rows[1].issues.some(x => x.includes('8 chữ số'))); assert.equal(dateOfBirth('21/09/2005', false), '2005-09-21'); assert.equal(dateOfBirth('31/02/2005', false), null);
  assert.equal(plan.changes.classes!.length, 1);
});
test('import refuses conflicting lecturer email, CN and conflicting duplicates', async () => {
  const sem = await createSemester(admin, 2026, '1'); const s = await snapshot();
  const plan = planImport(s, sem.id, workbook([[1, 24020001, 'A', '', 'CS1', 'INT3132 1', '', 'Alpha', 'wrong@vnu.edu.vn'], [2, 24020002, 'B', '', 'CS1', 'INT3132 1', '', 'Delta', 'delta@vnu.edu.vn'], [3, 24020001, 'Khác tên', '', 'CS1', 'INT3132 1', '', 'Alpha', 'alpha@vnu.edu.vn']]));
  assert.equal(plan.summary.errors, 2); assert.ok(plan.rows[0].issues.length >= 2);
});
test('single-statement commit rolls back all users, rows and audit on a late constraint error', async () => {
  const c = await activeClass(); const s = await snapshot(); const e = newEnrollment(c, { studentId: '24020001', name: 'A' });
  await assert.rejects(commit(s, admin.id, 'admin.test.atomic', { enrollments: [e], users: [{ studentId: '24020001', email: 'alpha@vnu.edu.vn', name: 'Collision', dob: '', className: '' }, { studentId: '24020001', email: 'second@vnu.edu.vn', name: 'Collision 2', dob: '', className: '' }, { studentId: '24020001', email: 'third@vnu.edu.vn', name: 'Collision 3', dob: '', className: '' }] }));
  assert.equal((await snapshot()).revision, s.revision); assert.equal((await snapshot()).enrollments.length, 0);
  assert.equal(Number((await db.execute("SELECT count(*) n FROM academic_commands WHERE action='admin.test.atomic'")).rows[0].n), 0);
  assert.equal(Number((await db.execute("SELECT count(*) n FROM users WHERE email='second@vnu.edu.vn'")).rows[0].n), 0);
});
test('CAS prevents stale and concurrent changes and detects changed lecturer metadata', async () => {
  const c = await activeClass(); const s = await snapshot(); const clone = structuredClone(c);
  const results = await Promise.allSettled([commit(s, 1, 'admin.a', { classes: [clone] }), commit(s, 1, 'admin.b', { classes: [structuredClone(c)] })]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const stale = await snapshot(); await db.execute("UPDATE lecturers SET work_unit='Đã đổi' WHERE id=1");
  await assert.rejects(commit(stale, 1, 'admin.stale', {}), rejects('STALE_PREVIEW'));
});
test('reviewer assignment excludes all advisors, excludes CN, balances both courses and respects zero quotas', async () => {
  const c = await activeClass(); const b = await activeClass('INT3131'); await admit(c, '24020001', 1, [2]); await admit(c, '24020002', 2); await admit(b, '24020003', 3);
  const s = await snapshot(); const rows = allocateReviewers(s, c.semesterId);
  const first = rows.find(x => x.enrollmentId === s.enrollments.find(e => e.studentId === '24020001')!.id)!;
  assert.equal(first.lecturerId, 3); assert.equal(first.reason, 'cross_work_unit'); assert.ok(rows.every(x => x.lecturerId !== 4));
  await updateQuotas(admin, c.semesterId, [{ lecturerId: 3, maxReviews: 0 }]);
  const blocked = allocateReviewers(await snapshot(), c.semesterId).find(x => x.enrollmentId === first.enrollmentId)!; assert.equal(blocked.lecturerId, null);
});
test('reviewer preview is actor-bound, rejects stale apply and is idempotent after commit', async () => {
  const c = await activeClass(); await admit(c, '24020001', 1); await admit(c, '24020002', 2);
  const old = await reviewerPreview(admin, c.semesterId, {}); await updateQuotas(admin, c.semesterId, [{ lecturerId: 1, maxReviews: 5 }]);
  await assert.rejects(applyReviewers(admin, old.id), rejects('STALE_PREVIEW'));
  await assert.rejects(readPreview(999, old.id, 'reviewers'), rejects('PREVIEW_NOT_FOUND'));
  const p = await reviewerPreview(admin, c.semesterId, {}); const result = await applyReviewers(admin, p.id);
  assert.equal(result.assigned, 2); assert.deepEqual(await applyReviewers(admin, p.id), result);
  assert.equal(allocateReviewers(await snapshot(), c.semesterId).length, 0);
});
test('manual assignments enforce the same role, primary/co conflict and CN rules', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); const s = await snapshot();
  assert.throws(() => validateAssignments(s, c, e, [{ role: 'primary', lecturerId: 1 }, { role: 'co', lecturerId: 2 }, { role: 'reviewer', lecturerId: 2 }]), rejects('REVIEWER_CONFLICT'));
  assert.throws(() => validateAssignments(s, c, e, [{ role: 'primary', lecturerId: 4 }]), rejects('BACHELOR_RESTRICTION'));
  assert.throws(() => validateAssignments(s, c, e, [{ role: 'primary', lecturerId: 1 }, { role: 'co', lecturerId: 1 }]), rejects('ADVISOR_CONFLICT'));
});
test('students cannot read other students or any numerical grade payload', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e); await submitted(e); await record(e, alpha, 'advisor', 8); await record(e, beta, 'reviewer', 8.5);
  const detail = await classDetail(c.id, student(e.studentId)); assert.equal(detail.enrollments.length, 1);
  assert.equal(detail.enrollments[0].evaluations, undefined); assert.equal(detail.enrollments[0].internshipGrade, undefined); assert.equal(detail.enrollments[0].finalScore, undefined);
  assert.ok(!/"(?:score|finalScore|progress|company)"\s*:/.test(JSON.stringify(detail.enrollments)));
  assert.equal((await classDetail(c.id, admin)).enrollments.find(x => x.id === e.id)!.finalScore, 8.2);
});
test('role ownership, score bounds and incomplete/zero scores are enforced', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e);
  await assert.rejects(record(e, beta, 'advisor', 8), rejects('GRADING_DENIED'));
  await assert.rejects(record(e, admin, 'advisor', 8), rejects('GRADING_DENIED'));
  await assert.rejects(record(e, alpha, 'advisor', 11), rejects('INVALID_SCORE'));
  await assert.rejects(record(e, alpha, 'advisor', 8), rejects('SUBMISSION_REQUIRED'));
  await record(e, alpha, 'advisor', 0); assert.equal(totalScore(c, await fresh(e.id)), null);
  await record(e, beta, 'reviewer', 0); assert.equal(totalScore(c, await fresh(e.id)), 0);
  assert.equal(currentVersion(await fresh(e.id)).state, 'empty'); assert.equal(weightedScore(0, 10), 4);
});
test('first grade locks the bundle, reopening preserves history and requires both new evaluations', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e); let latest = await submitted(e);
  await record(e, alpha, 'advisor', 8); await record(e, beta, 'reviewer', 8.5); latest = await fresh(e.id);
  const oldVersion = currentVersion(latest).id; assert.equal(totalScore(c, latest), 8.2);
  await assert.rejects(submitBundle(student(e.studentId), e.id, { expectedRevision: latest.revision }), rejects('SUBMISSION_LOCKED'));
  await enrollmentAction(admin, e.id, { expectedRevision: latest.revision, reason: 'Cập nhật báo cáo', submissionUntil: '2099-01-01T00:00:00+07:00' }, 'reopen');
  latest = await fresh(e.id); assert.ok(latest.evaluations[oldVersion].advisor); assert.equal(totalScore(c, latest), null);
  await submitBundle(student(e.studentId), e.id, { expectedRevision: latest.revision, reusePdfVersionId: currentVersion(latest).id, slidesUrl: currentVersion(latest).slidesUrl, demoUrl: currentVersion(latest).demoUrl });
  await record(e, alpha, 'advisor', 9); assert.equal(totalScore(c, await fresh(e.id)), null); await record(e, beta, 'reviewer', 9); assert.equal(totalScore(c, await fresh(e.id)), 9);
});
test('grade locks and archived classes block writes; unlocking does not extend deadlines', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e); await submitted(e); await record(e, alpha, 'advisor', 8); await record(e, beta, 'reviewer', 8.5);
  let latest = await fresh(e.id); await enrollmentAction(admin, e.id, { expectedRevision: latest.revision, locked: true, reason: 'Chốt' }, 'gradeLock');
  await assert.rejects(record(e, alpha, 'advisor', 9), rejects('GRADE_LOCKED'));
  const cls = getClass(await snapshot(), c.id); const p = (await snapshot()).campaigns!.find(p => p.id === cls.campaignId)!; await updateCampaign(admin, p.id, { expectedRevision: p.revision, status: 'archived', reason: 'Kết thúc' });
  await assert.rejects(record(e, alpha, 'advisor', 9), rejects('CLASS_READ_ONLY'));
  assert.equal((await classDetail(c.id, student(e.studentId))).enrollments.length, 1);
});
test('PDF validation and class ownership happen before file storage', async () => {
  const c = await activeClass(); const e = await admit(c); let latest = await fresh(e.id);
  const input = { expectedRevision: latest.revision, slidesUrl: 'https://drive.google.com/file/d/s/view', demoUrl: 'https://drive.google.com/file/d/d/view' };
  await assert.rejects(submitBundle(student('24029999'), e.id, input), rejects('CLASS_ACCESS_DENIED'));
  await assert.rejects(submitBundle(student(e.studentId), e.id, input, { bytes: Buffer.from('not pdf'), name: 'x.pdf', mime: 'application/pdf' }), rejects('INVALID_PDF'));
  await assert.rejects(submitBundle(student(e.studentId), e.id, { ...input, slidesUrl: 'https://drive.google.com.evil.example/x' }), rejects('INVALID_DRIVE_URL'));
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1); bytes.write('%PDF-');
  await assert.rejects(submitBundle(student(e.studentId), e.id, input, { bytes, name: 'x.pdf', mime: 'application/pdf' }), rejects('PDF_TOO_LARGE'));
  assert.equal(currentVersion(await fresh(e.id)).state, 'empty');
});
test('legacy mapping is additive and reads live report/grade values from their original source', async () => {
  await db.execute("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(20,'22020001@vnu.edu.vn','Cũ','student','22020001','INT4002'),(21,'22020002@vnu.edu.vn','Thiếu môn','student','22020002',NULL)");
  await db.execute("INSERT INTO advisor_assignments VALUES(1,20,1,'primary','2026-05-01')");
  await db.execute("INSERT INTO grades VALUES(1,20,8,8,8,1,'Nhận xét',NULL,'2026-10-01')");
  const p = await legacyPreview(admin); assert.equal(p.summary.created, 1); assert.equal(p.summary.blocked.length, 1); await applyLegacy(admin, p.id);
  const s = await snapshot(); const e = s.enrollments.find(e => e.legacy)!; const c = getClass(s, e.classId);
  assert.equal(c.semesterId, '2025-2026-summer'); assert.equal(totalScore(c, e), 8);
  await db.execute('UPDATE grades SET progress_score=10,report_score=10,company_score=10 WHERE id=1'); assert.equal(totalScore(c, await fresh(e.id)), 10);
  const again = await legacyPreview(admin); assert.equal(again.summary.created, 0);
  assert.equal(Number((await db.execute('SELECT count(*) n FROM grades')).rows[0].n), 1);
});
test('scoped internship preferences and final confirmation preserve five-choice and approval rules', async () => {
  const c = await activeClass('INT4002'); const e = await admit(c, '22020001'); let latest = await fresh(e.id);
  await internshipAction(student(e.studentId), e.id, { expectedRevision: latest.revision, companyId: 1 }, 'preference'); latest = await fresh(e.id);
  assert.equal(latest.preferences[0].status, 'approved');
  await assert.rejects(internshipAction(student(e.studentId), e.id, { expectedRevision: latest.revision, preferenceId: latest.preferences[0].id, attested: false }, 'confirm'), rejects('CONFIRMATION_DENIED'));
  await internshipAction(student(e.studentId), e.id, { expectedRevision: latest.revision, preferenceId: latest.preferences[0].id, attested: true }, 'confirm');
  assert.equal((await fresh(e.id)).finalInternship!.companyName, 'Công ty A');
});
test('chat membership is scoped to class and revoked immediately', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2);
  await sendChat(student(e.studentId), c.id, 1, e.id, 'Xin chào'); assert.equal((await chatMessages(alpha, c.id, 1, e.id)).length, 1);
  await assert.rejects(chatMessages(beta, c.id, 1, e.id), rejects('CHAT_ACCESS_DENIED'));
  await enrollmentAction(admin, e.id, { expectedRevision: (await fresh(e.id)).revision, status: 'withdrawn', reason: 'Rút lớp' }, 'status');
  await assert.rejects(chatMessages(student(e.studentId), c.id, 1, e.id), rejects('CLASS_ACCESS_DENIED'));
});
test('completion outbox contains no scores and delivery retries do not duplicate notifications', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e); await submitted(e);
  await record(e, alpha, 'advisor', 8); assert.equal(Number((await db.execute("SELECT count(*) n FROM academic_outbox WHERE json_extract(data,'$.type')='course_evaluation_complete'")).rows[0].n), 0);
  await record(e, beta, 'reviewer', 8.5); await deliverAcademicOutbox(); await deliverAcademicOutbox();
  const rows = (await db.execute("SELECT * FROM notifications WHERE type='course_evaluation_complete'")).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].recipient_email, e.email); assert.ok(!String(rows[0].body).includes('8.2'));
  await record(e, alpha, 'advisor', 9); await deliverAcademicOutbox(); assert.equal(Number((await db.execute("SELECT count(*) n FROM notifications WHERE type='course_evaluation_complete'")).rows[0].n), 1);
});
test('HTTP routes enforce JWT, ownership, private grades and safe file responses', async () => {
  const c = await activeClass(); const e = await admit(c); const app = express(); app.use(express.json()); app.use(academicRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const addr = server.address() as { port: number }; const base = `http://127.0.0.1:${addr.port}`;
  const user = (await db.execute({ sql: 'SELECT * FROM users WHERE email=?', args: [e.email] })).rows[0]; const token = jwt.sign({ email: user.email }, JWT_SECRET);
  try {
    assert.equal((await fetch(`${base}/api/me/classes`)).status, 401);
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/api/enrollments/${e.id}/project-evaluations`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/classes/${c.id}/grades/export.xlsx`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/enrollments/${e.id}/submissions/not-ours/view`, { headers })).status, 404);
    const result = await fetch(`${base}/api/classes/${c.id}`, { headers }); assert.equal(result.status, 200); assert.equal((await result.json()).enrollments[0].finalScore, undefined);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('lecturer exports contain only their assigned grading records', async () => {
  const c = await activeClass(); const own = await admit(c); await admit(c, '24020002', 2);
  await httpTest(async (base, auth) => {
    const result = await fetch(`${base}/api/classes/${c.id}/grades/export.xlsx`, { headers: auth(alpha.email) }); assert.equal(result.status, 200);
    const wb = XLSX.read(Buffer.from(await result.arrayBuffer()), { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
    assert.equal(rows.length, 1); assert.equal(rows[0]['MSSV'], own.studentId); assert.equal(rows[0]['Tổng kết'], undefined);
  });
});

async function httpTest(run: (base: string, auth: (email: string) => { Authorization: string }) => Promise<void>) {
  const app = express(); app.use(express.json()); app.use(academicRouter); app.use(lecturerRouter); app.use(commonRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, email => ({ Authorization: `Bearer ${jwt.sign({ email }, JWT_SECRET)}` })); }
  finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
test('HTTP multipart submission returns exact PDF bytes and checks ownership before conditional 304', async () => {
  const c = await activeClass(); const e = await admit(c); const other = await admit(c, '24020002', 2);
  await httpTest(async (base, auth) => {
    const bytes = Buffer.from('%PDF-1.4\nExact report contents\n%%EOF');
    const f = new FormData(); f.set('expectedRevision', String((await fresh(e.id)).revision)); f.set('slidesUrl', 'https://docs.google.com/presentation/d/slides/edit'); f.set('demoUrl', 'https://drive.google.com/file/d/demo/view'); f.set('pdf', new Blob([bytes], { type: 'application/pdf' }), 'bao-cao.pdf');
    const upload = await fetch(`${base}/api/enrollments/${e.id}/submission`, { method: 'POST', headers: auth(e.email), body: f }); assert.equal(upload.status, 200, await upload.text());
    const url = `${base}/api/enrollments/${e.id}/submissions/${currentVersion(await fresh(e.id)).id}/view`;
    const result = await fetch(url, { headers: auth(e.email) }); assert.equal(result.status, 200); assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes); assert.equal(result.headers.get('content-type'), 'application/pdf');
    const etag = result.headers.get('etag')!; assert.ok(etag);
    assert.equal((await fetch(url, { headers: { ...auth(e.email), 'If-None-Match': etag } })).status, 304);
    assert.equal((await fetch(url, { headers: { ...auth(other.email), 'If-None-Match': etag } })).status, 403);
  });
});
test('HTTP import preview cannot commit errors and repeated commit is idempotent', async () => {
  const sem = await createSemester(admin, 2026, '1');
  await httpTest(async (base, auth) => {
    const preview = async (id: number) => { const f = new FormData(); f.set('file', new Blob([workbook([[1, id, 'SV import', '', 'CS1', 'INT3132 1']])]), 'students.xlsx'); const r = await fetch(`${base}/api/admin/semesters/${sem.id}/enrollments/import/preview`, { method: 'POST', headers: auth(admin.email), body: f }); assert.equal(r.status, 200); return r.json(); };
    const bad = await preview(134); assert.equal((await fetch(`${base}/api/admin/enrollment-imports/${bad.id}/commit`, { method: 'POST', headers: auth(admin.email) })).status, 422);
    const good = await preview(24020001); const url = `${base}/api/admin/enrollment-imports/${good.id}/commit`;
    assert.equal((await fetch(url, { method: 'POST', headers: auth(admin.email) })).status, 200);
    assert.equal((await fetch(url, { method: 'POST', headers: auth(admin.email) })).status, 200);
    assert.equal((await snapshot()).enrollments.length, 1);
  });
});
test('chat file retraction removes stored bytes while retaining daily upload accounting', async () => {
  const c = await activeClass(); const e = await admit(c);
  const m = await sendChat(student(e.studentId), c.id, 1, e.id, '', { bytes: Buffer.from('%PDF-1.4\n%%EOF'), name: 'note.pdf', mime: 'application/pdf' });
  assert.equal((await chatMessages(alpha, c.id, 1, e.id))[0].attachment_name, 'note.pdf');
  await assert.rejects(retractChat(alpha, c.id, m.id), rejects('SENDER_ONLY'));
  await retractChat(student(e.studentId), c.id, m.id);
  const row = (await db.execute({ sql: 'SELECT * FROM academic_messages WHERE id=?', args: [m.id] })).rows[0];
  assert.equal(row.attachment_key, null); assert.equal(row.attachment_size, 0); assert.ok(Number(row.upload_size) > 0); assert.ok(row.retracted_at);
});
test('class questions are private until answered and answers reject stale revisions', async () => {
  const c = await activeClass(); const e = await admit(c); const other = await admit(c, '24020002', 2); const b = await activeClass('INT3131');
  const q = await askQuestion(student(e.studentId), c.id, 'Hạn báo cáo?');
  assert.equal((await classQuestions(student(other.studentId), c.id)).length, 0);
  await assert.rejects(classQuestions(student(e.studentId), b.id), rejects('CLASS_ACCESS_DENIED'));
  await answerQuestion(admin, c.id, q.id, { answer: 'Theo kế hoạch của lớp.', expectedRevision: 0 });
  assert.equal((await classQuestions(student(other.studentId), c.id))[0].answer, 'Theo kế hoạch của lớp.');
  await assert.rejects(answerQuestion(admin, c.id, q.id, { answer: 'Ghi đè cũ', expectedRevision: 0 }), rejects('STALE_QUESTION'));
});
test('class announcements deduplicate recipients and revoked access removes web/email visibility', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 1);
  const result = await announce(admin, c.id, { subject: 'Lịch nộp', body: 'Lịch riêng của lớp', deliveryMode: 'website_only', includeLecturers: true }); assert.equal(result.created, 3);
  await deliverAcademicOutbox(); const rows = (await db.execute("SELECT * FROM notifications WHERE type='course_announcement'")).rows;
  assert.equal(rows.length, 3); assert.ok(rows.every(r => r.status === 'website_only')); assert.equal((await visibleAcademicNotifications(rows, e.email)).length, 1);
  await enrollmentAction(admin, e.id, { expectedRevision: (await fresh(e.id)).revision, status: 'withdrawn', reason: 'Rút lớp' }, 'status');
  assert.equal((await visibleAcademicNotifications(rows, e.email)).length, 0); assert.equal((await allowedAcademicQueue(rows)).size, 2);
});
test('expired grading window still applies after Khoa unlocks scores', async () => {
  const c = await activeClass(); const e = await admit(c); await admit(c, '24020002', 2); await withReviewer(c, e); await submitted(e); await record(e, alpha, 'advisor', 8); await record(e, beta, 'reviewer', 8);
  await enrollmentAction(admin, e.id, { expectedRevision: (await fresh(e.id)).revision, locked: true, reason: 'Khóa' }, 'gradeLock');
  const p = (await snapshot()).campaigns!.find(p => p.id === c.campaignId)!; await updateCampaign(admin, p.id, { expectedRevision: p.revision, settings: { gradingCloseAt: '2000-01-01T00:00:00Z' } });
  await enrollmentAction(admin, e.id, { expectedRevision: (await fresh(e.id)).revision, locked: false, reason: 'Mở' }, 'gradeLock');
  await assert.rejects(record(e, alpha, 'advisor', 9), rejects('OUTSIDE_WINDOW'));
});
test('legacy co-advisors and matching display names cannot act as the primary lecturer', async () => {
  await db.execute("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(20,'22020001@vnu.edu.vn','Cũ','student','22020001','INT4002'),(21,'impostor@vnu.edu.vn','TS. Alpha','lecturer',NULL,NULL)");
  await db.execute("INSERT INTO advisor_assignments VALUES(1,20,1,'primary','2026-05-01'),(2,20,2,'co','2026-05-01')");
  assert.equal(await getActorLecturer({ ...alpha, id: 21, email: 'impostor@vnu.edu.vn' }), null);
  await httpTest(async (base, auth) => { for (const email of [beta.email, 'impostor@vnu.edu.vn']) { const r = await fetch(`${base}/api/lecturer/grades/20`, { method: 'PUT', headers: { ...auth(email), 'Content-Type': 'application/json' }, body: JSON.stringify({ progress_score: 8, report_score: 8, company_score: 8 }) }); assert.equal(r.status, 403); } });
  const p = await legacyPreview(admin); await applyLegacy(admin, p.id); await db.execute("UPDATE users SET course_code='INT3508' WHERE id=20");
  const again = await legacyPreview(admin); assert.equal(again.summary.created, 0); assert.equal(again.summary.blocked.length, 1);
});
test('migration CLI dry-run preserves its SQLite copy and apply creates a recoverable backup', async () => {
  await db.execute("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(20,'22020001@vnu.edu.vn','Cũ','student','22020001','INT4002')");
  const path = join(directory, 'copy.db'); await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`); const before = await readFile(path);
  const cli = join(originalCwd, 'node_modules/.bin/tsx'); const script = join(originalCwd, 'scripts/migrate-academic.ts'); const run = promisify(execFile);
  const dry = await run(cli, [script, `--database=file:${path}`], { cwd: directory }); assert.equal(JSON.parse(dry.stdout).created, 1); assert.deepEqual(await readFile(path), before);
  const applied = JSON.parse((await run(cli, [script, `--database=file:${path}`, '--apply'], { cwd: directory })).stdout); assert.equal(applied.created, 1);
  // VACUUM INTO is a consistent SQLite backup; it may change schema-cookie bytes.
  const backup = createClient({ url: `file:${applied.backup}` });
  try { assert.equal((await backup.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok'); assert.equal((await backup.execute("SELECT course_code FROM users WHERE id=20")).rows[0].course_code, 'INT4002'); assert.equal(Number((await backup.execute('SELECT count(*) n FROM academic_enrollments')).rows[0].n), 0); } finally { backup.close(); }
  const again = JSON.parse((await run(cli, [script, `--database=file:${path}`, '--apply'], { cwd: directory })).stdout); assert.equal(again.created, 0);
});

test('profile edits preserve verified student identity and cannot move a mapped legacy course', async () => {
  await db.execute("INSERT INTO users(id,email,name,role,student_id,course_code) VALUES(20,'22020001@vnu.edu.vn','Cũ','student','22020001','INT4002')");
  const p = await legacyPreview(admin); await applyLegacy(admin, p.id);
  await httpTest(async (base, auth) => {
    const update = (body: object) => fetch(`${base}/api/users/profile`, { method: 'PUT', headers: { ...auth('22020001@vnu.edu.vn'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await update({ name: 'Hồ sơ', student_id: '22020002', course_code: 'INT4002' })).status, 400);
    assert.equal((await update({ name: 'Hồ sơ', course_code: 'INT3508' })).status, 409);
    const valid = await update({ name: 'Hồ sơ', student_id: '', course_code: 'INT4002' }); assert.equal(valid.status, 200); assert.equal((await valid.json()).student_id, '22020001');
  });
  assert.equal((await snapshot()).enrollments.length, 1);
});
