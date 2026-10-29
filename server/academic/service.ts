import { randomUUID } from 'node:crypto';
import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import type { AcademicClass, CourseEnrollment, EnrollmentView, AssignmentRole, ClassStatus, Term } from '../../src/shared/academic';
import { COURSE_CATALOG, campaignKey } from '../../src/shared/academic';
import {
  allocateReviewers, course, currentVersion, emptyVersion, getClass, getEnrollment,
  hasGrade, inWindow, lecturerFor, mayRead, newClass, newEnrollment, newSemester,
  normalized, now, requireAdmin, requireRead, requireRevision, requireWindow,
  requireWritable, reviewerPool, score, text, totalScore, validateAssignments, validateSettings,
} from './domain';
import { commit, fail, readPreview, savePreview, snapshot, type AcademicEvent, type Snapshot } from './store';
import { newCampaign } from './campaigns';

export function canJoin(c: AcademicClass, actor: AuthenticatedUser) {
  const year = Number(actor.email.match(/^(\d{2})\d{6}@vnu\.edu\.vn$/)?.[1]);
  const cohort = `K${year + 45}`;
  return actor.role === 'student' && !c.legacy && course(c).group === 'internship' && c.status === 'active'
    && (actor.legacy_internship_access === 1 || c.settings.allowedCohorts.split(/[,;\s]+/).includes(cohort))
    && inWindow(c.settings.registrationOpenAt, c.settings.registrationCloseAt);
}
export function classSummaries(s: Snapshot, actor: AuthenticatedUser) {
  return s.classes.filter(c => mayRead(s, c, actor) || canJoin(c, actor)).map(c => ({
    ...c, semesterName: s.semesters.find(x => x.id === c.semesterId)?.name || c.semesterId,
    courseName: course(c).name, group: course(c).group,
    enrollmentCount: actor.role === 'admin' ? s.enrollments.filter(e => e.classId === c.id && e.status === 'active').length : undefined,
    canJoin: canJoin(c, actor) && !s.enrollments.some(e => e.classId === c.id && e.email === actor.email), canManage: actor.role === 'admin',
  }));
}
export function enrollmentView(s: Snapshot, c: AcademicClass, e: CourseEnrollment, actor: AuthenticatedUser): EnrollmentView {
  const lecturer = lecturerFor(s, actor);
  const myAssignment = e.assignments.filter(a => a.lecturerId === lecturer?.id).map(a => a.role);
  const canSeeGrades = actor.role === 'admin' || myAssignment.some(r => r === 'primary' || r === 'reviewer');
  const copy = structuredClone(e);
  const finalScore = totalScore(c, e);
  const gradeStatus = e.lockedAt ? 'locked' : finalScore != null ? 'complete' : hasGrade(e) ? 'partial' : 'missing';
  if (!canSeeGrades) { delete copy.evaluations; delete copy.internshipGrade; }
  return { ...copy, myAssignment, canSeeGrades, ...(canSeeGrades ? { finalScore } : {}), gradeStatus };
}
export async function classDetail(classId: string, actor: AuthenticatedUser) {
  const s = await snapshot(); const c = getClass(s, classId);
  if (!mayRead(s, c, actor) && !canJoin(c, actor)) fail(403, 'CLASS_ACCESS_DENIED', 'Bạn không được truy cập lớp này.');
  const summary = classSummaries(s, actor).find(x => x.id === c.id)!;
  const enrollments = s.enrollments.filter(e => e.classId === c.id && mayRead(s, c, actor, e)).map(e => enrollmentView(s, c, e, actor));
  return { class: summary, enrollments, lecturers: actor.role === 'admin' || course(c).group === 'internship' ? s.lecturers : s.lecturers.filter(l => enrollments.some(e => e.assignments.some(a => a.lecturerId === l.id))), semesters: s.semesters, courses: COURSE_CATALOG,
    reviewerCandidates: actor.role === 'admin' ? reviewerPool(s, c.semesterId) : [], quotas: actor.role === 'admin' ? s.quotas.filter(q => q.semesterId === c.semesterId) : [] };
}
export async function createSemester(actor: AuthenticatedUser, year: number, term: Term) {
  requireAdmin(actor); const s = await snapshot(); const item = newSemester(year, term);
  const campaigns = ['internship', 'project'].map(group => newCampaign(item.id, group as any)).filter(p => !s.campaigns?.some(x => x.id === p.id));
  if (!s.semesters.some(x => x.id === item.id) || campaigns.length) await commit(s, actor.id, 'admin.semester.create', { semesters: [item], campaigns });
  return item;
}
export async function createClass(actor: AuthenticatedUser, input: { semesterId: string; courseCode: string; section: string }) {
  requireAdmin(actor); const s = await snapshot();
  if (!s.semesters.some(x => x.id === input.semesterId)) fail(422, 'INVALID_SEMESTER', 'Chưa tạo học kỳ.');
  const c = newClass(input.semesterId, text(input.courseCode).toUpperCase(), text(input.section));
  if (s.classes.some(x => x.semesterId === c.semesterId && x.code === c.code)) fail(409, 'DUPLICATE_CLASS', 'Lớp đã tồn tại trong học kỳ này.');
  const parent = s.campaigns?.find(p => p.id === c.campaignId);
  if (parent?.pendingMigration) fail(409, 'CAMPAIGN_MIGRATION_REQUIRED', 'Cần chuyển cấu hình nhóm môn trước.');
  if (parent?.legacy) fail(409, 'LEGACY_CONTEXT', 'Đợt TT cũ giữ các lớp đã ánh xạ; mở lớp mới trong học kỳ khác.');
  if (parent?.status === 'archived') fail(409, 'CAMPAIGN_READ_ONLY', 'Nhóm môn đã lưu trữ.');
  await commit(s, actor.id, 'admin.class.create', { classes: [c] }); return c;
}
export async function updateClass(actor: AuthenticatedUser, classId: string, input: { expectedRevision: number; status?: ClassStatus; settings?: unknown; reason?: string }) {
  requireAdmin(actor); const c = getClass(await snapshot(), classId);
  return fail(409, 'CAMPAIGN_CONTEXT_REQUIRED', 'Cấu hình và trạng thái được quản lý chung trong nhóm môn/học kỳ.', { campaignId: c.campaignId });
}

export async function joinInternship(actor: AuthenticatedUser, classId: string) {
  const s = await snapshot(); const c = getClass(s, classId);
  if (!canJoin(c, actor)) fail(403, 'JOIN_DENIED', 'Bạn không đủ điều kiện tham gia lớp Thực tập này.');
  const existing = s.enrollments.find(e => e.classId === c.id && e.email === actor.email);
  if (existing?.status === 'withdrawn') fail(403, 'ENROLLMENT_WITHDRAWN', 'Cần Khoa tiếp nhận lại sinh viên đã rút.');
  if (existing) return enrollmentView(s, c, existing, actor);
  const e = newEnrollment(c, { studentId: actor.email.split('@')[0], name: actor.name, dob: actor.dob, className: actor.class_name });
  await commit(s, actor.id, 'student.internship.join', { enrollments: [e] }); return enrollmentView(s, c, e, actor);
}
export async function enrollmentAction(actor: AuthenticatedUser, enrollmentId: string, input: any, action: 'status' | 'topic' | 'assignments' | 'review' | 'reopen' | 'gradeLock') {
  const s = await snapshot(); const e = getEnrollment(s, enrollmentId); const c = getClass(s, e.classId);
  requireRead(s, c, actor, e); requireRevision(e.revision, input.expectedRevision);
  if (c.legacy) fail(409, 'LEGACY_CONTEXT', 'Dùng màn Thực tập hiện có để xử lý đợt cũ.');
  if (c.status !== 'active' && !(actor.role === 'admin' && c.status === 'draft' && ['status', 'assignments'].includes(action))) fail(409, 'CLASS_READ_ONLY', 'Lớp hiện chỉ đọc.');
  if (action === 'status') {
    requireAdmin(actor);
    if (!['active', 'withdrawn'].includes(input.status) || !text(input.reason)) fail(422, 'INVALID_STATUS', 'Cần trạng thái và lý do tiếp nhận/rút sinh viên.');
    e.status = input.status;
  } else {
    if (e.status !== 'active') fail(403, 'ENROLLMENT_WITHDRAWN', 'Sinh viên đã rút khỏi lớp.');
    if (action === 'topic') {
      if (course(c).group !== 'project') fail(422, 'WRONG_COURSE', 'Đề tài thuộc học phần Dự án.');
      if (actor.role !== 'admin' && (actor.role !== 'student' || actor.email !== e.email)) fail(403, 'OWNER_ONLY', 'Chỉ sinh viên sở hữu được khai đề tài.');
      requireWindow(c, 'topic', e);
      if (hasGrade(e) || e.lockedAt) fail(409, 'SUBMISSION_LOCKED', 'Đã bắt đầu chấm; cần Khoa mở lại bài.');
      const title = text(input.title);
      if (!title || title.length > 1500) fail(422, 'INVALID_TOPIC', 'Tên đề tài cần từ 1 đến 1.500 ký tự.');
      e.topic = title;
      if (actor.role === 'admin' && !text(input.reason)) fail(422, 'REASON_REQUIRED', 'Khoa cần ghi lý do chỉnh đề tài.');
    }
    if (action === 'assignments') {
      requireAdmin(actor);
      const assignments = validateAssignments(s, c, e, input.assignments);
      if ((hasGrade(e) || e.lockedAt) && JSON.stringify(assignments) !== JSON.stringify(e.assignments)) fail(409, 'EVALUATED_ASSIGNMENT', 'Cần mở lại bài trước khi thay người chấm.');
      e.assignments = assignments;
    }
    if (action === 'review') {
      const l = lecturerFor(s, actor);
      if (actor.role !== 'admin' && !e.assignments.some(a => a.lecturerId === l?.id && a.role !== 'co')) fail(403, 'REVIEW_DENIED', 'Chỉ GVHD chính hoặc GVNX được yêu cầu sửa.');
      if (e.lockedAt) fail(409, 'GRADE_LOCKED', 'Bảng điểm đã khóa.');
      e.needsRevision = !!input.needsRevision; e.reviewComment = text(input.comment);
      if (e.needsRevision && !e.reviewComment) fail(422, 'COMMENT_REQUIRED', 'Cần ghi nội dung yêu cầu sửa.');
    }
    if (action === 'reopen') {
      requireAdmin(actor);
      if (e.lockedAt) fail(409, 'GRADE_LOCKED', 'Cần mở khóa điểm trước khi mở lại bài.');
      if (!text(input.reason) || !/(Z|[+-]\d\d:\d\d)$/.test(input.submissionUntil || '') || !(Date.parse(input.submissionUntil) > Date.now())) fail(422, 'INVALID_REOPEN', 'Cần lý do và hạn nộp lại trong tương lai, có múi giờ.');
      const v = { ...currentVersion(e), id: randomUUID(), number: currentVersion(e).number + 1, state: 'editing' as const, createdAt: now(), submittedAt: null };
      e.versions.push(v); e.submissionLockedAt = null; e.reopenUntil = input.submissionUntil;
      e.internshipGrade = null; e.needsRevision = true; e.reviewComment = text(input.reason);
    }
    if (action === 'gradeLock') {
      requireAdmin(actor);
      if (typeof input.locked !== 'boolean' || !text(input.reason)) fail(422, 'INVALID_LOCK', 'Cần trạng thái khóa và lý do.');
      if (input.locked && totalScore(c, e) == null) fail(409, 'INCOMPLETE_GRADES', 'Chưa đủ các phần điểm hiện hành.');
      e.lockedAt = input.locked ? now() : null;
    }
  }
  const events: AcademicEvent[] = [];
  if (action === 'review') events.push(event(e, 'submission_review', 'Phản hồi bài nộp', e.needsRevision ? e.reviewComment : 'Đã hủy yêu cầu sửa bài.', `${e.id}:review:${e.revision + 1}`));
  if (action === 'assignments') events.push(event(e, 'course_assignment', 'Cập nhật phân công giảng viên', `Khoa đã cập nhật phân công cho lớp ${c.code}.`, `${e.id}:assignment:${e.revision + 1}`));
  await commit(s, actor.id, `${actor.role === 'admin' ? 'admin' : actor.role === 'student' ? 'student' : 'lecturer'}.enrollment.${action}`, { enrollments: [e], events }, text(input.reason));
  return enrollmentView(s, c, e, actor);
}
export function event(e: CourseEnrollment, type: string, subject: string, body: string, id: string = randomUUID()): AcademicEvent {
  return { id, email: e.email, userId: null, classId: e.classId, enrollmentId: e.id, type, subject, body };
}
export async function grade(actor: AuthenticatedUser, enrollmentId: string, role: string, input: any) {
  const s = await snapshot(); const e = getEnrollment(s, enrollmentId); const c = getClass(s, e.classId);
  requireRead(s, c, actor, e); requireWritable(c, e); requireRevision(e.revision, input.expectedRevision); requireWindow(c, 'grading');
  if (e.lockedAt) fail(409, 'GRADE_LOCKED', 'Điểm đã khóa.');
  const l = lecturerFor(s, actor);
  const expectedRole = role === 'advisor' || role === 'internship' ? 'primary' : role === 'reviewer' ? 'reviewer' : null;
  const assignment = e.assignments.find(a => a.role === expectedRole && a.lecturerId === l?.id);
  if (!assignment) fail(403, 'GRADING_DENIED', 'Bạn không có phân công chấm phần điểm này.');
  const v = currentVersion(e);
  if (v.id !== input.submissionVersionId) fail(409, 'VERSION_CONFLICT', 'Phiên bản bài nộp đã thay đổi.');
  const beforeComplete = totalScore(c, e) != null;
  if (course(c).group === 'project') {
    if (!['advisor', 'reviewer'].includes(role)) fail(422, 'WRONG_COURSE', 'Dự án dùng hai phần GVHD/GVNX.');
    const value = score(input.score); const comment = text(input.comment);
    if ((!value || v.state !== 'submitted') && !comment) fail(422, 'COMMENT_REQUIRED', 'Cần ghi lý do cho điểm 0 hoặc chưa có bài nộp.');
    if (v.state !== 'submitted' && value !== 0) fail(422, 'SUBMISSION_REQUIRED', 'Chưa có bộ bài đầy đủ; chỉ chấp nhận 0 điểm kèm lý do.');
    const pair = e.evaluations[v.id] ||= {};
    pair[role] = { score: value, comment, lecturerId: l.id, assignmentId: assignment.id, submittedAt: pair[role]?.submittedAt || now(), updatedAt: now() };
    e.submissionLockedAt ||= now();
  } else {
    if (role !== 'internship') fail(422, 'WRONG_COURSE', 'Thực tập dùng ba đầu điểm.');
    const progress = score(input.progress), report = score(input.report), company = score(input.company);
    if (!v.objectKey && (progress || report || company)) fail(422, 'SUBMISSION_REQUIRED', 'Chưa có PDF; chỉ chấp nhận cả ba điểm 0 kèm lý do.');
    if ((!progress && !report && !company || !v.objectKey) && !text(input.comment)) fail(422, 'COMMENT_REQUIRED', 'Cần ghi lý do điểm 0.');
    e.internshipGrade = { progress, report, company, comment: text(input.comment), lecturerId: l.id, assignmentId: assignment.id, submittedAt: e.internshipGrade?.submittedAt || now(), updatedAt: now() };
  }
  const events = !beforeComplete && totalScore(c, e) != null && c.settings.notifyOnCompletion ? [event(e, 'course_evaluation_complete', `Hoàn tất đánh giá ${c.code}`, 'Giảng viên đã hoàn tất nộp đánh giá về Khoa. Điểm chính thức được công bố trên Cổng Đào tạo.', `${e.id}:${v.id}:completed`)] : [];
  await commit(s, actor.id, 'lecturer.grade.submit', { enrollments: [e], events }); return enrollmentView(s, c, e, actor);
}
export async function reviewerPreview(actor: AuthenticatedUser, semesterId: string, input: any) {
  requireAdmin(actor); const s = await snapshot();
  if (!s.semesters.some(x => x.id === semesterId)) fail(404, 'SEMESTER_NOT_FOUND', 'Không tìm thấy học kỳ.');
  if (input.classIds && (!Array.isArray(input.classIds) || input.classIds.some(id => !s.classes.some(c => c.id === id && c.semesterId === semesterId)))) fail(422, 'INVALID_CLASSES', 'Lớp không thuộc học kỳ.');
  const rows = allocateReviewers(s, semesterId, input.classIds);
  if (input.overrides && !Array.isArray(input.overrides)) fail(422, 'INVALID_PREVIEW', 'Điều chỉnh phân công không hợp lệ.');
  for (const override of input.overrides || []) {
    const row = rows.find(r => r.enrollmentId === override.enrollmentId);
    if (row) { row.lecturerId = override.lecturerId == null ? null : Number(override.lecturerId); row.reason = 'manual_preview'; }
  }
  // Validate the entire edited plan cumulatively, including loads from earlier rows.
  const candidate = structuredClone(s); const changed: CourseEnrollment[] = [];
  for (const row of rows.filter(r => r.lecturerId != null)) {
    const e = getEnrollment(candidate, row.enrollmentId); const c = getClass(candidate, e.classId);
    e.assignments = validateAssignments(candidate, c, e, [...e.assignments, { lecturerId: row.lecturerId!, role: 'reviewer' }]);
    candidate.enrollments[candidate.enrollments.findIndex(x => x.id === e.id)] = e; changed.push(e);
  }
  const preview = await savePreview(actor.id, 'reviewers', s, { semesterId, rows, enrollments: changed });
  return { ...preview, rows: rows.map(row => { const e = s.enrollments.find(e => e.id === row.enrollmentId)!; return { ...row, studentId: e.studentId, studentName: e.name, classCode: getClass(s, e.classId).code }; }), candidates: reviewerPool(s, semesterId), revision: s.revision };
}
export async function applyReviewers(actor: AuthenticatedUser, id: string) {
  requireAdmin(actor); const p = await readPreview(actor.id, id, 'reviewers'); if (p.result) return p.result;
  const s = await snapshot(); if (s.revision !== p.revision) fail(409, 'STALE_PREVIEW', 'Phân công đã thay đổi, cần xem trước lại.');
  const result = { assigned: p.payload.enrollments.length, unassigned: p.payload.rows.filter(r => r.lecturerId == null).length };
  const events: AcademicEvent[] = [];
  for (const e of p.payload.enrollments as CourseEnrollment[]) {
    const a = e.assignments.find(a => a.role === 'reviewer')!; const l = s.lecturers.find(l => l.id === a.lecturerId)!;
    const cls = getClass(s, e.classId);
    events.push({ ...event(e, 'reviewer_assigned', `Phân công nhận xét ${cls.code}`, `Thầy/Cô được phân công nhận xét cho sinh viên ${e.name} (${e.studentId}), lớp ${cls.code}, ${s.semesters.find(x => x.id === cls.semesterId)?.name}.`), email: l.email });
  }
  await commit(s, actor.id, 'admin.reviewers.apply', { enrollments: p.payload.enrollments, previewId: id, previewResult: result, events }); return result;
}
export async function updateQuotas(actor: AuthenticatedUser, semesterId: string, rows: any[]) {
  requireAdmin(actor); const s = await snapshot();
  if (!s.semesters.some(x => x.id === semesterId) || !Array.isArray(rows)) fail(422, 'INVALID_QUOTAS', 'Học kỳ hoặc chỉ tiêu không hợp lệ.');
  for (const [field, group] of [['maxReviews', 'project'], ['internshipMax', 'internship']] as const) {
    const p = s.campaigns?.find(p => p.id === campaignKey(semesterId, group));
    if (rows.some(row => row && field in row) && (p?.pendingMigration || p?.status === 'archived')) fail(409, 'CAMPAIGN_READ_ONLY', 'Cần chuyển đổi hoặc mở lại nhóm môn trước khi sửa chỉ tiêu.');
  }
  const quotas = rows.map(row => {
    if (!s.lecturers.some(l => l.id === row.lecturerId)) fail(422, 'INVALID_LECTURER', 'Giảng viên không tồn tại.');
    for (const key of ['maxReviews', 'internshipMax']) if (row[key] != null && (!Number.isInteger(row[key]) || row[key] < 0)) fail(422, 'INVALID_QUOTA', 'Chỉ tiêu là số nguyên không âm hoặc để trống.');
    const previous = s.quotas.find(q => q.semesterId === semesterId && q.lecturerId === row.lecturerId);
    return { id: `${semesterId}:${row.lecturerId}`, semesterId, lecturerId: row.lecturerId, maxReviews: 'maxReviews' in row ? row.maxReviews ?? null : previous?.maxReviews ?? null, internshipMax: 'internshipMax' in row ? row.internshipMax ?? null : previous?.internshipMax ?? null };
  });
  await commit(s, actor.id, 'admin.quotas.update', { quotas }); return quotas;
}
export async function bulkLock(actor: AuthenticatedUser, classId: string, input: any) {
  requireAdmin(actor); const s = await snapshot(); const c = getClass(s, classId); requireWritable(c);
  if (typeof input.locked !== 'boolean' || !text(input.reason)) fail(422, 'INVALID_LOCK', 'Cần trạng thái khóa và lý do.');
  const changed: CourseEnrollment[] = []; const skipped: { enrollmentId: string; reason: string }[] = [];
  for (const row of s.enrollments.filter(e => e.classId === c.id && e.status === 'active')) {
    const e = structuredClone(row);
    if (input.locked && totalScore(c, e) == null) { skipped.push({ enrollmentId: e.id, reason: 'incomplete_grades' }); continue; }
    e.lockedAt = input.locked ? now() : null; changed.push(e);
  }
  await commit(s, actor.id, 'admin.grades.bulk_lock', { enrollments: changed }, text(input.reason)); return { changed: changed.length, skipped };
}
