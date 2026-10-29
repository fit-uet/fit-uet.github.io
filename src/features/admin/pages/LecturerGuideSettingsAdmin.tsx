import { useCampaignEditor } from '../../academic/CampaignEditorContext';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {useCampaignNavigate as useNavigate} from '../../academic/useCampaignNavigate';
import React, { useState, useEffect } from 'react';
import { Upload, RefreshCw, Save, CircleHelp } from 'lucide-react';
import { API_BASE, DEFAULT_LECTURER_GUIDE, convertDocxFileToMarkdown, clearJsonCache, PageDescriptionTooltip } from '../../../shared';
import { AdminSettingsSubNav } from '../components/AdminSettingsSubNav';

export function LecturerGuideSettingsAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const editor = useCampaignEditor();
  const [guideContent, setGuideContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);

  useEffect(() => {
    if(editor){setGuideContent(editor.campaign.settings.lecturerGuide);setLoading(false);return;}
    fetch(`${API_BASE}/api/settings/lecturer-guide`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setGuideContent(data?.guide || DEFAULT_LECTURER_GUIDE))
      .finally(() => setLoading(false));
  }, [token,editor?.campaign.id]);

  const handleSaveGuide = async () => {
    setSaving(true);
    try {
      if(editor){await editor.save({lecturerGuide:guideContent});alert('Đã lưu nội dung nhóm môn.');return;}
      const res = await fetch(`${API_BASE}/api/settings/lecturer-guide`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guide: guideContent }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lưu hướng dẫn sử dụng thất bại.');
      clearJsonCache('markdown:lecturer-guide');
      alert('Đã lưu Hướng dẫn sử dụng cho giảng viên.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSaving(false);
    }
  };

  const handleImportDocx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Vui lòng chọn file .docx');
      return;
    }
    setImportingDocx(true);
    try {
      setGuideContent(await convertDocxFileToMarkdown(file));
    } catch (err: any) {
      alert('Không đọc được file Word: ' + (err?.message || err));
    } finally {
      setImportingDocx(false);
      e.target.value = '';
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-500 font-medium">Đang tải nội dung hướng dẫn...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            &larr; Quay lại Quản trị
          </button>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <CircleHelp size={18} />
            </div>
            Cài đặt Hướng dẫn sử dụng cho giảng viên
            <PageDescriptionTooltip description="Chỉnh nội dung hướng dẫn hiển thị cho giảng viên bằng Markdown." />
          </h2>
        </div>
        <button
          onClick={handleSaveGuide}
          disabled={saving || editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
          className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} Lưu hướng dẫn
        </button>
      </div>

      {/* Sub Navigation Bar for Settings */}
      <AdminSettingsSubNav />

      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-[#f8fafc] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all border shadow-xs active:scale-[0.98] ${
                importingDocx
                  ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                  : 'bg-white text-slate-700 border-black/[0.08] hover:bg-[#f8fafc]'
              }`}
            >
              <Upload size={14} className="text-slate-500" />
              {importingDocx ? 'Đang đọc file...' : 'Import từ Word (.docx)'}
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                disabled={importingDocx || editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
                onChange={handleImportDocx}
                onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
              />
            </label>
            <button
              onClick={() => setGuideContent(editor?.campaign.group==='project'?'':DEFAULT_LECTURER_GUIDE)}
              className="text-xs font-semibold text-slate-700 bg-white border border-black/[0.08] px-3.5 py-1.5 rounded-xl hover:bg-[#f8fafc] shadow-xs active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              Khôi phục mặc định
            </button>
          </div>
          <span className="text-xs text-slate-500">Nội dung file Word sẽ được chuyển sang Markdown và thay thế nội dung đang soạn.</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="p-5 border-b lg:border-b-0 lg:border-r border-slate-100">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Nội dung Hướng dẫn sử dụng</label>
            <textarea disabled={editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
              className="w-full min-h-[560px] border border-slate-200 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all font-mono bg-[#f8fafc]/50 focus:bg-white shadow-inner resize-y leading-relaxed text-slate-800"
              value={guideContent}
              onChange={(e) => setGuideContent(e.target.value)}
              placeholder="Nhập nội dung hướng dẫn sử dụng bằng Markdown..."
            />
          </div>
          <div className="p-5 bg-[#f8fafc]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Xem trước</div>
            <div className="prose prose-slate prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {guideContent || ''}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
