import { randomUUID } from 'node:crypto';
import {
  COURSE_CATALOG, EMPTY_CLASS_SETTINGS, TERM_NAMES, campaignKey,
  type AcademicClass, type AcademicSemester, type ClassSettings, type CourseEnrollment,
  type CourseEvaluation, type LecturerInfo, type SubmissionVersion, type Term,
} from '../../src/shared/academic';
import { fail, type Snapshot } from './store';
import type { AuthenticatedUser } from '../types';
import { emptyTopicReview } from './topicMigration';

export const now = () => new Date().toISOString();
export const text = (value: unknown) => String(value ?? '').normalize('NFC').trim();
export const normalized = (value: unknown) => text(value).replace(/\s+/g, ' ').toLowerCase();
export const course = (c: AcademicClass) => COURSE_CATALOG.find(x => x.code === c.courseCode)!;
export const isBachelor = (l: LecturerInfo) => /(^|[\s.])CN[.\s]|\bCử nhân\b|^CN$/iu.test(l.name);
export function lecturerFor(s: Snapshot, actor: AuthenticatedUser) {
  if (actor.role !== 'lecturer' && actor.role !== 'admin' && !actor.is_lecturer) return undefined;
  return s.lecturers.find(l => normalized(l.email) === normalized(actor.email));
}
export function getClass(s: Snapshot, id: string) {
  return s.classes.find(c => c.id === id) || fail(404, 'CLASS_NOT_FOUND', 'Không tìm thấy lớp học phần.');
}
export function getEnrollment(s: Snapshot, id: string) {
  return structuredClone(s.enrollments.find(e => e.id === id) || fail(404, 'ENROLLMENT_NOT_FOUND', 'Không tìm thấy lần học.'));
}
export function requireAdmin(actor: AuthenticatedUser) {
  if (actor.role !== 'admin') fail(403, 'ADMIN_ONLY', 'Chỉ Khoa được thực hiện thao tác này.');
}
export function mayRead(s: Snapshot, c: AcademicClass, actor: AuthenticatedUser, e?: CourseEnrollment) {
  if (actor.role === 'admin') return true;
  if (c.status === 'draft') return false;
  const l = lecturerFor(s, actor);
  const matches = e ? [e] : s.enrollments.filter(x => x.classId === c.id);
  return matches.some(x => x.status !== 'withdrawn' && (actor.role === 'student' && normalized(x.email) === normalized(actor.email) || l && x.assignments.some(a => a.lecturerId === l.id)));
}
export function requireRead(s: Snapshot, c: AcademicClass, actor: AuthenticatedUser, e?: CourseEnrollment) {
  if (!mayRead(s, c, actor, e)) fail(403, 'CLASS_ACCESS_DENIED', 'Bạn không có quyền truy cập dữ liệu lớp này.');
}
export function requireWritable(c: AcademicClass, e?: CourseEnrollment) {
  if (c.legacy) fail(409, 'LEGACY_CONTEXT', 'Dữ liệu đợt cũ được xử lý tại các màn Thực tập hiện có.');
  if (c.status !== 'active') fail(409, 'CLASS_READ_ONLY', 'Lớp chưa hoạt động hoặc đã lưu trữ.');
  if (e?.status === 'withdrawn') fail(403, 'ENROLLMENT_WITHDRAWN', 'Sinh viên đã được rút khỏi lớp.');
}
export function requireRevision(actual: number, expected: unknown) {
  if (!Number.isInteger(expected) || actual !== expected) fail(409, 'REVISION_CONFLICT', 'Dữ liệu đã thay đổi. Vui lòng tải lại trước khi lưu.');
}
export function inWindow(open: string, close: string, at = Date.now()) {
  return (!open || at >= Date.parse(open)) && (!close || at <= Date.parse(close));
}
export function hasTopicSubmissionExtension(c: AcademicClass, e?: CourseEnrollment) {
  const until = Date.parse(e?.topicSubmissionUntil || ''), gradingClose = Date.parse(c.settings.gradingCloseAt);
  return Number.isFinite(until) && Number.isFinite(gradingClose) && Date.now() <= Math.min(until, gradingClose);
}
export function requireWindow(c: AcademicClass, kind: 'topic' | 'submission' | 'grading' | 'registration' | 'confirmation' | 'advisorRequest', e?: CourseEnrollment) {
  if ((kind === 'submission' || kind === 'topic') && e?.reopenUntil && Date.now() <= Date.parse(e.reopenUntil)) return;
  if (kind === 'submission' && hasTopicSubmissionExtension(c, e)) return;
  const cfg = c.settings;
  if (!inWindow(cfg[`${kind}OpenAt`], cfg[`${kind}CloseAt`])) fail(403, 'OUTSIDE_WINDOW', 'Thao tác nằm ngoài thời gian Khoa cho phép.');
}
export function validateSettings(input: unknown, existing = EMPTY_CLASS_SETTINGS): ClassSettings {
  if (!input || typeof input !== 'object') fail(422, 'INVALID_SETTINGS', 'Cấu hình không hợp lệ.');
  const settings = { ...existing };
  for (const key of Object.keys(EMPTY_CLASS_SETTINGS) as (keyof ClassSettings)[]) {
    if (!(key in (input as object))) continue;
    if (key === 'notifyOnCompletion' || key === 'publishGradesToStudents') {
      if (typeof input[key] !== 'boolean') fail(422, 'INVALID_SETTINGS', `Giá trị ${key} phải là boolean.`);
      settings[key] = input[key];
    } else {
      const value = text(input[key]);
      if (value.length > 100_000) fail(422, 'INVALID_SETTINGS', 'Nội dung cấu hình quá dài.');
      if (key.endsWith('At') && value && (!/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) fail(422, 'INVALID_TIME', 'Thời gian phải có múi giờ (ví dụ +07:00).');
      settings[key] = value;
    }
  }
  for (const kind of ['topic', 'submission', 'grading', 'registration', 'confirmation', 'advisorRequest'] as const) {
    if (settings[`${kind}OpenAt`] && settings[`${kind}CloseAt`] && Date.parse(settings[`${kind}OpenAt`]) > Date.parse(settings[`${kind}CloseAt`])) fail(422, 'INVALID_WINDOW', 'Thời điểm mở phải trước thời điểm đóng.');
  }
  return settings;
}
export function newSemester(year: number, term: Term): AcademicSemester {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !['1', '2', 'summer'].includes(term)) fail(422, 'INVALID_SEMESTER', 'Năm học hoặc học kỳ không hợp lệ.');
  return { id: `${year}-${year + 1}-${term}`, year, term, name: `${TERM_NAMES[term]} ${year}–${year + 1}` };
}
export function newClass(semesterId: string, code: string, section: string): AcademicClass {
  if (!COURSE_CATALOG.some(x => x.code === code) || !/^[\p{L}\p{N}_-]{1,30}$/u.test(section)) fail(422, 'INVALID_CLASS', 'Mã học phần hoặc số lớp không hợp lệ.');
  return { id: randomUUID(), campaignId: campaignKey(semesterId, COURSE_CATALOG.find(x => x.code === code)!.group), semesterId, courseCode: code, section, code: `${code} ${section}`, status: 'draft', legacy: false, settings: { ...EMPTY_CLASS_SETTINGS }, revision: 0 };
}
export function emptyVersion(title = ''): SubmissionVersion {
  return { id: randomUUID(), number: 1, title, objectKey: null, filename: null, size: 0, slidesUrl: '', demoUrl: '', state: 'empty', createdAt: now(), submittedAt: null };
}
export function newEnrollment(c: AcademicClass, data: { studentId: string; name: string; dob?: string; className?: string; note?: string }): CourseEnrollment {
  if (!/^\d{8}$/.test(data.studentId) || !text(data.name)) fail(422, 'INVALID_STUDENT', 'MSSV phải gồm 8 chữ số và có họ tên.');
  return {
    id: randomUUID(), classId: c.id, studentId: data.studentId, email: `${data.studentId}@vnu.edu.vn`,
    name: text(data.name), dob: data.dob || '', className: data.className || '', note: data.note || '',
    ...(course(c).group === 'internship' ? {status: 'active' as const} : {}), legacy: false, topic: '', assignments: [], versions: [emptyVersion()], evaluations: {},
    ...(course(c).group === 'project' ? { topicReview: emptyTopicReview(), topicSubmissionUntil: null } : {}),
    internshipGrade: null, lockedAt: null, submissionLockedAt: null, reopenUntil: null,
    reviewComment: '', needsRevision: false, preferences: [], finalInternship: null, advisorRequest: null, revision: 0,
  };
}
export const currentVersion = (e: CourseEnrollment) => e.versions[e.versions.length - 1];
export const hasGrade = (e: CourseEnrollment) => !!e.internshipGrade || Object.values(e.evaluations[currentVersion(e).id] || {}).some(Boolean);
export function score(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) fail(422, 'INVALID_SCORE', 'Điểm phải là số từ 0 đến 10.');
  return value as number;
}
export function weightedScore(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return null;
  return Math.round((a * 6 + b * 4 + Number.EPSILON * 100) ) / 10;
}
export function totalScore(c: AcademicClass, e: CourseEnrollment) {
  if (course(c).group === 'internship') {
    const g = e.internshipGrade;
    return g ? Math.round((g.progress * 2 + g.report * 2 + g.company * 6 + Number.EPSILON * 100)) / 10 : null;
  }
  const pair = e.evaluations[currentVersion(e).id] || {};
  const active = (role: 'advisor' | 'reviewer', g?: CourseEvaluation) => g && e.assignments.some(a => a.id === g.assignmentId && a.lecturerId === g.lecturerId && a.role === (role === 'advisor' ? 'primary' : 'reviewer')) ? g.score : null;
  return weightedScore(active('advisor', pair.advisor), active('reviewer', pair.reviewer));
}
export function driveUrl(value: unknown) {
  const raw = text(value);
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && ['drive.google.com', 'docs.google.com'].includes(url.hostname)) return url.toString();
  } catch { /* validation below */ }
  return fail(422, 'INVALID_DRIVE_URL', 'Cần liên kết HTTPS Google Drive/Google Slides hợp lệ.');
}
export function validateAssignments(s: Snapshot, c: AcademicClass, e: CourseEnrollment, input: { lecturerId: number; role: string }[]) {
  if (!Array.isArray(input) || input.length > 20) fail(422, 'INVALID_ASSIGNMENTS', 'Phân công không hợp lệ.');
  const seen = new Set<string>();
  for (const a of input) {
    const l = s.lecturers.find(l => l.id === a.lecturerId);
    if (!l || !l.email || !['primary', 'co', 'reviewer'].includes(a.role) || seen.has(`${a.role}:${a.lecturerId}`)) fail(422, 'INVALID_ASSIGNMENTS', 'Giảng viên hoặc vai trò không hợp lệ/trùng lặp.');
    if (a.role !== 'co' && isBachelor(l)) fail(422, 'BACHELOR_RESTRICTION', 'Giảng viên CN chỉ được đồng hướng dẫn.');
    if (a.role === 'co' && input.some(x => x.role === 'primary' && x.lecturerId === a.lecturerId)) fail(422, 'ADVISOR_CONFLICT', 'GVHD chính không đồng thời là đồng hướng dẫn trong cùng lần học.');
    if (a.role === 'reviewer') {
      if (course(c).group !== 'project') fail(422, 'INVALID_ROLE', 'Thực tập không có vai trò GVNX.');
      if (input.some(x => x.lecturerId === a.lecturerId && x.role !== 'reviewer')) fail(422, 'REVIEWER_CONFLICT', 'GVNX không được trùng GVHD hoặc đồng hướng dẫn.');
      if (!reviewerPool(s, c.semesterId).some(x => x.id === a.lecturerId)) fail(422, 'REVIEWER_NOT_ELIGIBLE', 'GVNX phải đang hướng dẫn Dự án trong học kỳ.');
      const q = s.quotas.find(q => q.semesterId === c.semesterId && q.lecturerId === a.lecturerId)?.maxReviews;
      const load = reviewerLoad(s, c.semesterId, a.lecturerId, e.id);
      if (q != null && load >= q && !e.assignments.some(x => x.role === 'reviewer' && x.lecturerId === a.lecturerId)) fail(422, 'REVIEWER_QUOTA', 'Giảng viên đã hết chỉ tiêu nhận xét.');
    }
    seen.add(`${a.role}:${a.lecturerId}`);
  }
  for (const role of ['primary', 'reviewer']) if (input.filter(x => x.role === role).length > 1) fail(422, 'DUPLICATE_ROLE', 'Mỗi lần học chỉ có một GVHD chính và một GVNX.');
  if (input.some(a => a.role === 'reviewer') && !input.some(a => a.role === 'primary')) fail(422, 'PRIMARY_REQUIRED', 'Cần có GVHD chính trước khi phân công GVNX.');
  return input.map(a => e.assignments.find(x => x.role === a.role && x.lecturerId === a.lecturerId) || { id: randomUUID(), lecturerId: a.lecturerId, role: a.role as 'primary' | 'co' | 'reviewer', assignedAt: now() });
}
export function reviewerPool(s: Snapshot, semesterId: string) {
  const classIds = new Set(s.classes.filter(c => c.semesterId === semesterId && c.status === 'active' && course(c).group === 'project').map(c => c.id));
  const ids = new Set(s.enrollments.filter(e => classIds.has(e.classId) && e.status !== 'withdrawn').flatMap(e => e.assignments.filter(a => a.role !== 'reviewer').map(a => a.lecturerId)));
  return s.lecturers.filter(l => ids.has(l.id) && l.email && !isBachelor(l));
}
export function reviewerLoad(s: Snapshot, semesterId: string, lecturerId: number, exceptId = '') {
  const classIds = new Set(s.classes.filter(c => c.semesterId === semesterId && course(c).group === 'project').map(c => c.id));
  return s.enrollments.filter(e => e.id !== exceptId && classIds.has(e.classId) && e.status !== 'withdrawn' && e.assignments.some(a => a.role === 'reviewer' && a.lecturerId === lecturerId)).length;
}
export function allocateReviewers(s: Snapshot, semesterId: string, classIds?: string[]) {
  const pool = reviewerPool(s, semesterId);
  const targets = s.enrollments.filter(e => e.status !== 'withdrawn' && !e.assignments.some(a => a.role === 'reviewer') && s.classes.some(c => c.id === e.classId && c.semesterId === semesterId && c.status === 'active' && course(c).group === 'project' && (!classIds?.length || classIds.includes(c.id))));
  const load = new Map(pool.map(l => [l.id, reviewerLoad(s, semesterId, l.id)]));
  const eligible = (e: CourseEnrollment) => pool.filter(l => !e.assignments.some(a => a.lecturerId === l.id) && (s.quotas.find(q => q.semesterId === semesterId && q.lecturerId === l.id)?.maxReviews ?? Infinity) > load.get(l.id)!);
  targets.sort((a, b) => eligible(a).length - eligible(b).length || a.id.localeCompare(b.id));
  return targets.map(e => {
    const primary = s.lecturers.find(l => e.assignments.some(a => a.role === 'primary' && a.lecturerId === l.id));
    if (!primary) return { enrollmentId: e.id, lecturerId: null, reason: 'missing_primary', loadBefore: 0, loadAfter: 0 };
    const all = eligible(e);
    const same = normalized(primary.work_unit) ? all.filter(l => normalized(l.work_unit) === normalized(primary.work_unit)) : [];
    const selected = (same.length ? same : all).sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.id - b.id)[0];
    if (!selected) return { enrollmentId: e.id, lecturerId: null, reason: pool.some(l => !e.assignments.some(a => a.lecturerId === l.id)) ? 'quota_exhausted' : 'no_eligible_reviewer', loadBefore: 0, loadAfter: 0 };
    const before = load.get(selected.id)!; load.set(selected.id, before + 1);
    return { enrollmentId: e.id, lecturerId: selected.id, reason: same.length ? 'same_work_unit' : normalized(primary.work_unit) ? 'cross_work_unit' : 'missing_work_unit', loadBefore: before, loadAfter: before + 1 };
  });
}
