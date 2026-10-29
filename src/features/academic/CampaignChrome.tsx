import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import { GROUP_NAMES, type CampaignSummary } from '../../shared/academic';
import { academicApi } from './client';
import { campaignModules, campaignNavigation, campaignSwitchQuery } from './campaignPresentation';
import { useCampaignLayout } from './CampaignLayoutContext';
import { CampaignPopover, useCampaignWide } from './CampaignPopover';

export function CampaignChrome({ token, modules, title, go, reload, busy, list }: {
  token: string; modules: ReturnType<typeof campaignModules>; title: string; go: (tab: string) => void;
  reload: () => void; busy: boolean; list: boolean;
}) {
  const layout = useCampaignLayout()!, p = layout.meta.campaign;
  const navigate = useNavigate(), wide = useCampaignWide();
  const [menu, setMenu] = useState<'groups' | 'more' | null>(null);
  const [catalog, setCatalog] = useState<CampaignSummary[] | null>(null), [catalogError, setCatalogError] = useState('');
  const [semester, setSemester] = useState(p.semesterId);
  const groupsButton = useRef<HTMLButtonElement>(null), moreButton = useRef<HTMLButtonElement>(null);
  const navigation = campaignNavigation(modules, layout.actor.role, p.group === 'internship', wide);
  const moreActive = navigation.more.some(m => m.id === layout.tab);
  useEffect(() => { setMenu(null); }, [layout.tab, p.id, wide]);
  useEffect(() => {
    if (menu !== 'groups') return;
    const abort = new AbortController(); setCatalogError(''); setCatalog(null);
    academicApi<{campaigns:CampaignSummary[]}>(token, '/api/me/campaigns?section=base', 'GET', undefined, abort.signal)
      .then(result => { if (!abort.signal.aborted) setCatalog(result.campaigns); })
      .catch(error => { if (error.name !== 'AbortError') { setCatalog(null); setCatalogError(error.message); } });
    return () => abort.abort();
  }, [token, menu]);
  const switchGroup = (target: CampaignSummary) => {
    setMenu(null);
    if (target.id === p.id) return;
    const available = campaignModules(layout.actor.role === 'admin', layout.actor.role === 'student', target.group === 'internship');
    const query = campaignSwitchQuery(layout.query, available, layout.query.get('view') === 'lecturer');
    sessionStorage.setItem('academic:campaign', target.id); sessionStorage.setItem('academic:semester', target.semesterId);
    sessionStorage.setItem('academic:group', target.group);
    navigate(`/campaigns/${target.id}${query.size ? '?' + query : ''}`);
  };
  const semesterNames = [...new Map((catalog || []).map(c => [c.semesterId, c.semesterName])).entries()];
  const warning = p.pendingMigration ? 'Chờ chuyển đổi' : p.status === 'draft' ? 'Nhóm nháp' : p.status === 'archived' ? 'Lưu trữ · Chỉ xem' : '';
  return <div className="campaign-chrome space-y-2" data-testid="campaign-chrome">
    <header className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="min-w-0 text-xl font-bold tracking-tight text-slate-900">{title}</h1>
      <button ref={groupsButton} type="button" aria-haspopup="dialog" aria-label="Chọn học kỳ và nhóm môn" aria-expanded={menu === 'groups'} onClick={() => { setSemester(p.semesterId); setMenu(menu === 'groups' ? null : 'groups'); }} className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:border-blue-300 hover:text-[#034ea1]">
        <span className="truncate">{GROUP_NAMES[p.group]} · {p.semesterName.replace('Học kỳ I', 'HKI').replace('Học kỳ II', 'HKII').replace('Học kỳ Hè', 'Hè')}</span><ChevronDown size={14} className="shrink-0"/>
      </button>
      {warning && <span role="status" className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800"><AlertCircle size={13}/>{warning}</span>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {!list && <div ref={layout.setActionsHost} className="flex flex-wrap items-center gap-2" data-testid="campaign-page-actions"/>}
        <button type="button" aria-label="Tải lại" title="Tải lại" disabled={busy} onClick={reload} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={busy ? 'animate-spin' : ''}/></button>
      </div>
    </header>
    {!p.pendingMigration && <nav aria-label="Chức năng nhóm môn" className="flex h-9 items-center gap-1 border-b border-slate-200">
      {navigation.primary.map(item => <button key={item.id} data-campaign-tab={item.id} type="button" aria-current={layout.tab === item.id ? 'page' : undefined} onClick={() => go(item.id)} className={`h-9 whitespace-nowrap border-b-2 px-2.5 text-xs font-semibold transition-colors ${layout.tab === item.id ? 'border-[#034ea1] text-[#034ea1]' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{item.label}</button>)}
      {!!navigation.more.length && <button ref={moreButton} type="button" aria-haspopup="dialog" aria-label="Thêm chức năng" aria-expanded={menu === 'more'} aria-current={moreActive ? 'page' : undefined} onClick={() => setMenu(menu === 'more' ? null : 'more')} className={`inline-flex h-9 items-center gap-1 border-b-2 px-2.5 text-xs font-semibold ${moreActive ? 'border-[#034ea1] text-[#034ea1]' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>Thêm<ChevronDown size={13}/>{moreActive && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#034ea1]"/>}</button>}
    </nav>}
    {menu === 'more' && <CampaignPopover title="Chức năng" trigger={moreButton} close={() => setMenu(null)} width={300}><div className="space-y-1">{navigation.more.map(item => <button key={item.id} data-campaign-tab={item.id} type="button" aria-current={layout.tab === item.id ? 'page' : undefined} onClick={() => { setMenu(null); go(item.id); }} className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm ${layout.tab === item.id ? 'bg-blue-50 font-semibold text-[#034ea1]' : 'text-slate-700 hover:bg-slate-50'}`}>{item.title}</button>)}</div></CampaignPopover>}
    {menu === 'groups' && <CampaignPopover title="Học kỳ và nhóm môn" trigger={groupsButton} close={() => setMenu(null)}>
      {catalogError ? <p role="alert" className="text-sm text-rose-700">{catalogError}</p> : !catalog ? <p role="status" className="text-sm text-slate-500">Đang tải nhóm môn…</p> : <div className="space-y-4">
        <label className="block space-y-1 text-xs font-medium text-slate-600"><span>Học kỳ</span><select aria-label="Học kỳ" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={semester} onChange={event => setSemester(event.target.value)}>{semesterNames.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2">{catalog.filter(c => c.semesterId === semester).map(c => <button key={c.id} type="button" aria-pressed={c.id === p.id} onClick={() => switchGroup(c)} className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${c.id === p.id ? 'border-blue-300 bg-blue-50 text-[#034ea1]' : 'border-slate-200 hover:border-blue-300 text-slate-700'}`}>{GROUP_NAMES[c.group]}</button>)}</div>
        <Link to="/classes" className="block text-xs font-medium text-[#034ea1] hover:underline">Trang chọn học kỳ và nhóm môn</Link>
      </div>}
    </CampaignPopover>}
  </div>;
}
