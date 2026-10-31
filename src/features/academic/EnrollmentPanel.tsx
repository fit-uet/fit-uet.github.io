import { PdfView } from './PdfView';
import { useEffect, useState, useRef } from 'react';
import {
  Users, CheckCircle2, Clock, AlertCircle, AlertTriangle, FileText,
  BookOpen, GraduationCap, ExternalLink, Presentation,
  Video, ChevronDown, Check, Send, Lock, Award, Info, RefreshCw, X, Upload, Download, Eye
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

  // For students in project: select stage
  const initialStage = () => {
    if (['complete', 'locked'].includes(e.gradeStatus)) return 'grade';
    if (current.state === 'submitted' || e.topicReview?.status === 'approved') return 'submission';
    if (e.topic) return 'approval';
    return 'topic';
  };
  const [activeStage, setActiveStage] = useState<'topic' | 'approval' | 'submission' | 'grade'>(initialStage);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice('Đã lưu thành công.');
    } catch (err: any) {
      setError(err.message);
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

  // Student 4-stage stepper navigation tabs (identical layout to Internship)
  const stageTabs = [
    {
      id: 'topic' as const,
      step: '1',
      title: 'Khai báo đề tài',
      isDone: Boolean(e.topic),
      status: e.topic ? 'Đã khai báo' : 'Chưa có',
      variant: (e.topic ? 'success' : 'warning') as any,
    },
    {
      id: 'approval' as const,
      step: '2',
      title: 'GVHD duyệt',
      isDone: e.topicReview?.status === 'approved',
      status: e.topicReview?.status === 'approved' ? 'Đã duyệt' : e.topic ? 'Chờ duyệt' : 'Chưa có',
      variant: (e.topicReview?.status === 'approved' ? 'success' : e.topic ? 'warning' : 'neutral') as any,
    },
    {
      id: 'submission' as const,
      step: '3',
      title: 'Nộp bộ bài',
      isDone: current.state === 'submitted' && !requiresResubmission,
      status: requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã nộp đủ' : 'Chưa nộp',
      variant: (requiresResubmission ? 'warning' : current.state === 'submitted' ? 'success' : 'neutral') as any,
    },
    {
      id: 'grade' as const,
      step: '4',
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
            <span className="text-xs font-bold text-[#034ea1] bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
              Kỳ {c.semesterName || c.semesterId}
            </span>
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
            <button
              type="button"
              onClick={() => {
                const nav = new URLSearchParams(window.location.search);
                nav.set('tab', 'plan');
                window.history.pushState({}, '', '?' + nav.toString());
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="text-xs font-semibold text-slate-700 hover:text-[#034ea1] px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <FileText size={13} className="text-blue-600" /> Kế hoạch triển khai
            </button>
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
                    <Badge variant={e.topic ? 'success' : 'warning'} size="sm">
                      {e.topic ? 'Đã khai báo' : 'Chưa có'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn:</span>
                    <span className="font-medium text-slate-700">
                      {c.settings.topicCloseAt ? formatGMT7(c.settings.topicCloseAt) : 'Theo kế hoạch'}
                    </span>
                  </div>
                </div>

                {/* 2. GVHD duyệt đề tài */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">GVHD duyệt đề tài</span>
                    <Badge variant={e.topicReview?.status === 'approved' ? 'success' : e.topic ? 'warning' : 'neutral'} size="sm">
                      {e.topicReview?.status === 'approved' ? 'Đã duyệt' : e.topic ? 'Chờ duyệt' : 'Chưa có'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>GVHD:</span>
                    <span className="font-medium text-slate-700 truncate" title={primaryLecturerName}>
                      {primaryLecturerName || 'Chờ phân công'}
                    </span>
                  </div>
                </div>

                {/* 3. Nộp bộ bài Dự án */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">Nộp bộ bài Dự án</span>
                    <Badge variant={requiresResubmission ? 'warning' : current.state === 'submitted' ? 'success' : 'neutral'} size="sm">
                      {requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã nộp đủ' : 'Chưa nộp'}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                    <span>Hạn:</span>
                    <span className="font-medium text-slate-700">
                      {c.settings.submissionCloseAt ? formatGMT7(c.settings.submissionCloseAt) : 'Theo thông báo'}
                    </span>
                  </div>
                </div>

                {/* 4. Đánh giá & Điểm */}
                <div className="p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-800 truncate">Đánh giá & Điểm</span>
                    <Badge variant={['complete', 'locked'].includes(e.gradeStatus) ? 'success' : 'neutral'} size="sm">
                      {['complete', 'locked'].includes(e.gradeStatus)
                        ? 'Đã hoàn tất'
                        : e.gradeStatus === 'partial'
                        ? 'Đang chấm'
                        : 'Chờ đánh giá'}
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

            {/* Card 2: Quy định Dự án */}
            <details open className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <summary className="flex items-center justify-between font-bold text-slate-800 cursor-pointer select-none text-xs uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <BookOpen size={15} className="text-blue-600" />
                  Quy định Dự án
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
            {/* 4 Giai đoạn Dự án - Sleek Stepper Navigation Bar */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-1.5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
                {stageTabs.map((tab) => {
                  const isSelected = activeStage === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveStage(tab.id);
                        const targetId = tab.id === 'topic' || tab.id === 'approval' ? 'step-topic' : tab.id === 'submission' ? 'step-submission' : 'step-grade';
                        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`py-2.5 px-3 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
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
              {/* CARD 1: ĐỀ TÀI DỰ ÁN */}
              <div id="step-topic" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Khai báo & Duyệt đề tài Dự án</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Hạn duyệt đề tài: {c.settings.topicCloseAt ? formatGMT7(c.settings.topicCloseAt) : 'Theo kế hoạch'} (GMT+7) · GVHD: <strong className="text-slate-700">{primaryLecturerName || 'Chờ phân công'}</strong>
                    </p>
                  </div>
                  <div>
                    <Badge variant={e.topicReview?.status === 'approved' ? 'success' : e.topic ? 'warning' : 'neutral'} size="md">
                      {e.topicReview?.status === 'approved' ? 'Đã duyệt đề tài' : e.topic ? 'Chờ GVHD duyệt' : 'Chưa khai báo'}
                    </Badge>
                  </div>
                </div>

                {/* Topic Component (contains region 'Đề tài Dự án') */}
                <ProjectTopic enrollment={e} owner={owner} admin={admin} busy={busy} post={post} />

                {e.reviewComment && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                    <strong>Ý kiến từ giảng viên:</strong> {e.reviewComment}
                  </div>
                )}
              </div>

              {/* CARD 2: BÁO CÁO & BỘ BÀI NỘP DỰ ÁN */}
              <section id="step-submission" aria-label="Bộ bài nộp Dự án" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Báo cáo & Bộ bài nộp Dự án</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Hạn nộp: {c.settings.submissionCloseAt ? formatGMT7(c.settings.submissionCloseAt) : 'Theo kế hoạch'} (GMT+7)
                    </p>
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
                          <p className="text-xs text-slate-500">Bạn chưa nộp file báo cáo dự án.</p>
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
              <div id="step-grade" className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Đánh giá & Điểm số</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Hạn chấm: {c.settings.gradingCloseAt ? formatGMT7(c.settings.gradingCloseAt) : 'Theo kế hoạch'} (GMT+7)
                    </p>
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
                      <strong className="text-slate-800">{primaryLecturerName || 'Chờ phân công'}</strong>
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
                <h4 className="font-bold text-sm text-slate-900">Báo cáo & Bộ bài nộp</h4>
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
                      {project ? 'Đánh giá Dự án' : 'Điểm Thực tập'}
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
    </section>
  );
}
