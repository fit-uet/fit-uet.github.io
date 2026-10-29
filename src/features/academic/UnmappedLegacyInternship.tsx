import { Link, useSearchParams } from 'react-router-dom';
import { Dashboard, StudentFinalReportView } from '../student';
import { ChatView, FAQView, PlanView } from '../shared';

// This page uses the existing authorized internship APIs. It does not fabricate
// a course enrollment for students whose historical course is still unknown.
export function UnmappedLegacyInternship({ token, user, setUser, onAuthExpired, onUnreadChanged }: { token: string; user: any; setUser: (user: any) => void; onAuthExpired: () => void; onUnreadChanged: (count: number) => void }) {
  const [query] = useSearchParams();
  const tab = query.get('tab') || 'students';
  return <div className="space-y-5"><div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3"><h2 className="font-semibold">Thực tập Hè 2025–2026</h2><p className="text-sm">Hồ sơ đang chờ Khoa xác nhận học phần. Thông tin, báo cáo và trao đổi đã có vẫn được giữ nguyên.</p><nav className="flex flex-wrap gap-4 text-sm font-semibold text-[#034ea1]">{[['students', 'Hồ sơ và báo cáo'], ['plan', 'Kế hoạch'], ['chat', 'Trao đổi'], ['questions', 'Hỏi đáp']].map(([key, label]) => <Link key={key} to={`?tab=${key}`} aria-current={tab === key ? 'page' : undefined}>{label}</Link>)}<Link to="/classes">Học kỳ và nhóm môn</Link></nav></div>
    {tab === 'chat' ? <ChatView token={token} user={user} onUnreadChanged={onUnreadChanged} /> : tab === 'plan' ? <PlanView user={user} /> : tab === 'questions' ? <FAQView token={token} user={user} /> : <><Dashboard token={token} user={user} setUser={setUser} onAuthExpired={onAuthExpired} /><StudentFinalReportView token={token} user={user} /></>}
  </div>;
}
