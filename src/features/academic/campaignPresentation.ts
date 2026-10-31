import type { AcademicClassSummary, CampaignSummary, EnrollmentView, LecturerInfo } from '../../shared/academic';

export type CampaignRecord = EnrollmentView & { classCode: string; courseCode: string };
export type CampaignMeta = { campaign: CampaignSummary; classes: AcademicClassSummary[]; lecturers: LecturerInfo[]; quotas: any[]; stats: Record<string, number> };
export type CampaignRecordPage = { items: CampaignRecord[]; total: number; studentCount: number; page: number; limit: number; totalPages: number;gradingSummary?:{advisorSubmitted:number;reviewerSubmitted:number;completed:number;locked:number} };
export type EnrollmentPanelMode = 'profile' | 'assignments' | 'reports' | 'grades' | 'all';
export const gradeNames: Record<string, string> = { missing: 'Chưa có điểm', partial: 'Chưa đủ phần điểm', complete: 'Đã nộp điểm', locked: 'Đã khóa' };
export const recordPages = ['students', 'assignments', 'reports', 'grades', 'registrations', 'final-internships'];

export function toLetterGrade(score: number | null | undefined): string {
  if (score == null || isNaN(score)) return '';
  if (score >= 9.0) return 'A+';
  if (score >= 8.5) return 'A';
  if (score >= 8.0) return 'B+';
  if (score >= 7.0) return 'B';
  if (score >= 6.5) return 'C+';
  if (score >= 5.5) return 'C';
  if (score >= 5.0) return 'D+';
  if (score >= 4.0) return 'D';
  return 'F';
}

export function campaignModules(admin: boolean, student: boolean, internship: boolean) {
  if (student) return [
    { id: 'students', title: 'Hồ sơ và bài nộp', description: 'Thông tin học phần, đề tài và báo cáo', icon: 'student' },
    ...(internship ? [{ id:'reports',title:'Báo cáo cuối kỳ',description:'Nộp và xem báo cáo thực tập',icon:'reports'}] : []),
    { id: 'plan', title: 'Kế hoạch và hướng dẫn', description: 'Mốc thời gian và quy định học phần', icon: 'plan' },
    { id: 'chat', title: 'Trao đổi', description: 'Trao đổi với giảng viên hướng dẫn', icon: 'chat' },
    { id: 'questions', title: 'Hỏi đáp', description: 'Câu hỏi thường gặp và hỗ trợ từ Khoa', icon: 'questions' },
  ];
  return [
    ...(admin ? [{ id: 'overview', title: 'Tổng quan', description: 'Tiến độ triển khai trong nhóm môn', icon: 'overview' }] : []),
    { id: 'students', title: internship ? (admin ? 'Sinh viên' : 'Sinh viên phụ trách') : 'Danh sách sinh viên', description: admin ? 'Danh sách sinh viên và import danh sách' : 'Hồ sơ được phân công hướng dẫn, nhận xét', icon: 'student' },
    ...(internship && admin ? [
      { id: 'registrations', title: 'Đăng ký', description: 'Nguyện vọng và kết quả tiếp nhận', icon: 'registrations' },
      { id: 'final-internships', title: 'Nơi thực tập', description: 'Danh sách thực tập chính thức', icon: 'company' },
    ] : []),
    ...(admin && internship ? [{ id: 'assignments', title: 'Phân công', description: internship ? 'GVHD chính và đồng hướng dẫn' : 'GVHD, đồng hướng dẫn và GV nhận xét', icon: 'assignments' }] : []),
    ...(internship ? [{ id: 'reports', title: 'Báo cáo', description: internship ? 'Xem PDF và nhận xét báo cáo' : 'PDF, slide và video demo', icon: 'reports' },
    ] : []),
    { id: 'grades', title: internship ? 'Bảng điểm' : 'Chấm điểm', description: internship ? 'Chấm điểm, tổng hợp kết quả' : 'Báo cáo, điểm GVHD 60% và GVNX 40%', icon: 'grades' },
    { id: 'chat', title: 'Trao đổi', description: 'Trao đổi riêng và nhóm hướng dẫn', icon: 'chat' },
    { id: 'plan', title: 'Kế hoạch và hướng dẫn', description: 'Kế hoạch triển khai và hướng dẫn giảng viên', icon: 'plan' },
    { id: 'guide', title: 'Hướng dẫn sử dụng', description: 'Hướng dẫn giảng viên', icon: 'plan' },
    { id: 'questions', title: 'Hỏi đáp', description: 'Câu hỏi thường gặp và hỗ trợ', icon: 'questions' },
    ...(admin ? [
      { id: 'announcements', title: 'Thông báo', description: 'Thông báo theo nhóm hoặc lớp đã chọn', icon: 'announcements' },
      { id: 'plan-editor', title: 'Cài đặt Kế hoạch', description: 'Soạn kế hoạch, import Word và xem trước', icon: 'plan' },
      { id: 'guide-editor', title: 'Cài đặt Hướng dẫn GV', description: 'Soạn hướng dẫn giảng viên', icon: 'plan' },
      { id: 'faq-editor', title: 'Cài đặt FAQ', description: 'FAQ riêng cho sinh viên và giảng viên', icon: 'questions' },
      ...(internship ? [{ id: 'rules-editor', title: 'Cài đặt Quy định thực tập', description: 'Quy định đăng ký', icon: 'plan' }] : []),
      { id: 'settings', title: 'Thiết lập', description: 'Thời hạn, hướng dẫn và trạng thái nhóm môn', icon: 'settings' },
    ] : []),
  ];
}

export function campaignQuery(current: URLSearchParams, patch: Record<string, string>) {
  const next = new URLSearchParams(current);
  if ('tab' in patch && patch.tab !== current.get('tab')) {
    for (const key of ['status', 'page', 'enrollmentId', 'panel']) next.delete(key);
    if (!['reports', 'grades'].includes(patch.tab)) next.delete('advisor');
    if (current.get('view') !== 'lecturer') next.delete('view');
  } else if (['courseCode', 'classId', 'lecturerId', 'status', 'topicStatus', 'advisor', 'q'].some(key => key in patch)) next.delete('page');
  for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
  return next;
}

export const panelForPage = (page: string): EnrollmentPanelMode => ['assignments', 'reports', 'grades'].includes(page) ? page as EnrollmentPanelMode : 'profile';
export const lecturerNames = (e: EnrollmentView, lecturers: LecturerInfo[], role: string) => e.assignments.filter(a => a.role === role).map(a => lecturers.find(l => l.id === a.lecturerId)?.name || 'Giảng viên').join('; ') || 'Chưa phân công';

export const HEADER_ICON_MODULE_IDS = new Set(['chat', 'announcements']);

export function campaignNavigation(modules: ReturnType<typeof campaignModules>, role: string, internship: boolean, wide = true) {
  const available = modules.filter(m => !HEADER_ICON_MODULE_IDS.has(m.id));
  const labels: Record<string, string> = {
    students: role === 'student' ? 'Hồ sơ' : internship ? 'Sinh viên' : 'Danh sách sinh viên',
    reports: 'Báo cáo',
    grades: internship ? 'Bảng điểm' : 'Chấm điểm',
  };
  const primary = (wide ? available : available.slice(0, 2)).map(m => ({
    ...m,
    label: labels[m.id] || m.title,
  }));
  const more = (wide ? [] : available.slice(2)).map(m => ({
    ...m,
    label: labels[m.id] || m.title,
  }));
  return { primary, more };
}

export function campaignSwitchQuery(current: URLSearchParams, modules: ReturnType<typeof campaignModules>, preserveTeaching: boolean) {
  const next = new URLSearchParams();
  const tab = current.get('tab') || '';
  if (modules.some(m => m.id === tab)) next.set('tab', tab);
  if (preserveTeaching && current.get('view') === 'lecturer') next.set('view', 'lecturer');
  return next;
}

export function projectListQuery(current:URLSearchParams){
  const next=new URLSearchParams(current),tab=next.get('tab'),status=next.get('status');
  if(['assignments','reports'].includes(tab||''))next.set('tab','students');
  if(next.get('panel')==='grades')next.set('tab','grades');
  if(status&&tab==='grades')next.set('gradeStatus',status);
  if(status&&tab==='reports'){if(status==='complete')next.set('gradeStatus','complete');else next.set('submissionStatus',status);}
  next.delete('status');return next;
}
