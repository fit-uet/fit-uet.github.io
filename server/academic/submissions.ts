import { randomUUID } from 'node:crypto';
import { MAX_REPORT_BYTES } from '../config';
import { deleteReportObject, saveReportObject, safeFilename } from '../services/storage';
import type { AuthenticatedUser } from '../types';
import type { SubmissionVersion } from '../../src/shared/academic';
import { commit, fail, snapshot } from './store';
import { course, currentVersion, driveUrl, getClass, getEnrollment, hasGrade, now, requireRead, requireRevision, requireWindow, requireWritable } from './domain';
import { enrollmentView, event } from './service';

export async function submitBundle(actor: AuthenticatedUser, enrollmentId: string, input: { expectedRevision: number; slidesUrl?: string; demoUrl?: string; reusePdfVersionId?: string }, file?: { bytes: Buffer; name: string; mime: string }) {
  const s = await snapshot(); const e = getEnrollment(s, enrollmentId); const c = getClass(s, e.classId);
  requireRead(s, c, actor, e); requireWritable(c, e); requireRevision(e.revision, input.expectedRevision); requireWindow(c, 'submission', e);
  if (actor.role !== 'student' || e.email !== actor.email) fail(403, 'OWNER_ONLY', 'Chỉ sinh viên sở hữu được nộp bài.');
  const project = course(c).group === 'project';
  if (e.lockedAt || project && (e.submissionLockedAt || hasGrade(e))) fail(409, 'SUBMISSION_LOCKED', 'Bài đã bắt đầu chấm hoặc điểm đã khóa; cần Khoa mở lại.');
  if (project && !e.topic.trim()) fail(422, 'TOPIC_REQUIRED', 'Cần khai tên đề tài trước khi nộp.');
  const slidesUrl = project ? driveUrl(input.slidesUrl) : '';
  const demoUrl = project ? driveUrl(input.demoUrl) : '';
  let reference: SubmissionVersion | undefined;
  if (!file) reference = e.versions.find(v => v.id === input.reusePdfVersionId && v.objectKey);
  if (!file && !reference) fail(422, 'PDF_REQUIRED', 'Cần chọn file PDF báo cáo.');
  if (file && (!file.name.toLowerCase().endsWith('.pdf') || file.mime !== 'application/pdf' || file.bytes.length < 5 || !file.bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))) fail(422, 'INVALID_PDF', 'File phải là PDF hợp lệ.');
  if (file && file.bytes.length > MAX_REPORT_BYTES) fail(413, 'PDF_TOO_LARGE', 'PDF vượt quá 10 MB. Vui lòng nén lại.');
  const version: SubmissionVersion = {
    id: randomUUID(), number: currentVersion(e).number + 1, title: e.topic,
    objectKey: reference?.objectKey || null, filename: reference?.filename || null,
    size: reference?.size || 0, slidesUrl, demoUrl, state: 'submitted', createdAt: now(), submittedAt: now(),
  };
  let uploadedKey: string | null = null;
  try {
    if (file) {
      uploadedKey = `reports/${c.semesterId}/${c.id}/${e.id}/${version.number}/${version.id}.pdf`;
      await saveReportObject(uploadedKey, file.bytes);
      version.objectKey = uploadedKey; version.filename = safeFilename(file.name); version.size = file.bytes.length;
    }
    e.versions.push(version); e.needsRevision = false; e.reviewComment = ''; e.reopenUntil = null;
    await commit(s, actor.id, 'student.submission.submit', { enrollments: [e], events: [event(e, 'course_submission_received', `Đã nhận bài ${c.code}`, 'Hệ thống đã nhận bộ bài nộp của bạn.', `${e.id}:${version.id}:received`)] });
    return enrollmentView(s, c, e, actor);
  } catch (error) {
    if (uploadedKey) await deleteReportObject(uploadedKey).catch(() => undefined);
    throw error;
  }
}
