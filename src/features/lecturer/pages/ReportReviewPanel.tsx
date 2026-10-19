import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Download, AlertCircle, Loader2,
  ExternalLink, Check, ChevronLeft, ChevronRight, FileText
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { API_BASE, cleanStudentName } from '../../../shared';

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
  s === 'accepted' || gradeStatus === 'submitted' ? 'Đã nộp điểm'
  : s === 'needs_revision' ? 'Cần nộp lại'
  : s === 'submitted' ? 'Chưa chấm điểm'
  : 'Chưa nộp';

const reportStatusBadgeClass = (s?: string, gradeStatus?: string) =>
  s === 'accepted' || gradeStatus === 'submitted'
    ? 'bg-[#dcfce7] text-[#15803d] border-emerald-200/60'
    : s === 'needs_revision'
    ? 'bg-[#ffedd5] text-[#b25e00] border-amber-200/60'
    : 'bg-[#fee2e2] text-[#b91c1c] border-red-200/60';

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
  const studentId = target.student_id ?? target.studentId;
  const rawStudentName = target.student_name ?? target.studentName ?? 'Sinh viên';
  const studentName = cleanStudentName(rawStudentName, studentId);
  const className = target.class_name ?? target.className;
  const initialReportStatus = target.report_status ?? target.reportStatus;

  // Local report & grade status (updates immediately when submitted)
  const [localReportStatus, setLocalReportStatus] = useState<string | undefined>(initialReportStatus);
  const [localGradeStatus, setLocalGradeStatus] = useState<string | undefined>(target.grade_status);

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
    setLocalGradeStatus(target.grade_status);
  }, [
    uid,
    target.progress_score,
    target.report_score,
    target.company_score,
    target.comment,
    target.report_status,
    target.reportStatus,
    target.grade_status,
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
  const updateReportStatus = async (status: 'submitted' | 'needs_revision', note = revisionNote) => {
    if (!uid) return;
    setReportSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/final/${uid}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, lecturer_comment: status === 'needs_revision' ? note : '' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Cập nhật thất bại.');
        return;
      }
      setShowRevisionInput(false);
      setRevisionNote(status === 'needs_revision' ? note : '');
      setLocalReportStatus(status);
      if (status === 'submitted') {
        target.lecturer_comment = undefined;
      } else if (status === 'needs_revision') {
        target.lecturer_comment = note;
      }
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
        setGradeSuccess('Đã nộp điểm thành công!');
        setLocalReportStatus('accepted');
        setLocalGradeStatus('submitted');
        target.grade_status = 'submitted';
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

        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Student Navigation Pager */}
            {typeof currentIndex === 'number' && typeof totalCount === 'number' && totalCount > 1 && (
              <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 text-xs text-slate-600 shrink-0">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  title="Sinh viên trước (Phím [ hoặc Alt+←)"
                  aria-label="Sinh viên trước"
                  className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="font-mono font-medium px-2 text-[11px] text-slate-600 select-none min-w-[44px] text-center">
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
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            {typeof currentIndex === 'number' && typeof totalCount === 'number' && totalCount > 1 && (
              <div className="h-6 w-px bg-slate-200 shrink-0" />
            )}

            {/* Student Identity & Metadata */}
            <div className="flex flex-col min-w-0 justify-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900 truncate">
                  {studentName}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${reportStatusBadgeClass(localReportStatus, localGradeStatus)}`}>
                  {reportStatusLabel(localReportStatus, localGradeStatus)}
                </span>
                {locked && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${target.locked_at ? 'bg-[#fee2e2] text-[#b91c1c] border-red-200/60' : 'bg-[#ffedd5] text-[#b25e00] border-amber-200/60'}`}>
                    {target.locked_at ? 'Đã khóa' : 'Hết hạn'}
                  </span>
                )}
              </div>
              {(studentId || className) && (
                <div className="text-[11px] text-slate-500 font-normal flex items-center gap-1.5 truncate mt-0.5">
                  {studentId && <span className="font-mono text-slate-600">{studentId}</span>}
                  {studentId && className && <span className="text-slate-300">·</span>}
                  {className && <span className="truncate">{className}</span>}
                </div>
              )}
            </div>
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

              {/* Yêu cầu sửa (chỉ hiển thị khi đang nhập lý do hoặc trạng thái needs_revision) */}
              {showRevisionInput ? (
                <div className="rounded-lg border border-amber-200 bg-[#ffedd5]/40 p-3 space-y-2">
                  <div className="text-xs font-bold text-[#c2410c]">Lý do yêu cầu nộp lại</div>
                  <textarea
                    autoFocus
                    value={revisionNote}
                    onChange={e => setRevisionNote(e.target.value)}
                    rows={2}
                    placeholder="Nội dung cần sinh viên chỉnh sửa..."
                    className="w-full rounded-md border border-amber-300 bg-white p-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-[#034ea1] resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setShowRevisionInput(false); setRevisionNote(''); }}
                      className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      disabled={reportSaving || !revisionNote.trim()}
                      onClick={() => updateReportStatus('needs_revision')}
                      className="px-3 py-1 rounded-md bg-[#c2410c] hover:bg-[#9a3412] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {reportSaving && <Loader2 size={11} className="animate-spin inline mr-1" />}
                      Gửi yêu cầu
                    </button>
                  </div>
                </div>
              ) : localReportStatus === 'needs_revision' ? (
                <div className="rounded-lg border border-amber-200/80 bg-[#ffedd5]/50 p-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#c2410c]">
                      <AlertCircle size={13} className="text-[#c2410c] shrink-0" />
                      <span>Đang yêu cầu sinh viên nộp lại</span>
                    </div>
                    {isPrimary && (
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setRevisionNote(target.lecturer_comment || '');
                            setShowRevisionInput(true);
                          }}
                          className="text-[#c2410c] hover:underline font-semibold cursor-pointer"
                        >
                          Sửa lý do
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          disabled={reportSaving}
                          onClick={() => {
                            if (confirm('Thu hồi yêu cầu sửa? Báo cáo sẽ trở về trạng thái đã nộp và sẵn sàng chấm điểm.')) {
                              updateReportStatus('submitted');
                            }
                          }}
                          className="text-slate-500 hover:text-slate-800 hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {reportSaving ? 'Đang hủy...' : 'Hủy yêu cầu'}
                        </button>
                      </div>
                    )}
                  </div>
                  {(target.lecturer_comment || revisionNote) && (
                    <div className="text-xs text-slate-700 bg-white/90 rounded p-2 border border-amber-200/50 leading-relaxed">
                      <span className="font-semibold text-[#c2410c]">Ghi chú cho SV:</span> {target.lecturer_comment || revisionNote}
                    </div>
                  )}
                </div>
              ) : null}

              {/* 2. Chấm điểm */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Điểm thực tập</span>
                  <div className="flex items-center gap-2">
                    {isPrimary && !locked && localReportStatus && localReportStatus !== 'needs_revision' && !showRevisionInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setRevisionNote(target.lecturer_comment || '');
                          setShowRevisionInput(true);
                        }}
                        className="text-[11px] font-semibold text-[#c2410c] hover:text-[#9a3412] hover:underline inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <AlertCircle size={12} />
                        Yêu cầu sửa
                      </button>
                    )}
                    {!isPrimary && (
                      <span className="text-[10px] font-bold text-[#b25e00] bg-[#ffedd5] px-2 py-0.5 rounded-full border border-amber-200/60">
                        Chỉ GVHD chính nhập điểm
                      </span>
                    )}
                  </div>
                </div>

                {target.locked_at ? (
                  <div className="rounded-lg bg-[#fee2e2] border border-red-200/60 p-2 text-xs text-[#b91c1c] font-medium">
                    Điểm đã bị Khoa khóa.
                  </div>
                ) : windowClosed ? (
                  <div className="rounded-lg bg-[#ffedd5] border border-amber-200/60 p-2 text-xs text-[#b25e00] font-medium">
                    {windowMessage || 'Đã hết thời hạn nhập điểm học phần của Khoa.'}
                  </div>
                ) : null}

                {gradeSuccess && (
                  <div className="rounded-lg bg-[#dcfce7] border border-emerald-200/80 p-2 text-xs text-[#15803d] font-medium">
                    {gradeSuccess}
                  </div>
                )}


                {/* 3 ô điểm */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Định kỳ', weight: '20%', value: progress, set: setProgress, field: 'progress' },
                    { label: 'Báo cáo', weight: '20%', value: report, set: setReport, field: 'report' },
                    { label: 'Đánh giá của DN/GVHD (nếu thực tập ở Trường)', weight: '60%', value: company, set: setCompany, field: 'company' },
                  ].map(({ label, weight, value, set, field }) => (
                    <div key={field} className="flex flex-col justify-end space-y-1">
                      <div className="flex-1 flex items-end justify-between text-[11px] gap-1 min-h-[44px]">
                        <span className="font-semibold text-slate-600 leading-tight" title={label}>{label}</span>
                        <span className="text-slate-400 text-[10px] shrink-0 self-end">{weight}</span>
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
                            : 'border-slate-200 bg-slate-50/60 text-slate-900 focus:bg-white focus:border-[#034ea1] focus:ring-1 focus:ring-[#034ea1]'
                        } disabled:bg-slate-100 disabled:text-slate-400`}
                      />
                      {scoreErrors[field] && (
                        <p className="text-[10px] text-red-600 text-center">{scoreErrors[field]}</p>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-slate-400 text-center leading-tight">
                  Điểm Đánh giá của DN căn cứ theo Phiếu đánh giá có dấu công ty được scan gộp trong file PDF báo cáo của sinh viên (hoặc do GVHD đánh giá nếu thực tập tại Trường).
                </p>



                {/* Điểm tổng kết */}
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">Điểm tổng kết:</span>
                  <span className={`text-xl font-bold ${finalScore ? 'text-[#034ea1]' : 'text-slate-300'}`}>
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
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/50 p-2 text-xs text-slate-800 outline-none focus:bg-white focus:border-[#034ea1] resize-none disabled:bg-slate-100 disabled:text-slate-400"
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
                      className="flex-1 py-2 px-3 rounded-lg bg-[#034ea1] hover:bg-[#023a7a] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
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
