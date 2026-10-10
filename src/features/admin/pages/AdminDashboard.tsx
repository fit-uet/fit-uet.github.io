import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect } from 'react';
import { User as UserIcon, Users, CheckCircle2, LayoutDashboard, Building2, FileText, Shield, Clock, CircleHelp, Settings, GraduationCap } from 'lucide-react';
import { API_BASE, cachedJsonFetch } from '../../../shared';

export function AdminDashboard({ token, user: propUser }: { token: string; user?: any }) {
  const navigate = useNavigate();
  const user = propUser || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null);
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {user && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              {user.picture ? (
                <img src={user.picture} alt="Avatar" className="w-16 h-16 rounded-full border-2 border-white shadow-sm object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700">
                  <Shield size={26} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-1 flex items-center gap-1.5">
                  <Shield size={12} className="text-blue-600" /> Quản trị viên hệ thống
                </p>
                <h2 className="text-2xl font-bold text-slate-900 break-words">{user.name}</h2>
                <p className="text-sm text-slate-500 mt-1 break-all">{user.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                onClick={() => navigate('/profile')}
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
              >
                <UserIcon size={14} className="text-slate-500" /> Cập nhật hồ sơ
              </button>
              <button
                onClick={() => navigate('/plan')}
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
              >
                <FileText size={14} className="text-slate-500" /> Kế hoạch triển khai
              </button>
              <button
                onClick={() => navigate('/faq')}
                className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer hover:shadow active:scale-[0.98]"
              >
                <CircleHelp size={14} className="text-slate-500" /> Xem FAQ
              </button>
            </div>
          </div>

          {/* Thống kê Tổng quan Hệ thống */}
          <div className="mt-8 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Số SV đăng ký</span>
                  <div className="p-2 bg-sky-50 rounded-xl text-sky-600">
                    <Users size={18} />
                  </div>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-3xl font-bold text-slate-900">{loadingStats ? '—' : stats.registeredCount}</span>
                  <span className="text-[11px] font-medium text-slate-400">tổng số</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-blue-600 text-xs font-semibold uppercase tracking-wider">Số SV xác nhận</span>
                  <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
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

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">Số SV nộp báo cáo</span>
                  <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
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

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-emerald-600 text-xs font-semibold uppercase tracking-wider">Số SV có điểm</span>
                  <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
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
          </div>

          {/* Quick navigation modules grid */}
          <div className="mt-8 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[
                {
                  title: 'Quản lý Đăng ký',
                  desc: 'Xem, lọc, duyệt danh sách nguyện vọng đăng ký thực tập của sinh viên.',
                  path: '/admin/registrations',
                  icon: <LayoutDashboard className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Quản lý Sinh viên',
                  desc: 'Import, xuất dữ liệu và cập nhật thông tin sinh viên.',
                  path: '/admin/students',
                  icon: <Users className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Quản lý Giảng viên',
                  desc: 'Danh sách và thông tin các giảng viên hướng dẫn.',
                  path: '/admin/lecturers',
                  icon: <UserIcon className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Quản lý Doanh nghiệp',
                  desc: 'Danh sách doanh nghiệp tiếp nhận thực tập.',
                  path: '/admin/companies',
                  icon: <Building2 className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Phân công GVHD',
                  desc: 'Phân giảng viên hướng dẫn chính & đồng hướng dẫn.',
                  path: '/admin/advisors',
                  icon: <Settings className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Báo cáo thực tập',
                  desc: 'Theo dõi, duyệt báo cáo thực tập của sinh viên.',
                  path: '/admin/reports',
                  icon: <FileText className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Bảng điểm thực tập',
                  desc: 'Tổng hợp điểm định kỳ, final và đánh giá công ty.',
                  path: '/admin/grades',
                  icon: <CheckCircle2 className="text-[#1b7f37]" size={18} />,
                },
                {
                  title: 'CSDL Thẩm định',
                  desc: 'Duyệt tự động các công ty sinh viên tự liên hệ.',
                  path: '/admin/approved-companies',
                  icon: <Shield className="text-[#034ea1]" size={18} />,
                },
                {
                  title: 'Thông báo và Email',
                  desc: 'Lịch sử thông báo, gửi email hàng loạt cho công ty.',
                  path: '/admin/notifications',
                  icon: <Clock className="text-[#b25e00]" size={18} />,
                },
                {
                  title: 'Cài đặt hệ thống',
                  desc: 'Đồng bộ Google Sheets, chỉnh năm học, các đợt đk.',
                  path: '/admin/settings',
                  icon: <Settings className="text-slate-600" size={18} />,
                },
                {
                  title: 'Hướng dẫn GV',
                  desc: 'Chỉnh nội dung hướng dẫn sử dụng hiển thị cho giảng viên.',
                  path: '/admin/lecturer-guide',
                  icon: <CircleHelp className="text-slate-600" size={18} />,
                },
                {
                  title: 'Quản trị viên',
                  desc: 'Quản lý phân quyền tài khoản quản trị hệ thống.',
                  path: '/admin/admins',
                  icon: <Shield className="text-slate-600" size={18} />,
                }
              ].map(item => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="text-left p-4 rounded-2xl border border-slate-200 bg-white hover:border-[#034ea1]/40 hover:shadow-md transition-all duration-150 shadow-xs cursor-pointer flex flex-col justify-between min-h-[115px] group active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="font-semibold text-xs text-slate-800 group-hover:text-[#034ea1] transition-colors">{item.title}</span>
                    <span className="p-1.5 bg-[#f8fafc] rounded-xl border border-slate-100">{item.icon}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2 font-normal line-clamp-2 leading-relaxed">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

