import { PdfView } from './PdfView';
import { useEffect, useState, useRef } from 'react';
import {
  Users, CheckCircle2, Clock, AlertCircle, AlertTriangle, FileText,
  BookOpen, GraduationCap, ExternalLink, Presentation,
  Video, ChevronDown, Check, Send, Lock, Award, Info, RefreshCw, X, Upload, Download, Eye, Search
} from 'lucide-react';
import { Button, FormField } from '../../shared/ui';
import { Badge } from '../../shared/ui/Badge';
import type { AcademicClassSummary, EnrollmentView, LecturerInfo, SubmissionVersion } from '../../shared/academic';
import { academicApi, academicPdf, academicDownload } from './client';
import { projectVersionResult, toLetterGrade, type EnrollmentPanelMode } from './campaignPresentation';
import { ProjectTopic } from './ProjectTopic';
import { academicInput, isoLocal } from './form';

type Props = {
  token: string;
  user: any;
  courseClass: AcademicClassSummary;
  enrollment: EnrollmentView;
  lecturers: LecturerInfo[];
  refresh: () => Promise<void>;
  mode?: EnrollmentPanelMode;
};

const formatGMT7 = (dateStr?: string | null) => {
  if (!dateStr) return 'Theo thông báo';
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? dateStr
      : d.toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
  } catch {
    return dateStr;
  }
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().trim();
const undergraduate = (lecturer: LecturerInfo) => /(^|[\s.])CN[.\s]|^CN$/iu.test(lecturer.name);

export function EnrollmentPanel({
  token,
  user,
  courseClass: c,
  enrollment: e,
  lecturers,
  refresh,
  mode = 'all'
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = e.versions[e.versions.length - 1];
  const [viewedId, setViewedId] = useState(current.id);
  useEffect(() => { setViewedId(current.id); }, [current.id]);
  const viewed = e.versions.find(v => v.id === viewedId) || current;

  const admin = user.role === 'admin';
  const owner = user.role === 'student' && user.email === e.email;
  const project = c.group === 'project';
  const readOnly = c.status !== 'active' || e.status === 'withdrawn' || c.legacy;
  const showReport = ['all', 'reports', 'grades'].includes(mode);
  const showProfile = ['all', 'profile', 'assignments'].includes(mode);
  const requiresResubmission = project && !!e.topicPermissions?.requiresResubmission;
  const pair = e.evaluations?.[current.id] || {};

  // For students in project: select stage based on progression
  const initialStage = () => {
    if (['complete', 'locked'].includes(e.gradeStatus)) return 'grade';
    if (e.topicReview?.status === 'approved') return 'submission';
    return 'topic';
  };
  const [activeStage, setActiveStage] = useState<'topic' | 'submission' | 'grade'>(initialStage);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice('Đã lưu thành công.');
      try { await refresh(); } catch { setNotice('Đã lưu thành công. Chưa tải lại được dữ liệu; dùng Tải lại để cập nhật.'); }
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const post = (path: string, body: any, method = 'PUT') =>
    run(() => academicApi(token, path, method, { ...body, expectedRevision: e.revision }));

  const base = `/api/enrollments/${e.id}`;

  const primaryLecturer = e.assignments.find(a => a.role === 'primary');
  const primaryLecturerName = lecturers.find(l => l.id === primaryLecturer?.lecturerId)?.name;
  const coLecturerNames = e.assignments
    .filter(a => a.role === 'co')
    .map(a => lecturers.find(l => l.id === a.lecturerId)?.name)
    .filter(Boolean);
  const reviewerLecturer = e.assignments.find(a => a.role === 'reviewer');
  const reviewerLecturerName = lecturers.find(l => l.id === reviewerLecturer?.lecturerId)?.name;

  const [showAdvisorChangeModal, setShowAdvisorChangeModal] = useState(false);
  const [selectedTargetLecturerId, setSelectedTargetLecturerId] = useState<number | ''>('');
  const [changeReason, setChangeReason] = useState('');
  const [changeFormError, setChangeFormError] = useState('');
  const [advisorSearchQuery, setAdvisorSearchQuery] = useState('');
  const [isAdvisorDropdownOpen, setIsAdvisorDropdownOpen] = useState(false);
  const [highlightedAdvisorIndex, setHighlightedAdvisorIndex] = useState(0);
  const [extraLecturers, setExtraLecturers] = useState<LecturerInfo[]>([]);
  const advisorSearchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdvisorDropdownOpen) return;
    const handleOutsideClick = (ev: MouseEvent) => {
      if (advisorSearchContainerRef.current && !advisorSearchContainerRef.current.contains(ev.target as Node)) {
        setIsAdvisorDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAdvisorDropdownOpen]);

  useEffect(() => {
    if (showAdvisorChangeModal && lecturers.length <= 1 && extraLecturers.length === 0 && c.campaignId) {
      academicApi<any>(token, `/api/campaigns/${c.campaignId}?section=management`, 'GET')
        .then(res => {
          if (Array.isArray(res?.lecturers) && res.lecturers.length > 0) {
            setExtraLecturers(res.lecturers);
          }
        })
        .catch(() => {});
    }
  }, [showAdvisorChangeModal, lecturers.length, extraLecturers.length, c.campaignId, token]);

  const resetAdvisorChangeModal = () => {
    setShowAdvisorChangeModal(false);
    setSelectedTargetLecturerId('');
    setChangeReason('');
    setChangeFormError('');
    setAdvisorSearchQuery('');
    setIsAdvisorDropdownOpen(false);
    setHighlightedAdvisorIndex(0);
  };

  const combinedLecturers = lecturers.length > 1 ? lecturers : (extraLecturers.length > 0 ? extraLecturers : lecturers);
  const availableLecturers = combinedLecturers
    .filter(l => l.id !== primaryLecturer?.lecturerId && !undergraduate(l) && l.id !== reviewerLecturer?.lecturerId)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  const filteredLecturers = advisorSearchQuery.trim()
    ? availableLecturers.filter(l =>
        normalize(`${l.name} ${l.email} ${l.work_unit || ''}`).includes(normalize(advisorSearchQuery))
      )
    : availableLecturers;

  const chosenTargetLecturer = availableLecturers.find(l => l.id === selectedTargetLecturerId);

  const handleAdvisorSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isAdvisorDropdownOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        setIsAdvisorDropdownOpen(true);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedAdvisorIndex(prev => (filteredLecturers.length ? (prev + 1) % filteredLecturers.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedAdvisorIndex(prev => (filteredLecturers.length ? (prev - 1 + filteredLecturers.length) % filteredLecturers.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredLecturers[highlightedAdvisorIndex] || filteredLecturers[0];
      if (target) {
        setSelectedTargetLecturerId(target.id);
        setIsAdvisorDropdownOpen(false);
        setAdvisorSearchQuery('');
        setChangeFormError('');
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsAdvisorDropdownOpen(false);
    }
  };

  const targetLecturerName = lecturers.find(l => l.id === e.advisorChangeRequest?.targetLecturerId)?.name;
  const isChangePending = e.advisorChangeRequest?.status === 'pending';
  const hasGradesEntered = Boolean(e.internshipGrade || Object.values(e.evaluations?.[current.id] || {}).some(Boolean));
  const canRequestAdvisorChange = owner && !!primaryLecturer && !e.lockedAt && !e.submissionLockedAt && !hasGradesEntered && !['complete', 'locked'].includes(e.gradeStatus);
  const currentLecturer = lecturers.find(l => l.email && user.email && l.email.trim().toLowerCase() === user.email.trim().toLowerCase());
  const isCurrentAdvisor = Boolean(currentLecturer && primaryLecturer?.lecturerId === currentLecturer.id);
  const canReviewAdvisorChange = (isCurrentAdvisor || admin) && isChangePending;

  const handleCancelAdvisorChange = () => {
    if (!window.confirm('Bạn có chắc chắn muốn hủy yêu cầu thay đổi Giảng viên hướng dẫn?')) return;
    post(`/api/enrollments/${e.id}/advisor-change-request`, {}, 'DELETE');
  };

  const handleReviewAdvisorChange = (status: 'approved' | 'rejected') => {
    let reviewComment = '';
    if (status === 'rejected') {
      const input = window.prompt('Nhập lý do từ chối (tùy chọn):');
      if (input === null) return;
      reviewComment = input;
    }
    post(`/api/enrollments/${e.id}/advisor-change-request/review`, {
      status,
      reviewComment,
    }, 'POST');
  };

  const handleSubmitAdvisorChange = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTargetLecturerId) {
      setChangeFormError('Vui lòng chọn Giảng viên hướng dẫn mới đề xuất.');
      return;
    }
    if (!changeReason.trim() || changeReason.trim().length < 5) {
      setChangeFormError('Vui lòng nhập lý do thay đổi từ 5 ký tự trở lên.');
      return;
    }
    setChangeFormError('');
    post(`/api/enrollments/${e.id}/advisor-change-request`, {
      targetLecturerId: Number(selectedTargetLecturerId),
      reason: changeReason.trim(),
    }, 'POST').then(ok => {
      if (ok) {
        resetAdvisorChangeModal();
      }
    });
  };

  // Student 3-stage stepper navigation tabs (aligned with Project lifecycle)
  const stageTabs = [
    {
      id: 'topic' as const,
      step: '1',
      title: 'Đề tài',
      isDone: e.topicReview?.status === 'approved',
      status: e.topicReview?.status === 'approved' ? 'Đã duyệt' : e.topic ? 'Chờ duyệt' : 'Chưa đăng ký',
      variant: (e.topicReview?.status === 'approved' ? 'success' : e.topic ? 'warning' : 'neutral') as any,
    },
    {
      id: 'submission' as const,
      step: '2',
      title: 'Nộp báo cáo',
      isDone: current.state === 'submitted' && !requiresResubmission,
      status: requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã nộp đủ' : 'Chưa nộp',
      variant: (requiresResubmission ? 'warning' : current.state === 'submitted' ? 'success' : 'neutral') as any,
    },
    {
      id: 'grade' as const,
      step: '3',
      title: 'Đánh giá & Điểm',
      isDone: ['complete', 'locked'].includes(e.gradeStatus),
      status: ['complete', 'locked'].includes(e.gradeStatus)
        ? 'Đã hoàn tất đánh giá'
        : e.gradeStatus === 'partial'
        ? 'Đang đánh giá'
        : current.state === 'submitted'
        ? 'Chờ đánh giá'
        : 'Chưa đánh giá',
      variant: (['complete', 'locked'].includes(e.gradeStatus) ? 'success' : 'neutral') as any,
    },
  ];

  const topicWindow = (() => {
    const now = Date.now();
    if (c.settings.topicOpenAt && new Date(c.settings.topicOpenAt).getTime() > now) return { label: 'Chưa mở', variant: 'warning' as const };
    if (c.settings.topicCloseAt && new Date(c.settings.topicCloseAt).getTime() < now) return { label: 'Đã đóng', variant: 'neutral' as const };
    return { label: 'Đang mở', variant: 'success' as const };
  })();
  const submissionWindow = (() => {
    const now = Date.now();
    if (c.settings.submissionOpenAt && new Date(c.settings.submissionOpenAt).getTime() > now) return { label: 'Chưa mở', variant: 'warning' as const };
    if (c.settings.submissionCloseAt && new Date(c.settings.submissionCloseAt).getTime() < now) return { label: 'Đã đóng', variant: 'neutral' as const };
    return { label: 'Đang mở', variant: 'success' as const };
  })();
  const gradingWindow = (() => {
    const now = Date.now();
    if (c.settings.gradingOpenAt && new Date(c.settings.gradingOpenAt).getTime() > now) return { label: 'Chưa mở', variant: 'warning' as const };
    if (c.settings.gradingCloseAt && new Date(c.settings.gradingCloseAt).getTime() < now) return { label: 'Đã đóng', variant: 'neutral' as const };
    return { label: 'Đang mở', variant: 'success' as const };
  })();

  const advisorChangeModal = showAdvisorChangeModal ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Yêu cầu thay đổi Giảng viên hướng dẫn"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-[#034ea1]" />
            <h3 className="font-bold text-base text-slate-900">Yêu cầu thay đổi Giảng viên hướng dẫn</h3>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={resetAdvisorChangeModal}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {changeFormError && (
          <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            {changeFormError}
          </div>
        )}

        <form onSubmit={handleSubmitAdvisorChange} className="space-y-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-500 block mb-0.5">Giảng viên hướng dẫn hiện tại:</span>
            <strong className="text-slate-900 text-sm">{primaryLecturerName}</strong>
          </div>

          <FormField
            label="Giảng viên hướng dẫn mới đề xuất *"
            hint={chosenTargetLecturer ? "Nhấn 'Đổi người khác' nếu muốn chọn lại" : "Nhập để tìm kiếm hoặc chọn từ danh sách giảng viên"}
          >
            {chosenTargetLecturer ? (
              <div className="flex items-center justify-between p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-[#034ea1] flex items-center justify-center shrink-0 font-bold text-sm">
                    {chosenTargetLecturer.name.split(' ').slice(-1)[0]?.charAt(0) || 'G'}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 text-sm flex items-center gap-1.5 truncate">
                      <span>{chosenTargetLecturer.name}</span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-[#034ea1]">
                        Đã chọn
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {chosenTargetLecturer.work_unit || chosenTargetLecturer.email}
                      {chosenTargetLecturer.work_unit && chosenTargetLecturer.email && ` · ${chosenTargetLecturer.email}`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTargetLecturerId('');
                    setAdvisorSearchQuery('');
                    setIsAdvisorDropdownOpen(true);
                  }}
                  className="ml-2 text-xs font-semibold text-[#034ea1] hover:text-blue-700 hover:underline shrink-0 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  Đổi người khác
                </button>
              </div>
            ) : (
              <div className="relative" ref={advisorSearchContainerRef}>
                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    role="combobox"
                    aria-label="Tìm và chọn Giảng viên hướng dẫn mới"
                    aria-expanded={isAdvisorDropdownOpen}
                    aria-autocomplete="list"
                    className={`${academicInput} pl-9.5 pr-8`}
                    placeholder="Gõ tên, email hoặc bộ môn giảng viên..."
                    value={advisorSearchQuery}
                    onFocus={() => {
                      setIsAdvisorDropdownOpen(true);
                      setHighlightedAdvisorIndex(0);
                    }}
                    onChange={ev => {
                      setAdvisorSearchQuery(ev.target.value);
                      setIsAdvisorDropdownOpen(true);
                      setHighlightedAdvisorIndex(0);
                    }}
                    onKeyDown={handleAdvisorSearchKeyDown}
                    autoComplete="off"
                  />
                  {advisorSearchQuery ? (
                    <button
                      type="button"
                      aria-label="Xóa tìm kiếm"
                      onClick={() => { setAdvisorSearchQuery(''); setIsAdvisorDropdownOpen(true); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label="Mở danh sách giảng viên"
                      tabIndex={-1}
                      onClick={() => setIsAdvisorDropdownOpen(prev => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                </div>

                {isAdvisorDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Danh sách giảng viên hướng dẫn"
                    className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-xl py-1 text-xs"
                  >
                    {filteredLecturers.length > 0 ? (
                      filteredLecturers.map((lecturer, idx) => {
                        const isHighlighted = idx === highlightedAdvisorIndex;
                        return (
                          <button
                            key={lecturer.id}
                            type="button"
                            role="option"
                            aria-selected={lecturer.id === selectedTargetLecturerId}
                            onClick={() => {
                              setSelectedTargetLecturerId(lecturer.id);
                              setIsAdvisorDropdownOpen(false);
                              setAdvisorSearchQuery('');
                              setChangeFormError('');
                            }}
                            onMouseEnter={() => setHighlightedAdvisorIndex(idx)}
                            className={`w-full text-left px-3.5 py-2.5 flex items-start gap-2.5 transition-colors cursor-pointer border-b border-slate-50 last:border-b-0 ${
                              isHighlighted ? 'bg-blue-50 text-slate-900' : 'hover:bg-slate-50 text-slate-800'
                            }`}
                          >
                            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 font-medium text-xs mt-0.5">
                              {lecturer.name.split(' ').slice(-1)[0]?.charAt(0) || 'G'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900">{lecturer.name}</div>
                              <div className="text-slate-500 text-[11px] truncate">
                                {lecturer.work_unit || lecturer.email}
                                {lecturer.work_unit && lecturer.email && ` · ${lecturer.email}`}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-4 text-center text-slate-500">
                        {availableLecturers.length === 0 ? (
                          'Đang tải danh bạ giảng viên...'
                        ) : (
                          <>Không tìm thấy giảng viên nào với từ khóa "<strong>{advisorSearchQuery}</strong>".</>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </FormField>

          <FormField label="Lý do thay đổi *" hint="Nêu rõ lý do (chuyển hướng nghiên cứu, GV bận công tác...)">
            <textarea
              required
              aria-label="Lý do thay đổi"
              rows={4}
              className={academicInput}
              placeholder="Nhập lý do xin chuyển GVHD (tối thiểu 5 ký tự)..."
              value={changeReason}
              onChange={ev => setChangeReason(ev.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={resetAdvisorChangeModal}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
            >
              {busy ? 'Đang gửi...' : 'Gửi yêu cầu'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  /* -------------------------------------------------------------
   * 1. STUDENT VIEW (Exact match to Internship Dashboard layout)
   * ------------------------------------------------------------- */
  if (owner && project) {
    return (
      <div className="space-y-6">
        {/* Notice / Feedback Banners */}
        {error && (
          <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800 shadow-xs">
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-800 shadow-xs">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Top Academic Info & Quick Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-xs">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
              <h2 className="text-xs font-bold text-slate-900 inline">{e.name}</h2>
              <span className="text-slate-300">·</span>
              <span>MSSV: <strong className="text-slate-900">{e.studentId}</strong></span>
              <span className="text-slate-300">·</span>
              <span>Lớp: <strong className="text-slate-900">{e.className || '—'}</strong></span>
              <span className="text-slate-300">·</span>
              <span>Học phần: <strong className="text-slate-900">{c.courseName} ({c.code})</strong></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://drive.google.com/drive/u/0/folders/14Fm4yP-2Psj_qMpzI0pBARkcww1sblA3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-slate-600 hover:text-[#034ea1] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
            >
              <ExternalLink size={13} className="text-slate-500" /> Biểu mẫu Drive
            </a>
          </div>
        </div>

        {/* Main Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sidebar (lg:col-span-3): Trạng thái hệ thống & Quy định */}
          <aside className="lg:col-span-3 space-y-4 lg:sticky lg:top-6">
            {/* Card 1: Trạng thái hệ thống */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-1.5">
                  <Clock size={15} className="text-blue-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Trạng thái hệ thống</h3>
                </div>
                <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">GMT+7</span>
              </div>
              <div className="space-y-2">
                {/* 1. Khai báo đề tài */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">Khai báo đề tài</span>
                    <Badge variant={topicWindow.variant} size="sm">
                      {topicWindow.label}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn:</span>
                    <span className="font-medium text-slate-700">
                      {c.settings.topicCloseAt ? formatGMT7(c.settings.topicCloseAt) : 'Theo kế hoạch'}
                    </span>
                  </div>
                </div>

                {/* 2. Nộp báo cáo */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">Nộp báo cáo</span>
                    <Badge variant={submissionWindow.variant} size="sm">
                      {submissionWindow.label}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn:</span>
                    <span className="font-medium text-slate-700">
                      {c.settings.submissionCloseAt ? formatGMT7(c.settings.submissionCloseAt) : 'Theo thông báo'}
                    </span>
                  </div>
                </div>

                {/* 3. Chấm điểm học phần */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">Chấm điểm học phần</span>
                    <Badge variant={gradingWindow.variant} size="sm">
                      {gradingWindow.label}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn chấm:</span>
                    <span className="font-medium text-slate-700">
                      {c.settings.gradingCloseAt ? formatGMT7(c.settings.gradingCloseAt) : 'Theo kế hoạch'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Quy định học phần */}
            <details open className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <summary className="flex items-center justify-between font-bold text-slate-800 cursor-pointer select-none text-xs uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <BookOpen size={15} className="text-blue-600" />
                  Quy định học phần
                </span>
                <ChevronDown size={14} className="text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 leading-relaxed max-h-72 overflow-y-auto pr-1 space-y-2">
                <p>• Sinh viên cần thống nhất và được Giảng viên hướng dẫn duyệt tên đề tài trước khi nộp bài.</p>
                <p>• Bộ bài nộp đầy đủ gồm 3 thành phần: Báo cáo PDF (tối đa 10 MB), link Google Drive slide thuyết trình, link Google Drive video demo sản phẩm.</p>
                <p>• Cần cấp quyền xem slide và video cho GVHD/GVNX trước khi nộp.</p>
              </div>
            </details>
          </aside>

          {/* Right Content Column (lg:col-span-9): Stepper & Active Stage Workspace */}
          <div className="lg:col-span-9 min-w-0 space-y-5">
            {/* Three-stage navigation for the current enrollment. */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-1.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                {stageTabs.map((tab) => {
                  const isSelected = activeStage === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveStage(tab.id)}
                      className={`py-2.5 px-3.5 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200/80 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : tab.isDone
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {tab.isDone ? <CheckCircle2 size={12} /> : tab.step}
                        </span>
                        <span className="text-xs truncate">{tab.title}</span>
                      </div>
                      <Badge variant={tab.variant} size="sm">
                        {tab.status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Workspace Cards */}
            <main className="space-y-5">
              {/* Topic declaration and approval. */}
              <div id="step-topic" className={`rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-5 ${activeStage === 'topic' ? 'block' : 'hidden'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Khai báo và duyệt đề tài</h3>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span>Giảng viên hướng dẫn: <strong className="text-slate-700">{primaryLecturerName || 'Chờ phân công'}</strong></span>
                      {canRequestAdvisorChange && !isChangePending && (
                        <button
                          type="button"
                          onClick={() => { resetAdvisorChangeModal(); setShowAdvisorChangeModal(true); }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#034ea1] bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                        >
                          Yêu cầu thay đổi
                        </button>
                      )}
                    </p>
                  </div>
                  <div>
                    <Badge variant={e.topicReview?.status === 'approved' ? 'success' : e.topic ? 'warning' : 'neutral'} size="md">
                      {e.topicReview?.status === 'approved' ? 'Đã duyệt đề tài' : e.topic ? 'Chờ GVHD duyệt' : 'Chưa đăng ký'}
                    </Badge>
                  </div>
                </div>

                {isChangePending && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock size={15} className="text-amber-600 shrink-0" />
                      <div>
                        <span>Đang chờ duyệt đổi sang GVHD: <strong>{targetLecturerName}</strong></span>
                        <p className="text-[11px] text-amber-700 mt-0.5">Lý do: {e.advisorChangeRequest?.reason}</p>
                      </div>
                    </div>
                    {owner && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleCancelAdvisorChange}
                        className="self-start sm:self-auto text-[11px] font-semibold text-rose-700 hover:text-rose-900 bg-white border border-rose-200 px-2.5 py-1 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        Hủy yêu cầu
                      </button>
                    )}
                  </div>
                )}

                {/* Topic Component (contains region 'Đề tài') */}
                <ProjectTopic enrollment={e} owner={owner} admin={admin} busy={busy} post={post} embedded />

                {e.reviewComment && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                    <strong>Ý kiến từ giảng viên:</strong> {e.reviewComment}
                  </div>
                )}
              </div>

              {/* PDF report and supporting links. */}
              <section id="step-submission" aria-label="Báo cáo, slide và video" className={`rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-6 ${activeStage === 'submission' ? 'block' : 'hidden'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Báo cáo, slide và video</h3>
                  </div>
                  <div>
                    <Badge variant={requiresResubmission ? 'warning' : current.state === 'submitted' ? 'success' : 'neutral'} size="md">
                      {requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã hoàn tất nộp' : 'Chưa nộp'}
                    </Badge>
                  </div>
                </div>

                {e.topicReview?.status !== 'approved' && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed font-medium">
                    <strong>Chưa thể nộp bài:</strong> Bạn cần gửi tên đề tài và được Giảng viên hướng dẫn chính phê duyệt trước khi có thể tải lên bộ bài nộp.
                  </div>
                )}

                <form
                  className="space-y-5"
                  onSubmit={event => {
                    event.preventDefault();
                    const f = new FormData(event.currentTarget);
                    f.set('expectedRevision', String(e.revision));
                    f.set('reusePdfVersionId', current.id);
                    run(() => academicApi(token, `${base}/submission`, 'POST', f));
                  }}
                >
                  <fieldset disabled={busy || !e.topicPermissions?.canSubmit} className="space-y-5">
                    {/* 1. PDF File Upload Area */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2">
                        Báo cáo PDF (tối đa 10 MB) <span className="text-rose-500">*</span>
                      </label>

                      <input
                        ref={fileInputRef}
                        type="file"
                        name="pdf"
                        accept="application/pdf,.pdf"
                        required={!current.objectKey && !selectedPdfFile}
                        disabled={busy || !e.topicPermissions?.canSubmit || !!e.lockedAt || !!e.submissionLockedAt}
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0] || null;
                          if (file && file.size > 10 * 1024 * 1024) {
                            setFileError('Kích thước file PDF không được vượt quá 10 MB.');
                            setSelectedPdfFile(null);
                            event.target.value = '';
                          } else {
                            setFileError('');
                            setSelectedPdfFile(file);
                          }
                        }}
                      />

                      {selectedPdfFile ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-slate-900 truncate">{selectedPdfFile.name}</div>
                            <div className="text-xs text-emerald-700 mt-0.5">
                              {(selectedPdfFile.size / 1024 / 1024).toFixed(2)} MB · File mới đã sẵn sàng để nộp
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-white text-slate-700 border border-slate-200 px-3.5 py-1.5 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Upload size={14} className="text-slate-500" /> Chọn file khác
                          </button>
                        </div>
                      ) : current.objectKey ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50/70 border border-slate-200 gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-slate-900 truncate" title={current.filename}>
                              {current.filename || 'Bao_cao_du_an.pdf'}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {(current.size / 1024 / 1024).toFixed(2)} MB · Nộp lúc {current.submittedAt ? formatGMT7(current.submittedAt) : 'Phiên bản hiện tại'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => academicDownload(token, `/api/enrollments/${e.id}/submissions/${current.id}/download`, current.filename || 'report.pdf')}
                              className="bg-white text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Download size={14} className="text-slate-500" /> Tải PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="bg-white text-slate-700 border border-slate-200 px-3.5 py-2 rounded-xl hover:bg-slate-50 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Upload size={14} className="text-slate-500" /> Nộp lại PDF
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2.5 bg-slate-50/40">
                          <p className="text-xs text-slate-500">Bạn chưa nộp báo cáo PDF.</p>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!e.topicPermissions?.canSubmit}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#034ea1] text-white hover:bg-[#023a7a] cursor-pointer shadow-xs hover:shadow transition-all disabled:opacity-50"
                          >
                            <Upload size={14} /> Chọn file PDF để nộp
                          </button>
                        </div>
                      )}

                      {fileError && <p className="text-xs text-rose-600 mt-1">{fileError}</p>}
                    </div>

                    {/* 2. Slide Google Drive Link */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        <Presentation size={14} className="text-amber-600" />
                        Link Google Drive slide <span className="text-rose-500">*</span>
                      </label>
                      <input
                        aria-label="Link Google Drive slide"
                        name="slidesUrl"
                        type="url"
                        required
                        defaultValue={current.slidesUrl}
                        placeholder="https://docs.google.com/presentation/d/..."
                        className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs bg-slate-50/50 focus:bg-white focus:border-[#034ea1] outline-none transition-colors"
                        disabled={!e.topicPermissions?.canSubmit || !!e.submissionLockedAt}
                      />
                    </div>

                    {/* 3. Video Demo Google Drive Link */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                        <Video size={14} className="text-indigo-600" />
                        Link Google Drive video demo <span className="text-rose-500">*</span>
                      </label>
                      <input
                        aria-label="Link Google Drive video demo"
                        name="demoUrl"
                        type="url"
                        required
                        defaultValue={current.demoUrl}
                        placeholder="https://drive.google.com/file/d/..."
                        className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs bg-slate-50/50 focus:bg-white focus:border-[#034ea1] outline-none transition-colors"
                        disabled={!e.topicPermissions?.canSubmit || !!e.submissionLockedAt}
                      />
                    </div>

                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200/70 rounded-xl text-xs text-slate-500">
                      <Info size={14} className="text-[#034ea1] shrink-0" />
                      <span>Cấp quyền xem slide và video cho GVHD/GVNX trước khi nộp.</span>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={busy || !e.topicPermissions?.canSubmit || !!e.lockedAt || !!e.submissionLockedAt}
                        className="bg-[#034ea1] hover:bg-[#023a7a] text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                        {busy ? 'Đang gửi…' : 'Xác nhận nộp bài'}
                      </button>
                    </div>
                  </fieldset>
                </form>

                {/* Embedded PDF Viewer if exists */}
                {current.objectKey && (
                  <div className="pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between pb-3">
                      <span className="text-xs font-bold text-slate-800">Xem trước bản nộp:</span>
                      <span className="text-xs text-slate-500">Phiên bản {current.number}</span>
                    </div>
                    <PdfView token={token} enrollmentId={e.id} version={viewed} />
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-100 text-xs text-blue-900 leading-relaxed font-medium">
                  <strong className="text-blue-950">Lưu ý:</strong> Bộ bài nộp đầy đủ gồm 3 thành phần: file PDF báo cáo (tối đa 10 MB), link Google Drive slide thuyết trình và video demo. Vui lòng cấp quyền xem (Viewer) cho liên kết Google Drive trước khi nộp.
                </div>
              </section>

              {/* CARD 3: ĐÁNH GIÁ & ĐIỂM SỐ */}
              <div id="step-grade" className={`rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-5 ${activeStage === 'grade' ? 'block' : 'hidden'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Đánh giá & Điểm số</h3>
                  </div>
                  <div>
                    <Badge variant={['complete', 'locked'].includes(e.gradeStatus) ? 'success' : 'neutral'} size="md">
                      {['complete', 'locked'].includes(e.gradeStatus)
                        ? 'Đã hoàn tất đánh giá'
                        : e.gradeStatus === 'partial'
                        ? 'Đang đánh giá'
                        : 'Chờ đánh giá'}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-slate-200 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Giảng viên hướng dẫn:</span>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-800">{primaryLecturerName || 'Chờ phân công'}</strong>
                        {canRequestAdvisorChange && !isChangePending && (
                          <button
                            type="button"
                            onClick={() => { resetAdvisorChangeModal(); setShowAdvisorChangeModal(true); }}
                            className="text-[11px] font-semibold text-[#034ea1] bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                          >
                            Yêu cầu thay đổi
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Giảng viên nhận xét:</span>
                      <strong className="text-slate-800">{reviewerLecturerName || 'Chờ phân công'}</strong>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                      <span className="text-slate-500">Tình trạng đánh giá:</span>
                      <span className="font-semibold text-slate-800">
                        {['complete', 'locked'].includes(e.gradeStatus)
                          ? 'Đã hoàn tất đánh giá cả hai phần điểm'
                          : e.gradeStatus === 'partial'
                          ? 'Đang tiến hành chấm điểm'
                          : 'Chờ đánh giá'}
                      </span>
                    </div>
                  </div>

                  {/* Nếu hệ thống cho phép sinh viên xem điểm số và đã có kết quả điểm */}
                  {c.settings.publishGradesToStudents && e.canSeeGrades ? (
                    <div className="space-y-3">
                      {e.finalScore != null ? (
                        <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs font-semibold text-emerald-900 block">Điểm tổng kết học phần</span>
                              <span className="text-[11px] text-emerald-700">Thang điểm 10 (GVHD 60% + GVNX 40%)</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-2xl font-black text-emerald-800">{e.finalScore.toFixed(1)}</span>
                              {toLetterGrade(e.finalScore) && (
                                <span className="text-sm font-bold px-2 py-0.5 rounded-md bg-emerald-200/80 text-emerald-900">
                                  {toLetterGrade(e.finalScore)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Chi tiết thành phần điểm */}
                          {(() => {
                            const res = projectVersionResult(e, current.id);
                            return (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-emerald-200/60 text-xs">
                                <div className="p-2.5 rounded-lg bg-white/80 border border-emerald-100 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-600">Điểm GVHD (60%):</span>
                                    <strong className="text-slate-900 text-sm">
                                      {res.pair.advisor?.score != null ? res.pair.advisor.score.toFixed(1) : '—'}
                                    </strong>
                                  </div>
                                  {res.pair.advisor?.comment && (
                                    <p className="text-[11px] text-slate-500 italic mt-0.5 pt-1 border-t border-slate-100">
                                      "{res.pair.advisor.comment}"
                                    </p>
                                  )}
                                </div>

                                <div className="p-2.5 rounded-lg bg-white/80 border border-emerald-100 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-600">Điểm GVNX (40%):</span>
                                    <strong className="text-slate-900 text-sm">
                                      {res.pair.reviewer?.score != null ? res.pair.reviewer.score.toFixed(1) : '—'}
                                    </strong>
                                  </div>
                                  {res.pair.reviewer?.comment && (
                                    <p className="text-[11px] text-slate-500 italic mt-0.5 pt-1 border-t border-slate-100">
                                      "{res.pair.reviewer.comment}"
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : e.gradeStatus === 'partial' ? (
                        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                          <strong>Đang chấm điểm:</strong> Giảng viên đang tiến hành đánh giá bài nộp của bạn. Điểm số chi tiết sẽ hiển thị khi cả GVHD và GVNX hoàn tất chấm điểm.
                        </div>
                      ) : (
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                          Chưa có kết quả điểm số. Điểm sẽ hiển thị tại đây sau khi hội đồng giảng viên hoàn tất đánh giá.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                      Điểm chính thức của học phần được quản lý theo quy chế đào tạo và tra cứu tại Cổng Đào tạo.
                    </div>
                  )}
                </div>
              </div>
            </main>
          </div>
        </div>
        {advisorChangeModal}
      </div>
    );
  }

  /* -------------------------------------------------------------
   * 2. LECTURER / ADMIN VIEW (Administrative & Grading Workbench)
   * ------------------------------------------------------------- */
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
      {/* Header Profile Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="font-bold text-lg text-slate-900">{e.name}</h3>
            <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold border border-slate-200">
              {e.studentId}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>Lớp: <strong className="text-slate-700">{e.className || '—'}</strong></span>
            <span className="text-slate-300">·</span>
            <span>Mã HP: <strong className="text-slate-700 font-mono">{c.code}</strong></span>
            <span className="text-slate-300">·</span>
            <span>GVHD: <strong className="text-slate-700">{primaryLecturerName || 'Chờ phân công'}</strong></span>
            {canRequestAdvisorChange && !isChangePending && (
              <button
                type="button"
                onClick={() => { resetAdvisorChangeModal(); setShowAdvisorChangeModal(true); }}
                className="text-[11px] font-semibold text-[#034ea1] bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
              >
                Yêu cầu thay đổi
              </button>
            )}
            {e.email && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-slate-400 font-mono">{e.email}</span>
              </>
            )}
          </div>
        </div>

        <div>
          <Badge
            variant={
              e.status === 'withdrawn'
                ? 'error'
                : requiresResubmission
                ? 'warning'
                : current.state === 'submitted'
                ? 'success'
                : 'neutral'
            }
            size="md"
          >
            {e.status === 'withdrawn'
              ? 'Đã rút'
              : requiresResubmission
              ? 'Cần nộp lại'
              : current.state === 'submitted'
              ? 'Đã nộp bộ bài'
              : 'Chưa hoàn tất nộp bài'}
          </Badge>
        </div>
      </div>

      {/* Notice / Feedback Banners */}
      {error && (
        <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
          <AlertCircle size={15} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Review Advisor Change Request Banner for Old Advisor or Admin */}
      {canReviewAdvisorChange && (
        <div className="p-4 bg-amber-50/90 border border-amber-300 rounded-2xl shadow-xs space-y-3 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-amber-200 pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <h4 className="font-bold text-sm text-amber-950">Yêu cầu thay đổi Giảng viên hướng dẫn từ sinh viên</h4>
            </div>
            <span className="text-[11px] text-amber-800 font-medium">Gửi lúc: {formatGMT7(e.advisorChangeRequest?.createdAt)}</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-slate-800">
            <div>
              <span className="text-slate-500">GVHD hiện tại:</span> <strong>{primaryLecturerName}</strong>
            </div>
            <div>
              <span className="text-slate-500">Đề xuất chuyển sang:</span> <strong className="text-[#034ea1]">{targetLecturerName}</strong>
            </div>
          </div>
          <div className="text-slate-800 bg-white/70 p-2.5 rounded-xl border border-amber-200/80">
            <span className="text-slate-500 font-medium">Lý do từ sinh viên:</span>
            <p className="mt-1 italic whitespace-pre-wrap">{e.advisorChangeRequest?.reason}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => handleReviewAdvisorChange('approved')}
            >
              Duyệt thay đổi GVHD
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => handleReviewAdvisorChange('rejected')}
            >
              Từ chối
            </Button>
          </div>
        </div>
      )}

      {/* Pending status banner for student in general view */}
      {isChangePending && owner && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-amber-600 shrink-0" />
            <div>
              <span>Đang chờ duyệt đổi sang GVHD: <strong>{targetLecturerName}</strong></span>
              <p className="text-[11px] text-amber-700 mt-0.5">Lý do: {e.advisorChangeRequest?.reason}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleCancelAdvisorChange}
            className="self-start sm:self-auto text-[11px] font-semibold text-rose-700 hover:text-rose-900 bg-white border border-rose-200 px-2.5 py-1 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
          >
            Hủy yêu cầu
          </button>
        </div>
      )}

      {/* Admin Assignment Management */}
      {admin && showProfile && !c.legacy && (
        <details open={mode === 'assignments'} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <summary className="font-bold text-xs sm:text-sm text-slate-800 cursor-pointer">
            Phân công và tư cách tham gia lớp
          </summary>
          <div className="space-y-4 mt-4 pt-3 border-t border-slate-200">
            <form
              key={e.assignments.map(a => a.id).join(':')}
              onSubmit={event => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                const assignments = [
                  ...(f.get('primary') ? [{ lecturerId: Number(f.get('primary')), role: 'primary' }] : []),
                  ...f.getAll('co').map(id => ({ lecturerId: Number(id), role: 'co' })),
                  ...(f.get('reviewer') ? [{ lecturerId: Number(f.get('reviewer')), role: 'reviewer' }] : [])
                ];
                post(`/api/admin/enrollments/${e.id}/assignments`, { assignments });
              }}
              className="grid sm:grid-cols-3 gap-3"
            >
              <FormField label="GVHD chính">
                <select name="primary" className={academicInput} defaultValue={primaryLecturer?.lecturerId || ''}>
                  <option value="">Chưa phân công</option>
                  {lecturers.map(l => (
                    <option key={l.id} value={l.id} disabled={/(^|\s)CN[.\s]/i.test(l.name)}>{l.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Đồng hướng dẫn" hint="Có thể chọn nhiều giảng viên">
                <select name="co" multiple className={academicInput} defaultValue={e.assignments.filter(a => a.role === 'co').map(a => String(a.lecturerId))}>
                  {lecturers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </FormField>
              {project && (
                <FormField label="GV nhận xét">
                  <select name="reviewer" className={academicInput} defaultValue={reviewerLecturer?.lecturerId || ''}>
                    <option value="">Chưa phân công</option>
                    {lecturers.map(l => (
                      <option key={l.id} value={l.id} disabled={/(^|\s)CN[.\s]/i.test(l.name)}>{l.name}</option>
                    ))}
                  </select>
                </FormField>
              )}
              <div className="sm:col-span-3">
                <Button type="submit" disabled={busy || !!e.submissionLockedAt || !!e.lockedAt || c.status === 'archived'}>
                  Lưu phân công
                </Button>
              </div>
            </form>
            <form
              onSubmit={event => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                post(`/api/admin/enrollments/${e.id}`, { status: e.status === 'active' ? 'withdrawn' : 'active', reason: f.get('reason') }, 'PATCH');
              }}
              className="flex flex-wrap gap-2 pt-2 border-t border-slate-200"
            >
              <input name="reason" className={`${academicInput} max-w-sm`} required placeholder="Lý do thay đổi tư cách tham gia" />
              <Button type="submit" disabled={busy || c.status === 'archived'}>
                {e.status === 'active' ? 'Rút khỏi lớp' : 'Tiếp nhận lại'}
              </Button>
            </form>
          </div>
        </details>
      )}

      {/* Project Topic Section */}
      {project && (
        <ProjectTopic enrollment={e} owner={owner} admin={admin} busy={busy} post={post} />
      )}

      {/* Report Preview & Grading Section */}
      {showReport && (
        <div className={`grid gap-6 ${!owner && e.canSeeGrades ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]' : ''}`}>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-[#034ea1]" />
                <h4 className="font-bold text-sm text-slate-900">Báo cáo và tài liệu</h4>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Phiên bản:</span>
                <select
                  aria-label="Phiên bản báo cáo"
                  className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold bg-white text-slate-800 outline-none focus:border-[#034ea1]"
                  value={viewed.id}
                  onChange={ev => setViewedId(ev.target.value)}
                >
                  {[...e.versions].reverse().map(v => (
                    <option key={v.id} value={v.id}>
                      Phiên bản {v.number}{v.id === current.id ? ' · Hiện hành' : ''}{v.state !== 'submitted' ? ' · Chưa hoàn tất' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Action Resource Links */}
            {(viewed.slidesUrl || viewed.demoUrl) && (
              <div className="flex flex-wrap gap-2.5">
                {viewed.slidesUrl && (
                  <a
                    href={viewed.slidesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold transition-all"
                  >
                    <Presentation size={14} className="text-amber-600" />
                    Slide thuyết trình <ExternalLink size={11} className="opacity-60" />
                  </a>
                )}
                {viewed.demoUrl && (
                  <a
                    href={viewed.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 text-xs font-semibold transition-all"
                  >
                    <Video size={14} className="text-indigo-600" />
                    Video demo <ExternalLink size={11} className="opacity-60" />
                  </a>
                )}
              </div>
            )}

            <PdfView token={token} enrollmentId={e.id} version={viewed} />
          </div>

          {/* Lecturer / Admin Evaluation Column */}
          {e.canSeeGrades && (
            <div className="space-y-4 lg:sticky lg:top-20 self-start">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Award size={16} className="text-[#034ea1]" />
                    <h4 className="font-bold text-sm text-slate-900">
                      {project ? 'Đánh giá' : 'Điểm Thực tập'}
                    </h4>
                  </div>
                  {e.lockedAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      <Lock size={11} /> Đã khóa
                    </span>
                  )}
                </div>

                {project && (
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg p-3">
                    <div>
                      <span className="text-slate-500 font-medium block text-[11px]">GVHD (60%)</span>
                      <strong className="text-base text-slate-900 block">{pair.advisor?.score ?? '—'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium block text-[11px]">GVNX (40%)</span>
                      <strong className="text-base text-slate-900 block">{pair.reviewer?.score ?? '—'}</strong>
                    </div>
                  </div>
                )}

                <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Điểm tổng kết:</span>
                  <span className="text-2xl font-black text-[#034ea1]">
                    {e.finalScore == null ? 'Chưa đủ điểm' : e.finalScore.toFixed(1)}
                  </span>
                </div>

                {!c.legacy && (project ? ['advisor', 'reviewer'] : ['internship']).filter(role => e.myAssignment.includes(role === 'reviewer' ? 'reviewer' : 'primary')).map(role => (
                  <form
                    key={`${role}:${current.id}`}
                    onSubmit={event => {
                      event.preventDefault();
                      const f = new FormData(event.currentTarget);
                      post(
                        project ? `${base}/project-evaluations/${role}` : `${base}/internship-grade`,
                        {
                          ...(project
                            ? { score: Number(f.get('score')) }
                            : { progress: Number(f.get('progress')), report: Number(f.get('report')), company: Number(f.get('company')) }),
                          comment: f.get('comment'),
                          submissionVersionId: current.id
                        }
                      );
                    }}
                    className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50"
                  >
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Phần chấm {project ? role === 'reviewer' ? 'GV Nhận xét (40%)' : 'GV Hướng dẫn (60%)' : 'GV hướng dẫn · Tiến độ 20%, báo cáo 20%, đơn vị 60%'}
                    </h5>
                    {(project ? [['score', 'Điểm số (0–10)']] : [['progress', 'Tiến độ (20%)'], ['report', 'Báo cáo (20%)'], ['company', 'Đơn vị/GV (60%)']]).map(([key, label]) => (
                      <FormField key={key} label={label}>
                        <input
                          aria-label={`Điểm ${role === 'reviewer' ? 'GVNX' : 'GVHD'}`}
                          className={academicInput}
                          type="number"
                          min="0"
                          max={project && !e.topicPermissions?.canGradeSubmitted ? '0' : '10'}
                          step="any"
                          name={key}
                          required
                          defaultValue={project ? pair[role]?.score ?? '' : e.internshipGrade?.[key] ?? ''}
                          disabled={busy || readOnly || !!e.lockedAt || viewed.id !== current.id}
                        />
                      </FormField>
                    ))}
                    <FormField label="Nhận xét / lý do (bắt buộc khi điểm 0)">
                      <textarea
                        aria-label="Nhận xét chấm điểm"
                        className={academicInput}
                        name="comment"
                        rows={3}
                        defaultValue={project ? pair[role]?.comment || '' : e.internshipGrade?.comment || ''}
                        disabled={readOnly || !!e.lockedAt}
                      />
                    </FormField>
                    <Button type="submit" variant="primary" disabled={busy || readOnly || !!e.lockedAt || viewed.id !== current.id}>
                      Lưu điểm
                    </Button>
                  </form>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {advisorChangeModal}
    </section>
  );
}
