import { randomUUID, createHash } from 'node:crypto';
import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { getClass, now, requireAdmin, requireRead, text } from './domain';
import { commit, fail, readPreview, savePreview, snapshot, type AcademicEvent, type Snapshot } from './store';
import { campaignClasses, requireCampaign } from './campaigns';
import { readCommunicationContext } from './reads';
const legacyQuestionRevision = (q: any) => createHash('sha256').update(`${q.answer || ''}\n${q.answered_at || ''}`).digest().readUInt32BE(0);

function context(s: Snapshot, target: string, actor: AuthenticatedUser, writing = false) {
  const direct = s.campaigns?.find(p => p.id === target);
  if (!direct) requireRead(s, getClass(s, target), actor);
  const p = requireCampaign(s, direct?.id || getClass(s, target).campaignId, actor, writing);
  const classes = campaignClasses(s, p.id); return { p, classes, ids: JSON.stringify(classes.map(c => c.id)) };
}
export async function classQuestions(actor: AuthenticatedUser, target: string) {
  const { s } = await readCommunicationContext(actor, target); const { p, ids } = context(s, target, actor);
  const rows = (await db.execute({ sql: `SELECT q.id,q.question,q.answer,q.created_at,q.answered_at,q.user_id,q.revision,CASE WHEN ?='admin' THEN u.name ELSE NULL END asker_name
    FROM academic_questions q JOIN users u ON u.id=q.user_id WHERE q.class_id IN (SELECT value FROM json_each(?)) AND (q.answer IS NOT NULL OR q.user_id=? OR ?='admin') ORDER BY q.created_at DESC LIMIT 200`, args: [actor.role, ids, actor.id, actor.role] })).rows;
  if (p.legacy && (await db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faq_questions'")).rows.length) {
    // Historical private questions keep their original audience after the UI move.
    const old = (await db.execute({ sql: "SELECT q.*,CASE WHEN ?='admin' THEN u.name ELSE NULL END asker_name FROM faq_questions q JOIN users u ON u.id=q.user_id WHERE q.user_id=? OR ?='admin' ORDER BY q.created_at DESC LIMIT 200", args: [actor.role, actor.id, actor.role] })).rows;
    rows.push(...old.map(q => ({ ...q, id: `legacy-${q.id}`, revision: legacyQuestionRevision(q) })));
  }
  return rows;
}
export async function askQuestion(actor: AuthenticatedUser, target: string, value: unknown) {
  const s = await snapshot(); const { p, classes } = context(s, target, actor, true);
  const question = text(value); if (!question || question.length > 2000) fail(422, 'INVALID_QUESTION', 'Câu hỏi cần từ 1 đến 2.000 ký tự.');
  if (!classes.length) fail(422, 'CLASS_REQUIRED', 'Nhóm chưa có lớp học phần.');
  const id = randomUUID(); const result = await db.execute({ sql: `INSERT INTO academic_questions(id,class_id,campaign_id,user_id,question,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT revision FROM academic_meta WHERE id=1)=?`, args: [id, classes[0].id, p.id, actor.id, question, now(), s.revision] });
  if (!result.rowsAffected) fail(409, 'STALE_CONTEXT', 'Nhóm môn đã thay đổi, vui lòng tải lại.'); return { id };
}
export async function answerQuestion(actor: AuthenticatedUser, target: string, id: string, input: any) {
  requireAdmin(actor); const s = await snapshot(); const { p, ids } = context(s, target, actor, true);
  const answer = text(input.answer); if (!answer || answer.length > 10000 || !Number.isInteger(input.expectedRevision)) fail(422, 'INVALID_ANSWER', 'Câu trả lời không hợp lệ.');
  const legacy = /^legacy-(\d+)$/.exec(id);
  if (legacy) {
    if (!p.legacy) fail(403, 'CAMPAIGN_ACCESS_DENIED', 'Câu hỏi cũ không thuộc nhóm môn này.');
    const q = (await db.execute({ sql: 'SELECT * FROM faq_questions WHERE id=?', args: [Number(legacy[1])] })).rows[0];
    if (!q || legacyQuestionRevision(q) !== input.expectedRevision) fail(409, 'STALE_QUESTION', 'Câu hỏi đã thay đổi.');
    const changed = await db.execute({ sql: "UPDATE faq_questions SET answer=?,status='answered',answered_by=?,answered_at=datetime('now') WHERE id=? AND COALESCE(answer,'')=? AND COALESCE(answered_at,'')=? AND (SELECT revision FROM academic_meta WHERE id=1)=?", args: [answer, actor.id, Number(legacy[1]), q.answer || '', q.answered_at || '', s.revision] });
    if (!changed.rowsAffected) fail(409, 'STALE_QUESTION', 'Câu hỏi đã thay đổi.'); return { answered: true };
  }
  const result = await db.execute({ sql: `UPDATE academic_questions SET answer=?,answered_at=?,revision=revision+1 WHERE id=? AND class_id IN (SELECT value FROM json_each(?)) AND revision=? AND (SELECT revision FROM academic_meta WHERE id=1)=?`, args: [answer, now(), id, ids, input.expectedRevision, s.revision] });
  if (!result.rowsAffected) fail(409, 'STALE_QUESTION', 'Câu hỏi/nhóm môn đã thay đổi, vui lòng tải lại.'); return { answered: true };
}
function announcementPlan(s: Snapshot, actor: AuthenticatedUser, target: string, input: any) {
  requireAdmin(actor); const { p, classes } = context(s, target, actor, true);
  const subject = text(input.subject), body = text(input.body);
  if (!subject || subject.length > 300 || !body || body.length > 10000 || !['website_only', 'website_and_email'].includes(input.deliveryMode)) fail(422, 'INVALID_ANNOUNCEMENT', 'Cần tiêu đề, nội dung và phương thức gửi hợp lệ.');
  const allowedIds = s.campaigns?.some(p => p.id === target) ? classes.filter(c => (!input.classId || c.id === input.classId) && (!input.courseCode || c.courseCode === input.courseCode)).map(c => c.id) : [target];
  if (input.classId && !classes.some(c => c.id === input.classId) || input.courseCode && !classes.some(c => c.courseCode === input.courseCode)) fail(422, 'INVALID_CAMPAIGN_FILTER', 'Lớp/học phần không thuộc nhóm môn.');
  const enrollments = s.enrollments.filter(e => allowedIds.includes(e.classId) && e.status !== 'withdrawn');
  const events: AcademicEvent[] = []; const seen = new Set<string>(); const operation = randomUUID();
  for (const e of enrollments) {
    const emails = [e.email, ...(input.includeLecturers ? e.assignments.map(a => s.lecturers.find(l => l.id === a.lecturerId)?.email).filter(Boolean) : [])];
    for (const email of emails) {
      if (seen.has(email)) continue; seen.add(email);
      events.push({ id: `${operation}:${email}`, email, userId: null, classId: e.classId, campaignId: p.id, audienceClassIds: allowedIds, type: 'course_announcement', subject: `[${p.group === 'project' ? 'Dự án' : 'Thực tập'}] ${subject}`, body: `${s.semesters.find(x => x.id === p.semesterId)?.name}\n\n${body}`, deliveryMode: input.deliveryMode, forceImmediate: input.deliveryMode === 'website_and_email' });
    }
  }
  return events;
}
export async function announce(actor: AuthenticatedUser, target: string, input: any) {
  const s = await snapshot(); const events = announcementPlan(s, actor, target, input);
  await commit(s, actor.id, 'admin.campaign.announce', { events }); return { created: events.length };
}
export async function announcementPreview(actor: AuthenticatedUser, target: string, input: any) {
  const s = await snapshot(); const events = announcementPlan(s, actor, target, input);
  const preview = await savePreview(actor.id, 'campaign-announcement', s, { target, input, events });
  return { ...preview, subject: text(input.subject), body: text(input.body), deliveryMode: input.deliveryMode, recipients: events.map(event => {
    const lecturer = s.lecturers.find(l => l.email === event.email);
    const enrollment = s.enrollments.find(e => e.email === event.email);
    return { email: event.email, name: lecturer?.name || enrollment?.name || event.email, role: lecturer ? 'lecturer' : 'student' };
  }) };
}
export async function applyAnnouncementPreview(actor: AuthenticatedUser, id: string) {
  requireAdmin(actor); const p = await readPreview(actor.id, id, 'campaign-announcement'); if (p.result) return p.result;
  const s = await snapshot(); if (s.revision !== p.revision) fail(409, 'STALE_PREVIEW', 'Danh sách người nhận hoặc nhóm môn đã thay đổi; cần xem trước lại.');
  // Legacy assignments can change in their original tables without incrementing the native revision.
  const current = announcementPlan(s, actor, p.payload.target, p.payload.input);
  const audience = (events: AcademicEvent[]) => JSON.stringify(events.map(e => e.email).sort());
  if (audience(current) !== audience(p.payload.events)) fail(409, 'STALE_PREVIEW', 'Người nhận đã thay đổi; cần xem trước lại.');
  const result = { created: p.payload.events.length };
  await commit(s, actor.id, 'admin.campaign.announce', { events: p.payload.events, previewId: id, previewResult: result }); return result;
}
