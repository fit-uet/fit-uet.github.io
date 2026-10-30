import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../types';
import { db } from '../db';
import { fail, snapshot } from './store';
import { getClass, getEnrollment, lecturerFor, now, requireRead, requireWritable, text } from './domain';
import { CHAT_DAILY_UPLOAD_LIMIT_BYTES, CHAT_THREAD_STORAGE_LIMIT_BYTES, MAX_CHAT_ATTACHMENT_BYTES } from '../config';
import { campaignClasses, requireCampaign } from './campaigns';
import { readCommunicationContext } from './reads';
import { legacyChatRows, findChatRow, authorizeLegacyChatRow } from './legacyChat';
import { deleteChatAttachmentObject, isAllowedChatAttachment, normalizeChatAttachmentMime, safeFilename, saveChatAttachmentObject } from '../services/storage';

export async function chatThread(actor: AuthenticatedUser, classId: string, lecturerId: number, enrollmentId?: string, readOnly = false) {
  const s = readOnly ? await readCommunicationContext(actor,classId).then(ctx=>ctx.s).catch(error=>{
    if (enrollmentId && error.code === 'CAMPAIGN_ACCESS_DENIED') fail(403,'CLASS_ACCESS_DENIED','Bạn không có quyền truy cập dữ liệu lớp này.');
    throw error;
  }) : await snapshot(); const c = getClass(s, classId);
  if (enrollmentId) requireRead(s, c, actor); else requireCampaign(s, c.campaignId, actor);
  const classIds = enrollmentId ? [c.id] : campaignClasses(s, c.campaignId).map(c => c.id);
  const l = lecturerFor(s, actor);
  const participants = s.enrollments.filter(e => classIds.includes(e.classId) && e.status !== 'withdrawn' && e.assignments.some(a => a.lecturerId === lecturerId && a.role !== 'reviewer'));
  if (!participants.length) fail(403, 'CHAT_ACCESS_DENIED', 'Giảng viên không có nhóm hướng dẫn trong lớp.');
  if (enrollmentId) {
    const e = getEnrollment(s, enrollmentId);
    if (!participants.some(x => x.id === e.id)) fail(403, 'CHAT_ACCESS_DENIED', 'Cuộc trò chuyện không thuộc nhóm hướng dẫn này.');
    if (!(l?.id === lecturerId || actor.role === 'student' && e.email === actor.email)) fail(403, 'CHAT_ACCESS_DENIED', 'Bạn không là thành viên cuộc trò chuyện.');
  } else if (!(l?.id === lecturerId || actor.role === 'student' && participants.some(e => e.email === actor.email))) fail(403, 'CHAT_ACCESS_DENIED', 'Bạn không là thành viên nhóm.');
  return { s, c, classIds };
}
export async function chatMessages(actor: AuthenticatedUser, classId: string, lecturerId: number, enrollmentId?: string) {
  const { s, c, classIds } = await chatThread(actor, classId, lecturerId, enrollmentId, true);
  const messages = (await db.execute({ sql: `SELECT m.id,m.body,m.sender_id,u.name sender_name,m.created_at,m.attachment_name,m.attachment_size,m.retracted_at,m.class_id FROM academic_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.class_id IN (SELECT value FROM json_each(?)) AND m.lecturer_id=? AND COALESCE(m.enrollment_id,'')=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`, args: [JSON.stringify(classIds), lecturerId, enrollmentId || ''] })).rows;
  if (c.status === 'active') await db.execute({ sql: `INSERT OR IGNORE INTO academic_message_reads(message_id,user_id)
    SELECT id,? FROM academic_messages WHERE class_id IN (SELECT value FROM json_each(?)) AND lecturer_id=? AND COALESCE(enrollment_id,'')=? ORDER BY created_at DESC LIMIT 100`, args: [actor.id, JSON.stringify(classIds), lecturerId, enrollmentId || ''] });
  const old = await legacyChatRows(s, c, actor, lecturerId, enrollmentId);
  return [...messages, ...old].sort((a: any, b: any) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)) || String(a.id).localeCompare(String(b.id))).slice(-100);
}
export async function sendChat(actor: AuthenticatedUser, classId: string, lecturerId: number, enrollmentId: string | undefined, body: unknown, file?: { bytes: Buffer; name: string; mime: string }) {
  const { s, c, classIds } = await chatThread(actor, classId, lecturerId, enrollmentId);
  requireCampaign(s, c.campaignId, actor, true);
  const message = text(body);
  if ((!message && !file) || message.length > 10_000) fail(422, 'INVALID_MESSAGE', 'Cần nội dung hoặc file đính kèm, tối đa 10.000 ký tự.');
  if (file && (file.bytes.length > MAX_CHAT_ATTACHMENT_BYTES || !isAllowedChatAttachment(file.name, file.mime))) fail(422, 'INVALID_ATTACHMENT', 'File đính kèm không hợp lệ hoặc quá 10 MB.');
  const id = randomUUID();
  const key = file ? `class-chat/${classId}/${enrollmentId || 'group'}/${lecturerId}/${id}/${safeFilename(file.name)}` : null;
  try {
    if (file) await saveChatAttachmentObject(key!, file.bytes, normalizeChatAttachmentMime(file.name, file.mime));
    if (c.legacy) {
      const table = enrollmentId ? 'chat_messages' : 'chat_group_messages';
      const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_messages','chat_group_messages')")).rows.map(r => String(r.name)));
      if (tables.has(table)) {
        const e = enrollmentId ? getEnrollment(s, enrollmentId) : null;
        const user = e ? (await db.execute({ sql: 'SELECT id FROM users WHERE student_id=?', args: [e.studentId] })).rows[0] : null;
        const bytes = file?.bytes.length || 0;
        const daily = [...tables].map(name => `COALESCE((SELECT SUM(attachment_size) FROM ${name} WHERE sender_user_id=? AND date(created_at)=date('now','+7 hours')),0)`).join('+');
        const columns = [...(user ? ['student_user_id'] : []), 'lecturer_id', 'sender_user_id', 'body', 'created_at', 'attachment_key', 'attachment_name', 'attachment_mime', 'attachment_size'];
        const values = [...(user ? [user.id] : []), lecturerId, actor.id, message, new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }), key, file ? safeFilename(file.name) : null, file ? normalizeChatAttachmentMime(file.name, file.mime) : null, bytes];
        const result = await db.execute({ sql: `INSERT INTO ${table}(${columns.join(',')}) SELECT ${values.map(() => '?').join(',')} WHERE (SELECT revision FROM academic_meta WHERE id=1)=?
          AND (?=0 OR COALESCE((SELECT SUM(attachment_size) FROM ${table} WHERE lecturer_id=? ${user ? 'AND student_user_id=?' : ''}),0)+COALESCE((SELECT SUM(attachment_size) FROM academic_messages WHERE class_id IN (SELECT value FROM json_each(?)) AND lecturer_id=? AND COALESCE(enrollment_id,'')=?),0)+?<=?)
          AND (?=0 OR (${daily})+COALESCE((SELECT SUM(upload_size) FROM academic_messages WHERE sender_id=? AND date(created_at,'+7 hours')=date('now','+7 hours')),0)+?<=?) RETURNING id`,
          args: [...values, s.revision, bytes, lecturerId, ...(user ? [user.id] : []), JSON.stringify(classIds), lecturerId, enrollmentId || '', bytes, CHAT_THREAD_STORAGE_LIMIT_BYTES, bytes, ...[...tables].map(() => actor.id), actor.id, bytes, CHAT_DAILY_UPLOAD_LIMIT_BYTES] });
        if (!result.rows.length) fail(409, 'CHAT_QUOTA_OR_CONTEXT', 'Nhóm môn đã thay đổi hoặc hết dung lượng đính kèm.');
        return { id: `legacy-${user ? 'private' : 'group'}-${result.rows[0].id}` };
      }
    }
    const result = await db.execute({ sql: `INSERT INTO academic_messages(id,class_id,enrollment_id,lecturer_id,sender_id,body,created_at,attachment_key,attachment_name,attachment_mime,attachment_size,upload_size)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT revision FROM academic_meta WHERE id=1)=?
      AND (?=0 OR COALESCE((SELECT SUM(attachment_size) FROM academic_messages WHERE class_id IN (SELECT value FROM json_each(?)) AND lecturer_id=? AND COALESCE(enrollment_id,'')=?),0)+?<=?)
      AND (?=0 OR COALESCE((SELECT SUM(upload_size) FROM academic_messages WHERE sender_id=? AND date(created_at,'+7 hours')=date('now','+7 hours')),0)+?<=?)`,
      args: [id, classId, enrollmentId || null, lecturerId, actor.id, message, now(), key, file ? safeFilename(file.name) : null, file ? normalizeChatAttachmentMime(file.name, file.mime) : null, file?.bytes.length || 0, file?.bytes.length || 0, s.revision,
        file?.bytes.length || 0, JSON.stringify(classIds), lecturerId, enrollmentId || '', file?.bytes.length || 0, CHAT_THREAD_STORAGE_LIMIT_BYTES, file?.bytes.length || 0, actor.id, file?.bytes.length || 0, CHAT_DAILY_UPLOAD_LIMIT_BYTES] });
    if (!result.rowsAffected) fail(409, 'CHAT_QUOTA_OR_CONTEXT', 'Lớp/quyền đã thay đổi hoặc đã hết quota đính kèm. Vui lòng tải lại và kiểm tra dung lượng.');
  } catch (error) { if (key) await deleteChatAttachmentObject(key).catch(() => undefined); throw error; }
  return { id };
}
export async function retractChat(actor: AuthenticatedUser, classId: string, id: string) {
  const row = await findChatRow(id, classId);
  if (!row) fail(404, 'MESSAGE_NOT_FOUND', 'Không tìm thấy tin nhắn.');
  const before = await snapshot(); const cls = getClass(before, classId); const enrollmentId = await authorizeLegacyChatRow(before, cls, row);
  const { s, c } = await chatThread(actor, classId, Number(row.lecturer_id), enrollmentId); requireCampaign(s, c.campaignId, actor, true);
  if (Number(row.sender_id) !== Number(actor.id)) fail(403, 'SENDER_ONLY', 'Chỉ người gửi được thu hồi tin nhắn.');
  if (row.legacyTable) {
    if (row.legacyTable === 'chat_group_messages') await db.execute({ sql: 'DELETE FROM chat_group_message_reads WHERE message_id=?', args: [row.legacyId] });
    await db.execute({ sql: `DELETE FROM ${row.legacyTable} WHERE id=? AND sender_user_id=?`, args: [row.legacyId, actor.id] });
    if (row.attachment_key) await deleteChatAttachmentObject(row.attachment_key);
    return { retracted: true };
  }
  const result = await db.execute({ sql: `UPDATE academic_messages SET body='',attachment_key=NULL,attachment_name=NULL,attachment_mime=NULL,attachment_size=0,retracted_at=? WHERE id=? AND sender_id=? AND (SELECT revision FROM academic_meta WHERE id=1)=?`, args: [now(), id, actor.id, s.revision] });
  if (!result.rowsAffected) fail(409, 'STALE_CONTEXT', 'Quyền lớp đã thay đổi.');
  if (row.attachment_key) await deleteChatAttachmentObject(row.attachment_key);
  return { retracted: true };
}
