import { COURSE_CATALOG, EMPTY_CLASS_SETTINGS, GROUP_NAMES, campaignKey, type CourseCampaign, type CourseGroup, type CampaignSummary } from '../../src/shared/academic';
import type { AuthenticatedUser } from '../types';
import { commit, fail, readPreview, savePreview, snapshot, type Snapshot } from './store';
import { canJoin, classSummaries, enrollmentView } from './service';
import { course, currentVersion, mayRead, requireAdmin, requireRevision, text, validateSettings } from './domain';

export const newCampaign = (semesterId: string, group: CourseGroup): CourseCampaign => ({ id: campaignKey(semesterId, group), semesterId, group, status: 'draft', settings: { ...EMPTY_CLASS_SETTINGS }, revision: 0, legacy: false });
export const getCampaign = (s: Snapshot, id: string) => s.campaigns?.find(p => p.id === id) || fail(404, 'CAMPAIGN_NOT_FOUND', 'Không tìm thấy nhóm môn trong học kỳ.');
export const campaignClasses = (s: Snapshot, id: string) => s.classes.filter(c => c.campaignId === id);
export function requireCampaign(s: Snapshot, id: string, actor: AuthenticatedUser, writing = false) {
  const p = getCampaign(s, id); const classes = campaignClasses(s, id);
  if (actor.role !== 'admin' && (p.pendingMigration || !classes.some(c => mayRead(s, c, actor) || canJoin(c, actor)))) fail(403, 'CAMPAIGN_ACCESS_DENIED', 'Bạn không có quyền vào nhóm môn này.');
  if (writing && (p.pendingMigration || p.status !== 'active')) fail(409, 'CAMPAIGN_READ_ONLY', 'Nhóm môn chưa hoạt động, đang chờ chuyển đổi hoặc đã lưu trữ.');
  return p;
}
export function campaignSummaries(s: Snapshot, actor: AuthenticatedUser): CampaignSummary[] {
  return (s.campaigns || []).filter(p => actor.role === 'admin' || campaignClasses(s, p.id).some(c => mayRead(s, c, actor) || canJoin(c, actor))).map(p => {
    const classes = campaignClasses(s, p.id); const visible = s.enrollments.filter(e => classes.some(c => c.id === e.classId && mayRead(s, c, actor, e)) && e.status === 'active');
    const semesterName = s.semesters.find(x => x.id === p.semesterId)?.name || p.semesterId;
    return { ...p, semesterName, name: `${GROUP_NAMES[p.group]} · ${semesterName}`, classCount: classes.filter(c => actor.role === 'admin' || mayRead(s, c, actor) || canJoin(c, actor)).length, enrollmentCount: visible.length, studentCount: new Set(visible.map(e => e.studentId)).size };
  });
}
export async function campaignDetail(actor: AuthenticatedUser, id: string) {
  const s = await snapshot(); const p = requireCampaign(s, id, actor);
  const classes = classSummaries(s, actor).filter(c => c.campaignId === id);
  const visible = s.enrollments.filter(e => classes.some(c => c.id === e.classId && mayRead(s, c, actor, e)));
  const views = visible.filter(e => e.status === 'active').map(e => enrollmentView(s, classes.find(c => c.id === e.classId)!, e, actor));
  return { campaign: campaignSummaries(s, actor).find(p => p.id === id)!, classes, lecturers: actor.role === 'admin' || p.group === 'internship' ? s.lecturers : s.lecturers.filter(l => visible.some(e => e.assignments.some(a => a.lecturerId === l.id))), quotas: actor.role === 'admin' ? s.quotas.filter(q => q.semesterId === p.semesterId) : [],
    stats: { studentCount: new Set(views.filter(e => e.status === 'active').map(e => e.studentId)).size, enrollmentCount: views.filter(e => e.status === 'active').length, submitted: views.filter(e => currentVersion(e as any).state === 'submitted' && !e.topicPermissions?.requiresResubmission).length, graded: views.filter(e => e.gradeStatus === 'complete' || e.gradeStatus === 'locked').length,
      advisorMissing: actor.role === 'student' ? undefined : views.filter(e => e.canSeeGrades && !e.evaluations?.[e.versions.at(-1)!.id]?.advisor).length, reviewerMissing: actor.role === 'student' ? undefined : views.filter(e => e.canSeeGrades && !e.evaluations?.[e.versions.at(-1)!.id]?.reviewer).length } };
}
export async function campaignEnrollments(actor: AuthenticatedUser, id: string, query: Record<string, any> = {}, all = false) {
  const s = await snapshot(); requireCampaign(s, id, actor); const classes = campaignClasses(s, id);
  if (query.topicStatus && (!['unregistered', 'pending', 'approved'].includes(query.topicStatus) || getCampaign(s, id).group !== 'project')) fail(422, 'INVALID_TOPIC_FILTER', 'Trạng thái đề tài chỉ áp dụng cho Dự án.');
  if (query.classId && !classes.some(c => c.id === query.classId) || query.courseCode && !classes.some(c => c.courseCode === query.courseCode)) fail(422, 'INVALID_CAMPAIGN_FILTER', 'Lớp/học phần không thuộc nhóm môn và học kỳ đã chọn.');
  const page = Math.max(1, Number(query.page) || 1), limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const items = s.enrollments.filter(e => {
    const c = classes.find(c => c.id === e.classId); return c && mayRead(s, c, actor, e) && (!query.classId || c.id === query.classId) && (!query.courseCode || c.courseCode === query.courseCode) && (!query.lecturerId || e.assignments.some(a => a.lecturerId === Number(query.lecturerId))) && (!query.q || `${e.studentId} ${e.name} ${e.topic}`.toLocaleLowerCase('vi').includes(String(query.q).toLocaleLowerCase('vi')));
  }).map(e => ({ ...enrollmentView(s, classes.find(c => c.id === e.classId)!, e, actor), classCode: classes.find(c => c.id === e.classId)!.code, courseCode: classes.find(c => c.id === e.classId)!.courseCode })).filter(e => {
    const pair = e.evaluations?.[e.versions.at(-1)!.id] || {};
    return (!query.topicStatus || e.topicReview?.status === query.topicStatus) && (!query.status || query.status === 'all' || query.status === e.gradeStatus || query.status === e.status || query.status === 'notSubmitted' && (e.versions.at(-1)!.state !== 'submitted' || e.topicPermissions?.requiresResubmission) || query.status === 'advisorMissing' && e.canSeeGrades && !pair.advisor || query.status === 'reviewerMissing' && e.canSeeGrades && !pair.reviewer);
  }).sort((a, b) => a.studentId.localeCompare(b.studentId) || a.classCode.localeCompare(b.classCode));
  return { items: all ? items : items.slice((page - 1) * limit, page * limit), total: items.length, studentCount: new Set(items.map(e => e.studentId)).size, page, limit, totalPages: Math.max(1, Math.ceil(items.length / limit)) };
}
export function legacySettingRows(settings: CourseCampaign['settings']) {
  const rows: { key: string; value: string }[] = [];
  for (const [field, old] of Object.entries({ registration: 'registration', confirmation: 'confirmation', advisorRequest: 'advisor_request', submission: 'final_report', grading: 'grading' })) for (const [suffix, key] of [['OpenAt', 'open_at'], ['CloseAt', 'close_at']]) {
    const value = settings[`${field}${suffix}`]; rows.push({ key: `${old}_${key}`, value: value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T').slice(0, 16) : '' });
  }
  for (const [field, key] of Object.entries({ plan: 'implementation_plan_md', registrationRules: 'registration_rules_md', lecturerGuide: 'lecturer_guide_md', studentFaq: 'faq_student_md', lecturerFaq: 'faq_lecturer_md', allowedCohorts: 'allowed_registration_cohorts' })) rows.push({ key, value: String(settings[field] || '') });
  rows.push({ key: 'notify_on_grade_submission', value: settings.notifyOnCompletion ? '1' : '0' }); return rows;
}
export async function updateCampaign(actor: AuthenticatedUser, id: string, input: any) {
  requireAdmin(actor); const s = await snapshot(); const old = getCampaign(s, id); const p = structuredClone(old);
  if (p.pendingMigration) fail(409, 'CAMPAIGN_MIGRATION_REQUIRED', 'Cần xem trước và áp dụng chuyển đổi nhóm môn.');
  requireRevision(p.revision, input.expectedRevision);
  if (input.status && !['draft', 'active', 'archived'].includes(input.status)) fail(422, 'INVALID_STATUS', 'Trạng thái nhóm môn không hợp lệ.');
  if (p.status === 'archived' && input.status !== 'active') fail(409, 'CAMPAIGN_READ_ONLY', 'Cần mở lại nhóm môn trước khi thay đổi.');
  if ((p.status === 'archived' || input.status === 'archived') && !text(input.reason)) fail(422, 'REASON_REQUIRED', 'Cần lý do lưu trữ/mở lại nhóm môn.');
  if (input.status === 'draft' && p.status !== 'draft' && s.enrollments.some(e => campaignClasses(s, id).some(c => c.id === e.classId))) fail(409, 'CAMPAIGN_HAS_DATA', 'Nhóm đã có dữ liệu; dùng lưu trữ thay cho chuyển về nháp.');
  if (input.settings) p.settings = validateSettings(input.settings, p.settings);
  if (input.status) p.status = input.status;
  const classes = campaignClasses(s, id).map(c => ({ ...structuredClone(c), settings: { ...p.settings }, status: p.status }));
  await commit(s, actor.id, 'admin.campaign.update', { campaigns: [p], classes, ...(p.legacy && input.settings ? { legacySettings: legacySettingRows(p.settings) } : {}) }, text(input.reason)); return p;
}
export async function campaignMigrationPreview(actor: AuthenticatedUser, resolutions: Record<string, { sourceClassId?: string; status?: string; settings?: unknown }> = {}) {
  requireAdmin(actor); const s = await snapshot(); const rows: any[] = []; const campaigns: CourseCampaign[] = []; const classes = [];
  for (const p of (s.campaigns || []).filter(p => p.pendingMigration)) {
    const sources = (s.storedClasses || []).filter(c => campaignKey(c.semesterId, course(c).group) === p.id);
    const decision = resolutions[p.id] || {};
    const settingsSet = new Set(sources.map(c => JSON.stringify(Object.fromEntries(Object.entries({ ...EMPTY_CLASS_SETTINGS, ...c.settings }).sort()))));
    const states = new Set(sources.map(c => c.status)); const chosen = sources.find(c => c.id === decision.sourceClassId);
    const issues = [];
    if (settingsSet.size > 1 && !chosen && !decision.settings) issues.push('Các lớp có cấu hình khác nhau; cần chọn nguồn hoặc nhập cấu hình chung.');
    if (states.size > 1 && !decision.status) issues.push('Các lớp có trạng thái khác nhau; cần chọn trạng thái chung.');
    if (decision.status && !['draft', 'active', 'archived'].includes(decision.status)) issues.push('Trạng thái không hợp lệ.');
    const resolved: CourseCampaign = { ...p, pendingMigration: undefined, settings: decision.settings ? validateSettings(decision.settings) : { ...(p.legacy ? p.settings : (chosen || sources[0]).settings) }, status: (decision.status || sources[0].status) as CourseCampaign['status'] };
    rows.push({ id: p.id, name: GROUP_NAMES[p.group], semesterId: p.semesterId, sources, issues, proposed: issues.length ? null : resolved });
    if (!issues.length) { campaigns.push(resolved); classes.push(...sources.map(c => ({ ...c, campaignId: p.id, settings: { ...resolved.settings }, status: resolved.status }))); }
  }
  const added = s.semesters.flatMap(semester => (['internship', 'project'] as const).map(group => newCampaign(semester.id, group))).filter(p => !s.campaigns?.some(x => x.id === p.id));
  campaigns.push(...added);
  const payload = { rows, campaigns, classes, created: added.length }; return { ...await savePreview(actor.id, 'campaign-migration', s, payload), rows, created: added.length };
}
export async function applyCampaignMigration(actor: AuthenticatedUser, id: string, system = false) {
  requireAdmin(actor); const p = await readPreview(actor.id, id, 'campaign-migration'); if (p.result) return p.result;
  if (p.payload.rows.some(r => r.issues.length)) fail(422, 'CAMPAIGN_CONFLICTS', 'Cần giải quyết các xung đột trước khi chuyển đổi.');
  const s = await snapshot(); if (s.revision !== p.revision) fail(409, 'STALE_PREVIEW', 'Dữ liệu đã thay đổi; xem trước lại.');
  const result = { migrated: p.payload.rows.length, created: p.payload.created || 0 };
  await commit(s, actor.id, system ? 'system.campaign.migrate' : 'admin.campaign.migrate', { campaigns: p.payload.campaigns, classes: p.payload.classes, previewId: id, previewResult: result }, 'Chuyển cấu hình/trạng thái lên nhóm môn; giữ nguyên lần học, file, điểm và hội thoại.'); return result;
}
