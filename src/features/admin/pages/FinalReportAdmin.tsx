import { useLegacyPager } from '../../academic/useLegacyPager';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useLegacySearch, useLegacyMembership, legacyStudentInScope } from '../../academic/LegacyListScope';
import { matchesCourseCode } from '../../../shared/utils/format';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { Download, Search, FileText, ChevronLeft, CheckCircle2, AlertCircle, Clock, FileCheck, Mail, X, Loader2, Send } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, saveXlsx, paginationBounds, PaginationControls, PageDescriptionTooltip, formatCourseCode, cleanStudentName } from '../../../shared';

export function FinalReportAdmin({ token, initialCourseCode = '' }: { token: string; initialCourseCode?: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useLegacySearch();
  const legacyMembership = useLegacyMembership();
  const [statusFilter, setStatusFilter] = useState('');
  const [courseCodeFilter, setCourseCodeFilter] = useState('');
  const [advisorFilter, setAdvisorFilter] = useState('');
  const [showRemindModal, setShowRemindModal] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [pendingRows, setPendingRows] = useState<any[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [remindSuccess, setRemindSuccess] = useState<string | null>(null);
  const [customRemindNote, setCustomRemindNote] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const paging = useLegacyPager(token, '/api/admin/reports/final', { page: currentPage, q: searchTerm, status: statusFilter, courseCode: initialCourseCode || courseCodeFilter, advisor: advisorFilter });

  const formatBytes = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusLabel = (status?: string) =>
    status === 'accepted'
      ? 'Đã duyệt'
      : status === 'needs_revision'
      ? 'Cần nộp lại'
      : status === 'submitted'
      ? 'Đã nộp'
      : 'Chưa nộp';

  const fetchRows = async () => {
    setLoading(true);
    try {
      setRows(await paging.load());
    } catch (e) {
      if (e.name === 'AbortError') return;
      setRows([]);
      alert('Không tải được danh sách báo cáo.');
    } finally {
      setLoading(false);
    }
  };
  paging.bind(fetchRows);

  useEffect(() => {
    fetchRows();
  }, [token, paging.key]);

  const downloadReport = async (userId: number, filename: string) => {
    const res = await fetch(`${API_BASE}/api/reports/final/${userId}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('Không tải được báo cáo.');
    saveAs(await res.blob(), filename || 'final-report.pdf');
  };

  const updateStatus = async (userId: number, status: string) => {
    const lecturer_comment = status === 'needs_revision' ? prompt('Ghi chú yêu cầu sinh viên nộp lại:', '') || '' : '';
    const res = await fetch(`${API_BASE}/api/reports/final/${userId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, lecturer_comment }),
    });
    if (res.ok) fetchRows();
    else alert('Cập nhật trạng thái thất bại.');
  };

  const advisorOptions = useMemo(() => {
    const set = new Set<string>();
    const source = paging.summary?.advisorOptions ? JSON.parse(paging.summary.advisorOptions).map(primary_advisors => ({primary_advisors})) : rows;
    source.forEach(r => {
      if (r.primary_advisors) {
        r.primary_advisors.split(',').forEach((name: string) => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== 'Giảng viên đã bị xóa') set.add(trimmed);
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [rows, paging.summary]);

  const pendingStudents = useMemo(() => {
    return pendingRows.filter(r => !r.report_status || r.report_status === 'missing' || r.report_status === 'needs_revision');
  }, [pendingRows]);
  const openReminders = async () => {
    setShowRemindModal(true); setLoadingRecipients(true); setPendingRows([]); setSelectedStudentIds([]);
    try {
      const all = await paging.allRows();
      const pending = all.filter(r => !r.report_status || r.report_status === 'missing' || r.report_status === 'needs_revision');
      setPendingRows(pending); setSelectedStudentIds(pending.map(r=>Number(r.user_id)));
    } catch { alert('Không tải được danh sách người nhận.'); }
    finally { setLoadingRecipients(false); }
  };

  const filtered = rows.filter((row) => {
    const term = searchTerm.trim().toLowerCase();
    const status = row.report_status || 'missing';
    const matchStatus = statusFilter ? status === statusFilter : true;
    const matchCourse = legacyStudentInScope(legacyMembership, row.student_id) && (!initialCourseCode || matchesCourseCode(row.course_code, initialCourseCode)) && (courseCodeFilter ? matchesCourseCode(row.course_code, courseCodeFilter) : true);
    const matchAdvisor = advisorFilter ? (row.primary_advisors || '').includes(advisorFilter) : true;
    const matchTerm =
      !term ||
      row.student_id?.toLowerCase().includes(term) ||
      row.student_name?.toLowerCase().includes(term) ||
      row.email?.toLowerCase().includes(term) ||
      cleanStudentName(row.student_name, row.student_id, row.email).toLowerCase().includes(term) ||
      row.internship_place?.toLowerCase().includes(term) ||
      row.primary_advisors?.toLowerCase().includes(term) ||
      row.co_advisors?.toLowerCase().includes(term);
    return matchStatus && matchCourse && matchAdvisor && matchTerm;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, courseCodeFilter, advisorFilter]);

  const pagination = paginationBounds(paging.page?.total ?? filtered.length, currentPage, pageSize);
  const paginatedRows = paging.page ? filtered : filtered.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);

  const reportStats = {
    missing: paging.summary?.report_missing ?? rows.filter((row) => (row.report_status || 'missing') === 'missing').length,
    submitted: paging.summary?.report_submitted ?? rows.filter((row) => row.report_status === 'submitted').length,
    needs_revision: paging.summary?.report_needs_revision ?? rows.filter((row) => row.report_status === 'needs_revision').length,
    accepted: paging.summary?.report_accepted ?? rows.filter((row) => row.report_status === 'accepted').length,
  };

  const exportXlsx = async () => {
    const filtered = await paging.allRows();
    const headers = [
      'STT',
      'Mã SV',
      'Họ và tên',
      'Email VNU',
      'Lớp',
      'Mã môn',
      'Nơi thực tập',
      'GVHD chính',
      'Email GVHD',
      'Đồng hướng dẫn',
      'Trạng thái',
      'Tên file',
      'Dung lượng',
      'Nộp lúc',
      'Ghi chú',
    ];
    const data = filtered.map((row, idx) => [
      idx + 1,
      row.student_id || '',
      cleanStudentName(row.student_name, row.student_id, row.email),
      row.email || '',
      row.class_name || '',
      formatCourseCode(row.course_code),
      row.internship_place || '',
      row.primary_advisors || '',
      row.primary_advisors_email || '',
      row.co_advisors || '',
      statusLabel(row.report_status),
      row.original_filename || '',
      formatBytes(row.file_size),
      row.report_submitted_at || '',
      row.lecturer_comment || '',
    ]);
    await saveXlsx('bao_cao_thuc_tap.xlsx', headers, data, 'Báo cáo');
  };

  const handleSendReminders = async () => {
    setReminding(true);
    setRemindSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/remind-pending-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userIds: selectedStudentIds.length > 0 ? selectedStudentIds : undefined,
          customNote: customRemindNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi nhắc nhở thất bại.');
      setRemindSuccess(`Đã gửi email nhắc nhở thành công tới ${data.count || 0} sinh viên!`);
      setTimeout(() => {
        setShowRemindModal(false);
        setRemindSuccess(null);
        setCustomRemindNote('');
      }, 2000);
    } catch (e: any) {
      alert(e.message || 'Lỗi kết nối khi gửi nhắc nhở.');
    } finally {
      setReminding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#64748b]">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải danh sách báo cáo...</span>
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
              <FileText size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Quản lý Báo cáo thực tập
                <PageDescriptionTooltip description="Theo dõi báo cáo PDF cuối kỳ của sinh viên đã xác nhận nơi thực tập, tải file và duyệt trạng thái." />
              </h1>
            </div>

          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={openReminders}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#b45309] bg-amber-50 border border-amber-200 hover:bg-amber-100 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shadow-xs"
            title="Gửi email nhắc nhở sinh viên chưa nộp báo cáo hoặc cần nộp lại"
          >
            <Mail size={14} className="text-amber-600" />
            Nhắc SV chưa nộp ({(paging.summary?.report_missing ?? rows.filter(r=>!r.report_status||r.report_status==='missing').length) + (paging.summary?.report_needs_revision ?? rows.filter(r=>r.report_status==='needs_revision').length)})
          </button>
          <button
            onClick={exportXlsx}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <Download size={14} className="text-[#64748b]" />
            Xuất XLSX ({filtered.length})
          </button>
        </div>
      </div>

      {/* Apple Executive KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa nộp</span>
            <Clock size={16} className="text-[#64748b]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#64748b] tracking-tight">{reportStats.missing}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#64748b] mt-2 font-medium">Cần gửi thông báo nhắc</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã nộp (Chờ duyệt)</span>
            <FileText size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#034ea1] tracking-tight">{reportStats.submitted}</span>
            <span className="text-xs text-[#64748b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-2 font-medium">Chờ giảng viên phản hồi</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Cần nộp lại</span>
            <AlertCircle size={16} className="text-[#c2410c]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#c2410c] tracking-tight">{reportStats.needs_revision}</span>
            <span className="text-xs text-[#64748b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#c2410c] mt-2 font-medium">Yêu cầu bổ sung nội dung</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã duyệt</span>
            <FileCheck size={16} className="text-[#15803d]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#15803d] tracking-tight">{reportStats.accepted}</span>
            <span className="text-xs text-[#64748b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#1d833f] mt-2 font-medium">Báo cáo hợp lệ</span>
        </div>
      </div>

      {/* Apple Search & Filter Pill Bar */}
      <div className="bg-white border border-black/[0.06] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full md:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" size={14} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã sinh viên, họ tên, nơi thực tập, GVHD..."
            className="w-full pl-9 pr-4 py-2 border border-black/[0.08] rounded-full text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all text-[#0f172a]"
          />
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto w-full md:w-auto flex-wrap">
          <select
            value={courseCodeFilter}
            onChange={(e) => setCourseCodeFilter(e.target.value)}
            className="border border-black/[0.08] rounded-full px-3.5 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer"
          >
            <option value="">Tất cả học phần</option>
            <option value="INT3508">INT3508 - TT Chuyên ngành</option>
            <option value="INT4002">INT4002 - TT Doanh nghiệp</option>
            <option value="INT4003">INT4003 - TT DN Nhật Bản</option>
          </select>

          <select
            value={advisorFilter}
            onChange={(e) => setAdvisorFilter(e.target.value)}
            className="border border-black/[0.08] rounded-full px-3.5 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer max-w-[180px] truncate"
          >
            <option value="">Tất cả GVHD</option>
            {advisorOptions.map((adv) => (
              <option key={adv} value={adv}>
                {adv}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-black/[0.08] rounded-full px-3.5 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer"
          >
            <option value="">Tất cả trạng thái nộp</option>
            <option value="missing">Chưa nộp</option>
            <option value="submitted">Đã nộp (Chờ duyệt)</option>
            <option value="needs_revision">Cần nộp lại</option>
            <option value="accepted">Đã duyệt</option>
          </select>
        </div>
      </div>

      {/* Apple Inset Grouped Table */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#334155]">
            <thead className="bg-[#f8fafc] text-[11px] uppercase font-bold text-[#64748b] tracking-wider border-b border-black/[0.05] select-none">
              <tr>
                <th className="px-5 py-3.5">Sinh viên</th>
                <th className="px-5 py-3.5">Nơi thực tập</th>
                <th className="px-5 py-3.5">Giảng viên hướng dẫn</th>
                <th className="px-5 py-3.5">Báo cáo PDF</th>
                <th className="px-5 py-3.5 text-right">Thao tác duyệt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-[#64748b]">
                    Không có sinh viên hoặc báo cáo phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.user_id} className="hover:bg-[#f8fafc]/60 transition-colors align-top">
                    <td className="px-5 py-4">
                      <div className="font-bold text-[#0f172a] text-xs">{cleanStudentName(row.student_name, row.student_id)}</div>
                      <div className="text-xs text-[#64748b] font-mono mt-0.5">{row.student_id || '-'}</div>
                      <div className="text-[11px] text-[#64748b] mt-0.5">
                        {row.class_name || '-'} · {row.course_code || '-'}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[#0f172a] font-medium">{row.internship_place || '-'}</td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-[#0f172a]">{row.primary_advisors || '-'}</div>
                      {row.co_advisors && (
                        <div className="text-[11px] text-[#64748b] mt-0.5">Đồng HD: {row.co_advisors}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          row.report_status === 'accepted'
                            ? 'bg-[#dcfce7] text-[#1d833f] border-emerald-200/60'
                            : row.report_status === 'needs_revision'
                            ? 'bg-[#ffedd5] text-[#b25e00] border-amber-200/60'
                            : row.report_status === 'submitted'
                            ? 'bg-[#034ea1]/10 text-[#034ea1] border-[#034ea1]/20'
                            : 'bg-[#fee2e2] text-[#b91c1c] border-red-200/60'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            row.report_status === 'accepted'
                              ? 'bg-[#15803d]'
                              : row.report_status === 'needs_revision'
                              ? 'bg-[#c2410c]'
                              : row.report_status === 'submitted'
                              ? 'bg-[#034ea1]'
                              : 'bg-[#b91c1c]'
                          }`}
                        />
                        {statusLabel(row.report_status)}
                      </span>

                      {row.original_filename && (
                        <div className="text-[11px] text-[#64748b] mt-1 font-mono">
                          {row.original_filename} · {formatBytes(Number(row.file_size || 0))}
                        </div>
                      )}
                      {row.report_submitted_at && (
                        <div className="text-[10px] text-[#64748b] mt-0.5">
                          Nộp lúc: {new Date(row.report_submitted_at).toLocaleString('vi-VN')}
                        </div>
                      )}
                      {row.lecturer_comment && (
                        <div className="text-[11px] text-[#b25e00] mt-1.5 font-medium bg-[#ffedd5] p-2 rounded-xl border border-amber-100">
                          Nhận xét: {row.lecturer_comment}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {row.report_id ? (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            onClick={() => downloadReport(row.user_id, row.original_filename)}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold text-[#034ea1] bg-[#034ea1]/10 hover:bg-[#034ea1]/20 transition-colors cursor-pointer"
                          >
                            <Download size={12} />
                            Tải PDF
                          </button>
                          <button
                            onClick={() => updateStatus(row.user_id, 'accepted')}
                            className="px-3 py-1 rounded-full text-xs font-semibold text-[#1d833f] bg-[#dcfce7] hover:bg-emerald-100 transition-colors cursor-pointer"
                          >
                            Duyệt
                          </button>
                          <button
                            onClick={() => updateStatus(row.user_id, 'needs_revision')}
                            className="px-3 py-1 rounded-full text-xs font-semibold text-[#b25e00] bg-[#ffedd5] hover:bg-amber-100 transition-colors cursor-pointer"
                          >
                            Yêu cầu sửa
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-[#64748b] italic">Chưa có file</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          total={paging.page?.total ?? filtered.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="báo cáo"
        />
      </div>

      {/* Modal Nhắc Sinh Viên Nộp Báo Cáo */}
      {showRemindModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={(e) => { if (e.target === e.currentTarget) setShowRemindModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-100">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Mail size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Gửi Email Nhắc Sinh Viên Nộp Báo Cáo</h3>
                  <p className="text-[11px] text-slate-500">Tự động gửi email tới hộp thư VNU (@vnu.edu.vn) và chuông thông báo</p>
                </div>
              </div>
              <button
                onClick={() => setShowRemindModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
              {remindSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  {remindSuccess}
                </div>
              )}

              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-1.5">
                <div className="font-bold text-amber-900 flex items-center justify-between">
                  <span>Đối tượng nhận thông báo:</span>
                  <span className="text-amber-800 font-extrabold">{selectedStudentIds.length} / {pendingStudents.length} sinh viên</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Bao gồm các sinh viên trong danh sách thực tập chính thức <strong>chưa nộp file báo cáo PDF</strong> hoặc <strong>được yêu cầu nộp lại</strong>.
                </p>
              </div>

              {/* Danh sách sinh viên */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                    Danh sách sinh viên ({selectedStudentIds.length}):
                  </label>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSelectedStudentIds(pendingStudents.map(s => Number(s.user_id)))}
                      className="text-[#034ea1] hover:underline font-semibold cursor-pointer"
                    >
                      Chọn tất cả
                    </button>
                    <span>|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStudentIds([])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>
                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-[#f8fafc]">
                  {loadingRecipients ? <div role="status" className="p-4">Đang tải đầy đủ người nhận…</div> : pendingStudents.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 italic">Không có sinh viên nào đang thiếu báo cáo.</div>
                  ) : (
                    pendingStudents.map((s) => {
                      const isSelected = selectedStudentIds.includes(Number(s.user_id));
                      return (
                        <label
                          key={s.user_id}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-white transition-colors cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedStudentIds(prev => [...prev, Number(s.user_id)]);
                              else setSelectedStudentIds(prev => prev.filter(id => id !== Number(s.user_id)));
                            }}
                            className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1]"
                          />
                          <span className="font-bold text-slate-800 w-20 shrink-0">{s.student_id}</span>
                          <span className="font-medium text-slate-900 flex-1 truncate">{s.student_name}</span>
                          <span className="text-[11px] text-slate-500 shrink-0">{s.class_name || s.course_code || '-'}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            s.report_status === 'needs_revision'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {s.report_status === 'needs_revision' ? 'Cần nộp lại' : 'Chưa nộp'}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Ghi chú thêm từ giáo vụ */}
              <div>
                <label className="block font-bold text-slate-800 text-[11px] uppercase tracking-wider mb-1">
                  Ghi chú bổ sung từ Giáo vụ Khoa (Tùy chọn):
                </label>
                <textarea
                  value={customRemindNote}
                  onChange={(e) => setCustomRemindNote(e.target.value)}
                  placeholder="Ví dụ: Đề nghị các bạn hoàn thành trước 17h00 ngày 25/06/2026 để Khoa tiến hành niêm phong danh sách..."
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs bg-[#f8fafc] focus:bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none"
                />
              </div>

              {/* Mẫu email preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 space-y-1">
                <span className="font-bold text-slate-700 block text-[10px] uppercase tracking-wider">Mẫu thư gửi đi:</span>
                <p><strong>Tiêu đề:</strong> [FIT-UET] Nhắc nộp Báo cáo Thực tập tốt nghiệp</p>
                <p><strong>Nội dung:</strong> Thông báo đích danh sinh viên, học phần, nơi thực tập, hạn chót và đính kèm link nộp trực tiếp.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowRemindModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={reminding || loadingRecipients || selectedStudentIds.length === 0}
                onClick={handleSendReminders}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {reminding ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Đang gửi email...
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    Gửi email nhắc nhở ({selectedStudentIds.length})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
