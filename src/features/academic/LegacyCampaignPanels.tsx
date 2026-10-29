import { useSearchParams } from 'react-router-dom';
import { Button } from '../../shared/ui';
import { AdminPanel, AdvisorAssignmentAdmin, FinalInternshipListAdmin, FinalReportAdmin, GradeAdmin, FAQQuestionsAdmin } from '../admin';
import { LecturerHome, LecturerGradeView } from '../lecturer';
import { Dashboard, StudentFinalReportView } from '../student';
import { LegacyListScope } from './LegacyListScope';
import { useParams } from 'react-router-dom';
export function hasLegacyPanel(user: any, tab: string) {
  if (user.role === 'admin') return ['registrations', 'final-internships', 'assignments', 'reports', 'grades'].includes(tab);
  if (user.role === 'lecturer' || user.is_lecturer) return ['students', 'reports', 'grades'].includes(tab);
  return user.role === 'student' && tab === 'students';
}
export function LegacyCampaignPanels({ token, user, tab, courseCode }: { token: string; user: any; tab: string; courseCode: string }) {
  const { campaignId = '' } = useParams();
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
  return content ? <LegacyListScope token={token} campaignId={campaignId}><section key={`${tab}:${courseCode}`} className="space-y-4">{content}</section></LegacyListScope> : null;
}
