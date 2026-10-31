import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { TOPIC_STATUS_NAMES } from '../../shared/academic';
import { Button } from '../../shared/ui';
import { gradeNames, campaignSearchPlaceholder } from './campaignPresentation';
import { useCampaignLayout, type CampaignFilter } from './CampaignLayoutContext';
import { CampaignPopover } from './CampaignPopover';

export const campaignFilterKeys = ['courseCode', 'classId', 'lecturerId', 'status', 'topicStatus', 'advisor','assignmentStatus','submissionStatus','gradeStatus'];
export function CampaignListToolbar() {
  const layout = useCampaignLayout()!;
  const {meta, actor, tab, legacy, query, editQuery} = layout;
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<Record<string,string>>({});
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [tab, meta.campaign.id]);
  const filters: CampaignFilter[] = [
    {key:'courseCode',label:'Học phần',options:[...new Set(meta.classes.map(c=>c.courseCode))].map(code=>({value:code,label:code}))},
    {key:'classId',label:'Lớp học phần',options:meta.classes.filter(c=>!draft.courseCode||c.courseCode===draft.courseCode).map(c=>({value:c.id,label:c.code}))},
  ];
  if(meta.campaign.group==='project')filters.push({key:'topicStatus',label:'Trạng thái đề tài',options:Object.entries(TOPIC_STATUS_NAMES).map(([value,label])=>({value,label}))});
  if(actor.role==='admin')filters.push({key:'lecturerId',label:'Giảng viên phân công',options:meta.lecturers.map(l=>({value:String(l.id),label:l.name}))});
  if(meta.campaign.group==='project'){
    filters.push({key:'assignmentStatus',label:'Phân công',options:[{value:'missingPrimary',label:'Chưa có GVHD'},{value:'missingReviewer',label:'Chưa có GVNX'},{value:'complete',label:'Đủ GVHD/GVNX'}]},
      {key:'submissionStatus',label:'Bài nộp',options:[{value:'notSubmitted',label:'Chưa nộp đủ'},{value:'submitted',label:'Đã nộp'},{value:'needsRevision',label:'Cần nộp lại'}]},
      {key:'gradeStatus',label:'Điểm',options:[...Object.entries(gradeNames),['advisorMissing','Thiếu điểm GVHD'],['reviewerMissing','Thiếu điểm GVNX']].map(([value,label])=>({value,label}))});
  }else if(!legacy){
    const statuses = tab==='grades' ? Object.entries(gradeNames)
      : tab==='reports' ? [['notSubmitted','Chưa nộp đủ bài'],['complete','Đã hoàn tất điểm']] : [['active','Đang học'],['withdrawn','Đã rút']];
    filters.push({key:'status',label:'Trạng thái',options:statuses.map(([value,label])=>({value,label}))});
  }
  for(const field of layout.extraFilters){const index=filters.findIndex(f=>f.key===field.key);if(index>=0)filters[index]=field;else filters.push(field);}
  const count=filters.filter(f=>!!query.get(f.key)).length;
  const start = () => {setDraft(Object.fromEntries(filters.map(f=>[f.key,query.get(f.key)||''])));setOpen(true);};
  const apply = (clear=false) => {
    const patch=Object.fromEntries(campaignFilterKeys.map(key=>[key,clear?'':draft[key]||'']));
    // The teaching view's lecturer constraint is calculated by the backend client,
    // not a removable user filter. Other hidden context values stay untouched.
    editQuery({...patch,page:'',enrollmentId:'',panel:''});setOpen(false);
  };
  return <div className="campaign-list-toolbar flex flex-wrap items-center gap-2" data-testid="campaign-list-toolbar">
    <div className="relative min-w-[180px] flex-1 sm:max-w-sm"><Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400"/><input aria-label="Tìm sinh viên" className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 focus:border-blue-300 focus:outline-none" placeholder={campaignSearchPlaceholder(meta.campaign.group,legacy)} value={query.get('q')||''} onChange={event=>editQuery({q:event.target.value,enrollmentId:'',panel:''})}/></div>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={count?`Bộ lọc (${count})`:'Bộ lọc'} onClick={start} className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${count?'border-blue-200 bg-blue-50 text-[#034ea1]':'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}><SlidersHorizontal size={14}/>Bộ lọc{count>0&&<span>({count})</span>}</button>
    <div ref={layout.setActionsHost} className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2" data-testid="campaign-list-actions"/>
    {open&&<CampaignPopover title="Bộ lọc danh sách" trigger={trigger} close={()=>setOpen(false)} width={448}><form className="space-y-4" onSubmit={event=>{event.preventDefault();apply();}}>
      <div className="grid gap-3 sm:grid-cols-2">{filters.map(field=><label key={field.key} className="block space-y-1 text-xs font-medium text-slate-600"><span>{field.label}</span><select aria-label={field.label} className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800" value={draft[field.key]||''} onChange={event=>setDraft(old=>{const next={...old,[field.key]:event.target.value};if(field.key==='courseCode'&&next.classId&&!meta.classes.some(c=>c.id===next.classId&&(!next.courseCode||c.courseCode===next.courseCode)))next.classId='';return next;})}><option value="">Tất cả</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3"><Button size="sm" onClick={()=>apply(true)}>Xóa bộ lọc</Button><Button size="sm" onClick={()=>setOpen(false)}>Hủy</Button><Button size="sm" variant="primary" type="submit">Áp dụng</Button></div>
    </form></CampaignPopover>}
  </div>;
}
