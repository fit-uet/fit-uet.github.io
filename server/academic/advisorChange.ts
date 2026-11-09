import type { AuthenticatedUser } from '../types';
import type { AcademicEvent, Snapshot } from './store';
import { commit, fail, snapshot } from './store';
import { course, getClass, getEnrollment, hasGrade, isBachelor, lecturerFor, now, requireRevision, text } from './domain';
import { deliverAcademicOutbox } from './outbox';
import { enrollmentView, event } from './service';
import type { CourseEnrollment } from '../../src/shared/academic';

export async function requestAdvisorChange(
  actor: AuthenticatedUser,
  enrollmentId: string,
  input: { reason: string; targetLecturerId: number; expectedRevision?: number }
) {
  const s = await snapshot();
  const e = getEnrollment(s, enrollmentId);
  const c = getClass(s, e.classId);

  if (c.status !== 'active' || c.legacy || e.status === 'withdrawn') {
    fail(403, 'ENROLLMENT_READ_ONLY', 'Hồ sơ chỉ xem hoặc không hoạt động.');
  }
  if (input?.expectedRevision !== undefined && Number.isInteger(input.expectedRevision)) {
    requireRevision(e.revision, input.expectedRevision);
  }

  const isOwner = Boolean(actor.email && e.email && actor.email.trim().toLowerCase() === e.email.trim().toLowerCase());
  if (actor.role !== 'student' || !isOwner) {
    fail(403, 'PERMISSION_DENIED', 'Chỉ sinh viên sở hữu hồ sơ mới được gửi yêu cầu thay đổi GVHD.');
  }

  if (e.lockedAt || e.submissionLockedAt || hasGrade(e)) {
    fail(409, 'ENROLLMENT_LOCKED', 'Hồ sơ đã có điểm hoặc đã bị khóa, không thể yêu cầu đổi GVHD.');
  }

  const currentAdvisor = e.assignments.find(a => a.role === 'primary');
  if (!currentAdvisor) {
    fail(422, 'NO_CURRENT_ADVISOR', 'Hồ sơ chưa có GVHD chính để yêu cầu thay đổi.');
  }

  if (e.advisorChangeRequest?.status === 'pending') {
    fail(409, 'REQUEST_ALREADY_PENDING', 'Bạn đã có một yêu cầu thay đổi GVHD đang chờ duyệt.');
  }

  const reason = text(input.reason);
  if (!reason || reason.length < 5 || reason.length > 2000) {
    fail(422, 'INVALID_REASON', 'Vui lòng nhập lý do thay đổi từ 5 đến 2.000 ký tự.');
  }

  const targetLecturerId = Number(input.targetLecturerId);
  if (!Number.isInteger(targetLecturerId)) {
    fail(422, 'INVALID_TARGET_LECTURER', 'Vui lòng chọn giảng viên hướng dẫn mới.');
  }
  const targetLecturer = s.lecturers.find(l => l.id === targetLecturerId);
  if (!targetLecturer || !targetLecturer.email) {
    fail(422, 'INVALID_TARGET_LECTURER', 'Giảng viên đề xuất không tồn tại trong hệ thống.');
  }
  if (targetLecturer.id === currentAdvisor.lecturerId) {
    fail(422, 'SAME_LECTURER', 'Giảng viên đề xuất phải khác với GVHD hiện tại.');
  }
  if (isBachelor(targetLecturer)) {
    fail(422, 'BACHELOR_RESTRICTION', 'Giảng viên CN chỉ được đồng hướng dẫn.');
  }
  const reviewer = e.assignments.find(a => a.role === 'reviewer');
  if (reviewer && reviewer.lecturerId === targetLecturer.id) {
    fail(422, 'CONFLICT_REVIEWER', 'Giảng viên đề xuất trùng với GVNX của sinh viên.');
  }

  const reqId = `acr-${e.id}-${Date.now()}`;
  e.advisorChangeRequest = {
    id: reqId,
    status: 'pending',
    currentLecturerId: currentAdvisor.lecturerId,
    targetLecturerId,
    reason,
    createdAt: now(),
  };

  const currentLecturer = s.lecturers.find(l => l.id === currentAdvisor.lecturerId);
  const events: AcademicEvent[] = [];
  if (currentLecturer?.email) {
    events.push({
      ...event(
        e,
        'advisor_change_requested',
        `Yêu cầu đổi GVHD từ sinh viên ${e.name}`,
        `Sinh viên ${e.name} (${e.studentId}) lớp ${c.code} đã gửi yêu cầu xin chuyển GVHD sang Thầy/Cô ${targetLecturer.name}.\nLý do: ${reason}\nThầy/Cô vui lòng vào hệ thống để xem xét và duyệt yêu cầu.`,
        `${reqId}:requested`
      ),
      email: currentLecturer.email,
      forceImmediate: true,
    });
  }

  await commit(s, actor.id, 'student.advisor_change.request', { enrollments: [e], events }, reason);
  await deliverAcademicOutbox();
  return enrollmentView(s, c, e, actor);
}

export async function cancelAdvisorChange(
  actor: AuthenticatedUser,
  enrollmentId: string,
  input?: { expectedRevision?: number }
) {
  const s = await snapshot();
  const e = getEnrollment(s, enrollmentId);
  const c = getClass(s, e.classId);

  if (input?.expectedRevision !== undefined && Number.isInteger(input.expectedRevision)) {
    requireRevision(e.revision, input.expectedRevision);
  }

  const isOwner = Boolean(actor.email && e.email && actor.email.trim().toLowerCase() === e.email.trim().toLowerCase());
  if (actor.role !== 'student' || !isOwner) {
    fail(403, 'PERMISSION_DENIED', 'Chỉ sinh viên sở hữu hồ sơ mới được hủy yêu cầu.');
  }

  if (e.advisorChangeRequest?.status !== 'pending') {
    fail(409, 'NO_PENDING_REQUEST', 'Không có yêu cầu thay đổi GVHD nào đang chờ duyệt.');
  }

  e.advisorChangeRequest.status = 'cancelled';

  await commit(s, actor.id, 'student.advisor_change.cancel', { enrollments: [e] });
  return enrollmentView(s, c, e, actor);
}

export async function reviewAdvisorChange(
  actor: AuthenticatedUser,
  enrollmentId: string,
  input: { status: 'approved' | 'rejected'; reviewComment?: string; expectedRevision?: number }
) {
  const s = await snapshot();
  const e = getEnrollment(s, enrollmentId);
  const c = getClass(s, e.classId);

  if (c.status !== 'active' || c.legacy || e.status === 'withdrawn') {
    fail(403, 'ENROLLMENT_READ_ONLY', 'Hồ sơ chỉ xem hoặc không hoạt động.');
  }
  if (input?.expectedRevision !== undefined && Number.isInteger(input.expectedRevision)) {
    requireRevision(e.revision, input.expectedRevision);
  }

  const req = e.advisorChangeRequest;
  if (!req || req.status !== 'pending') {
    fail(409, 'NO_PENDING_REQUEST', 'Không có yêu cầu thay đổi GVHD nào đang chờ duyệt.');
  }

  const lecturer = lecturerFor(s, actor);
  const isCurrentAdvisor = Boolean(lecturer && lecturer.id === req.currentLecturerId);
  const isAdmin = actor.role === 'admin';
  if (!isCurrentAdvisor && !isAdmin) {
    fail(403, 'PERMISSION_DENIED', 'Chỉ GVHD chính hiện tại hoặc Quản trị viên mới được duyệt yêu cầu.');
  }

  if (!['approved', 'rejected'].includes(input.status)) {
    fail(422, 'INVALID_STATUS', 'Trạng thái duyệt không hợp lệ (chỉ chấp nhận approved hoặc rejected).');
  }

  const reviewComment = text(input.reviewComment) || '';
  const reviewRole = isAdmin ? 'admin' : 'advisor';
  const reviewerName = isAdmin ? (actor.name || 'Quản trị viên') : lecturer!.name;

  req.reviewedAt = now();
  req.reviewedById = actor.id;
  req.reviewedByLecturerId = lecturer?.id || null;
  req.reviewedByName = reviewerName;
  req.reviewRole = reviewRole;
  req.reviewComment = reviewComment;

  const events: AcademicEvent[] = [];

  if (input.status === 'rejected') {
    req.status = 'rejected';
    events.push({
      ...event(
        e,
        'advisor_change_rejected',
        'Yêu cầu thay đổi GVHD không được duyệt',
        `Yêu cầu xin đổi GVHD của bạn trong học phần ${c.code} đã bị từ chối bởi ${reviewerName}.${reviewComment ? `\nLý do phản hồi: ${reviewComment}` : ''}`,
        `${req.id}:rejected`
      ),
      forceImmediate: true,
    });
  } else {
    req.status = 'approved';

    const oldLecturer = s.lecturers.find(l => l.id === req.currentLecturerId);
    const newLecturer = s.lecturers.find(l => l.id === req.targetLecturerId);
    if (!newLecturer) {
      fail(422, 'TARGET_LECTURER_MISSING', 'Không tìm thấy giảng viên mới.');
    }

    // Update assignments: remove old primary, and remove target if already in co-advisor
    e.assignments = e.assignments.filter(
      a => !(a.role === 'primary' && a.lecturerId === req.currentLecturerId) && a.lecturerId !== newLecturer.id
    );
    e.assignments.push({
      id: `assign-${e.id}-${Date.now()}`,
      lecturerId: newLecturer.id,
      role: 'primary',
      assignedAt: now(),
    });

    if (e.advisorRequest) {
      e.advisorRequest.lecturerId = newLecturer.id;
    }

    // Reset approved topic in project to pending
    if (course(c).group === 'project') {
      if (e.topicReview?.status === 'approved') {
        e.topicReview.status = 'pending';
        e.topicSubmissionUntil = null;
        e.topicReview.updatedAt = now();
      }
    }

    // 1. To Student
    events.push({
      ...event(
        e,
        'advisor_change_approved',
        'Yêu cầu thay đổi GVHD đã được duyệt',
        `Yêu cầu xin đổi GVHD của bạn trong học phần ${c.code} đã được duyệt bởi ${reviewerName}.\nGiảng viên hướng dẫn mới: ${newLecturer.name} (${newLecturer.email}).${course(c).group === 'project' && e.topic ? '\nLưu ý: Đề tài của bạn đã được chuyển về trạng thái Chờ duyệt để GVHD mới xem xét lại.' : ''}`,
        `${req.id}:approved:student`
      ),
      forceImmediate: true,
    });

    // 2. To Old Advisor
    if (oldLecturer?.email) {
      events.push({
        ...event(
          e,
          'advisor_change_released',
          `Bàn giao sinh viên hướng dẫn ${e.name}`,
          `Yêu cầu đổi GVHD của sinh viên ${e.name} (${e.studentId}) lớp ${c.code} đã được duyệt hoàn tất bởi ${reviewerName}.\nSinh viên đã được bàn giao sang giảng viên ${newLecturer.name}.`,
          `${req.id}:approved:old`
        ),
        email: oldLecturer.email,
        forceImmediate: true,
      });
    }

    // 3. To New Advisor
    if (newLecturer.email) {
      events.push({
        ...event(
          e,
          'advisor_change_assigned',
          `Phân công hướng dẫn sinh viên ${e.name}`,
          `Thầy/Cô đã được phân công hướng dẫn sinh viên ${e.name} (${e.studentId}) lớp ${c.code}.${e.topic ? `\nĐề tài đăng ký: ${e.topic}` : ''}\nVui lòng đăng nhập hệ thống để xem thông tin và hướng dẫn sinh viên.`,
          `${req.id}:approved:new`
        ),
        email: newLecturer.email,
        forceImmediate: true,
      });
    }
  }

  await commit(s, actor.id, `advisor_change.${input.status}`, { enrollments: [e], events }, reviewComment);
  await deliverAcademicOutbox();
  return enrollmentView(s, c, e, actor);
}

export async function bulkReviewAdvisorChanges(
  actor: AuthenticatedUser,
  campaignId: string,
  input: {
    enrollmentIds: string[];
    status: 'approved' | 'rejected';
    reviewComment?: string;
  }
) {
  const s = await snapshot();
  const isAdmin = actor.role === 'admin';
  const lecturer = lecturerFor(s, actor);
  if (!isAdmin && !lecturer) {
    fail(403, 'PERMISSION_DENIED', 'Chỉ GVHD hoặc Quản trị viên mới được duyệt yêu cầu.');
  }

  const { enrollmentIds, status, reviewComment: rawComment } = input || {};
  if (!Array.isArray(enrollmentIds) || !enrollmentIds.length) {
    fail(422, 'INVALID_ENROLLMENT_IDS', 'Vui lòng chọn ít nhất một hồ sơ để duyệt.');
  }
  if (!['approved', 'rejected'].includes(status)) {
    fail(422, 'INVALID_STATUS', 'Trạng thái duyệt không hợp lệ (approved hoặc rejected).');
  }

  const reviewComment = text(rawComment) || '';
  const reviewRole = isAdmin ? 'admin' : 'advisor';
  const reviewerName = isAdmin ? (actor.name || 'Quản trị viên') : lecturer!.name;

  const modifiedEnrollments: CourseEnrollment[] = [];
  const events: AcademicEvent[] = [];

  for (const enrollmentId of enrollmentIds) {
    const e = s.enrollments.find(item => item.id === enrollmentId);
    if (!e || e.status === 'withdrawn') continue;
    const c = getClass(s, e.classId);
    if (c.campaignId !== campaignId || c.status !== 'active' || c.legacy) continue;

    const req = e.advisorChangeRequest;
    if (!req || req.status !== 'pending') continue;

    const isCurrentAdvisor = Boolean(lecturer && lecturer.id === req.currentLecturerId);
    if (!isAdmin && !isCurrentAdvisor) continue;

    req.reviewedAt = now();
    req.reviewedById = actor.id;
    req.reviewedByLecturerId = lecturer?.id || null;
    req.reviewedByName = reviewerName;
    req.reviewRole = reviewRole;
    req.reviewComment = reviewComment;

    if (status === 'rejected') {
      req.status = 'rejected';
      events.push({
        ...event(
          e,
          'advisor_change_rejected',
          'Yêu cầu thay đổi GVHD không được duyệt',
          `Yêu cầu xin đổi GVHD của bạn trong học phần ${c.code} đã bị từ chối bởi ${reviewerName}.${reviewComment ? `\nLý do: ${reviewComment}` : ''}`,
          `${req.id}:rejected`
        ),
        forceImmediate: true,
      });
    } else {
      req.status = 'approved';
      const oldLecturer = s.lecturers.find(l => l.id === req.currentLecturerId);
      const newLecturer = s.lecturers.find(l => l.id === req.targetLecturerId);
      if (!newLecturer) continue;

      e.assignments = e.assignments.filter(
        a => !(a.role === 'primary' && a.lecturerId === req.currentLecturerId) && a.lecturerId !== newLecturer.id
      );
      e.assignments.push({
        id: `assign-${e.id}-${Date.now()}`,
        lecturerId: newLecturer.id,
        role: 'primary',
        assignedAt: now(),
      });

      if (e.advisorRequest) {
        e.advisorRequest.lecturerId = newLecturer.id;
      }

      if (course(c).group === 'project' && e.topicReview?.status === 'approved') {
        e.topicReview.status = 'pending';
        e.topicSubmissionUntil = null;
        e.topicReview.updatedAt = now();
      }

      events.push({
        ...event(
          e,
          'advisor_change_approved',
          'Yêu cầu thay đổi GVHD đã được duyệt',
          `Yêu cầu xin đổi GVHD của bạn trong học phần ${c.code} đã được duyệt bởi ${reviewerName}.\nGiảng viên hướng dẫn mới: ${newLecturer.name} (${newLecturer.email}).${course(c).group === 'project' && e.topic ? '\nLưu ý: Đề tài của bạn đã được chuyển về trạng thái Chờ duyệt để GVHD mới xem xét lại.' : ''}`,
          `${req.id}:approved:student`
        ),
        forceImmediate: true,
      });

      if (oldLecturer?.email) {
        events.push({
          ...event(
            e,
            'advisor_change_released',
            `Bàn giao sinh viên hướng dẫn ${e.name}`,
            `Yêu cầu đổi GVHD của sinh viên ${e.name} (${e.studentId}) lớp ${c.code} đã được duyệt hoàn tất bởi ${reviewerName}.\nSinh viên đã được bàn giao sang giảng viên ${newLecturer.name}.`,
            `${req.id}:approved:old`
          ),
          email: oldLecturer.email,
          forceImmediate: true,
        });
      }

      if (newLecturer.email) {
        events.push({
          ...event(
            e,
            'advisor_change_assigned',
            `Phân công hướng dẫn sinh viên ${e.name}`,
            `Thầy/Cô đã được phân công hướng dẫn sinh viên ${e.name} (${e.studentId}) lớp ${c.code}.${e.topic ? `\nĐề tài đăng ký: ${e.topic}` : ''}\nVui lòng đăng nhập hệ thống để xem thông tin và hướng dẫn sinh viên.`,
            `${req.id}:approved:new`
          ),
          email: newLecturer.email,
          forceImmediate: true,
        });
      }
    }
    modifiedEnrollments.push(e);
  }

  if (modifiedEnrollments.length > 0) {
    await commit(s, actor.id, `advisor_change.bulk_${status}`, {
      enrollments: modifiedEnrollments,
      events,
    }, reviewComment);
    await deliverAcademicOutbox();
  }

  return { success: true, count: modifiedEnrollments.length };
}

