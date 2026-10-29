import { normalized } from './domain';
import { snapshot, type Snapshot } from './store';

export function academicRecipientAllowed(s: Snapshot, row: any, sending = false) {
  if (!row.academic_class_id) return true;
  const c = s.classes.find(c => c.id === row.academic_class_id);
  if (!c || c.status === 'draft' || sending && c.status !== 'active') return false;
  const email = normalized(row.recipient_email);
  const lecturer = s.lecturers.find(l => normalized(l.email) === email);
  let audience = [c.id];
  if (row.type === 'course_announcement' && row.academic_campaign_id) {
    const ids = typeof row.academic_audience_class_ids === 'string' ? JSON.parse(row.academic_audience_class_ids) : [];
    audience = s.classes.filter(x => x.campaignId === row.academic_campaign_id && (!ids.length || ids.includes(x.id))).map(x => x.id);
  }
  const enrollments = s.enrollments.filter(e => audience.includes(e.classId) && e.status === 'active' && (row.type === 'course_announcement' || !row.academic_enrollment_id || e.id === row.academic_enrollment_id));
  return enrollments.some(e => normalized(e.email) === email || lecturer && e.assignments.some(a => a.lecturerId === lecturer.id));
}
export async function visibleAcademicNotifications(rows: any[], email: string) {
  if (!rows.some(r => r.academic_class_id)) return rows;
  const s = await snapshot();
  return rows.filter(r => !r.academic_class_id || normalized(r.recipient_email) === normalized(email) && academicRecipientAllowed(s, r));
}
export async function allowedAcademicQueue(rows: any[]) {
  if (!rows.some(r => r.academic_class_id)) return new Set(rows.map(r => Number(r.id)));
  const s = await snapshot(); return new Set(rows.filter(r => academicRecipientAllowed(s, r, true)).map(r => Number(r.id)));
}
