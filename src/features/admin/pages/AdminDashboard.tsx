import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import {
  Users, CheckCircle2, LayoutDashboard, Building2, FileText,
  Shield, Mail, Settings, GraduationCap, UserCheck, BookOpen, CircleHelp
} from 'lucide-react';
import { API_BASE, cachedJsonFetch } from '../../../shared';

export function AdminDashboard({ token }: { token: string; user?: any }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>({ registeredCount: 0, confirmedCount: 0, reportCount: 0, gradedCount: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    cachedJsonFetch<any>(`${API_BASE}/api/admin/dashboard-stats`, {
      cacheKey: 'admin:dashboard-stats:v2',
      ttlMs: 30_000,
      headers: { Authorization: `Bearer ${token}` },
      forceRefresh: true,
    })
      .then(data => {
        if (data && typeof data === 'object') setStats(data);
      })
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, [token]);

  const navModules = [
    { title: 'Quản lý Đăng ký', path: '/admin/registrations', icon: <LayoutDashboard size={20} className="text-[#034ea1]" /> },
    { title: 'Quản lý Sinh viên', path: '/admin/students', icon: <Users size={20} className="text-[#034ea1]" /> },
    { title: 'Quản lý Giảng viên', path: '/admin/lecturers', icon: <GraduationCap size={20} className="text-[#034ea1]" /> },
    { title: 'Quản lý Doanh nghiệp', path: '/admin/companies', icon: <Building2 size={20} className="text-[#034ea1]" /> },
    { title: 'Phân công GVHD', path: '/admin/advisors', icon: <UserCheck size={20} className="text-[#034ea1]" /> },
    { title: 'Báo cáo thực tập', path: '/admin/reports', icon: <FileText size={20} className="text-[#034ea1]" /> },
    { title: 'Bảng điểm thực tập', path: '/admin/grades', icon: <CheckCircle2 size={20} className="text-[#1b7f37]" /> },
    { title: 'CSDL Thẩm định', path: '/admin/approved-companies', icon: <Shield size={20} className="text-[#034ea1]" /> },
    { title: 'Thông báo & Email', path: '/admin/notifications', icon: <Mail size={20} className="text-[#b25e00]" /> },
    { title: 'Cài đặt hệ thống', path: '/admin/settings', icon: <Settings size={20} className="text-slate-600" /> },
    { title: 'Kế hoạch triển khai', path: '/admin/plan', icon: <FileText size={20} className="text-blue-600" /> },
    { title: 'Quy định thực tập', path: '/admin/registration-rules', icon: <Shield size={20} className="text-indigo-600" /> },
    { title: 'Hướng dẫn GV', path: '/admin/lecturer-guide', icon: <BookOpen size={20} className="text-teal-600" /> },
    { title: 'Cài đặt FAQ', path: '/admin/faq', icon: <CircleHelp size={20} className="text-amber-600" /> },
    { title: 'Quản trị viên', path: '/admin/admins', icon: <Shield size={20} className="text-slate-600" /> },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Tổng quan Quản trị</h1>
          <p className="text-xs text-slate-500 mt-0.5">Học phần Thực tập</p>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Số SV đăng ký</span>
            <div className="p-2 bg-sky-50 rounded-lg text-sky-600">
              <Users size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-slate-900">{loadingStats ? '—' : stats.registeredCount}</span>
            <span className="text-[11px] font-medium text-slate-400">tổng số</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-blue-600 text-xs font-semibold uppercase tracking-wider">Số SV xác nhận</span>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-[#034ea1]">{loadingStats ? '—' : stats.confirmedCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {stats.registeredCount ? `${Math.round((stats.confirmedCount / stats.registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">Số SV nộp báo cáo</span>
            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
              <FileText size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-[#b25e00]">{loadingStats ? '—' : stats.reportCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {stats.registeredCount ? `${Math.round((stats.reportCount / stats.registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-emerald-600 text-xs font-semibold uppercase tracking-wider">Số SV có điểm</span>
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <GraduationCap size={18} />
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-3xl font-bold text-[#1b7f37]">{loadingStats ? '—' : stats.gradedCount}</span>
            <span className="text-[11px] font-medium text-slate-400">
              {stats.registeredCount ? `${Math.round((stats.gradedCount / stats.registeredCount) * 100)}%` : '0%'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Navigation Modules */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Chức năng Quản lý</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {navModules.map(item => (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#034ea1] hover:shadow-sm transition-all duration-150 flex items-center gap-3.5 group text-left cursor-pointer active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors">
                {item.icon}
              </div>
              <span className="font-semibold text-sm text-slate-800 group-hover:text-[#034ea1] transition-colors leading-snug">
                {item.title}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
