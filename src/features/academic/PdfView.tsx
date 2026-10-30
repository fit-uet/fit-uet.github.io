import {useEffect,useState} from 'react';
import {Button} from '../../shared/ui';
import type {SubmissionVersion} from '../../shared/academic';
import {academicPdf,academicDownload} from './client';
export function PdfView({ token, enrollmentId, version }: { token: string; enrollmentId: string; version: SubmissionVersion }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  useEffect(() => {
    setUrl(''); setError(''); if (!version.objectKey) return;
    const abort = new AbortController();
    academicPdf(token, enrollmentId, version.id, abort.signal).then(setUrl).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => abort.abort();
  }, [token, enrollmentId, version.id]);
  if (!version.objectKey) return <div className="p-12 text-center text-slate-500 border border-dashed rounded-lg">Chưa có báo cáo PDF.</div>;
  return <div className="space-y-2"><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{version.filename} · {(version.size / 1024 / 1024).toFixed(2)} MB</span><Button size="sm" onClick={() => academicDownload(token, `/api/enrollments/${enrollmentId}/submissions/${version.id}/download`, version.filename || 'report.pdf').catch(e => setError(e.message))}>Tải PDF</Button></div>{error ? <p role="alert" className="text-rose-700 text-sm">{error}</p> : url ? <iframe title={`Báo cáo ${version.filename}`} src={url} className="w-full h-[65vh] rounded-lg border border-slate-200 bg-slate-50" /> : <div className="p-12 text-center text-slate-500">Đang tải PDF…</div>}</div>;
}
