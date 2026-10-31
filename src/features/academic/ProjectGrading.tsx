import {useEffect,useRef,useState} from 'react';
import {Button,FormField} from '../../shared/ui';
import type {EnrollmentView} from '../../shared/academic';
import {academicApi,academicDownload} from './client';
import {academicInput} from './form';
import {CampaignToolbarActions,useCampaignLayout} from './CampaignLayoutContext';
import {gradeNames,lecturerNames,projectVersionResult,type CampaignRecordPage} from './campaignPresentation';
import {RecordBadge} from './CampaignRecords';
import {PdfView} from './PdfView';
import {useProjectNavigationGuard} from './useProjectNavigationGuard';

export function ProjectGrading({token,page,refresh}:{token:string;page:CampaignRecordPage|null;refresh:()=>Promise<void>}){
 const {meta,query,editQuery,actor}=useCampaignLayout()!;
 const [error,setError]=useState('');
 const selected=query.get('enrollmentId')||'';
 const exportFile=()=>{const filters=new URLSearchParams(query);for(const k of ['tab','view','page','enrollmentId','panel'])filters.delete(k);academicDownload(token,`/api/campaigns/${meta.campaign.id}/exports/grades.xlsx?${filters}`,'bang-diem-du-an.xlsx').catch(e=>setError(e.message));};
 const select=(id:string,pageNumber=page?.page||1)=>editQuery({enrollmentId:id,panel:'grades',page:String(pageNumber)});
 const move=async(direction:number)=>{
  if(!page)return;const index=page.items.findIndex(e=>e.id===selected),next=page.items[index+direction];
  if(next){select(next.id);return;}
  const target=page.page+direction;if(target<1||target>page.totalPages)return;
  const filters=new URLSearchParams(query);for(const k of ['tab','view','enrollmentId','panel'])filters.delete(k);filters.set('page',String(target));filters.set('projection','grades');
  if(query.get('view')==='lecturer')filters.set('lecturerId',String(meta.lecturers.find(l=>l.email.toLowerCase()===actor.email.toLowerCase())?.id||-1));
  const rows=await academicApi<CampaignRecordPage>(token,`/api/campaigns/${meta.campaign.id}/enrollments?${filters}`,'GET',undefined,undefined,{scope:`${actor.id}:${actor.role}:${meta.campaign.id}`});
  const row=direction>0?rows.items[0]:rows.items.at(-1);if(row)select(row.id,target);
 };
 const index=page?.items.findIndex(e=>e.id===selected)??-1;
 return <section aria-label="Chấm điểm Dự án" className="space-y-4">
  <CampaignToolbarActions><Button size="sm" onClick={exportFile}>Xuất bảng điểm XLSX</Button></CampaignToolbarActions>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  {selected?<ProjectGradingEditor key={`${meta.campaign.id}:${actor.role}:${selected}`} token={token} id={selected} rowRevision={page?.items.find(e=>e.id===selected)?.revision} refresh={refresh}
    previous={!!page&&(index>0||page.page>1)} next={!!page&&(index>=0&&index<page.items.length-1||page.page<page.totalPages)} move={move} close={()=>editQuery({enrollmentId:'',panel:''})}/>:<>
   {page?.gradingSummary&&<div aria-label="Tiến độ chấm điểm" className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">{[['GVHD đã nộp',page.gradingSummary.advisorSubmitted],['GVNX đã nộp',page.gradingSummary.reviewerSubmitted],['Đủ hai phần điểm',page.gradingSummary.completed],['Đã khóa',page.gradingSummary.locked]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-slate-500">{label}</p><strong className="block text-lg mt-1">{value} / {page.total}</strong></div>)}</div>}
   <p className="text-xs text-slate-500">Chọn sinh viên để xem báo cáo và đánh giá. GVHD 60% · GVNX 40%.</p>
   <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Sinh viên','Học phần/lớp','Bài nộp','GVHD / GVNX','Điểm GVHD — 60%','Điểm GVNX — 40%','Tổng kết'].map(label=><th key={label} className="whitespace-nowrap p-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{page?.items.map(e=>{
    const pair=e.evaluations?.[e.versions.at(-1)!.id]||{},v=e.versions.at(-1)!;
    return <tr key={e.id} id={'project-grade-row-'+e.id} className="hover:bg-blue-50/30"><td className="min-w-40 p-3 align-top"><button type="button" className="font-semibold text-[#034ea1] underline text-left" onClick={()=>select(e.id)}>{e.name}</button><p className="text-slate-500 mt-1">{e.studentId}</p>{actor.role!=='admin'&&<p className="text-slate-500">{e.myAssignment.map(r=>r==='primary'?'GVHD':r==='reviewer'?'GVNX':'Đồng HD · Chỉ xem bài').join(', ')}</p>}</td>
     <td className="p-3 align-top whitespace-nowrap">{e.courseCode}<p className="text-slate-500">{e.classCode}</p></td>
     <td className="p-3 align-top"><RecordBadge tone={e.topicPermissions?.requiresResubmission||e.needsRevision?'warning':v.state==='submitted'?'success':'neutral'}>{e.topicPermissions?.requiresResubmission||e.needsRevision?'Cần nộp lại':v.state==='submitted'?'Đã nộp':'Chưa nộp đủ'}</RecordBadge></td>
     <td className="min-w-40 p-3 align-top"><p>{lecturerNames(e,meta.lecturers,'primary')}</p><p className="text-slate-500 mt-1">GVNX: {lecturerNames(e,meta.lecturers,'reviewer')}</p></td>
     <td className="p-3 align-top">{e.canSeeGrades?(pair.advisor?.score?.toFixed(1)??'—'):'—'}</td><td className="p-3 align-top">{e.canSeeGrades?(pair.reviewer?.score?.toFixed(1)??'—'):'—'}</td><td className="p-3 align-top"><strong>{e.canSeeGrades?(e.finalScore?.toFixed(1)??'—'):'—'}</strong>{e.canSeeGrades&&<p className="text-slate-500 mt-1">{gradeNames[e.gradeStatus]}</p>}</td>
    </tr>;
   })}</tbody></table></div>{!page?<p role="status" className="p-8 text-center">Đang tải bảng điểm…</p>:!page.items.length?<p className="p-8 text-center">Không có sinh viên trong bộ lọc.</p>:null}
    <div className="border-t p-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{page?`${page.total} lần học · ${page.studentCount} sinh viên`:'Đang tải…'}</span><div className="flex items-center gap-2"><Button size="sm" disabled={!page||page.page<=1} onClick={()=>editQuery({page:String(page!.page-1)})}>Trước</Button><span>{page?.page||1}/{page?.totalPages||1}</span><Button size="sm" disabled={!page||page.page>=page.totalPages} onClick={()=>editQuery({page:String(page!.page+1)})}>Sau</Button></div></div>
   </div>
  </>}
 </section>;
}

function ProjectGradingEditor({token,id,rowRevision,refresh,previous,next,move,close}:{token:string;id:string;rowRevision?:number;refresh:()=>Promise<void>;previous:boolean;next:boolean;move:(direction:number)=>Promise<void>;close:()=>void}){
 const {meta,actor}=useCampaignLayout()!;
 const [desktop,setDesktop]=useState(()=>window.matchMedia('(min-width: 1024px)').matches);
 useEffect(()=>{const media=window.matchMedia('(min-width: 1024px)'),change=()=>setDesktop(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const [data,setData]=useState<EnrollmentView|null>(null),[viewed,setViewed]=useState(''),[score,setScore]=useState(''),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mobile,setMobile]=useState<'report'|'grade'>('grade'),[reload,setReload]=useState(0),[stale,setStale]=useState(false);
 const baseline=useRef({score:'',comment:''});const dirty=score!==baseline.current.score||comment!==baseline.current.comment;
 const currentState=useRef({dirty,data});currentState.current={dirty,data};
 const roleFor=(e:EnrollmentView)=>e.myAssignment.includes('primary')?'advisor':e.myAssignment.includes('reviewer')?'reviewer':null;
 const install=(e:EnrollmentView)=>{
  setData(e);setViewed(e.versions.at(-1)!.id);const role=roleFor(e),evaluation=role?e.evaluations?.[e.versions.at(-1)!.id]?.[role]:null;
  baseline.current={score:evaluation?.score==null?'':String(evaluation.score),comment:evaluation?.comment||''};setScore(baseline.current.score);setComment(baseline.current.comment);setStale(false);
 };
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  academicApi<EnrollmentView>(token,`/api/enrollments/${id}`,'GET',undefined,controller.signal,{scope:`${actor.id}:${actor.role}:${meta.campaign.id}`}).then(e=>{
   if(controller.signal.aborted)return;
   if(currentState.current.dirty){if(e.revision!==currentState.current.data?.revision)setStale(true);return;}
   install(e);
  }).catch(e=>{if(e.name!=='AbortError'){setError(e.message);if(e.status===403||e.status===401)setData(null);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[token,id,rowRevision,reload,actor.id,actor.role,meta.campaign.id]);
 const discard=()=>{setScore(baseline.current.score);setComment(baseline.current.comment);};
 const save=async()=>{
  if(!data||busy||loading||stale)return false;const role=roleFor(data);if(!role)return false;
  if(!dirty)return true;
  if(score===''||!Number.isFinite(Number(score))||Number(score)<0||Number(score)>10){setError('Nhập điểm trong khoảng 0–10.');return false;}
  if(Number(score)===0&&!comment.trim()){setError('Điểm 0 cần nhận xét / lý do.');return false;}
  setBusy(true);setError('');setNotice('');
  try{const result=await academicApi<EnrollmentView>(token,`/api/enrollments/${id}/project-evaluations/${role}`,'PUT',{score:Number(score),comment,submissionVersionId:data.versions.at(-1)!.id,expectedRevision:data.revision});install(result);setNotice('Đã lưu điểm về Khoa.');await refresh();return true;}
  catch(e){setError(e.message);if(['REVISION_CONFLICT','VERSION_CONFLICT','STALE_PREVIEW'].includes(e.data?.error?.code))setStale(true);return false;}finally{setBusy(false);}
 };
 const {dialog,guard,proceed}=useProjectNavigationGuard(dirty||busy,save,discard,'Bạn có điểm hoặc nhận xét chưa lưu cho sinh viên đang chọn.');
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();await refresh();setReload(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const navigate=(direction:number)=>guard(()=>move(direction).catch(e=>setError(e.message)));
 const e=data,c=meta.classes.find(c=>c.id===e?.classId),v=e?.versions.find(v=>v.id===viewed),current=e?.versions.at(-1),role=e?roleFor(e):null;
 const historical=!!v&&v.id!==current?.id;
 const shown:ReturnType<typeof projectVersionResult>=e?projectVersionResult(e,viewed):{pair:{},total:null};
 const writable=meta.campaign.status==='active',inWindow=!!c&&(!c.settings.gradingOpenAt||Date.now()>=Date.parse(c.settings.gradingOpenAt))&&(!c.settings.gradingCloseAt||Date.now()<=Date.parse(c.settings.gradingCloseAt));
 const canGrade=!!e&&!!role&&writable&&inWindow&&!e.lockedAt&&v?.id===current?.id;
 return <div className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><Button size="sm" disabled={busy} onClick={()=>guard(close)}>← Bảng điểm</Button><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!previous||busy||loading} onClick={()=>navigate(-1)}>Sinh viên trước</Button><Button size="sm" disabled={!next||busy||loading} onClick={()=>navigate(1)}>Sinh viên tiếp</Button></div></div>
  {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
  {stale&&<div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Hồ sơ đã thay đổi. Bản nháp được giữ; cần tải lại trước khi chấm.<Button size="sm" onClick={()=>guard(()=>{discard();setReload(n=>n+1);})}>Tải lại hồ sơ</Button></div>}
  {!e||!v||!c?<p role="status">{loading?'Đang tải báo cáo và đánh giá…':'Không tải được hồ sơ được chọn.'}</p>:<>
   <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">{e.name}</h2><p className="text-xs text-slate-500 mt-1">{e.studentId} · {c.code}</p><p className="mt-2 text-sm">{e.topic||'Chưa khai đề tài'}</p></div>
   <div role="tablist" aria-label="Nội dung chấm điểm" className="flex gap-2 lg:hidden">{[['report','Báo cáo'],['grade','Đánh giá']].map(([key,label])=><button key={key} role="tab" aria-selected={mobile===key} className={`rounded-lg border border-slate-200 px-4 py-2 text-sm ${mobile===key?'bg-blue-50 text-[#034ea1]':'bg-white'}`} onClick={()=>setMobile(key as any)}>{label}</button>)}</div>
   <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
    <section aria-label="Báo cáo để chấm" className={`${mobile==='report'?'':'hidden lg:block'} min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-3`}>
     <FormField label="Phiên bản báo cáo"><select aria-label="Phiên bản báo cáo" className={academicInput} value={viewed} onChange={ev=>guard(()=>setViewed(ev.target.value))}>{[...e.versions].reverse().map(v=><option key={v.id} value={v.id}>Phiên bản {v.number}{v.id===current!.id?' · Hiện hành':''}</option>)}</select></FormField>
     {v.id!==current!.id&&<p className="text-sm text-amber-800">Đang xem bản cũ · Chỉ đọc, không được chấm.</p>}
     <p className="text-sm">{v.title||'Chưa có tên trong phiên bản bài'}</p><div className="flex gap-4 text-sm">{v.slidesUrl&&<a className="text-[#034ea1] underline" href={v.slidesUrl} target="_blank" rel="noreferrer">Mở slide ↗</a>}{v.demoUrl&&<a className="text-[#034ea1] underline" href={v.demoUrl} target="_blank" rel="noreferrer">Mở video demo ↗</a>}</div>
     {(mobile==='report'||desktop)&&<PdfView token={token} enrollmentId={e.id} version={v}/>}
    </section>
    <section aria-label="Đánh giá Dự án" className={`${mobile==='grade'?'':'hidden lg:block'} min-w-0 rounded-xl border border-slate-200 bg-white p-4 space-y-4 self-start`}>
     {e.canSeeGrades?<><div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm"><p>GVHD — 60%<strong className="block">{shown.pair.advisor?.score?.toFixed(1)??'—'}</strong></p><p>GVNX — 40%<strong className="block">{shown.pair.reviewer?.score?.toFixed(1)??'—'}</strong></p></div><p className="text-sm">Tổng kết: <strong>{shown.total?.toFixed(1)??'Chưa đủ điểm'}</strong> · {historical?'Lịch sử đánh giá · Chỉ xem':gradeNames[e.gradeStatus]}</p></>:<p className="text-sm text-slate-500">Đồng hướng dẫn chỉ xem bài nộp, không xem hoặc nhập điểm.</p>}
     {e.topicPermissions?.requiresResubmission&&<p className="text-sm text-amber-800">Bài nộp thuộc đề tài cũ; cần nộp lại trước khi chấm điểm khác 0.</p>}
     {role?<form className="space-y-3" onSubmit={ev=>{ev.preventDefault();save();}}>
      <h3 className="font-semibold">Phần {role==='advisor'?'GVHD — 60%':'GVNX — 40%'}</h3>
      {!inWindow&&<p className="text-sm text-amber-800">Chưa đến hoặc đã hết hạn chấm điểm.</p>}{e.lockedAt&&<p className="text-sm text-amber-800">Điểm đã khóa.</p>}
      {!e.topicPermissions?.canGradeSubmitted&&<p className="text-sm text-amber-800">Chưa có bộ bài hợp lệ theo đề tài đã duyệt. Chỉ được nhập 0 kèm lý do.</p>}
      <fieldset disabled={!canGrade||busy||loading||stale} className="space-y-3"><FormField label="Điểm (0–10)" required><input aria-label={`Điểm ${role==='advisor'?'GVHD':'GVNX'}`} className={academicInput} type="number" min="0" max={e.topicPermissions?.canGradeSubmitted?10:0} step="any" required value={historical?shown.pair[role]?.score??'':score} onChange={ev=>setScore(ev.target.value)}/></FormField><FormField label="Nhận xét / lý do"><textarea aria-label="Nhận xét chấm điểm" rows={5} className={academicInput} required={score!==''&&Number(score)===0} value={historical?shown.pair[role]?.comment??'':comment} onChange={ev=>setComment(ev.target.value)}/></FormField></fieldset>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={!canGrade||!dirty||busy||loading||stale}>Lưu điểm</Button><Button disabled={!canGrade||!next||busy||loading||stale} onClick={async()=>{if(await save())proceed(()=>move(1).catch(e=>setError(e.message)));}}>Lưu & tiếp theo</Button><Button disabled={!dirty||busy} onClick={discard}>Hủy thay đổi</Button></div>
     </form>:actor.role==='admin'?<p className="text-sm text-slate-500">Bạn theo dõi kết quả; chỉ giảng viên được phân công mới nhập phần điểm của mình.</p>:null}
     {actor.role==='admin'&&writable&&<details><summary className="cursor-pointer text-sm font-semibold text-[#034ea1]">Khóa điểm / Mở lại bài</summary><fieldset disabled={busy||dirty} className="space-y-3 mt-3"><form className="space-y-2" onSubmit={ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);run(async()=>{await academicApi(token,`/api/admin/enrollments/${e.id}/grade-lock`,'PUT',{expectedRevision:e.revision,locked:!e.lockedAt,reason:f.get('reason')});});}}><input required aria-label="Lý do khóa hoặc mở khóa" name="reason" placeholder="Lý do khóa / mở khóa điểm" className={academicInput}/><Button type="submit" size="sm">{e.lockedAt?'Mở khóa điểm':'Khóa điểm'}</Button></form><form className="space-y-2 border-t pt-3" onSubmit={ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);run(async()=>{await academicApi(token,`/api/admin/enrollments/${e.id}/submission/reopen`,'POST',{expectedRevision:e.revision,submissionUntil:new Date(String(f.get('until'))).toISOString(),reason:f.get('reason')});});}}><p className="text-xs text-amber-800">Mở lại tạo phiên bản bài mới và yêu cầu cả hai giảng viên chấm lại.</p><FormField label="Hạn nộp lại"><input required name="until" aria-label="Hạn nộp lại" type="datetime-local" className={academicInput}/></FormField><input required name="reason" aria-label="Lý do mở lại bài" placeholder="Lý do mở lại" className={academicInput}/><Button type="submit" size="sm" disabled={!!e.lockedAt}>Mở lại bài</Button></form></fieldset>{dirty&&<p className="text-xs text-amber-700">Lưu hoặc hủy điểm đang sửa trước khi thao tác.</p>}</details>}
    </section>
   </div>
  </>}
  {dialog}
 </div>;
}
