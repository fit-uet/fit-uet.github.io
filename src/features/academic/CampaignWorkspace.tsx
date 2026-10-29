import { CampaignChrome } from './CampaignChrome';
import { CampaignListToolbar } from './CampaignListToolbar';
import { CampaignLayoutContext, type CampaignFilter } from './CampaignLayoutContext';
import { CampaignEditorContext } from './CampaignEditorContext';
import { refreshRequestCache } from '../../shared/utils/requestCache';
import { academicInput } from './form';
import { hasLegacyPanel } from './legacyPresentation';
import { Lock, Upload } from 'lucide-react';
import { CampaignDashboard } from './CampaignDashboard';
import { CampaignRecords } from './CampaignRecords';
import { EnrollmentDialog } from './EnrollmentDialog';
import { campaignModules, campaignQuery, projectListQuery, panelForPage, recordPages, type CampaignMeta as Meta, type CampaignRecordPage as Page, type CampaignRecord, type EnrollmentPanelMode } from './campaignPresentation';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, FormField } from '../../shared/ui';
import { GROUP_NAMES, type AcademicClassSummary, type EnrollmentView } from '../../shared/academic';
import { academicApi, academicDownload, clearAcademicPdfCache } from './client';
import { clearReportReviewCache } from '../lecturer/pages/ReportReviewPanel';
const ProjectStudentList = lazy(()=>import('./ProjectStudentList').then(m=>({default:m.ProjectStudentList})));
const PlanSettingsAdmin = lazy(() => import('../admin/pages/PlanSettingsAdmin').then(module => ({default:module.PlanSettingsAdmin})));
const LecturerGuideSettingsAdmin = lazy(() => import('../admin/pages/LecturerGuideSettingsAdmin').then(module => ({default:module.LecturerGuideSettingsAdmin})));
const FAQSettingsAdmin = lazy(() => import('../admin/pages/FAQSettingsAdmin').then(module => ({default:module.FAQSettingsAdmin})));
const RegistrationRulesSettingsAdmin = lazy(() => import('../admin/pages/RegistrationRulesSettingsAdmin').then(module => ({default:module.RegistrationRulesSettingsAdmin})));
const PlanView=lazy(()=>import('../shared/pages/PlanView').then(module=>({default:module.PlanView})));
const LecturerGuideView=lazy(()=>import('../shared/pages/LecturerGuideView').then(module=>({default:module.LecturerGuideView})));
const CampaignMarkdown = lazy(() => import('./CampaignMarkdown').then(module => ({ default: module.CampaignMarkdown })));

const LegacyCampaignPanels = lazy(() => import('./LegacyCampaignPanels').then(module => ({ default: module.LegacyCampaignPanels })));
const ClassAnnouncement = lazy(() => import('./ClassCommunications').then(module => ({ default: module.ClassAnnouncement })));
const ClassQuestions = lazy(() => import('./ClassCommunications').then(module => ({ default: module.ClassQuestions })));
const ClassChat = lazy(() => import('./ClassCommunications').then(module => ({ default: module.ClassChat })));
const CampaignMigration = lazy(() => import('./CampaignMigration').then(module => ({ default: module.CampaignMigration })));
const CampaignSettingsPanel = lazy(() => import('./CampaignSettings').then(module => ({ default: module.CampaignSettingsPanel })));
const ReviewerPanel = lazy(() => import('./ReviewerPanel').then(module => ({ default: module.ReviewerPanel })));
const ImportPanel = lazy(() => import('./ImportPanel').then(module => ({ default: module.ImportPanel })));
const EnrollmentPanel = lazy(() => import('./EnrollmentPanel').then(module => ({ default: module.EnrollmentPanel })));

export function CampaignPage({ token, user }: { token: string; user: any }) {
  const { campaignId = '' } = useParams(); return <CampaignWorkspace key={campaignId} id={campaignId} token={token} user={user} />;
}
function CampaignWorkspace({ id, token, user }: { id: string; token: string; user: any }) {
  useEffect(() => { clearAcademicPdfCache(); clearReportReviewCache(); return () => { clearAcademicPdfCache(); clearReportReviewCache(); }; }, [id, token]);
  const [query, setQuery] = useSearchParams();
  const appliedQuery = useRef(query);
  useLayoutEffect(() => { appliedQuery.current = query; }, [query]);
  const teachingView = user.role === 'admin' && !!user.is_lecturer && query.get('view') === 'lecturer';
  const actor = teachingView ? { ...user, role: 'lecturer' } : user;
  const [actionsHost,setActionsHost]=useState<HTMLElement|null>(null);
  const [extraFilters,setExtraFilters]=useState<CampaignFilter[]>([]);
  const [showImport, setShowImport] = useState(false); const defaultTab = actor.role === 'admin' ? 'overview' : 'students'; const requestedTab = query.get('tab') || defaultTab;
  const [dataKey,setDataKey]=useState('');
  const [data, setData] = useState<Meta | null>(null), [rows, setRows] = useState<Page | null>(null), [selected, setSelected] = useState<EnrollmentView | null>(null);
  const modules = campaignModules(actor.role === 'admin', actor.role === 'student', data?.campaign.group === 'internship');
  const projectManagement = data?.campaign.group==='project' && actor.role!=='student';
  const tab = projectManagement && ['students','assignments','reports','grades'].includes(requestedTab) ? 'students' : modules.some(item => item.id === requestedTab) ? requestedTab : defaultTab;
  useEffect(()=>{if(!projectManagement)return;const next=projectListQuery(query);if(next.toString()!==query.toString())setQuery(next,{replace:true});},[projectManagement,query.toString()]);
  useEffect(()=>{const reset=()=>{appliedQuery.current=query;};window.addEventListener('project-navigation-blocked',reset);return()=>window.removeEventListener('project-navigation-blocked',reset);},[query]);
  const [chat, setChat] = useState<any>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const filters = Object.fromEntries(['courseCode', 'classId', 'lecturerId', 'status', 'topicStatus', 'assignmentStatus', 'submissionStatus', 'gradeStatus', 'q', 'page'].map(k => [k, query.get(k) || '']).filter(([, v]) => v));
  if(projectManagement&&query.get('enrollmentId'))filters.focusEnrollmentId=query.get('enrollmentId')!;
  if (teachingView) filters.lecturerId = String(data?.lecturers.find(l => l.email.toLowerCase() === user.email.toLowerCase())?.id ?? -1);
  const [search, setSearch] = useState(query.get('q') || '');
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.get('q') || ''), 300); return () => window.clearTimeout(timer); }, [query.get('q')]);
  if (search) filters.q = search; else delete filters.q;
  const section = tab === 'overview' ? 'overview' : ['plan','guide','questions'].includes(tab) ? 'content' : (tab === 'settings' || tab.endsWith('-editor')) ? 'full' : ['students','assignments','reports','grades','settings','chat'].includes(tab) ? 'management' : 'base';
  const filterKey = new URLSearchParams(filters).toString(); const selectedId = query.get('enrollmentId') || '';
  const cacheScope = `${user.id}:${actor.role}:${id}`;
  const metaKey = `${token}:${cacheScope}:${section}`, rowsKey = `${token}:${cacheScope}:${tab}:${filterKey}`, detailKey = `${token}:${cacheScope}:${tab}:${selectedId}`;
  const active = useRef({metaKey,rowsKey,detailKey}); active.current = {metaKey,rowsKey,detailKey};
  const editQuery = (patch: Record<string, string>) => {
    // Router navigation is a transition. A second interaction can arrive before
    // its new render commits; merge into the latest applied URL, not that render's closure.
    const next = campaignQuery(appliedQuery.current, patch);
    appliedQuery.current = next; setQuery(next);
  };
  const go = (next: string) => { setShowImport(false); setError(''); setNotice(''); editQuery({ tab: next, enrollmentId: '', panel: '' }); };
  useEffect(() => { if (user.role === 'student' && tab === 'students' && !selectedId && rows?.total === 1 && rows.items.length === 1) setQuery(old => { const next = new URLSearchParams(old); next.set('enrollmentId', rows.items[0].id); return next; }, { replace: true }); }, [user.role, tab, selectedId, rows, setQuery]);
  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Meta>(token, `/api/campaigns/${id}?section=${section}`, 'GET', undefined, signal, {scope:cacheScope}); if (signal?.aborted || active.current.metaKey !== metaKey) return; setData(result);setDataKey(metaKey); sessionStorage.setItem('academic:campaign', id); sessionStorage.setItem('academic:semester', result.campaign.semesterId);
  }, [token, id, section, cacheScope, metaKey]);
  const loadRows = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Page>(token, `/api/campaigns/${id}/enrollments?${filterKey}${projectManagement ? '&projection=student-list' : ['students','assignments','reports','grades'].includes(tab) ? '&projection=' + tab : ''}`, 'GET', undefined, signal, {scope:cacheScope});
    if (!signal?.aborted && active.current.rowsKey === rowsKey) setRows(result);
  }, [token, id, filterKey, tab, cacheScope, rowsKey, projectManagement]);
  const needsRows = Boolean(data && recordPages.includes(tab) && !(data.campaign.legacy && data.campaign.status === 'active' && hasLegacyPanel(actor, tab)));
  const refresh = useCallback(async () => { await Promise.all([loadMeta(), ...(needsRows ? [loadRows()] : [])]); if (selectedId && needsRows && !projectManagement) { const detail = await academicApi<EnrollmentView>(token, `/api/enrollments/${selectedId}`, 'GET', undefined, undefined, {scope:cacheScope}); if (active.current.detailKey === detailKey) setSelected(detail); } }, [loadMeta, loadRows, selectedId, token, needsRows, cacheScope, detailKey, projectManagement]);
  useEffect(() => { const a = new AbortController(); loadMeta(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadMeta]);
  useEffect(() => { if (!data || !needsRows || search !== (query.get('q') || '')) return; const a = new AbortController(); setRows(null); loadRows(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadRows, !!data, needsRows, search, query.get('q')]);
  useEffect(() => {
    if (!data) return;
    const a = new AbortController(); setSelected(null); if (selectedId && !projectManagement && recordPages.includes(tab) && !(data.campaign.legacy && hasLegacyPanel(actor, tab))) academicApi<EnrollmentView>(token, `/api/enrollments/${selectedId}`, 'GET', undefined, a.signal, {scope:cacheScope}).then(e => { if (!a.signal.aborted && active.current.detailKey === detailKey) setSelected(e); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => a.abort();
  }, [token, id, selectedId, tab, data?.campaign.legacy, cacheScope, detailKey, !!data]);
  useEffect(() => { if (tab !== 'chat' || !data || data.campaign.legacy && data.campaign.status==='active') return; const a = new AbortController(); academicApi(token, `/api/campaigns/${id}/chat-context`, 'GET', undefined, a.signal).then(setChat).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [token, id, tab, data?.campaign.legacy, !!data]);
  useEffect(() => { const revalidate = () => { if (document.visibilityState === 'visible') refresh().catch(error => { if (error.name !== 'AbortError') setError(error.message); }); }; window.addEventListener('api-data-changed', revalidate); document.addEventListener('visibilitychange', revalidate); return () => { window.removeEventListener('api-data-changed', revalidate); document.removeEventListener('visibilitychange', revalidate); }; }, [refresh]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const runOnly = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  if (!data) return <p role="status">{error || 'Đang tải nhóm môn…'}</p>;
  const currentMeta=dataKey===metaKey;
  const p = data.campaign, admin = actor.role === 'admin', student = actor.role === 'student', project = p.group === 'project';
  const chosenClass = data.classes.find(c => c.id === query.get('classId'));
  const selectedClass = selected && data.classes.find(c => c.id === selected.classId);
  const legacyPanel = p.legacy && p.status === 'active' && hasLegacyPanel(actor, tab);
  const synthetic = { ...data.classes[0], ...p, code: GROUP_NAMES[p.group], courseName: GROUP_NAMES[p.group], canJoin: false } as AcademicClassSummary;
  const currentModule = modules.find(item => item.id === tab)!;
  const panel = ['profile', 'assignments', 'reports', 'grades'].includes(query.get('panel') || '') ? query.get('panel') as EnrollmentPanelMode : panelForPage(tab);
  const open = (e: CampaignRecord, mode: EnrollmentPanelMode = panelForPage(tab)) => editQuery({ enrollmentId: e.id, panel: mode });
  const exportFile = () => runOnly(() => academicDownload(token, `/api/campaigns/${id}/exports/${tab}.xlsx?${filterKey}`, `${tab}-${chosenClass?.code || p.group}-${p.semesterId}.xlsx`));
  const list = recordPages.includes(tab) && !student && !(legacyPanel && tab==='assignments' && query.get('view')==='quotas');
  const reload = () => runOnly(async()=>{refreshRequestCache();await refresh();window.dispatchEvent(new Event('api-force-refresh'));});
  return <CampaignLayoutContext.Provider value={{meta:data,actor,tab,legacy:!!legacyPanel,query,editQuery,actionsHost,setActionsHost,extraFilters,setExtraFilters}}><CampaignEditorContext campaign={p} token={token} refresh={refresh}><Suspense fallback={<p role="status">Đang tải chức năng…</p>}><div className="max-w-7xl mx-auto space-y-4">
    <CampaignChrome token={token} modules={modules} title={tab==='overview'?'Tổng quan Quản trị':currentModule.title} go={go} reload={reload} busy={busy} list={list}/>
    {error && <p role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-sm">{error}</p>}{notice && <p role="status" className="bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded-xl text-sm">{notice}</p>}
    {p.pendingMigration ? <CampaignMigration token={token} refresh={refresh} /> : <>
      {list && <CampaignListToolbar key={tab}/>}
      {tab === 'overview' && admin && <CampaignDashboard data={data} modules={modules} navigate={go} token={token} reload={() => runOnly(async()=>{refreshRequestCache();await refresh();})} />}
      {showImport && tab === 'students' && admin && project && <ImportPanel token={token} semesterId={p.semesterId} onImported={refresh} />}
      {legacyPanel ? (!currentMeta ? <p role="status">Đang tải chức năng…</p> : <LegacyCampaignPanels key={`${tab}:${chosenClass?.courseCode || query.get('courseCode') || ''}`} token={token} user={actor} tab={tab} courseCode={chosenClass?.courseCode || query.get('courseCode') || ''} />) : <>
        {projectManagement && tab==='students' && <ProjectStudentList key={`${id}:${actor.role}`} token={token} page={rows} refresh={refresh} importAction={()=>setShowImport(value=>!value)}/>}
        {recordPages.includes(tab) && !student && !projectManagement && <CampaignRecords token={token} page={rows} tab={tab} project={project} lecturer={!admin} lecturers={data.lecturers} query={query} editQuery={editQuery} open={open} exportFile={exportFile} busy={busy} extraActions={admin && project && tab==='students' && p.status!=='archived' ? <Button size="sm" variant="primary" leadingIcon={<Upload size={14}/>} onClick={()=>setShowImport(value=>!value)}>{showImport?'Đóng import':'Import danh sách'}</Button> : null}/>}
        {student && tab === 'students' && <section className="space-y-5">{rows && rows.items.length > 1 && <div className="bg-white border border-slate-200 rounded-xl p-5"><h2 className="font-semibold text-sm mb-3">Hồ sơ học phần của tôi</h2><div className="grid sm:grid-cols-2 gap-3">{rows.items.map(e => <button key={e.id} onClick={() => editQuery({ enrollmentId: e.id, panel: '' })} aria-pressed={selectedId === e.id} className={`text-left p-4 border rounded-xl transition-colors ${selectedId === e.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}><span className="block font-semibold text-sm text-[#034ea1]">{e.courseCode} · {e.classCode}</span><span className="block text-xs text-slate-600 mt-2">{e.topic || 'Chưa khai đề tài'}</span><span className="block text-[11px] text-slate-500 mt-2">{e.topicPermissions?.requiresResubmission ? 'Cần nộp lại theo đề tài' : e.versions.at(-1)?.state === 'submitted' ? 'Đã nộp bộ bài' : 'Chưa hoàn tất bài nộp'}</span></button>)}</div></div>}{selected && selectedClass ? <EnrollmentPanel key={selected.id} token={token} user={actor} courseClass={selectedClass} enrollment={selected} lecturers={data.lecturers} refresh={refresh} /> : <div className="p-8 bg-white rounded-xl border border-slate-200 text-sm text-center text-slate-500">{!rows ? 'Đang tải hồ sơ…' : rows.items.length ? 'Chọn hồ sơ học phần để xem thông tin và nộp bài.' : 'Bạn chưa có hồ sơ học phần trong nhóm này.'}</div>}</section>}
      </>}
      {!student && !projectManagement && selectedId && recordPages.includes(tab) && !legacyPanel && (() => {
        const currentIndex = rows?.items.findIndex(item => item.id === selectedId) ?? -1;
        const prevItem = currentIndex > 0 ? rows?.items[currentIndex - 1] : null;
        const nextItem = (currentIndex >= 0 && rows && currentIndex < rows.items.length - 1) ? rows.items[currentIndex + 1] : null;
        const navActions = rows && rows.items.length > 1 && currentIndex >= 0 ? (
          <div className="flex items-center gap-1.5 mr-2 text-xs">
            <span className="text-slate-500 hidden sm:inline mr-1">{currentIndex + 1} / {rows.total}</span>
            <button type="button" disabled={!prevItem} onClick={() => prevItem && open(prevItem, panel)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 cursor-pointer">&larr; <span className="hidden sm:inline">Trước</span></button>
            <button type="button" disabled={!nextItem} onClick={() => nextItem && open(nextItem, panel)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 cursor-pointer"><span className="hidden sm:inline">Tiếp</span> &rarr;</button>
          </div>
        ) : null;
        return <EnrollmentDialog title={panel === 'assignments' ? 'Phân công giảng viên' : panel === 'reports' || panel === 'grades' ? 'Báo cáo và đánh giá' : 'Hồ sơ sinh viên'} close={() => editQuery({ enrollmentId: '', panel: '' })} actions={navActions}>{selected && selectedClass ? <EnrollmentPanel key={`${selected.id}:${panel}`} mode={panel} token={token} user={actor} courseClass={selectedClass} enrollment={selected} lecturers={data.lecturers} refresh={refresh} /> : <p className="p-10 text-center text-sm text-slate-500">{error || 'Đang tải hồ sơ…'}</p>}</EnrollmentDialog>;
      })()}
      {admin && !projectManagement && !legacyPanel && p.status === 'active' && tab === 'grades' && (
        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0">
                <Lock size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Quản lý Khóa / Mở khóa bảng điểm</h3>
                <p className="text-xs text-slate-500">Khóa điểm để chốt kết quả đợt chấm hoặc mở khóa cho phép giảng viên cập nhật lại.</p>
              </div>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 self-start sm:self-auto">
              Áp dụng theo bộ lọc hiện tại
            </span>
          </div>
          <form className="flex flex-wrap items-center gap-3 pt-1" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/grade-locks`, 'PUT', { locked: f.get('action') === 'lock', reason: f.get('reason'), filters }); setNotice(`Đã cập nhật ${r.changed} hồ sơ; bỏ qua ${r.skipped.length} hồ sơ chưa đủ điểm.`); }); }}>
            <select className={`${academicInput} max-w-xs`} name="action">
              <option value="lock">Khóa hồ sơ đủ điểm theo bộ lọc</option>
              <option value="unlock">Mở khóa theo bộ lọc</option>
            </select>
            <input className={`${academicInput} flex-1 min-w-[200px] max-w-md`} name="reason" placeholder="Nhập lý do khóa / mở khóa (bắt buộc)..." required />
            <Button type="submit" variant="primary" disabled={busy}>
              Áp dụng
            </Button>
          </form>
        </div>
      )}
      {admin && tab === 'assignments' && !p.legacy && (p.group === 'project' ? <ReviewerPanel token={token} c={chosenClass || data.classes[0] || synthetic} lecturers={data.lecturers} quotas={data.quotas} refresh={refresh} /> : <Button disabled={busy || p.status !== 'active'} onClick={() => run(async () => { const r = await academicApi(token, `/api/admin/campaigns/${id}/internship/auto-advisors`, 'POST', { filters }); setNotice(`Đã phân công ${r.assigned} hồ sơ.`); })}>Tự phân công GVHD theo quota học kỳ</Button>)}
      {admin && currentMeta && tab.endsWith('-editor') && <CampaignEditorContext campaign={p} token={token} refresh={refresh}>{tab === 'plan-editor' ? <PlanSettingsAdmin token={token}/> : tab === 'guide-editor' ? <LecturerGuideSettingsAdmin token={token}/> : tab === 'faq-editor' ? <FAQSettingsAdmin token={token}/> : <RegistrationRulesSettingsAdmin token={token}/>}</CampaignEditorContext>}
      {tab === 'plan' && !legacyPanel && currentMeta && <PlanView user={actor}/>}
      {tab === 'guide' && currentMeta && <LecturerGuideView token={token} user={actor}/>}
      {tab === 'settings' && admin && <><CampaignSettingsPanel key={p.revision} token={token} c={p} run={run} busy={busy} /><div className="bg-white border rounded-xl p-5"><h3 className="font-semibold mb-3">Danh mục dùng chung</h3><div className="flex flex-wrap gap-4 text-sm text-[#034ea1]">{[['students', 'Sinh viên'], ['lecturers', 'Giảng viên'], ['companies', 'Doanh nghiệp'], ['approved-companies', 'CSDL thẩm định'], ['admins', 'Quản trị viên']].map(([key, name]) => <Link key={key} to={`/admin/${key}`}>{name}</Link>)}</div><div className="flex flex-wrap gap-4 text-sm text-[#034ea1] mt-3"><Link to="/system/settings">Tích hợp hệ thống / Sheets</Link><Link to="/system/notifications">Thông báo hệ thống</Link></div></div></>}
      {tab === 'questions' && !legacyPanel && currentMeta && <><section className="bg-white rounded-xl border border-slate-200 p-6"><CampaignMarkdown content={(student?p.settings.studentFaq:p.settings.lecturerFaq)||'Khoa chưa cập nhật câu hỏi thường gặp.'}/></section><ClassQuestions token={token} user={actor} c={synthetic} /></>}
      {tab === 'announcements' && admin && <>
        <section className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Phạm vi thông báo">
          <FormField label="Gửi tới học phần"><select className={academicInput} value={query.get('courseCode')||''} onChange={e=>editQuery({courseCode:e.target.value,classId:''})}><option value="">Toàn nhóm môn</option>{[...new Set(data.classes.map(c=>c.courseCode))].map(code=><option key={code} value={code}>{code}</option>)}</select></FormField>
          <FormField label="Gửi tới lớp"><select className={academicInput} value={query.get('classId')||''} onChange={e=>editQuery({classId:e.target.value})}><option value="">Tất cả lớp trong phạm vi</option>{data.classes.filter(c=>!query.get('courseCode')||c.courseCode===query.get('courseCode')).map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></FormField>
        </section>
        <ClassAnnouncement key={`${id}:${query.get('classId')}:${query.get('courseCode')}`} token={token} c={synthetic} filters={{ ...(query.get('classId') ? { classId: query.get('classId')! } : {}), ...(query.get('courseCode') ? { courseCode: query.get('courseCode')! } : {}) }} scopeLabel={chosenClass?.code || query.get('courseCode') || 'Toàn nhóm môn trong học kỳ'} />
      </>}
      {tab === 'chat' && !legacyPanel && chat && <ClassChat token={token} user={actor} data={{ class: synthetic, enrollments: chat.enrollments, lecturers: data.lecturers }} />}
      {student && p.group === 'internship' && data.classes.some(c => c.canJoin) && <section className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-semibold">Tham gia lớp Thực tập</h3>{data.classes.filter(c => c.canJoin).map(c => <Button key={c.id} disabled={busy} onClick={() => run(() => academicApi(token, `/api/classes/${c.id}/enrollments/join`, 'POST'))}>Tham gia {c.code}</Button>)}</section>}
    </>}
  </div></Suspense></CampaignEditorContext></CampaignLayoutContext.Provider>;
}
