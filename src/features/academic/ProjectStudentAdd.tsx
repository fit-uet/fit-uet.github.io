import {useEffect,useRef,useState} from 'react';
import {Button,FormField} from '../../shared/ui';
import {academicApi} from './client';
import {academicInput} from './form';
import {EnrollmentDialog} from './EnrollmentDialog';
import {useCampaignLayout} from './CampaignLayoutContext';
type Lookup={revision:number;found:boolean;student:{name:string;dob:string;className:string;email:string}|null;enrollments:{id:string;classId:string}[]};
export function ProjectStudentAdd({token,close,onAdded}:{token:string;close:()=>void;onAdded:()=>Promise<void>}){
 const {meta,query}=useCampaignLayout()!;
 const [studentId,setStudentId]=useState(''),[name,setName]=useState(''),[dob,setDob]=useState(''),[className,setClassName]=useState(''),[classId,setClassId]=useState(query.get('classId')||''),[lookup,setLookup]=useState<Lookup|null>(null),[lookupId,setLookupId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const active=useRef(studentId);active.current=studentId;
 useEffect(()=>{
  setLookup(null);setLookupId('');setError('');setLoading(false);
  if(!/^\d{8}$/.test(studentId))return;
  const controller=new AbortController();setLoading(true);
  const timer=setTimeout(()=>academicApi<Lookup>(token,`/api/admin/campaigns/${meta.campaign.id}/student-lookup?studentId=${studentId}`,'GET',undefined,controller.signal,{forceRefresh:true})
   .then(result=>{if(controller.signal.aborted||active.current!==studentId)return;setLookup(result);setLookupId(studentId);if(result.student){setName(result.student.name);setDob(result.student.dob);setClassName(result.student.className);}})
   .catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[studentId,token,meta.campaign.id,retry]);
 const duplicate=lookup?.enrollments.some(e=>e.classId===classId),ready=!!lookup&&lookupId===studentId&&!loading;
 return <EnrollmentDialog title="Thêm sinh viên vào lớp" close={()=>{if(!busy)close();}}><form className="space-y-4" onSubmit={async ev=>{
  ev.preventDefault();if(!ready||duplicate)return;setBusy(true);setError('');
  try{await academicApi(token,`/api/admin/campaigns/${meta.campaign.id}/enrollments`,'POST',{expectedRevision:lookup.revision,classId,studentId,name,dob,className});await onAdded();}
  catch(e){setError(e.message);if(['REVISION_CONFLICT','STALE_PREVIEW'].includes(e.data?.error?.code))setRetry(r=>r+1);}
  finally{setBusy(false);}
 }}>
  <fieldset disabled={busy} className="space-y-4">
   <FormField label="MSSV" required><input autoFocus className={academicInput} aria-label="MSSV" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required value={studentId} onChange={e=>{setStudentId(e.target.value.trim());setName('');setDob('');setClassName('');}}/></FormField>
   <p className="text-xs text-slate-500">Email VNU: {/^\d{8}$/.test(studentId)?`${studentId}@vnu.edu.vn`:'Nhập đủ 8 chữ số MSSV'}</p>
   {loading&&<p role="status">Đang tra cứu sinh viên…</p>}
   {ready&&<><p className="text-sm text-[#034ea1]">{lookup.found?'Đã có trong danh mục; giữ nguyên thông tin tài khoản.':'Sinh viên mới; tài khoản và lần học sẽ được tạo cùng lúc.'}</p>
    <FormField label="Họ tên" required><input className={academicInput} aria-label="Họ tên" required maxLength={200} readOnly={lookup.found} value={name} onChange={e=>setName(e.target.value)}/></FormField>
    <div className="grid gap-3 sm:grid-cols-2"><FormField label="Ngày sinh"><input className={academicInput} aria-label="Ngày sinh" type={lookup.found?'text':'date'} readOnly={lookup.found} value={dob} onChange={e=>setDob(e.target.value)}/></FormField><FormField label="Lớp khóa học"><input className={academicInput} aria-label="Lớp khóa học" maxLength={200} readOnly={lookup.found} value={className} onChange={e=>setClassName(e.target.value)}/></FormField></div>
   </>}
   <FormField label="Lớp học phần" required><select className={academicInput} aria-label="Lớp học phần thêm sinh viên" required value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Chọn lớp</option>{meta.classes.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></FormField>
   {duplicate&&<p role="alert" className="text-sm text-rose-700">Sinh viên đã có trong lớp này. Chọn lớp khác nếu đăng ký học phần khác.</p>}
   <p className="text-xs text-slate-500">Hồ sơ mới chưa có đề tài, phân công hoặc bài nộp. Khoa phân công giảng viên sau khi thêm.</p>
  </fieldset>
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
  <div className="flex justify-end gap-2"><Button disabled={busy} onClick={close}>Hủy</Button><Button type="submit" variant="primary" disabled={busy||!ready||!!duplicate}>{busy?'Đang thêm…':'Thêm sinh viên'}</Button></div>
 </form></EnrollmentDialog>;
}
