export type CourseGroup = 'internship' | 'project';
export type ClassStatus = 'draft' | 'active' | 'archived';
export type AssignmentRole = 'primary' | 'co' | 'reviewer';
export type Term = '1' | '2' | 'summer';

export const COURSE_CATALOG = [
  { code: 'INT4002', name: 'Thực tập Doanh nghiệp', group: 'internship' as CourseGroup },
  { code: 'INT3508', name: 'Thực tập Chuyên ngành', group: 'internship' as CourseGroup },
  { code: 'INT4003', name: 'Thực tập Doanh nghiệp Nhật Bản', group: 'internship' as CourseGroup },
  { code: 'INT3132', name: 'Dự án công nghệ', group: 'project' as CourseGroup },
  { code: 'INT3131', name: 'Dự án khoa học', group: 'project' as CourseGroup },
];
export const TERM_NAMES: Record<Term, string> = { '1': 'Học kỳ I', '2': 'Học kỳ II', summer: 'Học kỳ Hè' };

export interface AcademicSemester { id: string; year: number; term: Term; name: string }
// Keep stable group codes and the specific course names in COURSE_CATALOG.
export const GROUP_NAMES: Record<CourseGroup, string> = { internship: 'Thực tập', project: 'Thực hành nghiên cứu' };
export const campaignKey = (semesterId: string, group: CourseGroup) => `${semesterId}:${group}`;
export interface CourseCampaign {
  id: string; semesterId: string; group: CourseGroup; status: ClassStatus;
  settings: ClassSettings; revision: number; legacy: boolean; pendingMigration?: boolean;
}
export interface CampaignSummary extends CourseCampaign {
  semesterName: string; name: string; classCount: number; enrollmentCount: number; studentCount: number;
}
export interface ClassSettings {
  topicOpenAt: string; topicCloseAt: string;
  submissionOpenAt: string; submissionCloseAt: string;
  gradingOpenAt: string; gradingCloseAt: string;
  registrationOpenAt: string; registrationCloseAt: string;
  confirmationOpenAt: string; confirmationCloseAt: string;
  advisorRequestOpenAt: string; advisorRequestCloseAt: string;
  plan: string; lecturerGuide: string; studentFaq: string; lecturerFaq: string;
  registrationRules: string;
  allowedCohorts: string; notifyOnCompletion: boolean;
  publishGradesToStudents: boolean;
}
export const EMPTY_CLASS_SETTINGS: ClassSettings = {
  topicOpenAt: '', topicCloseAt: '', submissionOpenAt: '', submissionCloseAt: '',
  gradingOpenAt: '', gradingCloseAt: '', registrationOpenAt: '', registrationCloseAt: '',
  confirmationOpenAt: '', confirmationCloseAt: '', advisorRequestOpenAt: '', advisorRequestCloseAt: '', plan: '', lecturerGuide: '',
  studentFaq: '', lecturerFaq: '', registrationRules: '', allowedCohorts: 'K66,K67,K68', notifyOnCompletion: true,
  publishGradesToStudents: false,
};
export interface AcademicClass {
  campaignId: string;
  id: string; semesterId: string; courseCode: string; section: string; code: string;
  status: ClassStatus; legacy: boolean; settings: ClassSettings; revision: number;
}
export interface CourseAssignment { id: string; lecturerId: number; role: AssignmentRole; assignedAt: string }
export type TopicStatus = 'unregistered' | 'pending' | 'approved';
export const TOPIC_STATUS_NAMES: Record<TopicStatus, string> = { unregistered: 'Chưa đăng ký', pending: 'Pending · Chờ GVHD duyệt', approved: 'Đã duyệt' };
export interface TopicReview {
  status: TopicStatus; version: number; updatedAt: string;
  source: 'legacy' | 'advisor' | null;
  approvedById: number | null; approvedByLecturerId: number | null;
  approvedByName: string | null; approvedAssignmentId: string | null; approvedAt: string | null;
}
export interface TopicPermissions {
  canEdit: boolean; canApprove: boolean; canSubmit: boolean;
  submissionBlockReason: string; requiresResubmission: boolean; canGradeSubmitted: boolean;
}
export interface SubmissionVersion {
  id: string; number: number; title: string; objectKey: string | null;
  filename: string | null; size: number; slidesUrl: string; demoUrl: string;
  state: 'empty' | 'editing' | 'submitted'; createdAt: string; submittedAt: string | null;
  topicVersion?: number;
}
export interface CourseEvaluation {
  score: number; comment: string; lecturerId: number; assignmentId: string;
  submittedAt: string; updatedAt: string;
}
export interface InternshipGrade {
  progress: number; report: number; company: number; comment: string;
  lecturerId: number; assignmentId: string; submittedAt: string; updatedAt: string;
}
export interface InternshipPreference {
  id: string; companyId: number; companyName: string; note: string;
  status: 'pending' | 'approved' | 'rejected'; reviewComment: string;
}
export interface CourseEnrollment {
  id: string; classId: string; studentId: string; email: string; name: string;
  dob: string; className: string; note: string; status?: 'active' | 'withdrawn'; legacy: boolean;
  topic: string; assignments: CourseAssignment[]; versions: SubmissionVersion[];
  topicReview?: TopicReview; topicSubmissionUntil?: string | null;
  evaluations: Record<string, Partial<Record<'advisor' | 'reviewer', CourseEvaluation>>>;
  internshipGrade: InternshipGrade | null;
  lockedAt: string | null; submissionLockedAt: string | null; reopenUntil: string | null;
  reviewComment: string; needsRevision: boolean;
  preferences: InternshipPreference[];
  finalInternship: { preferenceId: string; companyName: string; type: 'company' | 'school'; confirmedAt: string; locked: boolean } | null;
  advisorRequest: { lecturerId: number; coLecturerId: number | null; note: string; status: 'pending' | 'approved' | 'rejected' } | null;
  revision: number;
}
export interface LecturerInfo { id: number; name: string; email: string; work_unit: string }
export interface AcademicClassSummary extends AcademicClass {
  semesterName: string; courseName: string; group: CourseGroup; enrollmentCount: number;
  canJoin: boolean; canManage: boolean;
}
export interface EnrollmentView extends Omit<CourseEnrollment, 'evaluations' | 'internshipGrade'> {
  evaluations?: CourseEnrollment['evaluations']; internshipGrade?: InternshipGrade | null;
  finalScore?: number | null; canSeeGrades: boolean;
  myAssignment: AssignmentRole[]; gradeStatus: string;
  topicPermissions?: TopicPermissions;
}
