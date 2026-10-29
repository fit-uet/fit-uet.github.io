import { randomUUID } from 'node:crypto';
import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { normalizeCompanyName } from '../services/helpers';
import { commit, fail, snapshot } from './store';
import { course, getClass, getEnrollment, isBachelor, now, requireAdmin, requireRead, requireRevision, requireWindow, requireWritable, text, validateAssignments } from './domain';
import { enrollmentView } from './service';

export async function internshipAction(actor: AuthenticatedUser, id: string, input: any, action: 'preference' | 'removePreference' | 'reviewPreference' | 'confirm' | 'advisorRequest' | 'reviewAdvisorRequest') {
  const s = await snapshot(); const e = getEnrollment(s, id); const c = getClass(s, e.classId);
  requireRead(s, c, actor, e); requireWritable(c, e); requireRevision(e.revision, input.expectedRevision);
  if (course(c).group !== 'internship') fail(422, 'WRONG_COURSE', 'Chức năng này chỉ dành cho Thực tập.');
  if (['reviewPreference', 'reviewAdvisorRequest'].includes(action)) requireAdmin(actor);
  else if (actor.role !== 'student' || actor.email !== e.email) fail(403, 'OWNER_ONLY', 'Chỉ sinh viên sở hữu được thực hiện.');
  if (action === 'preference') {
    requireWindow(c, 'registration');
    if (e.finalInternship?.locked) fail(409, 'FINAL_LOCKED', 'Nơi thực tập đã khóa.');
    if (e.preferences.length >= 5) fail(422, 'MAX_PREFERENCES', 'Mỗi lần học tối đa 5 nguyện vọng.');
    let companyName: string; let companyId: number;
    if (input.type === 'school') { companyName = 'Trường Đại học Công nghệ'; companyId = 0; }
    else if (input.companyId) {
      const company = (await db.execute({ sql: 'SELECT id,name FROM companies WHERE id=?', args: [Number(input.companyId)] })).rows[0] as any;
      if (!company) fail(422, 'COMPANY_NOT_FOUND', 'Công ty không tồn tại.');
      companyName = company.name; companyId = Number(company.id);
    } else { companyName = text(input.companyName); companyId = 0; if (!companyName || companyName.length > 500) fail(422, 'COMPANY_REQUIRED', 'Cần tên công ty tự liên hệ.'); }
    if (e.preferences.some(p => normalizeCompanyName(p.companyName) === normalizeCompanyName(companyName))) fail(422, 'DUPLICATE_PREFERENCE', 'Đã đăng ký nơi thực tập này.');
    const approved = (await db.execute('SELECT name FROM approved_company_names')).rows as any[];
    const status = input.type === 'school' || approved.some(row => normalizeCompanyName(row.name) === normalizeCompanyName(companyName)) ? 'approved' as const : 'pending' as const;
    e.preferences.push({ id: randomUUID(), companyId, companyName, note: text(input.note), status, reviewComment: '' });
  }
  if (action === 'removePreference') {
    requireWindow(c, 'registration'); if (e.finalInternship?.locked) fail(409, 'FINAL_LOCKED', 'Nơi thực tập đã khóa.');
    if (!e.preferences.some(p => p.id === input.preferenceId)) fail(404, 'PREFERENCE_NOT_FOUND', 'Không tìm thấy nguyện vọng.');
    e.preferences = e.preferences.filter(p => p.id !== input.preferenceId);
    if (e.finalInternship?.preferenceId === input.preferenceId) e.finalInternship = null;
  }
  if (action === 'reviewPreference') {
    const p = e.preferences.find(p => p.id === input.preferenceId);
    if (!p || !['approved', 'rejected'].includes(input.status)) fail(422, 'INVALID_REVIEW', 'Nguyện vọng hoặc trạng thái không hợp lệ.');
    if (e.finalInternship?.preferenceId === p.id) fail(409, 'PREFERENCE_CONFIRMED', 'Nơi thực tập đã được xác nhận; cần xử lý hồ sơ chính thức riêng.');
    if (input.status === 'rejected' && !text(input.comment)) fail(422, 'REASON_REQUIRED', 'Cần lý do từ chối.');
    p.status = input.status; p.reviewComment = text(input.comment);
  }
  if (action === 'confirm') {
    requireWindow(c, 'confirmation');
    if (e.finalInternship?.locked) fail(409, 'FINAL_LOCKED', 'Nơi thực tập đã khóa.');
    const p = e.preferences.find(p => p.id === input.preferenceId);
    if (!p || p.status !== 'approved' || input.attested !== true) fail(422, 'CONFIRMATION_DENIED', 'Cần chọn nguyện vọng đã duyệt và cam kết được tiếp nhận.');
    e.finalInternship = { preferenceId: p.id, companyName: p.companyName, type: p.companyName === 'Trường Đại học Công nghệ' ? 'school' : 'company', confirmedAt: now(), locked: false };
  }
  if (action === 'advisorRequest') {
    requireWindow(c, 'advisorRequest');
    const lecturer = s.lecturers.find(l => l.id === input.lecturerId);
    if (!lecturer || isBachelor(lecturer) || input.agreed !== true) fail(422, 'ADVISOR_AGREEMENT', 'Chỉ gửi đề xuất khi đã được giảng viên đủ điều kiện đồng ý.');
    e.advisorRequest = { lecturerId: lecturer.id, coLecturerId: input.coLecturerId || null, note: text(input.note), status: 'pending' };
  }
  if (action === 'reviewAdvisorRequest') {
    if (!e.advisorRequest || !['approved', 'rejected'].includes(input.status)) fail(422, 'INVALID_REQUEST', 'Đề xuất không hợp lệ.');
    if (input.status === 'approved') {
      if (e.internshipGrade || e.lockedAt) fail(409, 'GRADE_EXISTS', 'Cần mở lại trước khi đổi người chấm.');
      e.assignments = validateAssignments(s, c, e, [{ lecturerId: e.advisorRequest.lecturerId, role: 'primary' }, ...(e.advisorRequest.coLecturerId ? [{ lecturerId: e.advisorRequest.coLecturerId, role: 'co' }] : [])]);
    }
    e.advisorRequest.status = input.status;
  }
  await commit(s, actor.id, `${actor.role === 'admin' ? 'admin' : 'student'}.internship.${action}`, { enrollments: [e] }, text(input.comment));
  return enrollmentView(s, c, e, actor);
}
export async function autoInternshipAdvisors(actor: AuthenticatedUser, classId: string, enrollmentIds?: Set<string>) {
  requireAdmin(actor); const s = await snapshot(); const c = getClass(s, classId); requireWritable(c);
  if (course(c).group !== 'internship') fail(422, 'WRONG_COURSE', 'Chỉ tự phân công GVHD cho Thực tập.');
  const classIds = new Set(s.classes.filter(x => x.semesterId === c.semesterId && course(x).group === 'internship').map(x => x.id));
  const load = new Map(s.lecturers.map(l => [l.id, s.enrollments.filter(e => classIds.has(e.classId) && e.status === 'active').flatMap(e => e.assignments.filter(a => a.role !== 'reviewer')).filter(a => a.lecturerId === l.id).length]));
  const quota = (id: number) => s.quotas.find(q => q.semesterId === c.semesterId && q.lecturerId === id)?.internshipMax ?? (/\b(?:PGS|GS)\b/i.test(s.lecturers.find(l => l.id === id)!.name) ? 5 : /\bTS\b/i.test(s.lecturers.find(l => l.id === id)!.name) ? 8 : 10);
  const changed = []; const skipped = [];
  for (const row of s.enrollments.filter(e => e.classId === c.id && (!enrollmentIds || enrollmentIds.has(e.id)) && e.status === 'active' && !e.assignments.some(a => a.role === 'primary') && e.advisorRequest?.status !== 'pending')) {
    const e = structuredClone(row);
    const l = s.lecturers.filter(l => l.email && !isBachelor(l) && !e.assignments.some(a => a.lecturerId === l.id) && load.get(l.id)! < quota(l.id)).sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.id - b.id)[0];
    if (!l) { skipped.push(e.id); continue; }
    e.assignments.push({ id: randomUUID(), lecturerId: l.id, role: 'primary', assignedAt: now() }); load.set(l.id, load.get(l.id)! + 1); changed.push(e);
  }
  await commit(s, actor.id, 'admin.internship.auto_advisors', { enrollments: changed }); return { assigned: changed.length, skipped };
}
