import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  Download,
  Search,
  Trash2,
  Lock,
  Unlock,
  AlertCircle,
  Mail,
  X,
  Loader2,
  Send,
  Copy,
  FileSpreadsheet,
  ChevronLeft,
  Clock,
  Users,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
} from 'lucide-react';
import {
  API_BASE,
  saveXlsx,
  saveMultiSheetXlsx,
  paginationBounds,
  PaginationControls,
  PageDescriptionTooltip,
  formatCourseCode,
  cleanStudentName,
} from '../../../shared';

export function GradeAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [courseCodeFilter, setCourseCodeFilter] = useState('');
  const [advisorFilter, setAdvisorFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [lockingBatch, setLockingBatch] = useState(false);
  const pageSize = 25;

  // Pending lecturers state for reminders and multi-sheet export
  const [pendingLecturers, setPendingLecturers] = useState<any[]>([]);
  const [deadline, setDeadline] = useState('');
  const [showRemindModal, setShowRemindModal] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [remindSuccess, setRemindSuccess] = useState<string | null>(null);
  const [customRemindNote, setCustomRemindNote] = useState('');
  const [selectedLecturerIds, setSelectedLecturerIds] = useState<number[]>([]);
  const [expandedLecturerId, setExpandedLecturerId] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [modalTab, setModalTab] = useState<'recipients' | 'preview'>('recipients');
  const [previewLecturerId, setPreviewLecturerId] = useState<number | null>(null);

  const currentPreviewGv = useMemo(() => {
    if (!pendingLecturers || pendingLecturers.length === 0) return null;
    if (previewLecturerId) {
      const match = pendingLecturers.find((l) => Number(l.lecturer_id) === Number(previewLecturerId));
      if (match) return match;
    }
    return pendingLecturers[0];
  }, [pendingLecturers, previewLecturerId]);

  const statusLabel = (status?: string) => (status === 'submitted' || status === 'draft' ? 'Đã nộp' : 'Chưa có');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/grades`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const normalized = (Array.isArray(data) ? data : []).map((r) => ({
        ...r,
        grade_status: r.grade_status === 'draft' ? 'submitted' : r.grade_status,
      }));
      setRows(normalized);
    } catch (e) {
      alert('Không tải được bảng điểm.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingLecturers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/preview-pending-lecturers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.lecturers) {
        setPendingLecturers(data.lecturers);
        setDeadline(data.deadline || '');
      }
    } catch (e) {
      console.error('Failed to preview pending lecturers', e);
    }
  };

  useEffect(() => {
    fetchRows();
    fetchPendingLecturers();
  }, [token]);

  const handleDeleteGradeRow = async (row: any) => {
    const displayName = cleanStudentName(row.student_name, row.student_id, row.email);
    if (
      !confirm(
        `Bạn có chắc chắn muốn xóa sinh viên ${displayName} (${row.student_id || '-'}) khỏi bảng điểm và danh sách thực tập chính thức không?`
      )
    )
      return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/final-internships/${row.user_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Xóa thất bại.');
      fetchRows();
      fetchPendingLecturers();
    } catch (e) {
      alert('Lỗi kết nối khi xóa.');
    }
  };

  const toggleLock = async (row: any) => {
    const locked = !row.locked_at;
    const res = await fetch(`${API_BASE}/api/admin/grades/${row.user_id}/lock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ locked }),
    });
    if (res.ok) fetchRows();
    else alert('Cập nhật khóa điểm thất bại.');
  };

  const handleLockAll = async (locked: boolean) => {
    if (locked) {
      const submittedCount = rows.filter(
        (r) => (r.grade_status === 'submitted' || r.final_score !== null) && !r.locked_at
      ).length;
      if (submittedCount === 0) {
        alert('Không có sinh viên nào có điểm đã nộp đang ở trạng thái chưa khóa.');
        return;
      }
      if (
        !confirm(
          `Bạn có chắc chắn muốn KHÓA ĐIỂM cho tất cả sinh viên đã có điểm (${submittedCount} sinh viên) không?\n\nSau khi khóa, giảng viên sẽ không thể chỉnh sửa điểm nếu chưa được Khoa mở khóa riêng.`
        )
      )
        return;
    } else {
      const lockedCount = rows.filter((r) => r.locked_at).length;
      if (lockedCount === 0) {
        alert('Hiện tại không có sinh viên nào đang bị khóa điểm.');
        return;
      }
      if (
        !confirm(
          `CẢNH BÁO: Bạn có chắc chắn muốn MỞ KHÓA TOÀN BỘ ${lockedCount} sinh viên không?\n\nGiảng viên sẽ có thể chỉnh sửa lại điểm (nếu còn trong thời hạn chấm điểm).`
        )
      )
        return;
    }

    setLockingBatch(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/grades/lock-all`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ locked, onlySubmitted: locked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Cập nhật khóa điểm thất bại.');
      alert(locked ? 'Đã khóa điểm thành công cho toàn bộ sinh viên đã nộp!' : 'Đã mở khóa toàn bộ bảng điểm thành công!');
      fetchRows();
    } catch (e: any) {
      alert(`Lỗi: ${e.message || 'Không thể cập nhật khóa điểm.'}`);
    } finally {
      setLockingBatch(false);
    }
  };

  const advisorOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.primary_advisors) {
        r.primary_advisors.split(',').forEach((name: string) => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== 'Giảng viên đã bị xóa') set.add(trimmed);
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [rows]);

  const lecturerStatsMap = useMemo(() => {
    const map = new Map<string, { total: number; submitted: number; missing: number }>();
    rows.forEach((r) => {
      if (r.primary_advisors) {
        r.primary_advisors.split(',').forEach((name: string) => {
          const trimmed = name.trim();
          if (!trimmed || trimmed === 'Giảng viên đã bị xóa') return;
          if (!map.has(trimmed)) {
            map.set(trimmed, { total: 0, submitted: 0, missing: 0 });
          }
          const stat = map.get(trimmed)!;
          stat.total += 1;
          if (r.grade_status === 'submitted') {
            stat.submitted += 1;
          } else {
            stat.missing += 1;
          }
        });
      }
    });
    return map;
  }, [rows]);

  const filtered = rows.filter((row) => {
    const term = searchTerm.trim().toLowerCase();
    const status = row.grade_status || 'missing';
    const matchStatus = statusFilter ? status === statusFilter : true;
    const matchCourse = courseCodeFilter ? row.course_code === courseCodeFilter : true;
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
  }, [searchTerm, statusFilter, courseCodeFilter, advisorFilter, rows.length]);

  const pagination = paginationBounds(filtered.length, currentPage, pageSize);
  const paginatedRows = filtered.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);

  const gradeStats = {
    total: rows.length,
    submitted: rows.filter((r) => r.grade_status === 'submitted').length,
    missing: rows.filter((r) => (r.grade_status || 'missing') === 'missing').length,
    pendingLecturersCount: pendingLecturers.length,
  };

  const formatGradingLecturer = (name?: string) => {
    if (!name || name === 'Giảng viên đã bị xóa') return '';
    return name;
  };

  const exportXlsx = () => {
    const headers = [
      'STT',
      'Mã SV',
      'Họ tên',
      'Email VNU',
      'Lớp',
      'Mã học phần',
      'Nơi thực tập',
      'GVHD chính',
      'Email GVHD',
      'Đồng hướng dẫn',
      'Điểm định kỳ',
      'Điểm báo cáo',
      'Điểm công ty/GVHD',
      'Điểm tổng kết',
      'Trạng thái',
      'Người nhập',
      'Nộp điểm lúc',
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
      row.progress_score ?? '',
      row.report_score ?? '',
      row.company_score ?? '',
      row.final_score !== null && row.final_score !== undefined && row.final_score !== ''
        ? Number(row.final_score).toFixed(1)
        : '',
      statusLabel(row.grade_status),
      formatGradingLecturer(row.grading_lecturer_name),
      row.grade_submitted_at || '',
      row.comment || '',
    ]);
    saveXlsx('bang_diem_thuc_tap.xlsx', headers, data, 'Bảng điểm');
  };

  const exportPendingLecturersXlsx = async () => {
    let list = pendingLecturers;
    if (!list || list.length === 0) {
      try {
        const res = await fetch(`${API_BASE}/api/admin/notifications/preview-pending-lecturers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.lecturers) {
          list = data.lecturers;
          setPendingLecturers(data.lecturers);
        }
      } catch (e) {
        // ignore
      }
    }

    if (!list || list.length === 0) {
      alert('Hiện tại không có giảng viên nào chưa nộp đủ điểm!');
      return;
    }

    // Sheet 1: Tổng hợp GV
    const summaryHeaders = [
      'STT',
      'Họ và tên GVHD',
      'Email GVHD',
      'Bộ môn / Đơn vị',
      'Tổng số SV phụ trách',
      'Số SV đã có điểm',
      'Số SV chưa hoàn thành',
      'Tỷ lệ hoàn thành (%)',
      'SV chờ GV chấm',
      'SV chưa nộp BC',
      'Tình trạng chung',
    ];

    const summaryRows = list.map((gv, idx) => {
      const stats = lecturerStatsMap.get(gv.lecturer_name);
      const total = stats?.total ?? gv.missing_count;
      const submitted = stats?.submitted ?? 0;
      const missing = gv.missing_count;
      const rate = total > 0 ? `${((submitted / total) * 100).toFixed(1)}%` : '0%';
      const statusNote =
        gv.waiting_for_lecturer > 0
          ? gv.waiting_for_student > 0
            ? 'Có SV chờ chấm & SV chưa nộp BC'
            : 'Đang chờ GV chấm điểm'
          : 'Chờ SV nộp báo cáo';

      return [
        idx + 1,
        gv.lecturer_name,
        gv.lecturer_email || '',
        gv.work_unit || 'Khoa CNTT',
        total,
        submitted,
        missing,
        rate,
        gv.waiting_for_lecturer,
        gv.waiting_for_student,
        statusNote,
      ];
    });

    // Sheet 2: Chi tiết SV thiếu điểm
    const detailHeaders = [
      'STT',
      'GVHD phụ trách',
      'Email GVHD',
      'Bộ môn GV',
      'Mã SV',
      'Họ và tên SV',
      'Email VNU',
      'Lớp',
      'Mã học phần',
      'Nơi thực tập',
      'Trạng thái báo cáo',
      'Tình trạng chấm điểm',
    ];

    const detailRows: any[][] = [];
    let studentIdx = 1;
    list.forEach((gv) => {
      gv.students.forEach((s: any) => {
        const bcText =
          s.report_status === 'submitted'
            ? 'Đã nộp báo cáo'
            : s.report_status === 'accepted'
            ? 'Đã duyệt báo cáo'
            : s.report_status === 'needs_revision'
            ? 'Cần nộp lại'
            : 'Chưa nộp báo cáo';
        const gradeCondition = s.waiting_for_grade ? 'Chờ GV chấm điểm' : 'Chờ SV nộp báo cáo';

        detailRows.push([
          studentIdx++,
          gv.lecturer_name,
          gv.lecturer_email || '',
          gv.work_unit || 'Khoa CNTT',
          s.student_id || '',
          s.student_name || '',
          s.student_email || '',
          s.class_name || '',
          formatCourseCode(s.course_code),
          s.internship_place || '',
          bcText,
          gradeCondition,
        ]);
      });
    });

    saveMultiSheetXlsx('danh_sach_gv_chua_nop_du_diem.xlsx', [
      { sheetName: 'Tổng hợp GV', headers: summaryHeaders, rows: summaryRows },
      { sheetName: 'Chi tiết SV thiếu điểm', headers: detailHeaders, rows: detailRows },
    ]);
  };

  const handleCopyEmails = async () => {
    let list = pendingLecturers;
    if (!list || list.length === 0) {
      try {
        const res = await fetch(`${API_BASE}/api/admin/notifications/preview-pending-lecturers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.lecturers) {
          list = data.lecturers;
          setPendingLecturers(data.lecturers);
        }
      } catch (e) {
        // ignore
      }
    }

    const emails = Array.from(new Set((list || []).map((l) => l.lecturer_email?.trim()).filter(Boolean)));

    if (emails.length === 0) {
      alert('Không tìm thấy email giảng viên nào để sao chép.');
      return;
    }

    try {
      await navigator.clipboard.writeText(emails.join(', '));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (e) {
      alert(`Không thể tự động sao chép. Vui lòng copy thủ công: \n\n${emails.join(', ')}`);
    }
  };

  const handleSendLecturerReminders = async () => {
    setReminding(true);
    setRemindSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/remind-pending-lecturers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          lecturerIds: selectedLecturerIds.length > 0 ? selectedLecturerIds : undefined,
          customNote: customRemindNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi nhắc nhở thất bại.');
      setRemindSuccess(`Đã gửi email nhắc nhở thành công tới ${data.count || 0} giảng viên!`);
      setTimeout(() => {
        setShowRemindModal(false);
        setRemindSuccess(null);
        setCustomRemindNote('');
        fetchPendingLecturers();
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
        <span className="text-xs font-medium">Đang tải bảng điểm...</span>
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
            <div className="w-10 h-10 rounded-2xl bg-[#1b7f37]/10 text-[#1b7f37] flex items-center justify-center shadow-inner shrink-0">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Bảng điểm thực tập
                <PageDescriptionTooltip description="Tổng hợp điểm 20% định kỳ, 20% báo cáo, 60% đánh giá công ty/GVHD. Hỗ trợ khóa điểm, xuất danh sách theo bộ lọc và nhắc nhở giảng viên nộp điểm." />
              </h1>
            </div>
          </div>
        </div>

        {/* Top Actions Toolbar */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => {
              const allIds = pendingLecturers.map((l) => Number(l.lecturer_id));
              setSelectedLecturerIds(allIds);
              setPreviewLecturerId(allIds[0] || null);
              setModalTab('recipients');
              setShowRemindModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#b45309] bg-amber-50 border border-amber-200 hover:bg-amber-100 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shadow-xs"
            title="Gửi email nhắc nhở giảng viên chưa hoàn thành điểm kèm danh sách sinh viên"
          >
            <Mail size={14} className="text-amber-600" />
            Nhắc GV chưa nộp ({pendingLecturers.length})
          </button>

          <button
            onClick={handleCopyEmails}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap shadow-xs active:scale-[0.98] ${
              copySuccess
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-white text-slate-700 border-black/[0.08] hover:bg-[#f8fafc]'
            }`}
            title="Sao chép toàn bộ email của các giảng viên chưa nộp đủ điểm để dán vào Outlook/Webmail"
          >
            {copySuccess ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-slate-500" />}
            {copySuccess ? 'Đã chép Email!' : 'Sao chép Email GV'}
          </button>

          <button
            onClick={exportPendingLecturersXlsx}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#034ea1] bg-[#034ea1]/10 border border-[#034ea1]/20 hover:bg-[#034ea1]/20 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shadow-xs"
            title="Xuất file Excel gồm 2 Sheet: Sheet 1 Tổng hợp GV và Sheet 2 Chi tiết SV chưa có điểm"
          >
            <FileSpreadsheet size={14} />
            Xuất DS GV chưa nộp đủ
          </button>

          <button
            onClick={exportXlsx}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            title="Xuất bảng điểm theo các bộ lọc hiện tại (kèm Email VNU và Email GVHD)"
          >
            <Download size={14} className="text-[#64748b]" />
            Xuất XLSX ({filtered.length})
          </button>
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Tổng sinh viên</span>
            <Users size={16} className="text-[#64748b]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0f172a] tracking-tight">{gradeStats.total}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#64748b] mt-2 font-medium">Danh sách thực tập chính thức</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã hoàn thành điểm</span>
            <CheckCircle2 size={16} className="text-[#15803d]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#15803d] tracking-tight">{gradeStats.submitted}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#15803d] mt-2 font-medium">
            {gradeStats.total > 0 ? `${((gradeStats.submitted / gradeStats.total) * 100).toFixed(1)}% hoàn thành` : '-'}
          </span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa có điểm</span>
            <Clock size={16} className="text-[#64748b]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#b91c1c] tracking-tight">{gradeStats.missing}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#b91c1c] mt-2 font-medium">Cần đôn đốc nộp điểm</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>GV chưa hoàn thành</span>
            <Mail size={16} className="text-[#b45309]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#b45309] tracking-tight">{gradeStats.pendingLecturersCount}</span>
            <span className="text-xs text-[#64748b]">giảng viên</span>
          </div>
          <span className="text-[11px] text-[#b45309] mt-2 font-medium">Chưa hoàn thiện toàn bộ điểm</span>
        </div>
      </div>

      {/* Search & Filter Pill Bar + Batch Lock Actions */}
      <div className="bg-white border border-black/[0.06] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full md:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748b]" size={14} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo MSSV, họ tên, email, nơi TT, GVHD..."
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
            <option value="">Tất cả trạng thái</option>
            <option value="missing">Chưa có</option>
            <option value="submitted">Đã nộp</option>
          </select>

          <button
            onClick={() => handleLockAll(true)}
            disabled={lockingBatch}
            title="Khóa toàn bộ điểm của các sinh viên đã nộp để niêm phong sổ điểm"
            className="bg-[#fee2e2] text-[#d70015] border border-[#fecaca] hover:bg-[#fecaca] px-3.5 py-2 rounded-full text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] disabled:opacity-50"
          >
            <Lock size={13} /> Khóa tất cả đã nộp
          </button>

          <button
            onClick={() => handleLockAll(false)}
            disabled={lockingBatch}
            title="Mở khóa cho toàn bộ bảng điểm"
            className="bg-white text-slate-700 border border-black/[0.08] hover:bg-slate-50 px-3.5 py-2 rounded-full text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] disabled:opacity-50"
          >
            <Unlock size={13} /> Mở khóa tất cả
          </button>
        </div>
      </div>

      {/* Grade Table */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#334155]">
            <thead className="bg-[#f8fafc] text-[11px] uppercase font-bold text-[#64748b] tracking-wider border-b border-black/[0.05] select-none">
              <tr>
                <th className="px-5 py-3.5">Sinh viên</th>
                <th className="px-5 py-3.5">Nơi thực tập</th>
                <th className="px-5 py-3.5">GVHD chính & Đồng HD</th>
                <th className="px-5 py-3.5">Chi tiết Điểm</th>
                <th className="px-5 py-3.5">Trạng thái</th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-[#64748b]">
                    Không có sinh viên hoặc điểm phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => (
                  <tr key={row.user_id} className="hover:bg-[#f8fafc]/60 transition-colors align-top">
                    <td className="px-5 py-4">
                      <div className="font-bold text-[#0f172a] text-xs">
                        {cleanStudentName(row.student_name, row.student_id, row.email)}
                      </div>
                      <div className="text-xs text-[#64748b] font-mono mt-0.5">{row.student_id || '-'}</div>
                      <div className="text-[11px] text-[#64748b] mt-0.5">
                        {row.class_name || '-'} · {formatCourseCode(row.course_code) || '-'}
                      </div>
                      {row.email && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.email}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[#0f172a] font-medium">{row.internship_place || '-'}</td>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-[#0f172a]">{row.primary_advisors || '-'}</div>
                      {row.primary_advisors_email && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.primary_advisors_email}</div>
                      )}
                      {row.co_advisors && (
                        <div className="text-[11px] text-[#64748b] mt-1">Đồng HD: {row.co_advisors}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs leading-relaxed">
                      <div>Định kỳ (20%): <strong>{row.progress_score ?? '-'}</strong></div>
                      <div>Báo cáo (20%): <strong>{row.report_score ?? '-'}</strong></div>
                      <div>Đánh giá DN/GV (60%): <strong>{row.company_score ?? '-'}</strong></div>
                      <div className="text-sm text-[#1b7f37] font-bold mt-1">
                        Điểm tổng:{' '}
                        {row.final_score !== null && row.final_score !== undefined && row.final_score !== ''
                          ? Number(row.final_score).toFixed(1)
                          : '-'}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          row.grade_status === 'submitted'
                            ? 'bg-[#dcfce7] text-[#1d833f] border-emerald-200/60'
                            : 'bg-[#f1f5f9] text-[#64748b] border-slate-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            row.grade_status === 'submitted' ? 'bg-[#15803d]' : 'bg-[#94a3b8]'
                          }`}
                        />
                        {statusLabel(row.grade_status)}
                      </span>
                      {formatGradingLecturer(row.grading_lecturer_name) && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Người nhập: {formatGradingLecturer(row.grading_lecturer_name)}
                        </div>
                      )}
                      {row.grade_submitted_at && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(row.grade_submitted_at).toLocaleString('vi-VN')}
                        </div>
                      )}
                      {row.comment && (
                        <div className="text-[11px] text-slate-500 mt-1 italic">"{row.comment}"</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => toggleLock(row)}
                          disabled={row.grade_status === 'missing'}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40 transition-all cursor-pointer active:scale-[0.98] ${
                            row.locked_at
                              ? 'bg-[#fee2e2] text-[#d70015] border border-[#fecaca] hover:bg-[#fecaca]'
                              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {row.locked_at ? 'Mở khóa' : 'Khóa điểm'}
                        </button>
                        <button
                          onClick={() => handleDeleteGradeRow(row)}
                          disabled={Boolean(row.locked_at)}
                          className="p-1.5 text-slate-400 hover:text-[#d70015] hover:bg-[#fee2e2] rounded-lg transition-colors disabled:opacity-30 cursor-pointer"
                          title={row.locked_at ? 'Điểm đã khóa, không thể xóa' : 'Xóa khỏi bảng điểm & nơi thực tập'}
                        >
                          <Trash2 size={15} />
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
          total={filtered.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="dòng điểm"
        />
      </div>

      {/* Modal Nhắc Giảng Viên Chưa Hoàn Thành Điểm */}
      {showRemindModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowRemindModal(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-100">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Mail size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Gửi Email Nhắc Giảng Viên Chưa Hoàn Thành Điểm
                  </h3>
                  <p className="text-xs text-slate-500">
                    Hệ thống sẽ tự động tổng hợp bảng danh sách sinh viên chưa có điểm gửi tới từng Thầy/Cô
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRemindModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex border-b border-slate-200 bg-slate-50/70 px-6 gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setModalTab('recipients')}
                className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                  modalTab === 'recipients'
                    ? 'border-[#034ea1] text-[#034ea1] bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Users size={14} />
                Danh sách người nhận ({selectedLecturerIds.length} GV)
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTab('preview');
                  if (!previewLecturerId && selectedLecturerIds.length > 0) {
                    setPreviewLecturerId(selectedLecturerIds[0]);
                  } else if (!previewLecturerId && pendingLecturers.length > 0) {
                    setPreviewLecturerId(Number(pendingLecturers[0].lecturer_id));
                  }
                }}
                className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
                  modalTab === 'preview'
                    ? 'border-[#034ea1] text-[#034ea1] bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Eye size={14} />
                Xem trước nội dung thư gửi đi (Live Preview)
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
              {remindSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  {remindSuccess}
                </div>
              )}

              {modalTab === 'recipients' ? (
                <>
                  {/* Status Alert Banner */}
                  <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-1.5">
                    <div className="font-bold text-amber-900 flex items-center justify-between text-xs">
                      <span>Đối tượng nhận email:</span>
                      <span className="text-amber-800 font-extrabold text-sm">
                        {selectedLecturerIds.length} / {pendingLecturers.length} giảng viên
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      Bao gồm các Giảng viên hướng dẫn chính có sinh viên chưa có điểm nộp chính thức về Khoa.
                      {deadline && (
                        <span className="block mt-1 font-semibold text-amber-900">
                          Hạn chót nhập điểm dự kiến: {deadline.replace('T', ' ')} (GMT+7)
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Danh sách giảng viên */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                        Danh sách giảng viên ({selectedLecturerIds.length}):
                      </label>
                      <div className="flex gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setSelectedLecturerIds(pendingLecturers.map((l) => Number(l.lecturer_id)))}
                          className="text-[#034ea1] hover:underline font-semibold cursor-pointer"
                        >
                          Chọn tất cả
                        </button>
                        <span>|</span>
                        <button
                          type="button"
                          onClick={() => setSelectedLecturerIds([])}
                          className="text-slate-500 hover:underline cursor-pointer"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-[#f8fafc]">
                      {pendingLecturers.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 italic">
                          Tất cả giảng viên đã hoàn thành chấm điểm!
                        </div>
                      ) : (
                        pendingLecturers.map((gv) => {
                          const isSelected = selectedLecturerIds.includes(Number(gv.lecturer_id));
                          const isExpanded = expandedLecturerId === Number(gv.lecturer_id);
                          return (
                            <div key={gv.lecturer_id} className="p-3 hover:bg-white transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedLecturerIds((prev) => [...prev, Number(gv.lecturer_id)]);
                                      } else {
                                        setSelectedLecturerIds((prev) => prev.filter((id) => id !== Number(gv.lecturer_id)));
                                      }
                                    }}
                                    className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1]"
                                  />
                                  <div className="truncate">
                                    <span className="font-bold text-slate-900">{gv.lecturer_name}</span>
                                    <span className="text-[11px] text-slate-500 ml-2 font-mono">
                                      {gv.lecturer_email || '(Chưa có email)'}
                                    </span>
                                    {gv.work_unit && (
                                      <span className="text-[10px] text-slate-400 ml-2">· {gv.work_unit}</span>
                                    )}
                                  </div>
                                </label>

                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                    {gv.missing_count} SV thiếu
                                  </span>
                                  {gv.waiting_for_lecturer > 0 && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800">
                                      {gv.waiting_for_lecturer} chờ chấm
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedLecturerId(isExpanded ? null : Number(gv.lecturer_id))}
                                    className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                    title="Xem chi tiết danh sách sinh viên"
                                  >
                                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                  </button>
                                </div>
                              </div>

                              {/* Chi tiết sinh viên khi bấm mở rộng */}
                              {isExpanded && gv.students && gv.students.length > 0 && (
                                <div className="mt-3 pl-7 pr-1 pt-2 border-t border-slate-200/60">
                                  <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                                    Danh sách {gv.students.length} sinh viên phụ trách chưa có điểm:
                                  </div>
                                  <div className="space-y-1">
                                    {gv.students.map((s: any, idx: number) => (
                                      <div
                                        key={s.user_id}
                                        className="flex items-center justify-between text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-100"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="text-slate-400 font-mono w-4">{idx + 1}.</span>
                                          <span className="font-bold text-slate-800">{s.student_id}</span>
                                          <span className="text-slate-900 truncate">{s.student_name}</span>
                                          <span className="text-slate-500 font-mono text-[10px]">
                                            ({formatCourseCode(s.course_code)})
                                          </span>
                                        </div>
                                        <span
                                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                                            s.waiting_for_grade
                                              ? 'bg-blue-100 text-blue-800'
                                              : 'bg-amber-100 text-amber-800'
                                          }`}
                                        >
                                          {s.waiting_for_grade ? 'Đã nộp BC (Chờ chấm)' : 'Chưa có báo cáo'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
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
                      placeholder="Ví dụ: Kính đề nghị Thầy/Cô hoàn thành nhập điểm trước 17h00 ngày 28/06/2026 để Khoa kịp tổng kết điểm và xét tốt nghiệp..."
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs bg-[#f8fafc] focus:bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none"
                    />
                  </div>

                  {/* CTA to Preview */}
                  <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-blue-900 leading-snug">
                      <strong>Xem trước thư gửi đi:</strong> Bạn có thể xem trước chính xác lá thư gửi đến Thầy/Cô gồm đầy đủ bảng sinh viên và ghi chú bổ sung.
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setModalTab('preview');
                        if (!previewLecturerId && selectedLecturerIds.length > 0) {
                          setPreviewLecturerId(selectedLecturerIds[0]);
                        } else if (!previewLecturerId && pendingLecturers.length > 0) {
                          setPreviewLecturerId(Number(pendingLecturers[0].lecturer_id));
                        }
                      }}
                      className="px-3 py-1.5 bg-[#034ea1] hover:bg-[#023a7a] text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1.5 transition-colors shadow-xs"
                    >
                      <Eye size={13} />
                      Xem trước ngay
                    </button>
                  </div>
                </>
              ) : (
                /* LIVE PREVIEW TAB */
                <div className="space-y-4">
                  {/* Selector bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">Xem thư gửi đến:</span>
                      <select
                        value={previewLecturerId || ''}
                        onChange={(e) => setPreviewLecturerId(Number(e.target.value))}
                        className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] max-w-xs"
                      >
                        {pendingLecturers.map((gv) => (
                          <option key={gv.lecturer_id} value={gv.lecturer_id}>
                            {gv.lecturer_name} ({gv.missing_count} SV thiếu{gv.waiting_for_lecturer > 0 ? ` · ${gv.waiting_for_lecturer} chờ chấm` : ''})
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Gửi đến: <strong className="text-slate-800 font-mono">{currentPreviewGv?.lecturer_email || '(Chưa có email)'}</strong>
                    </span>
                  </div>

                  {/* Simulated Email Envelope & Content */}
                  <div className="border border-slate-300 rounded-xl overflow-hidden shadow-xs bg-white">
                    {/* Simulated Email Header */}
                    <div className="bg-slate-100/90 px-4 py-2.5 border-b border-slate-200 text-[11px] space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-16 text-right font-medium">Người gửi:</span>
                        <span className="font-semibold text-slate-800">Khoa Công nghệ Thông tin - Trường ĐH Công nghệ &lt;fit@vnu.edu.vn&gt;</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-16 text-right font-medium">Người nhận:</span>
                        <span className="font-semibold text-slate-800">
                          {currentPreviewGv?.lecturer_name} &lt;{currentPreviewGv?.lecturer_email || 'email-gv@vnu.edu.vn'}&gt;
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-16 text-right font-medium">Tiêu đề:</span>
                        <span className="font-bold text-[#034ea1]">
                          [FIT-UET] Danh sách sinh viên chưa hoàn thành điểm thực tập - GVHD: {currentPreviewGv?.lecturer_name || '...'}
                        </span>
                      </div>
                    </div>

                    {/* Email HTML Body Render */}
                    <div className="p-3 sm:p-5 bg-slate-50/60">
                      <div className="max-w-[720px] mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                        {/* Header Banner */}
                        <div className="bg-[#034ea1] text-white p-4 sm:p-5 text-center">
                          <h2 className="m-0 text-sm sm:text-base font-bold tracking-tight">KHOA CÔNG NGHỆ THÔNG TIN - TRƯỜNG ĐH CÔNG NGHỆ</h2>
                          <p className="m-0 mt-1 text-[11px] opacity-90">Danh sách sinh viên chưa hoàn thành điểm thực tập</p>
                        </div>

                        {/* Letter Content */}
                        <div className="p-4 sm:p-6 text-xs text-slate-800 space-y-3.5 leading-relaxed">
                          <p className="m-0">
                            Kính gửi: <strong>Thầy/Cô {currentPreviewGv?.lecturer_name}</strong>,
                          </p>
                          <p className="m-0 text-slate-600">
                            Đơn vị công tác: <em>{currentPreviewGv?.work_unit || 'Khoa Công nghệ Thông tin'}</em>,
                          </p>
                          <p className="m-0">
                            Khoa CNTT kính gửi Thầy/Cô danh sách sinh viên thực tập do Thầy/Cô hướng dẫn chính hiện{' '}
                            <strong>chưa được hoàn thiện điểm</strong> trên hệ thống:
                          </p>

                          <ul className="bg-slate-50 border-l-4 border-[#034ea1] p-3 pl-6 rounded-md text-xs space-y-1 list-disc">
                            <li>
                              Tổng số sinh viên chưa có điểm: <strong>{currentPreviewGv?.students?.length || 0} sinh viên</strong>
                            </li>
                            <li>
                              Đã có báo cáo (chờ Thầy/Cô chấm):{' '}
                              <strong className="text-[#034ea1]">
                                {currentPreviewGv?.students?.filter((s: any) => s.waiting_for_grade).length || 0} sinh viên
                              </strong>
                            </li>
                            <li>
                              Sinh viên chưa nộp báo cáo:{' '}
                              <strong className="text-amber-800">
                                {currentPreviewGv?.students?.filter((s: any) => !s.waiting_for_grade).length || 0} sinh viên
                              </strong>
                            </li>
                            <li>
                              Thời hạn nhập điểm của Khoa:{' '}
                              <strong>{deadline ? `trước ${deadline.replace('T', ' ')} (GMT+7)` : 'Theo kế hoạch đào tạo'}</strong>
                            </li>
                          </ul>

                          {/* Live note preview */}
                          {customRemindNote.trim() && (
                            <div className="bg-slate-50 border-l-4 border-[#034ea1] p-3 rounded text-xs text-slate-800 leading-relaxed">
                              <strong>Ghi chú từ Giáo vụ Khoa:</strong> {customRemindNote}
                            </div>
                          )}

                          {/* Student Table */}
                          <div className="overflow-x-auto my-3 border border-slate-200 rounded-lg">
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                                  <th className="p-2 border-r border-slate-200 text-center">STT</th>
                                  <th className="p-2 border-r border-slate-200">Mã SV</th>
                                  <th className="p-2 border-r border-slate-200">Họ và tên</th>
                                  <th className="p-2 border-r border-slate-200">Lớp</th>
                                  <th className="p-2 border-r border-slate-200">Môn</th>
                                  <th className="p-2 border-r border-slate-200">Nơi thực tập</th>
                                  <th className="p-2 border-r border-slate-200 text-center">Báo cáo</th>
                                  <th className="p-2 text-center">Tình trạng</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {currentPreviewGv?.students?.length === 0 ? (
                                  <tr>
                                    <td colSpan={8} className="p-4 text-center text-slate-400 italic">Không có sinh viên thiếu</td>
                                  </tr>
                                ) : (
                                  currentPreviewGv?.students?.map((s: any, idx: number) => {
                                    const bc =
                                      s.report_status === 'submitted'
                                        ? 'Đã nộp'
                                        : s.report_status === 'accepted'
                                        ? 'Đã duyệt'
                                        : 'Chưa nộp';
                                    return (
                                      <tr key={s.user_id} className="hover:bg-slate-50/80">
                                        <td className="p-2 border-r border-slate-200 text-center text-slate-500">{idx + 1}</td>
                                        <td className="p-2 border-r border-slate-200 font-bold text-slate-900">{s.student_id}</td>
                                        <td className="p-2 border-r border-slate-200 font-medium text-slate-800">{s.student_name}</td>
                                        <td className="p-2 border-r border-slate-200 text-slate-600">{s.class_name || '-'}</td>
                                        <td className="p-2 border-r border-slate-200 text-slate-600">{formatCourseCode(s.course_code)}</td>
                                        <td className="p-2 border-r border-slate-200 text-slate-600">{s.internship_place || '-'}</td>
                                        <td className="p-2 border-r border-slate-200 text-center">
                                          <span
                                            className={`font-semibold ${
                                              bc === 'Chưa nộp' ? 'text-slate-400' : 'text-emerald-700'
                                            }`}
                                          >
                                            {bc}
                                          </span>
                                        </td>
                                        <td className="p-2 text-center">
                                          {s.waiting_for_grade ? (
                                            <span className="text-[#034ea1] font-bold">Chờ Thầy/Cô chấm</span>
                                          ) : (
                                            <span className="text-amber-800 font-bold">Chờ SV nộp báo cáo</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>

                          {/* Formal instructions */}
                          <div className="my-3 text-xs leading-relaxed">
                            <p className="m-0 font-bold mb-1.5 text-slate-800">Kính đề nghị Thầy/Cô:</p>
                            <ol className="m-0 pl-5 space-y-1 list-decimal text-slate-700">
                              <li>
                                <strong>Đối với sinh viên ĐÃ nộp báo cáo:</strong> Kính nhờ Thầy/Cô vào hệ thống xem báo cáo và nộp điểm chính thức về Khoa.
                              </li>
                              <li>
                                <strong>Đối với sinh viên CHƯA nộp báo cáo:</strong> Kính nhờ Thầy/Cô đôn đốc sinh viên khẩn trương nộp báo cáo hoặc cho ĐIỂM 0 nếu không tương tác và nộp đúng thời hạn theo quy định.
                              </li>
                            </ol>
                          </div>

                          {/* CTA Button */}
                          <div className="text-center py-2">
                            <span className="inline-block bg-[#034ea1] text-white px-6 py-2.5 rounded-lg font-bold text-xs shadow-xs pointer-events-none">
                              Vào Bảng Chấm Điểm Của Thầy/Cô
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-500 m-0 pt-2 border-t border-slate-100">
                            Khoa CNTT xin trân trọng cảm ơn Thầy/Cô!
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Edit Ghi chú ngay tại tab Preview */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
                    <label className="block font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                      Chỉnh sửa nhanh Ghi chú bổ sung (sẽ cập nhật ngay vào mẫu thư ở trên):
                    </label>
                    <textarea
                      value={customRemindNote}
                      onChange={(e) => setCustomRemindNote(e.target.value)}
                      placeholder="Nhập ghi chú thêm nếu cần thông báo thêm hạn chót cụ thể hoặc lưu ý cho Giảng viên..."
                      rows={2}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowRemindModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={reminding || selectedLecturerIds.length === 0}
                onClick={handleSendLecturerReminders}
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
                    Gửi email nhắc nhở ({selectedLecturerIds.length})
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
