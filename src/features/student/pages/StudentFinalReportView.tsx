import { CampaignLegacyHeader } from '../../academic/CampaignLayoutContext';
import { apiFetch as fetch } from '../../../shared/utils/requestCache';
import { useNavigate } from 'react-router-dom';
import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Download, RefreshCw, FileText, CheckCircle2, ExternalLink, FileCheck } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, CACHE_TTL, cachedJsonFetch, PageDescriptionTooltip } from '../../../shared';
import { Badge } from '../../../shared/ui';


export function StudentFinalReportView({ token, user }: { token: string; user: any }) {
  const [campaign, setCampaign] = useState<any>({});
  const [finalInternship, setFinalInternship] = useState<any>(null);
  const [finalReport, setFinalReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  const formatGMT7Local = (isoLocal: string) => {
    if (!isoLocal) return '—';
    const [date, time] = isoLocal.split('T');
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y} ${time}`;
  };

  const formatBytesLocal = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const reportStatusLabelLocal = (status?: string) => {
    if (status === 'accepted') return 'Đã duyệt báo cáo';
    if (status === 'needs_revision') return 'Cần nộp lại';
    if (status === 'submitted') return 'Đã nộp thành công';
    return 'Chưa nộp báo cáo';
  };

  const finalReportWindowStatus = useMemo(() => {
    const openStr = String(campaign?.final_report_open_at || '').trim();
    const closeStr = String(campaign?.final_report_close_at || '').trim();
    if (!openStr && !closeStr) return 'unconfigured';
    const toUTC = (s: string) => (s ? new Date(s + ':00+07:00') : null);
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) return 'not_open_yet';
    if (closeUTC && now > closeUTC) return 'closed';
    return 'open';
  }, [campaign]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [campRes, finalRes, reportRes] = await Promise.all([
        cachedJsonFetch<any>(`${API_BASE}/api/settings/campaign`, {
          cacheKey: 'settings:campaign',
          ttlMs: CACHE_TTL.campaign,
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/internships/final/my`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/reports/final/my`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const campData = campRes;
      const finalData = await finalRes.json().catch(() => null);
      const reportData = await reportRes.json().catch(() => null);
      if (campData && !campData.error) setCampaign(campData);
      setFinalInternship(finalData && !finalData.error ? finalData : null);
      setFinalReport(reportData && !reportData.error ? reportData : null);
    } catch (e) {
      alert('Không tải được dữ liệu báo cáo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const uploadFinalReport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      alert('Vui lòng chọn file PDF.');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File PDF vượt quá 10 MB. Vui lòng nén PDF xuống tối đa 10 MB rồi nộp lại.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/final`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/pdf',
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'Nộp báo cáo thất bại.');
      setFinalReport(data);
      alert('Đã nộp báo cáo thành công.');
    } catch (e) {
      alert('Lỗi kết nối khi nộp báo cáo.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const downloadMyFinalReport = async () => {
    if (!finalReport) return;
    const res = await fetch(`${API_BASE}/api/reports/final/${user.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('Không tải được báo cáo đã nộp.');
    saveAs(await res.blob(), finalReport.original_filename || 'final-report.pdf');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <div className="w-8 h-8 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3" />
        <span className="text-xs font-medium">Đang tải thông tin báo cáo...</span>
      </div>
    );
  }

  const internshipPlaceName = finalInternship
    ? finalInternship.internship_type === 'school'
      ? 'Trường Đại học Công nghệ'
      : finalInternship.company_name === 'Công ty khác'
      ? finalInternship.other_company_name || 'Công ty khác'
      : finalInternship.company_name
    : 'Chưa xác nhận';

  const headerActions = (<a
          href="https://drive.google.com/drive/u/0/folders/14Fm4yP-2Psj_qMpzI0pBARkcww1sblA3"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white text-slate-700 border border-black/[0.08] px-3.5 py-2 rounded-xl hover:bg-[#f8fafc] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <ExternalLink size={14} className="text-slate-400" /> Tải mẫu báo cáo của Khoa
        </a>);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Navigation & Header */}
      <CampaignLegacyHeader actions={headerActions}><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-white border border-black/[0.08] shadow-xs hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-2.5"
          >
            &larr; Quay lại trang chủ
          </button>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-[#034ea1] flex items-center justify-center">
              <FileText size={18} />
            </div>
            Báo cáo thực tập
            <PageDescriptionTooltip description="Nộp 01 file báo cáo PDF hoàn chỉnh (đã scan gộp trang Phiếu đánh giá có dấu mộc công ty) để GVHD chấm và nhập điểm." />
          </h2>
        </div>
        {headerActions}
      </div></CampaignLegacyHeader>

      {/* Two-Column Apple Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left / Main: Document Hub & Upload Zone */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200/80 rounded-3xl p-7 shadow-xs space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FileCheck size={18} className="text-[#034ea1]" /> Trạng thái nộp bài
              </h3>
              <Badge
                variant={
                  finalReport?.status === 'accepted'
                    ? 'success'
                    : finalReport?.status === 'submitted'
                    ? 'info'
                    : finalReport?.status === 'needs_revision'
                    ? 'error'
                    : 'neutral'
                }
                size="md"
              >
                {reportStatusLabelLocal(finalReport?.status)}
              </Badge>

            </div>

            {!finalInternship ? (
              <div className="rounded-2xl border border-amber-200/80 bg-[#ffedd5] p-5 text-xs text-amber-900 leading-relaxed">
                <strong className="block font-bold text-amber-800 mb-1">Chưa xác nhận nơi thực tập</strong>
                Bạn cần hoàn tất bước xác nhận nơi thực tập chính thức trên trang chủ trước khi nộp báo cáo.
              </div>
            ) : finalReport ? (
              /* Already Submitted - Apple Document Card */
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc] p-5 flex items-start gap-4">
                  <div className="w-12 h-14 rounded-xl bg-red-50 border border-red-100 text-red-600 flex flex-col items-center justify-center shrink-0 shadow-xs">
                    <FileText size={22} />
                    <span className="text-[9px] font-black uppercase mt-0.5 tracking-wider">PDF</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-900 text-sm truncate" title={finalReport.original_filename}>
                      {finalReport.original_filename}
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      {formatBytesLocal(Number(finalReport.file_size || 0))} · Nộp lúc{' '}
                      {new Date(finalReport.submitted_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                </div>

                {finalReport.lecturer_comment && (
                  <div className="rounded-2xl border border-amber-200/80 bg-[#ffedd5] p-4 text-xs text-amber-900 leading-relaxed">
                    <strong className="block font-bold text-amber-800 mb-1">Ghi chú của Giảng viên hướng dẫn:</strong>
                    {finalReport.lecturer_comment}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={downloadMyFinalReport}
                    className="bg-white text-slate-700 border border-black/[0.08] px-4 py-2 rounded-xl hover:bg-[#f8fafc] active:scale-[0.98] text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={14} /> Tải file PDF đã nộp
                  </button>
                  {finalReportWindowStatus === 'open' && (
                    <label className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer">
                      {uploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      {uploading ? 'Đang tải lên...' : 'Nộp lại bản PDF mới'}
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={uploading}
                        className="hidden"
                        onChange={uploadFinalReport}
                      />
                    </label>
                  )}
                </div>
              </div>
            ) : (
              /* Not Submitted Yet - Apple Dropzone */
              <div className="space-y-4">
                <label
                  className={`border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all ${
                    finalReportWindowStatus === 'open' && !uploading
                      ? 'border-slate-200 hover:border-[#034ea1] bg-[#f8fafc]/40 hover:bg-white cursor-pointer group'
                      : 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#034ea1] flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-xs">
                    {uploading ? <RefreshCw size={24} className="animate-spin" /> : <Upload size={24} />}
                  </div>
                  <span className="text-sm font-bold text-slate-900 mb-1">
                    {uploading ? 'Đang nộp báo cáo...' : 'Bấm vào đây để chọn file PDF'}
                  </span>
                  <span className="text-xs text-slate-400 max-w-sm">
                    Định dạng file PDF, dung lượng tối đa 10 MB. Hệ thống sẽ lưu trữ và gửi trực tiếp cho Giảng viên hướng dẫn chấm.
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={finalReportWindowStatus !== 'open' || uploading}
                    className="hidden"
                    onChange={uploadFinalReport}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Right / Sidebar: Timeline & Submission Requirements */}
        <div className="lg:col-span-5 space-y-6">
          {/* Submission Window Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thời hạn nộp báo cáo</h4>
              <Badge
                variant={
                  finalReportWindowStatus === 'open'
                    ? 'success'
                    : finalReportWindowStatus === 'not_open_yet'
                    ? 'warning'
                    : finalReportWindowStatus === 'unconfigured'
                    ? 'neutral'
                    : 'error'
                }
                size="sm"
              >
                {finalReportWindowStatus === 'open'
                  ? 'Đang mở nộp'
                  : finalReportWindowStatus === 'not_open_yet'
                  ? 'Chưa mở nộp'
                  : finalReportWindowStatus === 'unconfigured'
                  ? 'Chưa cấu hình'
                  : 'Đã hết hạn'}
              </Badge>

            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">Mở nộp lúc:</span>
                <strong className="text-slate-800 font-mono">{formatGMT7Local(campaign.final_report_open_at)}</strong>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span className="text-slate-500">Hạn chót:</span>
                <strong className="text-slate-800 font-mono">{formatGMT7Local(campaign.final_report_close_at)}</strong>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500">Nơi thực tập:</span>
                <strong className="text-slate-900 text-right truncate max-w-[200px]" title={internshipPlaceName}>
                  {internshipPlaceName}
                </strong>
              </div>
            </div>
          </div>

          {/* Submission Requirements Checklist */}
          <div className="bg-[#e8f1fb] border border-[#bfe0ff]/80 rounded-2xl p-6 text-xs text-[#005bb5] leading-relaxed space-y-3">
            <h4 className="font-bold text-sm text-[#004085] flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#034ea1]" /> Cần nộp những gì để hoàn thành?
            </h4>
            <ol className="list-decimal pl-4 space-y-2.5 text-[11px]">
              <li>
                <strong>Phiếu đánh giá & dấu công ty (60%):</strong> In riêng trang <em>Phiếu đánh giá</em> trong mẫu báo cáo của Khoa để xin nhận xét, điểm số và chữ ký của người hướng dẫn tại doanh nghiệp kèm <strong>dấu tròn của công ty</strong> (hoặc do GVHD trực tiếp đánh giá nếu TT tại Lab trường).
              </li>
              <li>
                <strong>Scan & gộp vào bản mềm (PDF):</strong> Chụp hoặc scan rõ nét trang Phiếu đánh giá đã có dấu công ty và <strong>gộp (merge) trực tiếp vào file báo cáo PDF</strong>.
              </li>
              <li>
                <strong>Nộp 01 file PDF duy nhất trên hệ thống:</strong> Nộp file PDF báo cáo hoàn chỉnh (đã bao gồm trang Phiếu đánh giá có dấu mộc) tại màn hình này để GVHD chấm toàn bộ 3 đầu điểm (20% định kỳ, 20% báo cáo, 60% doanh nghiệp). Sinh viên <strong>không cần nộp thêm phiếu giấy</strong>.
              </li>
              <li>
                <strong>Thời gian thực tập:</strong> Đảm bảo tối thiểu 06 tuần làm việc full-time tại đơn vị thực tập (hoặc tương đương).
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
