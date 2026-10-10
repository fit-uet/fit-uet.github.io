import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Download,
  Search,
  RefreshCw,
  Trash2,
  Clock,
  Send,
  ChevronLeft,
  Bell,
  Mail,
  AlertTriangle,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { API_BASE, saveXlsx, paginationBounds, PaginationControls, PageDescriptionTooltip } from '../../../shared';

export function NotificationAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'created_at',
    direction: 'desc',
  });
  const [creatingReminders, setCreatingReminders] = useState(false);
  const [sendingQueue, setSendingQueue] = useState(false);
  const [creatingManual, setCreatingManual] = useState(false);
  const [deletingNotifications, setDeletingNotifications] = useState(false);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<number[]>([]);
  const [showManualComposer, setShowManualComposer] = useState(false);
  const [manualNotice, setManualNotice] = useState({
    target: 'students_with_registration',
    recipient: '',
    delivery_mode: 'website_and_email',
    subject: '',
    body: '',
  });
  const [stats, setStats] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const fetchRows = async () => {
    setLoading(true);
    try {
      const [res, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/notifications`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin/notifications/stats`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setSelectedNotificationIds([]);
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) {
      alert('Không tải được lịch sử thông báo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [token]);

  const markStatus = async (id: number, status: string) => {
    const error = status === 'failed' ? prompt('Ghi chú lỗi:', '') || '' : '';
    const res = await fetch(`${API_BASE}/api/admin/notifications/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, error }),
    });
    if (res.ok) fetchRows();
    else alert('Cập nhật trạng thái thông báo thất bại.');
  };

  const createFinalReportReminders = async () => {
    if (!confirm('Tạo thông báo nhắc nộp báo cáo cho sinh viên chưa nộp hoặc cần nộp lại?')) return;
    setCreatingReminders(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/final-report-reminders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Tạo nhắc hạn thất bại.');
      alert(`Đã tạo ${data.count || 0} thông báo nhắc hạn.`);
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi tạo nhắc hạn.');
    } finally {
      setCreatingReminders(false);
    }
  };

  const createFinalConfirmationOpen = async () => {
    if (!confirm('Tạo thông báo mở xác nhận nơi thực tập cho sinh viên đã đăng ký nhưng chưa xác nhận nơi thực tập chính thức?')) return;
    setCreatingReminders(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/final-confirmation-open`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Tạo thông báo thất bại.');
      alert(`Đã tạo ${data.count || 0} thông báo mở xác nhận.`);
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi tạo thông báo.');
    } finally {
      setCreatingReminders(false);
    }
  };

  const sendQueued = async (scope: 'all' | 'filtered' = 'all', mode: 'batch' | 'quota' = 'batch') => {
    const filteredQueuedIds = filtered.filter((row) => row.status === 'queued').map((row) => Number(row.id)).filter(Boolean);
    const label =
      scope === 'filtered'
        ? `Gửi ${filteredQueuedIds.length} thông báo đang lọc (chế độ ${mode === 'quota' ? 'quota' : 'batch'})?`
        : `Gửi email hàng đợi (chế độ ${mode === 'quota' ? 'quota' : 'batch'})?`;
    if (!confirm(label)) return;
    setSendingQueue(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/send-queued`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          notification_ids: scope === 'filtered' ? filteredQueuedIds : undefined,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi email hàng đợi thất bại.');
      alert(`Kết quả gửi: Thành công ${data.sent || 0}, Thất bại ${data.failed || 0}.`);
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi gửi email hàng đợi.');
    } finally {
      setSendingQueue(false);
    }
  };

  const createManualNotice = async () => {
    if (!manualNotice.subject.trim()) return alert('Vui lòng nhập tiêu đề thông báo.');
    if (!manualNotice.body.trim()) return alert('Vui lòng nhập nội dung thông báo.');
    if (manualNotice.target === 'single_account' && !manualNotice.recipient.trim()) {
      return alert('Vui lòng nhập email hoặc MSSV người nhận.');
    }
    setCreatingManual(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(manualNotice),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Tạo thông báo thất bại.');
      const created = Number(data.created ?? data.count ?? 0);
      const sent = Number(data.sent || 0);
      const queued = Number(data.queued || 0);
      const failed = Number(data.failed || 0);
      const resultLines = [`Đã tạo ${created} thông báo.`];
      if (manualNotice.delivery_mode === 'website_and_email') {
        resultLines.push(`Email đã gửi: ${sent}.`);
        resultLines.push(`Đang chờ theo quota: ${queued}.`);
        if (failed > 0) resultLines.push(`Gửi lỗi: ${failed}.`);
      }
      alert(resultLines.join('\n'));
      setManualNotice((prev) => ({ ...prev, subject: '', body: '', recipient: '' }));
      setShowManualComposer(false);
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi tạo thông báo.');
    } finally {
      setCreatingManual(false);
    }
  };

  const deleteNotifications = async (scope: 'selected' | 'filtered' | 'queued') => {
    const ids =
      scope === 'selected'
        ? selectedNotificationIds
        : scope === 'filtered'
        ? sortedFiltered.map((row) => Number(row.id)).filter(Boolean)
        : rows.filter((row) => row.status === 'queued').map((row) => Number(row.id)).filter(Boolean);

    if (ids.length === 0) return alert('Không có thông báo nào được chọn để xoá.');
    const label =
      scope === 'selected'
        ? `Xoá ${ids.length} thông báo đã chọn?`
        : scope === 'filtered'
        ? `Xoá ${ids.length} thông báo theo bộ lọc hiện tại?`
        : `Xoá ${ids.length} thông báo đang ở hàng đợi (queued)?`;
    if (!confirm(label)) return;

    setDeletingNotifications(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Xoá thông báo thất bại.');
      alert(`Đã xoá ${data.deleted || ids.length} thông báo.`);
      setSelectedNotificationIds([]);
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi xoá thông báo.');
    } finally {
      setDeletingNotifications(false);
    }
  };

  const notificationTypeLabel = (type?: string) => {
    const labels: Record<string, string> = {
      advisor_assigned: 'Phân công GVHD',
      final_confirmation_open: 'Mở xác nhận thực tập',
      final_report_reminder: 'Nhắc nộp báo cáo',
      grade_locked: 'Bảng điểm đã khóa',
      lecturer_students_mail_merge: 'Mail merge giảng viên',
      manual_direct_notice: 'Thông báo tới một tài khoản',
      manual_lecturer_notice: 'Thông báo cho giảng viên',
      manual_student_notice: 'Thông báo cho sinh viên',
      registration_review_comment: 'Nhận xét đăng ký',
      registration_status_changed: 'Trạng thái đăng ký',
      system_announcement: 'Thông báo hệ thống',
    };
    return labels[String(type || '')] || String(type || 'Thông báo');
  };

  const types = Array.from(new Set<string>(rows.map((row) => String(row.type || '')).filter(Boolean))).sort();

  const sortNotifications = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortValue = (row: any, key: string) => {
    if (key === 'recipient') return `${row.recipient_email || ''} ${row.user_name || ''} ${row.student_id || ''}`.toLowerCase();
    if (key === 'content') return `${row.subject || ''} ${row.body || ''}`.toLowerCase();
    if (key === 'created_at' || key === 'sent_at') return row[key] ? new Date(row[key]).getTime() : 0;
    return String(row[key] || '').toLowerCase();
  };

  const sortLabel = (key: string) => (sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '');

  const filtered = rows.filter((row) => {
    const term = searchTerm.trim().toLowerCase();
    const matchStatus = statusFilter ? row.status === statusFilter : true;
    const matchType = typeFilter ? row.type === typeFilter : true;
    const matchTerm =
      !term ||
      row.recipient_email?.toLowerCase().includes(term) ||
      row.subject?.toLowerCase().includes(term) ||
      row.body?.toLowerCase().includes(term) ||
      row.user_name?.toLowerCase().includes(term) ||
      row.student_id?.toLowerCase().includes(term);
    return matchStatus && matchType && matchTerm;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    const left = sortValue(a, sortConfig.key);
    const right = sortValue(b, sortConfig.key);
    if (left < right) return sortConfig.direction === 'asc' ? -1 : 1;
    if (left > right) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, typeFilter, sortConfig.key, sortConfig.direction, rows.length]);

  const pagination = paginationBounds(sortedFiltered.length, currentPage, pageSize);
  const paginatedRows = sortedFiltered.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);
  const selectedCount = selectedNotificationIds.filter((id) => rows.some((row) => Number(row.id) === id)).length;
  const paginatedIds = paginatedRows.map((row) => Number(row.id)).filter(Boolean);
  const pageSelected = paginatedIds.length > 0 && paginatedIds.every((id) => selectedNotificationIds.includes(id));

  const toggleNotificationSelection = (id: number, checked: boolean) => {
    setSelectedNotificationIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id)));
  };

  const toggleCurrentPageSelection = (checked: boolean) => {
    setSelectedNotificationIds((prev) => {
      if (!checked) return prev.filter((id) => !paginatedIds.includes(id));
      return Array.from(new Set([...prev, ...paginatedIds]));
    });
  };

  const exportXlsx = () => {
    const headers = ['STT', 'Người nhận', 'Loại', 'Tiêu đề', 'Nội dung', 'Trạng thái', 'Lỗi', 'Tạo lúc', 'Gửi lúc'];
    const data = sortedFiltered.map((row, idx) => [
      idx + 1,
      row.recipient_email,
      row.type,
      row.subject,
      row.body,
      row.status,
      row.error || '',
      row.created_at || '',
      row.sent_at || '',
    ]);
    saveXlsx('lich_su_thong_bao.xlsx', headers, data, 'Thông báo');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#64748b]">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải lịch sử thông báo...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Apple Large Title & Navigation Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#64748b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            Quản trị hệ thống
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shadow-inner shrink-0">
              <Bell size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Lịch sử thông báo & Email
                <PageDescriptionTooltip description="Quản trị hàng đợi email, phát thông báo tự động và soạn thông báo thủ công tới sinh viên/giảng viên." />
              </h1>
              <p className="text-xs text-[#64748b] mt-0.5 font-medium">
                Theo dõi nhật ký email, hàng đợi thông báo hệ thống và quota gửi
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowManualComposer(!showManualComposer)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer"
          >
            <Plus size={14} className="text-[#034ea1]" />
            Soạn thông báo
            {showManualComposer ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={exportXlsx}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <Download size={14} className="text-[#64748b]" />
            Xuất XLSX
          </button>
        </div>
      </div>

      {/* Apple Executive KPI Row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Đã gửi hôm nay</span>
              <Mail size={16} className="text-[#034ea1]" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-[#0f172a] tracking-tight">{stats.sent_today || 0}</span>
              <span className="text-xs text-[#64748b] font-medium">/ {stats.daily_cap || 500} quota</span>
            </div>
            <div className="w-full bg-[#f2f2f7] h-1.5 rounded-full overflow-hidden mt-3">
              <div
                className="bg-[#034ea1] h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, ((stats.sent_today || 0) / (stats.daily_cap || 500)) * 100))}%` }}
              />
            </div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Đang chờ gửi (Queued)</span>
              <Clock size={16} className="text-[#c2410c]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[#c2410c] tracking-tight">{stats.statuses?.queued || 0}</span>
              <span className="text-xs text-[#64748b]">email</span>
            </div>
            <span className="text-[11px] text-[#64748b] mt-2 font-medium">Batch size: {stats.batch_size || 20}</span>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Đã phát thành công</span>
              <CheckCircle2 size={16} className="text-[#15803d]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[#15803d] tracking-tight">{stats.statuses?.sent || 0}</span>
              <span className="text-xs text-[#64748b]">email</span>
            </div>
            <span className="text-[11px] text-[#64748b] mt-2 font-medium">Cổng gửi: {stats.provider || 'Nodemailer'}</span>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Gửi thất bại / Lỗi</span>
              <AlertTriangle size={16} className="text-[#b91c1c]" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[#b91c1c] tracking-tight">{stats.statuses?.failed || 0}</span>
              <span className="text-xs text-[#64748b]">email</span>
            </div>
            <span className="text-[11px] text-[#64748b] mt-2 font-medium">Cần kiểm tra mail server</span>
          </div>
        </div>
      )}

      {/* Manual Composer Inset Group (Collapsible) */}
      {showManualComposer && (
        <div className="bg-white border border-black/[0.06] rounded-3xl p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.04]">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center">
                <Send size={15} />
              </div>
              <h2 className="text-sm font-bold text-[#0f172a] tracking-tight">Soạn thông báo & Email gửi hàng loạt</h2>
            </div>
            <span className="text-xs text-[#64748b]">
              Gửi ngay trong quota, phần vượt quota tự động vào hàng đợi
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Nhóm đối tượng nhận
              </label>
              <select
                value={manualNotice.target}
                onChange={(e) => setManualNotice((prev) => ({ ...prev, target: e.target.value }))}
                className="w-full border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs bg-[#f8fafc] focus:bg-white text-[#0f172a] outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1]"
              >
                <option value="system_all">Cả hệ thống (1 bản ghi website chung)</option>
                <option value="students_with_registration">Sinh viên đã đăng ký</option>
                <option value="students_approved">Sinh viên có đăng ký đã duyệt</option>
                <option value="students_rejected">Sinh viên có đăng ký bị từ chối</option>
                <option value="students_pending">Sinh viên có đăng ký chờ duyệt</option>
                <option value="all_students">Tất cả sinh viên (tạo từng thông báo)</option>
                <option value="lecturers">Giảng viên có email trong danh sách</option>
                <option value="single_account">Một tài khoản cụ thể</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Phương thức phát hành
              </label>
              <select
                value={manualNotice.delivery_mode}
                onChange={(e) => setManualNotice((prev) => ({ ...prev, delivery_mode: e.target.value }))}
                className="w-full border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-xs bg-[#f8fafc] focus:bg-white text-[#0f172a] outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1]"
              >
                <option value="website_and_email">Hiển thị trên website và gửi email theo quota</option>
                <option value="website_only">Chỉ hiển thị trên website</option>
              </select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#64748b]">
                {manualNotice.delivery_mode === 'website_and_email'
                  ? `Email được gửi ngay trong quota còn lại${stats ? ` (${stats.remaining_today || 0})` : ''}; phần vượt quota sẽ chờ gửi sau.`
                  : 'Thông báo chỉ xuất hiện trên website và không gọi dịch vụ email.'}
              </p>
            </div>
          </div>

          {manualNotice.target === 'single_account' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
                Người nhận cụ thể
              </label>
              <input
                value={manualNotice.recipient}
                onChange={(e) => setManualNotice((prev) => ({ ...prev, recipient: e.target.value }))}
                placeholder="Nhập email VNU (@vnu.edu.vn) hoặc Mã số sinh viên..."
                className="w-full px-3.5 py-2.5 border border-black/[0.08] rounded-xl text-xs bg-[#f8fafc] focus:bg-white outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1]"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
              Tiêu đề thông báo / email
            </label>
            <input
              value={manualNotice.subject}
              onChange={(e) => setManualNotice((prev) => ({ ...prev, subject: e.target.value }))}
              placeholder="VD: [FIT-UET] Nhắc nhở nộp báo cáo thực tập tốt nghiệp..."
              className="w-full px-3.5 py-2.5 border border-black/[0.08] rounded-xl text-xs bg-[#f8fafc] focus:bg-white outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-1.5">
              Nội dung thông báo
            </label>
            <textarea
              value={manualNotice.body}
              onChange={(e) => setManualNotice((prev) => ({ ...prev, body: e.target.value }))}
              placeholder="Nhập chi tiết nội dung thông báo gửi đến người dùng..."
              rows={4}
              className="w-full px-3.5 py-2.5 border border-black/[0.08] rounded-xl text-xs bg-[#f8fafc] focus:bg-white outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] resize-y leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowManualComposer(false)}
              className="px-4 py-2 rounded-full border border-black/[0.08] text-xs font-semibold text-[#0f172a] hover:bg-[#f8fafc] cursor-pointer"
            >
              Đóng
            </button>
            <button
              onClick={createManualNotice}
              disabled={creatingManual}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              {creatingManual ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              {creatingManual ? 'Đang gửi...' : 'Gửi thông báo'}
            </button>
          </div>
        </div>
      )}

      {/* Apple Unified Actions & Filters Bar */}
      <div className="bg-white border border-black/[0.06] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Search & Filter Pills */}
        <div className="flex flex-1 flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" size={14} />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm email, sinh viên, tiêu đề..."
              className="w-full pl-9 pr-4 py-2 border border-black/[0.08] rounded-full text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all text-[#0f172a]"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-black/[0.08] rounded-full px-3.5 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer"
          >
            <option value="">Tất cả loại thông báo</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {notificationTypeLabel(type)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-black/[0.08] rounded-full px-3.5 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="queued">Queued (Chờ gửi)</option>
            <option value="sent">Sent (Đã gửi)</option>
            <option value="failed">Failed (Lỗi)</option>
            <option value="website_only">Chỉ website</option>
          </select>
        </div>

        {/* Right: Quick Action Capsule Triggers */}
        <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
          <button
            onClick={() => sendQueued('all', 'quota')}
            disabled={sendingQueue || !stats?.statuses?.queued || !stats?.remaining_today}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {sendingQueue ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            Gửi theo quota
          </button>
          <button
            onClick={createFinalConfirmationOpen}
            disabled={creatingReminders}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <CheckCircle2 size={13} className="text-[#15803d]" />
            Mở xác nhận TT
          </button>
          <button
            onClick={createFinalReportReminders}
            disabled={creatingReminders}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {creatingReminders ? <RefreshCw size={13} className="animate-spin" /> : <Clock size={13} className="text-[#c2410c]" />}
            Nhắc nộp báo cáo
          </button>
          {selectedCount > 0 && (
            <button
              onClick={() => deleteNotifications('selected')}
              disabled={deletingNotifications}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#b91c1c] bg-[#fee2e2] hover:bg-[#ffe5e3] border border-[#fecaca] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Trash2 size={13} />
              Xóa {selectedCount} đã chọn
            </button>
          )}
        </div>
      </div>

      {/* Apple Inset Grouped Table */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#334155]">
            <thead className="bg-[#f8fafc] text-[11px] uppercase font-bold text-[#64748b] tracking-wider border-b border-black/[0.05] select-none">
              <tr>
                <th className="px-5 py-3.5 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={pageSelected}
                    disabled={paginatedIds.length === 0}
                    onChange={(e) => toggleCurrentPageSelection(e.target.checked)}
                    className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1] cursor-pointer"
                    title="Chọn tất cả trong trang"
                  />
                </th>
                <th className="px-5 py-3.5">
                  <button
                    onClick={() => sortNotifications('recipient')}
                    className="font-bold hover:text-[#0f172a] flex items-center gap-1 cursor-pointer"
                  >
                    Người nhận {sortLabel('recipient')}
                  </button>
                </th>
                <th className="px-5 py-3.5">
                  <button
                    onClick={() => sortNotifications('type')}
                    className="font-bold hover:text-[#0f172a] flex items-center gap-1 cursor-pointer"
                  >
                    Loại {sortLabel('type')}
                  </button>
                </th>
                <th className="px-5 py-3.5">
                  <button
                    onClick={() => sortNotifications('created_at')}
                    className="font-bold hover:text-[#0f172a] flex items-center gap-1 cursor-pointer"
                  >
                    Nội dung thông báo {sortLabel('created_at')}
                  </button>
                </th>
                <th className="px-5 py-3.5">
                  <button
                    onClick={() => sortNotifications('status')}
                    className="font-bold hover:text-[#0f172a] flex items-center gap-1 cursor-pointer"
                  >
                    Trạng thái {sortLabel('status')}
                  </button>
                </th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {sortedFiltered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-[#64748b]">
                    Không có thông báo phù hợp với bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#f8fafc]/60 transition-colors align-top">
                    <td className="px-5 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedNotificationIds.includes(Number(row.id))}
                        onChange={(e) => toggleNotificationSelection(Number(row.id), e.target.checked)}
                        className="rounded border-slate-300 text-[#b91c1c] focus:ring-[#b91c1c] cursor-pointer"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-[#0f172a] text-xs">{row.recipient_email}</div>
                      <div className="text-[11px] text-[#64748b] mt-0.5">
                        {row.user_name || '-'} {row.student_id ? `· ${row.student_id}` : ''}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-block text-[10px] font-semibold bg-[#f8fafc] text-[#0f172a] px-2.5 py-0.5 rounded-full border border-black/[0.04] whitespace-nowrap">
                        {notificationTypeLabel(row.type)}
                      </span>
                    </td>
                    <td className="px-5 py-4 max-w-xl">
                      <div className="font-bold text-[#0f172a] text-xs">{row.subject}</div>
                      <div className="text-[11px] text-[#334155] whitespace-pre-wrap mt-1 leading-relaxed line-clamp-2">
                        {row.body}
                      </div>
                      <div className="text-[10px] text-[#64748b] mt-1 font-mono">
                        Tạo: {row.created_at ? new Date(row.created_at).toLocaleString('vi-VN') : '-'}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          row.status === 'sent'
                            ? 'bg-[#dcfce7] text-[#1d833f] border-emerald-200/60'
                            : row.status === 'failed'
                            ? 'bg-[#fee2e2] text-[#b91c1c] border-rose-200/60'
                            : row.status === 'website_only'
                            ? 'bg-[#034ea1]/10 text-[#034ea1] border-[#034ea1]/20'
                            : 'bg-[#ffedd5] text-[#b25e00] border-amber-200/60'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            row.status === 'sent'
                              ? 'bg-[#15803d]'
                              : row.status === 'failed'
                              ? 'bg-[#b91c1c]'
                              : row.status === 'website_only'
                              ? 'bg-[#034ea1]'
                              : 'bg-[#c2410c]'
                          }`}
                        />
                        {row.status}
                      </span>
                      {row.error && <div className="text-[10px] text-[#b91c1c] mt-1 font-medium">{row.error}</div>}
                      {row.sent_at && (
                        <div className="text-[10px] text-[#64748b] mt-0.5">
                          Gửi: {new Date(row.sent_at).toLocaleString('vi-VN')}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => markStatus(row.id, 'sent')}
                          title="Đánh dấu đã gửi"
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#1d833f] hover:bg-[#dcfce7] transition-colors cursor-pointer"
                        >
                          Sent
                        </button>
                        <button
                          onClick={() => markStatus(row.id, 'queued')}
                          title="Đưa lại vào queue"
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b25e00] hover:bg-[#ffedd5] transition-colors cursor-pointer"
                        >
                          Queue
                        </button>
                        <button
                          onClick={() => markStatus(row.id, 'failed')}
                          title="Đánh dấu lỗi"
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-[#b91c1c] hover:bg-[#fee2e2] transition-colors cursor-pointer"
                        >
                          Fail
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          total={sortedFiltered.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="thông báo"
        />
      </div>
    </div>
  );
}
