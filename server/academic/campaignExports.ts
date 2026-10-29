import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { campaignEnrollments, campaignClasses, getCampaign, requireCampaign } from './campaigns';
import { snapshot, commit, fail } from './store';
import { currentVersion, totalScore, text } from './domain';
import { autoInternshipAdvisors } from './internship';

export async function campaignExport(actor: AuthenticatedUser, id: string, dataset: string, query: Record<string, any>) {
  if (actor.role === 'student') fail(403, 'EXPORT_DENIED', 'Sinh viên không xuất danh sách quản lý.');
  const s = await snapshot(); const p = requireCampaign(s, id, actor);
  if (!['students', 'assignments', 'reports', 'grades', 'registrations', 'final-internships'].includes(dataset)) fail(422, 'INVALID_EXPORT', 'Loại danh sách không hợp lệ.');
  if (['registrations', 'final-internships'].includes(dataset) && p.group !== 'internship') fail(422, 'WRONG_COURSE', 'Nhóm Dự án không có đăng ký nơi thực tập.');
  const all = (await campaignEnrollments(actor, id, query, true)).items;
  if (dataset === 'grades' && !all.some(e => e.canSeeGrades) && actor.role !== 'admin') fail(403, 'GRADES_PRIVATE', 'Bạn không có quyền xuất điểm.');
  const name = (e: typeof all[number], role: string) => e.assignments.filter(a => a.role === role).map(a => s.lecturers.find(l => l.id === a.lecturerId)?.name || '').join('; ');
  const base = (e: typeof all[number]) => ({ 'Học kỳ': s.semesters.find(x => x.id === p.semesterId)!.name, 'Nhóm môn': p.group === 'project' ? 'Dự án' : 'Thực tập', 'Học phần': e.courseCode, 'Lớp học phần': e.classCode, MSSV: e.studentId, 'Họ tên': e.name });
  if (dataset === 'grades') return all.filter(e => e.canSeeGrades).map(e => { const v = currentVersion(e as any); const pair = e.evaluations?.[v.id] || {}; return { ...base(e), 'Đề tài': v.title || e.topic, GVHD: name(e, 'primary'), 'Đồng HD': name(e, 'co'), GVNX: name(e, 'reviewer'), 'Điểm GVHD': pair.advisor?.score ?? null, 'Điểm GVNX': pair.reviewer?.score ?? null, 'Tiến độ': e.internshipGrade?.progress ?? null, 'Báo cáo': e.internshipGrade?.report ?? null, 'Đơn vị': e.internshipGrade?.company ?? null, 'Tổng kết': e.finalScore ?? null, 'Trạng thái': e.gradeStatus, 'Khóa lúc': e.lockedAt }; });
  if (dataset === 'registrations') return all.flatMap(e => e.preferences.map((v, i) => ({ ...base(e), 'Nguyện vọng': i + 1, 'Nơi thực tập': v.companyName, 'Trạng thái': v.status, 'Ghi chú': v.note, 'Nhận xét': v.reviewComment })));
  if (dataset === 'final-internships') return all.filter(e => e.finalInternship).map(e => ({ ...base(e), 'Nơi thực tập': e.finalInternship!.companyName, 'Loại': e.finalInternship!.type, 'Xác nhận lúc': e.finalInternship!.confirmedAt }));
  if (dataset === 'reports') return all.map(e => { const v = currentVersion(e as any); return { ...base(e), 'Đề tài': v.title || e.topic, GVHD: name(e, 'primary'), GVNX: name(e, 'reviewer'), 'Báo cáo': v.filename, 'Phiên bản': v.number, 'Nộp lúc': v.submittedAt, Slide: v.slidesUrl, 'Video demo': v.demoUrl, 'Trạng thái': v.state, 'Cần sửa': e.needsRevision ? 'Có' : 'Không' }; });
  return all.map(e => ({ ...base(e), 'Ngày sinh': e.dob, 'Lớp khóa học': e.className, Email: e.email, GVHD: name(e, 'primary'), 'Đồng HD': name(e, 'co'), GVNX: name(e, 'reviewer'), 'Đề tài': e.topic, 'Tư cách': e.status }));
}
export async function campaignBulkLock(actor: AuthenticatedUser, id: string, input: any) {
  if (actor.role !== 'admin') fail(403, 'ADMIN_ONLY', 'Chỉ Khoa được chốt điểm.');
  const rows = await campaignEnrollments(actor, id, input.filters || {}, true); const s = await snapshot(); const p = requireCampaign(s, id, actor, true);
  if (typeof input.locked !== 'boolean' || !text(input.reason)) fail(422, 'INVALID_LOCK', 'Cần trạng thái khóa và lý do.');
  const changed = [], skipped = [], legacyGradeLocks = [];
  for (const row of rows.items.filter(e => e.status === 'active')) {
    const e = structuredClone(s.enrollments.find(e => e.id === row.id)!); const c = s.classes.find(c => c.id === e.classId)!;
    if (e.status !== 'active') continue;
    if (input.locked && totalScore(c, e) == null) { skipped.push({ enrollmentId: e.id, reason: 'incomplete_grades' }); continue; }
    if (p.legacy) {
      const u = (await db.execute({ sql: 'SELECT id FROM users WHERE student_id=?', args: [e.studentId] })).rows[0];
      if (u) legacyGradeLocks.push({ userId: Number(u.id), lockedAt: input.locked ? new Date().toISOString() : null });
    } else { e.lockedAt = input.locked ? new Date().toISOString() : null; changed.push(e); }
  }
  await commit(s, actor.id, 'admin.campaign.grade_locks', { enrollments: changed, legacyGradeLocks }, text(input.reason));
  return { changed: p.legacy ? rows.items.filter(e => e.status === 'active').length - skipped.length : changed.length, skipped };
}
export async function campaignAutoAdvisors(actor: AuthenticatedUser, id: string, input: any) {
  const s = await snapshot(); const p = requireCampaign(s, id, actor, true); if (p.group !== 'internship' || p.legacy) fail(409, 'LEGACY_CONTEXT', 'Dùng phân công GVHD của đợt Thực tập cũ.');
  const rows = await campaignEnrollments(actor, id, input.filters || {}, true); const enrollmentIds = new Set(rows.items.map(e => e.id));
  let assigned = 0; const skipped: string[] = [];
  for (const c of campaignClasses(s, id).filter(c => (!input.filters?.classId || c.id === input.filters.classId) && (!input.filters?.courseCode || c.courseCode === input.filters.courseCode))) { const result = await autoInternshipAdvisors(actor, c.id, enrollmentIds); assigned += result.assigned; skipped.push(...result.skipped); }
  return { assigned, skipped };
}
