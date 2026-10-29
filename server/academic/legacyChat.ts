import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import type { AcademicClass } from '../../src/shared/academic';
import type { Snapshot } from './store';
import { fail } from './store';

export async function legacyChatRows(s: Snapshot, c: AcademicClass, actor: AuthenticatedUser, lecturerId: number, enrollmentId?: string) {
  if (!c.legacy) return [];
  const table = enrollmentId ? 'chat_messages' : 'chat_group_messages';
  if (!(await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", args: [table] })).rows.length) return [];
  const e = enrollmentId ? s.enrollments.find(e => e.id === enrollmentId) : undefined;
  const student = e ? (await db.execute({ sql: 'SELECT id FROM users WHERE student_id=?', args: [e.studentId] })).rows[0] : null;
  if (enrollmentId && !student) return [];
  const rows = (await db.execute({ sql: `SELECT m.*,u.name sender_name FROM ${table} m JOIN users u ON u.id=m.sender_user_id WHERE m.lecturer_id=? ${student ? 'AND m.student_user_id=?' : ''} ORDER BY m.id DESC LIMIT 100`, args: student ? [lecturerId, student.id] : [lecturerId] })).rows as any[];
  if (c.status === 'active' && rows.length) {
    if (student) await db.execute({ sql: "UPDATE chat_messages SET read_at=COALESCE(read_at,datetime('now','+7 hours')) WHERE student_user_id=? AND lecturer_id=? AND sender_user_id!=?", args: [student.id, lecturerId, actor.id] });
    else if ((await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_group_message_reads'")).rows.length) await db.execute({ sql: 'INSERT OR IGNORE INTO chat_group_message_reads(message_id,user_id) SELECT id,? FROM chat_group_messages WHERE lecturer_id=?', args: [actor.id, lecturerId] });
  }
  return rows.map(row => ({ ...row, id: `legacy-${student ? 'private' : 'group'}-${row.id}`, sender_id: row.sender_user_id, class_id: c.id, retracted_at: null, created_at: /(Z|[+-]\d\d:\d\d)$/.test(row.created_at) ? row.created_at : `${String(row.created_at).replace(' ', 'T')}+07:00` }));
}
export async function findChatRow(id: string, classId: string) {
  const match = /^legacy-(group|private)-(\d+)$/.exec(id);
  if (!match) return (await db.execute({ sql: 'SELECT * FROM academic_messages WHERE id=? AND class_id=?', args: [id, classId] })).rows[0] as any;
  const row = (await db.execute({ sql: `SELECT * FROM ${match[1] === 'group' ? 'chat_group_messages' : 'chat_messages'} WHERE id=?`, args: [Number(match[2])] })).rows[0] as any;
  if (!row) return null;
  return { ...row, sender_id: row.sender_user_id, class_id: classId, legacyTable: match[1] === 'group' ? 'chat_group_messages' : 'chat_messages', legacyId: Number(match[2]) };
}
export async function authorizeLegacyChatRow(s: Snapshot, c: AcademicClass, row: any) {
  if (!row.legacyTable) return row.enrollment_id || undefined;
  if (!c.legacy) fail(403, 'CHAT_ACCESS_DENIED', 'Hội thoại cũ không thuộc nhóm môn này.');
  if (!row.student_user_id) return undefined;
  const u = (await db.execute({ sql: 'SELECT student_id FROM users WHERE id=?', args: [row.student_user_id] })).rows[0];
  return s.enrollments.find(e => e.classId === c.id && e.studentId === u?.student_id)?.id || fail(403, 'CHAT_ACCESS_DENIED', 'Hội thoại không thuộc lần học này.');
}
