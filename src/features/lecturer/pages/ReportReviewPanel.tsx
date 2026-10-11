import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Download, AlertCircle, Loader2,
  ExternalLink, Check, ChevronLeft, ChevronRight, FileText
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE } from '../../../shared';

export interface ReviewTarget {
  user_id?: number;
  userId?: number;
  student_name?: string;
  studentName?: string;
  student_id?: string;
  studentId?: string;
  class_name?: string;
  className?: string;
  course_code?: string;
  internship_place?: string;
  report_status?: string;       // 'submitted' | 'accepted' | 'needs_revision'
  reportStatus?: string;
  report_filename?: string;
  report_file_size?: number;
  report_submitted_at?: string;
  lecturer_comment?: string;
  // Điểm
  progress_score?: number | string | null;
  report_score?: number | string | null;
  company_score?: number | string | null;
  final_score?: number | string | null;
  comment?: string | null;
  grade_status?: string;         // 'draft' | 'submitted'
  locked_at?: string | null;
  // Quyền
  is_primary?: boolean;
  advisor_role?: string;
}

interface Props {
  target: ReviewTarget;
  token: string;
  onClose: () => void;
  onReportStatusChange?: () => void;
  onGradeChange?: () => void;
  // Navigation
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  windowClosed?: boolean;
  windowMessage?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// In-memory module cache for report PDF blobs to prevent redundant downloads across review sessions
const pdfBlobCache = new Map<number, { blob: Blob; url: string; filename?: string; timestamp: number }>();

const reportStatusLabel = (s?: string, gradeStatus?: string) =>
  s === 'accepted' ? 'Đã chấp nhận'
  : s === 'needs_revision' ? 'Cần nộp lại'
  : s === 'submitted' ? (gradeStatus === 'submitted' ? 'Đã chấm điểm' : 'Chưa chấm điểm')
  : 'Chưa nộp';

const reportStatusBadgeClass = (s?: string, gradeStatus?: string) =>
  s === 'accepted' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
  : s === 'needs_revision' ? 'bg-orange-50 border-orange-200 text-orange-700'
  : s === 'submitted' ? (gradeStatus === 'submitted' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700')
  : 'bg-slate-50 border-slate-200 text-slate-500';

const calcFinal = (p: string, r: string, c: string) => {
  const pv = p === '' ? null : Number(p);
  const rv = r === '' ? null : Number(r);
  const cv = c === '' ? null : Number(c);
  if ([pv, rv, cv].some(v => v === null || !Number.isFinite(v) || (v as number) < 0 || (v as number) > 10)) return null;
  // Làm tròn đến 1 chữ số sau phần thập phân theo quy chế đào tạo
  const score = Math.round(((pv as number) * 0.2 + (rv as number) * 0.2 + (cv as number) * 0.6) * 10) / 10;
  return score.toFixed(1);
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReportReviewPanel({
  target,
  token,
  onClose,
  onReportStatusChange,
  onGradeChange,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  windowClosed,
  windowMessage,
}: Props) {
  const uid = target.user_id ?? target.userId;
  const studentName = target.student_name ?? target.studentName ?? 'Sinh viên';
  const studentId = target.student_id ?? target.studentId;
  const className = target.class_name ?? target.className;
  const initialReportStatus = target.report_status ?? target.reportStatus;

  // Local report status (updates immediately when submitted)
  const [localReportStatus, setLocalReportStatus] = useState<string | undefined>(initialReportStatus);

  // PDF state
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Tab (mobile only)
  const [activeTab, setActiveTab] = useState<'report' | 'grade'>('report');

  // Report status
  const [revisionNote, setRevisionNote] = useState('');
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);

  // Grade form
  const isPrimary = target.is_primary !== false;
  const locked = !!target.locked_at || !!windowClosed;
  const [progress, setProgress] = useState(String(target.progress_score ?? ''));
  const [report, setReport] = useState(String(target.report_score ?? ''));
  const [company, setCompany] = useState(String(target.company_score ?? ''));
  const [noteText, setNoteText] = useState(target.comment ?? '');
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});
  const [gradeSaving, setGradeSaving] = useState<null | 'draft' | 'submit'>(null);
  const [gradeSuccess, setGradeSuccess] = useState<string | null>(null);

  const finalScore = calcFinal(progress, report, company);

  // ── Sync form state when target switches ──────────────────────────────────
  useEffect(() => {
    setProgress(String(target.progress_score ?? ''));
    setReport(String(target.report_score ?? ''));
    setCompany(String(target.company_score ?? ''));
    setNoteText(target.comment ?? '');
    setScoreErrors({});
    setGradeSuccess(null);
    setShowRevisionInput(false);
    setRevisionNote('');
    setLocalReportStatus(target.report_status ?? target.reportStatus);
  }, [
    uid,
    target.progress_score,
    target.report_score,
    target.company_score,
    target.comment,
    target.report_status,
    target.reportStatus,
  ]);

  // ── Fetch freshest grade for student from server ────────────────────────
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/lecturer/grades/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const g = await res.json();
        if (cancelled || !g) return;
        if (g.progress_score !== null && g.progress_score !== undefined) {
          setProgress(String(g.progress_score));
        }
        if (g.report_score !== null && g.report_score !== undefined) {
          setReport(String(g.report_score));
        }
        if (g.company_score !== null && g.company_score !== undefined) {
          setCompany(String(g.company_score));
        }
        if (g.comment) {
          setNoteText(g.comment);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [uid, token]);

  // ── Load PDF via fetch + blob URL ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const hasReport = !!(localReportStatus || target.report_filename);

    if (!uid || !hasReport) {
      setPdfUrl(null);
      setPdfLoading(false);
      setPdfError(null);
      return;
    }

    // Check memory cache first to avoid re-fetching across review clicks
    const cached = pdfBlobCache.get(uid);
    if (cached && (!target.report_filename || cached.filename === target.report_filename)) {
      setPdfUrl(cached.url);
      setPdfLoading(false);
      setPdfError(null);
      return;
    }

    setPdfLoading(true);
    setPdfError(null);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reports/final/${uid}/view`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        pdfBlobCache.set(uid, { blob, url, filename: target.report_filename, timestamp: Date.now() });
        setPdfUrl(url);
      } catch (e: any) {
        if (!cancelled) setPdfError(e.message || 'Không tải được file báo cáo.');
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, target.report_filename, token]);

  // ── Keyboard shortcuts (Escape to close, [ and ] / Alt+Arrows to switch student) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if ((e.key === '[' || (e.altKey && e.key === 'ArrowLeft')) && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if ((e.key === ']' || (e.altKey && e.key === 'ArrowRight')) && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  // ── Prevent body scroll ───────────────────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!uid) return;
    const res = await fetch(`${API_BASE}/api/reports/final/${uid}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return alert('Không tải được báo cáo.');
    saveAs(await res.blob(), target.report_filename || `bao-cao-${studentId || uid}.pdf`);
  }, [uid, studentId, target.report_filename, token]);

  // ── Report status actions ─────────────────────────────────────────────────
  const updateReportStatus = async (status: 'accepted' | 'needs_revision') => {
    if (!uid) return;
    setReportSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/final/${uid}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, lecturer_comment: status === 'needs_revision' ? revisionNote : '' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Cập nhật thất bại.');
        return;
      }
      setShowRevisionInput(false);
      setRevisionNote('');
      setLocalReportStatus(status);
      onReportStatusChange?.();
    } finally {
      setReportSaving(false);
    }
  };

  // ── Grade actions ─────────────────────────────────────────────────────────
  const validateScore = (val: string, field: string) => {
    if (val === '') return true;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      setScoreErrors(prev => ({ ...prev, [field]: '0 – 10' }));
      return false;
    }
    setScoreErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    return true;
  };

  const saveGrade = async (submit: boolean) => {
    if (!uid) return;
    const allValid = [
      validateScore(progress, 'progress'),
      validateScore(report, 'report'),
      validateScore(company, 'company'),
    ].every(Boolean);
    if (!allValid) return;
    if (submit && [progress, report, company].some(v => v === '')) {
      alert('Vui lòng nhập đủ 3 đầu điểm trước khi nộp.');
      return;
    }

    setGradeSaving(submit ? 'submit' : 'draft');
    setGradeSuccess(null);
    try {
      const endpoint = `${API_BASE}/api/lecturer/grades/${uid}${submit ? '/submit' : ''}`;
      const res = await fetch(endpoint, {
        method: submit ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          progress_score: progress === '' ? null : Number(progress),
          report_score: report === '' ? null : Number(report),
          company_score: company === '' ? null : Number(company),
          comment: noteText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'Lưu điểm thất bại.'); return; }
      if (submit) {
        setGradeSuccess('Đã nộp điểm và chấp nhận báo cáo!');
        setLocalReportStatus('accepted');
        onReportStatusChange?.();
      } else {
        setGradeSuccess('Đã lưu nháp điểm.');
      }
      onGradeChange?.();
      setTimeout(() => setGradeSuccess(null), 3000);
    } finally {
      setGradeSaving(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full h-[95vh] max-w-7xl flex flex-col overflow-hidden animate-in fade-in duration-100">

        {/* ── Single-line Minimal Header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white flex-shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            {/* Student Navigation Pill */}
            {typeof currentIndex === 'number' && typeof totalCount === 'number' && totalCount > 1 && (
              <div className="inline-flex items-center bg-slate-100 border border-slate-200/90 rounded-lg p-0.5 gap-0.5 text-xs text-slate-700 shadow-2xs mr-1">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  title="Sinh viên trước (Phím [ hoặc Alt+←)"
                  aria-label="Sinh viên trước"
                  className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="font-mono font-semibold px-1.5 text-slate-600 select-none text-[11px] min-w-[42px] text-center">
                  {currentIndex + 1} / {totalCount}
                </span>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  title="Sinh viên tiếp theo (Phím ] hoặc Alt+→)"
                  aria-label="Sinh viên tiếp theo"
                  className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}

            <span className="text-sm font-bold text-slate-800 truncate">{studentName}</span>
            {studentId && (
              <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                {studentId}
              </span>
            )}
            {className && (
              <span className="text-xs text-slate-400">({className})</span>
            )}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${reportStatusBadgeClass(localReportStatus, target.grade_status)}`}>
              {reportStatusLabel(localReportStatus, target.grade_status)}
            </span>
            {locked && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${target.locked_at ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                {target.locked_at ? 'Đã khóa điểm' : 'Hết hạn chấm điểm'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors"
                title="Mở trong tab mới"
                aria-label="Mở trong tab mới"
              >
                <ExternalLink size={15} />
              </a>
            )}
            {localReportStatus && (
              <button
                onClick={handleDownload}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                title="Tải PDF"
                aria-label="Tải PDF"
              >
                <Download size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Đóng"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Đóng (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Mobile Tab Switcher ── */}
        <div className="flex md:hidden border-b border-slate-200 bg-slate-50 flex-shrink-0 px-2 pt-1 gap-1">
          <button
            onClick={() => setActiveTab('report')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-t-lg transition-colors ${
              activeTab === 'report' ? 'bg-white text-blue-700 border-t border-x border-slate-200' : 'text-slate-600'
            }`}
          >
            Báo cáo
          </button>
          <button
            onClick={() => setActiveTab('grade')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-t-lg transition-colors ${
              activeTab === 'grade' ? 'bg-white text-blue-700 border-t border-x border-slate-200' : 'text-slate-600'
            }`}
          >
            Chấm điểm
          </button>
        </div>

        {/* ── Body: Split-pane ── */}
        <div className="flex flex-1 min-h-0">

          {/* ── LEFT: PDF Viewer (Edge-to-Edge) ── */}
          <div
            className={`
              flex-col bg-slate-100 border-r border-slate-200
              ${activeTab === 'report' ? 'flex' : 'hidden'} md:flex
              w-full md:w-[62%] lg:w-[65%] relative
            `}
          >
            {pdfLoading && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 size={28} className="animate-spin text-blue-600" />
                <span className="text-xs">Đang tải PDF...</span>
              </div>
            )}

            {pdfError && !pdfLoading && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertCircle size={32} className="text-amber-500" />
                <div className="text-sm font-semibold text-slate-700">Không thể xem trực tiếp PDF</div>
                <div className="text-xs text-slate-400 max-w-sm">{pdfError}</div>
                {localReportStatus && (
                  <button
                    onClick={handleDownload}
                    className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    <Download size={13} /> Tải PDF về máy
                  </button>
                )}
              </div>
            )}

            {pdfUrl && !pdfLoading && (
              <iframe
                src={pdfUrl}
                title={`Báo cáo - ${studentName}`}
                className="w-full h-full border-0 bg-white"
              />
            )}

            {!pdfLoading && !pdfUrl && !pdfError && (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-400 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-200/70 flex items-center justify-center text-slate-400 shadow-inner">
                  <FileText size={24} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Chưa có file báo cáo</p>
                  <p className="text-xs text-slate-400 mt-0.5">Sinh viên chưa nộp báo cáo thực tập cuối kỳ.</p>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Compact Grading & Review ── */}
          <div
            className={`
              flex-col bg-white overflow-y-auto
              ${activeTab === 'grade' ? 'flex' : 'hidden'} md:flex
              w-full md:w-[38%] lg:w-[35%]
            `}
          >
            <div className="p-4 space-y-4">

              {/* 1. Duyệt báo cáo (chỉ khi có báo cáo) */}
              {localReportStatus && (
                <div>
                  {localReportStatus === 'accepted' && !showRevisionInput ? (
                    <div className="flex items-center justify-between text-xs text-emerald-700 bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-3 py-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Check size={14} className="text-emerald-600" /> Báo cáo đã chấp nhận
                      </span>
                      {isPrimary && (
                        <button
                          onClick={() => setShowRevisionInput(true)}
                          className="text-[11px] text-slate-500 hover:text-orange-700 underline cursor-pointer"
                        >
                          Yêu cầu sửa
                        </button>
                      )}
                    </div>
                  ) : showRevisionInput ? (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3 space-y-2">
                      <div className="text-xs font-semibold text-orange-800">Lý do yêu cầu nộp lại</div>
                      <textarea
                        autoFocus
                        value={revisionNote}
                        onChange={e => setRevisionNote(e.target.value)}
                        rows={2}
                        placeholder="Nội dung cần sinh viên chỉnh sửa..."
                        className="w-full rounded-md border border-orange-300 bg-white p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-orange-400 resize-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setShowRevisionInput(false); setRevisionNote(''); }}
                          className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                        >
                          Hủy
                        </button>
                        <button
                          disabled={reportSaving || !revisionNote.trim()}
                          onClick={() => updateReportStatus('needs_revision')}
                          className="px-3 py-1 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {reportSaving && <Loader2 size={11} className="animate-spin inline mr-1" />}
                          Gửi yêu cầu
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
                      {target.lecturer_comment && (
                        <div className="text-xs text-orange-800 bg-orange-50 p-2 rounded border border-orange-200">
                          <span className="font-semibold">Lý do cũ:</span> {target.lecturer_comment}
                        </div>
                      )}
                      {isPrimary && (
                        <div className="flex gap-2">
                          <button
                            disabled={reportSaving}
                            onClick={() => updateReportStatus('accepted')}
                            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {reportSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                            Chấp nhận báo cáo
                          </button>
                          <button
                            disabled={reportSaving}
                            onClick={() => setShowRevisionInput(true)}
                            className="inline-flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg border border-orange-200 bg-white hover:bg-orange-50 text-orange-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <AlertCircle size={13} />
                            Yêu cầu sửa
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 2. Chấm điểm */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Điểm thực tập</span>
                  {!isPrimary && (
                    <span className="text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                      Chỉ GVHD chính nhập điểm
                    </span>
                  )}
                </div>

                {target.locked_at ? (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700 font-medium">
                    Điểm đã bị Khoa khóa.
                  </div>
                ) : windowClosed ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800 font-medium">
                    {windowMessage || 'Đã hết thời hạn nhập điểm học phần của Khoa.'}
                  </div>
                ) : null}

                {gradeSuccess && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-700 font-medium">
                    {gradeSuccess}
                  </div>
                )}


                {/* 3 ô điểm */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Định kỳ', weight: '20%', value: progress, set: setProgress, field: 'progress' },
                    { label: 'Báo cáo', weight: '20%', value: report, set: setReport, field: 'report' },
                    { label: 'Đánh giá của DN/GVHD', weight: '60%', value: company, set: setCompany, field: 'company' },
                  ].map(({ label, weight, value, set, field }) => (
                    <div key={field} className="space-y-1">
                      <div className="min-h-[28px] flex items-end justify-between text-[11px] gap-1">
                        <span className="font-semibold text-slate-600 leading-tight" title={label}>{label}</span>
                        <span className="text-slate-400 text-[10px] shrink-0">{weight}</span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        inputMode="decimal"
                        disabled={locked || !isPrimary}
                        value={value}
                        onChange={e => {
                          set(e.target.value);
                          if (scoreErrors[field]) {
                            setScoreErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
                          }
                        }}
                        onBlur={e => validateScore(e.target.value, field)}
                        placeholder="0 – 10"
                        className={`w-full rounded-lg px-2 py-1.5 text-center text-sm font-semibold outline-none transition-all border ${
                          scoreErrors[field]
                            ? 'border-red-400 bg-red-50 text-red-900'
                            : 'border-slate-200 bg-slate-50/60 text-slate-900 focus:bg-white focus:border-blue-500'
                        } disabled:bg-slate-100 disabled:text-slate-400`}
                      />
                      {scoreErrors[field] && (
                        <p className="text-[10px] text-red-600 text-center">{scoreErrors[field]}</p>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-slate-400 text-center leading-tight">
                  Điểm Đánh giá của DN căn cứ theo Phiếu đánh giá có dấu công ty được scan gộp trong file PDF báo cáo của sinh viên.
                </p>



                {/* Điểm tổng kết */}
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">Điểm tổng kết:</span>
                  <span className={`text-xl font-bold ${finalScore ? 'text-blue-600' : 'text-slate-300'}`}>
                    {finalScore ?? '—'}
                  </span>
                </div>

                {/* Ghi chú */}
                <div className="space-y-1">
                  <textarea
                    disabled={locked || !isPrimary}
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Ghi chú / Nhận xét..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-2 text-xs text-slate-800 outline-none focus:bg-white focus:border-blue-500 resize-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                {/* Nút lưu / nộp */}
                {isPrimary && !locked && (
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={gradeSaving !== null}
                      onClick={() => saveGrade(false)}
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {gradeSaving === 'draft' && <Loader2 size={12} className="animate-spin inline mr-1" />}
                      Lưu nháp
                    </button>
                    <button
                      disabled={gradeSaving !== null}
                      onClick={() => saveGrade(true)}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#075fc7] hover:bg-[#084c9e] text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {gradeSaving === 'submit' && <Loader2 size={12} className="animate-spin inline mr-1" />}
                      Nộp điểm
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
