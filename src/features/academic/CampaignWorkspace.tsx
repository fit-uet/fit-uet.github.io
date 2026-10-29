import { ArrowLeft, RefreshCw, Upload, FileText, MessageCircle, CircleHelp, BookOpen } from 'lucide-react';
import { CampaignDashboard } from './CampaignDashboard';
import { CampaignRecords, RecordBadge } from './CampaignRecords';
import { EnrollmentDialog } from './EnrollmentDialog';
import { campaignModules, campaignQuery, panelForPage, recordPages, gradeNames, type CampaignMeta as Meta, type CampaignRecordPage as Page, type CampaignRecord, type EnrollmentPanelMode } from './campaignPresentation';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, FormField } from '../../shared/ui';
import { GROUP_NAMES, type CampaignSummary, type AcademicClassSummary, type EnrollmentView, type LecturerInfo } from '../../shared/academic';
import { academicApi, academicDownload, clearAcademicCache } from './client';
import { clearReportReviewCache } from '../lecturer/pages/ReportReviewPanel';
import { EnrollmentPanel, academicInput } from './EnrollmentPanel';
import { ImportPanel } from './ImportPanel';
import { ReviewerPanel } from './ReviewerPanel';
import { CampaignSettingsPanel } from './CampaignSettings';
import { CampaignMigration } from './CampaignMigration';
import { ClassChat, ClassQuestions, ClassAnnouncement } from './ClassCommunications';
import { LegacyCampaignPanels, hasLegacyPanel } from './LegacyCampaignPanels';

export function CampaignPage({ token, user }: { token: string; user: any }) {
  const { campaignId = '' } = useParams(); return <CampaignWorkspace key={campaignId} id={campaignId} token={token} user={user} />;
}
function CampaignWorkspace({ id, token, user }: { id: string; token: string; user: any }) {
  useEffect(() => { clearAcademicCache(); clearReportReviewCache(); return () => { clearAcademicCache(); clearReportReviewCache(); }; }, [id, token]);
  const [query, setQuery] = useSearchParams();
  const teachingView = user.role === 'admin' && !!user.is_lecturer && query.get('view') === 'lecturer';
  const actor = teachingView ? { ...user, role: 'lecturer' } : user;
  const [showImport, setShowImport] = useState(false); const defaultTab = actor.role === 'admin' ? 'overview' : 'students'; const requestedTab = query.get('tab') || defaultTab;
  const [data, setData] = useState<Meta | null>(null), [rows, setRows] = useState<Page | null>(null), [selected, setSelected] = useState<EnrollmentView | null>(null);
  const modules = campaignModules(actor.role === 'admin', actor.role === 'student', data?.campaign.group === 'internship');
  const tab = modules.some(item => item.id === requestedTab) ? requestedTab : defaultTab;
  const [chat, setChat] = useState<any>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const filters = Object.fromEntries(['courseCode', 'classId', 'lecturerId', 'status', 'q', 'page'].map(k => [k, query.get(k) || '']).filter(([, v]) => v));
  if (teachingView) filters.lecturerId = String(data?.lecturers.find(l => l.email.toLowerCase() === user.email.toLowerCase())?.id ?? -1);
  const filterKey = new URLSearchParams(filters).toString(); const selectedId = query.get('enrollmentId') || '';
  const editQuery = (patch: Record<string, string>) => setQuery(old => campaignQuery(old, patch));
  const go = (next: string) => { setShowImport(false); setError(''); setNotice(''); editQuery({ tab: next, enrollmentId: '', panel: '' }); };
  useEffect(() => { if (user.role === 'student' && tab === 'students' && !selectedId && rows?.total === 1 && rows.items.length === 1) setQuery(old => { const next = new URLSearchParams(old); next.set('enrollmentId', rows.items[0].id); return next; }, { replace: true }); }, [user.role, tab, selectedId, rows, setQuery]);
  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Meta>(token, `/api/campaigns/${id}`, 'GET', undefined, signal); if (signal?.aborted) return; setData(result); sessionStorage.setItem('academic:campaign', id); sessionStorage.setItem('academic:semester', result.campaign.semesterId);
  }, [token, id]);
  const loadRows = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Page>(token, `/api/campaigns/${id}/enrollments?${filterKey}`, 'GET', undefined, signal);
    if (!signal?.aborted) setRows(result);
  }, [token, id, filterKey]);
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
  const p = data.campaign, admin = actor.role === 'admin', student = actor.role === 'student', project = p.group === 'project';
  const chosenClass = data.classes.find(c => c.id === query.get('classId'));
  const selectedClass = selected && data.classes.find(c => c.id === selected.classId);
  const legacyPanel = p.legacy && p.status === 'active' && hasLegacyPanel(actor, tab);
  const synthetic = { ...data.classes[0], ...p, code: GROUP_NAMES[p.group], courseName: GROUP_NAMES[p.group], canJoin: false } as AcademicClassSummary;
  const currentModule = modules.find(item => item.id === tab)!;
  const panel = ['profile', 'assignments', 'reports', 'grades'].includes(query.get('panel') || '') ? query.get('panel') as EnrollmentPanelMode : panelForPage(tab);
  const open = (e: CampaignRecord, mode: EnrollmentPanelMode = panelForPage(tab)) => editQuery({ enrollmentId: e.id, panel: mode });
  const exportFile = () => run(() => academicDownload(token, `/api/campaigns/${id}/exports/${tab}.xlsx?${filterKey}`, `${tab}-${chosenClass?.code || p.group}-${p.semesterId}.xlsx`));
  const statuses = tab === 'grades' ? Object.entries(gradeNames) : tab === 'reports' ? [['notSubmitted', 'Chưa nộp đủ bài'], ['complete', 'Đã hoàn tất điểm']] : [['active', 'Đang học'], ['withdrawn', 'Đã rút']];
  return <div className="max-w-7xl mx-auto space-y-6">
    <nav aria-label="Điều hướng nhóm môn" className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Link to="/classes" className="text-[#034ea1] hover:underline">Học kỳ và nhóm môn</Link><span>/</span><button className="hover:text-[#034ea1]" onClick={() => go(admin ? 'overview' : 'students')}>{GROUP_NAMES[p.group]} · {p.semesterName}</button>{tab !== 'overview' && <><span>/</span><span className="text-slate-700">{currentModule.title}</span></>}</nav>
    <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4"><div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{tab === 'overview' ? 'Tổng quan Quản trị' : currentModule.title}</h1><p className="text-xs text-slate-500 mt-1">{GROUP_NAMES[p.group]} · {p.semesterName}</p><div className="flex flex-wrap items-center gap-3 mt-3"><RecordBadge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.pendingMigration ? 'Chờ chuyển đổi' : p.status === 'active' ? 'Đang hoạt động' : p.status === 'archived' ? 'Lưu trữ · Chỉ xem' : 'Nhóm nháp'}</RecordBadge><span className="text-xs text-slate-500">{p.classCount} lớp · {p.studentCount} sinh viên · {p.enrollmentCount} lần học</span></div></div><div className="flex flex-wrap gap-2 items-center">{tab !== 'overview' && admin && <Button size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={() => go('overview')}>Tổng quan</Button>}<Button size="sm" disabled={busy} leadingIcon={<RefreshCw size={14} />} onClick={() => run(refresh)}>Tải lại</Button>{admin && project && tab === 'students' && p.status !== 'archived' && <Button size="sm" variant="primary" leadingIcon={<Upload size={14} />} onClick={() => setShowImport(value => !value)}>{showImport ? 'Đóng import' : 'Import danh sách'}</Button>}</div></header>
    {error && <p role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-sm">{error}</p>}{notice && <p role="status" className="bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded-xl text-sm">{notice}</p>}
    {p.pendingMigration ? <CampaignMigration token={token} refresh={refresh} /> : <>
      {tab !== 'overview' && <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Chức năng nhóm môn"><FormField label="Chức năng"><select className={`${academicInput} min-w-[220px]`} value={tab} onChange={event => go(event.target.value)}>{modules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></FormField>{student && <div className="flex flex-wrap gap-2">{[{ id: 'students', label: 'Hồ sơ và bài nộp', Icon: FileText }, { id: 'plan', label: 'Kế hoạch', Icon: BookOpen }, { id: 'chat', label: 'Trao đổi', Icon: MessageCircle }, { id: 'questions', label: 'Hỏi đáp', Icon: CircleHelp }].filter(item => item.id !== tab).map(({ id, label, Icon }) => <Button key={id} size="sm" leadingIcon={<Icon size={14} />} onClick={() => go(id)}>{label}</Button>)}</div>}</nav>}
      {tab === 'overview' && admin && <CampaignDashboard data={data} modules={modules} navigate={go} />}
      {showImport && tab === 'students' && admin && project && <ImportPanel token={token} semesterId={p.semesterId} onImported={refresh} />}
      {recordPages.includes(tab) && !student && <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
        <FormField label="Học phần"><select className={academicInput} value={query.get('courseCode') || ''} onChange={event => editQuery({ courseCode: event.target.value, classId: '', enrollmentId: '', panel: '' })}><option value="">Tất cả học phần</option>{[...new Set(data.classes.map(c => c.courseCode))].map(code => <option key={code}>{code}</option>)}</select></FormField>
        <FormField label="Lớp học phần"><select className={academicInput} value={query.get('classId') || ''} onChange={event => editQuery({ classId: event.target.value, enrollmentId: '', panel: '' })}><option value="">Tất cả lớp</option>{data.classes.filter(c => !query.get('courseCode') || c.courseCode === query.get('courseCode')).map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select></FormField>
        {admin && <FormField label="Giảng viên"><select className={academicInput} value={query.get('lecturerId') || ''} onChange={event => editQuery({ lecturerId: event.target.value, enrollmentId: '', panel: '' })}><option value="">Tất cả giảng viên</option>{data.lecturers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FormField>}{!legacyPanel && <FormField label="Trạng thái"><select className={academicInput} value={query.get('status') || ''} onChange={event => editQuery({ status: event.target.value, enrollmentId: '', panel: '' })}><option value="">Tất cả trạng thái</option>{statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}{project && tab === 'grades' && <><option value="advisorMissing">Thiếu điểm GVHD</option><option value="reviewerMissing">Thiếu điểm GVNX</option></>}</select></FormField>}
      </div>}
      {legacyPanel ? <LegacyCampaignPanels key={`${tab}:${chosenClass?.courseCode || query.get('courseCode') || ''}`} token={token} user={actor} tab={tab} courseCode={chosenClass?.courseCode || query.get('courseCode') || ''} /> : <>
        {recordPages.includes(tab) && !student && <CampaignRecords page={rows} tab={tab} project={project} lecturer={!admin} lecturers={data.lecturers} query={query} editQuery={editQuery} open={open} exportFile={exportFile} busy={busy} />}
        {student && tab === 'students' && <section className="space-y-5">{rows && rows.items.length > 1 && <div className="bg-white border border-slate-200 rounded-xl p-5"><h2 className="font-semibold text-sm mb-3">Hồ sơ học phần của tôi</h2><div className="grid sm:grid-cols-2 gap-3">{rows.items.map(e => <button key={e.id} onClick={() => editQuery({ enrollmentId: e.id, panel: '' })} aria-pressed={selectedId === e.id} className={`text-left p-4 border rounded-xl transition-colors ${selectedId === e.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}><span className="block font-semibold text-sm text-[#034ea1]">{e.courseCode} · {e.classCode}</span><span className="block text-xs text-slate-600 mt-2">{e.topic || 'Chưa khai đề tài'}</span><span className="block text-[11px] text-slate-500 mt-2">{e.versions.at(-1)?.state === 'submitted' ? 'Đã nộp bộ bài' : 'Chưa hoàn tất bài nộp'}</span></button>)}</div></div>}{selected && selectedClass ? <EnrollmentPanel key={selected.id} token={token} user={actor} courseClass={selectedClass} enrollment={selected} lecturers={data.lecturers} refresh={refresh} /> : <div className="p-8 bg-white rounded-xl border border-slate-200 text-sm text-center text-slate-500">{!rows ? 'Đang tải hồ sơ…' : rows.items.length ? 'Chọn hồ sơ học phần để xem thông tin và nộp bài.' : 'Bạn chưa có hồ sơ học phần trong nhóm này.'}</div>}</section>}
      </>}
      {!student && selectedId && recordPages.includes(tab) && !legacyPanel && <EnrollmentDialog title={panel === 'assignments' ? 'Phân công giảng viên' : panel === 'reports' || panel === 'grades' ? 'Báo cáo và đánh giá' : 'Hồ sơ sinh viên'} close={() => editQuery({ enrollmentId: '', panel: '' })}>{selected && selectedClass ? <EnrollmentPanel key={`${selected.id}:${panel}`} mode={panel} token={token} user={actor} courseClass={selectedClass} enrollment={selected} lecturers={data.lecturers} refresh={refresh} /> : <p className="p-10 text-center text-sm text-slate-500">{error || 'Đang tải hồ sơ…'}</p>}</EnrollmentDialog>}
        {admin && !legacyPanel && p.status === 'active' && tab === 'grades' && <form className="flex flex-wrap gap-3 bg-white border rounded-xl p-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/grade-locks`, 'PUT', { locked: f.get('action') === 'lock', reason: f.get('reason'), filters }); setNotice(`Đã cập nhật ${r.changed} hồ sơ; bỏ qua ${r.skipped.length} hồ sơ chưa đủ điểm.`); }); }}><select className={`${academicInput} max-w-xs`} name="action"><option value="lock">Khóa đủ điểm theo bộ lọc</option><option value="unlock">Mở khóa theo bộ lọc</option></select><input className={`${academicInput} max-w-sm`} name="reason" placeholder="Lý do" required /><Button type="submit" disabled={busy}>Áp dụng</Button></form>}
      {admin && tab === 'assignments' && !p.legacy && (p.group === 'project' ? <ReviewerPanel token={token} c={chosenClass || data.classes[0] || synthetic} lecturers={data.lecturers} quotas={data.quotas} refresh={refresh} /> : <Button disabled={busy || p.status !== 'active'} onClick={() => run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/internship/auto-advisors`, 'POST', { filters }); setNotice(`Đã phân công ${r.assigned} hồ sơ.`); })}>Tự phân công GVHD theo quota học kỳ</Button>)}
      {tab === 'plan' && <section className="min-w-0 bg-white border rounded-xl p-6 space-y-5"><CampaignMarkdown content={p.settings.plan || 'Khoa chưa cập nhật kế hoạch của nhóm môn.'} /><CampaignMarkdown content={student ? `${p.settings.registrationRules || ''}\n\n${p.settings.studentFaq}` : `${p.settings.lecturerGuide}\n\n${p.settings.lecturerFaq}`} /></section>}
      {tab === 'settings' && admin && <><CampaignSettingsPanel key={p.revision} token={token} c={p} run={run} busy={busy} /><div className="bg-white border rounded-xl p-5"><h3 className="font-semibold mb-3">Danh mục dùng chung</h3><div className="flex flex-wrap gap-4 text-sm text-[#034ea1]">{[['students', 'Sinh viên'], ['lecturers', 'Giảng viên'], ['companies', 'Doanh nghiệp'], ['approved-companies', 'CSDL thẩm định'], ['admins', 'Quản trị viên']].map(([key, name]) => <Link key={key} to={`/admin/${key}`}>{name}</Link>)}</div><div className="flex flex-wrap gap-4 text-sm text-[#034ea1] mt-3"><Link to="/system/settings">Tích hợp hệ thống / Sheets</Link><Link to="/system/notifications">Thông báo hệ thống</Link></div></div></>}
      {tab === 'questions' && <ClassQuestions token={token} user={actor} c={synthetic} />}
      {tab === 'announcements' && admin && <ClassAnnouncement key={`${id}:${query.get('classId')}:${query.get('courseCode')}`} token={token} c={synthetic} filters={{ ...(query.get('classId') ? { classId: query.get('classId')! } : {}), ...(query.get('courseCode') ? { courseCode: query.get('courseCode')! } : {}) }} scopeLabel={chosenClass?.code || query.get('courseCode') || 'Toàn nhóm môn trong học kỳ'} />}
      {tab === 'chat' && chat && <ClassChat token={token} user={actor} data={{ class: synthetic, enrollments: chat.enrollments, lecturers: data.lecturers }} />}
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
