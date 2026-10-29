import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Users } from 'lucide-react';
import type { AcademicClassSummary, EnrollmentView, LecturerInfo } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicApi, academicDownload } from './client';
import { academicInput } from './form';

type ClassData = { class: AcademicClassSummary; enrollments: EnrollmentView[]; lecturers: LecturerInfo[] };
export function ClassChat({ token, user, data }: { token: string; user: any; data: ClassData }) {
  const [selected, setSelected] = useState(''); const [messages, setMessages] = useState<any[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const ownLecturer = data.lecturers.find(l => l.email.toLowerCase() === user.email.toLowerCase());
  const threads: { id: string; label: string; lecturerId: number; classId: string; enrollmentId?: string }[] = [];
  for (const e of data.enrollments) for (const a of e.assignments.filter(a => a.role !== 'reviewer' && (user.role === 'student' || a.lecturerId === ownLecturer?.id))) {
    const l = data.lecturers.find(l => l.id === a.lecturerId); if (!l) continue;
    threads.push({ id: `${e.id}:${l.id}`, label: `${e.name} ↔ ${l.name}`, lecturerId: l.id, classId: e.classId, enrollmentId: e.id });
    if (!threads.some(t => t.id === `group:${l.id}`)) threads.push({ id: `group:${l.id}`, label: `Nhóm ${data.class.code} · ${l.name}`, lecturerId: l.id, classId: e.classId });
  }
  const target = threads.find(t => t.id === selected) || threads[0];
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!target) return;
    try { setMessages(await academicApi(token, `/api/classes/${target.classId}/chat?lecturerId=${target.lecturerId}${target.enrollmentId ? `&enrollmentId=${target.enrollmentId}` : ''}`, 'GET', undefined, signal)); setError(''); }
    catch (error) { if (error.name !== 'AbortError') setError(error.message); }
  }, [token, data.class.id, target?.id]);
  useEffect(() => { const abort = new AbortController(); setMessages([]); load(abort.signal); const visible = () => { if(document.visibilityState==='visible')load(abort.signal); }; const timer = window.setInterval(visible, 30_000); document.addEventListener('visibilitychange',visible); window.addEventListener('api-force-refresh',visible); return () => { abort.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange',visible); window.removeEventListener('api-force-refresh',visible); }; }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } catch (error) { setError(error.message); } finally { setBusy(false); } };
  const writable = data.class.status === 'active';
  return <section className="bg-white border border-slate-200 rounded-xl overflow-hidden"><h3 className="font-semibold p-5 border-b border-slate-100">Trao đổi trong nhóm môn</h3>
    {!threads.length ? <p className="text-sm text-slate-500">Chưa có nhóm hướng dẫn để trao đổi. GVNX sử dụng phần nhận xét/yêu cầu sửa trong hồ sơ.</p> : <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]"><aside aria-label="Danh sách cuộc trò chuyện" className="hidden lg:block border-r border-slate-200 bg-slate-50/50 p-3 space-y-2">{threads.map(thread => <button key={thread.id} className={`w-full text-left rounded-xl p-3 flex gap-2 text-xs ${thread.id === target?.id ? 'bg-blue-50 border border-blue-200 text-[#034ea1]' : 'border border-transparent hover:bg-slate-100 text-slate-700'}`} onClick={() => setSelected(thread.id)}>{thread.id.startsWith('group:') ? <Users size={16} className="shrink-0" /> : <MessageCircle size={16} className="shrink-0" />}<span>{thread.label}</span></button>)}</aside><div className="min-w-0 p-5 space-y-4">
      <FormField label="Cuộc trò chuyện"><select className={academicInput} value={target?.id || ''} onChange={e => setSelected(e.target.value)}>{threads.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></FormField>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="space-y-3 max-h-96 overflow-y-auto p-3 bg-slate-50 rounded-lg">{messages.map(m => <div key={m.id} className={`p-3 rounded-lg text-sm ${Number(m.sender_id) === Number(user.id) ? 'bg-blue-50 ml-6' : 'bg-white mr-6 border'}`}>
        <strong className="text-xs">{m.sender_name}</strong><p className="whitespace-pre-wrap break-words mt-1">{m.retracted_at ? 'Tin nhắn đã được thu hồi.' : m.body}</p>
        {m.attachment_name && <button className="block text-[#034ea1] underline break-all my-2" disabled={busy} onClick={() => run(() => academicDownload(token, `/api/classes/${m.class_id || target.classId}/chat/${m.id}/attachment`, m.attachment_name))}>{m.attachment_name} ({Math.ceil(m.attachment_size / 1024)} KB)</button>}
        <div className="flex flex-wrap justify-between gap-2"><time className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString('vi-VN')}</time>{writable && Number(m.sender_id) === Number(user.id) && !m.retracted_at && <button className="text-xs text-slate-500 underline" disabled={busy} onClick={() => run(() => academicApi(token, `/api/classes/${m.class_id || target.classId}/chat/${m.id}`, 'DELETE'))}>Thu hồi</button>}</div>
      </div>)}{!messages.length && <p className="text-slate-500 text-sm">Chưa có tin nhắn.</p>}</div>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const f = new FormData(form); f.set('lecturerId', String(target.lecturerId)); if (target.enrollmentId) f.set('enrollmentId', target.enrollmentId); run(async () => { await academicApi(token, `/api/classes/${target.classId}/chat`, 'POST', f); form.reset(); }); }}>
        <FormField label="Tin nhắn"><textarea name="body" className={academicInput} placeholder="Tin nhắn cho nhóm / giảng viên" maxLength={10000} disabled={!writable} /></FormField>
        <FormField label="Đính kèm (tối đa 10 MB)"><input className="text-sm max-w-full" type="file" name="file" disabled={!writable} /></FormField><Button type="submit" disabled={busy || !writable}>Gửi</Button>
      </form>{data.class.legacy && <p className="text-sm text-slate-500">Hội thoại Thực tập cũ được đọc từ nguồn gốc trong cùng nhóm học kỳ.</p>}
    </div></div>}
  </section>;
}

type Question = { id: string; question: string; answer: string | null; created_at: string; answered_at: string | null; revision: number; asker_name?: string };
export function ClassQuestions({ token, user, c }: { token: string; user: any; c: AcademicClassSummary }) {
  const [rows, setRows] = useState<Question[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => setRows(await academicApi(token, `/api/campaigns/${c.id}/questions`, 'GET', undefined, signal)), [token, c.id]);
  useEffect(() => {
    const a = new AbortController();
    const update = () => { if(document.visibilityState==='visible')load(a.signal).catch(e=>{if(e.name!=='AbortError')setError(e.message);}); };
    update(); document.addEventListener('visibilitychange',update); window.addEventListener('api-data-changed',update); window.addEventListener('api-force-refresh',update);
    return () => {a.abort();document.removeEventListener('visibilitychange',update);window.removeEventListener('api-data-changed',update); window.removeEventListener('api-force-refresh',update);};
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <section className="bg-white border rounded-xl p-5 space-y-4"><h3 className="font-semibold">Hỏi đáp với Khoa</h3><p className="text-sm text-slate-500">Câu hỏi được hiển thị cho cả nhóm môn sau khi Khoa trả lời. Các câu chưa trả lời chỉ hiện với người hỏi và Khoa.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {rows.map(q => <article key={q.id} className="border rounded-lg p-4 space-y-2"><p className="font-medium text-sm whitespace-pre-wrap break-words">{q.question}</p>{q.asker_name && <p className="text-xs text-slate-500">Người hỏi: {q.asker_name}</p>}{q.answer ? <p className="text-sm whitespace-pre-wrap break-words">{q.answer}</p> : <p className="text-xs text-slate-500">Đang chờ Khoa trả lời.</p>}
      {user.role === 'admin' && <form className="space-y-2" onSubmit={e => { e.preventDefault(); const answer = new FormData(e.currentTarget).get('answer'); run(() => academicApi(token, `/api/admin/campaigns/${c.id}/questions/${q.id}`, 'PUT', { answer, expectedRevision: q.revision })); }}><FormField label="Câu trả lời"><textarea key={q.revision} className={academicInput} name="answer" defaultValue={q.answer || ''} required maxLength={10000} disabled={c.status !== 'active'} /></FormField><Button type="submit" size="sm" disabled={busy || c.status !== 'active'}>Lưu câu trả lời</Button></form>}
    </article>)}
    {user.role !== 'admin' && c.status === 'active' && <form className="space-y-2" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const question = new FormData(form).get('question'); run(async () => { await academicApi(token, `/api/campaigns/${c.id}/questions`, 'POST', { question }); form.reset(); }); }}><FormField label="Câu hỏi mới"><textarea className={academicInput} name="question" required maxLength={2000} /></FormField><Button type="submit" disabled={busy}>Gửi câu hỏi</Button></form>}
    {!rows.length && <p className="text-sm text-slate-500">Chưa có câu hỏi.</p>}
  </section>;
}

export function ClassAnnouncement({ token, c, filters = {}, scopeLabel }: { token: string; c: AcademicClassSummary; filters?: Record<string, string>; scopeLabel?: string }) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [preview, setPreview] = useState<any>(null);
  useEffect(() => { setPreview(null); setNotice(''); }, [c.id, JSON.stringify(filters)]);
  return <section className="bg-white border rounded-xl p-5 space-y-4"><h3 className="font-semibold">Thông báo nhóm môn</h3><p className="text-sm text-slate-500">Phạm vi gửi: {scopeLabel || 'Toàn nhóm môn trong học kỳ'}. Chỉ sinh viên đang tham gia và giảng viên được phân công được nhận.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <form className="space-y-3" onChange={() => setPreview(null)} onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setNotice(''); setPreview(null); try { setPreview(await academicApi(token, `/api/admin/campaigns/${c.id}/announcements/preview`, 'POST', { subject: f.get('subject'), body: f.get('body'), deliveryMode: f.get('deliveryMode'), includeLecturers: f.has('includeLecturers'), ...filters })); } catch (e) { setNotice(e.message); } finally { setBusy(false); } }}>
      <FormField label="Tiêu đề"><input name="subject" className={academicInput} required maxLength={300} /></FormField><FormField label="Nội dung"><textarea name="body" className={academicInput} required rows={5} maxLength={10000} /></FormField>
      <FormField label="Phương thức gửi"><select name="deliveryMode" className={academicInput}><option value="website_only">Chỉ thông báo trong hệ thống</option><option value="website_and_email">Thông báo và gửi email</option></select></FormField>
      <label className="text-sm flex gap-2"><input type="checkbox" name="includeLecturers" />Gửi cả giảng viên trong phạm vi</label><Button type="submit" variant="primary" disabled={busy || c.status !== 'active'}>Xem trước người nhận</Button>
    </form>
    {preview && <div className="border rounded-xl p-4 space-y-3 bg-slate-50"><h4 className="font-semibold">Kiểm tra trước khi gửi · {preview.recipients.length} người nhận</h4><p className="text-sm font-medium">{preview.subject}</p><p className="text-sm whitespace-pre-wrap break-words">{preview.body}</p><p className="text-xs text-slate-500">{preview.deliveryMode === 'website_and_email' ? 'Thông báo trong hệ thống và email' : 'Chỉ thông báo trong hệ thống'}</p><div className="max-h-60 overflow-y-auto text-sm">{preview.recipients.map(r => <p key={r.email}>{r.name} · {r.email} · {r.role === 'lecturer' ? 'Giảng viên' : 'Sinh viên'}</p>)}</div><Button variant="primary" disabled={busy || c.status !== 'active' || !preview.recipients.length} onClick={async () => { setBusy(true); setNotice(''); try { const r = await academicApi(token, `/api/admin/announcement-previews/${preview.id}/apply`, 'POST'); setNotice(`Đã tạo thông báo cho ${r.created} người nhận.`); setPreview(null); } catch (e) { setNotice(e.message); setPreview(null); } finally { setBusy(false); } }}>Gửi thông báo</Button></div>}
  </section>;
}
