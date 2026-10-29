import { apiFetch as fetch } from '../utils/requestCache';
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ArrowUpRight, CheckCheck } from 'lucide-react';
import { API_BASE } from '../config';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';

export function getNotificationTarget(row: any, user?: any): string {
  const type = String(row?.type || '');
  const userRole = String(user?.role || 'student').toLowerCase();
  const body = String(row?.body || '');

  // 1. Explicit target_path or target_url from database/server
  if (row?.target_path && typeof row.target_path === 'string') return row.target_path;
  if (row?.target_url && typeof row.target_url === 'string') return row.target_url;

  // 2. Extract external URL from body if present (e.g. Google Drive link in system announcements)
  const urlMatch = body.match(/https?:\/\/[^\s<>"')]+/i);
  if (urlMatch && !urlMatch[0].includes(window.location.host) && !urlMatch[0].includes('localhost')) {
    if (type === 'system_announcement' || type.startsWith('manual_')) {
      return urlMatch[0];
    }
  }

  // 3. Mapping based on notification type and user role
  switch (type) {
    case 'faq_question_created':
      return userRole === 'admin' ? '/admin/faq-questions' : '/faq';

    case 'faq_answered':
      return '/faq';

    case 'registration_status_changed':
    case 'registration_review_comment':
    case 'final_confirmation_open':
    case 'advisor_request_approved_comment':
    case 'advisor_request_rejected':
      return '/';

    case 'final_internship_confirmed':
      return userRole === 'admin' ? '/admin/final-internships' : '/';

    case 'advisor_assigned':
      if (userRole === 'lecturer') return '/lecturer';
      if (userRole === 'admin') return '/admin/advisors';
      return '/';

    case 'advisor_quota_exceeded':
      return '/admin/advisors/quotas';

    case 'final_report_status_changed':
    case 'final_report_due_reminder':
      if (userRole === 'lecturer') return '/lecturer';
      if (userRole === 'admin') return '/admin/reports';
      return '/reports/final';

    case 'grade_submitted':
      return userRole === 'lecturer' ? '/lecturer/grades' : '/';

    case 'grade_locked':
    case 'lecturer_grade_pending_reminder':
      return userRole === 'admin' ? '/admin/grades' : '/lecturer/grades';

    case 'company_applicants_sent':
      return '/admin/companies';

    case 'lecturer_students_mail_merge':
      return '/lecturer';

    case 'system_announcement':
    case 'manual_student_notice':
    case 'manual_lecturer_notice':
    default:
      if (userRole === 'admin') return '/admin';
      if (userRole === 'lecturer') return '/lecturer';
      return '/';
  }
}

export function MyNotifications({
  token,
  user,
  compact = false,
  onChanged,
  onClose,
}: {
  token: string;
  user?: any;
  compact?: boolean;
  onChanged?: (unread: number) => void;
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/notifications/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) return;
      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      const nextUnread = Number(data.unread || 0);
      setRows(nextRows);
      setUnread(nextUnread);
      onChanged?.(nextUnread);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [token]);

  const markRead = async (row: any) => {
    const path = row.source === 'system'
      ? `/api/notifications/my/system/${row.id}/read`
      : `/api/notifications/my/${row.id}/read`;
    await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchRows();
  };

  const markAllRead = async () => {
    await fetch(`${API_BASE}/api/notifications/my/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchRows();
  };

  const handleRowClick = async (row: any) => {
    if (!row.read_at) {
      setRows(prev =>
        prev.map(r => (r.id === row.id && r.source === row.source ? { ...r, read_at: new Date().toISOString() } : r))
      );
      setUnread(prev => Math.max(0, prev - 1));
      onChanged?.(Math.max(0, unread - 1));
      markRead(row);
    }
    onClose?.();
    const target = getNotificationTarget(row, user);
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else {
      navigate(target);
    }
  };

  const visibleRows = compact ? rows.slice(0, 5) : rows;
  const typeLabel = (type: string) => {
    if (type === 'registration_status_changed') return 'Đăng ký';
    if (type === 'registration_review_comment') return 'Nhận xét';
    if (type === 'final_confirmation_open' || type === 'final_internship_confirmed') return 'Xác nhận TT';
    if (type === 'advisor_assigned') return 'GVHD';
    if (type === 'advisor_quota_exceeded') return 'Hạn mức GV';
    if (type === 'advisor_request_approved_comment' || type === 'advisor_request_rejected') return 'Nguyện vọng GV';
    if (type === 'final_report_status_changed') return 'Báo cáo';
    if (type === 'final_report_due_reminder') return 'Hạn nộp BC';
    if (type === 'grade_submitted') return 'Điểm số';
    if (type === 'grade_locked') return 'Bảng điểm';
    if (type === 'lecturer_grade_pending_reminder') return 'Nhập điểm';
    if (type === 'faq_answered') return 'FAQ';
    if (type === 'faq_question_created') return 'Câu hỏi FAQ';
    if (type === 'system_announcement') return 'Hệ thống';
    if (type === 'company_applicants_sent') return 'Doanh nghiệp';
    if (type === 'lecturer_students_mail_merge') return 'Mail GVHD';
    if (type === 'manual_student_notice' || type === 'manual_lecturer_notice') return 'Thông báo';
    return type || 'Thông báo';
  };

  if (loading) return <div className="p-4 text-sm text-slate-500">Đang tải thông báo...</div>;

  return (
    <div className={compact ? '' : 'max-w-4xl mx-auto space-y-6'}>
      {!compact && (
        <PageHeader
          title="Thông báo của tôi"
          description={`${unread} thông báo chưa đọc. Bấm vào từng thông báo để mở trang tương ứng.`}
          icon={<Bell size={20} />}
          actions={
            <Button onClick={markAllRead} disabled={!unread} variant="primary" size="sm">
              <CheckCheck size={16} /> Đánh dấu đã đọc tất cả
            </Button>
          }
        />
      )}
      {compact && rows.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <span className="text-xs font-semibold text-slate-500">{unread} chưa đọc</span>
          <button
            onClick={markAllRead}
            disabled={!unread}
            className="text-xs font-semibold text-[#034ea1] hover:underline disabled:text-slate-400 disabled:no-underline cursor-pointer"
          >
            Đã đọc tất cả
          </button>
        </div>
      )}
      <div
        className={
          compact
            ? 'divide-y divide-slate-100'
            : 'bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden'
        }
      >
        {visibleRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Chưa có thông báo.</div>
        ) : (
          visibleRows.map(row => {
            const isUnread = !row.read_at;
            return (
              <div
                key={`${row.source || 'personal'}-${row.id}`}
                onClick={() => handleRowClick(row)}
                className={`p-4 transition-all cursor-pointer group relative ${
                  isUnread
                    ? 'bg-amber-50/60 hover:bg-blue-50/70 border-l-4 border-l-amber-500'
                    : 'bg-white hover:bg-slate-50 border-l-4 border-l-transparent'
                }`}
                title="Bấm vào để mở trang liên quan"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-full">
                        {typeLabel(row.type)}
                      </span>
                      {isUnread && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> Mới
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 ml-auto flex items-center gap-1 group-hover:text-[#034ea1] transition-colors">
                        Mở trang <ArrowUpRight size={13} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </span>
                    </div>
                    <div className="font-semibold text-slate-900 group-hover:text-[#034ea1] transition-colors text-sm sm:text-base leading-snug">
                      {row.subject}
                    </div>
                    <div className="text-xs sm:text-sm text-slate-600 whitespace-pre-wrap mt-1 leading-relaxed">
                      {row.body}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-2 font-medium">
                      {row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-'}
                    </div>
                  </div>
                  {isUnread && (
                    <div className="flex-shrink-0 self-center">
                      <button
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          markRead(row);
                        }}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg transition-all shadow-2xs whitespace-nowrap cursor-pointer active:scale-95"
                        title="Đánh dấu đã đọc mà không chuyển trang"
                      >
                        Đã đọc
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {compact && rows.length > visibleRows.length && (
        <Link
          to="/notifications"
          onClick={onClose}
          className="block px-4 py-3 text-xs sm:text-sm text-center font-semibold text-[#034ea1] hover:bg-blue-50 transition-colors"
        >
          Xem tất cả ({rows.length}) thông báo &rarr;
        </Link>
      )}
    </div>
  );
}
