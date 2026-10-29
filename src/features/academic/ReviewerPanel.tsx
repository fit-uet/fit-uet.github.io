import { useEffect, useId, useRef, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { CampaignToolbarActions } from './CampaignLayoutContext';
import { EnrollmentDialog } from './EnrollmentDialog';
import type { AcademicClassSummary, LecturerInfo } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicApi } from './client';
import { academicInput } from './form';

const reasons: Record<string, string> = { same_work_unit: 'Cùng bộ môn', cross_work_unit: 'Khác bộ môn', missing_work_unit: 'Thiếu bộ môn', missing_primary: 'Chưa có GVHD', no_eligible_reviewer: 'Không có GV phù hợp', quota_exhausted: 'Hết chỉ tiêu', manual_preview: 'Khoa điều chỉnh' };
export function ReviewerPanel({ token, c, lecturers, quotas, refresh }: { token: string; c: AcademicClassSummary; lecturers: LecturerInfo[]; quotas: any[]; refresh: () => Promise<void> }) {
  const [visible, setVisible] = useState(false);
  const triggerId = useId();
  const request = useRef<AbortController | null>(null), epoch = useRef(0);
  useEffect(() => () => { epoch.current++; request.current?.abort(); }, []);
  const [preview, setPreview] = useState<any>(null); const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [scope, setScope] = useState('semester'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [dirty, setDirty] = useState(false);
  const inspect = async (nextScope = scope, nextOverrides = overrides) => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort; const version = ++epoch.current;
    setBusy(true); setMessage('');
    try {
      const result = await academicApi(token, `/api/admin/semesters/${c.semesterId}/reviewers/preview`, 'POST', { classIds: nextScope === 'class' ? [c.id] : undefined, overrides: Object.entries(nextOverrides).map(([enrollmentId, lecturerId]) => ({ enrollmentId, lecturerId })) }, abort.signal);
      if (version === epoch.current && !abort.signal.aborted) { setPreview(result); setDirty(false); }
    } catch (error) { if (error.name !== 'AbortError' && version === epoch.current) setMessage(error.message); }
    finally { if (version === epoch.current) { setBusy(false); request.current = null; } }
  };
  const close = () => { if (request.current) { request.current.abort(); request.current = null; epoch.current++; setBusy(false); } setVisible(false); };
  const start = () => { setPreview(null); setOverrides({}); setScope('semester'); setDirty(false); setVisible(true); void inspect('semester', {}); };
  return <>
    <CampaignToolbarActions><Button id={triggerId} aria-label="Phân công GV nhận xét" variant="primary" leadingIcon={<UserCheck size={14} />} disabled={busy || c.status !== 'active'} onClick={start}>Phân công GVNX</Button></CampaignToolbarActions>
    {visible && <EnrollmentDialog title="Phân công GV nhận xét" close={close} returnFocus={()=>document.getElementById(triggerId)}><section className="space-y-4">
    <p className="text-sm text-slate-500">Ưu tiên cùng bộ môn GVHD, cân bằng số bài trong học kỳ. Kiểm tra phương án rồi bấm <strong>Xác nhận phân công</strong> để lưu. Phân công đã có được giữ nguyên; hệ thống không tự phân công khi mở trang.</p>
    {message && <p role="status" className="text-sm bg-blue-50 text-blue-900 p-3 rounded-lg">{message}</p>}
    <div className="flex flex-wrap gap-3 items-end"><FormField label="Phạm vi"><select className={academicInput} disabled={busy} value={scope} onChange={e => { setScope(e.target.value); setPreview(null); setOverrides({}); setDirty(false); }}><option value="semester">Tất cả lớp Dự án trong học kỳ</option><option value="class">Chỉ lớp {c.code}</option></select></FormField><Button disabled={busy || c.status !== 'active'} onClick={()=>inspect()}>{busy ? 'Đang xử lý…' : dirty ? 'Kiểm tra lại phương án' : 'Xem trước phân công'}</Button></div>
    {preview && <><div className="overflow-x-auto max-h-96"><table className="w-full text-left text-sm"><thead className="bg-slate-50 sticky top-0"><tr><th className="p-3">Sinh viên / lớp</th><th className="p-3">GVNX dự kiến</th><th className="p-3">Tải</th><th className="p-3">Căn cứ</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.enrollmentId} className="border-b"><td className="p-3"><strong>{row.studentName}</strong><div className="text-xs text-slate-500">{row.studentId} · {row.classCode}</div></td><td className="p-3"><select className={academicInput} disabled={busy} value={Object.prototype.hasOwnProperty.call(overrides, row.enrollmentId) ? overrides[row.enrollmentId] ?? '' : row.lecturerId ?? ''} onChange={e => { setOverrides(previous => ({ ...previous, [row.enrollmentId]: e.target.value ? Number(e.target.value) : null })); setDirty(true); }}><option value="">Chưa phân công</option>{preview.candidates.map(l => <option key={l.id} value={l.id}>{l.name} · {l.work_unit}</option>)}</select></td><td className="p-3 whitespace-nowrap">{row.loadBefore} → {row.loadAfter}</td><td className={`p-3 text-xs ${row.reason === 'same_work_unit' ? 'text-emerald-700' : 'text-amber-700'}`}>{reasons[row.reason] || row.reason}</td></tr>)}</tbody></table>{!preview.rows.length && <p className="p-4 text-slate-500">Không có sinh viên cần bổ sung GVNX.</p>}</div>
      <Button variant="primary" disabled={busy || dirty || c.status !== 'active' || !preview.rows.some(r => r.lecturerId != null)} onClick={async () => { setBusy(true); try { const result = await academicApi(token, `/api/admin/reviewer-previews/${preview.id}/apply`, 'POST'); setMessage(`Đã phân công ${result.assigned} sinh viên; ${result.unassigned} chưa phân công.`); setPreview(null); setOverrides({}); await refresh(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}>Xác nhận phân công</Button>
    </>}
    <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Chỉ tiêu nhận xét theo giảng viên / học kỳ</summary><form className="space-y-3 mt-4" onSubmit={async event => { event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); try { await academicApi(token, `/api/admin/semesters/${c.semesterId}/reviewer-quotas`, 'PUT', { quotas: lecturers.map(l => ({ lecturerId: l.id, maxReviews: f.get(String(l.id)) === '' ? null : Number(f.get(String(l.id))) })) }); setPreview(null); await refresh(); setMessage('Đã cập nhật chỉ tiêu. Tạo lại phương án phân công để dùng dữ liệu mới.'); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }}><p className="text-xs text-slate-500">Để trống: không đặt trần. Giá trị 0: không nhận thêm bài. Không thay đổi quota hướng dẫn Thực tập.</p><div className="grid md:grid-cols-3 gap-3 max-h-72 overflow-y-auto">{lecturers.filter(l => !/(^|\s)CN[.\s]/i.test(l.name)).map(l => <FormField key={l.id} label={l.name}><input className={academicInput} name={String(l.id)} type="number" min="0" step="1" defaultValue={quotas.find(q => q.lecturerId === l.id)?.maxReviews ?? ''} /></FormField>)}</div><Button type="submit" disabled={busy || c.status !== 'active'}>Lưu chỉ tiêu</Button></form></details>
  </section></EnrollmentDialog>}
  </>;
}
