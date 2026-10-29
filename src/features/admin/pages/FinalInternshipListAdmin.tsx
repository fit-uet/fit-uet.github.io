import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, Download, ArrowUpDown, Search, RefreshCw, Trash2 } from 'lucide-react';
import { API_BASE, saveXlsx, paginationBounds, PaginationControls, PageDescriptionTooltip, formatCourseCode, cleanStudentName } from '../../../shared';

export function FinalInternshipListAdmin({ token, initialCourseCode = '' }: { token: string; initialCourseCode?: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'confirmed_at', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/final-internships`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      alert('Không tải được danh sách xác nhận thực tập.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFinal = async (item: any) => {
    const displayName = cleanStudentName(item.student_name, item.student_id);
    if (!confirm(`Bạn có chắc chắn muốn xóa sinh viên ${displayName} (${item.student_id || '-'}) khỏi danh sách thực tập chính thức và bảng điểm không?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/final-internships/${item.user_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Xóa thất bại.');
      fetchRows();
    } catch (e) {
      alert('Lỗi kết nối khi xóa.');
    }
  };

  useEffect(() => { fetchRows(); }, [token]);

  const internshipPlace = (item: any) =>
    item.company_name === 'Công ty khác'
      ? `Công ty khác: ${item.other_company_name || ''}`
      : (item.company_name || '-');

  const typeLabel = (type?: string) =>
    type === 'school' ? 'Tại trường' : type === 'partner' ? 'Đối tác' : 'Công ty';

  const requestSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const SortIcon = ({ col }: { col: string }) => (
    <span className="inline-block ml-1 text-slate-400">
      {sortConfig?.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : <ArrowUpDown size={12} />}
    </span>
  );

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const includesTerm = (value: any) => String(value || '').toLowerCase().includes(term);
    let result = rows.filter(item => {
      if (initialCourseCode && item.course_code !== initialCourseCode) return false;
      const matchType = typeFilter ? item.internship_type === typeFilter : true;
      const matchTerm = !term ||
        includesTerm(item.student_id) ||
        includesTerm(item.student_name) ||
        includesTerm(item.email) ||
        includesTerm(item.class_name) ||
        includesTerm(item.course_code) ||
        includesTerm(internshipPlace(item)) ||
        includesTerm(item.school_lecturer) ||
        includesTerm(item.note);
      return matchType && matchTerm;
    });
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        const aVal = sortConfig.key === 'internship_place' ? internshipPlace(a) : (a[sortConfig.key] || '');
        const bVal = sortConfig.key === 'internship_place' ? internshipPlace(b) : (b[sortConfig.key] || '');
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal, 'vi') : bVal.localeCompare(aVal, 'vi');
        }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [rows, searchTerm, typeFilter, sortConfig]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, typeFilter, sortConfig, rows.length]);

  const pagination = paginationBounds(filteredRows.length, currentPage, pageSize);
  const paginatedRows = filteredRows.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);
  const uniqueStudents = new Set(rows.map(item => item.user_id || item.student_id || item.email).filter(Boolean)).size;
  const uniquePlaces = new Set(rows.map(internshipPlace).filter(Boolean)).size;
  const companyCount = rows.filter(item => item.internship_type === 'company').length;
  const schoolCount = rows.filter(item => item.internship_type === 'school').length;

  const exportXlsx = () => {
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Email VNU', 'SĐT', 'Email cá nhân', 'Lớp KH', 'Mã môn học', 'Loại', 'Nơi thực tập', 'GVHD tại trường', 'Yêu cầu phân công', 'Thời gian xác nhận', 'Ghi chú'];
    const data = filteredRows.map((item, idx) => [
      idx + 1,
      item.student_id || '',
      cleanStudentName(item.student_name, item.student_id),
      item.email || '',
      item.phone || '',
      item.personal_email || '',
      item.class_name || '',
      formatCourseCode(item.course_code),
      typeLabel(item.internship_type),
      internshipPlace(item),
      item.school_lecturer || '',
      item.school_assignment_request ? 'Khoa sẽ phân công' : '',
      item.confirmed_at ? new Date(item.confirmed_at).toLocaleString('vi-VN') : '',
      item.note || '',
    ]);
    saveXlsx('danh_sach_xac_nhan_thuc_tap.xlsx', headers, data, 'Xác nhận TT');
  };

  if (loading) return <div className="text-center py-20 text-gray-500">Đang tải danh sách xác nhận thực tập...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản trị
          </button>
          <h2 className="text-2xl font-bold text-[#0f172a] flex items-center gap-2">
            <CheckCircle2 className="text-[#1b7f37]" size={24} /> Danh sách xác nhận thực tập
            <PageDescriptionTooltip description="Sinh viên đã xác nhận nơi thực tập chính thức để lấy điểm học phần." />
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchRows}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer"
          >
            <RefreshCw size={14} /> Tải lại
          </button>
          <button
            onClick={exportXlsx}
            disabled={filteredRows.length === 0}
            className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Xuất XLSX
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <div className="bg-white p-4.5 rounded-2xl border border-black/[0.08] shadow-xs flex flex-col">
          <span className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-1">Tổng xác nhận</span>
          <span className="text-3xl font-bold tracking-tight text-[#0f172a]">{rows.length}</span>
        </div>
        <div className="bg-[#e8f1fb] p-4.5 rounded-2xl border border-[#d4e5f7] shadow-xs flex flex-col">
          <span className="text-[#034ea1] text-[11px] font-semibold uppercase tracking-wider mb-1">Số sinh viên</span>
          <span className="text-3xl font-bold tracking-tight text-[#034ea1]">{uniqueStudents}</span>
        </div>
        <div className="bg-[#f0f9ff] p-4.5 rounded-2xl border border-[#bae6fd] shadow-xs flex flex-col">
          <span className="text-[#0369a1] text-[11px] font-semibold uppercase tracking-wider mb-1">Số nơi thực tập</span>
          <span className="text-3xl font-bold tracking-tight text-[#0369a1]">{uniquePlaces}</span>
        </div>
        <div className="bg-[#dcfce7] p-4.5 rounded-2xl border border-[#d1f2d9] shadow-xs flex flex-col">
          <span className="text-[#1b7f37] text-[11px] font-semibold uppercase tracking-wider mb-1">Thực tập công ty</span>
          <span className="text-3xl font-bold tracking-tight text-[#1b7f37]">{companyCount}</span>
        </div>
        <div className="bg-[#f5f3ff] p-4.5 rounded-2xl border border-[#ddd6fe] shadow-xs flex flex-col">
          <span className="text-[#6d28d9] text-[11px] font-semibold uppercase tracking-wider mb-1">TT ở trường</span>
          <span className="text-3xl font-bold tracking-tight text-[#6d28d9]">{schoolCount}</span>
        </div>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-3.5 flex flex-col md:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm mã SV, tên, nơi thực tập, GVHD..."
            className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="border border-[#e2e8f0] rounded-xl px-3 py-2 text-xs font-semibold bg-white text-[#0f172a] shadow-xs outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] cursor-pointer"
        >
          <option value="">Tất cả loại</option>
          <option value="company">Công ty</option>
          <option value="school">Tại trường</option>
          <option value="partner">Đối tác</option>
        </select>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-[#f9f9fb] text-[10px] uppercase font-semibold text-slate-700 tracking-wider border-b border-slate-100 select-none">
              <tr>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('student_id')}>Mã SV<SortIcon col="student_id" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('student_name')}>Họ và tên<SortIcon col="student_name" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('internship_type')}>Loại<SortIcon col="internship_type" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('internship_place')}>Nơi thực tập<SortIcon col="internship_place" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('school_lecturer')}>GVHD tại trường<SortIcon col="school_lecturer" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('course_code')}>Môn học<SortIcon col="course_code" /></th>
                <th className="px-5 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('confirmed_at')}>Thời gian xác nhận<SortIcon col="confirmed_at" /></th>
                <th className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-slate-400">Chưa có sinh viên xác nhận nơi thực tập chính thức.</td>
                </tr>
              ) : (
                paginatedRows.map(item => (
                  <tr key={item.id} className="hover:bg-[#f8fafc] transition-colors">
                    <td className="px-5 py-3.5 font-mono font-medium text-slate-900">{item.student_id || '-'}</td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{cleanStudentName(item.student_name, item.student_id)}</div>
                      <div className="text-[10px] font-medium text-slate-400 mt-0.5">{item.class_name || '-'}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${item.internship_type === 'school' ? 'bg-[#e8f1fb] text-[#034ea1]' : item.internship_type === 'partner' ? 'bg-[#f5f3ff] text-[#6d28d9]' : 'bg-[#dcfce7] text-[#1b7f37]'}`}>
                        {typeLabel(item.internship_type)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 min-w-[200px] font-medium text-slate-700">{internshipPlace(item)}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-700">{item.school_assignment_request ? <span className="text-[#b45309] font-semibold">Khoa sẽ phân công</span> : (item.school_lecturer || '-')}</td>
                    <td className="px-5 py-3.5 text-xs font-semibold text-slate-700">{formatCourseCode(item.course_code) || '-'}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-400 text-[11px]">{item.confirmed_at ? new Date(item.confirmed_at).toLocaleString('vi-VN') : '-'}</td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteFinal(item)}
                        disabled={Boolean(item.locked_at)}
                        className="p-1.5 text-slate-400 hover:text-[#d70015] hover:bg-[#fee2e2] rounded-lg transition-colors disabled:opacity-30 cursor-pointer"
                        title={item.locked_at ? 'Đã khóa điểm, không thể xóa' : 'Xóa khỏi danh sách thực tập chính thức & bảng điểm'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={filteredRows.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="xác nhận"
        />
      </div>
    </div>
  );
}
