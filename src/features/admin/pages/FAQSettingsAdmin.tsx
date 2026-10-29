import { CampaignLegacyHeader } from '../../academic/CampaignLayoutContext';
import { useCampaignEditor } from '../../academic/CampaignEditorContext';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {useCampaignNavigate as useNavigate} from '../../academic/useCampaignNavigate';
import React, { useState, useEffect } from 'react';
import { Upload, RefreshCw, Save, CircleHelp, ChevronLeft, Eye, Code2, RotateCcw } from 'lucide-react';
import {
  API_BASE,
  DEFAULT_STUDENT_FAQ,
  DEFAULT_LECTURER_FAQ,
  convertDocxFileToMarkdown,
  CACHE_TTL,
  clearJsonCache,
  cachedJsonFetch,
  PageDescriptionTooltip,
} from '../../../shared';
import { AdminSettingsSubNav } from '../components/AdminSettingsSubNav';
import { SegmentedControl } from '../../../shared/ui/SegmentedControl';

export function FAQSettingsAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const editor = useCampaignEditor();
  const [faq, setFaq] = useState<any>({ faq_student_md: DEFAULT_STUDENT_FAQ, faq_lecturer_md: DEFAULT_LECTURER_FAQ });
  const [activeTab, setActiveTab] = useState<'student' | 'lecturer'>('student');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingDocx, setImportingDocx] = useState(false);

  useEffect(() => {
    if(editor){setFaq({faq_student_md:editor.campaign.settings.studentFaq,faq_lecturer_md:editor.campaign.settings.lecturerFaq});setLoading(false);return;}
    cachedJsonFetch<any>(`${API_BASE}/api/settings/faq`, {
      cacheKey: 'markdown:faq',
      ttlMs: CACHE_TTL.markdown,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        if (data && !data.error) {
          setFaq({
            faq_student_md: data.faq_student_md || DEFAULT_STUDENT_FAQ,
            faq_lecturer_md: data.faq_lecturer_md || DEFAULT_LECTURER_FAQ,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [token,editor?.campaign.id]);

  const saveFaq = async () => {
    setSaving(true);
    try {
      if(editor){await editor.save({studentFaq:faq.faq_student_md,lecturerFaq:faq.faq_lecturer_md});alert('Đã lưu nội dung nhóm môn.');return;}
      const res = await fetch(`${API_BASE}/api/settings/faq`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(faq),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lưu FAQ thất bại.');
      clearJsonCache('markdown:faq');
      alert('Đã lưu nội dung FAQ.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSaving(false);
    }
  };

  const activeKey = activeTab === 'student' ? 'faq_student_md' : 'faq_lecturer_md';
  const activeDefault = editor?.campaign.group==='project' ? '' : activeTab === 'student' ? DEFAULT_STUDENT_FAQ : DEFAULT_LECTURER_FAQ;

  const handleImportDocx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Vui lòng chọn file .docx');
      return;
    }
    setImportingDocx(true);
    try {
      const markdown = await convertDocxFileToMarkdown(file);
      setFaq((prev: any) => ({ ...prev, [activeKey]: markdown }));
    } catch (err: any) {
      alert('Không đọc được file Word: ' + (err?.message || err));
    } finally {
      setImportingDocx(false);
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#64748b]">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải cấu hình FAQ...</span>
      </div>
    );
  }

  const currentContent = faq[activeKey] || '';
  const charCount = currentContent.length;
  const lineCount = currentContent.split('\n').length;

  const headerActions = (<button
          onClick={saveFaq}
          disabled={saving || editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all shadow-[0_1px_3px_rgba(0,113,227,0.3)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap self-start sm:self-auto"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu thay đổi FAQ
        </button>);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Apple Large Title & Navigation Toolbar */}
      <CampaignLegacyHeader actions={headerActions}><div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#64748b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            Quản trị hệ thống
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#c2410c]/10 text-[#c2410c] flex items-center justify-center shadow-inner shrink-0">
              <CircleHelp size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Cài đặt FAQ
                <PageDescriptionTooltip description="Chọn nhóm người dùng và chỉnh nội dung FAQ hiển thị cho sinh viên hoặc giảng viên bằng Markdown." />
              </h1>
              <p className="text-xs text-[#64748b] mt-0.5 font-medium">
                Biên soạn câu hỏi thường gặp cho Sinh viên & Giảng viên
              </p>
            </div>
          </div>
        </div>

        {/* Primary Save Button */}
        {headerActions}
      </div></CampaignLegacyHeader>

      {/* Sub Navigation Bar for Settings */}
      <AdminSettingsSubNav />

      {/* Editor & Preview Split Workspace */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        {/* Apple Segmented Strip & Action Bar */}
        <div className="px-6 py-4 border-b border-black/[0.05] bg-[#f8fafc] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <SegmentedControl
            value={activeTab}
            onChange={(val) => setActiveTab(val as 'student' | 'lecturer')}
            items={[
              { value: 'student', label: 'FAQ Sinh viên' },
              { value: 'lecturer', label: 'FAQ Giảng viên' },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] ${
                importingDocx
                  ? 'bg-[#f8fafc] text-[#64748b] border-black/[0.04] cursor-not-allowed'
                  : 'bg-white text-[#0f172a] border-black/[0.08] hover:bg-[#f8fafc]'
              }`}
            >
              <Upload size={13} className="text-[#64748b]" />
              {importingDocx ? 'Đang phân tích Word...' : 'Import file Word (.docx)'}
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                disabled={importingDocx || editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
                onChange={handleImportDocx}
                onClick={(e) => {
                  (e.target as HTMLInputElement).value = '';
                }}
              />
            </label>

            <button
              onClick={() => setFaq((prev: any) => ({ ...prev, [activeKey]: activeDefault }))}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] hover:bg-[#f8fafc] shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              <RotateCcw size={12} className="text-[#64748b]" />
              Khôi phục mặc định
            </button>
          </div>
        </div>

        {/* Master-Detail Split Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-black/[0.05]">
          {/* Left: Code / Markdown Editor Pane */}
          <div className="p-6 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
                <Code2 size={14} className="text-[#034ea1]" />
                Mã nguồn Markdown ({activeTab === 'student' ? 'Sinh viên' : 'Giảng viên'})
              </span>
              <span className="text-[11px] font-mono text-[#64748b]">
                {lineCount} dòng · {charCount} ký tự
              </span>
            </div>

            <textarea disabled={editor?.campaign.status==='archived' || editor?.campaign.pendingMigration}
              value={currentContent}
              onChange={(e) => setFaq((prev: any) => ({ ...prev, [activeKey]: e.target.value }))}
              placeholder="Nhập nội dung FAQ theo định dạng Markdown..."
              className="w-full flex-1 min-h-[540px] border border-black/[0.08] rounded-2xl p-4 text-xs font-mono bg-[#f8fafc] focus:bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner leading-relaxed text-[#0f172a] resize-y"
            />
          </div>

          {/* Right: Apple Live Document Preview Pane */}
          <div className="p-6 bg-[#f8fafc] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
                <Eye size={14} className="text-[#15803d]" />
                Xem trước thực tế (Apple Support Style)
              </span>
              <span className="text-[11px] font-semibold text-[#15803d] bg-[#dcfce7] px-2.5 py-0.5 rounded-full">
                Hiển thị người dùng
              </span>
            </div>

            <div className="flex-1 min-h-[540px] bg-white border border-black/[0.06] rounded-2xl p-6 shadow-xs overflow-y-auto max-h-[640px]">
              <div className="prose prose-slate prose-sm max-w-none text-[#0f172a]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
