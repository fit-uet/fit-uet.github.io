import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { API_BASE } from '../config';
import { Button } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';

export function MyNotifications({
  token,
  compact = false,
  onChanged,
}: {
  token: string;
  compact?: boolean;
  onChanged?: (unread: number) => void;
}) {
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

  const visibleRows = compact ? rows.slice(0, 5) : rows;
  const typeLabel = (type: string) => {
    if (type === 'registration_status_changed') return 'Đăng ký';
    if (type === 'advisor_assigned') return 'GVHD';
    if (type === 'final_report_status_changed') return 'Báo cáo';
    if (type === 'grade_locked') return 'Bảng điểm';
    if (type === 'faq_answered') return 'FAQ';
    if (type === 'faq_question_created') return 'Câu hỏi FAQ';
    if (type === 'system_announcement') return 'Hệ thống';
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
          description={`${unread} thông báo chưa đọc.`}
          icon={<Bell size={20} />}
          actions={
            <Button onClick={markAllRead} disabled={!unread} variant="primary" size="sm">
              Đánh dấu đã đọc tất cả
            </Button>
          }
        />
      )}
      {compact && rows.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">{unread} chưa đọc</span>
          <button
            onClick={markAllRead}
            disabled={!unread}
            className="text-xs font-semibold text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline cursor-pointer"
          >
            Đã đọc tất cả
          </button>
        </div>
      )}
      <div className={compact ? 'divide-y divide-slate-100' : 'bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden'}>
        {visibleRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Chưa có thông báo.</div>
        ) : (
          visibleRows.map((row) => (
            <div key={`${row.source || 'personal'}-${row.id}`} className={`p-4 ${row.read_at ? 'bg-white' : 'bg-amber-50/70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                      {typeLabel(row.type)}
                    </span>
                    {!row.read_at && <span className="w-2 h-2 rounded-full bg-blue-600 animate-none" title="Chưa đọc" />}
                  </div>
                  <div className="font-semibold text-slate-900">{row.subject}</div>
                  <div className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{row.body}</div>
                  <div className="text-xs text-slate-400 mt-2">
                    {row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-'}
                  </div>
                </div>
                {!row.read_at && (
                  <Button onClick={() => markRead(row)} size="sm">
                    Đã đọc
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {compact && rows.length > visibleRows.length && (
        <Link to="/notifications" className="block px-4 py-3 text-sm text-center font-semibold text-blue-600 hover:bg-blue-50">
          Xem tất cả thông báo
        </Link>
      )}
    </div>
  );
}
