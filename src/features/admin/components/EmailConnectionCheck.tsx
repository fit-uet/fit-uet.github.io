import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw, AlertTriangle, Mail } from 'lucide-react';
import { API_BASE } from '../../../shared';
import type { EmailConnectionDiagnostic } from '../../../shared/emailDiagnostics';

export function EmailConnectionCheck({ token }: { token: string }) {
  const [diagnostic, setDiagnostic] = useState<EmailConnectionDiagnostic | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setDiagnostic(null); setError(''); setChecking(false);
    return () => { active.current?.abort(); };
  }, [token]);
  const check = async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setChecking(true); setError(''); setDiagnostic(null);
    try {
      const response = await fetch(`${API_BASE}/api/admin/email/diagnostics`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' : response.status === 403 ? 'Chỉ Khoa được kiểm tra cấu hình email.' : 'Không tải được kết quả kiểm tra kết nối email.');
      const data = await response.json();
      if (typeof data?.status !== 'string' || typeof data?.message !== 'string') throw new Error('Kết quả kiểm tra email không hợp lệ.');
      if (!controller.signal.aborted) setDiagnostic(data);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Không kiểm tra được kết nối email.'); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  };
  const connected = diagnostic?.status === 'connected';
  return <section className="bg-white border border-black/[0.06] rounded-2xl p-5 space-y-3" aria-label="Kết nối email">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold flex items-center gap-2"><Mail size={16} className="text-[#034ea1]" />Kết nối email</h2><p className="text-xs text-slate-500 mt-1">Kiểm tra kết nối từ máy chủ đang chạy hệ thống. Thao tác này không gửi thư.</p></div>
      <button type="button" onClick={check} disabled={checking} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-[#034ea1] hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={14} className={checking ? 'animate-spin' : ''} />{checking ? 'Đang kiểm tra…' : 'Kiểm tra kết nối email'}</button></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {diagnostic && <div role="status" className={`rounded-lg p-3 text-sm space-y-2 ${connected ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
      <p className="flex items-start gap-2">{connected ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}<span>{diagnostic.message}</span></p>
      {diagnostic.sender && <p className="text-xs">Người gửi: {diagnostic.sender}</p>}
      {diagnostic.blockedIp && <p className="text-xs">IP máy chủ cần được cho phép: <strong>{diagnostic.blockedIp}</strong></p>}
      <p className="text-xs">Kiểm tra lúc {new Date(diagnostic.checkedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ Việt Nam).</p>
    </div>}
  </section>;
}
