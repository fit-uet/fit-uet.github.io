import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import { Users, Upload, Download, Search, RefreshCw, Save, Plus, Trash2, X, Edit2 } from 'lucide-react';
import { API_BASE, saveXlsx, readSpreadsheetRows, paginationBounds, PaginationControls, PageDescriptionTooltip, cleanStudentName } from '../../../shared';

export function StudentRegistry({ token }: { token: string }) {
  const navigate = useNavigate();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [override, setOverride] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const emptyStudentForm = { student_id: '', name: '', dob: '', class_name: '', phone: '', personal_email: '' };
  const [newStudent, setNewStudent] = useState(emptyStudentForm);
  const [editingStudentKey, setEditingStudentKey] = useState<string | null>(null);
  const [editStudent, setEditStudent] = useState(emptyStudentForm);
  const pageSize = 25;
  const studentSelector = (student: any) => student?.student_id || `user:${student?.id}`;

  const fetchStudents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/students`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setStudents([]);
        return alert(data.error || 'Lỗi lấy danh sách sinh viên');
      }
      setStudents(Array.isArray(data) ? data : []);
    } catch (e) {
      setStudents([]);
      alert('Lỗi lấy danh sách sinh viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, [token]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredAndSortedStudents = useMemo(() => {
    let result = [...students];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(s =>
        s.student_id?.toLowerCase().includes(lower) ||
        s.name?.toLowerCase().includes(lower) ||
        s.class_name?.toLowerCase().includes(lower)
      );
    }
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = a[sortConfig.key] || '';
        const bVal = b[sortConfig.key] || '';
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [students, searchTerm, sortConfig]);
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortConfig, students.length]);
  const pagination = paginationBounds(filteredAndSortedStudents.length, currentPage, pageSize);
  const paginatedStudents = filteredAndSortedStudents.slice((pagination.safePage - 1) * pageSize, pagination.safePage * pageSize);

  const exportXlsx = () => {
    const headers = ['STT', 'Mã SV', 'Họ và tên', 'Ngày sinh', 'SĐT', 'Email cá nhân', 'Lớp khoá học'];
    const rows = filteredAndSortedStudents.map((s, idx) => [
      idx + 1,
      s.student_id,
      cleanStudentName(s.name, s.student_id),
      s.dob,
      s.phone || '',
      s.personal_email || '',
      s.class_name
    ]);
    saveXlsx('danh_sach_sinh_vien.xlsx', headers, rows, 'Sinh viên');
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(`Đang đọc file "${file.name}"...`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const rows = await readSpreadsheetRows(file);
      const imported = [];
      const header = (rows[0] || []).map(cell => cell.toLowerCase());
      const startIndex = header.some(cell => cell.includes('mã') || cell.includes('student')) ? 1 : 0;
      const studentIdIndex = Math.max(1, header.findIndex(cell => cell.includes('mã') || cell.includes('student')));
      const nameIndex = Math.max(2, header.findIndex(cell => cell.includes('họ') || cell.includes('tên') || cell === 'name'));
      const dobIndex = Math.max(3, header.findIndex(cell => cell.includes('sinh') || cell.includes('dob')));
      const classIndex = Math.max(4, header.findIndex(cell => cell.includes('lớp') || cell.includes('class')));
      for (let i = startIndex; i < rows.length; i++) {
        const parts = rows[i];
        if (!parts.some(Boolean)) continue;
        if (parts.length >= 5) {
          let dob = parts[dobIndex];
          if (dob.includes('/')) {
            const d = dob.split('/');
            if (d.length === 3) dob = `${d[2]}-${d[1]}-${d[0]}`;
          }
          imported.push({
            student_id: parts[studentIdIndex],
            name: parts[nameIndex],
            dob,
            class_name: parts[classIndex]
          });
        }
      }
      if (imported.length === 0) {
        alert('Không tìm thấy dữ liệu hợp lệ trong file');
        return;
      }

      setImportMessage(`Đang import ${imported.length} sinh viên lên hệ thống...`);
      const res = await fetch(`${API_BASE}/api/admin/students/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ students: imported, override })
      });
      if (res.ok) {
        alert('Import thành công!');
        fetchStudents();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + err.error);
      }
    } catch (e) {
      alert('Lỗi import');
    } finally {
      setImporting(false);
      setImportMessage('');
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xoá sinh viên này khỏi CSDL?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/students/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Xóa sinh viên thất bại.');
      fetchStudents();
    } catch (e) {
      alert('Lỗi xoá');
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      student_id: newStudent.student_id.trim(),
      name: newStudent.name.trim(),
      dob: newStudent.dob,
      class_name: newStudent.class_name.trim(),
      phone: newStudent.phone.trim(),
      personal_email: newStudent.personal_email.trim(),
    };
    if (!payload.student_id || !payload.name) {
      alert('Vui lòng nhập Mã SV và Họ tên.');
      return;
    }
    setSavingStudent(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không thể thêm sinh viên.');
      setNewStudent(emptyStudentForm);
      setShowAddForm(false);
      await fetchStudents();
    } catch (e) {
      alert('Lỗi thêm sinh viên');
    } finally {
      setSavingStudent(false);
    }
  };

  const startEditStudent = (student: any) => {
    setShowAddForm(false);
    setEditingStudentKey(studentSelector(student));
    setEditStudent({
      student_id: student.student_id || '',
      name: student.name || '',
      dob: student.dob || '',
      class_name: student.class_name || '',
      phone: student.phone || '',
      personal_email: student.personal_email || '',
    });
  };

  const cancelEditStudent = () => {
    setEditingStudentKey(null);
    setEditStudent(emptyStudentForm);
  };

  const handleUpdateStudent = async () => {
    if (!editingStudentKey) return;
    const payload = {
      student_id: editStudent.student_id.trim(),
      name: editStudent.name.trim(),
      dob: editStudent.dob,
      class_name: editStudent.class_name.trim(),
      phone: editStudent.phone.trim(),
      personal_email: editStudent.personal_email.trim(),
    };
    if (!payload.student_id || !payload.name) {
      alert('Vui lòng nhập Mã SV và Họ tên.');
      return;
    }
    setSavingStudent(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/students/${encodeURIComponent(editingStudentKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không thể cập nhật sinh viên.');
      cancelEditStudent();
      await fetchStudents();
    } catch (e) {
      alert('Lỗi cập nhật sinh viên');
    } finally {
      setSavingStudent(false);
    }
  };

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
            <Users className="text-[#034ea1]" size={24} /> CSDL Sinh viên
            <PageDescriptionTooltip description="Danh sách sinh viên và các thông tin cơ bản trong cơ sở dữ liệu hệ thống." />
          </h2>
        </div>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-3.5 flex flex-col xl:flex-row gap-2.5 items-stretch xl:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            type="text"
            placeholder="Tìm theo Mã SV, Tên, Lớp..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none bg-[#f8fafc] border border-[#e2e8f0] rounded-xl px-3 py-2">
            <input type="checkbox" checked={override} disabled={importing} onChange={e => setOverride(e.target.checked)} className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1] w-4 h-4 disabled:opacity-60 cursor-pointer animate-none" />
            Ghi đè SV
          </label>
          <label className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer border border-black/[0.08] hover:bg-[#f8fafc] bg-white text-[#0f172a] active:scale-[0.98] ${importing ? 'bg-slate-100 text-slate-400 cursor-wait pointer-events-none' : ''}`}>
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} {importing ? 'Đang import...' : 'Import XLSX'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={importing} className="hidden" onChange={handleFileUpload} onClick={(e) => { (e.target as any).value = null }} />
          </label>
          <button
            onClick={() => setShowAddForm(prev => !prev)}
            disabled={importing}
            className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            {showAddForm ? <X size={14} /> : <Plus size={14} />} {showAddForm ? 'Đóng' : 'Thêm sinh viên'}
          </button>
          <button
            onClick={exportXlsx}
            disabled={importing}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            <Download size={14} /> Xuất XLSX
          </button>
        </div>
      </div>
      {showAddForm && (
        <form onSubmit={handleAddStudent} className="mb-6 rounded-2xl border border-black/[0.08] bg-white p-5 shadow-xs">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Mã SV *</label>
              <input
                value={newStudent.student_id}
                onChange={e => setNewStudent({ ...newStudent, student_id: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
                placeholder="24021400"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Họ và tên *</label>
              <input
                value={newStudent.name}
                onChange={e => setNewStudent({ ...newStudent, name: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
                placeholder="Nguyễn Văn A"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ngày sinh</label>
              <input
                type="date"
                value={newStudent.dob}
                onChange={e => setNewStudent({ ...newStudent, dob: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">SĐT</label>
              <input
                value={newStudent.phone}
                onChange={e => setNewStudent({ ...newStudent, phone: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
                placeholder="09..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Lớp khoá học</label>
              <input
                value={newStudent.class_name}
                onChange={e => setNewStudent({ ...newStudent, class_name: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
                placeholder="QH-2024-I/CQ..."
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email cá nhân</label>
              <input
                type="email"
                value={newStudent.personal_email}
                onChange={e => setNewStudent({ ...newStudent, personal_email: e.target.value })}
                className="w-full border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all font-semibold text-slate-900 shadow-xs"
                placeholder="email@example.com"
              />
            </div>
            <div className="md:col-span-3 flex items-end justify-end gap-2">
              <button
                type="button"
                onClick={() => { setNewStudent(emptyStudentForm); setShowAddForm(false); }}
                disabled={savingStudent}
                className="bg-white text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={savingStudent}
                className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {savingStudent ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingStudent ? 'Đang lưu...' : 'Lưu sinh viên'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400 font-medium">Email VNU được tạo tự động theo dạng MSSV@vnu.edu.vn. Sinh viên ngoài khóa đang mở sẽ được xem là ngoại lệ nếu MSSV/email này tồn tại trong danh sách.</p>
        </form>
      )}
      {importing && (
        <div aria-live="polite" className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-[#ebf9ee] px-4 py-3 text-sm text-[#1b7f37]">
          <RefreshCw size={18} className="animate-spin shrink-0" />
          <span>{importMessage || 'Hệ thống đang import dữ liệu, vui lòng đợi...'}</span>
        </div>
      )}
      <div className="bg-white border border-black/[0.08] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-slate-600">
            <thead>
              <tr className="bg-[#f9f9fb] text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
                <th className="p-3.5 whitespace-nowrap">STT</th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('student_id')}>
                  Mã SV {sortConfig?.key === 'student_id' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>
                  Họ và tên {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('dob')}>
                  Ngày sinh {sortConfig?.key === 'dob' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('phone')}>
                  SĐT {sortConfig?.key === 'phone' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('personal_email')}>
                  Email cá nhân {sortConfig?.key === 'personal_email' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('class_name')}>
                  Lớp khoá học {sortConfig?.key === 'class_name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-3.5 whitespace-nowrap text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-400">
                    {students.length === 0 ? 'Chưa có dữ liệu sinh viên.' : 'Không có sinh viên phù hợp.'}
                  </td>
                </tr>
              ) : paginatedStudents.map((s, idx) => {
                const selector = studentSelector(s);
                const isEditing = editingStudentKey === selector;
                return (
                  <tr key={selector} className="hover:bg-[#f8fafc] transition-colors align-top">
                    <td className="p-3.5 text-xs text-slate-400">{(pagination.safePage - 1) * pageSize + idx + 1}</td>
                    {isEditing ? (
                      <>
                        <td className="p-2.5">
                          <input
                            value={editStudent.student_id}
                            onChange={e => setEditStudent({ ...editStudent, student_id: e.target.value })}
                            className="w-28 border border-[#034ea1] rounded-xl px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            value={editStudent.name}
                            onChange={e => setEditStudent({ ...editStudent, name: e.target.value })}
                            className="w-44 border border-[#034ea1] rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="date"
                            value={editStudent.dob}
                            onChange={e => setEditStudent({ ...editStudent, dob: e.target.value })}
                            className="w-36 border border-[#034ea1] rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            value={editStudent.phone}
                            onChange={e => setEditStudent({ ...editStudent, phone: e.target.value })}
                            className="w-32 border border-[#034ea1] rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="email"
                            value={editStudent.personal_email}
                            onChange={e => setEditStudent({ ...editStudent, personal_email: e.target.value })}
                            className="w-48 border border-[#034ea1] rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            value={editStudent.class_name}
                            onChange={e => setEditStudent({ ...editStudent, class_name: e.target.value })}
                            className="w-40 border border-[#034ea1] rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 transition-all bg-white shadow-xs"
                          />
                        </td>
                        <td className="p-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <button onClick={handleUpdateStudent} disabled={savingStudent} className="text-[#1b7f37] hover:bg-[#ebf9ee] p-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer" title="Lưu">
                              {savingStudent ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                            </button>
                            <button onClick={cancelEditStudent} disabled={savingStudent} className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer" title="Huỷ">
                              <X size={15} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-3.5 text-xs font-mono font-medium text-slate-800">{s.student_id}</td>
                        <td className="p-3.5 text-xs font-semibold text-slate-900">{s.name}</td>
                        <td className="p-3.5 text-xs text-slate-600">{s.dob}</td>
                        <td className="p-3.5 text-xs text-slate-600">{s.phone || '-'}</td>
                        <td className="p-3.5 text-xs text-slate-600">{s.personal_email ? <a href={`mailto:${s.personal_email}`} className="text-[#034ea1] hover:underline">{s.personal_email}</a> : '-'}</td>
                        <td className="p-3.5 text-xs text-slate-600">
                          <span className="bg-[#f8fafc] border border-black/[0.06] text-slate-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold">{s.class_name}</span>
                        </td>
                        <td className="p-3.5 text-xs text-right">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => startEditStudent(s)} className="text-[#034ea1] hover:bg-[#e8f1fb] p-1.5 rounded-lg transition-colors cursor-pointer" title="Sửa">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => handleDelete(selector)} className="text-[#ff3b30] hover:bg-[#fff2f1] p-1.5 rounded-lg transition-colors cursor-pointer" title="Xóa">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationControls
          total={filteredAndSortedStudents.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="sinh viên"
        />
      </div>
    </div>
  );
}
