import { CampaignLegacyHeader, useCampaignRefresh } from '../../academic/CampaignLayoutContext';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { RefreshCw, Save, Send, CircleHelp } from 'lucide-react';
import { API_BASE, PageDescriptionTooltip } from '../../../shared';

export function FAQQuestionsAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<any[]>([]);
  const [answerDrafts, setAnswerDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [answeringId, setAnsweringId] = useState<number | null>(null);

  const fetchFaqQuestions = async () => {
    const res = await fetch(`${API_BASE}/api/admin/faq/questions`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    setQuestions(rows);
    setAnswerDrafts(Object.fromEntries(rows.map((row: any) => [Number(row.id), row.answer || ''])));
  };

  useCampaignRefresh(fetchFaqQuestions);

  useEffect(() => {
    fetchFaqQuestions()
      .catch(() => setQuestions([]))
      .finally(() => setLoading(false));
  }, [token]);

  const pendingQuestions = questions.filter(q => q.status !== 'answered').length;

  const answerQuestion = async (questionId: number) => {
    const answer = String(answerDrafts[questionId] || '').trim();
    if (!answer) return alert('Vui lòng nhập câu trả lời.');
    setAnsweringId(questionId);
    try {
      const res = await fetch(`${API_BASE}/api/admin/faq/questions/${questionId}/answer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lưu câu trả lời thất bại.');
      await fetchFaqQuestions();
      alert('Đã trả lời câu hỏi.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setAnsweringId(null);
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500 font-medium">Đang tải danh sách câu hỏi...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <CampaignLegacyHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản trị
          </button>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#034ea1] flex items-center justify-center">
              <Send size={18} />
            </div>
            Trả lời câu hỏi FAQ
            <PageDescriptionTooltip description="Xem và trả lời câu hỏi do sinh viên hoặc giảng viên gửi từ trang FAQ." />
          </h2>
        </div>
        <button
          onClick={fetchFaqQuestions}
          className="bg-white text-slate-700 border border-black/[0.08] px-4 py-2 rounded-xl hover:bg-[#f8fafc] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <RefreshCw size={14} className="text-slate-500" /> Tải lại
        </button>
      </div></CampaignLegacyHeader>

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-[#f8fafc] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
              <CircleHelp size={16} className="text-[#034ea1]" /> Câu hỏi gửi tới FAQ
            </h3>
            <p className="text-xs text-slate-500 mt-1">Còn <strong>{pendingQuestions}</strong> câu hỏi đang chờ trả lời.</p>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {questions.length === 0 ? (
            <div className="p-8 text-sm text-slate-400 text-center font-medium">Chưa có câu hỏi nào được gửi.</div>
          ) : questions.map(q => (
            <div key={q.id} className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    q.status === 'answered'
                      ? 'bg-[#dcfce7] text-[#1d833f] border border-emerald-200/60'
                      : 'bg-[#ffedd5] text-[#b25e00] border border-amber-200/60'
                  }`}>
                    {q.status === 'answered' ? 'Đã trả lời' : 'Chờ trả lời'}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-black/[0.05]">
                    {q.role === 'lecturer' ? 'Giảng viên' : 'Sinh viên'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{q.created_at ? new Date(q.created_at).toLocaleString('vi-VN') : ''}</span>
                </div>
                <div className="text-sm font-semibold text-slate-800">{q.user_name || q.user_email || 'Người dùng'}</div>
                <div className="text-xs text-slate-500 font-mono mt-0.5 mb-3">{q.student_id || q.user_email || ''}</div>
                <div className="text-xs font-medium text-slate-700 whitespace-pre-wrap bg-[#f8fafc]/60 border border-black/[0.06] rounded-xl p-3.5 leading-relaxed">
                  {q.question}
                </div>
              </div>
              <div className="space-y-3">
                <textarea
                  value={answerDrafts[Number(q.id)] || ''}
                  onChange={e => setAnswerDrafts(prev => ({ ...prev, [Number(q.id)]: e.target.value }))}
                  rows={5}
                  placeholder="Nhập câu trả lời..."
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all bg-[#f8fafc]/50 focus:bg-white shadow-inner resize-y font-medium text-slate-700 leading-relaxed"
                />
                {q.answered_at && (
                  <div className="text-xs text-slate-400 font-medium">
                    Trả lời lúc {new Date(q.answered_at).toLocaleString('vi-VN')}{q.answered_by_name ? ` bởi ${q.answered_by_name}` : ''}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={() => answerQuestion(Number(q.id))}
                    disabled={answeringId === Number(q.id)}
                    className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {answeringId === Number(q.id) ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                    {q.status === 'answered' ? 'Cập nhật trả lời' : 'Trả lời'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
