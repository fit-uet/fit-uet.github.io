import {useCampaignEditor} from '../../academic/CampaignEditorContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {useCampaignNavigate as useNavigate} from '../../academic/useCampaignNavigate';
import { useState, useEffect } from 'react';
import { Edit2, Shield } from 'lucide-react';
import { API_BASE, CACHE_TTL, cachedJsonFetch, DEFAULT_PLAN } from '../../../shared';

export function PlanView({ user }: { user: any }) {
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const editor = useCampaignEditor();

  useEffect(() => {
    if(editor){setPlan(editor.campaign.settings.plan || 'Khoa chưa cập nhật nội dung.');setLoading(false);return;}
    cachedJsonFetch<any>(`${API_BASE}/api/plan`, {
      cacheKey: 'markdown:plan',
      ttlMs: CACHE_TTL.markdown,
    })
      .then(data => {
        setPlan(data?.plan || DEFAULT_PLAN);
        setLoading(false);
      })
      .catch(() => {
        setPlan(DEFAULT_PLAN);
        setLoading(false);
      });
  }, [editor?.campaign.id,editor?.campaign.revision]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button onClick={() => navigate('/')} className="bg-white text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer mb-2 active:scale-[0.98]">&larr; Quay lại trang chủ</button>
        {user?.role === 'admin' && (
          <div className="flex flex-wrap items-center gap-2">
            {(!editor || editor.campaign.group==='internship') && <button onClick={() => navigate('/admin/registration-rules')} className="bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]">
              <Shield size={14} className="text-slate-500" /> Cài đặt quy định
            </button>}
            <button onClick={() => navigate('/admin/plan')} className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98]">
              <Edit2 size={14} /> Cài đặt kế hoạch
            </button>
          </div>
        )}
      </div>
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 max-w-none prose prose-blue prose-sm sm:prose-base">
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-slate-200 rounded w-1/3 mb-6"></div>
            <div className="h-4 bg-slate-200 rounded w-full"></div>
            <div className="h-4 bg-slate-200 rounded w-5/6"></div>
            <div className="h-4 bg-slate-200 rounded w-4/6"></div>
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ node, ...props }) => <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 tracking-tight" {...props} />,
              h2: ({ node, ...props }) => <h2 className="text-base sm:text-lg font-bold text-[#034ea1] mt-6 mb-3" {...props} />,
              h3: ({ node, ...props }) => <h3 className="text-sm sm:text-base font-semibold text-slate-900 mt-4 mb-2" {...props} />,
              p: ({ node, ...props }) => <p className="mb-4 text-sm text-slate-600 leading-relaxed" {...props} />,
              ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 text-sm text-slate-600 space-y-1.5" {...props} />,
              ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 text-sm text-slate-600 space-y-1.5" {...props} />,
              li: ({ node, ...props }) => <li className="" {...props} />,
              strong: ({ node, ...props }) => <strong className="font-semibold text-slate-900" {...props} />,
              a: ({ node, ...props }) => <a className="text-[#034ea1] hover:underline font-medium" {...props} />,
              table: ({ node, ...props }) => <div className="overflow-x-auto mb-6 rounded-xl border border-slate-200"><table className="min-w-full divide-y divide-slate-100 text-xs sm:text-sm" {...props} /></div>,
              thead: ({ node, ...props }) => <thead className="bg-[#f9f9fb]" {...props} />,
              tbody: ({ node, ...props }) => <tbody className="divide-y divide-slate-100 bg-white" {...props} />,
              tr: ({ node, ...props }) => <tr className="hover:bg-[#f8fafc] transition-colors" {...props} />,
              th: ({ node, ...props }) => <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-700" {...props} />,
              td: ({ node, ...props }) => <td className="px-4 py-2.5 text-xs sm:text-sm text-slate-600" {...props} />,
            }}
          >
            {plan}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
