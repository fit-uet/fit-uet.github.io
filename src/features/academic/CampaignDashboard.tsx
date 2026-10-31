import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Clock, Mail, CircleHelp, MessageCircle } from 'lucide-react';
import { AdminDashboard } from '../admin/pages/AdminDashboard';
import type { campaignModules, CampaignMeta } from './campaignPresentation';
import { GROUP_NAMES } from '../../shared/academic';

type Props = {
  data: CampaignMeta;
  modules: ReturnType<typeof campaignModules>;
  navigate: (tab: string) => void;
  token: string;
  reload: () => void;
};
const destinations: Record<string, string> = {
  '/campaign/students': 'students', '/admin/registrations': 'registrations',
  '/admin/final-internships': 'final-internships', '/admin/advisors': 'assignments',
  '/admin/reports': 'reports', '/admin/grades': 'grades', '/plan': 'plan',
  '/admin/plan': 'plan-editor', '/admin/registration-rules': 'rules-editor',
  '/admin/lecturer-guide': 'guide-editor', '/admin/faq': 'faq-editor',
};
export function CampaignDashboard({ data, navigate, token, reload }: Props) {
  const route = useNavigate();
  const p = data.campaign;
  const stats = useMemo(() => ({
    registeredCount: data.stats.studentCount ?? 0,
    confirmedCount: data.stats.enrollmentCount ?? 0,
    reportCount: data.stats.submitted ?? 0,
    gradedCount: data.stats.graded ?? 0,
  }), [data.stats]);
  const extraModules = [
    { title: 'Thời hạn nhóm môn', Icon: Clock, path: '/campaign/settings' },
    { title: 'Thông báo nhóm môn', Icon: Mail, path: '/campaign/announcements' },
    { title: 'Hỏi đáp với Khoa', Icon: CircleHelp, path: '/campaign/questions' },
    { title: 'Trao đổi', Icon: MessageCircle, path: '/campaign/chat' },
  ].map(({Icon,...item}) => ({ ...item, icon:<Icon size={20} className="text-[#034ea1]"/>, onClick: () => navigate(item.path.split('/').at(-1)!) }));
  return <AdminDashboard token={token} presentation={{
    stats, subtitle: `${GROUP_NAMES[p.group]} · ${p.semesterName}`,
    project: p.group === 'project', legacy: !!p.legacy,
    onNavigate: path => destinations[path] ? navigate(p.group==='project'&&['assignments','reports'].includes(destinations[path])?'students':destinations[path])
      : route(path === '/admin/notifications' ? '/system/notifications' : path === '/admin/settings' ? '/system/settings' : path),
    actions: <button onClick={reload} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"><RefreshCw size={14} />Tải lại</button>,
    context: <div className="flex flex-wrap gap-3 items-center text-xs text-slate-500">
      <span className={`rounded-full border px-2 py-1 ${p.status==='active'?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-slate-200 bg-slate-50'}`}>{p.status === 'active' ? 'Đang hoạt động' : p.status === 'archived' ? 'Lưu trữ · Chỉ xem' : 'Nháp'}</span>
      <span>{p.classCount} lớp · {p.studentCount} sinh viên · {p.enrollmentCount} lần học</span>
    </div>,
    extraModules,
  }} />;
}
