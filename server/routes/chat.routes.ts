import express, { Router } from 'express';
import { db, executeBatch } from '../db';
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  CHAT_THREAD_STORAGE_LIMIT_BYTES,
  CHAT_DAILY_UPLOAD_LIMIT_BYTES,
} from '../config';
import {
  requireAuth,
  getActorLecturer,
  canAccessChatThread,
  canAccessChatGroup,
} from '../middlewares/auth';
import {
  safeFilename,
  safeDecodeHeader,
  normalizeChatAttachmentMime,
  isAllowedChatAttachment,
  chatGroupAttachmentObjectKey,
  saveChatAttachmentObject,
  streamChatAttachmentObject,
  deleteChatAttachmentObject,
  chatAttachmentObjectKey,
} from '../services/storage';
import {
  chatMessageSelect,
  chatGroupMessageSelect,
} from '../services/advisorSync';

export const chatRouter = Router();

chatRouter.get('/api/chat/threads', requireAuth, async (req: any, res: any) => {
  try {
    if (req.user.role === 'student') {
      const rows = (await db.execute({
        sql: `
          SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 u.name as student_name, u.student_id, NULL as student_count,
                 (
                   SELECT body FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message,
                 (
                   SELECT attachment_name FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_attachment_name,
                 (
                   SELECT created_at FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message_at,
                 (
                   SELECT COUNT(*) FROM chat_messages
                   WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                     AND sender_user_id != ? AND read_at IS NULL
                 ) as unread_count
          FROM advisor_assignments aa
          JOIN lecturers l ON l.id = aa.lecturer_id
          JOIN users u ON u.id = aa.user_id
          WHERE aa.user_id = ?
          ORDER BY CASE aa.role WHEN 'primary' THEN 0 ELSE 1 END, l.name ASC
        `,
        args: [req.user.id, req.user.id],
      })).rows;
      const groupRows = (await db.execute({
        sql: `
          SELECT 1 as is_group, NULL as student_user_id, gl.lecturer_id, 'group' as advisor_role,
                 l.name as lecturer_name, l.email as lecturer_email,
                 'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id,
                 COALESCE(student_counts.student_count, 0) as student_count,
                 (
                   SELECT body FROM chat_group_messages
                   WHERE lecturer_id = gl.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message,
                 (
                   SELECT attachment_name FROM chat_group_messages
                   WHERE lecturer_id = gl.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_attachment_name,
                 (
                   SELECT created_at FROM chat_group_messages
                   WHERE lecturer_id = gl.lecturer_id
                   ORDER BY id DESC LIMIT 1
                 ) as last_message_at,
                 (
                   SELECT COUNT(*) FROM chat_group_messages cgm
                   LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
                   WHERE cgm.lecturer_id = gl.lecturer_id AND cgm.sender_user_id != ? AND r.message_id IS NULL
                 ) as unread_count
          FROM (
            SELECT DISTINCT lecturer_id
            FROM advisor_assignments
            WHERE user_id = ?
          ) gl
          JOIN lecturers l ON l.id = gl.lecturer_id
          LEFT JOIN (
            SELECT lecturer_id, COUNT(DISTINCT user_id) as student_count
            FROM advisor_assignments
            GROUP BY lecturer_id
          ) student_counts ON student_counts.lecturer_id = gl.lecturer_id
          ORDER BY l.name ASC
        `,
        args: [req.user.id, req.user.id, req.user.id],
      })).rows;
      return res.json([...groupRows, ...rows]);
    }
    const lecturer = await getActorLecturer(req.user);
    if (!lecturer) return res.json([]);
    const rows = (await db.execute({
      sql: `
        SELECT 0 as is_group, aa.user_id as student_user_id, aa.lecturer_id, aa.role as advisor_role,
               l.name as lecturer_name, l.email as lecturer_email,
               u.name as student_name, u.student_id, u.email as student_email, u.class_name, u.course_code, NULL as student_count,
               (
                 SELECT body FROM chat_messages
                 WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                 ORDER BY id DESC LIMIT 1
               ) as last_message,
               (
                 SELECT attachment_name FROM chat_messages
                 WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                 ORDER BY id DESC LIMIT 1
               ) as last_attachment_name,
               (
                 SELECT created_at FROM chat_messages
                 WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                 ORDER BY id DESC LIMIT 1
               ) as last_message_at,
               (
                 SELECT COUNT(*) FROM chat_messages
                 WHERE student_user_id = aa.user_id AND lecturer_id = aa.lecturer_id
                   AND sender_user_id != ? AND read_at IS NULL
               ) as unread_count
        FROM advisor_assignments aa
        JOIN lecturers l ON l.id = aa.lecturer_id
        JOIN users u ON u.id = aa.user_id
        WHERE aa.lecturer_id = ?
        ORDER BY COALESCE(last_message_at, aa.assigned_at) DESC, u.student_id ASC
      `,
      args: [req.user.id, Number(lecturer.id)],
    })).rows;
    const groupRows = (await db.execute({
      sql: `
        SELECT 1 as is_group, NULL as student_user_id, ? as lecturer_id, 'group' as advisor_role,
               l.name as lecturer_name, l.email as lecturer_email,
               'Nhóm sinh viên hướng dẫn' as student_name, NULL as student_id, NULL as student_email, NULL as class_name, NULL as course_code,
               COALESCE(student_counts.student_count, 0) as student_count,
               (
                 SELECT body FROM chat_group_messages
                 WHERE lecturer_id = ?
                 ORDER BY id DESC LIMIT 1
               ) as last_message,
               (
                 SELECT attachment_name FROM chat_group_messages
                 WHERE lecturer_id = ?
                 ORDER BY id DESC LIMIT 1
               ) as last_attachment_name,
               (
                 SELECT created_at FROM chat_group_messages
                 WHERE lecturer_id = ?
                 ORDER BY id DESC LIMIT 1
               ) as last_message_at,
               (
                 SELECT COUNT(*) FROM chat_group_messages cgm
                 LEFT JOIN chat_group_message_reads r ON r.message_id = cgm.id AND r.user_id = ?
                 WHERE cgm.lecturer_id = ? AND cgm.sender_user_id != ? AND r.message_id IS NULL
               ) as unread_count
        FROM lecturers l
        LEFT JOIN (
          SELECT lecturer_id, COUNT(DISTINCT user_id) as student_count
          FROM advisor_assignments
          WHERE lecturer_id = ?
          GROUP BY lecturer_id
        ) student_counts ON student_counts.lecturer_id = l.id
        WHERE l.id = ? AND COALESCE(student_counts.student_count, 0) > 0
      `,
      args: [
        Number(lecturer.id),
        Number(lecturer.id),
        Number(lecturer.id),
        Number(lecturer.id),
        req.user.id,
        Number(lecturer.id),
        req.user.id,
        Number(lecturer.id),
        Number(lecturer.id)
      ],
    })).rows;
    res.json([...groupRows, ...rows]);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

chatRouter.get('/api/chat/groups/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
  try {
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatGroup(req.user, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền xem nhóm trao đổi này.' });
    }
    await db.execute({
      sql: `
        INSERT OR IGNORE INTO chat_group_message_reads (message_id, user_id, read_at)
        SELECT id, ?, datetime('now', '+7 hours')
        FROM chat_group_messages
        WHERE lecturer_id = ? AND sender_user_id != ?
      `,
      args: [req.user.id, lecturerId, req.user.id],
    });
    const rows = (await db.execute({
      sql: `${chatGroupMessageSelect}
            WHERE cgm.lecturer_id = ?
            ORDER BY cgm.created_at ASC, cgm.id ASC
            LIMIT 300`,
      args: [lecturerId],
    })).rows;
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

chatRouter.post('/api/chat/groups/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
  try {
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatGroup(req.user, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền gửi tin nhắn trong nhóm này.' });
    }
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn.' });
    if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
    const result = await db.execute({
      sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, created_at)
            VALUES (?, ?, ?, datetime('now', '+7 hours'))`,
      args: [lecturerId, req.user.id, body],
    });
    const message = (await db.execute({
      sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    res.json(message);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

chatRouter.post('/api/chat/groups/:lecturerId/attachments', requireAuth, express.raw({ type: '*/*', limit: '11mb' }), async (req: any, res: any) => {
  let uploadedKey = '';
  try {
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatGroup(req.user, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền gửi file trong nhóm này.' });
    }
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const originalFilename = safeFilename(safeDecodeHeader(req.header('x-filename'), 'attachment'));
    const rawMimeType = String(req.header('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const mimeType = normalizeChatAttachmentMime(originalFilename, rawMimeType);
    const body = safeDecodeHeader(req.header('x-message-body'), '').trim();
    if (file.length === 0) return res.status(400).json({ error: 'File rỗng.' });
    if (file.length > MAX_CHAT_ATTACHMENT_BYTES) return res.status(413).json({ error: 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' });
    if (!isAllowedChatAttachment(originalFilename, mimeType)) {
      return res.status(400).json({ error: 'Định dạng file chưa được hỗ trợ. Hệ thống chỉ nhận PDF, Office, TXT, ZIP, JPG/PNG.' });
    }
    if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
    const threadUsage = (await db.execute({
      sql: 'SELECT COALESCE(SUM(attachment_size), 0) as total FROM chat_group_messages WHERE lecturer_id = ?',
      args: [lecturerId],
    })).rows[0] as any;
    if (Number(threadUsage?.total || 0) + file.length > CHAT_THREAD_STORAGE_LIMIT_BYTES) {
      return res.status(413).json({ error: 'Nhóm trao đổi này đã đầy dung lượng lưu trữ file. Vui lòng dùng file nhỏ hơn hoặc trao đổi qua kênh lưu trữ khác.' });
    }
    const dailyUsage = (await db.execute({
      sql: `
        SELECT COALESCE(SUM(total), 0) as total
        FROM (
          SELECT COALESCE(SUM(attachment_size), 0) as total
          FROM chat_messages
          WHERE sender_user_id = ?
            AND attachment_key IS NOT NULL
            AND created_at >= datetime('now', '+7 hours', 'start of day')
          UNION ALL
          SELECT COALESCE(SUM(attachment_size), 0) as total
          FROM chat_group_messages
          WHERE sender_user_id = ?
            AND attachment_key IS NOT NULL
            AND created_at >= datetime('now', '+7 hours', 'start of day')
        )
      `,
      args: [req.user.id, req.user.id],
    })).rows[0] as any;
    if (Number(dailyUsage?.total || 0) + file.length > CHAT_DAILY_UPLOAD_LIMIT_BYTES) {
      return res.status(429).json({ error: 'Bạn đã đạt giới hạn gửi file trong ngày. Vui lòng gửi tiếp vào ngày mai hoặc dùng file nhỏ hơn.' });
    }

    const key = chatGroupAttachmentObjectKey(lecturerId, Number(req.user.id), originalFilename);
    await saveChatAttachmentObject(key, file, mimeType);
    uploadedKey = key;
    const result = await db.execute({
      sql: `INSERT INTO chat_group_messages (lecturer_id, sender_user_id, body, attachment_key, attachment_name, attachment_size, attachment_mime, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [lecturerId, req.user.id, body || '', key, originalFilename, file.length, mimeType],
    });
    const message = (await db.execute({
      sql: `${chatGroupMessageSelect} WHERE cgm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    res.json(message);
    uploadedKey = '';
  } catch (e: any) {
    if (uploadedKey) {
      try { await deleteChatAttachmentObject(uploadedKey); } catch (cleanupError) { console.error('[chat-group] failed to cleanup orphan attachment:', cleanupError); }
    }
    res.status(e?.type === 'entity.too.large' ? 413 : 500).json({ error: e?.type === 'entity.too.large' ? 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' : e.message });
  }
});

chatRouter.get('/api/chat/group-messages/:messageId/attachment', requireAuth, async (req: any, res: any) => {
  try {
    const messageId = Number(req.params.messageId);
    const message = (await db.execute({
      sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message || !message.attachment_key) return res.status(404).json({ error: 'Không tìm thấy file.' });
    if (!(await canAccessChatGroup(req.user, Number(message.lecturer_id)))) {
      return res.status(403).json({ error: 'Bạn không có quyền tải file này.' });
    }
    const preview = String(req.query.preview || '') === '1';
    const mime = String(message.attachment_mime || 'application/octet-stream');
    const disposition = preview && (mime.startsWith('image/') || mime === 'application/pdf') ? 'inline' : 'attachment';
    res.setHeader('content-type', mime);
    res.setHeader('content-length', String(message.attachment_size || ''));
    res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(message.attachment_name || 'attachment')}"`);
    const streamed = await streamChatAttachmentObject(message.attachment_key, res);
    if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file lưu trữ.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Không tải được file.' });
  }
});

chatRouter.delete('/api/chat/group-messages/:messageId', requireAuth, async (req: any, res: any) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
    const message = (await db.execute({
      sql: 'SELECT * FROM chat_group_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
    if (req.user.role !== 'admin') {
      if (Number(message.sender_user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Bạn chỉ có thể thu hồi tin nhắn do mình gửi.' });
      }
      if (!(await canAccessChatGroup(req.user, Number(message.lecturer_id)))) {
        return res.status(403).json({ error: 'Bạn không có quyền thu hồi tin nhắn này.' });
      }
    }
    if (message.attachment_key) {
      await deleteChatAttachmentObject(message.attachment_key);
    }
    await executeBatch([
      { sql: 'DELETE FROM chat_group_message_reads WHERE message_id = ?', args: [messageId] },
      { sql: 'DELETE FROM chat_group_messages WHERE id = ?', args: [messageId] },
    ]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Không thu hồi được tin nhắn.' });
  }
});

chatRouter.get('/api/chat/threads/:studentUserId/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
  try {
    const studentUserId = Number(req.params.studentUserId);
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền xem cuộc trò chuyện này.' });
    }
    await db.execute({
      sql: `UPDATE chat_messages
            SET read_at = COALESCE(read_at, datetime('now', '+7 hours'))
            WHERE student_user_id = ? AND lecturer_id = ? AND sender_user_id != ? AND read_at IS NULL`,
      args: [studentUserId, lecturerId, req.user.id],
    });
    const rows = (await db.execute({
      sql: `${chatMessageSelect}
            WHERE cm.student_user_id = ? AND cm.lecturer_id = ?
            ORDER BY cm.created_at ASC, cm.id ASC
            LIMIT 300`,
      args: [studentUserId, lecturerId],
    })).rows;
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

chatRouter.post('/api/chat/threads/:studentUserId/:lecturerId/messages', requireAuth, async (req: any, res: any) => {
  try {
    const studentUserId = Number(req.params.studentUserId);
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền gửi tin nhắn trong cuộc trò chuyện này.' });
    }
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn.' });
    if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
    const result = await db.execute({
      sql: `INSERT INTO chat_messages (student_user_id, lecturer_id, sender_user_id, body, created_at)
            VALUES (?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [studentUserId, lecturerId, req.user.id, body],
    });
    const message = (await db.execute({
      sql: `${chatMessageSelect} WHERE cm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    res.json(message);
  } catch (e: any) {
    res.status(500).json({ error: 'Database error: ' + e.message });
  }
});

chatRouter.post('/api/chat/threads/:studentUserId/:lecturerId/attachments', requireAuth, express.raw({ type: '*/*', limit: '11mb' }), async (req: any, res: any) => {
  let uploadedKey = '';
  try {
    const studentUserId = Number(req.params.studentUserId);
    const lecturerId = Number(req.params.lecturerId);
    if (!(await canAccessChatThread(req.user, studentUserId, lecturerId))) {
      return res.status(403).json({ error: 'Bạn không có quyền gửi file trong cuộc trò chuyện này.' });
    }
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const originalFilename = safeFilename(safeDecodeHeader(req.header('x-filename'), 'attachment'));
    const rawMimeType = String(req.header('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const mimeType = normalizeChatAttachmentMime(originalFilename, rawMimeType);
    const body = safeDecodeHeader(req.header('x-message-body'), '').trim();
    if (file.length === 0) return res.status(400).json({ error: 'File rỗng.' });
    if (file.length > MAX_CHAT_ATTACHMENT_BYTES) return res.status(413).json({ error: 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' });
    if (!isAllowedChatAttachment(originalFilename, mimeType)) {
      return res.status(400).json({ error: 'Định dạng file chưa được hỗ trợ. Hệ thống chỉ nhận PDF, Office, TXT, ZIP, JPG/PNG.' });
    }
    if (body.length > 2000) return res.status(400).json({ error: 'Tin nhắn tối đa 2000 ký tự.' });
    const threadUsage = (await db.execute({
      sql: 'SELECT COALESCE(SUM(attachment_size), 0) as total FROM chat_messages WHERE student_user_id = ? AND lecturer_id = ?',
      args: [studentUserId, lecturerId],
    })).rows[0] as any;
    if (Number(threadUsage?.total || 0) + file.length > CHAT_THREAD_STORAGE_LIMIT_BYTES) {
      return res.status(413).json({ error: 'Cuộc trò chuyện này đã đầy dung lượng lưu trữ file. Vui lòng dùng file nhỏ hơn hoặc trao đổi qua kênh lưu trữ khác.' });
    }
    const dailyUsage = (await db.execute({
      sql: `
        SELECT COALESCE(SUM(total), 0) as total
        FROM (
          SELECT COALESCE(SUM(attachment_size), 0) as total
          FROM chat_messages
          WHERE sender_user_id = ?
            AND attachment_key IS NOT NULL
            AND created_at >= datetime('now', '+7 hours', 'start of day')
          UNION ALL
          SELECT COALESCE(SUM(attachment_size), 0) as total
          FROM chat_group_messages
          WHERE sender_user_id = ?
            AND attachment_key IS NOT NULL
            AND created_at >= datetime('now', '+7 hours', 'start of day')
        )
      `,
      args: [req.user.id, req.user.id],
    })).rows[0] as any;
    if (Number(dailyUsage?.total || 0) + file.length > CHAT_DAILY_UPLOAD_LIMIT_BYTES) {
      return res.status(429).json({ error: 'Bạn đã đạt giới hạn gửi file trong ngày. Vui lòng gửi tiếp vào ngày mai hoặc dùng file nhỏ hơn.' });
    }

    const key = chatAttachmentObjectKey(studentUserId, lecturerId, Number(req.user.id), originalFilename);
    await saveChatAttachmentObject(key, file, mimeType);
    uploadedKey = key;
    const result = await db.execute({
      sql: `INSERT INTO chat_messages (student_user_id, lecturer_id, sender_user_id, body, attachment_key, attachment_name, attachment_size, attachment_mime, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+7 hours'))`,
      args: [studentUserId, lecturerId, req.user.id, body || '', key, originalFilename, file.length, mimeType],
    });
    const message = (await db.execute({
      sql: `${chatMessageSelect} WHERE cm.id = ?`,
      args: [Number(result.lastInsertRowid)],
    })).rows[0];
    res.json(message);
    uploadedKey = '';
  } catch (e: any) {
    if (uploadedKey) {
      try { await deleteChatAttachmentObject(uploadedKey); } catch (cleanupError) { console.error('[chat] failed to cleanup orphan attachment:', cleanupError); }
    }
    res.status(e?.type === 'entity.too.large' ? 413 : 500).json({ error: e?.type === 'entity.too.large' ? 'File vượt quá 10 MB. Vui lòng nén hoặc gửi file nhỏ hơn.' : e.message });
  }
});

chatRouter.get('/api/chat/messages/:messageId/attachment', requireAuth, async (req: any, res: any) => {
  try {
    const messageId = Number(req.params.messageId);
    const message = (await db.execute({
      sql: 'SELECT * FROM chat_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message || !message.attachment_key) return res.status(404).json({ error: 'Không tìm thấy file.' });
    if (!(await canAccessChatThread(req.user, Number(message.student_user_id), Number(message.lecturer_id)))) {
      return res.status(403).json({ error: 'Bạn không có quyền tải file này.' });
    }
    const preview = String(req.query.preview || '') === '1';
    const mime = String(message.attachment_mime || 'application/octet-stream');
    const disposition = preview && (mime.startsWith('image/') || mime === 'application/pdf') ? 'inline' : 'attachment';
    res.setHeader('content-type', mime);
    res.setHeader('content-length', String(message.attachment_size || ''));
    res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(message.attachment_name || 'attachment')}"`);
    const streamed = await streamChatAttachmentObject(message.attachment_key, res);
    if (!streamed && !res.headersSent) return res.status(404).json({ error: 'Không tìm thấy file lưu trữ.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Không tải được file.' });
  }
});

chatRouter.delete('/api/chat/messages/:messageId', requireAuth, async (req: any, res: any) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'Tin nhắn không hợp lệ.' });
    const message = (await db.execute({
      sql: 'SELECT * FROM chat_messages WHERE id = ?',
      args: [messageId],
    })).rows[0] as any;
    if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
    if (req.user.role !== 'admin') {
      if (Number(message.sender_user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Bạn chỉ có thể thu hồi tin nhắn do mình gửi.' });
      }
      if (!(await canAccessChatThread(req.user, Number(message.student_user_id), Number(message.lecturer_id)))) {
        return res.status(403).json({ error: 'Bạn không có quyền thu hồi tin nhắn này.' });
      }
    }
    if (message.attachment_key) {
      await deleteChatAttachmentObject(message.attachment_key);
    }
    await db.execute({ sql: 'DELETE FROM chat_messages WHERE id = ?', args: [messageId] });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Không thu hồi được tin nhắn.' });
  }
});
