import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle} from 'lucide-react';
import {Button,FormField} from '../../shared/ui';
import {TOPIC_STATUS_NAMES} from '../../shared/academic';
import type {ProjectPatch} from '../../../server/academic/projectList';
import {CampaignToolbarActions,useCampaignLayout} from './CampaignLayoutContext';
import {academicApi,academicDownload} from './client';
import {academicInput} from './form';
import {lecturerNames,type CampaignRecord,type CampaignRecordPage} from './campaignPresentation';
import {RecordBadge} from './CampaignRecords';
import {EnrollmentDialog} from './EnrollmentDialog';
import {useProjectNavigationGuard} from './useProjectNavigationGuard';
import {LecturerPicker} from './LecturerPicker';
const PdfDialog=lazy(()=>import('./ProjectPdfDialog').then(m=>({default:m.ProjectPdfDialog})));
const AddStudent=lazy(()=>import('./ProjectStudentAdd').then(m=>({default:m.ProjectStudentAdd})));
const Reviewer=lazy(()=>import('./ReviewerPanel').then(m=>({default:m.ReviewerPanel})));
type Draft={base:CampaignRecord;patch:ProjectPatch;error?:string;errorField?:string};
export function ProjectStudentList({token,page,refresh,importAction}:{token:string;page:CampaignRecordPage|null;refresh:()=>Promise<void>;importAction:()=>void}){
  const {meta,actor,query,editQuery}=useCampaignLayout()!,campaign=meta.campaign,admin=actor.role==='admin',writable=campaign.status==='active';
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[editing,setEditing]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[messageError,setMessageError]=useState(false),[rowNotices,setRowNotices]=useState<Record<string,string>>({}),[savingRows,setSavingRows]=useState<string[]>([]),[selected,setSelected]=useState<string[]>([]),[pdf,setPdf]=useState(''),[deletion,setDeletion]=useState<any>(null),[reason,setReason]=useState(''),[job,setJob]=useState<any>(null),[adding,setAdding]=useState(false);
  const [reviewingAdvisorChange, setReviewingAdvisorChange] = useState<CampaignRecord | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const [showQueueDialog, setShowQueueDialog] = useState(false);
  const [queueItems, setQueueItems] = useState<CampaignRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [bulkReviewComment, setBulkReviewComment] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');

  const pendingCount = Number(meta.stats?.advisorChangePending ?? page?.items.filter(e => e.advisorChangeRequest?.status === 'pending').length ?? 0);

  const loadQueue = async () => {
    setQueueLoading(true);
    setQueueError('');
    try {
      const res = await academicApi<CampaignRecordPage>(
        token,
        `/api/campaigns/${campaign.id}/enrollments?advisorChangeStatus=pending&__all=true`,
        'GET'
      );
      const items = res.items || [];
      setQueueItems(items);
      setSelectedQueueIds(items.map(item => item.id));
    } catch (err: any) {
      setQueueError(err.message || 'Không thể tải danh sách yêu cầu chờ duyệt.');
    } finally {
      setQueueLoading(false);
    }
  };

  const handleBulkReview = async (status: 'approved' | 'rejected', singleItem?: CampaignRecord) => {
    const ids = singleItem ? [singleItem.id] : selectedQueueIds;
    if (!ids.length) {
      alert('Vui lòng chọn ít nhất một yêu cầu để thực hiện.');
      return;
    }
    if (status === 'rejected' && !bulkReviewComment.trim()) {
      if (!window.confirm('Bạn chưa nhập lý do từ chối. Bạn có chắc chắn muốn từ chối các yêu cầu đã chọn không?')) {
        return;
      }
    }
    setBulkBusy(true);
    setQueueError('');
    try {
      await academicApi(
        token,
        `/api/campaigns/${campaign.id}/advisor-change-requests/bulk-review`,
        'POST',
        {
          enrollmentIds: ids,
          status,
          reviewComment: bulkReviewComment.trim(),
        }
      );
      setMessageError(false);
      setMessage(
        status === 'approved'
          ? `Đã duyệt thành công ${ids.length} yêu cầu đổi GVHD.`
          : `Đã từ chối ${ids.length} yêu cầu đổi GVHD.`
      );
      await Promise.all([loadQueue(), refresh()]);
    } catch (err: any) {
      setQueueError(err.message || 'Có lỗi xảy ra khi xử lý duyệt yêu cầu.');
    } finally {
      setBulkBusy(false);
    }
  };

  const filteredQueueItems = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return queueItems;
    return queueItems.filter(item => {
      const curLecturer = meta.lecturers.find(l => l.id === item.advisorChangeRequest?.currentLecturerId)?.name || '';
      const tgtLecturer = meta.lecturers.find(l => l.id === item.advisorChangeRequest?.targetLecturerId)?.name || '';
      return (
        item.name.toLowerCase().includes(q) ||
        item.studentId.toLowerCase().includes(q) ||
        item.classCode.toLowerCase().includes(q) ||
        curLecturer.toLowerCase().includes(q) ||
        tgtLecturer.toLowerCase().includes(q) ||
        (item.advisorChangeRequest?.reason || '').toLowerCase().includes(q)
      );
    });
  }, [queueItems, queueSearch, meta.lecturers]);
  const latest=useRef(drafts),saving=useRef(false);latest.current=drafts;const count=Object.keys(drafts).length;
  const mutate=(e:CampaignRecord,key:Exclude<keyof ProjectPatch,'enrollmentId'|'expectedRevision'>,value:any)=>{if(saving.current)return;setRowNotices(old=>{const next={...old};delete next[e.id];return next;});setDrafts(old=>({...old,[e.id]:{base:old[e.id]?.base||e,patch:{...(old[e.id]?.patch||{enrollmentId:e.id,expectedRevision:e.revision}),[key]:value}}}));};
  const discardRow=(id:string)=>{if(saving.current)return;setDrafts(old=>{const next={...old};delete next[id];latest.current=next;return next;});setRowNotices(old=>({...old,[id]:'Đã hủy thay đổi chưa lưu.'}));};
  const discard=()=>{if(saving.current)return;setDrafts({});latest.current={};setEditing(new Set());setRowNotices({});};
  const saveRows=async(enrollmentIds?:string[])=>{
    if(saving.current)return false;
    const entries=Object.values(latest.current).filter(d=>!enrollmentIds||enrollmentIds.includes(d.patch.enrollmentId));if(!entries.length)return true;saving.current=true;setSavingRows(entries.map(d=>d.patch.enrollmentId));setBusy(true);setMessage('');setMessageError(false);let saved=0,failed=0;const completed=new Set<string>();
    try{
      for(let start=0;start<entries.length;start+=25){
        const batch=entries.slice(start,start+25);const response=await academicApi<any>(token,`/api/campaigns/${campaign.id}/enrollments/bulk`,'PATCH',{rows:batch.map(d=>d.patch)});
        for(const result of response.results){if(result.ok){saved++;completed.add(result.enrollmentId);}else failed++;}
        setRowNotices(old=>({...old,...Object.fromEntries(response.results.filter(r=>r.ok).map(r=>[r.enrollmentId,'Đã lưu thay đổi.']))}));
        setDrafts(old=>{const next={...old};for(const result of response.results){if(result.ok)delete next[result.enrollmentId];else if(next[result.enrollmentId])next[result.enrollmentId]={...next[result.enrollmentId],error:result.error?.message||'Không lưu được dòng này.',errorField:result.error?.field};}latest.current=next;return next;});
      }
      setMessageError(failed>0);setMessage(`Đã lưu ${saved} sinh viên${failed?`; ${failed} dòng cần xử lý`:''}.`);
      try{await refresh();}catch{setMessage(`Đã lưu ${saved} sinh viên${failed?`; ${failed} dòng cần xử lý`:''}. Chưa tải lại được danh sách; dùng Tải lại để cập nhật.`);}
      return failed===0;
    }catch(error){setMessageError(true);setMessage(error.message);setDrafts(old=>{const next={...old};for(const entry of entries)if(!completed.has(entry.patch.enrollmentId)&&next[entry.patch.enrollmentId])next[entry.patch.enrollmentId]={...next[entry.patch.enrollmentId],error:error.message};latest.current=next;return next;});return false;}finally{saving.current=false;setSavingRows([]);setBusy(false);}
  };
  const save=()=>saveRows();
  const {dialog}=useProjectNavigationGuard(count>0||saving.current,save,discard,undefined,saving.current);
  const toggle=(id:string,part:string)=>setEditing(old=>{const next=new Set(old),key=id+':'+part;next.has(key)?next.delete(key):next.add(key);return next;});
  const isEditing=(id:string,part:string)=>editing.has(id+':'+part);
  useEffect(()=>{const id=query.get('enrollmentId');if(!id)return;const panel=query.get('panel');if(panel==='reports')setPdf(id);else if(panel==='assignments'||panel==='grades')setEditing(old=>new Set([...old,id+':'+panel]));document.getElementById('project-row-'+id)?.scrollIntoView({block:'center'});},[query.get('enrollmentId'),query.get('panel'),!!page]);
  useEffect(()=>{if(!job||job.status==='complete')return;const a=new AbortController();const timer=window.setInterval(()=>academicApi(token,`/api/campaigns/${campaign.id}/deletions/${job.jobId}`,'GET',undefined,a.signal).then(setJob).catch(e=>{if(e.name!=='AbortError')reportError(e);}),3000);return()=>{a.abort();clearInterval(timer);};},[job?.jobId,job?.status,token,campaign.id]);
  const removePreview=async()=>{setBusy(true);setMessage('');try{setDeletion(await academicApi(token,`/api/campaigns/${campaign.id}/deletions/preview`,'POST',{enrollmentIds:selected}));setReason('');}catch(e){reportError(e);}finally{setBusy(false);}};
  const exportFile=(dataset:string)=>{const filters=new URLSearchParams(query);for(const k of ['tab','view','page','enrollmentId','panel'])filters.delete(k);academicDownload(token,`/api/campaigns/${campaign.id}/exports/${dataset}.xlsx?${filters}`,`danh-sach-${dataset}.xlsx`).catch(reportError);};
  const start=(e:CampaignRecord,part:string)=>toggle(e.id,part);
  const names=(e:CampaignRecord,role:string)=>lecturerNames({...e,assignments:(drafts[e.id]?.patch.assignments||e.assignments) as any},meta.lecturers,role);
  const reportError=(error:any)=>{setMessageError(true);setMessage(error.message);};

  const handleReviewAdvisorChange = async (status: 'approved' | 'rejected') => {
    if (!reviewingAdvisorChange) return;
    if (status === 'rejected' && !reviewComment.trim()) {
      if (!window.confirm('Bạn chưa nhập lý do từ chối. Bạn có chắc chắn muốn từ chối yêu cầu này không?')) {
        return;
      }
    }
    setReviewBusy(true);
    setReviewError('');
    try {
      await academicApi(
        token,
        `/api/enrollments/${reviewingAdvisorChange.id}/advisor-change-request/review`,
        'POST',
        {
          status,
          reviewComment: reviewComment.trim(),
          expectedRevision: reviewingAdvisorChange.revision,
        }
      );
      const studentName = reviewingAdvisorChange.name;
      const targetName = meta.lecturers.find(l => l.id === reviewingAdvisorChange.advisorChangeRequest?.targetLecturerId)?.name || 'mới';
      setReviewingAdvisorChange(null);
      setReviewComment('');
      setReviewError('');
      setMessageError(false);
      setMessage(
        status === 'approved'
          ? `Đã duyệt đổi GVHD cho sinh viên ${studentName}. GVHD mới: ${targetName}.`
          : `Đã từ chối yêu cầu đổi GVHD của sinh viên ${studentName}.`
      );
      await refresh();
    } catch (err: any) {
      setReviewError(err.message || 'Không thể xử lý yêu cầu thay đổi GVHD.');
      setMessageError(true);
      setMessage(err.message || 'Không thể xử lý yêu cầu thay đổi GVHD.');
    } finally {
      setReviewBusy(false);
    }
  };

  const rowActions=(e:CampaignRecord,part:'topic'|'assignments'|'review')=>{
    const draft=drafts[e.id],label=part==='topic'?'đề tài':part==='assignments'?'phân công':'yêu cầu sửa';
    return <div className="space-y-2" role="group" aria-label={`Thao tác ${label} ${e.studentId}`}>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="primary" aria-label={part==='topic'?undefined:`Lưu ${label} ${e.studentId}`} title="Lưu toàn bộ thay đổi của sinh viên này" disabled={!draft||busy} onClick={()=>saveRows([e.id])}>{savingRows.includes(e.id)?'Đang lưu…':'Lưu'}</Button>
        {draft&&<Button size="sm" aria-label={`Hủy thay đổi dòng ${e.studentId}`} title="Bỏ tất cả thay đổi chưa lưu của sinh viên này" disabled={busy} onClick={()=>discardRow(e.id)}>Hủy sửa</Button>}
        {isEditing(e.id,part)&&<button type="button" className="text-[#034ea1] underline disabled:opacity-50" disabled={busy} aria-label={`Đóng ${label} ${e.studentId}`} onClick={()=>toggle(e.id,part)}>{part==='topic'?'Đóng ô đề tài':part==='assignments'?'Đóng phân công':'Đóng'}</button>}</div>
      {draft?.error?<p role="alert" className="text-xs text-rose-700">Chưa lưu: {draft.error}</p>:draft?<p className="text-xs text-amber-700">Chưa lưu · Đóng ô vẫn giữ thay đổi.</p>:rowNotices[e.id]?<p role="status" className="text-xs text-emerald-700">{rowNotices[e.id]}</p>:null}
    </div>;
  };
  const assignmentFields=(e:CampaignRecord)=>{
    const values=drafts[e.id]?.patch.assignments||e.assignments;
    const update=(role:string,ids:number[])=>mutate(e,'assignments',[...values.filter(a=>a.role!==role),...ids.map(lecturerId=>({role,lecturerId}))]);
    return <fieldset disabled={busy||!page||!writable||!!e.submissionLockedAt||!!e.lockedAt} className="min-w-48 space-y-2">{(['primary','co','reviewer'] as const).map(role=><LecturerPicker key={role} label={role==='primary'?'GVHD chính':role==='co'?'Đồng hướng dẫn':'GVNX'} studentId={e.studentId} lecturers={meta.lecturers} value={values.filter(a=>a.role===role).map(a=>a.lecturerId)} multiple={role==='co'} disabled={busy||!page||!writable||!!e.submissionLockedAt||!!e.lockedAt} invalid={drafts[e.id]?.errorField==='assignments'} onChange={ids=>update(role,ids)}/>)}</fieldset>;
  };
  return <section aria-label="Danh sách sinh viên" className="space-y-3">
    <CampaignToolbarActions>
      <Button size="sm" variant="primary" disabled={!count||busy} onClick={save}>Lưu thay đổi ({count})</Button><Button size="sm" disabled={!count||busy} onClick={discard}>Hủy thay đổi</Button>
      {admin&&<><Button size="sm" variant="primary" disabled={busy||!!count||campaign.pendingMigration||!['draft','active'].includes(campaign.status)} onClick={()=>setAdding(true)}>Thêm sinh viên</Button><Button size="sm" disabled={busy||!writable||!!count} onClick={importAction}>Import danh sách</Button><Button size="sm" disabled={busy||!writable||!!count||!selected.length} onClick={removePreview}>Xóa khỏi danh sách ({selected.length})</Button></>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setShowQueueDialog(true);
          loadQueue();
        }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
          pendingCount > 0
            ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 shadow-2xs font-bold'
            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
        }`}
        title="Mở danh sách duyệt tập trung yêu cầu đổi GVHD"
      >
        <span>⚡ Duyệt đổi GVHD</span>
        {pendingCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
            {pendingCount}
          </span>
        )}
      </button>
      <label className="text-xs text-slate-600">Xuất XLSX <select aria-label="Xuất XLSX" className="rounded-lg border bg-white p-2 text-xs" value="" onChange={e=>{if(e.target.value)exportFile(e.target.value);}}><option value="">Chọn danh sách</option>{[['student-list','Danh sách tổng hợp'],['students','Sinh viên'],['assignments','Phân công'],['reports','Báo cáo']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    </CampaignToolbarActions>
    {admin&&<Suspense fallback={null}><Reviewer token={token} c={meta.classes.find(c=>c.id===query.get('classId'))||{...meta.classes[0],...campaign,code:'đang chọn'}} lecturers={meta.lecturers} quotas={meta.quotas} refresh={refresh} disabled={!!count||busy}/></Suspense>}
    {message&&<p role={messageError?"alert":"status"} className={`rounded-xl p-3 text-sm ${messageError?"bg-rose-50 text-rose-800":"bg-blue-50 text-blue-900"}`}>{message}</p>}
    {job&&<div role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{job.status==='complete'?'Đã xóa hoàn tất dữ liệu và tệp của lần học.':`Đã xóa khỏi danh sách và thu hồi quyền; còn ${job.pendingFiles} tệp đang xử lý.`}{job.status!=='complete'&&<Button size="sm" disabled={busy} onClick={async()=>{setBusy(true);try{setJob(await academicApi(token,`/api/campaigns/${campaign.id}/deletions/${job.jobId}/retry`,'POST'));}catch(error){reportError(error);}finally{setBusy(false);}}}>Thử lại xóa tệp</Button>}</div>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{admin&&<th className="p-3"><input aria-label="Chọn sinh viên trên trang" type="checkbox" disabled={!page||busy} checked={!!page?.items.length&&page.items.every(e=>selected.includes(e.id))} onChange={event=>setSelected(event.target.checked?page!.items.map(e=>e.id):[])}/></th>}{['Sinh viên','Học phần/lớp','Đề tài','GVHD/Đồng HD','GVNX','Bài nộp'].map(label=><th key={label} className="whitespace-nowrap p-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{page?.items.map(e=>{const draft=drafts[e.id],v=e.versions.at(-1)!,topic=draft?.patch.topic;return <tr key={e.id} id={'project-row-'+e.id} className={draft?.error?'bg-rose-50':draft?'bg-amber-50/50':query.get('enrollmentId')===e.id?'bg-blue-50':''}>
      {admin&&<td className="p-3 align-top"><input aria-label={`Chọn ${e.studentId} ${e.classCode}`} type="checkbox" checked={selected.includes(e.id)} disabled={busy} onChange={event=>setSelected(old=>event.target.checked?[...old,e.id]:old.filter(id=>id!==e.id))}/></td>}
      <td className="min-w-44 p-3 align-top"><strong>{e.name}</strong><p className="mt-1 text-slate-500">{e.studentId}</p><a className="text-slate-500 break-all" href={'mailto:'+e.email}>{e.email}</a>{!admin&&<p className="mt-1 text-[#034ea1]">{e.myAssignment.map(r=>r==='primary'?'GVHD':r==='reviewer'?'GVNX':'Đồng HD').join(', ')}</p>}{draft&&<p className="mt-2 text-amber-700">Chưa lưu</p>}{draft?.error&&!['topic','assignments','review'].some(part=>isEditing(e.id,part))&&<p role="alert" className="mt-2 text-rose-700">{draft.error}</p>}</td>
      <td className="min-w-24 p-3 align-top">{e.courseCode}<p className="text-slate-500 mt-1">{e.classCode}</p></td>
      <td className="min-w-64 max-w-sm p-3 align-top space-y-2">{isEditing(e.id,'topic')&&e.topicPermissions?.canEdit?<fieldset disabled={busy}><textarea aria-invalid={draft?.errorField==='topic'} aria-label={`Đề tài ${e.studentId}`} className={academicInput} value={topic?.title??e.topic} maxLength={1500} onChange={ev=>mutate(e,'topic',{...topic,title:ev.target.value})}/>{admin&&!e.myAssignment.includes('primary')&&<input aria-label={`Lý do đề tài ${e.studentId}`} className={academicInput} placeholder="Lý do điều chỉnh" value={topic?.reason||''} onChange={ev=>mutate(e,'topic',{title:topic?.title??e.topic,...topic,reason:ev.target.value})}/>}</fieldset>:<p className="whitespace-pre-wrap break-words">{topic?.title??(e.topic||'Chưa khai đề tài')}</p>}<RecordBadge tone={e.topicReview?.status==='approved'?'success':'warning'}>{TOPIC_STATUS_NAMES[e.topicReview?.status||'unregistered']}</RecordBadge>{e.topicReview?.source==='legacy'&&<p>Công nhận dữ liệu cũ</p>}{e.topicPermissions?.canEdit&&(isEditing(e.id,'topic')?rowActions(e,'topic'):<button type="button" className="text-[#034ea1] underline disabled:opacity-50" disabled={busy} onClick={()=>start(e,'topic')}>{e.myAssignment.includes('primary')?'Sửa và duyệt':'Sửa đề tài'}</button>)}{e.topicPermissions?.canApprove&&<Button size="sm" disabled={busy} onClick={()=>mutate(e,'topic',{...topic,approve:true})}>{topic?.approve?'Chờ lưu duyệt':'Duyệt đề tài'}</Button>}{topic?.approve&&!isEditing(e.id,'topic')&&rowActions(e,'topic')}{e.topicPermissions?.requiresResubmission&&<p className="text-amber-700">Cần nộp lại theo đề tài mới</p>}{e.topicSubmissionUntil&&<p className="text-slate-500">Nộp bổ sung đến {new Date(e.topicSubmissionUntil).toLocaleString('vi-VN')}</p>}</td>
      <td className="min-w-48 p-3 align-top space-y-2">{isEditing(e.id,'assignments')&&admin?assignmentFields(e):<><p>{names(e,'primary')}</p><p className="text-slate-500">Đồng HD: {(draft?.patch.assignments||e.assignments).some(a=>a.role==='co')?names(e,'co'):'—'}</p></>}{e.advisorChangeRequest?.status==='pending'&&(
        <div className="pt-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={()=>{setReviewingAdvisorChange(e);setReviewComment('');setReviewError('');}}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition-colors cursor-pointer shadow-2xs"
            title="Nhấn để xem chi tiết và duyệt yêu cầu đổi GVHD"
          >
            <span>Xin đổi GVHD</span>
            <span className="text-[10px] text-[#034ea1] underline ml-0.5 font-normal">Duyệt ngay &rarr;</span>
          </button>
        </div>
      )}{admin&&writable&&!e.submissionLockedAt&&!e.lockedAt&&(isEditing(e.id,'assignments')?rowActions(e,'assignments'):<button type="button" className="text-[#034ea1] underline disabled:opacity-50" disabled={busy} aria-label={`Sửa phân công ${e.studentId}`} onClick={()=>start(e,'assignments')}>Sửa phân công</button>)}</td>
      <td className="min-w-32 p-3 align-top">{names(e,'reviewer')}</td>
      <td className="min-w-40 p-3 align-top space-y-2"><RecordBadge tone={e.needsRevision||e.topicPermissions?.requiresResubmission?'warning':v.state==='submitted'?'success':'neutral'}>{e.needsRevision||e.topicPermissions?.requiresResubmission?'Cần nộp lại':v.state==='submitted'?'Đã nộp':'Chưa nộp đủ'}</RecordBadge>{v.objectKey&&<button className="block text-[#034ea1] underline" onClick={()=>setPdf(e.id)}>Xem PDF</button>}<div className="flex gap-3">{v.slidesUrl&&<a href={v.slidesUrl} target="_blank" rel="noreferrer" className="text-[#034ea1] underline">Slide ↗</a>}{v.demoUrl&&<a href={v.demoUrl} target="_blank" rel="noreferrer" className="text-[#034ea1] underline">Video ↗</a>}</div>{writable&&!e.lockedAt&&(admin||e.myAssignment.some(r=>r!=='co'))&&<details open={isEditing(e.id,'review')}><summary className="cursor-pointer text-[#034ea1]" onClick={ev=>{ev.preventDefault();if(!busy)toggle(e.id,'review');}}>Yêu cầu sửa bài</summary><fieldset disabled={busy} className="mt-2 space-y-2"><label className="flex gap-1 my-2"><input type="checkbox" checked={draft?.patch.review?.needsRevision??e.needsRevision} onChange={ev=>mutate(e,'review',{needsRevision:ev.target.checked,comment:draft?.patch.review?.comment??e.reviewComment})}/>Cần sửa</label><textarea className={academicInput} aria-invalid={draft?.errorField==='review'} placeholder="Nội dung cần sửa và hướng dẫn cho sinh viên…" rows={3} aria-label={`Yêu cầu sửa ${e.studentId}`} value={draft?.patch.review?.comment??e.reviewComment} onChange={ev=>mutate(e,'review',{needsRevision:draft?.patch.review?.needsRevision??e.needsRevision,comment:ev.target.value})}/></fieldset>{rowActions(e,'review')}</details>}</td>
    </tr>;})}</tbody></table></div>{!page?<p role="status" className="p-8 text-center text-sm text-slate-500">Đang tải danh sách…</p>:!page.items.length?<p className="p-8 text-center text-slate-500">Không có sinh viên trong bộ lọc.</p>:null}<div className="border-t p-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{page?`${page.total} lần học · ${page.studentCount} sinh viên`:'Đang tải…'}</span><div className="flex items-center gap-2"><Button size="sm" disabled={!page||page.page<=1||busy} onClick={()=>editQuery({page:String(page!.page-1),enrollmentId:'',panel:''})}>Trước</Button><span>{page?.page||1}/{page?.totalPages||1}</span><Button size="sm" disabled={!page||page.page>=page.totalPages||busy} onClick={()=>editQuery({page:String(page!.page+1),enrollmentId:'',panel:''})}>Sau</Button></div></div></div>
    {adding&&<Suspense fallback={<p role="status">Đang mở form…</p>}><AddStudent token={token} close={()=>setAdding(false)} onAdded={async()=>{setAdding(false);await refresh();setMessageError(false);setMessage('Đã thêm sinh viên vào lớp.');}}/></Suspense>}
    {pdf&&<Suspense fallback={<p role="status">Đang mở báo cáo…</p>}><PdfDialog key={pdf} token={token} id={pdf} close={()=>{setPdf('');if(query.get('panel')==='reports')editQuery({enrollmentId:'',panel:''});}}/></Suspense>}
    {deletion&&<EnrollmentDialog busy={busy} title="Xóa khỏi danh sách" close={()=>{if(!busy)setDeletion(null);}}><form className="space-y-4" onSubmit={async event=>{event.preventDefault();setBusy(true);try{const result=await academicApi(token,`/api/campaigns/${campaign.id}/deletions/${deletion.id}/apply`,'POST',{reason});setJob(result);setDeletion(null);setSelected([]);await refresh();}catch(e){reportError(e);}finally{setBusy(false);}}}><p className="text-sm text-rose-700">Xóa hẳn lần học, đề tài, phân công, điểm, bài nộp và chat riêng. Giữ tài khoản, các lần học khác và chat nhóm.</p><div className="max-h-80 overflow-auto"><table className="text-xs w-full"><thead><tr>{['Sinh viên','Lớp','Phiên bản','Điểm','Tệp','Chat riêng'].map(x=><th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>{deletion.rows.map(r=><tr key={r.enrollmentId}><td className="p-2">{r.studentId} · {r.name}</td><td>{r.classCode}</td><td>{r.versions}</td><td>{r.evaluations}</td><td>{r.files}</td><td>{r.privateMessages}</td></tr>)}</tbody></table></div><FormField label="Lý do xóa" required><textarea className={academicInput} value={reason} onChange={ev=>setReason(ev.target.value)} required/></FormField><div className="flex gap-2"><Button disabled={busy} onClick={()=>setDeletion(null)}>Hủy</Button><Button type="submit" variant="danger" disabled={busy}>Xác nhận xóa vĩnh viễn</Button></div></form></EnrollmentDialog>}
    {reviewingAdvisorChange && (() => {
      const e = reviewingAdvisorChange;
      const req = e.advisorChangeRequest;
      const currentLecturer = meta.lecturers.find(l => l.id === req?.currentLecturerId);
      const targetLecturer = meta.lecturers.find(l => l.id === req?.targetLecturerId);
      return (
        <EnrollmentDialog
          busy={reviewBusy}
          title="Duyệt yêu cầu thay đổi Giảng viên hướng dẫn"
          close={() => {
            if (!reviewBusy) {
              setReviewingAdvisorChange(null);
              setReviewComment('');
              setReviewError('');
            }
          }}
        >
          <div className="space-y-4 text-xs">
            {reviewError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-center gap-2">
                <AlertCircle size={16} className="text-rose-600 shrink-0" />
                <span>{reviewError}</span>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900">{e.name}</span>
                <span className="font-mono text-slate-500 font-semibold">{e.studentId}</span>
              </div>
              <div className="text-slate-600">
                <span>Học phần: <strong>{e.courseCode}</strong></span>
                <span className="mx-1.5 text-slate-300">·</span>
                <span>Lớp: <strong>{e.classCode}</strong></span>
                {e.email && (
                  <>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="font-mono text-slate-500">{e.email}</span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-slate-500 block text-[11px] mb-1">Giảng viên hướng dẫn hiện tại:</span>
                <strong className="text-slate-900 text-sm block">{currentLecturer?.name || 'Chưa phân công'}</strong>
                <span className="text-slate-500 text-[11px] block">{currentLecturer?.work_unit || currentLecturer?.email}</span>
              </div>
              <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/50">
                <span className="text-[#034ea1] block text-[11px] font-semibold mb-1">Giảng viên mới đề xuất chuyển sang:</span>
                <strong className="text-slate-900 text-sm block">{targetLecturer?.name || 'Chưa rõ'}</strong>
                <span className="text-slate-600 text-[11px] block">{targetLecturer?.work_unit || targetLecturer?.email}</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-amber-900">Lý do từ sinh viên:</span>
                {req?.createdAt && (
                  <span className="text-[11px] text-amber-700">
                    Gửi lúc: {new Date(req.createdAt).toLocaleString('vi-VN')}
                  </span>
                )}
              </div>
              <p className="italic text-slate-800 whitespace-pre-wrap">{req?.reason || '(Không có lý do)'}</p>
            </div>

            <FormField
              label="Ý kiến / Phản hồi của người duyệt (tùy chọn khi duyệt, nên có khi từ chối)"
            >
              <textarea
                className={academicInput}
                rows={3}
                placeholder="Nhập ý kiến phản hồi gửi cho sinh viên và các giảng viên liên quan..."
                value={reviewComment}
                onChange={ev => setReviewComment(ev.target.value)}
                disabled={reviewBusy}
              />
            </FormField>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <Button
                size="sm"
                variant="secondary"
                disabled={reviewBusy}
                onClick={() => {
                  setReviewingAdvisorChange(null);
                  setReviewComment('');
                  setReviewError('');
                }}
              >
                Đóng
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={reviewBusy}
                  onClick={() => handleReviewAdvisorChange('rejected')}
                >
                  {reviewBusy ? 'Đang xử lý...' : 'Từ chối yêu cầu'}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={reviewBusy}
                  onClick={() => handleReviewAdvisorChange('approved')}
                >
                  {reviewBusy ? 'Đang xử lý...' : '✓ Đồng ý đổi GVHD'}
                </Button>
              </div>
            </div>
          </div>
        </EnrollmentDialog>
      );
    })()}
    {showQueueDialog && (
      <EnrollmentDialog
        busy={bulkBusy}
        title="Duyệt tập trung yêu cầu thay đổi Giảng viên hướng dẫn"
        close={() => {
          if (!bulkBusy) {
            setShowQueueDialog(false);
            setBulkReviewComment('');
            setQueueError('');
          }
        }}
      >
        <div className="space-y-4 text-xs">
          {queueError && (
            <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{queueError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">
                Tổng số đơn chờ duyệt: <strong className="text-amber-800">{queueItems.length}</strong>
              </span>
              {selectedQueueIds.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-[#034ea1] font-medium text-[11px]">
                  Đã chọn: {selectedQueueIds.length}/{queueItems.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Tìm MSSV, tên SV, giảng viên..."
                className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                value={queueSearch}
                onChange={e => setQueueSearch(e.target.value)}
              />
              <Button size="sm" variant="secondary" disabled={queueLoading || bulkBusy} onClick={loadQueue}>
                {queueLoading ? 'Đang tải...' : 'Làm mới'}
              </Button>
            </div>
          </div>

          {queueLoading ? (
            <p className="p-8 text-center text-slate-500">Đang tải danh sách yêu cầu chờ duyệt...</p>
          ) : filteredQueueItems.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-500">
              {queueItems.length === 0
                ? 'Hiện tại không có yêu cầu thay đổi GVHD nào đang chờ duyệt trong học kỳ này.'
                : 'Không có yêu cầu nào khớp với tìm kiếm.'}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={filteredQueueItems.length > 0 && filteredQueueItems.every(i => selectedQueueIds.includes(i.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            const newIds = new Set([...selectedQueueIds, ...filteredQueueItems.map(i => i.id)]);
                            setSelectedQueueIds(Array.from(newIds));
                          } else {
                            const toRemove = new Set(filteredQueueItems.map(i => i.id));
                            setSelectedQueueIds(selectedQueueIds.filter(id => !toRemove.has(id)));
                          }
                        }}
                      />
                    </th>
                    <th className="p-2.5 font-semibold">Sinh viên</th>
                    <th className="p-2.5 font-semibold">GVHD hiện tại &rarr; GVHD mới</th>
                    <th className="p-2.5 font-semibold">Lý do & Ngày gửi</th>
                    <th className="p-2.5 font-semibold text-right">Xử lý nhanh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredQueueItems.map(item => {
                    const req = item.advisorChangeRequest;
                    const curLecturer = meta.lecturers.find(l => l.id === req?.currentLecturerId);
                    const tgtLecturer = meta.lecturers.find(l => l.id === req?.targetLecturerId);
                    const isChecked = selectedQueueIds.includes(item.id);
                    return (
                      <tr key={item.id} className={isChecked ? 'bg-blue-50/40' : 'hover:bg-slate-50'}>
                        <td className="p-2.5 text-center align-top">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              setSelectedQueueIds(
                                e.target.checked
                                  ? [...selectedQueueIds, item.id]
                                  : selectedQueueIds.filter(id => id !== item.id)
                              );
                            }}
                          />
                        </td>
                        <td className="p-2.5 align-top min-w-36">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="text-slate-500 font-mono text-[11px]">{item.studentId}</div>
                          <div className="text-slate-400 text-[11px]">{item.classCode}</div>
                        </td>
                        <td className="p-2.5 align-top min-w-48">
                          <div className="text-slate-700">
                            <span className="text-slate-400">Từ: </span>
                            <span className="font-medium">{curLecturer?.name || 'Chưa phân công'}</span>
                          </div>
                          <div className="text-[#034ea1] font-semibold mt-0.5">
                            <span className="text-slate-400 font-normal">Sang: </span>
                            {tgtLecturer?.name || 'Chưa rõ'}
                          </div>
                          {tgtLecturer?.work_unit && (
                            <div className="text-slate-400 text-[10px]">{tgtLecturer.work_unit}</div>
                          )}
                        </td>
                        <td className="p-2.5 align-top max-w-xs">
                          <div className="text-slate-800 italic line-clamp-3 bg-amber-50/60 p-1.5 rounded border border-amber-200/60 text-[11px]">
                            {req?.reason || '(Không có lý do)'}
                          </div>
                          {req?.createdAt && (
                            <div className="text-[10px] text-slate-400 mt-1">
                              {new Date(req.createdAt).toLocaleString('vi-VN')}
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 align-top text-right space-x-1 whitespace-nowrap">
                          <button
                            type="button"
                            disabled={bulkBusy}
                            onClick={() => handleBulkReview('approved', item)}
                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] transition-colors"
                            title="Duyệt đơn này"
                          >
                            ✓ Duyệt
                          </button>
                          <button
                            type="button"
                            disabled={bulkBusy}
                            onClick={() => handleBulkReview('rejected', item)}
                            className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] transition-colors"
                            title="Từ chối đơn này"
                          >
                            ✕ Từ chối
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {queueItems.length > 0 && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <FormField label="Ý kiến / Lý do phản hồi chung (áp dụng cho các đơn được chọn)">
                <textarea
                  className={academicInput}
                  rows={2}
                  placeholder="Ghi chú phản hồi gửi cho sinh viên và các giảng viên liên quan (tùy chọn khi duyệt, nên có khi từ chối)..."
                  value={bulkReviewComment}
                  onChange={e => setBulkReviewComment(e.target.value)}
                  disabled={bulkBusy}
                />
              </FormField>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <span className="text-xs text-slate-500">
                  Thao tác hàng loạt trên <strong>{selectedQueueIds.length}</strong> đơn đã chọn
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={bulkBusy || selectedQueueIds.length === 0}
                    onClick={() => handleBulkReview('rejected')}
                  >
                    {bulkBusy ? 'Đang xử lý...' : `✕ Từ chối (${selectedQueueIds.length})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={bulkBusy || selectedQueueIds.length === 0}
                    onClick={() => handleBulkReview('approved')}
                  >
                    {bulkBusy ? 'Đang xử lý...' : `✓ Duyệt các đơn đã chọn (${selectedQueueIds.length})`}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => {
                setShowQueueDialog(false);
                setBulkReviewComment('');
                setQueueError('');
              }}
            >
              Đóng
            </Button>
          </div>
        </div>
      </EnrollmentDialog>
    )}
    {dialog}
  </section>;
}
