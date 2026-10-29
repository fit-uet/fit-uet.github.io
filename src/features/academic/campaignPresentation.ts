import type { AcademicClassSummary, CampaignSummary, EnrollmentView, LecturerInfo } from '../../shared/academic';

export type CampaignRecord = EnrollmentView & { classCode: string; courseCode: string };
export type CampaignMeta = { campaign: CampaignSummary; classes: AcademicClassSummary[]; lecturers: LecturerInfo[]; quotas: any[]; stats: Record<string, number> };
export type CampaignRecordPage = { items: CampaignRecord[]; total: number; studentCount: number; page: number; limit: number; totalPages: number };
export type EnrollmentPanelMode = 'profile' | 'assignments' | 'reports' | 'grades' | 'all';
export const gradeNames: Record<string, string> = { missing: 'Chưa có điểm', partial: 'Chưa đủ phần điểm', complete: 'Đã nộp điểm', locked: 'Đã khóa' };
export const recordPages = ['students', 'assignments', 'reports', 'grades', 'registrations', 'final-internships'];

export function campaignModules(admin: boolean, student: boolean, internship: boolean) {
  if (student) return [
    { id: 'students', title: 'Hồ sơ và bài nộp', description: 'Thông tin học phần, đề tài và báo cáo', icon: 'student' },
    { id: 'plan', title: 'Kế hoạch và hướng dẫn', description: 'Mốc thời gian và quy định học phần', icon: 'plan' },
    { id: 'chat', title: 'Trao đổi', description: 'Trao đổi với giảng viên hướng dẫn', icon: 'chat' },
    { id: 'questions', title: 'Hỏi đáp', description: 'Câu hỏi thường gặp và hỗ trợ từ Khoa', icon: 'questions' },
  ];
  return [
    ...(admin ? [{ id: 'overview', title: 'Tổng quan', description: 'Tiến độ triển khai trong nhóm môn', icon: 'overview' }] : []),
    { id: 'students', title: admin ? 'Sinh viên' : 'Sinh viên phụ trách', description: admin ? 'Danh sách sinh viên và import danh sách' : 'Hồ sơ được phân công hướng dẫn, nhận xét', icon: 'student' },
    ...(internship && admin ? [
      { id: 'registrations', title: 'Đăng ký', description: 'Nguyện vọng và kết quả tiếp nhận', icon: 'registrations' },
      { id: 'final-internships', title: 'Nơi thực tập', description: 'Danh sách thực tập chính thức', icon: 'company' },
    ] : []),
    ...(admin ? [{ id: 'assignments', title: 'Phân công', description: internship ? 'GVHD chính và đồng hướng dẫn' : 'GVHD, đồng hướng dẫn và GV nhận xét', icon: 'assignments' }] : []),
    { id: 'reports', title: 'Báo cáo', description: internship ? 'Xem PDF và nhận xét báo cáo' : 'PDF, slide và video demo', icon: 'reports' },
    { id: 'grades', title: 'Bảng điểm', description: internship ? 'Chấm điểm, tổng hợp kết quả' : 'Điểm GVHD 60% và GVNX 40%', icon: 'grades' },
    { id: 'chat', title: 'Trao đổi', description: 'Trao đổi riêng và nhóm hướng dẫn', icon: 'chat' },
    { id: 'plan', title: 'Kế hoạch và hướng dẫn', description: 'Kế hoạch triển khai và hướng dẫn giảng viên', icon: 'plan' },
    { id: 'questions', title: 'Hỏi đáp', description: 'Câu hỏi thường gặp và hỗ trợ', icon: 'questions' },
    ...(admin ? [
      { id: 'announcements', title: 'Thông báo', description: 'Thông báo theo nhóm hoặc lớp đã chọn', icon: 'announcements' },
      { id: 'settings', title: 'Thiết lập', description: 'Thời hạn, hướng dẫn và trạng thái nhóm môn', icon: 'settings' },
    ] : []),
  ];
}

export function campaignQuery(current: URLSearchParams, patch: Record<string, string>) {
  const next = new URLSearchParams(current);
  if ('tab' in patch && patch.tab !== current.get('tab')) {
    for (const key of ['status', 'page', 'enrollmentId', 'panel']) next.delete(key);
    if (current.get('view') !== 'lecturer') next.delete('view');
  } else if (['courseCode', 'classId', 'lecturerId', 'status', 'q'].some(key => key in patch)) next.delete('page');
  for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
  return next;
}

export const panelForPage = (page: string): EnrollmentPanelMode => ['assignments', 'reports', 'grades'].includes(page) ? page as EnrollmentPanelMode : 'profile';
export const lecturerNames = (e: EnrollmentView, lecturers: LecturerInfo[], role: string) => e.assignments.filter(a => a.role === role).map(a => lecturers.find(l => l.id === a.lecturerId)?.name || 'Giảng viên').join('; ') || 'Chưa phân công';
