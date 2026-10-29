import { db } from '../db';
import type { CourseEnrollment } from '../../src/shared/academic';
import { COURSE_CATALOG } from '../../src/shared/academic';
import { currentVersion, newClass, newEnrollment, newSemester, now, requireAdmin, text } from './domain';
import { commit, fail, readPreview, savePreview, snapshot, type ChangeSet, type Snapshot } from './store';
import type { AuthenticatedUser } from '../types';
import { campaignKey, EMPTY_CLASS_SETTINGS } from '../../src/shared/academic';

export function hasUnmappedLegacyInternship(s: Snapshot, actor: AuthenticatedUser) {
  return actor.role === 'student' && actor.legacy_internship_access === 1
    && !s.enrollments.some(e => e.legacy && e.email.toLowerCase() === actor.email.toLowerCase());
}

export async function planLegacyMapping(s: Snapshot) {
  const semester = newSemester(2025, 'summer');
  const classes = COURSE_CATALOG.filter(x => x.group === 'internship').map(x => {
    const old = s.classes.find(c => c.legacy && c.semesterId === semester.id && c.courseCode === x.code);
    return old || { ...newClass(semester.id, x.code, 'legacy-2026'), legacy: true, status: 'active' as const };
  });
  const columns = (await db.execute('PRAGMA table_info(users)')).rows as { name: string }[];
  const admitted = columns.some(c => c.name === 'legacy_internship_access') ? ' AND COALESCE(legacy_internship_access,1)=1' : '';
  const users = (await db.execute(`SELECT id,email,name,student_id,dob,class_name,course_code FROM users WHERE role='student'${admitted}`)).rows as any[];
  const assignments = (await db.execute('SELECT * FROM advisor_assignments')).rows as any[];
  const blocked: { userId: number; studentId: string; reason: string }[] = [];
  const enrollments: CourseEnrollment[] = [];
  for (const u of users) {
    const codes = [...new Set(String(u.course_code || '').match(/INT(?:4002|3508|4003)/g) || [])];
    if (!/^\d{8}$/.test(u.student_id || '') || codes.length !== 1 || String(u.email).toLowerCase() !== `${u.student_id}@vnu.edu.vn`) {
      blocked.push({ userId: Number(u.id), studentId: u.student_id || '', reason: codes.length !== 1 ? 'Mã học phần trống hoặc mơ hồ.' : 'Cần đối soát MSSV/email.' }); continue;
    }
    const c = classes.find(c => c.courseCode === codes[0])!;
    const mapped = s.enrollments.find(e => e.legacy && e.studentId === u.student_id);
    if (mapped && mapped.classId !== c.id) {
      blocked.push({ userId: Number(u.id), studentId: u.student_id, reason: 'Hồ sơ đã ánh xạ sang học phần khác. Cần đối soát trước khi thay đổi ánh xạ; không tạo thêm lần học từ cùng hồ sơ cũ.' }); continue;
    }
    if (s.enrollments.some(e => e.classId === c.id && e.studentId === u.student_id)) continue;
    const e = newEnrollment(c, { studentId: u.student_id, name: u.name, dob: u.dob, className: u.class_name });
    e.legacy = true;
    e.assignments = assignments.filter(a => Number(a.user_id) === Number(u.id)).map(a => ({ id: `legacy-${a.id}`, lecturerId: Number(a.lecturer_id), role: a.role, assignedAt: a.assigned_at || now() }));
    enrollments.push(e);
  }
  const campaignId = campaignKey(semester.id, 'internship');
  if (s.classes.some(c => c.campaignId === campaignId && !c.legacy)) fail(409, 'LEGACY_CAMPAIGN_CONFLICT', 'Hè 2025–2026 đã có lớp TT mới; cần đối soát trước khi ánh xạ đợt cũ.');
  const parent = s.campaigns?.find(p => p.id === campaignId);
  const changes: ChangeSet = { semesters: s.semesters.some(x => x.id === semester.id) ? [] : [semester], campaigns: parent?.legacy ? [] : [{ id: campaignId, semesterId: semester.id, group: 'internship', status: 'active', settings: { ...EMPTY_CLASS_SETTINGS }, revision: parent?.revision || 0, legacy: true }], classes: classes.filter(c => !s.classes.some(x => x.id === c.id)), enrollments };
  return { changes, summary: { created: enrollments.length, classes: classes.length, blocked, sourceStudents: users.length, existing: users.length - blocked.length - enrollments.length } };
}
export async function legacyPreview(actor: AuthenticatedUser) {
  requireAdmin(actor); const s = await snapshot(); const plan = await planLegacyMapping(s);
  return { ...await savePreview(actor.id, 'legacy', s, plan), summary: plan.summary };
}
export async function applyLegacy(actor: AuthenticatedUser, id: string) {
  requireAdmin(actor); const p = await readPreview(actor.id, id, 'legacy'); if (p.result) return p.result;
  const s = await snapshot(); if (s.revision !== p.revision) fail(409, 'STALE_PREVIEW', 'Cần xem trước lại.');
  // Additive mapping only: blocked rows and every original internship table/file stay intact.
  await commit(s, actor.id, 'admin.legacy.map', { ...p.payload.changes, previewId: id, previewResult: p.payload.summary }, 'Ánh xạ đợt Thực tập cũ vào Hè 2025–2026, giữ nguyên nguồn dữ liệu.');
  return p.payload.summary;
}
export async function hydrateLegacy(s: Snapshot) {
  const legacy = s.campaigns?.filter(p => p.legacy) || [];
  const studentIds = JSON.stringify(s.enrollments.filter(e => e.legacy).map(e => e.studentId));
  const ids = `SELECT id FROM users WHERE student_id IN (SELECT value FROM json_each(?))`;
  const [settingsResult, rowsResult, assignmentsResult, tablesResult] = await Promise.all([
    legacy.length ? db.execute('SELECT key,value FROM settings') : Promise.resolve({rows:[]}),
    studentIds !== '[]' ? db.execute({sql:`SELECT u.id,u.student_id,u.name,u.dob,u.class_name,
      fr.id report_id,fr.object_key,fr.original_filename,fr.file_size,fr.submitted_at,fr.lecturer_comment,
      g.progress_score,g.report_score,g.company_score,g.lecturer_id grade_lecturer_id,g.comment grade_comment,g.locked_at,g.updated_at grade_updated_at
      FROM users u LEFT JOIN final_reports fr ON fr.user_id=u.id LEFT JOIN grades g ON g.user_id=u.id WHERE u.role='student' AND u.student_id IN (SELECT value FROM json_each(?))`,args:[studentIds]}) : Promise.resolve({rows:[]}),
    studentIds !== '[]' ? db.execute({sql:`SELECT * FROM advisor_assignments WHERE user_id IN (${ids})`,args:[studentIds]}) : Promise.resolve({rows:[]}),
    studentIds !== '[]' ? db.execute("SELECT name FROM sqlite_master WHERE type='table'") : Promise.resolve({rows:[]}),
  ]);
  if (legacy.length) {
    const settings = Object.fromEntries(settingsResult.rows.map(r => [String(r.key), String(r.value || '')]));
    for (const p of legacy) {
      const keys = { topic: 'topic', registration: 'registration', confirmation: 'confirmation', advisorRequest: 'advisor_request', submission: 'final_report', grading: 'grading' };
      for (const [field, old] of Object.entries(keys)) for (const [suffix, key] of [['OpenAt', 'open_at'], ['CloseAt', 'close_at']]) {
        const value = settings[`${old}_${key}`] || '';
        const time = value ? new Date(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}+07:00`) : null;
        p.settings[`${field}${suffix}`] = time && Number.isFinite(time.getTime()) ? time.toISOString() : value;
      }
      for (const [field, key] of Object.entries({ plan: 'implementation_plan_md', registrationRules: 'registration_rules_md', lecturerGuide: 'lecturer_guide_md', studentFaq: 'faq_student_md', lecturerFaq: 'faq_lecturer_md', allowedCohorts: 'allowed_registration_cohorts' })) if (settings[key] !== undefined) p.settings[field] = settings[key];
      p.settings.notifyOnCompletion = settings.notify_on_grade_submission !== '0';
      for (const c of s.classes.filter(c => c.campaignId === p.id)) c.settings = { ...p.settings };
    }
  }
  if (!s.enrollments.some(e => e.legacy)) return;
  const rows = rowsResult.rows as any[], assignments = assignmentsResult.rows as any[];
  const sourceTables = new Set(tablesResult.rows.map(r => String(r.name)));
  const [preferencesResult, finalsResult] = await Promise.all([
    sourceTables.has('registrations') ? db.execute({sql:`SELECT r.*,c.name company_name FROM registrations r LEFT JOIN companies c ON c.id=r.company_id WHERE r.user_id IN (${ids}) ORDER BY r.preference_order,r.id`,args:[studentIds]}) : Promise.resolve({rows:[]}),
    sourceTables.has('final_internships') ? db.execute({sql:`SELECT f.*,c.name company_name FROM final_internships f LEFT JOIN companies c ON c.id=f.company_id WHERE f.user_id IN (${ids})`,args:[studentIds]}) : Promise.resolve({rows:[]}),
  ]);
  const preferences = preferencesResult.rows as any[], finals = finalsResult.rows as any[];
  for (const e of s.enrollments.filter(e => e.legacy)) {
    const row = rows.find(r => r.student_id === e.studentId); if (!row) continue;
    e.name = row.name; e.dob = row.dob || ''; e.className = row.class_name || '';
    e.assignments = assignments.filter(a => Number(a.user_id) === Number(row.id)).map(a => ({ id: `legacy-${a.id}`, lecturerId: Number(a.lecturer_id), role: a.role, assignedAt: a.assigned_at || now() }));
    e.preferences = preferences.filter(p => Number(p.user_id) === Number(row.id)).map(p => ({ id: `legacy-${p.id}`, companyId: Number(p.company_id), companyName: p.company_name === 'Công ty khác' ? p.other_company_name || p.company_name : p.company_name || 'Trường Đại học Công nghệ', note: p.note || '', status: p.status, reviewComment: p.review_comment || '' }));
    const final = finals.find(f => Number(f.user_id) === Number(row.id));
    if (final) e.finalInternship = { preferenceId: `legacy-${final.registration_id}`, companyName: final.company_name === 'Công ty khác' ? preferences.find(p => p.id === final.registration_id)?.other_company_name || final.company_name : final.company_name || 'Trường Đại học Công nghệ', type: final.internship_type === 'school' ? 'school' : 'company', confirmedAt: final.confirmed_at || '', locked: !!final.locked_at };
    const v = currentVersion(e);
    if (row.object_key) Object.assign(v, { id: `legacy-report-${row.report_id}`, objectKey: row.object_key, filename: row.original_filename, size: Number(row.file_size), state: 'submitted', submittedAt: row.submitted_at });
    e.reviewComment = text(row.lecturer_comment); e.lockedAt = row.locked_at || null;
    if (row.progress_score != null && row.report_score != null && row.company_score != null) e.internshipGrade = { progress: Number(row.progress_score), report: Number(row.report_score), company: Number(row.company_score), comment: row.grade_comment || '', lecturerId: Number(row.grade_lecturer_id), assignmentId: e.assignments.find(a => a.role === 'primary')?.id || '', submittedAt: row.grade_updated_at || '', updatedAt: row.grade_updated_at || '' };
  }
}
