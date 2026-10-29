import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, CircleHelp, Download, Eye, MessageCircle, Paperclip, RefreshCw, Save, Search, Send, Users, X } from 'lucide-react';
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
    let lastPollTime = Date.now();
    const visible = (e?: Event) => {
      if (e?.type === 'visibilitychange') {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastPollTime < 15_000) return;
        lastPollTime = now;
      }
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
  const [rows, setRows] = useState<Question[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'answered'>('all');
  const [search, setSearch] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const list = await academicApi(token, `/api/campaigns/${c.id}/questions`, 'GET', undefined, signal);
    setRows(list);
    setAnswerDrafts(prev => {
      const next = { ...prev };
      list.forEach((q: Question) => {
        if (next[q.id] === undefined) next[q.id] = q.answer || '';
      });
      return next;
    });
  }, [token, c.id]);

  useEffect(() => {
    const a = new AbortController();
    let lastLoadTime = Date.now();
    const update = (e?: Event) => {
      if (e?.type === 'visibilitychange') {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastLoadTime < 30_000) return;
        lastLoadTime = now;
      }
      if (document.visibilityState === 'visible') load(a.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('api-data-changed', update);
    window.addEventListener('api-force-refresh', update);
    return () => {
      a.abort();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('api-data-changed', update);
      window.removeEventListener('api-force-refresh', update);
    };
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message || 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleAnswer = async (q: Question) => {
    const answer = String(answerDrafts[q.id] || '').trim();
    if (!answer) return alert('Vui lòng nhập câu trả lời.');
    setAnsweringId(q.id);
    try {
      await academicApi(token, `/api/admin/campaigns/${c.id}/questions/${q.id}`, 'PUT', { answer, expectedRevision: q.revision });
      await load();
    } catch (e: any) {
      alert(e.message || 'Lưu câu trả lời thất bại.');
    } finally {
      setAnsweringId(null);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const qText = newQuestion.trim();
    if (!qText || submitting) return;
    setSubmitting(true);
    try {
      await academicApi(token, `/api/campaigns/${c.id}/questions`, 'POST', { question: qText });
      setNewQuestion('');
      await load();
    } catch (err: any) {
      alert(err.message || 'Gửi câu hỏi thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = rows.filter(q => !q.answer).length;
  const answeredCount = rows.filter(q => !!q.answer).length;

  const filtered = rows.filter(q => {
    if (filter === 'pending' && q.answer) return false;
    if (filter === 'answered' && !q.answer) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      const matchQ = q.question.toLowerCase().includes(s);
      const matchA = (q.answer || '').toLowerCase().includes(s);
      const matchAsker = (q.asker_name || '').toLowerCase().includes(s);
      return matchQ || matchA || matchAsker;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {error && (
        <div role="alert" className="rounded-xl border border-red-200/80 bg-[#fee2e2] p-4 text-xs font-medium text-[#d70015]">
          {error}
        </div>
      )}

      {/* Main card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-[#f8fafc] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2 text-base">
              <CircleHelp size={18} className="text-[#034ea1]" /> Hỏi đáp với Khoa CNTT
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {user.role === 'admin'
                ? `Còn ${pendingCount} câu hỏi đang chờ phản hồi. Câu trả lời sẽ hiển thị cho toàn bộ sinh viên/giảng viên trong nhóm môn.`
                : 'Đặt câu hỏi và nhận giải đáp từ Khoa CNTT. Câu hỏi đã trả lời sẽ được chia sẻ cho cả nhóm môn.'}
            </p>
          </div>
          <button
            onClick={() => load()}
            disabled={busy}
            className="bg-white text-slate-700 border border-black/[0.08] px-3.5 py-1.5 rounded-xl hover:bg-[#f8fafc] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
          >
            <RefreshCw size={13} className={`text-slate-500 ${busy ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'all' ? 'bg-white text-[#034ea1] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tất cả ({rows.length})
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'pending' ? 'bg-white text-[#034ea1] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chờ trả lời ({pendingCount})
            </button>
            <button
              onClick={() => setFilter('answered')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'answered' ? 'bg-white text-[#034ea1] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Đã trả lời ({answeredCount})
            </button>
          </div>

          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm câu hỏi, người hỏi..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] transition-all text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>

        {/* Question List */}
        <div className="divide-y divide-slate-100">
          {!filtered.length ? (
            <div className="p-12 text-center text-xs text-slate-400 font-medium">
              {rows.length === 0
                ? 'Chưa có câu hỏi nào trong nhóm môn.'
                : 'Không tìm thấy câu hỏi phù hợp với bộ lọc.'}
            </div>
          ) : (
            filtered.map(q => {
              const isAnswered = !!q.answer;
              return (
                <article key={q.id} className="p-5 transition-colors hover:bg-slate-50/50">
                  {user.role === 'admin' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr] gap-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isAnswered
                              ? 'bg-[#dcfce7] text-[#1d833f] border border-emerald-200/60'
                              : 'bg-[#ffedd5] text-[#b25e00] border border-amber-200/60'
                          }`}>
                            {isAnswered ? 'Đã trả lời' : 'Chờ phản hồi'}
                          </span>
                          <span className="text-xs text-slate-400">
                            {q.created_at ? new Date(q.created_at).toLocaleString('vi-VN') : ''}
                          </span>
                        </div>
                        {q.asker_name && (
                          <div className="text-xs font-semibold text-slate-800 mb-2">
                            Người hỏi: <span className="text-[#034ea1]">{q.asker_name}</span>
                          </div>
                        )}
                        <div className="text-xs font-medium text-slate-800 whitespace-pre-wrap bg-[#f8fafc] border border-slate-200/80 rounded-xl p-3.5 leading-relaxed">
                          {q.question}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <textarea
                          value={answerDrafts[q.id] ?? (q.answer || '')}
                          onChange={e => setAnswerDrafts(prev => ({ ...prev, [q.id]: e.target.value }))}
                          rows={4}
                          disabled={c.status !== 'active'}
                          placeholder="Nhập câu trả lời của Khoa..."
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-[#f8fafc]/50 focus:bg-white resize-y font-medium text-slate-700 leading-relaxed disabled:opacity-50"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-slate-400">
                            {q.answered_at ? `Đã trả lời lúc ${new Date(q.answered_at).toLocaleString('vi-VN')}` : 'Chưa có câu trả lời'}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAnswer(q)}
                            disabled={answeringId === q.id || c.status !== 'active'}
                            className="bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                          >
                            {answeringId === q.id ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                            <span>{isAnswered ? 'Cập nhật trả lời' : 'Lưu câu trả lời'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isAnswered
                                ? 'bg-[#dcfce7] text-[#1d833f] border border-emerald-200/60'
                                : 'bg-[#ffedd5] text-[#b25e00] border border-amber-200/60'
                            }`}>
                              {isAnswered ? 'Đã trả lời' : 'Chờ phản hồi'}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {q.created_at ? new Date(q.created_at).toLocaleString('vi-VN') : ''}
                            </span>
                          </div>
                          <p className="font-semibold text-sm text-slate-900 whitespace-pre-wrap leading-relaxed pt-1">
                            {q.question}
                          </p>
                          {q.asker_name && (
                            <p className="text-[11px] text-slate-400">Người hỏi: {q.asker_name}</p>
                          )}
                        </div>
                      </div>

                      {q.answer ? (
                        <div className="bg-[#e8f1fb]/50 border border-blue-100 rounded-xl p-4 text-xs text-slate-800 space-y-1 mt-2">
                          <div className="font-bold text-[#034ea1] text-xs flex items-center gap-1.5">
                            <CheckCircle2 size={14} className="text-blue-600" /> Khoa Công nghệ Thông tin trả lời:
                          </div>
                          <p className="text-xs whitespace-pre-wrap leading-relaxed text-slate-800 pt-1">
                            {q.answer}
                          </p>
                          {q.answered_at && (
                            <div className="text-[10px] text-slate-400 pt-1">
                              Trả lời lúc {new Date(q.answered_at).toLocaleString('vi-VN')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-700/80 italic bg-amber-50/60 border border-amber-100 rounded-xl p-3">
                          Câu hỏi đã được gửi đến Khoa và đang chờ phản hồi.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* Student/Lecturer asking form */}
      {user.role !== 'admin' && c.status === 'active' && (
        <form onSubmit={handleAsk} className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#034ea1] flex items-center justify-center">
              <Send size={15} />
            </div>
            <div>
              <h4 className="font-bold text-sm text-slate-900">Đặt câu hỏi mới cho Khoa</h4>
              <p className="text-[11px] text-slate-400">Câu hỏi sẽ được chuyển đến ban điều phối học phần của Khoa.</p>
            </div>
          </div>

          <textarea
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            required
            maxLength={2000}
            rows={3}
            placeholder="Nhập nội dung thắc mắc hoặc câu hỏi cần giải đáp..."
            className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-slate-50/50 focus:bg-white resize-y font-medium text-slate-700 leading-relaxed"
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">
              {newQuestion.length}/2000 ký tự
            </span>
            <button
              type="submit"
              disabled={!newQuestion.trim() || submitting}
              className="bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
            >
              <span>{submitting ? 'Đang gửi...' : 'Gửi câu hỏi'}</span>
              <Send size={13} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ClassAnnouncement({ token, c, filters = {}, scopeLabel }: { token: string; c: AcademicClassSummary; filters?: Record<string, string>; scopeLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    setPreview(null);
    setNotice('');
  }, [c.id, JSON.stringify(filters)]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {notice && (
        <div role="status" className="rounded-xl border border-blue-200/80 bg-[#e8f1fb] p-4 text-xs font-semibold text-[#034ea1]">
          {notice}
        </div>
      )}

      {/* Main card */}
      <section className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Bell size={18} className="text-[#034ea1]" /> Soạn thông báo nhóm môn
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Phạm vi gửi: <strong className="text-slate-800">{scopeLabel || 'Toàn nhóm môn trong học kỳ'}</strong>. Chỉ sinh viên đang tham gia và giảng viên được phân công trong phạm vi sẽ nhận được thông báo.
            </p>
          </div>
        </div>

        <form
          className="space-y-4"
          onChange={() => setPreview(null)}
          onSubmit={async e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setNotice('');
            setPreview(null);
            try {
              const res = await academicApi(token, `/api/admin/campaigns/${c.id}/announcements/preview`, 'POST', {
                subject: f.get('subject'),
                body: f.get('body'),
                deliveryMode: f.get('deliveryMode'),
                includeLecturers: f.has('includeLecturers'),
                ...filters,
              });
              setPreview(res);
            } catch (err: any) {
              setNotice(err.message || 'Lỗi kiểm tra người nhận.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormField label="Tiêu đề thông báo">
            <input
              name="subject"
              className={academicInput}
              required
              maxLength={300}
              placeholder="Nhập tiêu đề thông báo ngắn gọn, rõ ràng..."
            />
          </FormField>

          <FormField label="Nội dung thông báo">
            <textarea
              name="body"
              className={academicInput}
              required
              rows={5}
              maxLength={10000}
              placeholder="Nhập chi tiết nội dung thông báo gửi đến sinh viên / giảng viên..."
            />
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4 items-center">
            <FormField label="Phương thức gửi">
              <select name="deliveryMode" className={academicInput}>
                <option value="website_only">Chỉ thông báo trong hệ thống website</option>
                <option value="website_and_email">Thông báo trong website và gửi email</option>
              </select>
            </FormField>

            <div className="sm:pt-5">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer p-2 rounded-xl hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  name="includeLecturers"
                  className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1]"
                />
                <Users size={15} className="text-slate-500" />
                <span>Gửi kèm cả giảng viên trong phạm vi</span>
              </label>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" variant="primary" disabled={busy || c.status !== 'active'}>
              Xem trước người nhận
            </Button>
          </div>
        </form>

        {/* Preview card */}
        {preview && (
          <div className="border border-blue-200 bg-[#f0f7ff]/70 rounded-2xl p-5 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-blue-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-[#034ea1]" />
                <h4 className="font-bold text-sm text-slate-900">
                  Kiểm tra trước khi gửi · <span className="text-[#034ea1]">{preview.recipients.length} người nhận</span>
                </h4>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-[#034ea1] border border-blue-200">
                {preview.deliveryMode === 'website_and_email' ? 'Website + Email' : 'Chỉ Website'}
              </span>
            </div>

            <div className="space-y-2 bg-white border border-blue-100/80 rounded-xl p-4">
              <div className="font-semibold text-xs text-slate-900">{preview.subject}</div>
              <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{preview.body}</div>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-700 mb-2">
                Danh sách người nhận ({preview.recipients.length}):
              </div>
              <div className="max-h-56 overflow-y-auto bg-white border border-blue-100/80 rounded-xl divide-y divide-slate-100">
                {preview.recipients.map((r: any) => (
                  <div key={r.email} className="px-3.5 py-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{r.name}</span>
                      <span className="text-slate-400 ml-2 font-mono text-[11px]">{r.email}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      r.role === 'lecturer' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {r.role === 'lecturer' ? 'Giảng viên' : 'Sinh viên'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Hủy xem trước
              </Button>
              <Button
                variant="primary"
                disabled={busy || c.status !== 'active' || !preview.recipients.length}
                onClick={async () => {
                  setBusy(true);
                  setNotice('');
                  try {
                    const r = await academicApi(token, `/api/admin/announcement-previews/${preview.id}/apply`, 'POST');
                    setNotice(`Đã tạo thông báo thành công cho ${r.created} người nhận.`);
                    setPreview(null);
                  } catch (e: any) {
                    setNotice(e.message || 'Lỗi gửi thông báo.');
                    setPreview(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Xác nhận gửi thông báo
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
