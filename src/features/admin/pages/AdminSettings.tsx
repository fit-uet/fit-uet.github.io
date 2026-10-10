import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { RefreshCw, Save, Clock } from 'lucide-react';
import { API_BASE, Button, cohortOptionsForYear, defaultAllowedCohortsForYear, CACHE_TTL, clearJsonCache, cachedJsonFetch, PageHeader, Surface } from '../../../shared';

export function AdminSettings({ token }: { token: string }) {
  const [sheetUrl, setSheetUrl] = useState('');
  const [exportSheetUrl, setExportSheetUrl] = useState('');
  const [campaign, setCampaign] = useState({ year: '', registration_open_at: '', registration_close_at: '', classes_list: '' } as any);
  const [savingUrl, setSavingUrl] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSettings();
  }, []);



  const fetchSettings = async () => {
    try {
      const [sheetRes, campRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings/google-sheet`, { headers: { Authorization: `Bearer ${token}` } }),
        cachedJsonFetch<any>(`${API_BASE}/api/settings/campaign`, {
          cacheKey: 'settings:campaign',
          ttlMs: CACHE_TTL.campaign,
          headers: { Authorization: `Bearer ${token}` },
        })
      ]);
      const data = await sheetRes.json();
      setSheetUrl(data.url || '');
      setExportSheetUrl(data.export_url || '');
      setCampaign(campRes);
    } catch (e) { }
  };

  const handleSaveImportUrl = async () => {
    setSavingUrl(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/google-sheet`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ url: sheetUrl })
      });
      if (!res.ok) throw new Error('Failed to save');
      alert('Đã lưu URL danh sách công ty thành công!');
    } catch (e) {
      alert('Lỗi khi lưu.');
    } finally {
      setSavingUrl(false);
    }
  };

  const handleSaveExportUrl = async () => {
    setSavingUrl(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/google-sheet`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ export_url: exportSheetUrl })
      });
      if (!res.ok) throw new Error('Failed to save');
      alert('Đã lưu URL xuất dữ liệu thành công!');
    } catch (e) {
      alert('Lỗi khi lưu.');
    } finally {
      setSavingUrl(false);
    }
  };

  const handleSaveCampaign = async () => {
    setSavingCampaign(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/campaign`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(campaign)
      });
      if (res.ok) {
        clearJsonCache('settings:campaign');
        alert('Đã lưu cấu hình học phần');
      }
    } catch (e) { }
    setSavingCampaign(false);
  };

  const cohortOptions = cohortOptionsForYear(campaign.year);
  const defaultAllowedCohorts = defaultAllowedCohortsForYear(campaign.year);
  const selectedCohorts = String((campaign as any).allowed_registration_cohorts || defaultAllowedCohorts)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const toggleAllowedCohort = (cohort: string) => {
    const next = selectedCohorts.includes(cohort)
      ? selectedCohorts.filter(item => item !== cohort)
      : [...selectedCohorts, cohort];
    const ordered = cohortOptions.map(item => item.key).filter(item => next.includes(item));
    setCampaign({ ...campaign, allowed_registration_cohorts: ordered.join(',') } as any);
  };

  const campaignWindowStatus = (openKey: string, closeKey: string) => {
    const toGMT7Date = (s: string) => s ? new Date(s + ':00+07:00') : null;
    const now = new Date();
    const open = toGMT7Date((campaign as any)[openKey]);
    const close = toGMT7Date((campaign as any)[closeKey]);
    if (open && now < open) return { label: 'Chưa mở', tone: 'warning' };
    if (close && now > close) return { label: 'Đã đóng', tone: 'danger' };
    if (open || close) return { label: 'Đang mở', tone: 'success' };
    return { label: 'Chưa cấu hình', tone: 'neutral' };
  };

  const campaignWindows = [
    { title: 'Đăng ký học phần', openKey: 'registration_open_at', closeKey: 'registration_close_at' },
    { title: 'Xác nhận nơi thực tập', openKey: 'confirmation_open_at', closeKey: 'confirmation_close_at' },
    { title: 'Nộp báo cáo', openKey: 'final_report_open_at', closeKey: 'final_report_close_at' },
    { title: 'Chấm điểm báo cáo', openKey: 'grading_open_at', closeKey: 'grading_close_at' },
    { title: 'Đăng ký GV hướng dẫn', openKey: 'advisor_request_open_at', closeKey: 'advisor_request_close_at' }
  ];

  const handleSyncCompanies = async () => {
    // Show a choice dialog
    const choice = prompt(
      'Đồng bộ danh sách công ty từ Google Sheet:\n\n'
      + '1 — Giữ lại toàn bộ đăng ký hiện tại\n'
      + '2 — Xoá toàn bộ đăng ký hiện tại\n\n'
      + 'Nhập 1 hoặc 2 để tiếp tục (hoặc bấm Hủy):'
    );
    if (choice !== '1' && choice !== '2') return;

    const keepRegistrations = choice === '1';
    const confirmMsg = keepRegistrations
      ? 'Hệ thống sẽ cập nhật danh sách công ty và GIỮ LẠI toàn bộ đăng ký hiện tại. Tiếp tục?'
      : 'Hệ thống sẽ cập nhật danh sách công ty và XOÁ TOÀN BỘ đăng ký hiện tại. Tiếp tục?';
    if (!confirm(confirmMsg)) return;

    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/import-companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keepRegistrations })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Đã đồng bộ thành công ${data.count} công ty.${keepRegistrations ? ' Các đăng ký hiện tại được giữ nguyên.' : ' Toàn bộ đăng ký đã bị xoá.'}`);
      } else {
        alert('Lỗi đồng bộ: ' + data.error);
      }
    } catch (e) {
      alert('Lỗi kết nối khi đồng bộ.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <button
          onClick={() => navigate('/admin')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f5f5f7] active:scale-[0.98] transition-all cursor-pointer mb-3"
        >
          &larr; Quay lại Quản trị
        </button>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#0071e3] flex items-center justify-center">
            <Save size={18} />
          </div>
          Cài đặt hệ thống
        </h2>
        <p className="text-xs text-slate-500 mt-1">Quản lý campaign, phạm vi sinh viên và các kết nối dữ liệu của hệ thống.</p>
      </div>

      {/* Cài đặt học phần */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 flex flex-col gap-5">
        <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
          Cài đặt học phần
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Năm học / Khóa</label>
            <input
              type="text"
              value={campaign.year}
              onChange={e => {
                const nextYear = e.target.value;
                setCampaign({ ...campaign, year: nextYear, allowed_registration_cohorts: defaultAllowedCohortsForYear(nextYear) });
              }}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-2">Khóa được phép đăng nhập/đăng ký học phần</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {cohortOptions.map(item => (
                <label
                  key={item.key}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer transition-all ${
                    selectedCohorts.includes(item.key)
                      ? 'border-[#0071e3]/40 bg-[#ebf4ff] text-[#0071e3] font-semibold'
                      : 'border-black/[0.08] bg-white text-slate-600 hover:bg-[#f5f5f7]'
                  }`}
                >
                  <span className="font-semibold">{item.key}</span>
                  <span className="text-[11px] text-slate-400">{item.prefix}</span>
                  <input
                    type="checkbox"
                    checked={selectedCohorts.includes(item.key)}
                    onChange={() => toggleAllowedCohort(item.key)}
                    className="rounded border-slate-300 text-[#0071e3] focus:ring-[#0071e3]"
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 rounded-xl p-4 bg-[#fff8eb] border border-amber-200/70 text-xs text-amber-900 leading-relaxed">
            <div className="font-bold text-amber-800 mb-1">Ngoại lệ khóa luôn được áp dụng theo danh sách sinh viên</div>
            <div>
              Hệ thống kiểm tra khóa từ email trước. Nếu khóa nằm trong danh sách đang mở thì cho đăng nhập/đăng ký ngay; nếu không, hệ thống mới kiểm tra MSSV/email trong site Quản lý sinh viên. Ví dụ K69 MSSV 24021400 chỉ được vào nếu admin đã thêm/import sinh viên này.
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">⏰ Mở đăng ký lúc <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).registration_open_at || ''}
              onChange={e => setCampaign({ ...campaign, registration_open_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">⏱️ Đóng đăng ký lúc <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).registration_close_at || ''}
              onChange={e => setCampaign({ ...campaign, registration_close_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mở xác nhận nơi TT <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).confirmation_open_at || ''}
              onChange={e => setCampaign({ ...campaign, confirmation_open_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đóng xác nhận nơi TT <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).confirmation_close_at || ''}
              onChange={e => setCampaign({ ...campaign, confirmation_close_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mở nộp báo cáo <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).final_report_open_at || ''}
              onChange={e => setCampaign({ ...campaign, final_report_open_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đóng nộp báo cáo <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).final_report_close_at || ''}
              onChange={e => setCampaign({ ...campaign, final_report_close_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">⏰ Mở chấm điểm lúc <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).grading_open_at || ''}
              onChange={e => setCampaign({ ...campaign, grading_open_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">⏱️ Đóng chấm điểm lúc <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).grading_close_at || ''}
              onChange={e => setCampaign({ ...campaign, grading_close_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mở đăng ký GVHD <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).advisor_request_open_at || ''}
              onChange={e => setCampaign({ ...campaign, advisor_request_open_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đóng đăng ký GVHD <span className="text-slate-400 font-normal">(GMT+7)</span></label>
            <input
              type="datetime-local"
              value={(campaign as any).advisor_request_close_at || ''}
              onChange={e => setCampaign({ ...campaign, advisor_request_close_at: e.target.value } as any)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Danh sách lớp khóa học <span className="text-slate-400 font-normal">(mỗi lớp cách nhau bởi dấu phẩy)</span></label>
            <textarea
              value={campaign.classes_list || ''}
              onChange={e => setCampaign({ ...campaign, classes_list: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner resize-y leading-relaxed"
              rows={2}
            />
          </div>
          <div className="md:col-span-2 border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Quota mặc định GVHD</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">GS/PGS</label>
                <input
                  type="number"
                  min="1"
                  value={(campaign as any).advisor_quota_pgs || '5'}
                  onChange={e => setCampaign({ ...campaign, advisor_quota_pgs: e.target.value } as any)}
                  className="w-full px-3.5 py-2 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">TS</label>
                <input
                  type="number"
                  min="1"
                  value={(campaign as any).advisor_quota_ts || '8'}
                  onChange={e => setCampaign({ ...campaign, advisor_quota_ts: e.target.value } as any)}
                  className="w-full px-3.5 py-2 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">ThS/Khác</label>
                <input
                  type="number"
                  min="1"
                  value={(campaign as any).advisor_quota_ths || '10'}
                  onChange={e => setCampaign({ ...campaign, advisor_quota_ths: e.target.value } as any)}
                  className="w-full px-3.5 py-2 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Quota riêng của từng giảng viên trong site Phân công GVHD vẫn được ưu tiên nếu đã thiết lập.</p>
          </div>
          <p className="md:col-span-2 text-xs text-slate-500">Mỗi campaign dùng khoảng thời gian riêng. Để trống nếu chưa cấu hình campaign đó.</p>
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campaignWindows.map(item => {
              const status = campaignWindowStatus(item.openKey, item.closeKey);
              const toneClass = status.tone === 'success'
                ? 'bg-[#ebf9ee] border-emerald-200/60 text-[#1d833f]'
                : status.tone === 'warning'
                ? 'bg-[#fff8eb] border-amber-200/60 text-[#b25e00]'
                : status.tone === 'danger'
                ? 'bg-[#fff2f1] border-red-200/60 text-[#d70015]'
                : 'bg-[#f5f5f7] border-slate-200/60 text-slate-600';
              return (
                <div key={item.openKey} className={`flex items-start gap-3 p-3.5 rounded-xl border text-xs ${toneClass}`}>
                  <Clock size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">{item.title}</div>
                    <div className="text-[11px] opacity-80 mt-0.5">Trạng thái: <strong>{status.label}</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <button
            onClick={handleSaveCampaign}
            disabled={savingCampaign}
            className="bg-[#0071e3] hover:bg-[#0077ed] text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {savingCampaign ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {savingCampaign ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>

      {/* Tích hợp Google Sheets */}
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 flex flex-col gap-5">
        <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
          Tích hợp Google Sheets <RefreshCw size={14} className="text-slate-400" />
        </h3>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đường dẫn Google Sheets (chứa danh sách công ty)</label>
            <div className="flex gap-2.5">
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/1VVH.../edit?usp=sharing"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="flex-1 px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
              />
              <button
                onClick={handleSaveImportUrl}
                disabled={savingUrl}
                className="bg-[#0071e3] hover:bg-[#0077ed] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Save size={14} /> {savingUrl ? 'Đang lưu...' : 'Lưu URL'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Lưu ý: Link này cần được cấp quyền "Bất kỳ ai có liên kết đều có thể xem" (Anyone with the link can view).</p>
          </div>
          <div className="pt-4 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Đường dẫn Google Sheets (lưu dữ liệu xuất file)</label>
            <div className="flex gap-2.5">
              <input
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/1ABC..."
                value={exportSheetUrl}
                onChange={(e) => setExportSheetUrl(e.target.value)}
                className="flex-1 px-3.5 py-2.5 bg-[#f5f5f7]/60 focus:bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:ring-2 focus:ring-[#0071e3]/20 focus:border-[#0071e3] outline-none transition-all shadow-inner"
              />
              <button
                onClick={handleSaveExportUrl}
                disabled={savingUrl}
                className="bg-[#0071e3] hover:bg-[#0077ed] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Save size={14} /> {savingUrl ? 'Đang lưu...' : 'Lưu URL'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Lưu ý: Để tính năng này hoạt động, bạn <b>bắt buộc</b> phải cấp quyền Người chỉnh sửa (Editor) cho tài khoản Service Account của bạn trên Google Sheet này.</p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Đồng bộ danh sách công ty</p>
              <p className="text-[11px] text-slate-500">Cập nhật danh sách công ty từ Google Sheet. Bạn có thể chọn giữ lại hoặc xoá đăng ký hiện tại.</p>
            </div>
            <button
              onClick={handleSyncCompanies}
              disabled={syncing}
              className="bg-white text-slate-700 border border-black/[0.08] px-4 py-2.5 rounded-xl hover:bg-[#f5f5f7] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin text-slate-500' : 'text-slate-500'} />
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#ebf4ff] text-[#005bb5] p-5 rounded-2xl text-xs leading-relaxed border border-[#bfe0ff]/80">
        <strong className="block mb-2 text-sm font-bold text-[#004085]">💡 Mẹo nhập dữ liệu vào Google Sheets:</strong>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Từ danh sách Quản trị &gt; Bấm <strong>Lưu vào Google Sheets</strong> để đồng bộ dữ liệu lên bảng tính.</li>
          <li>Trên trang web Google Sheets, tạo một Bảng tính trống mới.</li>
          <li>Nếu cần nhập thủ công, có thể tải file XLSX từ hệ thống rồi import vào Google Sheets.</li>
          <li>Tùy chỉnh thông tin công ty rồi dùng tính năng Share (Bất kỳ ai có link) để lấy liên kết bỏ vào cấu hình trên.</li>
        </ol>
      </div>
    </div>
  );
}
