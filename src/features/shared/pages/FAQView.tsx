import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { RefreshCw, Edit2, Send, CircleHelp } from 'lucide-react';
import { API_BASE, DEFAULT_STUDENT_FAQ, DEFAULT_LECTURER_FAQ, CACHE_TTL, cachedJsonFetch, PageDescriptionTooltip } from '../../../shared';

export function FAQView({ user, token }: { user: any, token: string }) {
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingQuestion, setSubmittingQuestion] = useState(false);

  const fetchMyFaqQuestions = async () => {
    const res = await fetch(`${API_BASE}/api/faq/questions/my`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setQuestions(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    Promise.all([
      cachedJsonFetch<any>(`${API_BASE}/api/settings/faq`, {
        cacheKey: 'markdown:faq',
        ttlMs: CACHE_TTL.markdown,
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(data => setCampaign(data && !data.error ? data : {})),
      fetchMyFaqQuestions().catch(() => setQuestions([])),
    ]).finally(() => setLoading(false));
  }, [token]);

  const submitQuestion = async () => {
    const question = newQuestion.trim();
    if (!question) return alert('Vui lòng nhập câu hỏi.');
    setSubmittingQuestion(true);
    try {
      const res = await fetch(`${API_BASE}/api/faq/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Gửi câu hỏi thất bại.');
      setNewQuestion('');
      await fetchMyFaqQuestions();
      alert('Đã gửi câu hỏi tới quản trị viên.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSubmittingQuestion(false);
    }
  };

  const faqRole = user?.role === 'lecturer' ? 'lecturer' : 'student';
  const markdown = faqRole === 'lecturer'
    ? (campaign?.faq_lecturer_md || DEFAULT_LECTURER_FAQ)
    : (campaign?.faq_student_md || DEFAULT_STUDENT_FAQ);
  const roleLabel = faqRole === 'lecturer' ? 'Giảng viên' : 'Sinh viên';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => navigate('/')} className="bg-white text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer mb-2 active:scale-[0.98]">&larr; Quay lại trang chủ</button>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-[#f9f9fb]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <CircleHelp className="text-[#034ea1]" /> FAQ
                <PageDescriptionTooltip description={<>Nội dung câu hỏi thường gặp dành cho vai trò <strong>{roleLabel}</strong>.</>} />
              </h2>
            </div>
            {user?.role === 'admin' && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => navigate('/admin/faq-questions')} className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]">
                  <Send size={14} /> Trả lời câu hỏi
                </button>
                <button onClick={() => navigate('/admin/faq')} className="bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]">
                  <Edit2 size={14} className="text-slate-500" /> Cài đặt FAQ
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="p-6 max-w-none prose prose-blue prose-sm sm:prose-base">
          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-slate-200 rounded w-1/2"></div>
              <div className="h-4 bg-slate-200 rounded w-full"></div>
              <div className="h-4 bg-slate-200 rounded w-5/6"></div>
              <div className="h-4 bg-slate-200 rounded w-2/3"></div>
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ node, ...props }) => <h1 className="text-2xl font-bold text-slate-800 mb-4" {...props} />,
                h2: ({ node, ...props }) => <h2 className="text-xl font-bold text-slate-800 mt-6 mb-3" {...props} />,
                h3: ({ node, ...props }) => <h3 className="text-lg font-bold text-slate-800 mt-5 mb-2" {...props} />,
                p: ({ node, ...props }) => <p className="mb-4 text-slate-600 leading-relaxed" {...props} />,
                ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 text-slate-600 space-y-1" {...props} />,
                ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 text-slate-600 space-y-1" {...props} />,
                strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900" {...props} />,
                a: ({ node, ...props }) => <a className="text-blue-600 hover:underline" {...props} />,
                table: ({ node, ...props }) => <div className="overflow-x-auto mb-6"><table className="min-w-full divide-y divide-slate-200 border border-slate-200" {...props} /></div>,
                th: ({ node, ...props }) => <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 border-x border-slate-200" {...props} />,
                td: ({ node, ...props }) => <td className="px-4 py-3 text-sm text-slate-600 border-x border-slate-200" {...props} />,
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}
        </div>
      </div>
      {user?.role !== 'admin' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-2"><CircleHelp size={18} className="text-blue-600" /> Gửi câu hỏi cho Khoa</span>
              <PageDescriptionTooltip description="Câu hỏi sẽ được quản trị viên trả lời trong mục FAQ; câu trả lời cũng hiển thị trong thông báo của bạn." />
            </h3>
          </div>
          <div className="p-6 space-y-4">
            <textarea
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Nhập câu hỏi của bạn..."
              className="w-full px-4 py-3 border border-[#cbd5e1] rounded-xl text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-white shadow-xs resize-y"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-slate-400 font-medium">{newQuestion.length}/2000 ký tự</span>
              <button onClick={submitQuestion} disabled={submittingQuestion || !newQuestion.trim()} className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
                {submittingQuestion ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Gửi câu hỏi
              </button>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-bold text-slate-800 mb-3">Câu hỏi của tôi</h4>
              {questions.length === 0 ? (
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-4">Bạn chưa gửi câu hỏi nào.</div>
              ) : (
                <div className="space-y-3">
                  {questions.map(q => (
                    <div key={q.id} className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${q.status === 'answered' ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-amber-50 border border-amber-100 text-amber-700'}`}>
                          {q.status === 'answered' ? 'Đã trả lời' : 'Chờ trả lời'}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">{q.created_at ? new Date(q.created_at).toLocaleString('vi-VN') : ''}</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 whitespace-pre-wrap">{q.question}</div>
                      {q.answer && (
                        <div className="mt-3 bg-blue-50/50 border border-blue-100 rounded-xl p-3 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                          <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">Trả lời</div>
                          {q.answer}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
