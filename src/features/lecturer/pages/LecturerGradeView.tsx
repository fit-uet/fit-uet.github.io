import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, RefreshCw, FileText, Download, ChevronLeft, Award, Clock, AlertCircle, Sparkles, Lock } from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, PageDescriptionTooltip, CACHE_TTL, cachedJsonFetch } from '../../../shared';
import { ReportReviewPanel, type ReviewTarget } from './ReportReviewPanel';

const SCORE_FIELDS = ['progress_score', 'report_score', 'company_score'] as const;
type ScoreField = typeof SCORE_FIELDS[number];

export function LecturerGradeView({ token, user }: { token: string; user: any }) {
  const navigate = useNavigate();
  const [grades, setGrades] = useState<any[]>([]);
  const [gradeEdits, setGradeEdits] = useState<Record<string, any>>({});
  const [campaign, setCampaign] = useState<any>(null);
  const [loadingGrades, setLoadingGrades] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});

  const fetchGrades = () => {
    setLoadingGrades(true);
    fetch(`${API_BASE}/api/lecturer/grades`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setGrades(list);
        setGradeEdits(
          Object.fromEntries(
            list.map((row: any) => [
              String(row.user_id),
              {
                progress_score: row.progress_score ?? '',
                report_score: row.report_score ?? '',
                company_score: row.company_score ?? '',
                comment: row.comment || '',
              },
            ])
          )
        );
        setScoreErrors({});
      })
      .catch(() => setGrades([]))
      .finally(() => setLoadingGrades(false));
  };

  useEffect(() => {
    fetchGrades();
    cachedJsonFetch<any>(`${API_BASE}/api/settings/campaign`, {
      cacheKey: 'settings:campaign',
      ttlMs: CACHE_TTL.campaign,
      headers: { Authorization: `Bearer ${token}` },
    }).then((data) => {
      if (data && !data.error) setCampaign(data);
    });
  }, [token]);

  const statusLabel = (status?: string, gradeStatus?: string) =>
    status === 'accepted'
      ? 'Đã chấp nhận'
      : status === 'needs_revision'
      ? 'Cần nộp lại'
      : status === 'submitted'
      ? (gradeStatus === 'submitted' ? 'Đã chấm điểm' : 'Chưa chấm điểm')
      : 'Chưa nộp';

  const gradeStatusLabel = (status?: string) =>
    status === 'submitted' ? 'Đã công bố' : status === 'draft' ? 'Bản nháp' : 'Chưa nhập';

  const gradingWindowStatus = useMemo(() => {
    if (user?.role === 'admin') return { status: 'open', message: '' };
    const openStr = String(campaign?.grading_open_at || '').trim();
    const closeStr = String(campaign?.grading_close_at || '').trim();
    if (!openStr && !closeStr) return { status: 'open', message: '' };
    const toUTC = (s: string) => (s ? new Date(s + ':00+07:00') : null);
    const now = new Date();
    const openUTC = openStr ? toUTC(openStr) : null;
    const closeUTC = closeStr ? toUTC(closeStr) : null;
    if (openUTC && now < openUTC) {
      return {
        status: 'not_open_yet',
        message: `Chưa đến thời gian nhập điểm học phần (Mở lúc: ${openStr.replace('T', ' ')} GMT+7).`,
      };
    }
    if (closeUTC && now > closeUTC) {
      return {
        status: 'closed',
        message: `Đã hết thời hạn nhập điểm học phần (Hạn cuối: ${closeStr.replace('T', ' ')} GMT+7). Vui lòng liên hệ Văn phòng Khoa nếu cần hỗ trợ.`,
      };
    }
    return {
      status: 'open',
      message: closeStr ? `Hạn chót nhập điểm: ${closeStr.replace('T', ' ')} (GMT+7)` : '',
    };
  }, [campaign, user?.role]);

  const previewFinalScore = (edit: any) => {
    const p = edit?.progress_score === '' ? null : Number(edit?.progress_score);
    const r = edit?.report_score === '' ? null : Number(edit?.report_score);
    const c = edit?.company_score === '' ? null : Number(edit?.company_score);
    if (![p, r, c].every((v) => v !== null && Number.isFinite(v) && v >= 0 && v <= 10)) return '-';
    // Làm tròn đến 1 chữ số sau phần thập phân theo quy chế đào tạo
    const score = Math.round(((p as number) * 0.2 + (r as number) * 0.2 + (c as number) * 0.6) * 10) / 10;
    return score.toFixed(1);
  };

  const updateGradeEdit = (userId: number, key: string, value: string) => {
    setGradeEdits((prev) => ({ ...prev, [userId]: { ...(prev[String(userId)] || {}), [key]: value } }));
  };

  const scoreErrorKey = (userId: number, field: ScoreField) => `${userId}:${field}`;
  const clearScoreError = (userId: number, field: ScoreField) => {
    const errorKey = scoreErrorKey(userId, field);
    setScoreErrors((prev) => {
      if (!prev[errorKey]) return prev;
      const next = { ...prev };
      delete next[errorKey];
      return next;
    });
  };

  const updateScoreEdit = (userId: number, field: ScoreField, value: string) => {
    if (value === '') {
      clearScoreError(userId, field);
      updateGradeEdit(userId, field, value);
      return;
    }
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      setScoreErrors((prev) => ({ ...prev, [scoreErrorKey(userId, field)]: 'Từ 0 đến 10' }));
      return;
    }
    clearScoreError(userId, field);
    updateGradeEdit(userId, field, value);
  };

  const saveGrade = async (row: any, submit = false) => {
    const edit = gradeEdits[String(row.user_id)] || {};
    const validationErrors: Record<string, string> = {};
    SCORE_FIELDS.forEach((field) => {
      const value = edit[field];
      const score = value === '' || value === null || value === undefined ? null : Number(value);
      if (submit && score === null) validationErrors[scoreErrorKey(row.user_id, field)] = 'Bắt buộc';
      else if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) {
        validationErrors[scoreErrorKey(row.user_id, field)] = 'Từ 0 đến 10';
      }
    });
    const hasExistingInputError = SCORE_FIELDS.some((field) => scoreErrors[scoreErrorKey(row.user_id, field)]);
    if (Object.keys(validationErrors).length > 0 || hasExistingInputError) {
      if (Object.keys(validationErrors).length > 0) setScoreErrors((prev) => ({ ...prev, ...validationErrors }));
      return;
    }
    const key = `${row.user_id}:${submit ? 'submit' : 'draft'}`;
    setSavingKey(key);
    try {
      const endpoint = `${API_BASE}/api/lecturer/grades/${row.user_id}${submit ? '/submit' : ''}`;
      const res = await fetch(endpoint, {
        method: submit ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(edit),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Lưu điểm thất bại.');
      fetchGrades();
    } finally {
      setSavingKey(null);
    }
  };

  const downloadReport = async (row: any) => {
    const res = await fetch(`${API_BASE}/api/reports/final/${row.user_id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return alert('Không tải được báo cáo.');
    saveAs(await res.blob(), row.original_filename || `bao-cao-${row.student_id || row.user_id}.pdf`);
  };

  const fillZeroScore = (userId: number) => {
    setGradeEdits((prev) => ({
      ...prev,
      [String(userId)]: {
        ...(prev[String(userId)] || {}),
        progress_score: '0',
        report_score: '0',
        company_score: '0',
        comment: prev[String(userId)]?.comment || 'Sinh viên không nộp báo cáo thực tập (Bỏ môn).',
      },
    }));
    clearScoreError(userId, 'progress_score');
    clearScoreError(userId, 'report_score');
    clearScoreError(userId, 'company_score');
  };

  const unsubmittedStudents = grades.filter((g: any) => !g.report_status && !g.locked_at && g.grade_status !== 'submitted');

  const fillZeroForAllUnsubmitted = () => {
    if (unsubmittedStudents.length === 0) return;
    if (!confirm(`Tự động điền 0 điểm và ghi chú 'Sinh viên không nộp báo cáo thực tập (Bỏ môn)' cho ${unsubmittedStudents.length} sinh viên chưa nộp bài?`)) return;

    setGradeEdits((prev) => {
      const next = { ...prev };
      unsubmittedStudents.forEach((row: any) => {
        next[String(row.user_id)] = {
          ...(next[String(row.user_id)] || {}),
          progress_score: '0',
          report_score: '0',
          company_score: '0',
          comment: next[String(row.user_id)]?.comment || 'Sinh viên không nộp báo cáo thực tập (Bỏ môn).',
        };
        clearScoreError(row.user_id, 'progress_score');
        clearScoreError(row.user_id, 'report_score');
        clearScoreError(row.user_id, 'company_score');
      });
      return next;
    });
  };

  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  const rowToReviewTarget = (row: any): ReviewTarget => {
    const edit = gradeEdits[String(row.user_id)] || {};
    return {
      user_id: row.user_id,
      userId: row.user_id,
      student_name: row.student_name,
      studentName: row.student_name,
      student_id: row.student_id,
      studentId: row.student_id,
      class_name: row.class_name,
      className: row.class_name,
      course_code: row.course_code,
      internship_place: row.internship_place,
      report_status: row.report_status,
      reportStatus: row.report_status,
      report_filename: row.original_filename,
      report_file_size: row.file_size,
      report_submitted_at: row.report_submitted_at,
      lecturer_comment: edit.comment ?? row.comment,
      progress_score: edit.progress_score ?? row.progress_score,
      report_score: edit.report_score ?? row.report_score,
      company_score: edit.company_score ?? row.company_score,
      final_score: row.final_score,
      comment: edit.comment ?? row.comment,
      grade_status: row.grade_status,
      locked_at: row.locked_at,
      is_primary: row.advisor_role !== 'co',
      advisor_role: row.advisor_role,
    };
  };

  const openReviewByIndex = (index: number) => {
    setReviewIndex(index);
  };

  const handlePrevStudent = () => {
    if (reviewIndex !== null && reviewIndex > 0) {
      setReviewIndex(reviewIndex - 1);
    }
  };

  const handleNextStudent = () => {
    if (reviewIndex !== null && reviewIndex < grades.length - 1) {
      setReviewIndex(reviewIndex + 1);
    }
  };

  const stats = {
    total: grades.length,
    missing: grades.filter((row) => !row.grade_status || row.grade_status === 'missing').length,
    draft: grades.filter((row) => row.grade_status === 'draft').length,
    submitted: grades.filter((row) => row.grade_status === 'submitted').length,
    locked: grades.filter((row) => row.locked_at).length,
  };

  return (
    <>
      {/* Review Panel overlay */}
      {reviewIndex !== null && grades[reviewIndex] && (
        <ReportReviewPanel
          target={rowToReviewTarget(grades[reviewIndex])}
          token={token}
          onClose={() => setReviewIndex(null)}
          onReportStatusChange={fetchGrades}
          onGradeChange={fetchGrades}
          currentIndex={reviewIndex}
          totalCount={grades.length}
          onPrev={handlePrevStudent}
          onNext={handleNextStudent}
          hasPrev={reviewIndex > 0}
          hasNext={reviewIndex < grades.length - 1}
          windowClosed={gradingWindowStatus.status !== 'open'}
          windowMessage={gradingWindowStatus.message}
        />
      )}

      <div className="max-w-7xl mx-auto space-y-6 pb-12">
        {/* Banner cảnh báo thời hạn chấm điểm */}
        {gradingWindowStatus.status === 'closed' && (
          <div className="bg-[#fee2e2] border border-[#fecaca] text-[#d70015] rounded-2xl p-4 text-xs flex items-center gap-2.5 font-medium shadow-xs">
            <AlertCircle size={18} className="shrink-0 text-[#d70015]" />
            <div>
              <strong>Đã đóng cổng nhập điểm học phần:</strong> {gradingWindowStatus.message}
            </div>
          </div>
        )}

        {gradingWindowStatus.status === 'not_open_yet' && (
          <div className="bg-[#ffedd5] border border-[#ffe1a6] text-[#b25e00] rounded-2xl p-4 text-xs flex items-center gap-2.5 font-medium shadow-xs">
            <Clock size={18} className="shrink-0 text-[#b25e00]" />
            <div>
              <strong>Chưa mở cổng nhập điểm:</strong> {gradingWindowStatus.message}
            </div>
          </div>
        )}

        {gradingWindowStatus.status === 'open' && gradingWindowStatus.message && (
          <div className="bg-[#f0f9ff] border border-[#bae6fd] text-[#0369a1] rounded-2xl p-3 text-xs flex items-center gap-2.5 font-medium shadow-xs">
            <Clock size={15} className="shrink-0 text-[#0284c7]" />
            <div>
              <strong>Thời hạn chấm điểm:</strong> {gradingWindowStatus.message}
            </div>
          </div>
        )}
        {/* Apple Large Title & Navigation Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <button
              onClick={() => navigate(user?.role === 'admin' ? '/admin' : '/')}
              className="group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#64748b] bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:text-[#0f172a] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer mb-3"
            >
              <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
              {user?.role === 'admin' ? 'Quản trị hệ thống' : 'Trang chủ'}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shadow-inner shrink-0">
                <Award size={22} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-[#0f172a] tracking-tight flex items-center gap-2">
                  Chấm điểm thực tập
                  <PageDescriptionTooltip
                    description={
                      <div>
                        <p>Chỉ giảng viên hướng dẫn chính được nhập và nộp điểm trên hệ thống.</p>
                        <p className="mt-1 font-semibold">Công thức: 20% định kỳ + 20% báo cáo + 60% doanh nghiệp/GVHD.</p>
                      </div>
                    }
                  />
                </h1>
                <p className="text-xs text-[#64748b] mt-0.5 font-medium">
                  Bấm «Xem & Chấm» để mở khung xem PDF và nhập điểm đồng thời trên màn hình
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={fetchGrades}
            disabled={loadingGrades}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0f172a] bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f8fafc] active:scale-[0.98] transition-all cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw size={13} className={loadingGrades ? 'animate-spin text-[#034ea1]' : 'text-[#64748b]'} />
            Tải lại
          </button>
        </div>

        {/* Apple KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">Tổng sinh viên</span>
            <div className="mt-2 text-3xl font-black text-[#0f172a] tracking-tight">{stats.total}</div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">Chưa có điểm</span>
            <div className="mt-2 text-3xl font-black text-[#64748b] tracking-tight">{stats.missing}</div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">Bản nháp</span>
            <div className="mt-2 text-3xl font-black text-[#c2410c] tracking-tight">{stats.draft}</div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">Đã nộp điểm</span>
            <div className="mt-2 text-3xl font-black text-[#15803d] tracking-tight">{stats.submitted}</div>
          </div>

          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <span className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider">Khoa đã khóa</span>
            <div className="mt-2 text-3xl font-black text-[#b91c1c] tracking-tight">{stats.locked}</div>
          </div>
        </div>

        {/* Banner quy định hoàn thiện điểm của Khoa */}
        <div className="bg-gradient-to-r from-[#eff6ff] to-[#f8fafc] border border-[#bfdbfe] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#034ea1]/10 text-[#034ea1] flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle size={18} />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0f172a]">
                Yêu cầu của Khoa: Hoàn thiện điểm cho 100% sinh viên được phân công
              </div>
              <p className="text-[11px] text-[#475569] mt-0.5 leading-relaxed">
                Giảng viên cần nộp điểm cho tất cả sinh viên phụ trách. Với sinh viên <strong>không nộp báo cáo hoặc bỏ môn</strong>, thầy/cô vui lòng <strong>cho 0 điểm</strong> kèm ghi chú lý do để Khoa chốt bảng điểm gửi Phòng Đào tạo.
              </p>
            </div>
          </div>
          {unsubmittedStudents.length > 0 && gradingWindowStatus.status === 'open' && (
            <button
              type="button"
              onClick={fillZeroForAllUnsubmitted}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold text-[#b91c1c] bg-white border border-[#fecaca] hover:bg-[#fff1f2] shadow-xs active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              Điền 0đ cho {unsubmittedStudents.length} SV chưa nộp báo cáo
            </button>
          )}
        </div>

        {/* Apple Inset Grouped Table */}
        <div className="bg-white border border-black/[0.06] rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#334155]">
              <thead className="bg-[#f8fafc] text-[11px] uppercase font-bold text-[#64748b] tracking-wider border-b border-black/[0.05] select-none">
                <tr>
                  <th className="px-5 py-3.5">Sinh viên</th>
                  <th className="px-5 py-3.5">Nơi thực tập</th>
                  <th className="px-5 py-3.5">Báo cáo & Trạng thái</th>
                  <th className="px-5 py-3.5 text-center">20% Định kỳ</th>
                  <th className="px-5 py-3.5 text-center">20% Báo cáo</th>
                  <th className="px-5 py-3.5 text-center">60% Doanh nghiệp</th>
                  <th className="px-5 py-3.5 text-center">Tổng</th>
                  <th className="px-5 py-3.5 text-right">Nhận xét & Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {loadingGrades ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center text-[#64748b]">
                      Đang tải bảng điểm học phần...
                    </td>
                  </tr>
                ) : grades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center text-[#64748b]">
                      Chưa có sinh viên trong danh sách phụ trách.
                    </td>
                  </tr>
                ) : (
                  grades.map((row: any, idx: number) => {
                    const edit = gradeEdits[String(row.user_id)] || {};
                    const disabled = !!row.locked_at || gradingWindowStatus.status !== 'open';
                    const hasReport = !!row.report_status;

                    return (
                      <tr key={row.user_id} className="hover:bg-[#f8fafc]/60 transition-colors align-top">
                        <td className="px-5 py-4">
                          <div className="font-bold text-[#0f172a] text-xs">{row.student_name}</div>
                          <div className="text-xs text-[#64748b] font-mono mt-0.5">{row.student_id || '-'}</div>
                          <div className="text-[11px] text-[#64748b] mt-0.5">{row.class_name || '-'}</div>
                          {row.advisor_role === 'co' ? (
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                              Đồng hướng dẫn
                            </span>
                          ) : (
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                              Hướng dẫn chính
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-[#0f172a] font-medium max-w-[180px] truncate">
                          {row.internship_place || '-'}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                row.report_status === 'accepted' || (row.report_status === 'submitted' && row.grade_status === 'submitted')
                                  ? 'bg-[#dcfce7] text-[#1d833f] border-emerald-200/60'
                                  : row.report_status === 'needs_revision'
                                  ? 'bg-[#ffedd5] text-[#b25e00] border-amber-200/60'
                                  : row.report_status === 'submitted'
                                  ? 'bg-[#034ea1]/10 text-[#034ea1] border-[#034ea1]/20'
                                  : 'bg-[#f8fafc] text-[#64748b] border-black/[0.04]'
                              }`}
                            >
                              {statusLabel(row.report_status, row.grade_status)}
                            </span>

                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className={`text-[10px] font-semibold ${
                                  row.grade_status === 'submitted'
                                    ? 'text-[#1d833f]'
                                    : row.grade_status === 'draft'
                                    ? 'text-[#b25e00]'
                                    : 'text-[#64748b]'
                                }`}
                              >
                                {gradeStatusLabel(row.grade_status)}
                              </span>
                              {row.locked_at && (
                                <span className="text-[9px] font-bold text-[#b91c1c] bg-[#fee2e2] border border-[#fecaca] px-1.5 py-0.2 rounded-full inline-flex items-center gap-0.5">
                                  <Lock size={8} /> Đã khóa
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => openReviewByIndex(idx)}
                                className="inline-flex items-center gap-1 text-[#034ea1] hover:bg-[#034ea1]/15 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer bg-[#034ea1]/10 shadow-xs"
                              >
                                <FileText size={11} /> {hasReport ? 'Xem & Chấm' : 'Chấm điểm'}
                              </button>
                              {!hasReport && !disabled && row.grade_status !== 'submitted' && (
                                <button
                                  type="button"
                                  onClick={() => fillZeroScore(row.user_id)}
                                  title="Gán nhanh 0 điểm cho sinh viên bỏ môn"
                                  className="inline-flex items-center gap-0.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded-full text-[10px] font-bold border border-rose-200 transition-colors cursor-pointer"
                                >
                                  Gán 0đ
                                </button>
                              )}
                              {hasReport && (
                                <button
                                  onClick={() => downloadReport(row)}
                                  title="Tải file PDF"
                                  className="p-1 rounded-full text-[#64748b] hover:text-[#0f172a] hover:bg-black/[0.05] transition-colors cursor-pointer border border-black/[0.08]"
                                >
                                  <Download size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {SCORE_FIELDS.map((field) => {
                          const errorKey = scoreErrorKey(row.user_id, field);
                          const error = scoreErrors[errorKey];
                          return (
                            <td key={field} className="px-3 py-4 text-center">
                              <input
                                type="number"
                                min="0"
                                max="10"
                                step="0.1"
                                inputMode="decimal"
                                disabled={disabled}
                                value={edit[field] ?? ''}
                                onChange={(e) => updateScoreEdit(row.user_id, field, e.target.value)}
                                className={`w-18 rounded-xl px-2 py-1.5 text-xs font-bold text-center outline-none transition-all disabled:bg-[#f8fafc] disabled:text-[#64748b] bg-[#f8fafc] focus:bg-white ${
                                  error
                                    ? 'border border-[#b91c1c] focus:ring-2 focus:ring-[#b91c1c]/20'
                                    : 'border border-black/[0.08] focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20'
                                }`}
                              />
                              {error && <div className="mt-1 text-[9px] text-[#b91c1c] font-semibold">{error}</div>}
                            </td>
                          );
                        })}

                        <td className="px-5 py-4 text-center">
                          <span className="font-mono font-black text-sm text-[#1d833f]">
                            {previewFinalScore(edit)}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-right">
                          <div className="flex flex-col gap-2 items-end min-w-[180px]">
                            <input
                              disabled={disabled}
                              value={edit.comment ?? ''}
                              onChange={(e) => updateGradeEdit(row.user_id, 'comment', e.target.value)}
                              placeholder="Nhận xét của giảng viên..."
                              className="w-full border border-black/[0.08] rounded-xl px-3 py-1.5 text-xs bg-[#f8fafc] focus:bg-white focus:ring-2 focus:ring-[#034ea1]/20 focus:border-[#034ea1] outline-none transition-all disabled:bg-[#f8fafc] disabled:text-[#64748b]"
                            />
                            <div className="flex items-center gap-1.5">
                              <button
                                disabled={disabled || savingKey === `${row.user_id}:draft`}
                                onClick={() => saveGrade(row, false)}
                                className="rounded-full border border-black/[0.08] bg-white px-3 py-1 text-xs font-semibold text-[#0f172a] hover:bg-[#f8fafc] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs active:scale-[0.98]"
                              >
                                {savingKey === `${row.user_id}:draft` ? 'Đang lưu...' : 'Lưu nháp'}
                              </button>
                              <button
                                disabled={disabled || savingKey === `${row.user_id}:submit`}
                                onClick={() => saveGrade(row, true)}
                                className="rounded-full bg-[#034ea1] px-3.5 py-1 text-xs font-semibold text-white hover:bg-[#023a7a] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs active:scale-[0.98]"
                              >
                                {savingKey === `${row.user_id}:submit` ? 'Đang nộp...' : 'Nộp điểm'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
