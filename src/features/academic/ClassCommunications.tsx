import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, MessageCircle, Paperclip, Send, Users, X } from 'lucide-react';
import { API_BASE } from '../../shared';
import type { AcademicClassSummary, EnrollmentView, LecturerInfo } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicApi, academicDownload } from './client';
import { academicInput } from './form';

type ClassData = { class: AcademicClassSummary; enrollments: EnrollmentView[]; lecturers: LecturerInfo[] };
export function ClassChat({ token, user, data }: { token: string; user: any; data: ClassData }) {
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoadingIds, setPreviewLoadingIds] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const ownLecturer = data.lecturers.find(l => l.email.toLowerCase() === user.email.toLowerCase());
  const isStudent = user.role === 'student';
  const threads: {
    id: string;
    label: string;
    title: string;
    subtitle: string;
    lecturerId: number;
    classId: string;
    enrollmentId?: string;
    isGroup: boolean;
  }[] = [];

  for (const e of data.enrollments) {
    for (const a of e.assignments.filter(a => a.role !== 'reviewer' && (isStudent || a.lecturerId === ownLecturer?.id))) {
      const l = data.lecturers.find(l => l.id === a.lecturerId);
      if (!l) continue;
      threads.push({
        id: `${e.id}:${l.id}`,
        label: `${e.name} ↔ ${l.name}`,
        title: isStudent ? l.name : e.name,
        subtitle: isStudent
          ? (a.role === 'primary' ? 'GVHD chính' : 'Đồng hướng dẫn')
          : [e.studentId, e.className, data.class.code].filter(Boolean).join(' · '),
        lecturerId: l.id,
        classId: e.classId,
        enrollmentId: e.id,
        isGroup: false,
      });

      if (!threads.some(t => t.id === `group:${l.id}`)) {
        const studentCount = data.enrollments.filter(item =>
          item.assignments.some(assign => assign.lecturerId === l.id && assign.role !== 'reviewer')
        ).length;
        threads.push({
          id: `group:${l.id}`,
          label: `Nhóm ${data.class.code} · ${l.name}`,
          title: isStudent ? `Nhóm của ${l.name}` : 'Nhóm sinh viên hướng dẫn',
          subtitle: isStudent
            ? 'Trao đổi chung với giảng viên và các sinh viên cùng GVHD'
            : `${studentCount} sinh viên`,
          lecturerId: l.id,
          classId: e.classId,
          isGroup: true,
        });
      }
    }
  }

  const target = threads.find(t => t.id === selected) || threads[0];

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!target) return;
    try {
      const res = await academicApi(token, `/api/classes/${target.classId}/chat?lecturerId=${target.lecturerId}${target.enrollmentId ? `&enrollmentId=${target.enrollmentId}` : ''}`, 'GET', undefined, signal);
      setMessages(res);
      setError('');
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    }
  }, [token, data.class.id, target?.id]);

  useEffect(() => {
    const abort = new AbortController();
    setMessages([]);
    load(abort.signal);
    const visible = () => {
      if (document.visibilityState === 'visible') load(abort.signal);
    };
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('api-force-refresh', visible);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('api-force-refresh', visible);
    };
  }, [load]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      Object.values(attachmentPreviewUrls).forEach(u => URL.revokeObjectURL(u));
    };
  }, [attachmentPreviewUrls]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const writable = data.class.status === 'active';

  const formatChatBytes = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageAttachment = (m: any) => {
    const name = String(m.attachment_name || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|svg)$/i.test(name);
  };

  const canPreviewAttachment = (m: any) => {
    const name = String(m.attachment_name || '').toLowerCase();
    return isImageAttachment(m) || name.endsWith('.pdf');
  };

  const toggleAttachmentPreview = async (m: any) => {
    if (attachmentPreviewUrls[m.id]) {
      URL.revokeObjectURL(attachmentPreviewUrls[m.id]);
      setAttachmentPreviewUrls(prev => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
      return;
    }
    setPreviewLoadingIds(prev => ({ ...prev, [m.id]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/classes/${m.class_id || target.classId}/chat/${m.id}/attachment`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Không tải được bản xem trước.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAttachmentPreviewUrls(prev => ({ ...prev, [m.id]: url }));
    } catch (err: any) {
      alert(err?.message || 'Không tải được bản xem trước.');
    } finally {
      setPreviewLoadingIds(prev => ({ ...prev, [m.id]: false }));
    }
  };

  const downloadAttachment = (m: any) => {
    academicDownload(
      token,
      `/api/classes/${m.class_id || target.classId}/chat/${m.id}/attachment`,
      m.attachment_name || 'attachment'
    );
  };

  const retractMessage = async (m: any) => {
    if (!confirm('Thu hồi tin nhắn này? Tin nhắn và file đính kèm (nếu có) sẽ bị xóa khỏi hệ thống.')) return;
    run(async () => {
      await academicApi(token, `/api/classes/${m.class_id || target.classId}/chat/${m.id}`, 'DELETE');
      if (attachmentPreviewUrls[m.id]) {
        URL.revokeObjectURL(attachmentPreviewUrls[m.id]);
        setAttachmentPreviewUrls(prev => {
          const next = { ...prev };
          delete next[m.id];
          return next;
        });
      }
    });
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!target || busy || sending) return;
    const bodyText = draft.trim();
    if (!bodyText && !selectedFile) return;
    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) {
      alert('File vượt quá 10 MB. Vui lòng nén hoặc chọn file nhỏ hơn.');
      return;
    }
    setSending(true);
    try {
      const f = new FormData();
      if (bodyText) f.set('body', bodyText);
      if (selectedFile) f.set('file', selectedFile);
      f.set('lecturerId', String(target.lecturerId));
      if (target.enrollmentId) f.set('enrollmentId', target.enrollmentId);

      await academicApi(token, `/api/classes/${target.classId}/chat`, 'POST', f);
      setDraft('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err: any) {
      alert(err?.message || 'Gửi tin nhắn thất bại.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-xl border border-red-200/80 bg-[#fee2e2] p-4 text-xs font-medium text-[#d70015]">
          {error}
        </div>
      )}

      {!threads.length ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center text-slate-500 text-sm">
          Chưa có nhóm hướng dẫn để trao đổi. GVNX sử dụng phần nhận xét/yêu cầu sửa trong hồ sơ.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 min-h-[620px]">
          {/* Left Thread List */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-[#f8fafc]">
              <div className="font-bold text-slate-900 text-sm">Cuộc trò chuyện</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{threads.length} hội thoại</div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto flex-1">
              {threads.map(thread => {
                const active = thread.id === target?.id;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelected(thread.id)}
                    className={`w-full text-left p-4 transition-all cursor-pointer ${
                      active ? 'bg-[#e8f1fb] text-[#034ea1]' : 'hover:bg-[#f8fafc] text-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        active ? 'bg-[#034ea1] text-white shadow-xs' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {thread.isGroup ? <Users size={16} /> : <MessageCircle size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`font-semibold text-xs truncate ${active ? 'text-[#034ea1]' : 'text-slate-900'}`}>
                          {thread.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {thread.subtitle || '-'}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Chat Window */}
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col min-h-[620px]">
            {target ? (
              <>
                <div className="px-5 py-3.5 border-b border-slate-100 bg-[#f8fafc]">
                  <div className="font-bold text-slate-900 text-sm">{target.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{target.subtitle || '-'}</div>
                </div>

                {/* Mobile selector */}
                <div className="lg:hidden p-3 border-b border-slate-100 bg-slate-50/50">
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-800"
                    value={target.id}
                    onChange={e => setSelected(e.target.value)}
                  >
                    {threads.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.subtitle})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex-1 p-5 overflow-y-auto bg-[#f8fafc]/30 space-y-3 max-h-[460px]">
                  {messages.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-12 font-medium">
                      Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi ở ô bên dưới.
                    </div>
                  ) : (
                    messages.map(m => {
                      const mine = Number(m.sender_id) === Number(user.id);
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-xs ${
                            mine
                              ? 'bg-[#034ea1] text-white'
                              : 'bg-white border border-black/[0.06] text-slate-800'
                          }`}>
                            <div className={`text-[10px] font-semibold mb-1 ${mine ? 'text-white/80' : 'text-slate-400'}`}>
                              {mine ? 'Bạn' : m.sender_name}
                            </div>
                            <div className="text-xs whitespace-pre-wrap leading-relaxed">
                              {m.retracted_at ? 'Tin nhắn đã được thu hồi.' : m.body}
                            </div>

                            {m.attachment_name && !m.retracted_at && (
                              <div className="mt-2.5 space-y-2">
                                <div className={`flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
                                  mine
                                    ? 'border-white/20 bg-white/10 text-white'
                                    : 'border-black/[0.08] bg-[#f8fafc] text-slate-700'
                                }`}>
                                  <Paperclip size={14} className="shrink-0" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate">{m.attachment_name}</span>
                                    <span className={`block text-[10px] font-medium ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                                      {formatChatBytes(Number(m.attachment_size || 0))}
                                    </span>
                                  </span>
                                  {canPreviewAttachment(m) && (
                                    <button
                                      type="button"
                                      onClick={() => toggleAttachmentPreview(m)}
                                      disabled={!!previewLoadingIds[m.id]}
                                      className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${
                                        mine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-white hover:bg-slate-100 text-slate-700 border border-black/[0.08]'
                                      } disabled:opacity-60 cursor-pointer`}
                                    >
                                      {previewLoadingIds[m.id] ? 'Đang tải' : attachmentPreviewUrls[m.id] ? 'Ẩn' : 'Xem'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => downloadAttachment(m)}
                                    className={`shrink-0 rounded-lg p-1 transition-colors cursor-pointer ${
                                      mine ? 'hover:bg-white/20 text-white' : 'hover:bg-slate-200 text-slate-600'
                                    }`}
                                    title="Tải file"
                                  >
                                    <Download size={14} />
                                  </button>
                                </div>
                                {attachmentPreviewUrls[m.id] && (
                                  <div className={`overflow-hidden rounded-xl border ${mine ? 'border-white/20 bg-white/10' : 'border-black/[0.08] bg-white'}`}>
                                    {isImageAttachment(m) ? (
                                      <img src={attachmentPreviewUrls[m.id]} alt={m.attachment_name} className="max-h-72 w-full object-contain" />
                                    ) : (
                                      <iframe src={attachmentPreviewUrls[m.id]} title={m.attachment_name} className="h-72 w-full bg-white" />
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className={`mt-2 flex items-center gap-2 text-[10px] ${mine ? 'justify-end text-white/70' : 'text-slate-400'}`}>
                              <span>{m.created_at ? new Date(m.created_at).toLocaleString('vi-VN') : '-'}</span>
                              {writable && mine && !m.retracted_at && (
                                <button
                                  type="button"
                                  onClick={() => retractMessage(m)}
                                  disabled={busy}
                                  className="rounded-md px-1.5 py-0.5 font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60 cursor-pointer transition-colors"
                                >
                                  Thu hồi
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input form */}
                <form onSubmit={sendMessage} className="p-4 border-t border-slate-100 bg-white">
                  {selectedFile && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#bfe0ff]/80 bg-[#e8f1fb] px-3.5 py-2 text-xs text-[#005bb5]">
                      <div className="min-w-0 flex items-center gap-2">
                        <Paperclip size={14} className="shrink-0" />
                        <span className="truncate font-semibold">{selectedFile.name}</span>
                        <span className="shrink-0 text-[#034ea1] font-medium">{formatChatBytes(selectedFile.size)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="rounded-md p-0.5 text-blue-600 hover:bg-blue-100 hover:text-blue-800 transition-colors cursor-pointer"
                        title="Bỏ chọn file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  <div className="relative">
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      disabled={!writable || sending}
                      placeholder="Nhập tin nhắn..."
                      rows={2}
                      className="w-full resize-none border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all bg-slate-50/50 focus:bg-white disabled:opacity-50"
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        disabled={!writable || sending}
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            if (f.size > 10 * 1024 * 1024) {
                              alert('File vượt quá 10 MB. Vui lòng nén hoặc chọn file nhỏ hơn.');
                              e.target.value = '';
                              return;
                            }
                            setSelectedFile(f);
                          }
                        }}
                      />
                      <button
                        type="button"
                        disabled={!writable || sending}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#034ea1] p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Paperclip size={15} />
                        <span>Đính kèm file</span>
                      </button>
                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        Tối đa 10 MB (Shift+Enter để xuống dòng)
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={(!draft.trim() && !selectedFile) || !writable || sending}
                      className="bg-[#034ea1] hover:bg-[#023b7a] active:scale-[0.98] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <span>{sending ? 'Đang gửi...' : 'Gửi'}</span>
                      <Send size={13} />
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">Chọn cuộc trò chuyện để bắt đầu.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  return <section className="bg-white border border-slate-200 rounded-2xl shadow-xs p-5 space-y-4">
    <div className="border-b border-slate-100 pb-3 flex items-center justify-between gap-2">
      <div>
        <h3 className="font-bold text-base text-slate-900">Hỏi đáp với Khoa</h3>
        <p className="text-xs text-slate-500 mt-0.5">Câu hỏi được hiển thị cho cả nhóm môn sau khi Khoa trả lời. Các câu chưa trả lời chỉ hiện với người hỏi và Khoa.</p>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="space-y-3">
      {rows.map(q => <article key={q.id} className="border border-slate-200 rounded-2xl p-4.5 space-y-3 bg-white shadow-xs">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm text-slate-900 whitespace-pre-wrap break-words">{q.question}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${q.answer ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {q.answer ? 'Đã trả lời' : 'Chờ phản hồi'}
          </span>
        </div>
        {q.asker_name && <p className="text-xs text-slate-500">Người hỏi: {q.asker_name}</p>}
        {q.answer ? (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm text-slate-800">
            <span className="font-semibold text-xs text-[#034ea1] block mb-1">Khoa CNTT trả lời:</span>
            <p className="text-sm whitespace-pre-wrap break-words text-slate-800">{q.answer}</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">Đang chờ Khoa trả lời.</p>
        )}
        {user.role === 'admin' && <form className="space-y-2 pt-2 border-t border-slate-100" onSubmit={e => { e.preventDefault(); const answer = new FormData(e.currentTarget).get('answer'); run(() => academicApi(token, `/api/admin/campaigns/${c.id}/questions/${q.id}`, 'PUT', { answer, expectedRevision: q.revision })); }}><FormField label="Câu trả lời"><textarea key={q.revision} className={academicInput} name="answer" defaultValue={q.answer || ''} required maxLength={10000} disabled={c.status !== 'active'} /></FormField><Button type="submit" size="sm" disabled={busy || c.status !== 'active'}>Lưu câu trả lời</Button></form>}
      </article>)}
    </div>
    {user.role !== 'admin' && c.status === 'active' && <form className="space-y-3 bg-slate-50/80 p-4 border border-slate-200 rounded-2xl" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const question = new FormData(form).get('question'); run(async () => { await academicApi(token, `/api/campaigns/${c.id}/questions`, 'POST', { question }); form.reset(); }); }}><FormField label="Câu hỏi mới"><textarea className={academicInput} name="question" required maxLength={2000} placeholder="Nhập nội dung câu hỏi gửi Khoa..." /></FormField><Button type="submit" disabled={busy}>Gửi câu hỏi</Button></form>}
    {!rows.length && <p className="text-sm text-slate-500 text-center py-6">Chưa có câu hỏi.</p>}
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
