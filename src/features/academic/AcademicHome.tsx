import { refreshRequestCache } from '../../shared/utils/requestCache';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, ArrowRight, RefreshCw } from 'lucide-react';
import { Button, FormField, PageHeader } from '../../shared/ui';
import { COURSE_CATALOG, TERM_NAMES, type CampaignSummary, type AcademicSemester } from '../../shared/academic';
import { academicApi, academicDownload } from './client';
import { CampaignMigration } from './CampaignMigration';

const inputClass = 'border border-slate-300 rounded-md px-3 py-2 text-sm bg-white w-full';
export function AcademicHome({ token, user }: { token: string; user: any }) {
  const [classes, setClasses] = useState<CampaignSummary[]>([]); const [semesters, setSemesters] = useState<AcademicSemester[]>([]);
  const [selected, setSelected] = useState(() => sessionStorage.getItem('academic:semester') || ''); const [group, setGroup] = useState(() => sessionStorage.getItem('academic:group') || 'all'); const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [legacy, setLegacy] = useState<any>(null);
  const [unmappedLegacy, setUnmappedLegacy] = useState(false);
  const admin = user.role === 'admin';
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await academicApi(token, '/api/me/campaigns?section=base', 'GET', undefined, signal);
      setClasses(data.campaigns); setSemesters([...data.semesters].sort((a, b) => b.year - a.year || a.term.localeCompare(b.term)));
      setUnmappedLegacy(data.legacyInternshipUnmapped === true);
      setSelected(value => data.semesters.some(s => s.id === value) ? value : data.semesters.find(s => s.term === '1' && s.year === 2026)?.id || data.semesters[0]?.id || '');
    } catch (error) { if (error.name !== 'AbortError') setMessage(error.message); } finally { if (!signal?.aborted) setLoading(false); }
  }, [token]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setMessage(''); try { await action(); await load(); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const downloadOnly = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  useEffect(() => { const update = () => { if (document.visibilityState === 'visible') load(); }; window.addEventListener('api-data-changed', update); document.addEventListener('visibilitychange', update); return () => { window.removeEventListener('api-data-changed', update); document.removeEventListener('visibilitychange', update); }; }, [load]);
  const filtered = classes.filter(c => (!selected || c.semesterId === selected) && (group === 'all' || c.group === group));
  return <div className="max-w-7xl mx-auto space-y-6">
    <PageHeader title="Học kỳ và nhóm môn" description="Thực tập · Dự án công nghệ · Dự án khoa học" icon={<BookOpen size={22} />} actions={<><Button onClick={() => { refreshRequestCache(); load(); }} leadingIcon={<RefreshCw size={15} />}>Tải lại</Button>{admin && <Button variant="primary" onClick={() => setManage(!manage)}>{manage ? 'Đóng quản lý' : 'Quản lý học kỳ / nhóm môn'}</Button>}</>} />
    <div className="flex flex-wrap gap-3 items-end"><FormField label="Học kỳ"><select aria-label="Học kỳ" className={inputClass} value={selected} onChange={e => { setSelected(e.target.value); sessionStorage.setItem('academic:semester', e.target.value); }}><option value="">Tất cả học kỳ</option>{semesters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></FormField>
      <FormField label="Nhóm môn"><select className={inputClass} value={group} onChange={e => { setGroup(e.target.value); sessionStorage.setItem('academic:group', e.target.value); }}><option value="all">Tất cả nhóm môn</option><option value="internship">Thực tập</option><option value="project">Dự án</option></select></FormField>
      {admin && selected && <Button disabled={busy} onClick={() => downloadOnly(() => academicDownload(token, `/api/admin/semesters/${selected}/grades/export.xlsx?group=${group}`, `bang-diem-${selected}.xlsx`))}>Xuất điểm học kỳ</Button>}

    </div>
    {message && <div role="status" className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-lg text-sm">{message}</div>}
    {unmappedLegacy && <section className="bg-white border border-amber-200 rounded-xl p-5 space-y-2"><h3 className="font-semibold">Thực tập Hè 2025–2026</h3><p className="text-sm text-slate-600">Hồ sơ của bạn đang chờ Khoa xác nhận học phần. Bạn vẫn có thể mở hồ sơ Thực tập đã có.</p><Link className="inline-flex items-center gap-2 text-sm font-semibold text-[#034ea1]" to="/internship/legacy">Mở hồ sơ Thực tập<ArrowRight size={15} /></Link></section>}
    {admin && manage && <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-6">
      <div className="grid md:grid-cols-2 gap-8">
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => { const s = await academicApi(token, '/api/admin/semesters', 'POST', { year: Number(f.get('year')), term: f.get('term') }); setSelected(s.id); }); }} className="space-y-3"><h3 className="font-semibold">Tạo học kỳ</h3><div className="flex gap-3"><FormField label="Năm bắt đầu"><input className={inputClass} type="number" name="year" min="2000" max="2100" defaultValue="2026" required /></FormField><FormField label="Học kỳ"><select className={inputClass} name="term">{Object.entries(TERM_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></FormField></div><Button type="submit" disabled={busy}>Tạo học kỳ</Button></form>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => academicApi(token, '/api/admin/classes', 'POST', { semesterId: selected, courseCode: f.get('course'), section: f.get('section') })); }} className="space-y-3"><h3 className="font-semibold">Mở lớp trong học kỳ đang chọn</h3><div className="flex gap-3"><FormField label="Học phần"><select className={inputClass} name="course">{COURSE_CATALOG.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</select></FormField><FormField label="Số lớp"><input className={inputClass} name="section" defaultValue="1" required maxLength={30} /></FormField></div><Button type="submit" disabled={busy || !selected}>Tạo lớp nháp</Button></form>
      </div>
      <div className="border-t border-slate-200 pt-4"><h3 className="font-semibold mb-2">Đợt Thực tập hiện có</h3><p className="text-sm text-slate-500 mb-3">Xem trước ánh xạ vào Hè 2025–2026. Các bảng, báo cáo và điểm gốc tiếp tục được giữ nguyên.</p>
        <Button disabled={busy} onClick={() => run(async () => setLegacy(await academicApi(token, '/api/admin/academic-legacy/preview', 'POST')))}>Xem trước ánh xạ Thực tập cũ</Button>
        {legacy && <div className="mt-3 space-y-3 text-sm"><p>{legacy.summary.created} lần học mới · {legacy.summary.existing} đã ánh xạ · {legacy.summary.blocked.length} hồ sơ cần đối soát</p>
          {!!legacy.summary.blocked.length && <details><summary className="cursor-pointer">Hồ sơ chưa thể ánh xạ</summary><ul className="mt-2 space-y-1">{legacy.summary.blocked.map(x => <li key={x.userId}>{x.studentId || `User ${x.userId}`}: {x.reason}</li>)}</ul></details>}
          <Button variant="primary" disabled={busy} onClick={() => run(async () => { await academicApi(token, `/api/admin/academic-legacy/${legacy.id}/apply`, 'POST'); setLegacy(null); setMessage('Đã ánh xạ các hồ sơ hợp lệ. Hồ sơ cần đối soát vẫn được giữ tại hệ thống Thực tập cũ.'); })}>Xác nhận ánh xạ hồ sơ hợp lệ</Button>
        </div>}
      </div>
    </section>}
    {loading ? <p role="status">Đang tải nhóm môn…</p> : !filtered.length ? <div className="bg-white border rounded-xl p-10 text-center text-slate-500">Chưa có nhóm môn trong học kỳ đã chọn.</div> : <div className="grid md:grid-cols-2 gap-5">{filtered.map(p => <article key={p.id} className="bg-white border rounded-xl p-6 space-y-4"><div className="flex justify-between gap-3"><h3 className="font-bold text-xl">{p.group === 'project' ? 'Dự án' : 'Thực tập'}</h3><span className="text-xs bg-slate-100 rounded px-2 py-1">{p.pendingMigration ? 'Chờ chuyển đổi' : p.status === 'active' ? 'Đang hoạt động' : p.status === 'archived' ? 'Lưu trữ' : 'Nháp'}</span></div><p className="text-sm text-slate-500">{p.semesterName}</p>{admin && <p className="text-sm text-slate-600">{p.classCount} lớp học phần · {p.studentCount} sinh viên · {p.enrollmentCount} lần học</p>}<Link className="text-[#034ea1] inline-flex gap-2 items-center font-semibold text-sm hover:underline" to={`/campaigns/${p.id}`}>{admin ? `Mở quản lý ${p.group === 'project' ? 'Dự án' : 'Thực tập'}` : `Vào học phần ${p.group === 'project' ? 'Dự án' : 'Thực tập'}`}<ArrowRight size={15} /></Link></article>)}</div>}
    {admin && classes.some(p => p.pendingMigration) && <CampaignMigration token={token} refresh={() => load()} />}
  </div>;
}
