import { useEffect, useState } from 'react';
import { Download, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import type { SubmissionVersion } from '../../shared/academic';
import { academicPdf, academicDownload } from './client';

export function PdfView({ token, enrollmentId, version }: { token: string; enrollmentId: string; version: SubmissionVersion }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUrl('');
    setError('');
    if (!version.objectKey) return;
    const abort = new AbortController();
    academicPdf(token, enrollmentId, version.id, abort.signal)
      .then(setUrl)
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => abort.abort();
  }, [token, enrollmentId, version.id]);

  if (!version.objectKey) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200/90 bg-[#f8fafc]/60 p-10 sm:p-12 text-center flex flex-col items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 shadow-2xs">
          <FileText size={24} />
        </div>
        <h4 className="text-sm font-bold text-slate-700">Chưa có báo cáo PDF</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
          Phiên bản này chưa được đính kèm tệp PDF. Sinh viên hãy chọn tệp PDF báo cáo và nhấn "Xác nhận nộp bài" ở biểu mẫu phía trên.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#f8fafc] border border-slate-200/70 rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100 font-bold text-[10px]">
            PDF
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-800 truncate">{version.filename || 'Bao_cao_du_an.pdf'}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{(version.size / 1024 / 1024).toFixed(2)} MB · Phiên bản {version.number}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => academicDownload(token, `/api/enrollments/${enrollmentId}/submissions/${version.id}/download`, version.filename || 'report.pdf').catch(e => setError(e.message))}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold shadow-2xs transition-all cursor-pointer active:scale-[0.98]"
        >
          <Download size={13} className="text-[#034ea1]" /> Tải file PDF
        </button>
      </div>

      {error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800">
          <AlertCircle size={16} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      ) : url ? (
        <div className="rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs bg-white">
          <iframe
            title={`Báo cáo ${version.filename}`}
            src={url}
            className="w-full h-[68vh] min-h-[500px] border-0"
          />
        </div>
      ) : (
        <div className="p-12 text-center text-slate-500 rounded-2xl border border-slate-200/70 bg-[#f8fafc] flex flex-col items-center justify-center">
          <RefreshCw size={20} className="animate-spin text-[#034ea1] mb-2" />
          <span className="text-xs font-medium">Đang tải bản xem trước PDF...</span>
        </div>
      )}
    </div>
  );
}
