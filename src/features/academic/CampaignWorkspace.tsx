import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, FormField, PageHeader } from '../../shared/ui';
import { GROUP_NAMES, type CampaignSummary, type AcademicClassSummary, type EnrollmentView, type LecturerInfo } from '../../shared/academic';
import { academicApi, academicDownload, clearAcademicCache } from './client';
import { clearReportReviewCache } from '../lecturer/pages/ReportReviewPanel';
import { EnrollmentPanel, academicInput } from './EnrollmentPanel';
import { ImportPanel } from './ImportPanel';
import { ReviewerPanel } from './ReviewerPanel';
import { CampaignSettingsPanel } from './CampaignSettings';
import { CampaignMigration } from './CampaignMigration';
import { ClassChat, ClassQuestions, ClassAnnouncement } from './ClassCommunications';
import { LegacyCampaignPanels } from './LegacyCampaignPanels';

type RecordView = EnrollmentView & { classCode: string; courseCode: string };
type Meta = { campaign: CampaignSummary; classes: AcademicClassSummary[]; lecturers: LecturerInfo[]; quotas: any[]; stats: Record<string, number> };
type Page = { items: RecordView[]; total: number; studentCount: number; page: number; limit: number; totalPages: number };
const gradeNames = { missing: 'Chưa có điểm', partial: 'Chưa đủ phần điểm', complete: 'Đủ điểm', locked: 'Đã khóa' };
export function CampaignPage({ token, user }: { token: string; user: any }) {
  const { campaignId = '' } = useParams(); return <CampaignWorkspace key={campaignId} id={campaignId} token={token} user={user} />;
}
function CampaignWorkspace({ id, token, user }: { id: string; token: string; user: any }) {
  useEffect(() => { clearAcademicCache(); clearReportReviewCache(); return () => { clearAcademicCache(); clearReportReviewCache(); }; }, [id, token]);
  const [query, setQuery] = useSearchParams(); const tab = query.get('tab') || (user.role === 'student' ? 'students' : 'overview');
  const [data, setData] = useState<Meta | null>(null), [rows, setRows] = useState<Page | null>(null), [selected, setSelected] = useState<EnrollmentView | null>(null);
  const [chat, setChat] = useState<any>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const filters = Object.fromEntries(['courseCode', 'classId', 'lecturerId', 'status', 'q', 'page'].map(k => [k, query.get(k) || '']).filter(([, v]) => v));
  const filterKey = new URLSearchParams(filters).toString(); const selectedId = query.get('enrollmentId') || '';
  const editQuery = (patch: Record<string, string>) => { setQuery(old => { const next = new URLSearchParams(old); for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key); if (!('page' in patch)) next.delete('page'); return next; }); };
  useEffect(() => { if (user.role === 'student' && !selectedId && rows?.total === 1 && rows.items.length === 1) setQuery(old => { const next = new URLSearchParams(old); next.set('enrollmentId', rows.items[0].id); return next; }, { replace: true }); }, [user.role, selectedId, rows, setQuery]);
  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Meta>(token, `/api/campaigns/${id}`, 'GET', undefined, signal); setData(result); sessionStorage.setItem('academic:campaign', id); sessionStorage.setItem('academic:semester', result.campaign.semesterId);
  }, [token, id]);
  const loadRows = useCallback(async (signal?: AbortSignal) => setRows(await academicApi(token, `/api/campaigns/${id}/enrollments?${filterKey}`, 'GET', undefined, signal)), [token, id, filterKey]);
  const refresh = useCallback(async () => { await Promise.all([loadMeta(), loadRows()]); if (selectedId) setSelected(await academicApi(token, `/api/enrollments/${selectedId}`)); }, [loadMeta, loadRows, selectedId, token]);
  useEffect(() => { const a = new AbortController(); loadMeta(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadMeta]);
  useEffect(() => { const a = new AbortController(); setRows(null); loadRows(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadRows]);
  useEffect(() => {
    const a = new AbortController(); setSelected(null); if (selectedId) academicApi<EnrollmentView>(token, `/api/enrollments/${selectedId}`, 'GET', undefined, a.signal).then(e => setSelected(e)).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => a.abort();
  }, [token, id, selectedId]);
  useEffect(() => { if (tab !== 'chat') return; const a = new AbortController(); academicApi(token, `/api/campaigns/${id}/chat-context`, 'GET', undefined, a.signal).then(setChat).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [token, id, tab]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  if (!data) return <p role="status">{error || 'Đang tải nhóm môn…'}</p>;
  const p = data.campaign, admin = user.role === 'admin', student = user.role === 'student';
  const chosenClass = data.classes.find(c => c.id === query.get('classId'));
  const selectedClass = selected && data.classes.find(c => c.id === selected.classId);
  const legacyPanel = p.legacy && p.status === 'active' && !student && ['assignments', 'reports', 'grades', 'registrations', 'final-internships'].includes(tab);
  const synthetic = { ...data.classes[0], ...p, code: GROUP_NAMES[p.group], courseName: GROUP_NAMES[p.group], canJoin: false } as AcademicClassSummary;
  const nav = student ? [['students', 'Hồ sơ và bài nộp'], ['plan', 'Kế hoạch và hướng dẫn'], ['chat', 'Trao đổi'], ['questions', 'Hỏi đáp']] : [['overview', 'Tổng quan'], ['students', 'Sinh viên'], ...(p.group === 'internship' ? [['registrations', 'Đăng ký'], ['final-internships', 'Nơi thực tập']] : []), ['assignments', 'Phân công'], ['reports', 'Báo cáo'], ['grades', 'Bảng điểm'], ['chat', 'Trao đổi'], ['plan', 'Kế hoạch và hướng dẫn'], ['questions', 'Hỏi đáp'], ...(admin ? [['announcements', 'Thông báo'], ['settings', 'Thiết lập']] : [])];
  const dataset = ['students', 'assignments', 'reports', 'grades', 'registrations', 'final-internships'].includes(tab) ? tab : 'students';
  const name = (e: EnrollmentView, role: string) => e.assignments.filter(a => a.role === role).map(a => data.lecturers.find(l => l.id === a.lecturerId)?.name || '').join('; ') || 'Chưa phân công';
  return <div className="max-w-7xl mx-auto space-y-5"><Link className="text-sm text-[#034ea1]" to="/classes">← Học kỳ và nhóm môn</Link>
    <PageHeader title={GROUP_NAMES[p.group]} description={p.semesterName} actions={<Button disabled={busy} onClick={() => run(refresh)}>Tải lại</Button>} />
    <div className="flex flex-wrap items-center gap-3 text-sm"><span className="bg-slate-100 px-3 py-1 rounded">{p.pendingMigration ? 'Chờ chuyển đổi' : p.status === 'active' ? 'Đang hoạt động' : p.status === 'archived' ? 'Lưu trữ · Chỉ xem' : 'Nhóm nháp'}</span><span>{p.classCount} lớp · {p.studentCount} sinh viên · {p.enrollmentCount} lần học</span></div>
    {error && <p role="alert" className="bg-rose-50 text-rose-800 p-3 rounded text-sm">{error}</p>}{notice && <p role="status" className="bg-blue-50 text-blue-900 p-3 rounded text-sm">{notice}</p>}
    {p.pendingMigration ? <CampaignMigration token={token} refresh={refresh} /> : <>
      <nav className="flex flex-wrap gap-1 border-b" aria-label="Chức năng nhóm môn">{nav.map(([key, label]) => <button key={key} onClick={() => editQuery({ tab: key, enrollmentId: '' })} className={`text-sm px-3 py-3 border-b-2 ${key === tab ? 'text-[#034ea1] border-[#034ea1] font-semibold' : 'text-slate-500 border-transparent'}`}>{label}</button>)}</nav>
      {!['settings', 'plan', 'chat', 'questions'].includes(tab) && <div className="bg-white border rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <FormField label="Học phần"><select className={academicInput} value={query.get('courseCode') || ''} onChange={e => editQuery({ courseCode: e.target.value, classId: '', enrollmentId: '' })}><option value="">Tất cả học phần</option>{[...new Set(data.classes.map(c => c.courseCode))].map(code => <option key={code}>{code}</option>)}</select></FormField>
        <FormField label="Lớp học phần"><select className={academicInput} value={query.get('classId') || ''} onChange={e => editQuery({ classId: e.target.value, enrollmentId: '' })}><option value="">Tất cả lớp</option>{data.classes.filter(c => !query.get('courseCode') || c.courseCode === query.get('courseCode')).map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></FormField>
        {!student && !legacyPanel && <><FormField label="Giảng viên"><select className={academicInput} value={query.get('lecturerId') || ''} onChange={e => editQuery({ lecturerId: e.target.value, enrollmentId: '' })}><option value="">Tất cả giảng viên</option>{data.lecturers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FormField><FormField label="Trạng thái"><select className={academicInput} value={query.get('status') || ''} onChange={e => editQuery({ status: e.target.value })}><option value="">Tất cả trạng thái</option><option value="notSubmitted">Chưa hoàn tất bài nộp</option>{p.group === 'project' && <><option value="advisorMissing">Thiếu điểm GVHD</option><option value="reviewerMissing">Thiếu điểm GVNX</option></>}{Object.entries(gradeNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></FormField><Button disabled={busy} onClick={() => run(() => academicDownload(token, `/api/campaigns/${id}/exports/${dataset}.xlsx?${filterKey}`, `${dataset}-${chosenClass?.code || p.group}-${p.semesterId}.xlsx`))}>Xuất XLSX theo bộ lọc</Button></>}
      </div>}
      {tab === 'overview' && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{[['studentCount', 'Sinh viên'], ['enrollmentCount', 'Lần học'], ['submitted', 'Đã nộp bài'], ['graded', 'Đủ điểm']].map(([key, label]) => <div key={key} className="bg-white border rounded-xl p-5"><p className="text-sm text-slate-500">{label}</p><strong className="text-3xl">{data.stats[key]}</strong></div>)}</div><p className="text-sm text-slate-500">Các chức năng quản lý dùng chung trong nhóm môn; chọn lớp ở bộ lọc khi cần xem hoặc xuất riêng.</p></>}
      {!legacyPanel && ['students', 'assignments', 'reports', 'grades', 'registrations', 'final-internships'].includes(tab) && <>
        <div className="bg-white border rounded-xl overflow-hidden"><div className="p-4"><input aria-label="Tìm sinh viên" className={`${academicInput} max-w-sm`} placeholder="Tìm MSSV, họ tên, đề tài" value={query.get('q') || ''} onChange={e => editQuery({ q: e.target.value })} /></div>
          {student ? <div className="p-4 grid md:grid-cols-2 gap-3">{rows?.items.map(e => <button key={e.id} className={`text-left p-4 border rounded-lg ${selectedId === e.id ? 'border-blue-600 bg-blue-50' : ''}`} onClick={() => editQuery({ enrollmentId: e.id })}><strong>{e.courseCode} · {e.classCode}</strong><p className="text-sm mt-1">{e.topic || 'Chưa khai đề tài'}</p><p className="text-xs text-slate-500 mt-1">{e.name} · {e.studentId}</p></button>)}</div> : <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr>{['Sinh viên', 'Học phần / lớp', 'GVHD', ...(p.group === 'project' ? ['GVNX'] : []), 'Báo cáo', 'Tiến độ đánh giá', ''].map((x, i) => <th className="p-3 text-xs text-slate-500" key={i}>{x}</th>)}</tr></thead><tbody>{rows?.items.map(e => <tr key={e.id} className="border-t"><td className="p-3"><button className="font-semibold text-[#034ea1]" onClick={() => editQuery({ enrollmentId: e.id })}>{e.name}</button><p className="text-xs text-slate-500">{e.studentId}</p></td><td className="p-3"><strong>{e.courseCode}</strong><p className="text-xs text-slate-500">{e.classCode}</p></td><td className="p-3 text-xs">{name(e, 'primary')}</td>{p.group === 'project' && <td className="p-3 text-xs">{name(e, 'reviewer')}</td>}<td className="p-3 text-xs">{e.versions.at(-1)!.state === 'submitted' ? 'Đã nộp' : 'Chưa nộp đủ'}{e.needsRevision && ' · Cần sửa'}</td><td className="p-3 text-xs">{gradeNames[e.gradeStatus]}{e.canSeeGrades && e.finalScore != null && <strong className="block">{e.finalScore.toFixed(1)}</strong>}</td><td className="p-3"><Button size="sm" onClick={() => editQuery({ enrollmentId: e.id })}>Mở hồ sơ</Button></td></tr>)}</tbody></table></div>}
          {rows && !rows.items.length && <p className="text-sm p-6 text-slate-500">Không có hồ sơ trong bộ lọc.</p>}<div className="border-t p-3 flex flex-wrap gap-3 justify-between items-center text-xs text-slate-500"><span>{rows ? `${rows.total} lần học · ${rows.studentCount} sinh viên` : 'Đang tải…'}</span><div className="flex gap-2 items-center"><Button size="sm" disabled={!rows || rows.page <= 1} onClick={() => editQuery({ page: String(rows!.page - 1) })}>Trước</Button><span>{rows?.page || 1}/{rows?.totalPages || 1}</span><Button size="sm" disabled={!rows || rows.page >= rows.totalPages} onClick={() => editQuery({ page: String(rows!.page + 1) })}>Sau</Button></div></div>
        </div>
        {selected && selectedClass && <EnrollmentPanel key={selected.id} token={token} user={user} courseClass={selectedClass} enrollment={selected} lecturers={data.lecturers} refresh={refresh} />}
        {admin && p.status === 'active' && tab === 'grades' && <form className="flex flex-wrap gap-3 bg-white border rounded-xl p-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/grade-locks`, 'PUT', { locked: f.get('action') === 'lock', reason: f.get('reason'), filters }); setNotice(`Đã cập nhật ${r.changed} hồ sơ; bỏ qua ${r.skipped.length} hồ sơ chưa đủ điểm.`); }); }}><select className={`${academicInput} max-w-xs`} name="action"><option value="lock">Khóa đủ điểm theo bộ lọc</option><option value="unlock">Mở khóa theo bộ lọc</option></select><input className={`${academicInput} max-w-sm`} name="reason" placeholder="Lý do" required /><Button type="submit" disabled={busy}>Áp dụng</Button></form>}
      </>}
      {admin && tab === 'assignments' && !p.legacy && (p.group === 'project' ? <ReviewerPanel token={token} c={chosenClass || data.classes[0] || synthetic} lecturers={data.lecturers} quotas={data.quotas} refresh={refresh} /> : <Button disabled={busy || p.status !== 'active'} onClick={() => run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/internship/auto-advisors`, 'POST', { filters }); setNotice(`Đã phân công ${r.assigned} hồ sơ.`); })}>Tự phân công GVHD theo quota học kỳ</Button>)}
      {p.legacy && p.status === 'active' && <LegacyCampaignPanels token={token} user={user} tab={tab} courseCode={chosenClass?.courseCode || query.get('courseCode') || ''} />}
      {tab === 'plan' && <section className="min-w-0 bg-white border rounded-xl p-6 space-y-5"><CampaignMarkdown content={p.settings.plan || 'Khoa chưa cập nhật kế hoạch của nhóm môn.'} /><CampaignMarkdown content={student ? `${p.settings.registrationRules || ''}\n\n${p.settings.studentFaq}` : `${p.settings.lecturerGuide}\n\n${p.settings.lecturerFaq}`} /></section>}
      {tab === 'settings' && admin && <><CampaignSettingsPanel key={p.revision} token={token} c={p} run={run} busy={busy} /><div className="bg-white border rounded-xl p-5"><h3 className="font-semibold mb-3">Danh mục dùng chung</h3><div className="flex flex-wrap gap-4 text-sm text-[#034ea1]">{[['students', 'Sinh viên'], ['lecturers', 'Giảng viên'], ['companies', 'Doanh nghiệp'], ['approved-companies', 'CSDL thẩm định'], ['admins', 'Quản trị viên']].map(([key, name]) => <Link key={key} to={`/admin/${key}`}>{name}</Link>)}</div><div className="flex flex-wrap gap-4 text-sm text-[#034ea1] mt-3"><Link to="/system/settings">Tích hợp hệ thống / Sheets</Link><Link to="/system/notifications">Thông báo hệ thống</Link></div></div></>}
      {tab === 'questions' && <ClassQuestions token={token} user={user} c={synthetic} />}
      {tab === 'announcements' && admin && <ClassAnnouncement key={`${id}:${query.get('classId')}:${query.get('courseCode')}`} token={token} c={synthetic} filters={{ ...(query.get('classId') ? { classId: query.get('classId')! } : {}), ...(query.get('courseCode') ? { courseCode: query.get('courseCode')! } : {}) }} scopeLabel={chosenClass?.code || query.get('courseCode') || 'Toàn nhóm môn trong học kỳ'} />}
      {tab === 'chat' && chat && <ClassChat token={token} user={user} data={{ class: synthetic, enrollments: chat.enrollments, lecturers: data.lecturers }} />}
      {admin && p.group === 'project' && ['students', 'overview'].includes(tab) && p.status !== 'archived' && <ImportPanel token={token} semesterId={p.semesterId} onImported={refresh} />}
      {student && p.group === 'internship' && data.classes.some(c => c.canJoin) && <section className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-semibold">Tham gia lớp Thực tập</h3>{data.classes.filter(c => c.canJoin).map(c => <Button key={c.id} disabled={busy} onClick={() => run(() => academicApi(token, `/api/classes/${c.id}/enrollments/join`, 'POST'))}>Tham gia {c.code}</Button>)}</section>}
    </>}
  </div>;
}

function CampaignMarkdown({ content }: { content: string }) {
  return <div className="min-w-0 text-sm text-slate-700 leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-slate-900 mb-4" {...props} />,
    h2: ({ node, ...props }) => <h2 className="text-base font-semibold text-[#034ea1] mt-6 mb-3" {...props} />,
    h3: ({ node, ...props }) => <h3 className="font-semibold text-slate-900 mt-5 mb-2" {...props} />,
    p: ({ node, ...props }) => <p className="mb-3 break-words" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-2" {...props} />,
    a: ({ node, ...props }) => <a className="text-[#034ea1] underline break-words" {...props} />,
    table: ({ node, ...props }) => <div className="max-w-full overflow-x-auto border border-slate-200 rounded-lg my-5"><table className="w-full min-w-[700px] text-sm" {...props} /></div>,
    th: ({ node, ...props }) => <th className="bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700" {...props} />,
    td: ({ node, ...props }) => <td className="border-t border-slate-200 px-4 py-3 align-top" {...props} />,
  }}>{content}</ReactMarkdown></div>;
}
