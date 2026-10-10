import { useNavigate, useParams } from 'react-router-dom';
import React, { useState, useEffect, useRef } from 'react';
import { Download, RefreshCw, X, Send, MessageCircle, Paperclip } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, PageDescriptionTooltip } from '../../../shared';

export function ChatView({ token, user, onUnreadChanged }: { token: string; user: any; onUnreadChanged?: (unread: number) => void }) {
  const navigate = useNavigate();
  const params = useParams();
  const [threads, setThreads] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoadingIds, setPreviewLoadingIds] = useState<Record<string, boolean>>({});
  const [deletingMessageIds, setDeletingMessageIds] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentPreviewUrlsRef = useRef<Record<string, string>>({});

  const threadKey = (thread: any) => Number(thread?.is_group || 0) === 1
    ? `group:${thread.lecturer_id}`
    : `${thread.student_user_id}:${thread.lecturer_id}`;
  const selectedKey = params.groupLecturerId
    ? `group:${params.groupLecturerId}`
    : (params.studentUserId && params.lecturerId ? `${params.studentUserId}:${params.lecturerId}` : '');
  const selectedThread = threads.find((thread: any) => threadKey(thread) === selectedKey) || null;
  const selectedIsGroup = selectedKey.startsWith('group:');

  const fetchThreads = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/chat/threads`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không tải được danh sách trao đổi.');
        setThreads([]);
        return;
      }
      const list = Array.isArray(data) ? data : [];
      setThreads(list);
      const total = list.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
      onUnreadChanged?.(total);
      if (!selectedKey && list.length > 0) {
        navigate(Number(list[0].is_group || 0) === 1 ? `/chat/group/${list[0].lecturer_id}` : `/chat/${list[0].student_user_id}/${list[0].lecturer_id}`, { replace: true });
      }
    } catch (e) {
      setError('Không tải được danh sách trao đổi.');
      setThreads([]);
    } finally {
      setLoadingThreads(false);
    }
  };

  const fetchMessages = async (showLoading = false) => {
    if (!selectedKey) {
      setMessages([]);
      return;
    }
    if (showLoading) setLoadingMessages(true);
    try {
      const endpoint = selectedIsGroup
        ? `${API_BASE}/api/chat/groups/${params.groupLecturerId}/messages`
        : `${API_BASE}/api/chat/threads/${params.studentUserId}/${params.lecturerId}/messages`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không tải được tin nhắn.');
        setMessages([]);
        return;
      }
      setMessages(Array.isArray(data) ? data : []);
      setError('');
      fetchThreads();
    } catch (e) {
      setError('Không tải được tin nhắn.');
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    setLoadingThreads(true);
    fetchThreads();
  }, [token]);

  useEffect(() => () => {
    Object.values(attachmentPreviewUrlsRef.current).forEach(url => URL.revokeObjectURL(String(url)));
  }, []);

  useEffect(() => {
    fetchMessages(true);
    setSelectedFile(null);
    if (!selectedKey) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchMessages(false);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token, selectedKey]);

  const openThread = (thread: any) => {
    navigate(Number(thread?.is_group || 0) === 1 ? `/chat/group/${thread.lecturer_id}` : `/chat/${thread.student_user_id}/${thread.lecturer_id}`);
  };

  const uploadChatAttachment = (thread: any, file: File, body: string) => new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', Number(thread?.is_group || 0) === 1
      ? `${API_BASE}/api/chat/groups/${thread.lecturer_id}/attachments`
      : `${API_BASE}/api/chat/threads/${thread.student_user_id}/${thread.lecturer_id}/attachments`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-message-body', encodeURIComponent(body));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Gửi file thất bại.'));
    };
    xhr.onerror = () => reject(new Error('Lỗi kết nối khi gửi file.'));
    xhr.send(file);
  });

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedThread || sending) return;
    const body = draft.trim();
    if (!body && !selectedFile) return;
    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) return alert('File vượt quá 10 MB. Vui lòng nén hoặc chọn file nhỏ hơn.');
    setSending(true);
    setUploadProgress(selectedFile ? 0 : null);
    try {
      const data = selectedFile
        ? await uploadChatAttachment(selectedThread, selectedFile, body)
        : await (async () => {
          const endpoint = Number(selectedThread?.is_group || 0) === 1
            ? `${API_BASE}/api/chat/groups/${selectedThread.lecturer_id}/messages`
            : `${API_BASE}/api/chat/threads/${selectedThread.student_user_id}/${selectedThread.lecturer_id}/messages`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ body }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Gửi tin nhắn thất bại.');
          return json;
        })();
      setDraft('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessages(prev => [...prev, data]);
      fetchThreads();
    } catch (e: any) {
      alert(e?.message || 'Gửi tin nhắn thất bại.');
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  const formatChatBytes = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const chooseChatFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return alert('File vượt quá 10 MB. Vui lòng nén hoặc chọn file nhỏ hơn.');
    }
    setSelectedFile(file);
  };

  const isGroupMessage = (message: any) => Number(message?.is_group || selectedThread?.is_group || 0) === 1;
  const messageUiKey = (message: any) => `${isGroupMessage(message) ? 'g' : 'm'}:${message.id}`;

  const downloadChatAttachment = async (message: any) => {
    const res = await fetch(`${API_BASE}/api/chat/${isGroupMessage(message) ? 'group-messages' : 'messages'}/${message.id}/attachment`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return alert('Không tải được file.');
    saveAs(await res.blob(), message.attachment_name || 'attachment');
  };

  const revokePreviewUrl = (messageId: string) => {
    const url = attachmentPreviewUrlsRef.current[messageId];
    if (url) URL.revokeObjectURL(url);
    setAttachmentPreviewUrls(prev => {
      const next = { ...prev };
      delete next[messageId];
      attachmentPreviewUrlsRef.current = next;
      return next;
    });
  };

  const retractMessage = async (message: any) => {
    if (!confirm('Thu hồi tin nhắn này? Tin nhắn sẽ bị xoá khỏi hệ thống, file đính kèm nếu có cũng sẽ bị xoá khỏi kho lưu trữ.')) return;
    const key = messageUiKey(message);
    setDeletingMessageIds(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/chat/${isGroupMessage(message) ? 'group-messages' : 'messages'}/${message.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Không thu hồi được tin nhắn.');
      revokePreviewUrl(key);
      setMessages(prev => prev.filter(item => messageUiKey(item) !== key));
      fetchThreads();
    } catch (e) {
      alert('Lỗi kết nối khi thu hồi tin nhắn.');
    } finally {
      setDeletingMessageIds(prev => ({ ...prev, [key]: false }));
    }
  };

  const canPreviewAttachment = (message: any) => {
    const mime = String(message.attachment_mime || '').toLowerCase();
    return mime.startsWith('image/') || mime === 'application/pdf';
  };

  const toggleAttachmentPreview = async (message: any) => {
    const key = messageUiKey(message);
    if (attachmentPreviewUrls[key]) {
      revokePreviewUrl(key);
      return;
    }
    setPreviewLoadingIds(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/chat/${isGroupMessage(message) ? 'group-messages' : 'messages'}/${message.id}/attachment?preview=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return alert('Không tải được bản xem trước.');
      const url = URL.createObjectURL(await res.blob());
      setAttachmentPreviewUrls(prev => {
        const next = { ...prev, [key]: url };
        attachmentPreviewUrlsRef.current = next;
        return next;
      });
    } catch (e) {
      alert('Không tải được bản xem trước.');
    } finally {
      setPreviewLoadingIds(prev => ({ ...prev, [key]: false }));
    }
  };

  const threadTitle = (thread: any) => user.role === 'student'
    ? (Number(thread?.is_group || 0) === 1 ? `Nhóm của ${thread.lecturer_name}` : thread.lecturer_name)
    : (Number(thread?.is_group || 0) === 1 ? 'Nhóm sinh viên hướng dẫn' : thread.student_name);
  const threadSubtitle = (thread: any) => user.role === 'student'
    ? (Number(thread?.is_group || 0) === 1 ? 'Trao đổi chung với giảng viên và các sinh viên cùng GVHD' : (thread.advisor_role === 'primary' ? 'GVHD chính' : 'Đồng hướng dẫn'))
    : (Number(thread?.is_group || 0) === 1 ? `${Number(thread.student_count || 0)} sinh viên` : [thread.student_id, thread.class_name, thread.course_code].filter(Boolean).join(' · '));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#034ea1] flex items-center justify-center">
              <MessageCircle size={18} />
            </div>
            Trao đổi với {user.role === 'student' ? 'giảng viên hướng dẫn' : 'sinh viên'}
            <PageDescriptionTooltip description="Tin nhắn chỉ mở cho các phân công giảng viên hướng dẫn trong hệ thống, gồm chat riêng và chat nhóm theo từng giảng viên." />
          </h2>
        </div>
        <button
          onClick={fetchThreads}
          disabled={loadingThreads}
          className="bg-white text-slate-700 border border-black/[0.08] px-4 py-2 rounded-xl hover:bg-[#f8fafc] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
        >
          <RefreshCw size={14} className={`text-slate-500 ${loadingThreads ? 'animate-spin' : ''}`} /> Tải lại
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200/80 bg-[#fee2e2] p-4 text-xs font-medium text-[#d70015]">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 min-h-[620px]">
        {/* Left Thread List */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-[#f8fafc]">
            <div className="font-bold text-slate-900 text-sm">Cuộc trò chuyện</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{threads.length} hội thoại</div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto flex-1">
            {loadingThreads ? (
              <div className="p-8 text-xs text-slate-400 text-center font-medium">Đang tải...</div>
            ) : threads.length === 0 ? (
              <div className="p-8 text-xs text-slate-400 text-center font-medium">Chưa có giảng viên/sinh viên được phân công để trao đổi.</div>
            ) : threads.map((thread: any) => {
              const key = threadKey(thread);
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  onClick={() => openThread(thread)}
                  className={`w-full text-left p-4 transition-all cursor-pointer ${
                    active ? 'bg-[#e8f1fb] text-[#034ea1]' : 'hover:bg-[#f8fafc] text-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className={`font-semibold text-xs truncate ${active ? 'text-[#034ea1]' : 'text-slate-900'}`}>
                        {threadTitle(thread)}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">{threadSubtitle(thread) || '-'}</div>
                      <div className="text-[11px] text-slate-500 mt-1.5 truncate">
                        {thread.last_message || (thread.last_attachment_name ? `File: ${thread.last_attachment_name}` : 'Chưa có tin nhắn.')}
                      </div>
                    </div>
                    {Number(thread.unread_count || 0) > 0 && (
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#034ea1] text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs">
                        {Number(thread.unread_count) > 99 ? '99+' : thread.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Chat Window */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col min-h-[620px]">
          {selectedThread ? (
            <>
              <div className="px-5 py-3.5 border-b border-slate-100 bg-[#f8fafc]">
                <div className="font-bold text-slate-900 text-sm">{threadTitle(selectedThread)}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{threadSubtitle(selectedThread) || '-'}</div>
              </div>
              <div className="flex-1 p-5 overflow-y-auto bg-[#f8fafc]/30 space-y-3">
                {loadingMessages ? (
                  <div className="text-xs text-slate-400 text-center py-10 font-medium">Đang tải tin nhắn...</div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-10 font-medium">Chưa có tin nhắn. Bạn có thể bắt đầu trao đổi ở ô bên dưới.</div>
                ) : messages.map((message: any) => {
                  const mine = Number(message.sender_user_id) === Number(user.id);
                  const uiKey = messageUiKey(message);
                  return (
                    <div key={uiKey} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-xs ${
                        mine
                          ? 'bg-[#034ea1] text-white'
                          : 'bg-white border border-black/[0.06] text-slate-800'
                      }`}>
                        <div className={`text-[10px] font-semibold mb-1 ${mine ? 'text-white/80' : 'text-slate-400'}`}>
                          {mine ? 'Bạn' : message.sender_name}
                        </div>
                        <div className="text-xs whitespace-pre-wrap leading-relaxed">{message.body}</div>
                        {message.has_attachment ? (
                          <div className="mt-2.5 space-y-2">
                            <div className={`flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
                              mine
                                ? 'border-white/20 bg-white/10 text-white'
                                : 'border-black/[0.08] bg-[#f8fafc] text-slate-700'
                            }`}>
                              <Paperclip size={14} className="shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{message.attachment_name || 'File đính kèm'}</span>
                                <span className={`block text-[10px] font-medium ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                                  {formatChatBytes(Number(message.attachment_size || 0))}
                                </span>
                              </span>
                              {canPreviewAttachment(message) && (
                                <button
                                  type="button"
                                  onClick={() => toggleAttachmentPreview(message)}
                                  disabled={!!previewLoadingIds[uiKey]}
                                  className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${
                                    mine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-white hover:bg-slate-100 text-slate-700 border border-black/[0.08]'
                                  } disabled:opacity-60 cursor-pointer`}
                                >
                                  {previewLoadingIds[uiKey] ? 'Đang tải' : attachmentPreviewUrls[uiKey] ? 'Ẩn' : 'Xem'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => downloadChatAttachment(message)}
                                className={`shrink-0 rounded-lg p-1 transition-colors cursor-pointer ${mine ? 'hover:bg-white/20 text-white' : 'hover:bg-slate-200 text-slate-600'}`}
                                title="Tải file"
                              >
                                <Download size={14} />
                              </button>
                            </div>
                            {attachmentPreviewUrls[uiKey] && (
                              <div className={`overflow-hidden rounded-xl border ${mine ? 'border-white/20 bg-white/10' : 'border-black/[0.08] bg-white'}`}>
                                {String(message.attachment_mime || '').toLowerCase().startsWith('image/') ? (
                                  <img src={attachmentPreviewUrls[uiKey]} alt={message.attachment_name || 'Preview'} className="max-h-72 w-full object-contain" />
                                ) : (
                                  <iframe src={attachmentPreviewUrls[uiKey]} title={message.attachment_name || 'PDF preview'} className="h-72 w-full bg-white" />
                                )}
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div className={`mt-2 flex items-center gap-2 text-[10px] ${mine ? 'justify-end text-white/70' : 'text-slate-400'}`}>
                          <span>{message.created_at ? new Date(message.created_at).toLocaleString('vi-VN') : '-'}</span>
                          {mine && (
                            <button
                              type="button"
                              onClick={() => retractMessage(message)}
                              disabled={!!deletingMessageIds[uiKey]}
                              className="rounded-md px-1.5 py-0.5 font-semibold text-white/80 hover:bg-white/20 disabled:opacity-60 cursor-pointer transition-colors"
                            >
                              {deletingMessageIds[uiKey] ? 'Đang thu hồi' : 'Thu hồi'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
                      onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="rounded-lg p-1 text-[#005bb5] hover:bg-[#bfe0ff]/50 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {uploadProgress !== null && (
                  <div className="mb-3 rounded-xl border border-[#bfe0ff]/80 bg-white px-3.5 py-2 shadow-xs">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-[#034ea1]">
                      <span>Đang tải file lên</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e8f1fb]">
                      <div className="h-full rounded-full bg-[#034ea1] transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,application/zip,image/jpeg,image/png"
                    onChange={e => chooseChatFile(e.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-black/[0.08] bg-white text-slate-600 hover:bg-[#f8fafc] active:scale-[0.96] disabled:opacity-50 transition-all cursor-pointer shadow-xs"
                    title="Đính kèm file"
                  >
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    maxLength={2000}
                    rows={2}
                    className="flex-1 bg-[#f8fafc]/70 focus:bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner resize-none placeholder-slate-400 leading-relaxed"
                    placeholder="Nhập tin nhắn..."
                  />
                  <button
                    disabled={sending || (!draft.trim() && !selectedFile)}
                    className="h-10 px-5 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#034ea1] text-xs font-semibold text-white hover:bg-[#023a7a] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
                  >
                    <Send size={14} /> Gửi
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 mt-2 flex justify-between gap-3 font-medium">
                  <span>File hỗ trợ: PDF, Office, TXT, ZIP, JPG/PNG. Tối đa 10 MB/file; hệ thống có quota lưu trữ theo cuộc trò chuyện và theo ngày.</span>
                  <span>{draft.length}/2000</span>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-slate-400 font-medium">
              Chọn một cuộc trò chuyện để bắt đầu.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
