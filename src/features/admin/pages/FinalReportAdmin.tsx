import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Download, Search, FileText, ChevronLeft, CheckCircle2, AlertCircle, Clock, FileCheck } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, saveXlsx, paginationBounds, PaginationControls, PageDescriptionTooltip, formatCourseCode, cleanStudentName } from '../../../shared';

export function FinalReportAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const formatBytes = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusLabel = (status?: string) =>
    status === 'accepted'
      ? 'Đã chấp nhận'
      : status === 'needs_revision'
      ? 'Cần nộp lại'
      : status === 'submitted'
      ? 'Đã nộp'
      : 'Chưa nộp';

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/reports/final`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      alert('Không tải được danh sách báo cáo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [token]);

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

  const filtered = rows.filter((row) => {
    const term = searchTerm.trim().toLowerCase();
    const status = row.report_status || 'missing';
    const matchStatus = statusFilter ? status === statusFilter : true;
    const matchTerm =
      !term ||
      row.student_id?.toLowerCase().includes(term) ||
      row.student_name?.toLowerCase().includes(term) ||
      row.internship_place?.toLowerCase().includes(term) ||
      row.primary_advisors?.toLowerCase().includes(term) ||
      row.co_advisors?.toLowerCase().includes(term);
    return matchStatus && matchTerm;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, rows.length]);

  const pagination = paginationBounds(filtered.length, currentPage, pageSize);
  const paginatedRows = filtered.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);

  const reportStats = {
    missing: rows.filter((row) => (row.report_status || 'missing') === 'missing').length,
    submitted: rows.filter((row) => row.report_status === 'submitted').length,
    needs_revision: rows.filter((row) => row.report_status === 'needs_revision').length,
    accepted: rows.filter((row) => row.report_status === 'accepted').length,
  };

  const exportXlsx = () => {
    const headers = [
      'STT',
      'Mã SV',
      'Họ tên',
      'Lớp',
      'Mã môn',
      'Nơi thực tập',
      'GVHD chính',
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
      cleanStudentName(row.student_name, row.student_id),
      row.class_name || '',
      formatCourseCode(row.course_code),
      row.internship_place || '',
      row.primary_advisors || '',
      row.co_advisors || '',
      statusLabel(row.report_status),
      row.original_filename || '',
      row.file_size || '',
      row.report_submitted_at || '',
      row.lecturer_comment || '',
    ]);
    saveXlsx('bao_cao_thuc_tap.xlsx', headers, data, 'Báo cáo');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#86868b]">
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
            className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#86868b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
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

        {/* Top Action */}
        <button
          onClick={exportXlsx}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <Download size={14} className="text-[#86868b]" />
          Xuất XLSX
        </button>
      </div>

      {/* Apple Executive KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#86868b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa nộp</span>
            <Clock size={16} className="text-[#86868b]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#86868b] tracking-tight">{reportStats.missing}</span>
            <span className="text-xs text-[#86868b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#86868b] mt-2 font-medium">Cần gửi thông báo nhắc</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#86868b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã nộp (Chờ duyệt)</span>
            <FileText size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#034ea1] tracking-tight">{reportStats.submitted}</span>
            <span className="text-xs text-[#86868b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-2 font-medium">Chờ giảng viên phản hồi</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#86868b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Cần nộp lại</span>
            <AlertCircle size={16} className="text-[#ff9500]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#ff9500] tracking-tight">{reportStats.needs_revision}</span>
            <span className="text-xs text-[#86868b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#ff9500] mt-2 font-medium">Yêu cầu bổ sung nội dung</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#86868b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã chấp nhận</span>
            <FileCheck size={16} className="text-[#34c759]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#34c759] tracking-tight">{reportStats.accepted}</span>
            <span className="text-xs text-[#86868b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#1d833f] mt-2 font-medium">Đạt điều kiện chấm điểm</span>
        </div>
      </div>

      {/* Apple Search & Filter Pill Bar */}
      <div className="bg-white border border-black/[0.06] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full md:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868b]" size={14} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã sinh viên, họ tên, nơi thực tập, GVHD..."
            className="w-full pl-9 pr-4 py-2 border border-black/[0.08] rounded-full text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all text-[#0f172a]"
          />
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full md:w-auto border border-black/[0.08] rounded-full px-4 py-2 text-xs font-semibold bg-[#f8fafc] hover:bg-[#e8e8ed] text-[#0f172a] outline-none cursor-pointer"
          >
            <option value="">Tất cả trạng thái nộp</option>
            <option value="missing">Chưa nộp</option>
            <option value="submitted">Đã nộp (Chờ duyệt)</option>
            <option value="needs_revision">Cần nộp lại</option>
            <option value="accepted">Đã chấp nhận</option>
          </select>
        </div>
      </div>

      {/* Apple Inset Grouped Table */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#6e6e73]">
            <thead className="bg-[#fbfbfd] text-[11px] uppercase font-bold text-[#86868b] tracking-wider border-b border-black/[0.05] select-none">
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
                  <td colSpan={5} className="px-5 py-16 text-center text-[#86868b]">
                    Không có sinh viên hoặc báo cáo phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.user_id} className="hover:bg-[#f8fafc]/60 transition-colors align-top">
                    <td className="px-5 py-4">
                      <div className="font-bold text-[#0f172a] text-xs">{cleanStudentName(row.student_name, row.student_id)}</div>
                      <div className="text-xs text-[#86868b] font-mono mt-0.5">{row.student_id || '-'}</div>
                      <div className="text-[11px] text-[#86868b] mt-0.5">
                        {row.class_name || '-'} · {row.course_code || '-'}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[#0f172a] font-medium">{row.internship_place || '-'}</td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-[#0f172a]">{row.primary_advisors || '-'}</div>
                      {row.co_advisors && (
                        <div className="text-[11px] text-[#86868b] mt-0.5">Đồng HD: {row.co_advisors}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          row.report_status === 'accepted'
                            ? 'bg-[#ebf9ee] text-[#1d833f] border-emerald-200/60'
                            : row.report_status === 'needs_revision'
                            ? 'bg-[#fff8eb] text-[#b25e00] border-amber-200/60'
                            : row.report_status === 'submitted'
                            ? 'bg-[#034ea1]/10 text-[#034ea1] border-[#034ea1]/20'
                            : 'bg-[#f8fafc] text-[#86868b] border-black/[0.04]'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            row.report_status === 'accepted'
                              ? 'bg-[#34c759]'
                              : row.report_status === 'needs_revision'
                              ? 'bg-[#ff9500]'
                              : row.report_status === 'submitted'
                              ? 'bg-[#034ea1]'
                              : 'bg-[#86868b]'
                          }`}
                        />
                        {statusLabel(row.report_status)}
                      </span>

                      {row.original_filename && (
                        <div className="text-[11px] text-[#86868b] mt-1 font-mono">
                          {row.original_filename} · {formatBytes(Number(row.file_size || 0))}
                        </div>
                      )}
                      {row.report_submitted_at && (
                        <div className="text-[10px] text-[#86868b] mt-0.5">
                          Nộp lúc: {new Date(row.report_submitted_at).toLocaleString('vi-VN')}
                        </div>
                      )}
                      {row.lecturer_comment && (
                        <div className="text-[11px] text-[#b25e00] mt-1.5 font-medium bg-[#fff8eb] p-2 rounded-xl border border-amber-100">
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
                            className="px-3 py-1 rounded-full text-xs font-semibold text-[#1d833f] bg-[#ebf9ee] hover:bg-emerald-100 transition-colors cursor-pointer"
                          >
                            Duyệt
                          </button>
                          <button
                            onClick={() => updateStatus(row.user_id, 'needs_revision')}
                            className="px-3 py-1 rounded-full text-xs font-semibold text-[#b25e00] bg-[#fff8eb] hover:bg-amber-100 transition-colors cursor-pointer"
                          >
                            Yêu cầu sửa
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-[#86868b] italic">Chưa có file</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          total={filtered.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="báo cáo"
        />
      </div>
    </div>
  );
}
