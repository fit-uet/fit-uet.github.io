import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { RefreshCw, Save, Shield, ChevronLeft, RotateCcw, Code2, Eye } from 'lucide-react';
import { API_BASE, DEFAULT_REGISTRATION_RULES, RegistrationRulesMarkdown, PageDescriptionTooltip } from '../../../shared';

export function RegistrationRulesSettingsAdmin({ token }: { token: string }) {
  const navigate = useNavigate();
  const [rules, setRules] = useState(DEFAULT_REGISTRATION_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/registration-rules`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setRules(data?.registration_rules_md || DEFAULT_REGISTRATION_RULES))
      .finally(() => setLoading(false));
  }, [token]);

  const saveRules = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/registration-rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ registration_rules_md: rules }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lưu quy định đăng ký thất bại.');
      alert('Đã lưu Quy định đăng ký.');
    } catch (e) {
      alert('Không thể kết nối đến máy chủ.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#86868b]">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải quy định đăng ký...</span>
      </div>
    );
  }

  const charCount = rules.length;
  const lineCount = rules.split('\n').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Apple Large Title & Navigation Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#86868b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            Quản trị hệ thống
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shadow-inner shrink-0">
              <Shield size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Cài đặt Quy định đăng ký
                <PageDescriptionTooltip description="Chỉnh sửa nội dung quy định học phần hiển thị cho sinh viên trên hệ thống bằng định dạng Markdown." />
              </h1>
              <p className="text-xs text-[#86868b] mt-0.5 font-medium">
                Quy chế, điều kiện tín chỉ & hướng dẫn đăng ký thực tập
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setRules(DEFAULT_REGISTRATION_RULES)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] hover:bg-[#f8fafc] shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <RotateCcw size={13} className="text-[#86868b]" />
            Khôi phục mặc định
          </button>
          <button
            onClick={saveRules}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-semibold text-white bg-[#034ea1] hover:bg-[#023a7a] active:scale-[0.98] transition-all shadow-[0_1px_3px_rgba(0,113,227,0.3)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Lưu quy định
          </button>
        </div>
      </div>

      {/* Editor & Preview Split Workspace */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-black/[0.05]">
          {/* Left: Code / Markdown Editor Pane */}
          <div className="p-6 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#86868b] flex items-center gap-1.5">
                <Code2 size={14} className="text-[#034ea1]" />
                Mã nguồn Markdown
              </span>
              <span className="text-[11px] font-mono text-[#86868b]">
                {lineCount} dòng · {charCount} ký tự
              </span>
            </div>

            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Nhập nội dung quy định theo định dạng Markdown..."
              className="w-full flex-1 min-h-[560px] border border-black/[0.08] rounded-2xl p-4 text-xs font-mono bg-[#fbfbfd] focus:bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all shadow-inner leading-relaxed text-[#0f172a] resize-y"
            />
          </div>

          {/* Right: Apple Live Document Preview Pane */}
          <div className="p-6 bg-[#fbfbfd] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#86868b] flex items-center gap-1.5">
                <Eye size={14} className="text-[#34c759]" />
                Xem trước thực tế (Giao diện sinh viên)
              </span>
              <span className="text-[11px] font-semibold text-[#034ea1] bg-[#034ea1]/10 px-2.5 py-0.5 rounded-full">
                Trang chủ sinh viên
              </span>
            </div>

            <div className="flex-1 min-h-[560px] bg-white border border-black/[0.06] rounded-2xl p-6 shadow-xs overflow-y-auto max-h-[660px]">
              <h3 className="text-xs font-bold text-[#0f172a] uppercase tracking-wider mb-4 pb-2 border-b border-black/[0.04]">
                Quy định Thực tập tốt nghiệp
              </h3>
              {String(rules || '').trim() ? (
                <div className="text-xs text-[#0f172a] leading-relaxed">
                  <RegistrationRulesMarkdown content={rules} />
                </div>
              ) : (
                <p className="text-xs text-[#86868b] italic">Chưa có quy định nào.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
