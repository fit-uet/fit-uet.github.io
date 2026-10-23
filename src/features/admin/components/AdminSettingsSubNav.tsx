import { Link, useLocation } from 'react-router-dom';
import { Settings, FileText, Shield, BookOpen, CircleHelp } from 'lucide-react';

const SETTINGS_TABS = [
  { path: '/admin/settings', label: 'Cài đặt học phần', icon: Settings },
  { path: '/admin/plan', label: 'Kế hoạch triển khai', icon: FileText },
  { path: '/admin/registration-rules', label: 'Quy định thực tập', icon: Shield },
  { path: '/admin/lecturer-guide', label: 'Hướng dẫn GV', icon: BookOpen },
  { path: '/admin/faq', label: 'Cài đặt FAQ', icon: CircleHelp },
];

export function AdminSettingsSubNav() {
  const location = useLocation();

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-6 border-b border-slate-200">
      {SETTINGS_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = location.pathname === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              isActive
                ? 'bg-[#034ea1] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Icon size={14} className={isActive ? 'text-white' : 'text-slate-500'} />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
