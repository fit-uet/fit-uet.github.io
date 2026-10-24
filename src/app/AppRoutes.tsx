import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Dashboard, StudentFinalReportView } from '../features/student';
import { LecturerGradeView, LecturerHome } from '../features/lecturer';
import { AdminDashboard, AdminPanel, FinalInternshipListAdmin, AdvisorAssignmentAdmin, FinalReportAdmin, GradeAdmin, NotificationAdmin, LecturerRegistry, CompanyRegistry, ApprovedCompanyRegistry, AdminSettings, PlanSettingsAdmin, LecturerGuideSettingsAdmin, RegistrationRulesSettingsAdmin, FAQQuestionsAdmin, FAQSettingsAdmin, StudentRegistry, AdminRegistry } from '../features/admin';
import { CompanyDetail, PlanView, LecturerGuideView, FAQView, ChatView, Profile } from '../features/shared';
import { MyNotifications } from '../shared';
import { canReviewRegistrations, isAdmin, isLecturer, isStudent } from '../auth/access';

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
      <Route path="/" element={home} />
      <Route path="/lecturer" element={lecturerOnly(<LecturerHome user={user} token={token} />)} />
      <Route path="/lecturer/grades" element={lecturerOnly(<LecturerGradeView token={token} user={user} />)} />

      <Route path="/admin" element={adminOnly(<AdminDashboard token={token} user={user} />)} />
      <Route path="/admin/registrations" element={<GuardedRoute allowed={canReviewRegistrations(user)}><AdminPanel token={token} user={user} /></GuardedRoute>} />
      <Route path="/admin/final-internships" element={adminOnly(<FinalInternshipListAdmin token={token} />)} />
      <Route path="/admin/students" element={adminOnly(<StudentRegistry token={token} />)} />
      <Route path="/admin/lecturers" element={adminOnly(<LecturerRegistry token={token} />)} />
      <Route path="/admin/advisors" element={adminOnly(<AdvisorAssignmentAdmin token={token} view="assignments" />)} />
      <Route path="/admin/advisors/requests" element={adminOnly(<AdvisorAssignmentAdmin token={token} view="requests" />)} />
      <Route path="/admin/advisors/quotas" element={adminOnly(<AdvisorAssignmentAdmin token={token} view="quotas" />)} />
      <Route path="/admin/reports" element={adminOnly(<FinalReportAdmin token={token} />)} />
      <Route path="/admin/grades" element={adminOnly(<GradeAdmin token={token} />)} />
      <Route path="/admin/notifications" element={adminOnly(<NotificationAdmin token={token} />)} />
      <Route path="/admin/companies" element={adminOnly(<CompanyRegistry token={token} />)} />
      <Route path="/admin/approved-companies" element={adminOnly(<ApprovedCompanyRegistry token={token} />)} />
      <Route path="/admin/admins" element={adminOnly(<AdminRegistry token={token} />)} />
      <Route path="/admin/settings" element={adminOnly(<AdminSettings token={token} />)} />
      <Route path="/admin/faq" element={adminOnly(<FAQSettingsAdmin token={token} />)} />
      <Route path="/admin/faq-questions" element={adminOnly(<FAQQuestionsAdmin token={token} />)} />
      <Route path="/admin/plan" element={adminOnly(<PlanSettingsAdmin token={token} />)} />
      <Route path="/admin/lecturer-guide" element={adminOnly(<LecturerGuideSettingsAdmin token={token} />)} />
      <Route path="/admin/registration-rules" element={adminOnly(<RegistrationRulesSettingsAdmin token={token} />)} />

      <Route path="/reports/final" element={studentOnly(<StudentFinalReportView token={token} user={user} />)} />
      <Route path="/company/:id" element={<CompanyDetail user={user} token={token} />} />
      <Route path="/plan" element={<PlanView user={user} />} />
      <Route path="/lecturer-guide" element={lecturerOnly(<LecturerGuideView token={token} user={user} />)} />
      <Route path="/faq" element={<FAQView user={user} token={token} />} />
      <Route path="/profile" element={<Profile user={user} setUser={setUser} token={token} />} />
      <Route path="/chat" element={<GuardedRoute allowed={chatAllowed}><ChatView token={token} user={user} onUnreadChanged={onUnreadChatsChanged} /></GuardedRoute>} />
      <Route path="/chat/group/:groupLecturerId" element={<GuardedRoute allowed={chatAllowed}><ChatView token={token} user={user} onUnreadChanged={onUnreadChatsChanged} /></GuardedRoute>} />
      <Route path="/chat/:studentUserId/:lecturerId" element={<GuardedRoute allowed={chatAllowed}><ChatView token={token} user={user} onUnreadChanged={onUnreadChatsChanged} /></GuardedRoute>} />
      <Route path="/notifications" element={<MyNotifications token={token} user={user} onChanged={onUnreadNotificationsChanged} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
