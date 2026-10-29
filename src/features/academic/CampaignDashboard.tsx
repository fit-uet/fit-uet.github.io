import { Link } from 'react-router-dom';
import { Users, FileText, CheckCircle2, GraduationCap, LayoutDashboard, Building2, UserCheck, MessageCircle, CircleHelp, Mail, Settings, BookOpen, Shield, ArrowRight } from 'lucide-react';
import type { campaignModules, CampaignMeta } from './campaignPresentation';

const icons = { overview: LayoutDashboard, student: Users, registrations: LayoutDashboard, company: Building2, assignments: UserCheck, reports: FileText, grades: CheckCircle2, chat: MessageCircle, questions: CircleHelp, announcements: Mail, settings: Settings, plan: BookOpen };
type Modules = ReturnType<typeof campaignModules>;
export function CampaignDashboard({ data, modules, navigate }: { data: CampaignMeta; modules: Modules; navigate: (id: string) => void }) {
  const statistics = [
    { key: 'studentCount', title: 'Sinh viên', caption: 'Số sinh viên duy nhất', icon: Users, color: 'text-[#034ea1] bg-blue-50' },
    { key: 'enrollmentCount', title: 'Lần học', caption: `${data.campaign.classCount} lớp học phần`, icon: GraduationCap, color: 'text-[#034ea1] bg-blue-50' },
    { key: 'submitted', title: 'Đã nộp báo cáo', caption: 'Theo từng hồ sơ học phần', icon: FileText, color: 'text-amber-700 bg-amber-50' },
    { key: 'graded', title: 'Đã hoàn tất điểm', caption: 'Đủ các phần đánh giá', icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50' },
  ];
  return <div className="space-y-6">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{statistics.map(item => <div key={item.key} className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs"><div className="flex justify-between items-center gap-2 mb-3"><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{item.title}</span><div className={`p-2 rounded-lg ${item.color}`}><item.icon size={18} /></div></div><strong className="text-3xl font-bold text-slate-900">{data.stats[item.key] ?? 0}</strong><p className="text-[11px] text-slate-500 mt-2">{item.caption}</p></div>)}</div>
    <section aria-label="Chức năng quản lý"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Chức năng quản lý</h2><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{modules.filter(m => m.id !== 'overview').map(item => { const Icon = icons[item.icon] || FileText; return <button key={item.id} type="button" onClick={() => navigate(item.id)} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#034ea1] hover:shadow-sm transition-all flex items-start gap-3.5 text-left group"><span className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-[#034ea1] group-hover:bg-blue-50"><Icon size={20} /></span><span className="min-w-0"><span className="block font-semibold text-sm text-slate-800 group-hover:text-[#034ea1]">{item.title}</span><span className="block text-xs text-slate-500 leading-relaxed mt-1">{item.description}</span></span></button>; })}</div></section>
    <section className="border-t border-slate-200 pt-5"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Danh mục và quản trị hệ thống</h2><div className="flex flex-wrap gap-x-6 gap-y-3">{[
      ['students', 'Danh mục sinh viên', Users], ['lecturers', 'Giảng viên', GraduationCap], ['companies', 'Doanh nghiệp', Building2], ['approved-companies', 'CSDL thẩm định', Shield], ['admins', 'Quản trị viên', Shield],
    ].map(([key, label, Icon]: any) => <Link key={key} className="text-xs font-semibold text-slate-600 hover:text-[#034ea1] inline-flex gap-2 items-center" to={`/admin/${key}`}><Icon size={15} />{label}</Link>)}<Link to="/system/notifications" className="text-xs font-semibold text-slate-600 hover:text-[#034ea1] inline-flex gap-2 items-center"><Mail size={15} />Thông báo hệ thống<ArrowRight size={12} /></Link><Link to="/system/settings" className="text-xs font-semibold text-slate-600 hover:text-[#034ea1] inline-flex gap-2 items-center"><Settings size={15} />Tích hợp hệ thống</Link></div></section>
  </div>;
}
