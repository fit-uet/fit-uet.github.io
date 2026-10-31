import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { accessRecordCteFor } from '../academic/reads';

const unreadCountsCache = new Map<number, { data: { notifications: number; chats: number }; expiresAt: number; scope:string; revision:number }>();

export function invalidateUnreadCountsCache(userId?: number) {
  if (userId != null) unreadCountsCache.delete(userId);
  else unreadCountsCache.clear();
}

export async function unreadCounts(user: AuthenticatedUser) {
  const now = Date.now();
  // A one-row revision check keeps this cache cheap without retaining counts
  // from project memberships or assignments that have just been revoked.
  const revision=Number((await db.execute('SELECT revision FROM academic_meta WHERE id=1')).rows[0]?.revision||0);
  const scope=JSON.stringify([user.role,user.email.trim().toLowerCase(),user.personal_email||'',!!user.is_lecturer]);
  const cached = unreadCountsCache.get(user.id);
  if (cached && cached.expiresAt > now && cached.revision===revision && cached.scope===scope) {
    return cached.data;
  }

  const permission = `EXISTS(SELECT 1 FROM records e WHERE (e.courseCode IN ('INT3131','INT3132') OR json_extract(e.j,'$.status')='active') AND (lower(json_extract(e.j,'$.email'))=actor.email OR EXISTS(SELECT 1 FROM json_each(json_extract(e.j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=e.actorLecturerId)) AND (
    n.type='course_announcement' AND n.academic_campaign_id IS NOT NULL AND e.campaignId=n.academic_campaign_id AND (COALESCE(n.academic_audience_class_ids,'[]')='[]' OR e.class_id IN (SELECT value FROM json_each(n.academic_audience_class_ids)))
    OR (n.type!='course_announcement' OR n.academic_campaign_id IS NULL) AND e.class_id=n.academic_class_id AND (n.academic_enrollment_id IS NULL OR e.id=n.academic_enrollment_id)))`;
  // Separate recipient branches let SQLite seek each ordered index. The old
  // user_id IS NULL OR email predicate visited every unbound notification.
  // Each branch may contribute at most 100 of the final 100 visible notices.
  const recipients = [{sql:'n.user_id=?',args:[user.id]}, ...[...new Set([user.email,user.personal_email || ''].filter(Boolean).map(email=>email.toLowerCase()))].map(email=>({sql:'n.user_id IS NULL AND n.recipient_email=? COLLATE NOCASE',args:[email]}))];
  const personal = recipients.map(recipient=>`SELECT * FROM (SELECT n.id,n.created_at,n.read_at FROM notifications n CROSS JOIN actor
      WHERE ${recipient.sql} AND n.type!='advisor_quota_exceeded' AND (actor.role='admin' OR n.type!='faq_question_created')
      AND (n.academic_class_id IS NULL OR lower(trim(n.recipient_email))=actor.email AND ${permission}) ORDER BY n.created_at DESC LIMIT 100)`).join(' UNION ALL ');
  const result = await db.execute({ sql: `${accessRecordCteFor(user)},
    personal AS (${personal}),
    notices AS (SELECT created_at,read_at FROM personal UNION ALL SELECT s.created_at,r.read_at FROM system_notifications s LEFT JOIN system_notification_reads r ON r.system_notification_id=s.id AND r.user_id=? CROSS JOIN actor WHERE s.active=1 AND (s.target_role='all' OR s.target_role=actor.role)),
    latest AS (SELECT * FROM notices ORDER BY created_at DESC LIMIT 100),
    legacy_private AS (SELECT m.id FROM actor CROSS JOIN advisor_assignments aa CROSS JOIN chat_messages m
      WHERE ${user.role==='student'?'aa.user_id=?':'aa.lecturer_id=actor.identityLecturerId'} AND m.student_user_id=aa.user_id AND m.lecturer_id=aa.lecturer_id
      AND m.sender_user_id!=? AND m.read_at IS NULL GROUP BY m.id),
    legacy_group AS (SELECT m.id FROM actor CROSS JOIN chat_group_messages m WHERE m.lecturer_id IN (${user.role==='student'?'SELECT lecturer_id FROM advisor_assignments WHERE user_id=?':'SELECT identityLecturerId FROM actor'})
      AND m.sender_user_id!=? AND NOT EXISTS(SELECT 1 FROM chat_group_message_reads r WHERE r.message_id=m.id AND r.user_id=?)),
    academic_unread AS (SELECT m.id FROM actor CROSS JOIN academic_messages m WHERE ${user.role==='student'?"m.lecturer_id IN (SELECT json_extract(a.value,'$.lecturerId') FROM records e,json_each(e.j,'$.assignments') a WHERE json_extract(a.value,'$.role')!='reviewer')":'m.lecturer_id=actor.identityLecturerId'} AND m.sender_id!=? AND NOT EXISTS(SELECT 1 FROM academic_message_reads r WHERE r.message_id=m.id AND r.user_id=?)
      AND EXISTS(SELECT 1 FROM records e WHERE e.campaignStatus!='draft' AND (e.courseCode IN ('INT3131','INT3132') OR json_extract(e.j,'$.status')='active')
        AND (m.enrollment_id IS NOT NULL AND m.enrollment_id=e.id OR m.enrollment_id IS NULL AND e.campaignId=(SELECT COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||':internship') FROM academic_classes c WHERE c.id=m.class_id))
        AND EXISTS(SELECT 1 FROM json_each(json_extract(e.j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=m.lecturer_id AND json_extract(a.value,'$.role')!='reviewer')
        AND (actor.role='student' AND lower(json_extract(e.j,'$.email'))=actor.email OR actor.lecturer=1 AND m.lecturer_id=e.actorLecturerId)))
    SELECT (SELECT count(*) FROM latest WHERE read_at IS NULL) notifications,
      (SELECT count(*) FROM legacy_private)+(SELECT count(*) FROM legacy_group)+(SELECT count(*) FROM academic_unread) chats`,
    args: [user.role,user.email.trim().toLowerCase(),user.role==='lecturer'||user.role==='admin'||user.is_lecturer?1:0,'','',...recipients.flatMap(r=>r.args),user.id,...(user.role==='student'?[user.id]:[]),user.id,...(user.role==='student'?[user.id]:[]),user.id,user.id,user.id,user.id] });
  const data = { notifications: Number(result.rows[0].notifications), chats: Number(result.rows[0].chats) };
  if (unreadCountsCache.size > 2000) unreadCountsCache.clear();
  unreadCountsCache.set(user.id, { data, expiresAt: now + 20_000,scope,revision });
  return data;
}
