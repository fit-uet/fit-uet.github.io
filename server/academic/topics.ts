import type { AcademicClass, CourseEnrollment, TopicPermissions } from '../../src/shared/academic';
import type { AuthenticatedUser } from '../types';
import { course, currentVersion, hasGrade, hasTopicSubmissionExtension, inWindow, lecturerFor, now, requireWindow, text } from './domain';
import { fail, type Snapshot } from './store';
import { emptyTopicReview } from './topicMigration';

export function isPrimaryAdvisor(s: Snapshot, e: CourseEnrollment, actor: AuthenticatedUser) {
  const lecturer = lecturerFor(s, actor);
  return !!lecturer && e.assignments.some(a => a.role === 'primary' && a.lecturerId === lecturer.id);
}
export const advisorTopicWindow = (c: AcademicClass) => inWindow(c.settings.topicOpenAt, c.settings.gradingCloseAt);
export const topicSubmissionCurrent = (e: CourseEnrollment) => e.topicReview?.status === 'approved' && currentVersion(e).topicVersion === e.topicReview.version;
export const topicNeedsResubmission = (e: CourseEnrollment) => e.versions.some(v => v.state === 'submitted') && currentVersion(e).topicVersion !== e.topicReview?.version;
export function changeTopic(e: CourseEnrollment, title: string) {
  if (title === e.topic) return false;
  const version = (e.topicReview?.version || 0) + 1;
  e.topic = title;
  e.topicReview = { ...emptyTopicReview(), version, status: 'pending' };
  e.topicSubmissionUntil = null;
  return true;
}
export function approveTopic(s: Snapshot, c: AcademicClass, e: CourseEnrollment, actor: AuthenticatedUser) {
  if (!isPrimaryAdvisor(s, e, actor)) fail(403, 'TOPIC_APPROVAL_DENIED', 'Chỉ GVHD chính đang được phân công được duyệt đề tài.');
  if (!advisorTopicWindow(c)) fail(403, 'OUTSIDE_WINDOW', 'Duyệt/sửa đề tài từ khi mở khai đề tài đến hết hạn chấm.');
  if (!e.topic.trim()) fail(422, 'TOPIC_REQUIRED', 'Sinh viên chưa khai đề tài.');
  if (e.topicReview?.status === 'approved') return;
  const lecturer = lecturerFor(s, actor)!;
  e.topicReview = { ...(e.topicReview || emptyTopicReview()), status: 'approved', source: 'advisor', approvedById: actor.id, approvedByLecturerId: lecturer.id, approvedByName: lecturer.name, approvedAssignmentId: e.assignments.find(a => a.role === 'primary' && a.lecturerId === lecturer.id)!.id, approvedAt: now(), updatedAt: now() };
  const close = Date.parse(c.settings.submissionCloseAt), gradingClose = Date.parse(c.settings.gradingCloseAt);
  if (Number.isFinite(close) && Date.now() > close && Number.isFinite(gradingClose) && Date.now() <= gradingClose) e.topicSubmissionUntil = c.settings.gradingCloseAt;
}
export function editTopic(s: Snapshot, c: AcademicClass, e: CourseEnrollment, actor: AuthenticatedUser, input: any, approveOnly = false) {
  if (course(c).group !== 'project') fail(422, 'WRONG_COURSE', 'Đề tài thuộc học phần Dự án.');
  if (hasGrade(e) || e.lockedAt || e.submissionLockedAt) fail(409, 'SUBMISSION_LOCKED', 'Đã bắt đầu chấm; cần Khoa mở lại bài.');
  if (approveOnly) { approveTopic(s, c, e, actor); return; }
  const primary = isPrimaryAdvisor(s, e, actor);
  const owner = actor.role === 'student' && actor.email === e.email;
  if (!owner && !primary && actor.role !== 'admin') fail(403, 'TOPIC_EDIT_DENIED', 'Chỉ sinh viên, GVHD chính hoặc Khoa được chỉnh đề tài.');
  if (primary) {
    if (!advisorTopicWindow(c)) fail(403, 'OUTSIDE_WINDOW', 'Sửa đề tài từ khi mở khai đề tài đến hết hạn chấm.');
  } else requireWindow(c, 'topic', e);
  if (actor.role === 'admin' && !primary && !text(input.reason)) fail(422, 'REASON_REQUIRED', 'Khoa cần ghi lý do chỉnh đề tài.');
  const title = text(input.title);
  if (!title || title.length > 1500) fail(422, 'INVALID_TOPIC', 'Tên đề tài cần từ 1 đến 1.500 ký tự.');
  changeTopic(e, title);
  if (primary) approveTopic(s, c, e, actor);
}
export function topicPermissions(s: Snapshot, c: AcademicClass, e: CourseEnrollment, actor: AuthenticatedUser): TopicPermissions | undefined {
  if (course(c).group !== 'project') return undefined;
  const writable = !c.legacy && c.status === 'active' && e.status !== 'withdrawn';
  const unlocked = !e.lockedAt && !e.submissionLockedAt && !hasGrade(e);
  const primary = isPrimaryAdvisor(s, e, actor);
  const owner = actor.role === 'student' && actor.email === e.email;
  const studentWindow = inWindow(c.settings.topicOpenAt, c.settings.topicCloseAt) || !!e.reopenUntil && Date.now() <= Date.parse(e.reopenUntil);
  const submissionWindow = inWindow(c.settings.submissionOpenAt, c.settings.submissionCloseAt) || !!e.reopenUntil && Date.now() <= Date.parse(e.reopenUntil) || hasTopicSubmissionExtension(c, e);
  const reason = !writable ? 'Hồ sơ hiện chỉ xem.' : !unlocked ? 'Bài đã bắt đầu chấm hoặc điểm đã khóa; cần Khoa mở lại.' : e.topicReview?.status !== 'approved' ? !e.topic.trim() ? 'Cần gửi đề tài và được GVHD chính duyệt trước khi nộp bài.' : 'Đề tài đang Pending; cần GVHD chính duyệt trước khi nộp bài.' : !submissionWindow ? 'Chưa đến thời gian nộp hoặc đã hết hạn nộp bài.' : '';
  return { canEdit: writable && unlocked && (primary ? advisorTopicWindow(c) : (owner || actor.role === 'admin') && studentWindow), canApprove: writable && unlocked && primary && advisorTopicWindow(c) && !!e.topic.trim() && e.topicReview?.status === 'pending', canSubmit: owner && !reason, submissionBlockReason: reason, requiresResubmission: topicNeedsResubmission(e), canGradeSubmitted: e.topicReview?.status === 'approved' && currentVersion(e).state === 'submitted' && topicSubmissionCurrent(e) };
}
