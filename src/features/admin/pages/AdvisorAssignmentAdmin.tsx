import { CampaignLegacyHeader, useCampaignLayout } from '../../academic/CampaignLayoutContext';
import { useLegacyPager } from '../../academic/useLegacyPager';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useLegacyPage, useLegacySearch, useLegacyMembership, legacyStudentInScope } from '../../academic/LegacyListScope';
import { matchesCourseCode } from '../../../shared/utils/format';
import { useCampaignNavigate as useNavigate } from '../../academic/useCampaignNavigate';
import React, { useState, useEffect } from 'react';
import { Users, Upload, Download, ArrowUpDown, Search, RefreshCw, Save, Plus, Trash2, FileText } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, saveXlsx, xlsxArrayBuffer, readSpreadsheetRows, paginationBounds, PaginationControls, PageDescriptionTooltip, SegmentedControl, formatCourseCode, cleanStudentName } from '../../../shared';

export function AdvisorAssignmentAdmin({ token, initialCourseCode = '', view = 'assignments' }: { token: string, initialCourseCode?: string, view?: 'assignments' | 'requests' | 'quotas' }) {
  const campaignLayout = useCampaignLayout();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [lecturers, setLecturers] = useState<any[]>([]);
  const [advisorRequests, setAdvisorRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useLegacySearch();
  const legacyMembership = useLegacyMembership();
  const [selectedLecturers, setSelectedLecturers] = useState<Record<string, string>>({});
  const [selectedRoles, setSelectedRoles] = useState<Record<string, 'primary' | 'co'>>({});
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [quotaEdits, setQuotaEdits] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [syncingLegacyAdvisors, setSyncingLegacyAdvisors] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useLegacyPage();
  const [advisorSortConfig, setAdvisorSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'student_id', direction: 'asc' });
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [isAssignExportMenuOpen, setIsAssignExportMenuOpen] = useState(false);
  const pageSize = 25;
  const paging = useLegacyPager(token, view === 'requests' ? '/api/admin/advisor-requests' : '/api/admin/advisor-assignments', {page:currentPage,q:searchTerm,courseCode:initialCourseCode,sort:advisorSortConfig.key,direction:advisorSortConfig.direction});

  const fetchData = async () => {
    setLoading(true);
    try {
      if (view === 'assignments') {
        const items = await paging.load();
        setRows(items); setLecturers(paging.response.current?.lecturers || []); setAdvisorRequests([]);
      } else {
        const res = await fetch(`${API_BASE}/api/admin/advisor-assignments?catalogOnly=1`, {headers:{Authorization:`Bearer ${token}`}});
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Không tải được giảng viên.');
        setLecturers(data.lecturers || []); setRows([]);
        setAdvisorRequests(view === 'requests' ? await paging.load() : []);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      setRows([]);
      alert('Không tải được danh sách phân công.');
    } finally {
      setLoading(false);
    }
  };

  paging.bind(fetchData);
  useEffect(() => { fetchData(); }, [token, paging.key, view]);

  const parseAssignments = (value: string | null) => String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [id, name, email, note] = item.split('|');
      return { id: Number(id), name, email, note: note || '' };
    })
    .filter(item => item.id && item.name);

  const filteredRows = rows.filter(row => {
      if (!legacyStudentInScope(legacyMembership, row.student_id)) return false;
    if (initialCourseCode && !matchesCourseCode(row.course_code, initialCourseCode)) return false;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    const primaryText = parseAssignments(row.primary_assignments).map(a => `${a.name} ${a.email || ''}`).join(' ').toLowerCase();
    const coText = parseAssignments(row.co_assignments).map(a => `${a.name} ${a.email || ''}`).join(' ').toLowerCase();
    return (
      String(row.student_id || '').toLowerCase().includes(term) ||
      String(row.student_name || '').toLowerCase().includes(term) ||
      String(row.class_name || '').toLowerCase().includes(term) ||
      String(row.course_code || '').toLowerCase().includes(term) ||
      String(row.internship_place || '').toLowerCase().includes(term) ||
      primaryText.includes(term) ||
      coText.includes(term)
    );
  });
  const advisorSortValue = (row: any, key: string) => {
    if (key === 'primary_assignments') return parseAssignments(row.primary_assignments).map(a => a.name).join('; ');
    if (key === 'co_assignments') return parseAssignments(row.co_assignments).map(a => a.name).join('; ');
    if (key === 'advisor_status') return parseAssignments(row.primary_assignments).length > 0 ? '1' : '0';
    if (key === 'student') return `${row.student_name || ''} ${row.student_id || ''}`;
    if (key === 'lecturer') return `${row.lecturer_name || row.lecturer_name_text || ''} ${row.co_lecturer_name || row.co_lecturer_name_text || ''}`;
    if (key === 'request_status') return `${row.status || ''} ${row.quota_status || ''}`;
    return row[key] ?? '';
  };
  const compareAdvisorValues = (a: any, b: any) => {
    const left = advisorSortValue(a, advisorSortConfig.key);
    const right = advisorSortValue(b, advisorSortConfig.key);
    const direction = advisorSortConfig.direction === 'asc' ? 1 : -1;
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && String(left).trim() !== '' && String(right).trim() !== '') {
      return (leftNumber - rightNumber) * direction;
    }
    return String(left).localeCompare(String(right), 'vi', { numeric: true, sensitivity: 'base' }) * direction;
  };
  const sortedRows = [...filteredRows].sort(compareAdvisorValues);
  const sortedAdvisorRequests = [...advisorRequests].sort(compareAdvisorValues);
  const sortedLecturers = [...lecturers].sort(compareAdvisorValues);
  const requestAdvisorSort = (key: string) => {
    setCurrentPage(1);
    setAdvisorSortConfig(prev => prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  };
  const AdvisorSortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 inline-flex align-middle text-xs">
      {advisorSortConfig.key === col ? (advisorSortConfig.direction === 'asc' ? '↑' : '↓') : <ArrowUpDown size={12} className="text-slate-400" />}
    </span>
  );
  useEffect(() => {
    if (!paging.enabled) setCurrentPage(1);
  }, [searchTerm, advisorSortConfig.key, advisorSortConfig.direction]);
  const pagination = paginationBounds(paging.page?.total ?? sortedRows.length, currentPage, pageSize);
  const paginatedRows = paging.page ? sortedRows : sortedRows.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);

  const assign = async (row: any) => {
    const key = String(row.user_id);
    const lecturerId = selectedLecturers[key];
    if (!lecturerId) return alert('Vui lòng chọn giảng viên.');
    const role = selectedRoles[key] || 'primary';
    const existingAssignments = role === 'primary' ? parseAssignments(row.primary_assignments) : parseAssignments(row.co_assignments);
    if (existingAssignments.length > 0) {
      const roleLabel = role === 'primary' ? 'GVHD chính' : 'đồng hướng dẫn';
      const currentNames = existingAssignments.map(item => item.name).join(', ');
      if (!confirm(`Sinh viên hiện đã có ${roleLabel}: ${currentNames}.\n\nGán giảng viên mới sẽ thay thế phân công ${roleLabel} hiện tại. Bạn có chắc muốn tiếp tục?`)) return;
    }
    setAssigningKey(key);
    try {
      const res = await fetch(`${API_BASE}/api/admin/advisor-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: row.user_id, lecturer_id: Number(lecturerId), role, replace_existing: true })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Phân công thất bại.');
      setSelectedLecturers(prev => ({ ...prev, [key]: '' }));
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi phân công.');
    } finally {
      setAssigningKey(null);
    }
  };

  const removeAssignment = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/admin/advisor-assignments/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) fetchData();
    else alert('Xóa phân công thất bại.');
  };

  const deleteSelectedAssignments = async () => {
    if (selectedRows.size === 0) return alert('Vui lòng chọn ít nhất một dòng để xóa phân công.');
    const targetUserIds = sortedRows
      .filter(r => selectedRows.has(String(r.user_id)))
      .map((r: any) => r.user_id);
    if (!confirm(`Xóa toàn bộ phân công GVHD của ${targetUserIds.length} dòng đang chọn?`)) return;
    setDeletingSelected(true);
    try {
      const allAssignmentIds: number[] = [];
      for (const row of sortedRows) {
        if (!targetUserIds.includes(row.user_id)) continue;
        const primary = parseAssignments(row.primary_assignments);
        const co = parseAssignments(row.co_assignments);
        [...primary, ...co].forEach((a: any) => { if (a.id) allAssignmentIds.push(a.id); });
      }
      if (allAssignmentIds.length === 0) return alert('Các dòng đã chọn chưa có phân công nào.');
      await Promise.all(allAssignmentIds.map(id =>
        fetch(`${API_BASE}/api/admin/advisor-assignments/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        })
      ));
      setSelectedRows(new Set());
      fetchData();
    } catch (e) {
      alert('Xóa phân công thất bại.');
    } finally {
      setDeletingSelected(false);
    }
  };

  const saveQuota = async (lecturer: any) => {
    const editValue = quotaEdits[String(lecturer.id)];
    const value = editValue !== undefined ? Number(editValue) : lecturer.max_total_students;
    if (!Number.isFinite(value) || value < 0) return alert('Chỉ tiêu không hợp lệ.');
    const res = await fetch(`${API_BASE}/api/admin/lecturer-quotas/${lecturer.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ max_total_students: value })
    });
    if (res.ok) fetchData();
    else alert('Lưu chỉ tiêu thất bại.');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await readSpreadsheetRows(file);
      const dataRows = rows[0]?.join(' ').toLowerCase().includes('student_id') || rows[0]?.join(' ').toLowerCase().includes('mã sv')
        ? rows.slice(1)
        : rows;
      const items = dataRows.map(parts => {
        return {
          student_id: parts[0],
          lecturer_email_or_name: parts[1],
          role: parts[2] === 'co' ? 'co' : 'primary',
          note: parts[3] || ''
        };
      }).filter(item => item.student_id && item.lecturer_email_or_name);
      if (items.length === 0) return alert('File cần cột: student_id, lecturer_email_or_name, role, note');
      const res = await fetch(`${API_BASE}/api/admin/advisor-assignments/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignments: items })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Import thất bại.');
      alert(`Đã import ${data.count || 0} phân công.${data.errors?.length ? `\nLỗi:\n${data.errors.slice(0, 10).join('\n')}` : ''}`);
      fetchData();
    } catch (err) {
      alert('Không đọc được file XLSX/CSV.');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const autoAssignPrimary = async () => {
    if (!confirm('Tự phân công GVHD chính cho tất cả sinh viên đã có nguyện vọng đăng ký thực tập nhưng chưa đăng ký/chưa có GVHD chính?')) return;
    setAutoAssigning(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/advisor-assignments/auto-primary`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Tự phân công thất bại.');
      alert(`Đã phân công ${data.count || 0} sinh viên.${data.errors?.length ? `\nCòn lỗi:\n${data.errors.slice(0, 10).join('\n')}` : ''}`);
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi tự phân công.');
    } finally {
      setAutoAssigning(false);
    }
  };

  const syncLegacyAdvisorData = async () => {
    if (!confirm('Đồng bộ dữ liệu GVHD cũ từ các đăng ký thực tập tại trường và các đăng ký GVHD đang chờ? Thao tác này chỉ tạo/cập nhật phân công chính thức khi dữ liệu hợp lệ.')) return;
    setSyncingLegacyAdvisors(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/advisor-requests/sync-legacy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Đồng bộ dữ liệu cũ thất bại.');
      const legacy = data.legacy || {};
      const pending = data.pending || {};
      alert(`Đã đồng bộ dữ liệu GVHD cũ.\nKiểm tra đăng ký tại trường: ${legacy.checked || 0}, đồng bộ: ${legacy.synced || 0}.\nĐăng ký GVHD đang chờ: ${pending.checked || 0}, duyệt/tạo phân công: ${pending.approved || 0}.`);
      fetchData();
    } catch (e) {
      alert('Lỗi kết nối khi đồng bộ dữ liệu cũ.');
    } finally {
      setSyncingLegacyAdvisors(false);
    }
  };

  const reviewAdvisorRequest = async (request: any, action: 'approve' | 'reject') => {
    const adminNote = action === 'reject' ? prompt('Nhập nhận xét gửi sinh viên:') : '';
    if (adminNote === null) return;
    if (action === 'reject' && !adminNote) return;
    setReviewingRequestId(Number(request.id));
    try {
      const res = await fetch(`${API_BASE}/api/admin/advisor-requests/${request.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, admin_note: adminNote || '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không xử lý được đăng ký.');
      setAdvisorRequests(prev => action === 'approve'
        ? prev.filter(item => Number(item.id) !== Number(request.id))
        : prev.map(item => Number(item.id) === Number(request.id)
          ? { ...item, status: 'rejected', admin_note: adminNote || '' }
          : item));
    } finally {
      setReviewingRequestId(null);
    }
  };

  const exportXlsxSummary = async () => {
    const sortedRows = await paging.allRows();
    if (sortedRows.length === 0) return alert('Không có dữ liệu để xuất.');
    const headers = ['STT', 'Mã SV', 'Họ tên', 'Email VNU', 'Email khác', 'Lớp', 'Mã môn', 'Nơi thực tập', 'GVHD chính', 'Đồng hướng dẫn'];
    const summaryRows = sortedRows.map((row, idx) => [
      idx + 1,
      row.student_id || '',
      cleanStudentName(row.student_name, row.student_id),
      row.email || '',
      row.personal_email || '',
      row.class_name || '',
      formatCourseCode(row.course_code),
      row.internship_place || '',
      parseAssignments(row.primary_assignments).map(a => a.name).join('; '),
      parseAssignments(row.co_assignments).map(a => a.name).join('; ')
    ]);
    await saveXlsx('phan_cong_gvhd_tong_hop.xlsx', headers, summaryRows, 'Tong hop');
    setIsAssignExportMenuOpen(false);
  };

  const exportXlsxByLecturer = async () => {
    const sortedRows = await paging.allRows();
    const filteredRows = sortedRows;
    const rows = sortedRows;
    if (sortedRows.length === 0) return alert('Không có dữ liệu để xuất.');
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const lecturerMap = new Map<string, { lecturerName: string; rows: any[][] }>();
    const unassignedRows: any[][] = [];

    sortedRows.forEach(row => {
      const primary = parseAssignments(row.primary_assignments);
      const co = parseAssignments(row.co_assignments);
      const assignments = [
        ...primary.map(a => ({ ...a, role: 'GVHD chính' })),
        ...co.map(a => ({ ...a, role: 'Đồng hướng dẫn' })),
      ];
      if (assignments.length === 0) {
        unassignedRows.push([
          unassignedRows.length + 1,
          row.student_id || '',
          cleanStudentName(row.student_name, row.student_id),
          row.email || '',
          row.personal_email || '',
          row.class_name || '',
          formatCourseCode(row.course_code),
          row.internship_place || '',
          'Chưa phân công',
          '',
          '',
        ]);
        return;
      }
      assignments.forEach(lecturer => {
        const key = String(lecturer.name || 'giang_vien_khong_ten');
        if (!lecturerMap.has(key)) {
          lecturerMap.set(key, { lecturerName: lecturer.name, rows: [] });
        }
        const entry = lecturerMap.get(key)!;
        entry.rows.push([
          entry.rows.length + 1,
          row.student_id || '',
          cleanStudentName(row.student_name, row.student_id),
          row.email || '',
          row.personal_email || '',
          row.class_name || '',
          formatCourseCode(row.course_code),
          row.internship_place || '',
          lecturer.role,
          primary.map(a => a.name).join('; '),
          co.map(a => a.name).join('; '),
        ]);
      });
    });

    const lecturerHeaders = ['STT', 'Mã SV', 'Họ tên', 'Email VNU', 'Email khác', 'Lớp', 'Mã môn', 'Nơi thực tập', 'Vai trò của giảng viên', 'GVHD chính', 'Đồng hướng dẫn'];

    await Promise.all(Array.from(lecturerMap.entries()).map(async ([name, entry]) => {
      const safeName = name.replace(/[^a-z0-9_ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂÂĐỔÔÚNhíợ]{1,30}/gi, '_');
      zip.file(`phan_cong_gvhd_${safeName}.xlsx`, await xlsxArrayBuffer(lecturerHeaders, entry.rows, 'Sinh viên hướng dẫn'));
    }));

    if (unassignedRows.length > 0) {
      zip.file('chua_phan_cong.xlsx', await xlsxArrayBuffer(lecturerHeaders, unassignedRows, 'Chưa phân công'));
    }

    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'phan_cong_gvhd_theo_giang_vien.zip');
    } catch (error) {
      alert('Tải file zip thất bại.');
    }
    setIsAssignExportMenuOpen(false);
  };

  const isAssignmentsView = view === 'assignments';
  const isRequestsView = view === 'requests';
  const isQuotasView = view === 'quotas';
  const pageTitle = isRequestsView ? 'Phê duyệt đăng ký GVHD' : isQuotasView ? 'Chỉ tiêu giảng viên' : 'Phân công giảng viên hướng dẫn';

  if (loading) return <div className="text-center py-20 text-slate-500">Đang tải dữ liệu GVHD...</div>;

  const headerActions = (<div className="max-w-full overflow-x-auto">
            <SegmentedControl
              value={view}
              onChange={(val) => {
                if (val === 'assignments') navigate('/admin/advisors');
                else if (val === 'requests') navigate('/admin/advisors/requests');
                else if (val === 'quotas') navigate('/admin/advisors/quotas');
              }}
              items={[
                { value: 'assignments', label: 'Danh sách phân công', badge: rows.length || undefined },
                { value: 'requests', label: 'Phê duyệt đăng ký', badge: advisorRequests.length > 0 ? advisorRequests.length : undefined },
                { value: 'quotas', label: 'Chỉ tiêu & Quota', badge: lecturers.length || undefined },
              ]}
            />
          </div>);

  const assignmentDeleteActions = (<div className="flex flex-wrap gap-2">
                <button
                  onClick={deleteSelectedAssignments}
                  disabled={deletingSelected || selectedRows.size === 0}
                  className="bg-[#fee2e2] text-[#d70015] border border-[#fecaca] hover:bg-[#fecaca] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap active:scale-[0.98]"
                >
                  {deletingSelected ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Xóa chọn{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
                </button>
              </div>);
  const assignmentOperationActions = (<div className="flex flex-wrap gap-2">
                <label className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 border border-[#e2e8f0] bg-white text-[#0f172a] hover:bg-[#f8fafc] transition-all cursor-pointer whitespace-nowrap active:scale-[0.98] ${importing ? 'bg-slate-100 text-slate-400 cursor-wait pointer-events-none' : ''}`}>
                  {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} Import XLSX
                  <input type="file" accept=".xlsx,.xls,.csv" disabled={importing} className="hidden" onChange={handleImport} onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} />
                </label>
                <button
                  onClick={autoAssignPrimary}
                  disabled={autoAssigning}
                  className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {autoAssigning ? <RefreshCw size={14} className="animate-spin" /> : <Users size={14} />} Tự phân công
                </button>
                <button
                  onClick={syncLegacyAdvisorData}
                  disabled={syncingLegacyAdvisors}
                  className="bg-white text-[#0f172a] border border-[#e2e8f0] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {syncingLegacyAdvisors ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} Đồng bộ dữ liệu cũ
                </button>
                <div className="relative">
                  <button
                    onClick={() => setIsAssignExportMenuOpen(!isAssignExportMenuOpen)}
                    className="bg-white text-[#0f172a] border border-[#e2e8f0] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap active:scale-[0.98]"
                  >
                    <Download size={14} /> Xuất XLSX
                  </button>
                  {isAssignExportMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsAssignExportMenuOpen(false)}></div>
                      <div className="absolute right-0 mt-2 w-52 rounded-2xl bg-white/95 backdrop-blur-md border border-black/[0.08] shadow-xl z-50 overflow-hidden py-1.5">
                        <button onClick={exportXlsxSummary} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors border-b border-slate-50 w-full text-left cursor-pointer">
                          <FileText size={14} className="text-slate-400" /> Xuất Tổng hợp
                        </button>
                        <button onClick={exportXlsxByLecturer} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-xs font-medium transition-colors w-full text-left cursor-pointer">
                          <Users size={14} className="text-slate-400" /> Xuất từng GV (ZIP)
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>);
  const assignmentActions = (<>{assignmentDeleteActions}
{assignmentOperationActions}</>);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <CampaignLegacyHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <button onClick={() => navigate('/admin')} className="bg-white text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer mb-2 active:scale-[0.98]">&larr; Quay lại Quản trị</button>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2 leading-tight">
              <Users className="text-[#034ea1] shrink-0" size={26} /> {pageTitle}
            </h2>
          </div>
          {headerActions}
        </div></CampaignLegacyHeader>
        {campaignLayout && headerActions}

        {isAssignmentsView && (
          <CampaignLegacyHeader actions={assignmentActions}><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
              {assignmentDeleteActions}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Tìm sinh viên, nơi thực tập, giảng viên..."
                  className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
                />
              </div>
              {assignmentOperationActions}
            </div>
          </div></CampaignLegacyHeader>
        )}
      </div>

      {isRequestsView && <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span>Đăng ký GVHD từ sinh viên</span>
              <PageDescriptionTooltip description="Chỉ hiển thị các sinh viên khai báo đã được giảng viên đồng ý hướng dẫn và cần Khoa xử lý quota/trạng thái." />
            </h3>
          </div>
          <span className="text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-100 px-3 py-1">
            {advisorRequests.filter(item => item.status === 'pending').length} chờ xử lý
          </span>
        </div>
        {advisorRequests.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">Chưa có đăng ký GVHD.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('student')}>Sinh viên <AdvisorSortIcon col="student" /></th>
                  <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('request_status')}>Nguồn / Trạng thái <AdvisorSortIcon col="request_status" /></th>
                  <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('lecturer')}>GV đăng ký <AdvisorSortIcon col="lecturer" /></th>
                  <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('student_note')}>Ghi chú <AdvisorSortIcon col="student_note" /></th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(paging.page ? sortedAdvisorRequests : sortedAdvisorRequests.slice(0, 12)).map(request => (
                  <tr key={request.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{request.student_name}</div>
                      <div className="text-xs text-slate-500 font-mono">{request.student_id || '-'}</div>
                      <div className="text-xs text-slate-500">{request.class_name || '-'} · {request.course_code || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-slate-700">
                        {request.request_type === 'agreed' ? 'Đã được GV đồng ý' : request.request_type === 'faculty_assign' ? 'Khoa sẽ phân công' : 'Không còn hỗ trợ'}
                      </div>
                      <div className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-bold ${request.status === 'pending' ? 'bg-amber-100 text-amber-700' : request.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {request.status === 'pending' ? 'Chờ xử lý' : request.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                      </div>
                      {request.source_registration_id && <div className="text-[11px] text-blue-700 mt-1">Từ đăng ký tại trường</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div>{request.lecturer_name || request.lecturer_name_text || '-'}</div>
                      {(request.co_lecturer_name || request.co_lecturer_name_text) && <div className="text-xs text-slate-500 mt-1">Đồng HD: {request.co_lecturer_name || request.co_lecturer_name_text}</div>}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="text-xs text-slate-600 whitespace-pre-wrap">{request.student_note || '-'}</div>
                      {request.admin_note && <div className="text-xs text-red-700 mt-1">Khoa: {request.admin_note}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {request.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => reviewAdvisorRequest(request, 'approve')}
                            disabled={reviewingRequestId === Number(request.id)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                          >
                            {reviewingRequestId === Number(request.id) ? 'Đang duyệt...' : 'Duyệt'}
                          </button>
                          <button
                            onClick={() => reviewAdvisorRequest(request, 'reject')}
                            disabled={reviewingRequestId === Number(request.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                          >
                            Từ chối
                          </button>
                        </div>
                      ) : <span className="text-xs text-slate-400">Đã xử lý</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>}

      {isAssignmentsView && <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    className="accent-emerald-600 w-4 h-4 cursor-pointer"
                    title="Chọn tất cả trang hiện tại"
                    checked={paginatedRows.length > 0 && paginatedRows.every(r => selectedRows.has(String(r.user_id)))}
                    onChange={e => {
                      const ids = paginatedRows.map((r: any) => String(r.user_id));
                      setSelectedRows(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) ids.forEach(id => next.add(id));
                        else ids.forEach(id => next.delete(id));
                        return next;
                      });
                    }}
                  />
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('student')}>Sinh viên <AdvisorSortIcon col="student" /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('internship_place')}>Nơi thực tập <AdvisorSortIcon col="internship_place" /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestAdvisorSort('primary_assignments')}>GVHD hiện tại <AdvisorSortIcon col="primary_assignments" /></th>
                <th className="px-4 py-3">Phân công</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Chưa có sinh viên cần phân công.</td></tr>
              ) : paginatedRows.map(row => {
                const key = String(row.user_id);
                const primary = parseAssignments(row.primary_assignments);
                const co = parseAssignments(row.co_assignments);
                return (
                  <tr key={key} className={`hover:bg-slate-50 align-top transition-colors ${selectedRows.has(key) ? 'bg-emerald-50' : ''}`}>
                    <td className="px-3 py-4 text-center align-middle">
                      <input
                        type="checkbox"
                        className="accent-emerald-600 w-4 h-4 cursor-pointer"
                        checked={selectedRows.has(key)}
                        onChange={e => {
                          setSelectedRows(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{row.student_name}</div>
                      <div className="text-xs text-slate-500 font-mono">{row.student_id || '-'}</div>
                      <div className="text-xs text-slate-500">{row.class_name || '-'} · {row.course_code || '-'}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-800">{row.internship_place || '-'}</div>
                      {row.school_assignment_request ? <div className="text-xs text-orange-700 mt-1">Khoa sẽ phân công GVHD</div> : null}
                    </td>
                    <td className="px-4 py-4 space-y-2">
                      {[...primary.map(a => ({ ...a, role: 'primary' })), ...co.map(a => ({ ...a, role: 'co' }))].length === 0 ? (
                        <span className="text-slate-400 text-sm">Chưa phân công</span>
                      ) : (
                        [...primary.map(a => ({ ...a, role: 'primary' })), ...co.map(a => ({ ...a, role: 'co' }))].map(a => (
                          <div key={a.id} className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold px-2 py-1 rounded ${a.role === 'primary' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{a.role === 'primary' ? 'Chính' : 'Đồng'}</span>
                            <span className={`text-sm ${a.name === 'Giảng viên đã bị xóa' ? 'text-red-600 font-medium' : ''}`}>{a.name}</span>
                            {a.name === 'Giảng viên đã bị xóa' && (
                              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200" title="Giảng viên đã bị xóa khỏi hệ thống. Vui lòng tích chọn dòng sinh viên này và nhấn 'Xóa chọn' để hủy phân công rác và có thể phân công lại.">⚠️ Lỗi</span>
                            )}
                            {a.note && a.note.includes('Tự phân công') && (
                              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200" title="Được phân công tự động bởi hệ thống">Tự PC</span>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col lg:flex-row gap-2">
                        <select
                          value={selectedRoles[key] || 'primary'}
                          onChange={e => setSelectedRoles(prev => ({ ...prev, [key]: e.target.value as 'primary' | 'co' }))}
                          className="border border-slate-200 bg-white text-slate-705 rounded-xl px-2.5 py-1.5 text-xs font-semibold shadow-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all cursor-pointer"
                        >
                          <option value="primary">Hướng dẫn chính</option>
                          <option value="co">Đồng hướng dẫn</option>
                        </select>
                        <select
                          value={selectedLecturers[key] || ''}
                          onChange={e => setSelectedLecturers(prev => ({ ...prev, [key]: e.target.value }))}
                          className="border border-slate-200 bg-white text-slate-705 rounded-xl px-2.5 py-1.5 text-xs font-semibold shadow-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all cursor-pointer min-w-[200px]"
                        >
                          <option value="">-- Chọn giảng viên --</option>
                          {lecturers.map(lecturer => (
                            <option key={lecturer.id} value={lecturer.id}>
                              {lecturer.name} ({lecturer.assignment_count}/{lecturer.max_total_students})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => assign(row)}
                          disabled={assigningKey === key}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-60 transition-all cursor-pointer shrink-0"
                        >
                          {assigningKey === key ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} Gán
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={paging.page?.total ?? sortedRows.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="sinh viên"
        />
      </div>}

      {isRequestsView && paging.page && <PaginationControls total={paging.page.total} currentPage={currentPage} pageSize={pageSize} onPageChange={setCurrentPage} label="đề xuất" />}
      {isQuotasView && <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="font-bold text-slate-800 text-sm">Chỉ tiêu giảng viên</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => requestAdvisorSort('name')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-707 hover:bg-slate-50 transition-colors cursor-pointer">Tên GV <AdvisorSortIcon col="name" /></button>
            <button onClick={() => requestAdvisorSort('assignment_count')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-707 hover:bg-slate-50 transition-colors cursor-pointer">Đã phân công <AdvisorSortIcon col="assignment_count" /></button>
            <button onClick={() => requestAdvisorSort('max_total_students')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-707 hover:bg-slate-50 transition-colors cursor-pointer">Chỉ tiêu <AdvisorSortIcon col="max_total_students" /></button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {sortedLecturers.map(lecturer => (
            <div key={lecturer.id} className="border border-slate-200/60 bg-slate-50/20 hover:bg-slate-50/55 hover:shadow-sm transition-all rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-xs text-slate-800 truncate">{lecturer.name}</div>
                <div className="text-xs text-slate-500 mt-1">{lecturer.assignment_count}/{lecturer.max_total_students} sinh viên</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min="0" value={quotaEdits[String(lecturer.id)] ?? lecturer.max_total_students} onChange={e => setQuotaEdits(prev => ({ ...prev, [lecturer.id]: e.target.value }))} className="w-14 border border-slate-200 rounded-xl px-2 py-1.5 text-xs text-center focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all bg-white font-semibold text-slate-850" />
                <button onClick={() => saveQuota(lecturer)} className="text-green-600 hover:bg-green-50 p-2 rounded-xl transition-colors cursor-pointer" title="Lưu chỉ tiêu"><Save size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}
