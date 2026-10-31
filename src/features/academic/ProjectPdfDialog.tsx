import {useEffect,useState} from 'react';
import type {EnrollmentView} from '../../shared/academic';
import {academicApi} from './client';
import {EnrollmentDialog} from './EnrollmentDialog';
import {PdfView} from './PdfView';
export function ProjectPdfDialog({token,id,close}:{token:string;id:string;close:()=>void}){
  const [data,setData]=useState<EnrollmentView|null>(null),[version,setVersion]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const a=new AbortController();academicApi<EnrollmentView>(token,`/api/enrollments/${id}`,'GET',undefined,a.signal).then(e=>{setData(e);setVersion(e.versions.at(-1)!.id);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>a.abort();},[token,id]);
  const v=data?.versions.find(v=>v.id===version);
  return <EnrollmentDialog title="Báo cáo" close={close}>{error?<p role="alert">{error}</p>:!data||!v?<p role="status">Đang tải báo cáo…</p>:<div className="space-y-3"><p className="font-medium">{data.name} · {data.studentId}</p><label className="text-sm">Phiên bản báo cáo <select aria-label="Phiên bản báo cáo" className="border rounded-lg p-2" value={version} onChange={e=>setVersion(e.target.value)}>{[...data.versions].reverse().map(v=><option key={v.id} value={v.id}>Phiên bản {v.number}{v.id===data.versions.at(-1)!.id?' · Hiện hành':''}</option>)}</select></label><p className="text-sm">{v.title}</p><PdfView token={token} enrollmentId={id} version={v}/></div>}</EnrollmentDialog>;
}
