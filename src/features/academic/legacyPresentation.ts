export function hasLegacyPanel(user: any, tab: string) {
  if(['plan','chat','questions'].includes(tab))return true;
  if (user.role === 'admin') return ['registrations', 'final-internships', 'assignments', 'reports', 'grades'].includes(tab);
  if (user.role === 'lecturer' || user.is_lecturer) return ['students', 'reports', 'grades'].includes(tab);
  return user.role === 'student' && ['students','reports'].includes(tab);
}
