import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  Building2,
  GraduationCap,
  FileText,
  MessageCircle,
  Mail,
  Lock,
  Clock,
  Award,
  AlertCircle,
  Sparkles,
  ChevronLeft,
  Share2,
} from 'lucide-react';
import { API_BASE, PageDescriptionTooltip } from '../../../shared';
import { Badge } from '../../../shared/ui';


export function StudentGradeView({ token }: { token: string }) {
  const navigate = useNavigate();
  const [grade, setGrade] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const statusLabel = (status?: string) => {
    if (status === 'submitted') return 'Đã công bố chính thức';
    if (status === 'draft') return 'Đang chấm (Bản nháp)';
    return 'Chưa có điểm';
  };

  const scoreText = (value: any) => (value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(1));

  const splitCsv = (value?: string) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const getLetterGrade = (score: number | null | undefined) => {
    if (score === null || score === undefined || isNaN(Number(score))) return { letter: '—', gpa: '—', label: 'Chưa có điểm' };
    const s = Number(score);
    if (s >= 9.0) return { letter: 'A+', gpa: '4.0', label: 'Xuất sắc' };
    if (s >= 8.5) return { letter: 'A', gpa: '4.0', label: 'Giỏi' };
    if (s >= 8.0) return { letter: 'B+', gpa: '3.5', label: 'Khá giỏi' };
    if (s >= 7.0) return { letter: 'B', gpa: '3.0', label: 'Khá' };
    if (s >= 6.5) return { letter: 'C+', gpa: '2.5', label: 'Trung bình khá' };
    if (s >= 5.5) return { letter: 'C', gpa: '2.0', label: 'Trung bình' };
    if (s >= 5.0) return { letter: 'D+', gpa: '1.5', label: 'Trung bình yếu' };
    if (s >= 4.0) return { letter: 'D', gpa: '1.0', label: 'Đạt' };
    return { letter: 'F', gpa: '0.0', label: 'Không đạt' };
  };

  useEffect(() => {
    const fetchGrade = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/grades/my`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setGrade(data && !data.error ? data : null);
      } catch (e) {
        alert('Không tải được điểm thực tập.');
      } finally {
        setLoading(false);
      }
    };
    fetchGrade();
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 text-[#64748b]">
        <div className="w-9 h-9 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mb-3.5" />
        <span className="text-xs font-medium tracking-wide">Đang tải bảng điểm học phần...</span>
      </div>
    );
  }

  const finalScoreNum = grade?.final_score !== null && grade?.final_score !== undefined ? Number(grade.final_score) : null;
  const progressScoreNum = grade?.progress_score !== null && grade?.progress_score !== undefined ? Number(grade.progress_score) : null;
  const reportScoreNum = grade?.report_score !== null && grade?.report_score !== undefined ? Number(grade.report_score) : null;
  const companyScoreNum = grade?.company_score !== null && grade?.company_score !== undefined ? Number(grade.company_score) : null;

  const letterInfo = getLetterGrade(finalScoreNum);
  const primaryEmails = splitCsv(grade?.primary_advisor_emails);
  const coEmails = splitCsv(grade?.co_advisor_emails);

  // SVG Ring calculations (radius 64, circumference 2 * pi * 64 ≈ 402.12)
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const percent = finalScoreNum !== null ? Math.min(100, Math.max(0, finalScoreNum * 10)) : 0;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="max-w-6xl mx-auto space-y-7 pb-12">
      {/* Apple Navigation & Large Title Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/')}
            className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#64748b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
          >
            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
            Trang chủ
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shadow-inner shrink-0">
              <Award size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                Kết quả & Điểm học phần
                <PageDescriptionTooltip description="Xem bảng điểm chi tiết theo 3 đầu điểm trọng số (20% - 20% - 60%) và nhận xét từ giảng viên hướng dẫn." />
              </h1>
              <p className="text-xs text-[#64748b] mt-0.5 font-medium">
                Học phần Thực tập thực tế · Khoa Công nghệ Thông tin (FIT - UET)
              </p>
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => navigate('/chat')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer"
          >
            <MessageCircle size={14} className="text-[#034ea1]" />
            Trao đổi với GVHD
          </button>
          <button
            onClick={() => navigate('/reports/final')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer"
          >
            <FileText size={14} className="text-[#64748b]" />
            Báo cáo đã nộp
          </button>
        </div>
      </div>

      {/* Hero Grade Showcase - Apple Bento Composition */}
      <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Hero Left: Circular Ring & Achievement Identity */}
          <div className="lg:col-span-5 p-8 sm:p-10 bg-gradient-to-br from-[#034ea1]/[0.03] via-[#15803d]/[0.02] to-transparent border-b lg:border-b-0 lg:border-r border-black/[0.05] flex flex-col justify-between items-center text-center">
            {/* Status Capsule */}
            <div className="w-full flex items-center justify-between mb-6">
              <span className="text-[11px] font-bold tracking-widest text-[#64748b] uppercase">
                Điểm tổng kết
              </span>
              <Badge
                variant={
                  grade?.grade_status === 'submitted'
                    ? 'success'
                    : grade?.grade_status === 'draft'
                    ? 'warning'
                    : 'neutral'
                }
                size="sm"
                pulse={grade?.grade_status === 'submitted'}
              >
                {statusLabel(grade?.grade_status)}
              </Badge>

            </div>

            {/* Apple Circular Score Ring */}
            <div className="relative my-2 flex items-center justify-center">
              <svg className="w-48 h-48 -rotate-90 transform" viewBox="0 0 160 160">
                {/* Background Track */}
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  stroke="#f2f2f7"
                  strokeWidth="12"
                  fill="transparent"
                />
                {/* Score Progress Ring */}
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  stroke={finalScoreNum && finalScoreNum >= 8.5 ? '#15803d' : '#034ea1'}
                  strokeWidth="12"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>

              {/* Centered Score */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-black text-[#0f172a] tracking-tight leading-none">
                  {scoreText(grade?.final_score)}
                </span>
                <span className="text-xs font-semibold text-[#64748b] mt-1.5 tracking-wider">
                  / 10.0
                </span>
              </div>
            </div>

            {/* Classification & GPA Badges */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <span className="px-3.5 py-1.5 rounded-xl bg-[#0f172a] text-white font-extrabold text-xs shadow-xs tracking-tight">
                Điểm chữ: {letterInfo.letter}
              </span>
              <span className="px-3.5 py-1.5 rounded-xl bg-white border border-black/[0.08] text-[#0f172a] font-semibold text-xs shadow-xs">
                GPA: {letterInfo.gpa} · {letterInfo.label}
              </span>
            </div>

            {/* Bottom Status Seal */}
            <div className="w-full pt-6 mt-6 border-t border-black/[0.05] flex items-center justify-between text-xs text-[#64748b]">
              <div className="flex items-center gap-1.5 text-left">
                {grade?.locked_at ? (
                  <>
                    <Lock size={13} className="text-[#15803d] shrink-0" />
                    <span className="font-semibold text-[#1d833f]">Khoa đã chốt điểm chính thức</span>
                  </>
                ) : (
                  <>
                    <Clock size={13} className="text-[#64748b] shrink-0" />
                    <span>
                      {grade?.grade_submitted_at
                        ? `Cập nhật: ${new Date(grade.grade_submitted_at).toLocaleDateString('vi-VN')}`
                        : 'Chờ giảng viên nhập điểm'}
                    </span>
                  </>
                )}
              </div>
              <span className="text-[11px] font-medium text-[#64748b]">Hệ số 10</span>
            </div>
          </div>

          {/* Hero Right: Weighted Breakdown Meters */}
          <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-6 pb-3 border-b border-black/[0.04]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center">
                    <Sparkles size={15} />
                  </div>
                  <h2 className="text-sm font-bold text-[#0f172a] tracking-tight">
                    Cơ cấu 3 đầu điểm thành phần
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-[#64748b] bg-[#f8fafc] px-2.5 py-1 rounded-full">
                  Quy chế Đào tạo FIT UET
                </span>
              </div>

              {/* Progress Meters */}
              <div className="space-y-6">
                {/* 1. Progress Score - 20% */}
                <div className="p-4 rounded-2xl bg-[#f8fafc] border border-black/[0.03]">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#034ea1]/10 text-[#034ea1] text-[11px] font-bold flex items-center justify-center">
                        1
                      </span>
                      <span className="font-bold text-[#0f172a]">
                        Điểm định kỳ / Tiến độ <span className="font-normal text-[#64748b]">(Tỉ trọng 20%)</span>
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono font-extrabold text-sm text-[#0f172a]">
                        {scoreText(grade?.progress_score)}
                      </span>
                      {progressScoreNum !== null && (
                        <span className="text-[11px] text-[#64748b] font-medium">
                          ({((progressScoreNum * 0.2)).toFixed(2)} đ)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-[#f2f2f7] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#034ea1] transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, (progressScoreNum ?? 0) * 10))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#64748b] mt-1.5 leading-normal">
                    Đánh giá quá trình liên hệ, báo cáo tiến độ định kỳ với Giảng viên hướng dẫn.
                  </p>
                </div>

                {/* 2. Report Score - 20% */}
                <div className="p-4 rounded-2xl bg-[#f8fafc] border border-black/[0.03]">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#034ea1]/10 text-[#034ea1] text-[11px] font-bold flex items-center justify-center">
                        2
                      </span>
                      <span className="font-bold text-[#0f172a]">
                        Điểm báo cáo thực tập <span className="font-normal text-[#64748b]">(Tỉ trọng 20%)</span>
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono font-extrabold text-sm text-[#0f172a]">
                        {scoreText(grade?.report_score)}
                      </span>
                      {reportScoreNum !== null && (
                        <span className="text-[11px] text-[#64748b] font-medium">
                          ({((reportScoreNum * 0.2)).toFixed(2)} đ)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-[#f2f2f7] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#034ea1] transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, (reportScoreNum ?? 0) * 10))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#64748b] mt-1.5 leading-normal">
                    Đánh giá nội dung, cấu trúc và chất lượng quyển báo cáo PDF nộp trên hệ thống.
                  </p>
                </div>

                {/* 3. Company Score - 60% */}
                <div className="p-4 rounded-2xl bg-[#f8fafc] border border-black/[0.03]">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#15803d]/10 text-[#15803d] text-[11px] font-bold flex items-center justify-center">
                        3
                      </span>
                      <span className="font-bold text-[#0f172a]">
                        Điểm công ty / Đơn vị thực tập <span className="font-normal text-[#64748b]">(Tỉ trọng 60%)</span>
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono font-extrabold text-sm text-[#0f172a]">
                        {scoreText(grade?.company_score)}
                      </span>
                      {companyScoreNum !== null && (
                        <span className="text-[11px] text-[#64748b] font-medium">
                          ({((companyScoreNum * 0.6)).toFixed(2)} đ)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-[#f2f2f7] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#15803d] transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, (companyScoreNum ?? 0) * 10))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#64748b] mt-1.5 leading-normal">
                    Điểm theo Phiếu đánh giá có chữ ký & dấu công ty được scan gộp trong file báo cáo (hoặc GVHD nếu TT tại Lab trường).
                  </p>
                </div>
              </div>
            </div>

            {/* Apple Formula Pill */}
            <div className="mt-6 pt-4 border-t border-black/[0.04] text-[11px] text-[#334155] font-mono bg-[#f8fafc]/70 px-4 py-2.5 rounded-xl flex items-center justify-between">
              <span>Công thức:</span>
              <strong className="text-[#0f172a]">Điểm tổng kết = (Tiến độ × 0.2) + (Báo cáo × 0.2) + (Doanh nghiệp × 0.6)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Two-Column Master-Detail Inset Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Comments & Official Notice */}
        <div className="lg:col-span-7 space-y-6">
          {/* Lecturer Comments Card */}
          <div className="bg-white border border-black/[0.06] rounded-3xl p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-black/[0.04]">
              <h3 className="text-sm font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                <MessageCircle size={16} className="text-[#034ea1]" />
                Nhận xét của Giảng viên hướng dẫn
              </h3>
              {grade?.grading_lecturer_name && (
                <span className="text-xs font-semibold text-[#64748b]">
                  GV chấm: <strong className="text-[#0f172a]">{grade.grading_lecturer_name}</strong>
                </span>
              )}
            </div>

            {grade?.comment ? (
              <div className="bg-[#f8fafc] border border-black/[0.04] rounded-2xl p-5 text-xs text-[#0f172a] leading-relaxed whitespace-pre-wrap font-medium">
                "{grade.comment}"
              </div>
            ) : (
              <div className="bg-[#f8fafc]/60 rounded-2xl p-7 text-center text-xs text-[#64748b] font-medium">
                Giảng viên chưa để lại nhận xét văn bản bổ sung.
              </div>
            )}
          </div>

          {/* Feedback & Inquiries Callout */}
          <div className="bg-[#034ea1]/[0.05] border border-[#034ea1]/15 rounded-3xl p-6 text-xs text-[#005bb5] leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle size={17} />
              </div>
              <div className="space-y-1">
                <strong className="block font-bold text-[#004085] text-sm">
                  Quy định thắc mắc & Phúc khảo điểm số
                </strong>
                <p className="text-[#005bb5]">
                  Nếu có câu hỏi hoặc cần giải trình về kết quả đánh giá học phần, sinh viên vui lòng chủ động liên hệ với Giảng viên hướng dẫn qua tính năng <strong>Trao đổi</strong> trên hệ thống hoặc email trong thời hạn 07 ngày kể từ khi công bố điểm.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Inset Grouped Internship Passport */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-black/[0.06] rounded-3xl p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-sm font-bold text-[#0f172a] tracking-tight mb-4 pb-3 border-b border-black/[0.04] flex items-center gap-2">
              <GraduationCap size={17} className="text-[#0f172a]" />
              Hồ sơ phân công & Nơi thực tập
            </h3>

            <div className="divide-y divide-black/[0.04] text-xs">
              {/* Internship Company */}
              <div className="py-3.5 flex items-start gap-3.5">
                <div className="w-9 h-9 rounded-2xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                  <Building2 size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider">
                    Nơi thực tập
                  </span>
                  <div className="font-bold text-[#0f172a] text-sm mt-0.5 truncate">
                    {grade?.internship_place || 'Chưa xác nhận'}
                  </div>
                  {grade?.confirmed_at && (
                    <div className="text-[11px] text-[#64748b] mt-0.5">
                      Xác nhận: {new Date(grade.confirmed_at).toLocaleDateString('vi-VN')}
                    </div>
                  )}
                </div>
              </div>

              {/* Primary Advisor */}
              <div className="py-3.5 flex items-start gap-3.5">
                <div className="w-9 h-9 rounded-2xl bg-[#15803d]/10 text-[#15803d] flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                  <GraduationCap size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider">
                    GVHD chính
                  </span>
                  <div className="font-bold text-[#0f172a] text-sm mt-0.5">
                    {grade?.primary_advisors || 'Chưa phân công'}
                  </div>
                  {primaryEmails.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {primaryEmails.map((email) => (
                        <a
                          key={email}
                          href={`mailto:${email}`}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#034ea1]/10 text-[#034ea1] hover:bg-[#034ea1]/20 transition-colors"
                        >
                          <Mail size={10} /> {email}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Co-advisors if any */}
              {grade?.co_advisors && (
                <div className="py-3.5 flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-2xl bg-[#af52de]/10 text-[#af52de] flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                    <GraduationCap size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider">
                      Đồng hướng dẫn
                    </span>
                    <div className="font-bold text-[#0f172a] text-sm mt-0.5">{grade.co_advisors}</div>
                    {coEmails.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {coEmails.map((email) => (
                          <a
                            key={email}
                            href={`mailto:${email}`}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#af52de]/10 text-[#af52de] hover:bg-[#af52de]/20 transition-colors"
                          >
                            <Mail size={10} /> {email}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
