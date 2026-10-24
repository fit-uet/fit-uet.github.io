import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Edit2,
  Send,
  CircleHelp,
  Search,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  CheckCircle2,
  HelpCircle,
  X,
  Sparkles,
} from 'lucide-react';
import {
  API_BASE,
  DEFAULT_STUDENT_FAQ,
  DEFAULT_LECTURER_FAQ,
  CACHE_TTL,
  cachedJsonFetch,
  PageDescriptionTooltip,
} from '../../../shared';

export function FAQView({ user, token }: { user: any; token: string }) {
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [publicQuestions, setPublicQuestions] = useState<any[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingQuestion, setSubmittingQuestion] = useState(false);

  // Search & filter states for public FAQ
  const [searchKeyword, setSearchKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'lecturer'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const fetchMyFaqQuestions = async () => {
    const res = await fetch(`${API_BASE}/api/faq/questions/my`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setQuestions(Array.isArray(data) ? data : []);
  };

  const fetchPublicFaqQuestions = async () => {
    setPublicLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/faq/questions/public`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setPublicQuestions(list);
      // Expand the first 3 items by default for quick reading
      setExpandedIds(new Set(list.slice(0, 3).map((item: any) => Number(item.id))));
    } catch {
      setPublicQuestions([]);
    } finally {
      setPublicLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([
      cachedJsonFetch<any>(`${API_BASE}/api/settings/faq`, {
        cacheKey: 'markdown:faq',
        ttlMs: CACHE_TTL.markdown,
        headers: { Authorization: `Bearer ${token}` },
      }).then(data => setCampaign(data && !data.error ? data : {})),
      fetchMyFaqQuestions().catch(() => setQuestions([])),
      fetchPublicFaqQuestions().catch(() => setPublicQuestions([])),
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
      alert('Đã gửi câu hỏi tới quản trị viên. Khi có phản hồi, bạn sẽ nhận được thông báo.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSubmittingQuestion(false);
    }
  };

  const faqRole = user?.role === 'lecturer' ? 'lecturer' : 'student';
  const markdown =
    faqRole === 'lecturer'
      ? campaign?.faq_lecturer_md || DEFAULT_LECTURER_FAQ
      : campaign?.faq_student_md || DEFAULT_STUDENT_FAQ;
  const roleLabel = faqRole === 'lecturer' ? 'Giảng viên' : 'Sinh viên';

  // Filtered public questions
  const filteredPublicQuestions = useMemo(() => {
    const kw = searchKeyword.toLowerCase().trim();
    return publicQuestions.filter(q => {
      if (roleFilter !== 'all' && q.role !== roleFilter) return false;
      if (!kw) return true;
      return (
        String(q.question || '').toLowerCase().includes(kw) ||
        String(q.answer || '').toLowerCase().includes(kw)
      );
    });
  }, [publicQuestions, roleFilter, searchKeyword]);

  const studentPublicCount = useMemo(
    () => publicQuestions.filter(q => q.role === 'student').length,
    [publicQuestions]
  );
  const lecturerPublicCount = useMemo(
    () => publicQuestions.filter(q => q.role === 'lecturer').length,
    [publicQuestions]
  );

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllExpanded = () => {
    if (expandedIds.size === filteredPublicQuestions.length) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(filteredPublicQuestions.map(q => Number(q.id))));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/')}
          className="bg-white text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
        >
          &larr; Quay lại trang chủ
        </button>
        <div className="flex items-center gap-2">
          <a
            href="#public-faq"
            className="text-xs font-semibold text-[#034ea1] bg-blue-50/80 hover:bg-blue-100 border border-blue-200/60 px-3 py-1.5 rounded-xl transition-all"
          >
            Xem câu hỏi đã giải đáp ({publicQuestions.length}) &darr;
          </a>
        </div>
      </div>

      {/* Card 1: Static Handbook FAQ (Markdown) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-[#f9f9fb]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <CircleHelp className="text-[#034ea1]" /> Sổ tay quy định FAQ
                <PageDescriptionTooltip
                  description={
                    <>
                      Nội dung câu hỏi thường gặp và hướng dẫn quy chuẩn dành cho vai trò{' '}
                      <strong>{roleLabel}</strong>.
                    </>
                  }
                />
              </h2>
            </div>
            {user?.role === 'admin' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => navigate('/admin/faq-questions')}
                  className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
                >
                  <Send size={14} /> Trả lời câu hỏi
                </button>
                <button
                  onClick={() => navigate('/admin/faq')}
                  className="bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]"
                >
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
                table: ({ node, ...props }) => (
                  <div className="overflow-x-auto mb-6">
                    <table className="min-w-full divide-y divide-slate-200 border border-slate-200" {...props} />
                  </div>
                ),
                th: ({ node, ...props }) => (
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900 border-x border-slate-200" {...props} />
                ),
                td: ({ node, ...props }) => (
                  <td className="px-4 py-3 text-sm text-slate-600 border-x border-slate-200" {...props} />
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}
        </div>
      </div>

      {/* Card 2: Community Answered FAQs (Công khai cho toàn bộ sinh viên & GV cùng xem) */}
      <div id="public-faq" className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden scroll-mt-6">
        <div className="px-6 py-5 border-b border-slate-100 bg-[#f9f9fb]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-100/70 text-[#034ea1]">
                  <HelpCircle size={18} />
                </span>
                <h3 className="text-xl font-bold text-slate-900">
                  Câu hỏi thực tế đã được Khoa giải đáp
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-[#034ea1] border border-blue-200/60">
                  {publicQuestions.length} câu trả lời
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Các câu hỏi thực tế từ sinh viên và giảng viên được Khoa giải đáp trực tiếp, công khai để mọi người cùng tham khảo.
              </p>
            </div>
            {publicQuestions.length > 0 && (
              <button
                onClick={toggleAllExpanded}
                className="text-xs font-semibold text-slate-600 hover:text-[#034ea1] bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-xl transition-all shadow-2xs self-start md:self-auto cursor-pointer"
              >
                {expandedIds.size === filteredPublicQuestions.length ? 'Thu gọn tất cả' : 'Mở tất cả câu trả lời'}
              </button>
            )}
          </div>

          {/* Search bar & filter tabs */}
          <div className="mt-4 pt-4 border-t border-slate-200/60 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                placeholder="Tìm nhanh câu hỏi hoặc câu trả lời (con dấu, nộp báo cáo, F-Soft, điểm...)"
                className="w-full pl-9 pr-9 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-white"
              />
              {searchKeyword && (
                <button
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl self-start sm:self-auto">
              <button
                onClick={() => setRoleFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  roleFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Tất cả ({publicQuestions.length})
              </button>
              <button
                onClick={() => setRoleFilter('student')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  roleFilter === 'student'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Sinh viên ({studentPublicCount})
              </button>
              {lecturerPublicCount > 0 && (
                <button
                  onClick={() => setRoleFilter('lecturer')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    roleFilter === 'lecturer'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Giảng viên ({lecturerPublicCount})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* List of answered FAQs */}
        <div className="p-6">
          {publicLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-16 bg-slate-100 rounded-xl"></div>
              <div className="h-16 bg-slate-100 rounded-xl"></div>
              <div className="h-16 bg-slate-100 rounded-xl"></div>
            </div>
          ) : filteredPublicQuestions.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <HelpCircle size={24} />
              </div>
              <div className="font-semibold text-slate-800 text-sm">
                {searchKeyword ? 'Không tìm thấy câu hỏi phù hợp' : 'Chưa có câu hỏi nào được giải đáp'}
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                {searchKeyword
                  ? `Không có kết quả nào khớp với "${searchKeyword}". Bạn có thể thử tìm từ khóa khác hoặc gửi câu hỏi mới cho Khoa ở phần bên dưới.`
                  : 'Các câu hỏi khi được Ban chủ nhiệm Khoa giải đáp sẽ hiển thị công khai tại đây.'}
              </p>
              {searchKeyword && (
                <button
                  onClick={() => setSearchKeyword('')}
                  className="mt-3 text-xs font-semibold text-[#034ea1] hover:underline cursor-pointer"
                >
                  Xóa bộ lọc tìm kiếm
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPublicQuestions.map((item, idx) => {
                const isExpanded = expandedIds.has(Number(item.id)) || searchKeyword.trim().length > 0;
                return (
                  <div
                    key={item.id}
                    className="border border-slate-200/90 rounded-xl bg-white shadow-2xs hover:border-slate-300 transition-all overflow-hidden"
                  >
                    <button
                      onClick={() => toggleExpand(Number(item.id))}
                      className="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <span className="mt-0.5 text-[#034ea1] font-bold text-xs flex-shrink-0 w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-100">
                          Q{idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                item.role === 'lecturer'
                                  ? 'bg-purple-50 text-purple-700 border border-purple-200/60'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200/60'
                              }`}
                            >
                              {item.role === 'lecturer' ? 'Giảng viên hỏi' : 'Sinh viên hỏi'}
                            </span>
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 size={10} /> Đã giải đáp
                            </span>
                            {item.answered_at && (
                              <span className="text-[11px] text-slate-400 font-medium ml-auto">
                                {new Date(item.answered_at).toLocaleDateString('vi-VN')}
                              </span>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug">
                            {item.question}
                          </div>
                        </div>
                      </div>
                      <div className="text-slate-400 p-1 flex-shrink-0">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 bg-[#f9fafb] border-t border-slate-100">
                        <div className="bg-white border border-blue-200/80 rounded-xl p-3.5 mt-2 shadow-2xs">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#034ea1] uppercase tracking-wide mb-1.5">
                            <Sparkles size={12} className="text-amber-500" /> Câu trả lời từ Khoa:
                          </div>
                          <div className="text-xs sm:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {item.answer}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Card 3: Ask a Question & My Questions */}
      {user?.role !== 'admin' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-[#f9f9fb]">
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-2">
                <CircleHelp size={18} className="text-[#034ea1]" /> Gửi câu hỏi riêng cho Khoa
              </span>
              <PageDescriptionTooltip description="Nếu các câu hỏi thường gặp ở trên chưa giải đáp được thắc mắc của bạn, vui lòng gửi câu hỏi tại đây. Ban chủ nhiệm Khoa sẽ trả lời và gửi thông báo trực tiếp cho bạn." />
            </h3>
          </div>
          <div className="p-6 space-y-4">
            <textarea
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Nhập câu hỏi của bạn (ví dụ: về con dấu, đơn xin thực tập, thay đổi nơi thực tập...)..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-white shadow-2xs resize-y leading-relaxed"
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-slate-400 font-medium">{newQuestion.length}/2000 ký tự</span>
              <button
                onClick={submitQuestion}
                disabled={submittingQuestion || !newQuestion.trim()}
                className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {submittingQuestion ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Gửi câu hỏi
              </button>
            </div>

            <div className="border-t border-slate-100 pt-5 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <MessageSquare size={16} className="text-[#034ea1]" /> Câu hỏi của tôi ({questions.length})
                </h4>
                <button
                  onClick={fetchMyFaqQuestions}
                  className="text-xs text-slate-500 hover:text-[#034ea1] flex items-center gap-1 cursor-pointer"
                  title="Tải lại câu hỏi của tôi"
                >
                  <RefreshCw size={12} /> Làm mới
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-4 text-center">
                  Bạn chưa gửi câu hỏi riêng nào cho Khoa.
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map(q => (
                    <div key={q.id} className="border border-slate-200 rounded-xl p-4 bg-white shadow-2xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            q.status === 'answered'
                              ? 'bg-emerald-50 border border-emerald-200/80 text-emerald-700'
                              : 'bg-amber-50 border border-amber-200/80 text-amber-700'
                          }`}
                        >
                          {q.status === 'answered' ? '✓ Khoa đã trả lời' : 'Chờ Khoa trả lời'}
                        </span>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {q.created_at ? new Date(q.created_at).toLocaleString('vi-VN') : ''}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {q.question}
                      </div>
                      {q.answer && (
                        <div className="mt-3 bg-blue-50/60 border border-blue-200/80 rounded-xl p-3.5 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                          <div className="text-[10px] font-bold text-[#034ea1] uppercase tracking-wider mb-1 flex items-center gap-1">
                            <Sparkles size={11} className="text-amber-500" /> Trả lời từ Khoa:
                          </div>
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
