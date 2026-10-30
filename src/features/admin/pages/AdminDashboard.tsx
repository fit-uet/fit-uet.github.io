import { CampaignStandalone } from '../../academic/CampaignLayoutContext';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, type ReactNode } from 'react';
import {
  Users, CheckCircle2, LayoutDashboard, Building2, FileText,
  Shield, Mail, Settings, GraduationCap, UserCheck, BookOpen, CircleHelp
} from 'lucide-react';
import { API_BASE, cachedJsonFetch } from '../../../shared';

type DashboardPresentation = {
  stats: {registeredCount:number;confirmedCount:number;reportCount:number;gradedCount:number};
  subtitle: string;
  project?: boolean;
  legacy?: boolean;
  onNavigate: (path:string) => void;
  actions?: ReactNode;
  context?: ReactNode;
  extraModules?: {title:string;path:string;onClick:()=>void;icon?:React.ReactElement}[];
};
export function AdminDashboard({ token, presentation }: { token: string; user?: any; presentation?: DashboardPresentation }) {
  const routeNavigate = useNavigate(); const navigate = presentation?.onNavigate || routeNavigate;
  const [stats, setStats] = useState<any>({ registeredCount: 0, confirmedCount: 0, reportCount: 0, gradedCount: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if(presentation && !presentation.legacy){setStats(presentation.stats);setLoadingStats(false);return;}
    cachedJsonFetch<any>(`${API_BASE}/api/admin/dashboard-stats`, {
      cacheKey: 'admin:dashboard-stats:v2',
      ttlMs: 30_000,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(data => {
        if (data && typeof data === 'object') setStats(data);
      })
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, [token, presentation?.stats, presentation?.legacy]);

  const isProject = !!presentation?.project;
  const progressTotal = isProject ? stats.confirmedCount : stats.registeredCount;
  const navModules = [
    { title: isProject ? 'Danh sách sinh viên' : 'Quản lý Đăng ký', path: isProject ? '/campaign/students' : '/admin/registrations', icon: <LayoutDashboard size={20} className="text-[#034ea1]" /> },
    { title: 'Quản lý Sinh viên', path: '/admin/students', icon: <Users size={20} className="text-[#034ea1]" /> },
    { title: 'Quản lý Giảng viên', path: '/admin/lecturers', icon: <GraduationCap size={20} className="text-[#034ea1]" /> },
    ...(!isProject ? [{ title: 'Quản lý Doanh nghiệp', path: '/admin/companies', icon: <Building2 size={20} className="text-[#034ea1]" /> }] : []),
    { title: isProject ? 'Phân công GVHD / GVNX' : 'Phân công GVHD', path: '/admin/advisors', icon: <UserCheck size={20} className="text-[#034ea1]" /> },
    { title: isProject ? 'Báo cáo Dự án' : 'Báo cáo thực tập', path: '/admin/reports', icon: <FileText size={20} className="text-[#034ea1]" /> },
    { title: isProject ? 'Bảng điểm Dự án' : 'Bảng điểm thực tập', path: '/admin/grades', icon: <CheckCircle2 size={20} className="text-[#1b7f37]" /> },
    ...(!isProject ? [{ title: 'CSDL Thẩm định', path: '/admin/approved-companies', icon: <Shield size={20} className="text-[#034ea1]" /> }] : []),
    { title: 'Thông báo & Email', path: '/admin/notifications', icon: <Mail size={20} className="text-[#b25e00]" /> },
    { title: 'Cài đặt hệ thống', path: '/admin/settings', icon: <Settings size={20} className="text-slate-600" /> },
    { title: 'Kế hoạch triển khai', path: '/admin/plan', icon: <FileText size={20} className="text-blue-600" /> },
    ...(!isProject ? [{ title: 'Quy định thực tập', path: '/admin/registration-rules', icon: <Shield size={20} className="text-indigo-600" /> }] : []),
    { title: 'Hướng dẫn GV', path: '/admin/lecturer-guide', icon: <BookOpen size={20} className="text-teal-600" /> },
    { title: 'Cài đặt FAQ', path: '/admin/faq', icon: <CircleHelp size={20} className="text-amber-600" /> },
    { title: 'Quản trị viên', path: '/admin/admins', icon: <Shield size={20} className="text-slate-600" /> },
  ].filter(item=>!isProject||!['/admin/advisors','/admin/reports','/admin/grades'].includes(item.path));
  if (presentation && !presentation.project) {
    navModules.splice(5, 0, { title: 'Nơi thực tập chính thức', path: '/admin/final-internships', icon: <Building2 size={20} className="text-[#034ea1]" /> });
  }

  for (const item of presentation?.extraModules || []) {
    navModules.push({ ...item, icon: item.icon || <Mail size={20} className="text-[#034ea1]" /> });
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <CampaignStandalone><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Tổng quan Quản trị</h1>
          <p className="text-xs text-slate-500 mt-0.5">{presentation?.subtitle || 'Học phần Thực tập'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {presentation?.actions}
          <button
            onClick={() => navigate('/plan')}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <FileText size={14} className="text-blue-600" /> Kế hoạch triển khai
          </button>
          <button
            onClick={() => navigate('/admin/settings')}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Settings size={14} className="text-slate-500" /> Cài đặt hệ thống
          </button>
        </div>
      </div></CampaignStandalone>

      <CampaignStandalone>{presentation?.context}</CampaignStandalone>
      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>{presentation?.project ? 'Tổng sinh viên' : 'Số SV đăng ký'}</span>
            <Users size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#034ea1] tracking-tight">{loadingStats ? '—' : stats.registeredCount}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-1.5 font-medium">Danh sách sinh viên trong nhóm</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>{presentation?.project ? 'Số lần học' : 'Số SV xác nhận'}</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight">{loadingStats ? '—' : stats.confirmedCount}</span>
            <span className="text-xs text-[#64748b]">hồ sơ</span>
          </div>
          <span className="text-[11px] text-emerald-600 mt-1.5 font-medium">
            {presentation?.project
              ? 'Đã được ghi nhận học phần'
              : stats.registeredCount
              ? `${Math.round((stats.confirmedCount / stats.registeredCount) * 100)}% đã xác nhận nơi TT`
              : 'Đã xác nhận chính thức'}
          </span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>{presentation?.project ? 'Báo cáo đã nộp' : 'Số SV nộp báo cáo'}</span>
            <FileText size={16} className="text-amber-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 tracking-tight">{loadingStats ? '—' : stats.reportCount}</span>
            <span className="text-xs text-[#64748b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-amber-600 mt-1.5 font-medium">
            {progressTotal
              ? `${Math.round((stats.reportCount / progressTotal) * 100)}% hoàn thành nộp bài`
              : 'Chờ giảng viên phản hồi'}
          </span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>{presentation?.project ? 'Đã có điểm' : 'Số SV có điểm'}</span>
            <GraduationCap size={16} className="text-slate-700" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-700 tracking-tight">{loadingStats ? '—' : stats.gradedCount}</span>
            <span className="text-xs text-[#64748b]">{presentation?.project ? 'hồ sơ' : 'sinh viên'}</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1.5 font-medium">
            {progressTotal
              ? `${Math.round((stats.gradedCount / progressTotal) * 100)}% đã hoàn tất đánh giá`
              : 'Đã hoàn tất đánh giá'}
          </span>
        </div>
      </div>

      {/* Quick Navigation Modules */}
      <div role="region" aria-label="Chức năng quản lý">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Chức năng Quản lý</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {navModules.map(item => (
            <button
              key={item.path}
              type="button"
              onClick={() => { const custom=presentation?.extraModules?.find(m=>m.path===item.path);custom?custom.onClick():navigate(item.path); }}
              className="p-3.5 sm:p-4 rounded-2xl border border-black/[0.06] bg-white hover:border-[#034ea1]/40 hover:shadow-sm transition-all duration-150 flex items-center gap-3.5 group text-left cursor-pointer active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors">
                {item.icon}
              </div>
              <span className="font-semibold text-xs sm:text-[13px] text-slate-800 group-hover:text-[#034ea1] transition-colors leading-snug">
                {item.title}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
