import { db } from '../db';
import { commit, snapshot, type AcademicEvent } from './store';
import { course, currentVersion, now, totalScore } from './domain';
import { event } from './service';
import { sendQueuedNotificationBatch } from '../services/email';

export async function deliverAcademicOutbox() {
  // The unique event id makes retries safe if the process stops between these statements.
  const inserted = await db.execute(`INSERT OR IGNORE INTO notifications(user_id,recipient_email,type,subject,body,status,created_at,academic_event_id,academic_class_id,academic_enrollment_id,academic_campaign_id,academic_audience_class_ids)
    SELECT (SELECT id FROM users WHERE lower(email)=lower(json_extract(o.data,'$.email'))),json_extract(o.data,'$.email'),json_extract(o.data,'$.type'),json_extract(o.data,'$.subject'),json_extract(o.data,'$.body'),CASE WHEN json_extract(o.data,'$.deliveryMode')='website_only' THEN 'website_only' ELSE 'queued' END,datetime('now','+7 hours'),o.id,json_extract(o.data,'$.classId'),json_extract(o.data,'$.enrollmentId'),json_extract(o.data,'$.campaignId'),json_extract(o.data,'$.audienceClassIds')
    FROM academic_outbox o WHERE delivered_at IS NULL
    AND EXISTS(SELECT 1 FROM academic_classes c WHERE c.id=json_extract(o.data,'$.classId') AND json_extract(c.data,'$.status')='active')
    RETURNING id,academic_event_id,status`);
  await db.execute(`UPDATE academic_outbox SET delivered_at=datetime('now'),notification_id=(SELECT id FROM notifications WHERE academic_event_id=academic_outbox.id)
    WHERE delivered_at IS NULL AND EXISTS(SELECT 1 FROM notifications WHERE academic_event_id=academic_outbox.id)`);
  if (inserted.rows.length) {
    const forced = new Set((await db.execute("SELECT id FROM academic_outbox WHERE json_extract(data,'$.forceImmediate')=1")).rows.map(r => String(r.id)));
    const ids = inserted.rows.filter(r => r.status === 'queued' && (process.env.EMAIL_SEND_IMMEDIATE === 'true' || forced.has(String(r.academic_event_id)))).map(r => Number(r.id));
    if (ids.length) await sendQueuedNotificationBatch({ notificationIds: ids, requestedLimit: ids.length, ignoreBatchSize: true });
  }
}
export async function queueAcademicReminders() {
  const s = await snapshot(); const events: AcademicEvent[] = [];
  const today = now().slice(0, 10);
  const near = (at: string) => at && Date.parse(at) > Date.now() && Date.parse(at) - Date.now() <= 72 * 60 * 60_000;
  for (const c of s.classes.filter(c => c.status === 'active' && !c.legacy)) {
    for (const e of s.enrollments.filter(e => e.classId === c.id && e.status === 'active')) {
      if (near(c.settings.submissionCloseAt) && (currentVersion(e).state !== 'submitted' || e.needsRevision)) events.push(event(e, 'course_submission_reminder', `Nhắc nộp báo cáo ${c.code}`, `Bạn cần hoàn tất bộ bài nộp trước ${c.settings.submissionCloseAt} (hiển thị múi giờ theo thời điểm đã cấu hình).`, `${e.id}:${today}:submission-reminder`));
      if (near(c.settings.gradingCloseAt) && totalScore(c, e) == null) {
        for (const a of e.assignments.filter(a => a.role === 'primary' || a.role === 'reviewer')) {
          const pair = e.evaluations[currentVersion(e).id] || {};
          if (course(c).group === 'project' ? pair[a.role === 'primary' ? 'advisor' : 'reviewer'] : e.internshipGrade) continue;
          const l = s.lecturers.find(l => l.id === a.lecturerId);
          if (l?.email) events.push({ ...event(e, 'course_grading_reminder', `Nhắc hoàn thiện điểm ${c.code}`, `Thầy/Cô còn phần ${a.role === 'primary' ? 'GVHD' : 'GVNX'} của sinh viên ${e.name} (${e.studentId}) chưa nộp.`, `${e.id}:${a.role}:${today}:grade-reminder`), email: l.email });
        }
      }
    }
  }
  if (events.length) await commit(s, 0, 'system.reminders', { events });
  await deliverAcademicOutbox();
  return { academicReminders: events.length };
}
