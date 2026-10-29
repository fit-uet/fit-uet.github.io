import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Dashboard, StudentFinalReportView } from '../features/student';
import { LecturerGradeView, LecturerHome } from '../features/lecturer';
import { AdminDashboard, AdminPanel, FinalInternshipListAdmin, AdvisorAssignmentAdmin, FinalReportAdmin, GradeAdmin, NotificationAdmin, LecturerRegistry, CompanyRegistry, ApprovedCompanyRegistry, AdminSettings, PlanSettingsAdmin, LecturerGuideSettingsAdmin, RegistrationRulesSettingsAdmin, FAQQuestionsAdmin, FAQSettingsAdmin, StudentRegistry, AdminRegistry } from '../features/admin';
import { CompanyDetail, PlanView, LecturerGuideView, FAQView, ChatView, Profile } from '../features/shared';
import { MyNotifications } from '../shared';
import { canReviewRegistrations, isAdmin, isLecturer, isStudent } from '../auth/access';
import { AcademicHome } from '../features/academic/AcademicHome';
import { ContextRedirect } from '../features/academic/ContextRedirect';
import { CampaignPage } from '../features/academic/CampaignWorkspace';
import { AcademicClassPage } from '../features/academic/CourseWorkspace';
import { UnmappedLegacyInternship } from '../features/academic/UnmappedLegacyInternship';

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
      <Routes>
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
      <Route path="/admin/faq" element={<ContextRedirect token={token} tab="plan" internshipOnly={false} />} />
      <Route path="/admin/faq-questions" element={<ContextRedirect token={token} tab="questions" internshipOnly={false} />} />
      <Route path="/admin/plan" element={<ContextRedirect token={token} tab="plan" internshipOnly={false} />} />
      <Route path="/admin/lecturer-guide" element={<ContextRedirect token={token} tab="plan" internshipOnly={false} />} />
      <Route path="/admin/registration-rules" element={<ContextRedirect token={token} tab="plan" internshipOnly={true} />} />

      <Route path="/reports/final" element={<ContextRedirect token={token} tab="students" internshipOnly={false} />} />
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
      </Routes>
    </div>
  );
}
