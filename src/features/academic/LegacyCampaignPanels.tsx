import { useSearchParams } from 'react-router-dom';
import { Button } from '../../shared/ui';
import { AdminPanel, AdvisorAssignmentAdmin, FinalInternshipListAdmin, FinalReportAdmin, GradeAdmin, FAQQuestionsAdmin } from '../admin';
import { LecturerHome, LecturerGradeView } from '../lecturer';
import { Dashboard, StudentFinalReportView } from '../student';
export function LegacyCampaignPanels({ token, user, tab, courseCode }: { token: string; user: any; tab: string; courseCode: string }) {
  const [query, setQuery] = useSearchParams(); const view = ['requests', 'quotas'].includes(query.get('view') || '') ? query.get('view') as 'requests' | 'quotas' : 'assignments';
  const props = { token, initialCourseCode: courseCode };
  let content = null;
  if (user.role === 'admin') {
    if (tab === 'registrations') content = <AdminPanel {...props} user={user} />;
    if (tab === 'final-internships') content = <FinalInternshipListAdmin {...props} />;
    if (tab === 'assignments') content = <><div className="flex flex-wrap gap-2">{[['assignments', 'Danh sách phân công'], ['requests', 'Đề xuất GVHD'], ['quotas', 'Quota GVHD']].map(([key, label]) => <Button key={key} variant={key === view ? 'primary' : undefined} onClick={() => setQuery(old => { const next = new URLSearchParams(old); next.set('view', key); return next; })}>{label}</Button>)}</div><AdvisorAssignmentAdmin key={view} {...props} view={view} /></>;
    if (tab === 'reports') content = <FinalReportAdmin {...props} />;
    if (tab === 'grades') content = <GradeAdmin {...props} />;
  } else if (user.role === 'lecturer' || user.is_lecturer) {
    if (['students', 'assignments', 'reports'].includes(tab)) content = <LecturerHome {...props} user={user} />;
    if (tab === 'grades') content = <LecturerGradeView {...props} user={user} />;
  } else if (tab === 'students') content = <><Dashboard token={token} user={user} setUser={value => { localStorage.setItem('user', JSON.stringify(value)); window.location.reload(); }} onAuthExpired={() => window.dispatchEvent(new Event('auth-expired'))} /><StudentFinalReportView token={token} user={user} /></>;
  return content ? <section key={`${tab}:${courseCode}`} className="space-y-4 border-t pt-5"><p className="text-sm text-slate-500">Nghiệp vụ Thực tập Hè 2025–2026 · Dùng dữ liệu và lịch sử gốc{courseCode ? ` · ${courseCode}` : ''}</p>{content}</section> : null;
}
