import { readCampaignCatalog, readCampaignDetail, readCampaignEnrollments, readContext, readEnrollment, readCommunicationContext } from './reads';
import { validateJsonCache } from '../services/httpCache';
import express, { Router } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db';
import { requireAuth } from '../middlewares/auth';
import { streamReportObject, streamChatAttachmentObject } from '../services/storage';
import { AcademicError, commit, fail, readPreview, savePreview, snapshot } from './store';
import { course, currentVersion, getClass, getEnrollment, requireAdmin, requireRead, totalScore } from './domain';
import { planImport } from './imports';
import * as service from './service';
import { submitBundle } from './submissions';
import { deliverAcademicOutbox } from './outbox';
import { legacyPreview, applyLegacy, hasUnmappedLegacyInternship } from './legacy';
import { internshipAction, autoInternshipAdvisors } from './internship';
import { chatMessages, sendChat, chatThread, retractChat } from './chat';
import { COURSE_CATALOG } from '../../src/shared/academic';
import { announce, announcementPreview, applyAnnouncementPreview, answerQuestion, askQuestion, classQuestions } from './communications';
import * as campaigns from './campaigns';
import { campaignExport, campaignBulkLock, campaignAutoAdvisors } from './campaignExports';
import { findChatRow, authorizeLegacyChatRow } from './legacyChat';
import type { AssignmentRole } from '../../src/shared/academic';

export const academicRouter = Router();
type Handler = (req: any, res: any) => Promise<unknown>;
export function academicRoute(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, handler: Handler, parsers: any[] = []) {
  academicRouter[method](path, requireAuth, ...parsers, async (req: any, res: any) => {
    try {
      const started = performance.now();
      const result = await handler(req, res);
      if (result === res) return;
      if (method !== 'get') await deliverAcademicOutbox().catch(error => console.error('[academic outbox]', error.message));
      if (!res.headersSent && !res.writableEnded) res.setHeader('Server-Timing', `app;dur=${(performance.now()-started).toFixed(1)}`);
      if (!res.headersSent && !res.writableEnded && !validateJsonCache(req, res, result ?? { success: true })) res.json(result ?? { success: true });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof AcademicError) res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      else if (/UNIQUE constraint|constraint failed/i.test(String(error))) res.status(409).json({ error: { code: 'DATA_CONFLICT', message: 'Dữ liệu trùng hoặc vi phạm ràng buộc. Vui lòng xem lại bản xem trước.' } });
      else { console.error('[academic]', error); res.status(500).json({ error: { code: 'ACADEMIC_ERROR', message: 'Không xử lý được yêu cầu. Vui lòng thử lại.' } }); }
    }
  });
}
academicRoute('get', '/api/me/campaigns', req => readCampaignCatalog(req.user, req.query.section === 'base' ? 'base' : 'full'));
academicRoute('get', '/api/campaigns/:campaignId', req => readCampaignDetail(req.user, req.params.campaignId, req.query.section || 'full'));
academicRoute('get', '/api/campaigns/:campaignId/enrollments', req => readCampaignEnrollments(req.user, req.params.campaignId, req.query));
academicRoute('patch', '/api/admin/campaigns/:campaignId', req => campaigns.updateCampaign(req.user, req.params.campaignId, req.body));
academicRoute('put', '/api/admin/campaigns/:campaignId/settings', req => campaigns.updateCampaign(req.user, req.params.campaignId, req.body));
academicRoute('post', '/api/admin/campaign-migrations/preview', req => campaigns.campaignMigrationPreview(req.user, req.body?.resolutions || {}));
academicRoute('post', '/api/admin/campaign-migrations/:previewId/apply', req => campaigns.applyCampaignMigration(req.user, req.params.previewId));
academicRoute('put', '/api/admin/campaigns/:campaignId/grade-locks', req => campaignBulkLock(req.user, req.params.campaignId, req.body));
academicRoute('post', '/api/admin/campaigns/:campaignId/internship/auto-advisors', req => campaignAutoAdvisors(req.user, req.params.campaignId, req.body));
academicRoute('get', '/api/campaigns/:campaignId/exports/:dataset.xlsx', async (req, res) => {
  const rows = await campaignExport(req.user, req.params.campaignId, req.params.dataset, req.query);
  const wb = XLSX.utils.book_new(); const sheet = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['Không có dữ liệu trong phạm vi được phép.']]);
  XLSX.utils.book_append_sheet(wb, sheet, 'Danh sach');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="danh-sach.xlsx"'); res.end(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});
academicRoute('get', '/api/campaigns/:campaignId/questions', req => classQuestions(req.user, req.params.campaignId));
academicRoute('post', '/api/campaigns/:campaignId/questions', req => askQuestion(req.user, req.params.campaignId, req.body.question));
academicRoute('put', '/api/admin/campaigns/:campaignId/questions/:questionId', req => answerQuestion(req.user, req.params.campaignId, req.params.questionId, req.body));
academicRoute('post', '/api/admin/campaigns/:campaignId/announcements', req => announce(req.user, req.params.campaignId, req.body));
academicRoute('post', '/api/admin/campaigns/:campaignId/announcements/preview', req => announcementPreview(req.user, req.params.campaignId, req.body));
academicRoute('post', '/api/admin/announcement-previews/:previewId/apply', req => applyAnnouncementPreview(req.user, req.params.previewId));
academicRoute('get', '/api/campaigns/:campaignId/chat-context', async req => {
  const { s } = await readCommunicationContext(req.user,req.params.campaignId);
  return { enrollments: s.enrollments.map(e => ({ id: e.id, classId: e.classId, name: e.name, email: e.email, assignments: e.assignments })) };
});
async function form(req: any) {
  try { return await new Response(req.body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData(); }
  catch { return fail(422, 'INVALID_FORM', 'Dữ liệu tải lên không hợp lệ.'); }
}
const upload = express.raw({ type: 'multipart/form-data', limit: '32mb' });
academicRoute('get', '/api/classes/:classId/questions', req => classQuestions(req.user, req.params.classId));
academicRoute('post', '/api/classes/:classId/questions', req => askQuestion(req.user, req.params.classId, req.body.question));
academicRoute('put', '/api/admin/classes/:classId/questions/:questionId', req => answerQuestion(req.user, req.params.classId, req.params.questionId, req.body));
academicRoute('post', '/api/admin/classes/:classId/announcements', req => announce(req.user, req.params.classId, req.body));
academicRoute('get', '/api/classes/:classId/chat', req => chatMessages(req.user, req.params.classId, Number(req.query.lecturerId), req.query.enrollmentId ? String(req.query.enrollmentId) : undefined));
academicRoute('post', '/api/classes/:classId/chat', async req => {
  if (!String(req.headers['content-type'] || '').startsWith('multipart/')) return sendChat(req.user, req.params.classId, Number(req.body.lecturerId), req.body.enrollmentId, req.body.body);
  const f = await form(req); const file = f.get('file');
  return sendChat(req.user, req.params.classId, Number(f.get('lecturerId')), String(f.get('enrollmentId') || '') || undefined, f.get('body'), file && typeof file !== 'string' && file.size ? { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type } : undefined);
}, [upload]);
academicRoute('delete', '/api/classes/:classId/chat/:messageId', req => retractChat(req.user, req.params.classId, req.params.messageId));
academicRoute('get', '/api/classes/:classId/chat/:messageId/attachment', async (req, res) => {
  const row = await findChatRow(req.params.messageId, req.params.classId);
  if (!row?.attachment_key) fail(404, 'ATTACHMENT_NOT_FOUND', 'Không có file đính kèm.');
  const { s } = await readCommunicationContext(req.user,req.params.classId); const enrollmentId = await authorizeLegacyChatRow(s, getClass(s, req.params.classId), row);
  await chatThread(req.user, req.params.classId, Number(row.lecturer_id), enrollmentId, true);
  res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.attachment_name || 'attachment')}`);
  if (!await streamChatAttachmentObject(row.attachment_key, res)) fail(404, 'ATTACHMENT_NOT_FOUND', 'Không tìm thấy nội dung file.'); return res;
});
academicRoute('post', '/api/admin/academic-legacy/preview', req => legacyPreview(req.user));
academicRoute('post', '/api/admin/academic-legacy/:previewId/apply', req => applyLegacy(req.user, req.params.previewId));
for (const [suffix, action] of [['preferences', 'preference'], ['preferences/remove', 'removePreference'], ['preferences/review', 'reviewPreference'], ['final/confirm', 'confirm'], ['advisor-request', 'advisorRequest'], ['advisor-request/review', 'reviewAdvisorRequest']] as const) {
  academicRoute('post', `/api/enrollments/:enrollmentId/internship/${suffix}`, req => internshipAction(req.user, req.params.enrollmentId, req.body, action));
}
academicRoute('post', '/api/admin/classes/:classId/internship/auto-advisors', req => autoInternshipAdvisors(req.user, req.params.classId));
academicRoute('get', '/api/classes/:classId/companies', async req => {
  const { s } = await readCommunicationContext(req.user,req.params.classId); const c = getClass(s, req.params.classId); requireRead(s, c, req.user);
  if (course(c).group !== 'internship') fail(422, 'WRONG_COURSE', 'Chỉ Thực tập có danh sách doanh nghiệp.');
  return (await db.execute('SELECT id,name,description,slots,address,contact_email FROM companies ORDER BY name')).rows;
});

academicRoute('get', '/api/me/classes', async req => {
  const ctx = await readContext(req.user); return { classes: ctx.classes, semesters: ctx.s.semesters, courses: COURSE_CATALOG };
});
academicRoute('get', '/api/classes/:classId', async req => { if (req.query.section !== 'base') return service.classDetail(req.params.classId, req.user); const ctx = await readContext(req.user); const c = ctx.classes.find(c => c.id === req.params.classId); if (!c) fail(403,'CLASS_ACCESS_DENIED','Bạn không được truy cập lớp này.'); return { class: c }; });
academicRoute('get', '/api/classes/:classId/enrollments', async req => (await service.classDetail(req.params.classId, req.user)).enrollments);
academicRoute('get', '/api/classes/:classId/settings', async req => (await service.classDetail(req.params.classId, req.user)).class.settings);
academicRoute('get', '/api/admin/semesters', async req => { requireAdmin(req.user); const s = await snapshot(); return { semesters: s.semesters, classes: s.classes, lecturers: s.lecturers, quotas: s.quotas, courses: COURSE_CATALOG }; });
academicRoute('post', '/api/admin/semesters', req => service.createSemester(req.user, Number(req.body.year), req.body.term));
academicRoute('get', '/api/admin/classes', async req => { requireAdmin(req.user); return service.classSummaries(await snapshot(), req.user); });
academicRoute('post', '/api/admin/classes', req => service.createClass(req.user, req.body));
academicRoute('patch', '/api/admin/classes/:classId', req => service.updateClass(req.user, req.params.classId, req.body));
academicRoute('put', '/api/admin/classes/:classId/settings', req => service.updateClass(req.user, req.params.classId, { ...req.body, settings: req.body.settings }));
academicRoute('post', '/api/classes/:classId/enrollments/join', req => service.joinInternship(req.user, req.params.classId));
academicRoute('patch', '/api/admin/enrollments/:enrollmentId', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'status'));
academicRoute('get', '/api/enrollments/:enrollmentId', async req => {
  return (await readEnrollment(req.user, req.params.enrollmentId)).view;
});
academicRoute('get', '/api/enrollments/:enrollmentId/topic', async req => {
  const {e,view} = await readEnrollment(req.user, req.params.enrollmentId); return { title: e.topic, revision: e.revision, topicReview: e.topicReview, topicSubmissionUntil: e.topicSubmissionUntil, topicPermissions: view.topicPermissions };
});
academicRoute('put', '/api/enrollments/:enrollmentId/topic', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'topic'));
academicRoute('post', '/api/enrollments/:enrollmentId/topic/approve', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'topicApprove'));
academicRoute('get', '/api/enrollments/:enrollmentId/assignments', async req => {
  const { e } = await readEnrollment(req.user,req.params.enrollmentId); return { assignments: e.assignments, revision: e.revision };
});
academicRoute('put', '/api/admin/enrollments/:enrollmentId/assignments', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'assignments'));
academicRoute('put', '/api/enrollments/:enrollmentId/submission/review', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'review'));
academicRoute('post', '/api/admin/enrollments/:enrollmentId/submission/reopen', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'reopen'));
academicRoute('put', '/api/admin/enrollments/:enrollmentId/grade-lock', req => service.enrollmentAction(req.user, req.params.enrollmentId, req.body, 'gradeLock'));
academicRoute('put', '/api/admin/classes/:classId/grade-locks', req => service.bulkLock(req.user, req.params.classId, req.body));
academicRoute('get', '/api/enrollments/:enrollmentId/submission', async req => {
  const { e } = await readEnrollment(req.user,req.params.enrollmentId); return { versions: e.versions, needsRevision: e.needsRevision, comment: e.reviewComment, revision: e.revision, locked: !!e.submissionLockedAt };
});
academicRoute('post', '/api/enrollments/:enrollmentId/submission', async req => {
  const f = await form(req); const pdf = f.get('pdf');
  return submitBundle(req.user, req.params.enrollmentId, { expectedRevision: Number(f.get('expectedRevision')), slidesUrl: String(f.get('slidesUrl') || ''), demoUrl: String(f.get('demoUrl') || ''), reusePdfVersionId: String(f.get('reusePdfVersionId') || '') }, pdf && typeof pdf !== 'string' && pdf.size > 0 ? { bytes: Buffer.from(await pdf.arrayBuffer()), name: pdf.name, mime: pdf.type } : undefined);
}, [upload]);
for (const mode of ['view', 'download']) academicRoute('get', `/api/enrollments/:enrollmentId/submissions/:versionId/${mode}`, async (req, res) => {
  const { e } = await readEnrollment(req.user, req.params.enrollmentId);
  const v = e.versions.find(v => v.id === req.params.versionId);
  if (!v?.objectKey) fail(404, 'PDF_NOT_FOUND', 'Phiên bản này chưa có PDF.');
  const etag = `"${v.id}-${v.size}"`;
  res.setHeader('Cache-Control', 'private, no-cache'); res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${mode === 'view' ? 'inline' : 'attachment'}; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(v.filename || 'report.pdf')}`);
  if (!await streamReportObject(v.objectKey, res)) fail(404, 'PDF_NOT_FOUND', 'Không tìm thấy nội dung PDF.');
  // streamReportObject owns completion; prevent the JSON wrapper writing into the stream.
  return res;
});
academicRoute('put', '/api/enrollments/:enrollmentId/project-evaluations/:role', req => service.grade(req.user, req.params.enrollmentId, req.params.role, req.body));
academicRoute('put', '/api/enrollments/:enrollmentId/internship-grade', req => service.grade(req.user, req.params.enrollmentId, 'internship', req.body));
for (const path of ['project-evaluations', 'internship-grade']) academicRoute('get', `/api/enrollments/:enrollmentId/${path}`, async req => {
  const { e, view } = await readEnrollment(req.user,req.params.enrollmentId);
  if (!view.canSeeGrades) fail(403, 'GRADES_PRIVATE', 'Điểm chỉ dành cho giảng viên có phân công chấm và Khoa.');
  return { evaluations: view.evaluations, internshipGrade: view.internshipGrade, finalScore: view.finalScore, lockedAt: e.lockedAt, revision: e.revision };
});
academicRoute('post', '/api/admin/semesters/:semesterId/enrollments/import/preview', async req => {
  requireAdmin(req.user); const f = await form(req); const file = f.get('file');
  if (!file || typeof file === 'string' || !file.name.toLowerCase().endsWith('.xlsx')) return fail(422, 'WORKBOOK_REQUIRED', 'Cần file .xlsx.');
  let resolutions = {}; try { resolutions = JSON.parse(String(f.get('resolutions') || '{}')); } catch { fail(422, 'INVALID_RESOLUTIONS', 'Ánh xạ dòng không hợp lệ.'); }
  const s = await snapshot(); const plan = planImport(s, req.params.semesterId, Buffer.from(await file.arrayBuffer()), resolutions);
  const p = await savePreview(req.user.id, 'import', s, plan);
  return { ...p, rows: plan.rows, summary: plan.summary, lecturers: s.lecturers };
}, [upload]);
academicRoute('post', '/api/admin/enrollment-imports/:previewId/commit', async req => {
  requireAdmin(req.user); const p = await readPreview(req.user.id, req.params.previewId, 'import'); if (p.result) return p.result;
  if (p.payload.summary.errors) fail(422, 'IMPORT_HAS_ERRORS', 'Cần giải quyết hoặc loại các dòng lỗi trước khi nhập.');
  const s = await snapshot(); if (s.revision !== p.revision) fail(409, 'STALE_PREVIEW', 'Dữ liệu đã thay đổi, cần xem trước lại.');
  const result = p.payload.summary;
  await commit(s, req.user.id, 'admin.enrollments.import', { ...p.payload.changes, previewId: req.params.previewId, previewResult: result }); return result;
});
academicRoute('post', '/api/admin/semesters/:semesterId/reviewers/preview', req => service.reviewerPreview(req.user, req.params.semesterId, req.body));
academicRoute('post', '/api/admin/reviewer-previews/:previewId/apply', req => service.applyReviewers(req.user, req.params.previewId));
academicRoute('get', '/api/admin/semesters/:semesterId/reviewer-quotas', async req => { requireAdmin(req.user); return (await snapshot()).quotas.filter(q => q.semesterId === req.params.semesterId); });
academicRoute('put', '/api/admin/semesters/:semesterId/reviewer-quotas', req => service.updateQuotas(req.user, req.params.semesterId, req.body.quotas));

async function gradeRows(req: any, semester = false, scoped = false) {
  const s = await snapshot();
  if (!scoped) requireAdmin(req.user);
  else { const c = getClass(s, req.params.classId); requireRead(s, c, req.user); if (req.user.role !== 'admin' && !s.enrollments.some(e => e.classId === c.id && e.status === 'active' && service.enrollmentView(s, c, e, req.user).myAssignment.some(r => r !== 'co'))) fail(403, 'GRADES_PRIVATE', 'Bạn không có phân công chấm trong lớp.'); }
  const classes = s.classes.filter(c => (semester ? c.semesterId === req.params.semesterId : c.id === req.params.classId) && (!req.query.group || req.query.group === 'all' || course(c).group === req.query.group) && (!req.query.courseCode || c.courseCode === req.query.courseCode));
  return s.enrollments.filter(e => classes.some(c => c.id === e.classId) && (!scoped || req.user.role === 'admin' || e.status === 'active' && service.enrollmentView(s, getClass(s, e.classId), e, req.user).myAssignment.some(r => r !== 'co'))).map(e => {
    const c = getClass(s, e.classId); const pair = e.evaluations[currentVersion(e).id] || {};
    const name = (role: AssignmentRole) => e.assignments.filter(a => a.role === role).map(a => s.lecturers.find(l => l.id === a.lecturerId)?.name || '').join('; ');
    return { semester: s.semesters.find(x => x.id === c.semesterId)?.name, class: c.code, studentId: e.studentId, name: e.name, topic: currentVersion(e).title || e.topic,
      primary: name('primary'), co: name('co'), reviewer: name('reviewer'), advisorScore: pair.advisor?.score ?? null, reviewerScore: pair.reviewer?.score ?? null,
      progress: e.internshipGrade?.progress ?? null, report: e.internshipGrade?.report ?? null, company: e.internshipGrade?.company ?? null,
      finalScore: totalScore(c, e), submission: currentVersion(e).state, status: e.status, lockedAt: e.lockedAt };
  }).filter(row => !req.query.status || req.query.status === 'complete' && row.finalScore != null || req.query.status === 'missing' && row.finalScore == null);
}
for (const [base, semester, scoped] of [['/api/admin/classes/:classId/grades', false, false], ['/api/admin/semesters/:semesterId/grades', true, false], ['/api/classes/:classId/grades', false, true]] as const) {
  academicRoute('get', base, req => gradeRows(req, semester, scoped));
  academicRoute('get', `${base}/export.xlsx`, async (req, res) => {
    const rows = await gradeRows(req, semester, scoped); const headers = ['Học kỳ', 'Lớp học phần', 'MSSV', 'Họ tên', 'Đề tài', 'GVHD', 'Đồng HD', 'GVNX', 'Điểm GVHD', 'Điểm GVNX', 'Tiến độ', 'Báo cáo', 'Doanh nghiệp', 'Tổng kết', 'Bài nộp', 'Tư cách', 'Khóa lúc'];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map(r => Object.values(r))]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, 'Bang diem');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="bang-diem.xlsx"'); res.end(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });
}
academicRoute('get', '/api/admin/classes/:classId/audit', async req => {
  requireAdmin(req.user); const s = await snapshot(); getClass(s, req.params.classId);
  return (await db.execute({ sql: `SELECT id,actor_id,action,reason,created_at,payload FROM academic_commands WHERE EXISTS(SELECT 1 FROM json_each(payload,'$.enrollments') e WHERE json_extract(e.value,'$.classId')=?) OR EXISTS(SELECT 1 FROM json_each(payload,'$.classes') c WHERE json_extract(c.value,'$.id')=?) OR EXISTS(SELECT 1 FROM json_each(payload,'$.events') ev WHERE json_extract(ev.value,'$.classId')=?) ORDER BY created_at DESC LIMIT 100`, args: [req.params.classId, req.params.classId, req.params.classId] })).rows;
});
