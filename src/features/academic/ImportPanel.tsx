import { useState } from 'react';
import { Button, FormField } from '../../shared/ui';
import { academicApi } from './client';
import type { LecturerInfo } from '../../shared/academic';

type Row = { key: string; sources: string[]; studentId: string; name: string; dob: string; className: string; classCode: string; topic: string; note: string; advisorName: string; advisorEmail: string; primaryId: number | null; excluded: boolean; issues: string[] };
type Preview = { id: string; expiresAt: string; rows: Row[]; summary: Record<string, number>; lecturers: LecturerInfo[] };
const fieldClass = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all shadow-xs';
export function ImportPanel({ token, semesterId, onImported }: { token: string; semesterId: string; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, any>>({}); const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [page, setPage] = useState(1);
  const [onlyErrors, setOnlyErrors] = useState(true); const [dirty, setDirty] = useState(false);
  const inspect = async () => {
    if (!file) return; setBusy(true); setMessage('');
    try {
      const data = new FormData(); data.set('file', file); data.set('resolutions', JSON.stringify(resolutions));
      setPreview(await academicApi(token, `/api/admin/semesters/${semesterId}/enrollments/import/preview`, 'POST', data)); setPage(1); setDirty(false); setEditing(null);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const resolve = (row: Row, patch: Record<string, unknown>) => {
    setResolutions(previous => ({ ...previous, ...Object.fromEntries(row.sources.map(key => [key, { ...previous[key], ...patch }])) })); setDirty(true);
  };
  const apply = async () => {
    if (!preview) return; setBusy(true);
    try { const result = await academicApi(token, `/api/admin/enrollment-imports/${preview.id}/commit`, 'POST'); setMessage(`Đã nhập: ${result.created} mới, ${result.updated} cập nhật, ${result.unchanged} giữ nguyên.`); setPreview(null); setFile(null); setResolutions({}); onImported(); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const rows = preview?.rows.filter(r => !onlyErrors || r.issues.length && !r.excluded) || [];
  return <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div><h3 className="font-semibold text-slate-900">Import danh sách Dự án</h3><p className="text-sm text-slate-500 mt-1">Chỉ lấy dòng có STT trong hai sheet DACN/DAKH; lớp lấy từ Mã LMH. Kiểm tra danh sách trước khi tiếp nhận sinh viên.</p></div>
    <div className="flex flex-wrap gap-3 items-end"><FormField label="File danh sách (.xlsx)"><input type="file" accept=".xlsx" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setResolutions({}); setMessage(''); }} /></FormField>
      <Button disabled={!file || !semesterId || busy} onClick={inspect}>{busy ? 'Đang xử lý…' : dirty ? 'Kiểm tra lại thay đổi' : 'Xem trước'}</Button></div>
    {message && <p role="status" className="text-sm p-3 bg-blue-50 rounded-lg text-blue-900">{message}</p>}
    {preview && <>
      <div className="flex flex-wrap gap-4 text-sm"><span>{preview.summary.students} sinh viên/lớp</span><span>{preview.summary.classes} lớp</span><span>{preview.summary.created} mới</span><span>{preview.summary.updated} cập nhật</span><span className="text-rose-700">{preview.summary.errors} dòng cần xử lý</span><span>{preview.summary.excluded} loại</span><span>{preview.summary.ignoredWithoutStt || 0} dòng bỏ qua vì thiếu STT</span></div>
      <label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={onlyErrors} onChange={e => { setOnlyErrors(e.target.checked); setPage(1); }} />Chỉ hiện dòng cần xử lý</label>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr>{['Nguồn', 'MSSV / Họ tên', 'Lớp', 'GVHD', 'Kết quả', ''].map((x, i) => <th key={i} className="p-3">{x}</th>)}</tr></thead><tbody>
        {rows.slice((page - 1) * 20, page * 20).map(row => <tr key={row.key} className="border-b border-slate-100"><td className="p-3 text-xs text-slate-500">{row.sources.join(', ')}</td><td className="p-3"><div>{row.studentId}</div><strong>{row.name}</strong></td><td className="p-3 whitespace-nowrap">{row.classCode}</td><td className="p-3">{preview.lecturers.find(l => l.id === row.primaryId)?.name || row.advisorName || 'Chưa phân công'}</td><td className="p-3 max-w-sm text-xs text-rose-700">{row.excluded ? 'Đã loại' : row.issues.length ? row.issues.join(' ') : <span className="text-emerald-700">Hợp lệ</span>}</td><td className="p-3"><Button size="sm" onClick={() => setEditing(row)}>Đối soát</Button></td></tr>)}
      </tbody></table>{!rows.length && <p className="p-4 text-slate-500">Không có dòng cần xử lý trong bộ lọc.</p>}</div>
      <div className="flex items-center justify-between gap-2"><div className="flex gap-2 items-center"><Button size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Trước</Button><span className="text-xs">Trang {page}/{Math.max(1, Math.ceil(rows.length / 20))}</span><Button size="sm" disabled={page * 20 >= rows.length} onClick={() => setPage(p => p + 1)}>Sau</Button></div>
        <Button variant="primary" disabled={busy || dirty || preview.summary.errors > 0} onClick={apply}>Xác nhận nhập danh sách</Button></div>
      {dirty && <p className="text-sm text-amber-700">Cần kiểm tra lại để có bản xem trước cuối cùng trước khi nhập.</p>}
    </>}
    {editing && <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"><form className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-xl space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); resolve(editing, { studentId: f.get('studentId'), name: f.get('name'), dob: f.get('dob'), className: f.get('className'), classCode: f.get('classCode'), topic: f.get('topic'), note: f.get('note'), primaryId: f.get('primaryId') ? Number(f.get('primaryId')) : null, ignoreAdvisor: !f.get('primaryId'), excluded: f.get('excluded') === 'on', useFile: f.get('useFile') === 'on' }); setEditing(null); }}>
      <h3 className="font-semibold">Đối soát {editing.sources.join(', ')}</h3><p className="text-xs text-slate-500">Giá trị xác nhận áp dụng cho các dòng trùng trong nhóm. Hãy đối chiếu nguồn trước khi sửa MSSV.</p>
      <div className="grid grid-cols-2 gap-3">{[['studentId', 'MSSV'], ['name', 'Họ tên'], ['dob', 'Ngày sinh (YYYY-MM-DD)'], ['className', 'Lớp khóa học'], ['classCode', 'Mã lớp học phần'], ['topic', 'Đề tài'], ['note', 'Ghi chú đăng ký']].map(([key, label]) => <FormField key={key} label={label}><input className={fieldClass} name={key} defaultValue={resolutions[editing.key]?.[key] ?? editing[key]} /></FormField>)}</div>
      <FormField label="Ánh xạ GVHD chính"><select className={fieldClass} name="primaryId" defaultValue={resolutions[editing.key]?.primaryId ?? editing.primaryId ?? ''}><option value="">Chưa có / không nhập phân công</option>{preview?.lecturers.map(l => <option key={l.id} value={l.id}>{l.name} — {l.email}</option>)}</select></FormField>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="useFile" defaultChecked={!!resolutions[editing.key]?.useFile} />Xác nhận cập nhật thông tin/phân công hiện có bằng giá trị này</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" name="excluded" defaultChecked={!!resolutions[editing.key]?.excluded} />Loại nhóm dòng này khỏi lần nhập</label>
      <div className="flex justify-end gap-2"><Button onClick={() => setEditing(null)}>Hủy</Button><Button type="submit" variant="primary">Lưu đối soát</Button></div>
    </form></div>}
  </section>;
}
