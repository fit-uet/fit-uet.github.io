import { db } from '../db';
import type { AuthenticatedUser } from '../types';
import { recordCte } from '../academic/reads';

export async function unreadCounts(user: AuthenticatedUser) {
  const permission = `EXISTS(SELECT 1 FROM records e WHERE json_extract(e.j,'$.status')='active' AND (lower(json_extract(e.j,'$.email'))=actor.email OR EXISTS(SELECT 1 FROM json_each(json_extract(e.j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=e.actorLecturerId)) AND (
    n.type='course_announcement' AND n.academic_campaign_id IS NOT NULL AND e.campaignId=n.academic_campaign_id AND (COALESCE(n.academic_audience_class_ids,'[]')='[]' OR e.class_id IN (SELECT value FROM json_each(n.academic_audience_class_ids)))
    OR (n.type!='course_announcement' OR n.academic_campaign_id IS NULL) AND e.class_id=n.academic_class_id AND (n.academic_enrollment_id IS NULL OR e.id=n.academic_enrollment_id)))`;
  const result = await db.execute({ sql: `${recordCte},
    personal AS (SELECT n.id,n.created_at,n.read_at FROM notifications n CROSS JOIN actor
      WHERE (n.user_id=? OR n.user_id IS NULL AND (n.recipient_email=? COLLATE NOCASE OR ?!='' AND n.recipient_email=? COLLATE NOCASE))
      AND n.type!='advisor_quota_exceeded' AND (actor.role='admin' OR n.type!='faq_question_created')
      AND (n.academic_class_id IS NULL OR lower(trim(n.recipient_email))=actor.email AND ${permission}) ORDER BY n.created_at DESC LIMIT 100),
    notices AS (SELECT created_at,read_at FROM personal UNION ALL SELECT s.created_at,r.read_at FROM system_notifications s LEFT JOIN system_notification_reads r ON r.system_notification_id=s.id AND r.user_id=? CROSS JOIN actor WHERE s.active=1 AND (s.target_role='all' OR s.target_role=actor.role)),
    latest AS (SELECT * FROM notices ORDER BY created_at DESC LIMIT 100),
    legacy_private AS (SELECT m.id FROM chat_messages m JOIN advisor_assignments aa ON aa.user_id=m.student_user_id AND aa.lecturer_id=m.lecturer_id CROSS JOIN actor
      WHERE m.sender_user_id!=? AND m.read_at IS NULL AND (actor.role='student' AND m.student_user_id=? OR actor.lecturer=1 AND m.lecturer_id=(SELECT id FROM lecturers WHERE lower(trim(email))=actor.email LIMIT 1)) GROUP BY m.id),
    legacy_group AS (SELECT m.id FROM chat_group_messages m CROSS JOIN actor WHERE m.sender_user_id!=? AND NOT EXISTS(SELECT 1 FROM chat_group_message_reads r WHERE r.message_id=m.id AND r.user_id=?)
      AND (actor.role='student' AND EXISTS(SELECT 1 FROM advisor_assignments aa WHERE aa.user_id=? AND aa.lecturer_id=m.lecturer_id) OR actor.lecturer=1 AND m.lecturer_id=(SELECT id FROM lecturers WHERE lower(trim(email))=actor.email LIMIT 1))),
    academic_unread AS (SELECT m.id FROM academic_messages m CROSS JOIN actor WHERE m.sender_id!=? AND NOT EXISTS(SELECT 1 FROM academic_message_reads r WHERE r.message_id=m.id AND r.user_id=?)
      AND EXISTS(SELECT 1 FROM records e WHERE e.campaignStatus!='draft' AND json_extract(e.j,'$.status')='active'
        AND (m.enrollment_id IS NOT NULL AND m.enrollment_id=e.id OR m.enrollment_id IS NULL AND e.campaignId=(SELECT COALESCE(json_extract(c.data,'$.campaignId'),c.semester_id||':internship') FROM academic_classes c WHERE c.id=m.class_id))
        AND EXISTS(SELECT 1 FROM json_each(json_extract(e.j,'$.assignments')) a WHERE json_extract(a.value,'$.lecturerId')=m.lecturer_id AND json_extract(a.value,'$.role')!='reviewer')
        AND (actor.role='student' AND lower(json_extract(e.j,'$.email'))=actor.email OR actor.lecturer=1 AND m.lecturer_id=e.actorLecturerId)))
    SELECT (SELECT count(*) FROM latest WHERE read_at IS NULL) notifications,
      (SELECT count(*) FROM legacy_private)+(SELECT count(*) FROM legacy_group)+(SELECT count(*) FROM academic_unread) chats`,
    args: [user.role,user.email.trim().toLowerCase(),user.role==='lecturer'||user.role==='admin'||user.is_lecturer?1:0,'','',user.id,user.email,user.personal_email||'',user.personal_email||'',user.id,user.id,user.id,user.id,user.id,user.id,user.id,user.id] });
  return { notifications: Number(result.rows[0].notifications), chats: Number(result.rows[0].chats) };
}
