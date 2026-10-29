import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { MyNotifications } from '../shared/components/MyNotifications';
import { canReviewRegistrations, isAdmin, isLecturer, isStudent } from '../auth/access';
import { ContextRedirect } from '../features/academic/ContextRedirect';
import { AcademicClassPage } from '../features/academic/CourseWorkspace';
const Profile = lazy(() => import('../features/shared/pages/Profile').then(module => ({ default: module.Profile })));
const ChatView = lazy(() => import('../features/shared/pages/ChatView').then(module => ({ default: module.ChatView })));
const FAQView = lazy(() => import('../features/shared/pages/FAQView').then(module => ({ default: module.FAQView })));
const LecturerGuideView = lazy(() => import('../features/shared/pages/LecturerGuideView').then(module => ({ default: module.LecturerGuideView })));
const PlanView = lazy(() => import('../features/shared/pages/PlanView').then(module => ({ default: module.PlanView })));
const CompanyDetail = lazy(() => import('../features/shared/pages/CompanyDetail').then(module => ({ default: module.CompanyDetail })));
const StudentFinalReportView = lazy(() => import('../features/student/pages/StudentFinalReportView').then(module => ({ default: module.StudentFinalReportView })));
const Dashboard = lazy(() => import('../features/student/pages/Dashboard').then(module => ({ default: module.Dashboard })));
const LecturerHome = lazy(() => import('../features/lecturer/pages/LecturerHome').then(module => ({ default: module.LecturerHome })));
const LecturerGradeView = lazy(() => import('../features/lecturer/pages/LecturerGradeView').then(module => ({ default: module.LecturerGradeView })));
const AdminRegistry = lazy(() => import('../features/admin/pages/AdminRegistry').then(module => ({ default: module.AdminRegistry })));
const StudentRegistry = lazy(() => import('../features/admin/pages/StudentRegistry').then(module => ({ default: module.StudentRegistry })));
const FAQSettingsAdmin = lazy(() => import('../features/admin/pages/FAQSettingsAdmin').then(module => ({ default: module.FAQSettingsAdmin })));
const FAQQuestionsAdmin = lazy(() => import('../features/admin/pages/FAQQuestionsAdmin').then(module => ({ default: module.FAQQuestionsAdmin })));
const RegistrationRulesSettingsAdmin = lazy(() => import('../features/admin/pages/RegistrationRulesSettingsAdmin').then(module => ({ default: module.RegistrationRulesSettingsAdmin })));
const LecturerGuideSettingsAdmin = lazy(() => import('../features/admin/pages/LecturerGuideSettingsAdmin').then(module => ({ default: module.LecturerGuideSettingsAdmin })));
const PlanSettingsAdmin = lazy(() => import('../features/admin/pages/PlanSettingsAdmin').then(module => ({ default: module.PlanSettingsAdmin })));
const AdminSettings = lazy(() => import('../features/admin/pages/AdminSettings').then(module => ({ default: module.AdminSettings })));
const ApprovedCompanyRegistry = lazy(() => import('../features/admin/pages/ApprovedCompanyRegistry').then(module => ({ default: module.ApprovedCompanyRegistry })));
const CompanyRegistry = lazy(() => import('../features/admin/pages/CompanyRegistry').then(module => ({ default: module.CompanyRegistry })));
const LecturerRegistry = lazy(() => import('../features/admin/pages/LecturerRegistry').then(module => ({ default: module.LecturerRegistry })));
const NotificationAdmin = lazy(() => import('../features/admin/pages/NotificationAdmin').then(module => ({ default: module.NotificationAdmin })));
const GradeAdmin = lazy(() => import('../features/admin/pages/GradeAdmin').then(module => ({ default: module.GradeAdmin })));
const FinalReportAdmin = lazy(() => import('../features/admin/pages/FinalReportAdmin').then(module => ({ default: module.FinalReportAdmin })));
const AdvisorAssignmentAdmin = lazy(() => import('../features/admin/pages/AdvisorAssignmentAdmin').then(module => ({ default: module.AdvisorAssignmentAdmin })));
const FinalInternshipListAdmin = lazy(() => import('../features/admin/pages/FinalInternshipListAdmin').then(module => ({ default: module.FinalInternshipListAdmin })));
const AdminPanel = lazy(() => import('../features/admin/pages/AdminPanel').then(module => ({ default: module.AdminPanel })));
const AdminDashboard = lazy(() => import('../features/admin/pages/AdminDashboard').then(module => ({ default: module.AdminDashboard })));





const AcademicHome = lazy(() => import('../features/academic/AcademicHome').then(module => ({ default: module.AcademicHome })));

const CampaignPage = lazy(() => import('../features/academic/CampaignWorkspace').then(module => ({ default: module.CampaignPage })));

const UnmappedLegacyInternship = lazy(() => import('../features/academic/UnmappedLegacyInternship').then(module => ({ default: module.UnmappedLegacyInternship })));

type AppRoutesProps = {
  user: any;
  setUser: (user: any) => void;
  token: string;
  onAuthExpired: () => void;
  onUnreadNotificationsChanged: (count: number) => void;
  onUnreadChatsChanged: (count: number) => void;
};

function GuardedRoute({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? children : <Navigate to="/" replace />;
}

export function AppRoutes({
  user,
  setUser,
  token,
  onAuthExpired,
  onUnreadNotificationsChanged,
  onUnreadChatsChanged,
}: AppRoutesProps) {
  const roleClass = isAdmin(user) ? 'admin' : isLecturer(user) ? 'lecturer' : 'student';
  const home = user?.role === 'lecturer'
    ? <LecturerHome user={user} token={token} />
    : isAdmin(user)
      ? <AdminDashboard token={token} user={user} />
      : <Dashboard user={user} setUser={setUser} token={token} onAuthExpired={onAuthExpired} />;

  const lecturerOnly = (page: ReactNode) => <GuardedRoute allowed={isLecturer(user)}>{page}</GuardedRoute>;
  const adminOnly = (page: ReactNode) => <GuardedRoute allowed={isAdmin(user)}>{page}</GuardedRoute>;
  const studentOnly = (page: ReactNode) => <GuardedRoute allowed={isStudent(user)}>{page}</GuardedRoute>;
  const chatAllowed = isStudent(user) || isLecturer(user);

  return (
    <div className={`feature-page feature-page--${roleClass}`}>
      <Suspense fallback={<p role="status">Đang tải chức năng…</p>}><Routes>
      <Route path="/" element={<AcademicHome token={token} user={user} />} />
      <Route path="/classes" element={<AcademicHome token={token} user={user} />} />
      <Route path="/campaigns/:campaignId" element={<CampaignPage token={token} user={user} />} />
      <Route path="/classes/:classId" element={<AcademicClassPage token={token} user={user} />} />
      <Route path="/internship" element={<ContextRedirect token={token} tab="students" internshipOnly={true} />} />
      <Route path="/internship/legacy" element={<GuardedRoute allowed={isStudent(user) && user.legacy_internship_access !== 0}><UnmappedLegacyInternship token={token} user={user} setUser={setUser} onAuthExpired={onAuthExpired} onUnreadChanged={onUnreadChatsChanged} /></GuardedRoute>} />
      <Route path="/lecturer" element={<ContextRedirect token={token} tab="students" internshipOnly={false} view={isAdmin(user) && isLecturer(user) ? 'lecturer' : undefined} />} />
      <Route path="/lecturer/grades" element={<ContextRedirect token={token} tab="grades" internshipOnly={false} view={isAdmin(user) && isLecturer(user) ? 'lecturer' : undefined} />} />

      <Route path="/admin" element={<ContextRedirect token={token} tab="overview" internshipOnly={false} />} />
      <Route path="/admin/registrations" element={<ContextRedirect token={token} tab="registrations" internshipOnly={true} />} />
      <Route path="/admin/final-internships" element={<ContextRedirect token={token} tab="final-internships" internshipOnly={true} />} />
      <Route path="/admin/students" element={adminOnly(<StudentRegistry token={token} />)} />
      <Route path="/admin/lecturers" element={adminOnly(<LecturerRegistry token={token} />)} />
      <Route path="/admin/advisors" element={<ContextRedirect token={token} tab="assignments" internshipOnly={false} />} />
      <Route path="/admin/advisors/requests" element={<ContextRedirect token={token} tab="assignments" view="requests" internshipOnly={true} />} />
      <Route path="/admin/advisors/quotas" element={<ContextRedirect token={token} tab="assignments" view="quotas" internshipOnly={true} />} />
      <Route path="/admin/reports" element={<ContextRedirect token={token} tab="reports" internshipOnly={false} />} />
      <Route path="/admin/grades" element={<ContextRedirect token={token} tab="grades" internshipOnly={false} />} />
      <Route path="/admin/notifications" element={<ContextRedirect token={token} tab="announcements" internshipOnly={false} />} />
      <Route path="/admin/companies" element={adminOnly(<CompanyRegistry token={token} />)} />
      <Route path="/admin/approved-companies" element={adminOnly(<ApprovedCompanyRegistry token={token} />)} />
      <Route path="/admin/admins" element={adminOnly(<AdminRegistry token={token} />)} />
      <Route path="/admin/settings" element={<ContextRedirect token={token} tab="settings" internshipOnly={false} />} />
      <Route path="/admin/faq" element={<ContextRedirect token={token} tab="faq-editor" internshipOnly={false} />} />
      <Route path="/admin/faq-questions" element={<ContextRedirect token={token} tab="questions" internshipOnly={false} />} />
      <Route path="/admin/plan" element={<ContextRedirect token={token} tab="plan-editor" internshipOnly={false} />} />
      <Route path="/admin/lecturer-guide" element={<ContextRedirect token={token} tab="guide-editor" internshipOnly={false} />} />
      <Route path="/admin/registration-rules" element={<ContextRedirect token={token} tab="rules-editor" internshipOnly={true} />} />

      <Route path="/reports/final" element={<ContextRedirect token={token} tab="reports" internshipOnly={false} />} />
      <Route path="/company/:id" element={<CompanyDetail user={user} token={token} />} />
      <Route path="/plan" element={<ContextRedirect token={token} tab="plan" internshipOnly={false} />} />
      <Route path="/lecturer-guide" element={<ContextRedirect token={token} tab="plan" internshipOnly={false} />} />
      <Route path="/faq" element={<ContextRedirect token={token} tab="questions" internshipOnly={false} />} />
      <Route path="/system/settings" element={adminOnly(<AdminSettings token={token} />)} />
      <Route path="/system/notifications" element={adminOnly(<NotificationAdmin token={token} />)} />
      <Route path="/profile" element={<Profile user={user} setUser={setUser} token={token} />} />
      <Route path="/chat" element={<GuardedRoute allowed={chatAllowed}><ContextRedirect token={token} tab="chat" /></GuardedRoute>} />
      <Route path="/chat/group/:groupLecturerId" element={<GuardedRoute allowed={chatAllowed}><ContextRedirect token={token} tab="chat" internshipOnly /></GuardedRoute>} />
      <Route path="/chat/:studentUserId/:lecturerId" element={<GuardedRoute allowed={chatAllowed}><ContextRedirect token={token} tab="chat" internshipOnly /></GuardedRoute>} />
      <Route path="/notifications" element={<MyNotifications token={token} user={user} onChanged={onUnreadNotificationsChanged} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
    </div>
  );
}
