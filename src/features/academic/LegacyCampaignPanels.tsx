import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../shared/ui';
import { LegacyListScope } from './LegacyListScope';
import { useParams } from 'react-router-dom';
const PlanView=lazy(()=>import('../shared/pages/PlanView').then(module=>({default:module.PlanView})));
const FAQView=lazy(()=>import('../shared/pages/FAQView').then(module=>({default:module.FAQView})));
const ChatView=lazy(()=>import('../shared/pages/ChatView').then(module=>({default:module.ChatView})));
const StudentFinalReportView = lazy(() => import('../student/pages/StudentFinalReportView').then(module => ({ default: module.StudentFinalReportView })));
const Dashboard = lazy(() => import('../student/pages/Dashboard').then(module => ({ default: module.Dashboard })));
const LecturerGradeView = lazy(() => import('../lecturer/pages/LecturerGradeView').then(module => ({ default: module.LecturerGradeView })));
const LecturerHome = lazy(() => import('../lecturer/pages/LecturerHome').then(module => ({ default: module.LecturerHome })));
const FAQQuestionsAdmin = lazy(() => import('../admin/pages/FAQQuestionsAdmin').then(module => ({ default: module.FAQQuestionsAdmin })));
const GradeAdmin = lazy(() => import('../admin/pages/GradeAdmin').then(module => ({ default: module.GradeAdmin })));
const FinalReportAdmin = lazy(() => import('../admin/pages/FinalReportAdmin').then(module => ({ default: module.FinalReportAdmin })));
const FinalInternshipListAdmin = lazy(() => import('../admin/pages/FinalInternshipListAdmin').then(module => ({ default: module.FinalInternshipListAdmin })));
const AdvisorAssignmentAdmin = lazy(() => import('../admin/pages/AdvisorAssignmentAdmin').then(module => ({ default: module.AdvisorAssignmentAdmin })));
const AdminPanel = lazy(() => import('../admin/pages/AdminPanel').then(module => ({ default: module.AdminPanel })));
export { hasLegacyPanel } from './legacyPresentation';





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
  } else if (tab === 'students') content = <Dashboard token={token} user={user} setUser={value => { localStorage.setItem('user', JSON.stringify(value)); window.location.reload(); }} onAuthExpired={() => window.dispatchEvent(new Event('auth-expired'))} />;
  if(user.role==='student'&&tab==='reports')content=<StudentFinalReportView token={token} user={user}/>;
  if(tab==='plan')content=<PlanView user={user}/>;
  if(tab==='questions')content=user.role==='admin'?<FAQQuestionsAdmin token={token}/>:<FAQView token={token} user={user}/>;
  if(tab==='chat')content=<ChatView token={token} user={user}/>;
  return content ? <Suspense fallback={<p role="status">Đang tải chức năng…</p>}><LegacyListScope token={token} campaignId={campaignId}><section key={`${tab}:${courseCode}`} className="space-y-4">{content}</section></LegacyListScope></Suspense> : null;
}
