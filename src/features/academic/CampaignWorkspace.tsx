import { CampaignChrome } from './CampaignChrome';
import { CampaignListToolbar } from './CampaignListToolbar';
import { CampaignLayoutContext, type CampaignFilter } from './CampaignLayoutContext';
import { CampaignEditorContext } from './CampaignEditorContext';
import { refreshRequestCache } from '../../shared/utils/requestCache';
import { academicInput } from './form';
import { hasLegacyPanel } from './legacyPresentation';
import { Lock, Upload, BookOpen, Users, GraduationCap, Building2, ShieldCheck, ShieldAlert, FileSpreadsheet, Bell } from 'lucide-react';
import { AdminSettingsSubNav } from '../admin/components/AdminSettingsSubNav';
import { CampaignDashboard } from './CampaignDashboard';
import { CampaignRecords } from './CampaignRecords';
import { EnrollmentDialog } from './EnrollmentDialog';
import { campaignModules, campaignQuery, projectListQuery, panelForPage, recordPages, type CampaignMeta as Meta, type CampaignRecordPage as Page, type CampaignRecord, type EnrollmentPanelMode } from './campaignPresentation';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams, type NavigateOptions } from 'react-router-dom';
import { Button, FormField } from '../../shared/ui';
import { GROUP_NAMES, type AcademicClassSummary, type EnrollmentView } from '../../shared/academic';
import { academicApi, academicDownload, clearAcademicPdfCache } from './client';
import { clearReportReviewCache } from '../lecturer/pages/ReportReviewPanel';
const ProjectGrading = lazy(()=>import('./ProjectGrading').then(m=>({default:m.ProjectGrading})));
const ProjectStudentList = lazy(()=>import('./ProjectStudentList').then(m=>({default:m.ProjectStudentList})));
const PlanSettingsAdmin = lazy(() => import('../admin/pages/PlanSettingsAdmin').then(module => ({default:module.PlanSettingsAdmin})));
const LecturerGuideSettingsAdmin = lazy(() => import('../admin/pages/LecturerGuideSettingsAdmin').then(module => ({default:module.LecturerGuideSettingsAdmin})));
const FAQSettingsAdmin = lazy(() => import('../admin/pages/FAQSettingsAdmin').then(module => ({default:module.FAQSettingsAdmin})));
const RegistrationRulesSettingsAdmin = lazy(() => import('../admin/pages/RegistrationRulesSettingsAdmin').then(module => ({default:module.RegistrationRulesSettingsAdmin})));
const PlanView=lazy(()=>import('../shared/pages/PlanView').then(module=>({default:module.PlanView})));
const LecturerGuideView=lazy(()=>import('../shared/pages/LecturerGuideView').then(module=>({default:module.LecturerGuideView})));
const CampaignMarkdown = lazy(() => import('./CampaignMarkdown').then(module => ({ default: module.CampaignMarkdown })));
const CampaignFAQ = lazy(() => import('./CampaignFAQ').then(module => ({ default: module.CampaignFAQ })));

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
  const writtenQuery = useRef<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.get('q') || '');
  const searchValue = useRef(searchInput), composingSearch = useRef(false);
  const [searchComposing, setSearchComposing] = useState(false);
  const changeSearch = (value: string) => { searchValue.current = value; setSearchInput(value); };
  const composeSearch = (value: boolean) => { composingSearch.current = value; setSearchComposing(value); };
  const teachingView = user.role === 'admin' && !!user.is_lecturer && query.get('view') === 'lecturer';
  const actor = teachingView ? { ...user, role: 'lecturer' } : user;
  const [actionsHost,setActionsHost]=useState<HTMLElement|null>(null);
  const [extraFilters,setExtraFilters]=useState<CampaignFilter[]>([]);
  const [showImport, setShowImport] = useState(false); const defaultTab = actor.role === 'admin' ? 'overview' : 'students'; const requestedTab = query.get('tab') || defaultTab;
  const [dataKey,setDataKey]=useState('');
  const [data, setData] = useState<Meta | null>(null), [rowResult, setRowResult] = useState<{key:string;page:Page} | null>(null), [selected, setSelected] = useState<EnrollmentView | null>(null);
  const modules = campaignModules(actor.role === 'admin', actor.role === 'student', data?.campaign.group === 'internship');
  const projectManagement = data?.campaign.group==='project' && actor.role!=='student';
  const isEditorTab = actor.role === 'admin' && ['plan-editor', 'guide-editor', 'faq-editor', 'rules-editor'].includes(requestedTab);
  const tab = projectManagement && ['students','assignments','reports'].includes(requestedTab)
    ? 'students'
    : (modules.some(item => item.id === requestedTab) || isEditorTab)
    ? requestedTab
    : defaultTab;
  useEffect(()=>{if(!projectManagement)return;const next=projectListQuery(query);if(next.toString()!==query.toString())setQuery(next,{replace:true});},[projectManagement,query.toString()]);
  useEffect(()=>{const reset=()=>{appliedQuery.current=query;writtenQuery.current=null;changeSearch(query.get('q')||'');composeSearch(false);};window.addEventListener('project-navigation-blocked',reset);return()=>window.removeEventListener('project-navigation-blocked',reset);},[query]);
  const [chat, setChat] = useState<any>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const filters = Object.fromEntries(['courseCode', 'classId', 'lecturerId', 'status', 'topicStatus', 'assignmentStatus', 'submissionStatus', 'gradeStatus', 'advisorChangeStatus', 'q', 'page'].map(k => [k, query.get(k) || '']).filter(([, v]) => v));
  if(projectManagement&&query.get('enrollmentId')&&!query.get('page'))filters.focusEnrollmentId=query.get('enrollmentId')!;
  if (teachingView) filters.lecturerId = String(data?.lecturers.find(l => l.email.toLowerCase() === user.email.toLowerCase())?.id ?? -1);
  const section = tab === 'overview' ? 'overview' : ['plan','guide','questions'].includes(tab) ? 'content' : tab.endsWith('-editor') ? 'full' : tab==='settings' ? 'base' : ['students','assignments','reports','grades','settings','chat'].includes(tab) ? 'management' : 'base';
  const filterKey = new URLSearchParams(filters).toString(); const selectedId = query.get('enrollmentId') || '';
  const cacheScope = `${user.id}:${actor.role}:${id}`;
  const metaKey = `${token}:${cacheScope}:${section}`, rowsKey = `${token}:${cacheScope}:${tab}:${filterKey}`, detailKey = `${token}:${cacheScope}:${tab}:${selectedId}`;
  const active = useRef({metaKey,rowsKey,detailKey}); active.current = {metaKey,rowsKey,detailKey};
  const editQuery = (patch: Record<string, string>, options?: NavigateOptions) => {
    // Router navigation is a transition. A second interaction can arrive before
    // its new render commits; merge into the latest applied URL, not that render's closure.
    // Include pending text in a filter/page/function action, so it applies once
    // with that action instead of issuing a second, delayed search navigation.
    const withSearch = !('q' in patch) && !composingSearch.current && searchValue.current !== (appliedQuery.current.get('q') || '') ? {...patch,q:searchValue.current,page:''} : patch;
    const next = campaignQuery(appliedQuery.current, withSearch);
    if (next.toString() === appliedQuery.current.toString()) return;
    if ('q' in patch) changeSearch(patch.q);
    writtenQuery.current = next.toString(); appliedQuery.current = next; setQuery(next, options);
  };
  useLayoutEffect(() => {
    appliedQuery.current = query;
    // Back/forward, group/role changes and cancelled navigation restore the URL.
    // Acknowledging our own write must not erase text typed since that write.
    if (writtenQuery.current !== query.toString()) { changeSearch(query.get('q') || ''); composeSearch(false); }
    writtenQuery.current = null;
  }, [query, actor.role]);
  const updateQuery = useRef(editQuery); updateQuery.current = editQuery;
  const searchEnabled = actor.role !== 'student' && recordPages.includes(tab) && !(tab === 'assignments' && query.get('view') === 'quotas');
  useEffect(() => {
    if (!searchEnabled || searchComposing || searchInput === (query.get('q') || '')) return;
    const timer = window.setTimeout(() => {
      if (!composingSearch.current) updateQuery.current({q:searchValue.current,enrollmentId:'',panel:''}, {replace:true});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, searchComposing, query.get('q'), searchEnabled]);
  const rows = rowResult?.key === rowsKey ? rowResult.page : null;
  const go = (next: string) => { setShowImport(false); setError(''); setNotice(''); editQuery({ tab: next, enrollmentId: '', panel: '' }); };
  useEffect(() => { if (user.role === 'student' && tab === 'students' && !selectedId && rows?.total === 1 && rows.items.length === 1) setQuery(old => { const next = new URLSearchParams(old); next.set('enrollmentId', rows.items[0].id); return next; }, { replace: true }); }, [user.role, tab, selectedId, rows, setQuery]);
  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Meta>(token, `/api/campaigns/${id}?section=${section}`, 'GET', undefined, signal, {scope:cacheScope}); if (signal?.aborted || active.current.metaKey !== metaKey) return; setData(result);setDataKey(metaKey); sessionStorage.setItem('academic:campaign', id); sessionStorage.setItem('academic:semester', result.campaign.semesterId);
  }, [token, id, section, cacheScope, metaKey]);
  const loadRows = useCallback(async (signal?: AbortSignal) => {
    const result = await academicApi<Page>(token, `/api/campaigns/${id}/enrollments?${filterKey}${projectManagement ? '&projection='+ (tab==='grades'?'grades':'students') : ['students','assignments','reports','grades'].includes(tab) ? '&projection=' + tab : ''}`, 'GET', undefined, signal, {scope:cacheScope});
    if (!signal?.aborted && active.current.rowsKey === rowsKey) setRowResult({key:rowsKey,page:result});
  }, [token, id, filterKey, tab, cacheScope, rowsKey, projectManagement]);
  const needsRows = Boolean(data && recordPages.includes(tab) && !(data.campaign.legacy && data.campaign.status === 'active' && hasLegacyPanel(actor, tab)));
  const refresh = useCallback(async () => { await Promise.all([loadMeta(), ...(needsRows ? [loadRows()] : [])]); if (selectedId && needsRows && !projectManagement) { const detail = await academicApi<EnrollmentView>(token, `/api/enrollments/${selectedId}`, 'GET', undefined, undefined, {scope:cacheScope}); if (active.current.detailKey === detailKey) setSelected(detail); } }, [loadMeta, loadRows, selectedId, token, needsRows, cacheScope, detailKey, projectManagement]);
  useEffect(() => { const a = new AbortController(); loadMeta(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadMeta]);
  useEffect(() => { if (!data || !needsRows) return; const a = new AbortController(); setRowResult(null); loadRows(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [loadRows, !!data, needsRows]);
  useEffect(() => {
    if (!data) return;
    const a = new AbortController(); setSelected(null); if (selectedId && !projectManagement && recordPages.includes(tab) && !(data.campaign.legacy && hasLegacyPanel(actor, tab))) academicApi<EnrollmentView>(token, `/api/enrollments/${selectedId}`, 'GET', undefined, a.signal, {scope:cacheScope}).then(e => { if (!a.signal.aborted && active.current.detailKey === detailKey) setSelected(e); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => a.abort();
  }, [token, id, selectedId, tab, data?.campaign.legacy, cacheScope, detailKey, !!data]);
  useEffect(() => { if (tab !== 'chat' || !data || data.campaign.legacy && data.campaign.status==='active') return; const a = new AbortController(); academicApi(token, `/api/campaigns/${id}/chat-context`, 'GET', undefined, a.signal).then(setChat).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [token, id, tab, data?.campaign.legacy, !!data]);
  const lastVisibilityTime = useRef(Date.now());
  useEffect(() => {
    const revalidate = (e?: Event) => {
      if (e?.type === 'visibilitychange') {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastVisibilityTime.current < 60_000) return;
        lastVisibilityTime.current = now;
      }
      refresh().catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    };
    window.addEventListener('api-data-changed', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('api-data-changed', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const runOnly = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  if (!data) return <p role="status">{error || 'Đang tải nhóm môn…'}</p>;
  const currentMeta=dataKey===metaKey;
  const p = data.campaign, admin = actor.role === 'admin', student = actor.role === 'student', project = p.group === 'project';
  const chosenClass = data.classes.find(c => c.id === query.get('classId'));
  const selectedClass = selected && data.classes.find(c => c.id === selected.classId);
  const legacyPanel = p.legacy && p.status === 'active' && hasLegacyPanel(actor, tab);
  const synthetic = { ...data.classes[0], ...p, code: GROUP_NAMES[p.group], courseName: GROUP_NAMES[p.group], canJoin: false } as AcademicClassSummary;
  const editorTitles: Record<string, string> = {
    'plan-editor': 'Cài đặt Kế hoạch',
    'guide-editor': 'Cài đặt Hướng dẫn GV',
    'faq-editor': 'Cài đặt FAQ',
    'rules-editor': 'Cài đặt Quy định thực tập',
  };
  const currentModule = modules.find(item => item.id === tab) || {
    id: tab,
    title: editorTitles[tab] || 'Thiết lập',
    description: '',
    icon: 'settings',
  };
  const panel = ['profile', 'assignments', 'reports', 'grades'].includes(query.get('panel') || '') ? query.get('panel') as EnrollmentPanelMode : panelForPage(tab);
  const open = (e: CampaignRecord, mode: EnrollmentPanelMode = panelForPage(tab)) => editQuery({ enrollmentId: e.id, panel: mode });
  const exportFile = () => runOnly(() => academicDownload(token, `/api/campaigns/${id}/exports/${tab}.xlsx?${filterKey}`, `${tab}-${chosenClass?.code || p.group}-${p.semesterId}.xlsx`));
  const list = recordPages.includes(tab) && !student && !(legacyPanel && tab==='assignments' && query.get('view')==='quotas');
  const reload = () => runOnly(async()=>{refreshRequestCache();await refresh();window.dispatchEvent(new Event('api-force-refresh'));});
  return <CampaignLayoutContext.Provider value={{meta:data,actor,tab,legacy:!!legacyPanel,query,editQuery,searchInput,changeSearch,composeSearch,actionsHost,setActionsHost,extraFilters,setExtraFilters}}><CampaignEditorContext campaign={p} token={token} refresh={refresh}><div className="max-w-7xl mx-auto space-y-4">
    <CampaignChrome token={token} modules={modules} title={tab==='overview'?'Tổng quan Quản trị':currentModule.title} go={go} reload={reload} busy={busy} list={list}/>
    {error && <p role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-sm">{error}</p>}{notice && <p role="status" className="bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded-xl text-sm">{notice}</p>}
    {list && !p.pendingMigration && <CampaignListToolbar/>}
    <Suspense key={`${tab}:${actor.role}`} fallback={<p role="status">Đang tải chức năng…</p>}>
    {p.pendingMigration ? <CampaignMigration token={token} refresh={refresh} /> : <>
      {tab === 'overview' && admin && <CampaignDashboard data={data} modules={modules} navigate={go} token={token} reload={() => runOnly(async()=>{refreshRequestCache();await refresh();})} />}
      {showImport && tab === 'students' && admin && project && <ImportPanel token={token} semesterId={p.semesterId} onImported={refresh} />}
      {legacyPanel ? (!currentMeta ? <p role="status">Đang tải chức năng…</p> : <LegacyCampaignPanels key={`${tab}:${chosenClass?.courseCode || query.get('courseCode') || ''}`} token={token} user={actor} tab={tab} courseCode={chosenClass?.courseCode || query.get('courseCode') || ''} />) : <>
        {projectManagement && tab==='grades' && <ProjectGrading token={token} page={rows} refresh={refresh}/>}
        {projectManagement && tab==='students' && <ProjectStudentList key={`${id}:${actor.role}`} token={token} page={rows} refresh={refresh} importAction={()=>setShowImport(value=>!value)}/>}
        {recordPages.includes(tab) && !student && !projectManagement && <CampaignRecords token={token} page={rows} tab={tab} project={project} lecturer={!admin} lecturers={data.lecturers} query={query} editQuery={editQuery} open={open} exportFile={exportFile} busy={busy} extraActions={admin && project && tab==='students' && p.status!=='archived' ? <Button size="sm" variant="primary" leadingIcon={<Upload size={14}/>} onClick={()=>setShowImport(value=>!value)}>{showImport?'Đóng import':'Import danh sách'}</Button> : null}/>}
        {student && tab === 'students' && (
          <section className="space-y-5">
            {rows && rows.items.length > 1 && (
              <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-[#034ea1]" />
                  <h2 className="font-bold text-sm text-slate-900">Hồ sơ học phần của tôi</h2>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {rows.items.map(e => (
                    <button
                      key={e.id}
                      onClick={() => editQuery({ enrollmentId: e.id, panel: '' })}
                      aria-pressed={selectedId === e.id}
                      className={`text-left p-4 border rounded-2xl transition-all cursor-pointer flex flex-col justify-between ${
                        selectedId === e.id
                          ? 'border-[#034ea1] bg-blue-50/70 shadow-xs ring-2 ring-blue-500/20'
                          : 'border-slate-200/90 bg-white hover:border-[#034ea1]/50 hover:shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-sm text-[#034ea1] font-mono">{e.courseCode} · {e.classCode}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          e.topicPermissions?.requiresResubmission
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : e.versions.at(-1)?.state === 'submitted'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {e.topicPermissions?.requiresResubmission
                            ? 'Cần nộp lại'
                            : e.versions.at(-1)?.state === 'submitted'
                            ? 'Đã nộp bài'
                            : 'Chưa hoàn tất'}
                        </span>
                      </div>
                      <span className="block text-xs font-semibold text-slate-800 mt-2 line-clamp-2">
                        {e.topic || <span className="text-slate-400 italic font-normal">Chưa khai báo đề tài</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected && selectedClass ? (
              <EnrollmentPanel
                key={selected.id}
                token={token}
                user={actor}
                courseClass={selectedClass}
                enrollment={selected}
                lecturers={data.lecturers}
                refresh={refresh}
              />
            ) : (
              <div className="p-12 bg-white rounded-2xl border border-black/[0.06] text-sm text-center text-slate-500 shadow-2xs">
                {!rows ? 'Đang tải hồ sơ…' : rows.items.length ? 'Chọn hồ sơ học phần để xem thông tin và nộp bài.' : 'Bạn chưa có hồ sơ học phần trong nhóm môn này.'}
              </div>
            )}
          </section>
        )}
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
      {admin && !legacyPanel && p.status === 'active' && tab === 'grades' && (!projectManagement||!selectedId) && (
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
      {tab === 'settings' && admin && (
        <div className="space-y-6">
          <AdminSettingsSubNav />
          <CampaignSettingsPanel key={p.revision} token={token} c={p} run={run} busy={busy} />
          <section className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 space-y-4" aria-label="Danh mục dùng chung">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-900">Danh mục & Liên kết quản trị dùng chung</h3>
              <p className="text-xs text-slate-500 mt-0.5">Truy cập nhanh danh bạ hồ sơ và cấu hình hệ thống toàn Khoa.</p>
            </div>
            <div className="space-y-4">
              <div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Hồ sơ & Danh bạ</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                  {[
                    { key: 'students', name: 'Sinh viên', icon: Users },
                    { key: 'lecturers', name: 'Giảng viên', icon: GraduationCap },
                    { key: 'companies', name: 'Doanh nghiệp', icon: Building2 },
                    { key: 'approved-companies', name: 'CSDL thẩm định', icon: ShieldCheck },
                    { key: 'admins', name: 'Quản trị viên', icon: ShieldAlert },
                  ].map(({ key, name, icon: Icon }) => (
                    <Link
                      key={key}
                      to={`/admin/${key}`}
                      className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-[#034ea1]/40 hover:shadow-xs transition-all text-xs font-semibold text-slate-700 hover:text-[#034ea1]"
                    >
                      <Icon size={14} className="text-slate-500 shrink-0" />
                      <span className="truncate">{name}</span>
                    </Link>
                  ))}
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Hệ thống & Tích hợp</span>
                <div className="flex flex-wrap gap-2.5">
                  <Link
                    to="/system/settings"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-[#034ea1]/40 hover:shadow-xs transition-all text-xs font-semibold text-slate-700 hover:text-[#034ea1]"
                  >
                    <FileSpreadsheet size={14} className="text-slate-500 shrink-0" />
                    <span>Tích hợp hệ thống / Google Sheets</span>
                  </Link>
                  <Link
                    to="/system/notifications"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-[#034ea1]/40 hover:shadow-xs transition-all text-xs font-semibold text-slate-700 hover:text-[#034ea1]"
                  >
                    <Bell size={14} className="text-slate-500 shrink-0" />
                    <span>Thông báo hệ thống</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
      {tab === 'questions' && !legacyPanel && currentMeta && (
        <div className="max-w-5xl mx-auto space-y-6">
          <CampaignFAQ
            content={(student ? p.settings.studentFaq : p.settings.lecturerFaq) || 'Khoa chưa cập nhật câu hỏi thường gặp.'}
            isStudent={student}
          />
          <ClassQuestions token={token} user={actor} c={synthetic} />
        </div>
      )}
      {tab === 'announcements' && admin && (
        <div className="max-w-5xl mx-auto space-y-6">
          <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs" aria-label="Phạm vi thông báo">
            <FormField label="Gửi tới học phần"><select className={academicInput} value={query.get('courseCode')||''} onChange={e=>editQuery({courseCode:e.target.value,classId:''})}><option value="">Toàn nhóm môn</option>{[...new Set(data.classes.map(c=>c.courseCode))].map(code=><option key={code} value={code}>{code}</option>)}</select></FormField>
            <FormField label="Gửi tới lớp"><select className={academicInput} value={query.get('classId')||''} onChange={e=>editQuery({classId:e.target.value})}><option value="">Tất cả lớp trong phạm vi</option>{data.classes.filter(c=>!query.get('courseCode')||c.courseCode===query.get('courseCode')).map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></FormField>
          </section>
          <ClassAnnouncement key={`${id}:${query.get('classId')}:${query.get('courseCode')}`} token={token} c={synthetic} filters={{ ...(query.get('classId') ? { classId: query.get('classId')! } : {}), ...(query.get('courseCode') ? { courseCode: query.get('courseCode')! } : {}) }} scopeLabel={chosenClass?.code || query.get('courseCode') || 'Toàn nhóm môn trong học kỳ'} />
        </div>
      )}
      {tab === 'chat' && !legacyPanel && chat && <ClassChat token={token} user={actor} data={{ class: synthetic, enrollments: chat.enrollments, lecturers: data.lecturers }} />}
      {student && p.group === 'internship' && data.classes.some(c => c.canJoin) && <section className="bg-white border rounded-xl p-5 space-y-3"><h3 className="font-semibold">Tham gia lớp Thực tập</h3>{data.classes.filter(c => c.canJoin).map(c => <Button key={c.id} disabled={busy} onClick={() => run(() => academicApi(token, `/api/classes/${c.id}/enrollments/join`, 'POST'))}>Tham gia {c.code}</Button>)}</section>}
    </>}
    </Suspense>
  </div></CampaignEditorContext></CampaignLayoutContext.Provider>;
}
