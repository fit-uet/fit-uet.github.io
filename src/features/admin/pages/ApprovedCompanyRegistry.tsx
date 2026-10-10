import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Download, Search, RefreshCw, Save, Plus, Trash2, X, Edit2, Shield } from 'lucide-react';
import { API_BASE, saveXlsx, readSpreadsheetRows, clearJsonCache, PaginationControls, PageDescriptionTooltip } from '../../../shared';

export function ApprovedCompanyRegistry({ token }: { token: string }) {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [override, setOverride] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const fetchCompanies = async () => {
    clearJsonCache('companies:it-list');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/approved-companies`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setCompanies(Array.isArray(data) ? data : []);
    } catch (e) {
      alert('Lỗi lấy danh sách công ty thẩm định');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompanies(); }, [token]);

  const filteredAndSorted = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    const result = companies.filter(c =>
      !lower ||
      c.name?.toLowerCase().includes(lower) ||
      c.source?.toLowerCase().includes(lower) ||
      c.created_at?.toLowerCase().includes(lower)
    );
    result.sort((a, b) => {
      const aVal = String(a[sortConfig.key] ?? '').toLowerCase();
      const bVal = String(b[sortConfig.key] ?? '').toLowerCase();
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [companies, searchTerm, sortConfig]);
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortConfig, companies.length]);
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedApprovedCompanies = filteredAndSorted.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-xs">{sortConfig.key === col ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</span>
  );

  const handleAdd = async () => {
    if (!newName.trim()) return alert('Vui lòng nhập tên công ty');
    const res = await fetch(`${API_BASE}/api/admin/approved-companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName.trim(), source: 'manual' })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Thêm công ty thất bại');
    setNewName('');
    fetchCompanies();
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return alert('Vui lòng nhập tên công ty');
    const res = await fetch(`${API_BASE}/api/admin/approved-companies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: editName.trim(), source: 'manual' })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Cập nhật thất bại');
    setEditingId(null);
    fetchCompanies();
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Xóa "${name}" khỏi danh sách thẩm định nội bộ?`)) return;
    const res = await fetch(`${API_BASE}/api/admin/approved-companies/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return alert('Xóa thất bại');
    fetchCompanies();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await readSpreadsheetRows(file);
      const headerCells = (rows[0] || []).map(cell => cell.toLowerCase());
      const hasHeader = headerCells.some(cell => cell.includes('tên') || cell.includes('ten') || cell === 'stt');
      const nameIndex = Math.max(0, headerCells.findIndex(cell => cell.includes('tên công ty') || cell.includes('ten cong ty') || cell === 'name'));
      const bodyRows = hasHeader ? rows.slice(1) : rows;
      const companiesToImport = bodyRows.map(cells => {
        if (nameIndex > 0) return cells[nameIndex] || '';
        if (/^\d+$/.test(cells[0] || '') && cells[1]) return cells[1];
        return cells[0] || '';
      }).map(name => name.trim()).filter(Boolean);
      if (companiesToImport.length === 0) return alert('Không tìm thấy tên công ty hợp lệ trong file.');
      const res = await fetch(`${API_BASE}/api/admin/approved-companies/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companies: companiesToImport, override, source: file.name })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Import thất bại');
      alert(`Đã import ${data.count || companiesToImport.length} công ty thẩm định.`);
      fetchCompanies();
    } catch (err) {
      alert('Không thể đọc/import file XLSX/CSV.');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const exportXlsx = () => {
    const headers = ['STT', 'Tên công ty', 'Nguồn', 'Ngày tạo'];
    const rows = filteredAndSorted.map((c, idx) => [idx + 1, c.name || '', c.source || '', c.created_at || '']);
    saveXlsx('danh_sach_cong_ty_tham_dinh_noi_bo.xlsx', headers, rows, 'Thẩm định nội bộ');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <button
            onClick={() => navigate('/admin/companies')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản lý công ty
          </button>
          <h2 className="text-2xl font-bold text-[#0f172a] flex items-center gap-2">
            <Shield className="text-[#034ea1]" size={24} /> Danh sách công ty thẩm định nội bộ
            <PageDescriptionTooltip description={<>Danh sách này dùng để tự động duyệt công ty sinh viên tự liên hệ, không công khai cho sinh viên. Tổng: <strong>{companies.length}</strong></>} />
          </h2>
        </div>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl shadow-xs p-3.5 flex flex-col xl:flex-row gap-2.5 items-stretch xl:items-center justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm tên, nguồn..."
            className="w-full pl-9 pr-4 py-2 border border-[#e2e8f0] rounded-xl text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs text-[#0f172a]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none bg-[#f8fafc] border border-[#e2e8f0] rounded-xl px-3 py-2">
            <input type="checkbox" checked={override} disabled={importing} onChange={e => setOverride(e.target.checked)} className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1] w-4 h-4 disabled:opacity-60 cursor-pointer" />
            Ghi đè
          </label>
          <label className={`px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer border border-black/[0.08] hover:bg-[#f8fafc] bg-white text-[#0f172a] active:scale-[0.98] ${importing ? 'bg-slate-100 text-slate-400 cursor-wait pointer-events-none' : ''}`}>
            {importing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />} {importing ? 'Đang import...' : 'Import XLSX'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={importing} className="hidden" onChange={handleImport} onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} />
          </label>
          <button
            onClick={exportXlsx}
            disabled={loading || importing}
            className="bg-white hover:bg-[#f8fafc] text-[#0f172a] border border-black/[0.08] px-3.5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]"
          >
            <Download size={14} /> Xuất XLSX
          </button>
        </div>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl p-4 flex flex-col sm:flex-row gap-3 shadow-xs">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Tên công ty đã thẩm định"
          className="flex-1 border border-[#e2e8f0] rounded-xl px-3.5 py-2 text-xs bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-xs"
        />
        <button
          onClick={handleAdd}
          className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-5 py-2 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
        >
          <Plus size={15} /> Thêm công ty
        </button>
      </div>

      <div className="bg-white border border-black/[0.08] rounded-2xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse text-xs text-slate-600">
          <thead className="bg-[#f9f9fb] text-slate-700 font-semibold border-b border-slate-100 text-[10px] tracking-wider uppercase select-none">
            <tr>
              <th className="p-3 w-12">STT</th>
              <th className="p-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>Tên công ty<SortIcon col="name" /></th>
              <th className="p-3 cursor-pointer hover:bg-slate-100 transition-colors w-40" onClick={() => handleSort('source')}>Nguồn<SortIcon col="source" /></th>
              <th className="p-3 cursor-pointer hover:bg-slate-100 transition-colors w-44" onClick={() => handleSort('created_at')}>Ngày tạo<SortIcon col="created_at" /></th>
              <th className="p-3 text-right w-28">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedApprovedCompanies.map((c, idx) => (
              <tr key={c.id} className="hover:bg-[#f8fafc] transition-colors">
                <td className="p-3 text-slate-400">{(safeCurrentPage - 1) * pageSize + idx + 1}</td>
                <td className="p-3">
                  {editingId === c.id ? (
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} className="w-full border border-[#034ea1] rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all bg-white font-semibold text-slate-800 shadow-xs" />
                  ) : (
                    <span className="font-semibold text-slate-900">{c.name}</span>
                  )}
                </td>
                <td className="p-3 text-slate-500">{c.source || 'manual'}</td>
                <td className="p-3 text-slate-400 whitespace-nowrap text-[11px]">{c.created_at ? new Date(c.created_at).toLocaleString('vi-VN') : '-'}</td>
                <td className="p-3 text-right">
                  {editingId === c.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleUpdate(c.id)} className="text-[#1b7f37] hover:bg-[#ebf9ee] p-1.5 rounded-lg transition-colors cursor-pointer" title="Lưu"><Save size={15} /></button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer" title="Hủy"><X size={15} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditingId(c.id); setEditName(c.name || ''); }} className="text-[#034ea1] hover:bg-[#e8f1fb] p-1.5 rounded-lg transition-colors cursor-pointer" title="Sửa"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(c.id, c.name)} className="text-[#ff3b30] hover:bg-[#fff2f1] p-1.5 rounded-lg transition-colors cursor-pointer" title="Xóa"><Trash2 size={15} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filteredAndSorted.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">Không có công ty thẩm định phù hợp.</div>
        )}
        {loading && (
          <div className="text-center py-12 text-slate-400 text-sm">Đang tải danh sách...</div>
        )}
        <PaginationControls
          total={filteredAndSorted.length}
          currentPage={currentPage}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          label="công ty"
        />
      </div>
    </div>
  );
}
