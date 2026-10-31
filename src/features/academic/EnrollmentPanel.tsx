import { PdfView } from './PdfView';
import { useEffect, useState, useRef } from 'react';
import {
  Users, CheckCircle2, Clock, AlertCircle, AlertTriangle, FileText,
  BookOpen, GraduationCap, UploadCloud, ExternalLink, Presentation,
  Video, Milestone, Check, Send, Lock, Award, Info, RefreshCw, X
} from 'lucide-react';
import { Button, FormField } from '../../shared/ui';
import type { AcademicClassSummary, EnrollmentView, LecturerInfo, SubmissionVersion } from '../../shared/academic';
import { academicApi, academicPdf, academicDownload } from './client';
import type { EnrollmentPanelMode } from './campaignPresentation';
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

  // Project Progress Steps
  const projectSteps = [
    {
      step: '1',
      title: 'Khai báo đề tài',
      done: Boolean(e.topic),
      active: !e.topic,
      statusText: e.topic ? 'Đã khai báo' : 'Cần khai báo',
      sub: e.topic || 'Chưa gửi tên đề tài',
    },
    {
      step: '2',
      title: 'GVHD duyệt đề tài',
      done: e.topicReview?.status === 'approved',
      active: Boolean(e.topic) && e.topicReview?.status !== 'approved',
      statusText: e.topicReview?.status === 'approved' ? 'Đã duyệt' : e.topic ? 'Chờ duyệt' : 'Chưa có',
      sub: e.topicReview?.status === 'approved' ? 'Đã được thông qua' : e.topic ? 'Đang đợi GVHD duyệt' : 'Chưa gửi đề tài',
    },
    {
      step: '3',
      title: 'Nộp bộ bài',
      done: current.state === 'submitted' && !requiresResubmission,
      active: e.topicReview?.status === 'approved' && (current.state !== 'submitted' || requiresResubmission),
      statusText: requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã nộp đủ' : 'Chưa nộp',
      sub: current.state === 'submitted' ? `Phiên bản ${current.number}` : 'PDF, Slide & Demo',
    },
    {
      step: '4',
      title: 'Đánh giá & Hoàn tất',
      done: ['complete','locked'].includes(e.gradeStatus),
      active: current.state === 'submitted' && !['complete','locked'].includes(e.gradeStatus) && !requiresResubmission,
      statusText: ['complete','locked'].includes(e.gradeStatus) ? 'Đã hoàn tất đánh giá' : e.gradeStatus==='partial'?'Đang đánh giá':current.state === 'submitted' ? 'Chờ đánh giá' : 'Chưa đánh giá',
      sub: 'Điểm chính thức tra cứu tại Cổng Đào tạo',
    },
  ];

  return (
    <section className="bg-white border border-black/[0.06] rounded-3xl p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-6">
      {/* 1. Header Profile Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-black/[0.05]">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#034ea1] to-[#023a7a] text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
            {e.name ? e.name.charAt(0).toUpperCase() : 'S'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-xl sm:text-2xl text-slate-900 tracking-tight leading-tight">{e.name}</h3>
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200/80">
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
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 self-start sm:self-auto ${
            e.status === 'withdrawn'
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : requiresResubmission
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : current.state === 'submitted'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            {e.status === 'withdrawn' ? (
              <><AlertCircle size={13} className="text-rose-600" /> Đã rút</>
            ) : requiresResubmission ? (
              <><AlertTriangle size={13} className="text-amber-600" /> Cần nộp lại theo đề tài mới</>
            ) : current.state === 'submitted' ? (
              <><CheckCircle2 size={13} className="text-emerald-600" /> Đã nộp bộ bài</>
            ) : (
              <><Clock size={13} className="text-slate-500" /> Chưa hoàn tất nộp bài</>
            )}
          </span>
        </div>
      </div>

      {/* 2. Stepper Timeline (Project Milestone Stepper) */}
      {project && owner && (
        <div className="bg-gradient-to-b from-[#f8fafc] to-white border border-black/[0.06] rounded-2xl p-4.5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <Milestone size={16} className="text-[#034ea1]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">Tiến độ học phần Dự án</span>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold border border-slate-200/60">
              {c.semesterName || c.semesterId}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {projectSteps.map(s => (
              <div
                key={s.step}
                className={`rounded-2xl p-3.5 border transition-all duration-200 flex flex-col justify-between ${
                  s.done
                    ? 'bg-emerald-50/40 border-emerald-200/80 shadow-2xs'
                    : s.active
                    ? 'bg-blue-50/70 border-[#034ea1]/40 shadow-xs ring-2 ring-blue-500/10'
                    : 'bg-white/90 border-slate-200/70 opacity-75'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black font-mono shadow-2xs ${
                      s.done
                        ? 'bg-emerald-600 text-white'
                        : s.active
                        ? 'bg-[#034ea1] text-white ring-2 ring-blue-200'
                        : 'bg-slate-100 text-slate-400'
                    }`}>
                      {s.done ? <Check size={12} strokeWidth={3} /> : s.step}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Bước {s.step}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    s.done
                      ? 'bg-emerald-100/80 text-emerald-800 border-emerald-200'
                      : s.active
                      ? 'bg-blue-100/80 text-blue-800 border-blue-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {s.statusText}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-xs text-slate-900 leading-snug">{s.title}</p>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1" title={s.sub}>{s.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notice / Feedback Banners */}
      {error && (
        <div role="alert" className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-800 shadow-2xs">
          <AlertCircle size={16} className="text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 shadow-2xs">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {c.legacy && (
        <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 leading-relaxed shadow-2xs">
          Hồ sơ Thực tập Hè 2025–2026 được đọc từ dữ liệu hiện có. Các tác vụ Thực tập tiếp tục được duy trì tại các mục chức năng của nhóm môn.
        </div>
      )}

      {/* 3. Executive Info Cards (Học phần, GVHD, Báo cáo, Hạn nộp) */}
      {showProfile && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Học phần */}
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Học phần</span>
              <BookOpen size={16} className="text-[#034ea1]" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-extrabold text-[#034ea1] tracking-tight leading-snug truncate" title={c.courseName}>
                {c.courseName}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono">{c.code}</div>
            </div>
            <span className="text-[11px] text-[#034ea1] mt-2 font-medium">Lớp học phần chính khóa</span>
          </div>

          {/* Card 2: Giảng viên hướng dẫn */}
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>GVHD chính</span>
              <GraduationCap size={16} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight leading-snug truncate">
                {primaryLecturerName || 'Chưa phân công'}
              </div>
              <div className="text-xs text-slate-500 mt-1 truncate">
                {coLecturerNames.length > 0 ? `Đồng HD: ${coLecturerNames.join('; ')}` : 'Giảng viên hướng dẫn chính'}
              </div>
            </div>
            <span className="text-[11px] text-emerald-600 mt-2 font-medium">
              {primaryLecturerName ? 'Đã được phân công GVHD' : 'Chờ Khoa phân công'}
            </span>
          </div>

          {/* Card 3: Báo cáo */}
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Bộ bài nộp</span>
              <FileText size={16} className="text-amber-600" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight leading-snug truncate">
                {requiresResubmission ? 'Cần nộp lại' : current.state === 'submitted' ? 'Đã hoàn tất nộp' : 'Chưa hoàn tất'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {current.objectKey ? 'Đã có file PDF báo cáo' : 'Chưa đính kèm PDF'} · Bản {current.number}
              </div>
            </div>
            <span className={`text-[11px] mt-2 font-medium ${current.state === 'submitted' && !requiresResubmission ? 'text-emerald-600' : 'text-amber-600'}`}>
              {requiresResubmission ? 'Cần nộp lại theo đề tài mới' : current.state === 'submitted' ? 'Đã nộp đủ các thành phần' : 'Cần tải lên bộ bài nộp'}
            </span>
          </div>

          {/* Card 4: Hạn nộp bài */}
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Hạn nộp bài</span>
              <Clock size={16} className="text-slate-700" />
            </div>
            <div>
              <div className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight leading-snug">
                {c.settings.submissionCloseAt
                  ? new Date(c.settings.submissionCloseAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
                  : 'Theo thông báo'}
              </div>
              <div className="text-xs text-slate-500 mt-1">Học kỳ {c.semesterId}</div>
            </div>
            <span className="text-[11px] text-slate-500 mt-2 font-medium">Hạn chốt nộp bộ sản phẩm</span>
          </div>
        </div>
      )}

      {mode === 'profile' && (
        <dl className="grid sm:grid-cols-2 gap-4 text-xs bg-[#f8fafc] border border-slate-200/80 rounded-2xl p-4">
          <div>
            <dt className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Email VNU</dt>
            <dd className="mt-1 font-mono font-semibold text-slate-800">{e.email}</dd>
          </div>
          <div>
            <dt className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Ngày sinh</dt>
            <dd className="mt-1 font-semibold text-slate-800">{e.dob || 'Chưa có thông tin'}</dd>
          </div>
        </dl>
      )}

      {/* Admin Assignment Management */}
      {admin && showProfile && !c.legacy && (
        <details open={mode === 'assignments'} className="border border-slate-200/80 rounded-2xl p-4.5 bg-[#f8fafc]/50">
          <summary className="font-bold text-xs sm:text-sm text-slate-800 cursor-pointer">
            Phân công và tư cách tham gia lớp
          </summary>
          <div className="space-y-4 mt-4 pt-3 border-t border-slate-200/60">
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
              className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/50"
            >
              <input name="reason" className={`${academicInput} max-w-sm`} required placeholder="Lý do thay đổi tư cách tham gia" />
              <Button type="submit" disabled={busy || c.status === 'archived'}>
                {e.status === 'active' ? 'Rút khỏi lớp' : 'Tiếp nhận lại'}
              </Button>
            </form>
          </div>
        </details>
      )}

      {/* 4. Project Topic Section */}
      {project && (
        <ProjectTopic enrollment={e} owner={owner} admin={admin} busy={busy} post={post} />
      )}

      {/* Internship Flow (for internship groups) */}
      {!project && !c.legacy && (
        <InternshipFlow token={token} user={user} c={c} e={e} lecturers={lecturers} post={post} busy={busy} readOnly={readOnly} />
      )}

      {/* Revision Request Banner */}
      {e.needsRevision && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 leading-relaxed space-y-1 shadow-2xs">
          <div className="font-bold flex items-center gap-1.5 text-amber-800">
            <AlertTriangle size={15} /> Giảng viên yêu cầu chỉnh sửa bài nộp
          </div>
          <p className="whitespace-pre-wrap">{e.reviewComment}</p>
        </div>
      )}

      {/* Topic Block Reason Banner */}
      {owner && project && e.topicPermissions?.submissionBlockReason && (
        <div role="status" className="p-4 bg-amber-50/90 border border-amber-200/80 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5 leading-relaxed shadow-2xs">
          <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>Lưu ý nộp bài:</strong> {e.topicPermissions.submissionBlockReason}
          </div>
        </div>
      )}

      {/* 5. Submission Workspace Form */}
      {owner && !readOnly && (
        <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-4">
          <div className="flex items-center gap-2.5 pb-2 border-b border-black/[0.05]">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0 border border-blue-100/50">
              <UploadCloud size={18} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                Nộp / Cập nhật {project ? 'bộ bài Dự án' : 'báo cáo Thực tập'}
              </h4>
              <p className="text-xs text-slate-500">
                {project ? 'Bao gồm file PDF báo cáo, đường dẫn Slide thuyết trình và Video demo sản phẩm' : 'Tải lên tệp PDF báo cáo kết quả thực tập'}
              </p>
            </div>
          </div>

          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              f.set('expectedRevision', String(e.revision));
              f.set('reusePdfVersionId', current.id);
              run(() => academicApi(token, `${base}/submission`, 'POST', f));
            }}
          >
            <fieldset disabled={busy || (project && !e.topicPermissions?.canSubmit)} className="space-y-4 min-w-0">
              {/* PDF File Upload Zone */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Báo cáo PDF (tối đa 10 MB) <span className="text-rose-500">*</span>
                </label>

                {/* Hidden native input for form binding */}
                <input
                  ref={fileInputRef}
                  type="file"
                  name="pdf"
                  accept="application/pdf,.pdf"
                  required={!current.objectKey && !selectedPdfFile}
                  disabled={busy || !!e.lockedAt || (project && !!e.submissionLockedAt)}
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

                {/* Interactive dropzone card */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
                    selectedPdfFile
                      ? 'border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/60'
                      : current.objectKey
                      ? 'border-blue-200 bg-blue-50/30 hover:bg-blue-50/50'
                      : 'border-slate-200/90 bg-[#f8fafc] hover:bg-slate-100/70 hover:border-blue-300'
                  }`}
                >
                  {selectedPdfFile ? (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={20} />
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate max-w-xs sm:max-w-md">{selectedPdfFile.name}</p>
                        <p className="text-[11px] text-emerald-700 mt-0.5">
                          {(selectedPdfFile.size / 1024 / 1024).toFixed(2)} MB · Nhấp để chọn file khác
                        </p>
                      </div>
                    </div>
                  ) : current.objectKey ? (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-[#034ea1] flex items-center justify-center shrink-0">
                        <FileText size={20} />
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate max-w-xs sm:max-w-md">
                          Đã có file: {current.filename || 'Bao_cao_du_an.pdf'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {(current.size / 1024 / 1024).toFixed(2)} MB · Nhấp vào đây nếu bạn muốn tải lên file PDF mới thay thế
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center text-[#034ea1] mb-2">
                        <UploadCloud size={20} />
                      </div>
                      <p className="text-xs font-bold text-slate-800">
                        Nhấp để chọn tệp PDF báo cáo hoặc kéo thả vào đây
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Hỗ trợ định dạng .pdf, dung lượng tối đa 10 MB
                      </p>
                    </>
                  )}
                </div>

                {fileError && (
                  <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                    <AlertCircle size={13} /> {fileError}
                  </p>
                )}
              </div>

              {/* Project Slide & Demo Inputs */}
              {project && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Presentation size={14} className="text-amber-600" />
                      Link Google Drive slide <span className="text-rose-500">*</span>
                    </label>
                    <input
                      name="slidesUrl"
                      aria-label="Link Google Drive slide"
                      type="url"
                      required
                      defaultValue={current.slidesUrl}
                      placeholder="https://drive.google.com/file/d/... hoặc link Google Slides"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-2xs text-slate-900 font-medium"
                      disabled={!!e.submissionLockedAt}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                      <Video size={14} className="text-indigo-600" />
                      Link Google Drive video demo <span className="text-rose-500">*</span>
                    </label>
                    <input
                      name="demoUrl"
                      aria-label="Link Google Drive video demo"
                      type="url"
                      required
                      defaultValue={current.demoUrl}
                      placeholder="https://drive.google.com/file/d/..."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-2xs text-slate-900 font-medium"
                      disabled={!!e.submissionLockedAt}
                    />
                  </div>

                  <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200/70 rounded-xl text-xs text-slate-500">
                    <Info size={14} className="text-[#034ea1] shrink-0" />
                    <span>Cấp quyền xem slide và video cho GVHD/GVNX trước khi nộp.</span>
                  </div>
                </div>
              )}

              {!!e.submissionLockedAt && (
                <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                  <Lock size={15} className="shrink-0" />
                  <span>Đợt chấm điểm đã bắt đầu và bài nộp đã được khóa. Liên hệ Khoa để xin mở lại bài nếu cần chỉnh sửa gấp.</span>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={busy || !!e.lockedAt || (project && (!e.topicPermissions?.canSubmit || !!e.submissionLockedAt))}
                  className="px-6 py-2.5 bg-[#034ea1] hover:bg-[#023a7a] text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? 'Đang lưu…' : 'Xác nhận nộp bài'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      )}

      {/* 6. Report Preview & Grading Section */}
      {showReport && (
        <div className={`grid gap-6 ${!owner && e.canSeeGrades ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]' : ''}`}>
          <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/[0.05]">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-[#034ea1]" />
                <h4 className="font-bold text-sm text-slate-900">Báo cáo & Bộ bài nộp</h4>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Phiên bản:</span>
                <select
                  aria-label="Phiên bản báo cáo"
                  className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold bg-[#f8fafc] text-slate-800 outline-none focus:border-[#034ea1] cursor-pointer shadow-2xs"
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

            {viewed.id !== current.id && (
              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>Bạn đang xem phiên bản lịch sử cũ. Chọn bản hiện hành để xem kết quả mới nhất hoặc chấm điểm.</span>
              </div>
            )}

            {/* Quick Action Resource Links */}
            {(viewed.slidesUrl || viewed.demoUrl) && (
              <div className="flex flex-wrap gap-2.5 pt-1">
                {viewed.slidesUrl && (
                  <a
                    href={viewed.slidesUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-amber-900 text-xs font-semibold transition-all shadow-2xs"
                  >
                    <Presentation size={14} className="text-amber-600" />
                    Mở Slide thuyết trình
                    <ExternalLink size={12} className="opacity-60" />
                  </a>
                )}
                {viewed.demoUrl && (
                  <a
                    href={viewed.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-900 text-xs font-semibold transition-all shadow-2xs"
                  >
                    <Video size={14} className="text-indigo-600" />
                    Mở Video demo
                    <ExternalLink size={12} className="opacity-60" />
                  </a>
                )}
              </div>
            )}

            <PdfView token={token} enrollmentId={e.id} version={viewed} />
          </div>

          {/* Lecturer / Admin Evaluation Column */}
          {e.canSeeGrades && (
            <div className="space-y-4 lg:sticky lg:top-20 self-start">
              <div className="bg-white border border-black/[0.06] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-black/[0.05]">
                  <div className="flex items-center gap-2">
                    <Award size={18} className="text-[#034ea1]" />
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

                {project && !e.topicPermissions?.canGradeSubmitted && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
                    Chưa có bộ bài hợp lệ theo đề tài đã duyệt. Chỉ được nhập điểm 0 kèm lý do bỏ môn/chưa có bài.
                  </p>
                )}

                {project && (
                  <div className="grid grid-cols-2 gap-2.5 text-xs bg-[#f8fafc] border border-slate-200/70 rounded-xl p-3.5">
                    <div>
                      <span className="text-slate-400 font-semibold block text-[10px] uppercase">GVHD (60%)</span>
                      <strong className="text-base text-slate-900 mt-0.5 block">{pair.advisor?.score ?? '—'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 font-semibold block text-[10px] uppercase">GVNX (40%)</span>
                      <strong className="text-base text-slate-900 mt-0.5 block">{pair.reviewer?.score ?? '—'}</strong>
                    </div>
                  </div>
                )}

                <div className="p-3.5 rounded-xl border border-blue-200/80 bg-blue-50/60 flex items-center justify-between">
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
                    className="border border-slate-200 rounded-xl p-4 space-y-3 bg-[#f8fafc]/50"
                  >
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Phần chấm {project ? role === 'reviewer' ? 'GV Nhận xét (40%)' : 'GV Hướng dẫn (60%)' : 'GV hướng dẫn · Tiến độ 20%, báo cáo 20%, đơn vị 60%'}
                    </h5>
                    {(project ? [['score', 'Điểm số (0–10)']] : [['progress', 'Tiến độ (20%)'], ['report', 'Báo cáo (20%)'], ['company', 'Đơn vị/GV (60%)']]).map(([key, label]) => (
                      <FormField key={key} label={label}>
                        <input
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
                        className={academicInput}
                        name="comment"
                        rows={3}
                        defaultValue={project ? pair[role]?.comment || '' : e.internshipGrade?.comment || ''}
                        disabled={readOnly || !!e.lockedAt}
                      />
                    </FormField>
                    <Button type="submit" variant="primary" disabled={busy || readOnly || !!e.lockedAt || viewed.id !== current.id}>
                      Lưu và gửi điểm về Khoa
                    </Button>
                  </form>
                ))}

                {!readOnly && (admin || e.myAssignment.some(r => r === 'primary' || r === 'reviewer')) && (
                  <form
                    className="space-y-2 pt-2 border-t border-slate-200/60"
                    onSubmit={event => {
                      event.preventDefault();
                      post(`${base}/submission/review`, { needsRevision: true, comment: new FormData(event.currentTarget).get('comment') });
                    }}
                  >
                    <textarea className={academicInput} name="comment" placeholder="Nội dung yêu cầu sinh viên sửa bài..." required rows={2} />
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy || !!e.lockedAt}>Yêu cầu sửa</Button>
                      {e.needsRevision && (
                        <Button disabled={busy || !!e.lockedAt} onClick={() => post(`${base}/submission/review`, { needsRevision: false, comment: '' })}>
                          Hủy yêu cầu
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin Grade Lock / Reopen Controls */}
      {admin && showReport && !readOnly && (
        <details className="border-t border-slate-200/60 pt-4">
          <summary className="font-semibold text-xs text-slate-700 cursor-pointer">
            Khóa điểm / mở lại bài nộp
          </summary>
          <div className="grid md:grid-cols-2 gap-5 mt-4">
            <form
              className="space-y-3 bg-[#f8fafc] border border-slate-200 rounded-2xl p-4"
              onSubmit={event => {
                event.preventDefault();
                post(`/api/admin/enrollments/${e.id}/grade-lock`, { locked: !e.lockedAt, reason: new FormData(event.currentTarget).get('reason') });
              }}
            >
              <FormField label="Lý do khóa / mở khóa">
                <input name="reason" className={academicInput} required placeholder="Nhập lý do thực hiện..." />
              </FormField>
              <Button type="submit" disabled={busy || (!e.lockedAt && e.finalScore == null)}>
                {e.lockedAt ? 'Mở khóa điểm' : 'Khóa điểm'}
              </Button>
            </form>

            <form
              className="space-y-3 bg-[#f8fafc] border border-slate-200 rounded-2xl p-4"
              onSubmit={event => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                post(`/api/admin/enrollments/${e.id}/submission/reopen`, { reason: f.get('reason'), submissionUntil: isoLocal(f.get('until')) }, 'POST');
              }}
            >
              <FormField label="Lý do mở lại bài">
                <input name="reason" className={academicInput} required placeholder="Nhập lý do mở lại bài..." />
              </FormField>
              <FormField label="Hạn nộp lại (giờ Việt Nam)">
                <input name="until" className={academicInput} type="datetime-local" required />
              </FormField>
              <p className="text-[11px] text-slate-500">Tạo phiên bản mới; các phần đánh giá cần được nộp lại.</p>
              <Button type="submit" disabled={busy || !!e.lockedAt}>Mở lại bài</Button>
            </form>
          </div>
        </details>
      )}
    </section>
  );
}

function InternshipFlow({
  token,
  user,
  c,
  e,
  lecturers,
  post,
  busy,
  readOnly
}: {
  token: string;
  user: any;
  c: AcademicClassSummary;
  e: EnrollmentView;
  lecturers: LecturerInfo[];
  post: (path: string, body: any, method?: string) => Promise<void>;
  busy: boolean;
  readOnly: boolean;
}) {
  const [companies, setCompanies] = useState<any[]>([]);
  const owner = user.role === 'student';
  const admin = user.role === 'admin';
  const base = `/api/enrollments/${e.id}/internship`;

  useEffect(() => {
    const abort = new AbortController();
    academicApi<any[]>(token, `/api/classes/${c.id}/companies`, 'GET', undefined, abort.signal)
      .then(setCompanies)
      .catch(() => {});
    return () => abort.abort();
  }, [token, c.id]);

  return (
    <div className="border border-slate-200/80 rounded-2xl p-5 space-y-4 bg-white shadow-2xs">
      <h4 className="font-bold text-sm text-slate-900">Nguyện vọng và nơi thực tập chính thức</h4>
      {e.finalInternship && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" />
          <span>Đã xác nhận chính thức tại: <strong>{e.finalInternship.companyName}</strong></span>
        </div>
      )}

      <div className="space-y-2">
        {e.preferences.map(p => (
          <div key={p.id} className="flex flex-wrap gap-3 items-center justify-between border border-slate-200/70 bg-[#f8fafc] rounded-xl p-3 text-xs">
            <div>
              <strong className="text-slate-800 text-sm">{p.companyName}</strong>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                p.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : p.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {p.status === 'approved' ? 'Đã duyệt' : p.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}
              </span>
              {p.reviewComment && <p className="text-slate-500 mt-1">{p.reviewComment}</p>}
            </div>
            <div className="flex gap-2">
              {owner && !readOnly && (
                <>
                  <Button size="sm" onClick={() => post(`${base}/preferences/remove`, { preferenceId: p.id }, 'POST')} disabled={busy}>
                    Xóa
                  </Button>
                  {p.status === 'approved' && (
                    <Button size="sm" variant="primary" onClick={() => { if (window.confirm(`Tôi cam kết đã được ${p.companyName} tiếp nhận và chịu trách nhiệm về xác nhận này.`)) post(`${base}/final/confirm`, { preferenceId: p.id, attested: true }, 'POST'); }} disabled={busy}>
                      Xác nhận nơi thực tập
                    </Button>
                  )}
                </>
              )}
              {admin && !readOnly && (
                <Button size="sm" onClick={() => post(`${base}/preferences/review`, { preferenceId: p.id, status: 'approved' }, 'POST')} disabled={busy || p.status === 'approved'}>
                  Duyệt
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {owner && !readOnly && (
        <>
          <form
            className="grid sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200/60"
            onSubmit={event => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              const value = String(f.get('companyId'));
              post(
                `${base}/preferences`,
                {
                  companyId: value !== 'other' && value !== 'school' ? Number(value) : null,
                  type: value === 'school' ? 'school' : 'company',
                  companyName: f.get('companyName'),
                  note: f.get('note')
                },
                'POST'
              );
            }}
          >
            <FormField label="Nơi thực tập">
              <select className={academicInput} name="companyId">
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="other">Công ty tự liên hệ</option>
                <option value="school">Trường Đại học Công nghệ</option>
              </select>
            </FormField>
            <FormField label="Tên công ty tự liên hệ">
              <input className={academicInput} name="companyName" placeholder="Tên doanh nghiệp..." />
            </FormField>
            <FormField label="Ghi chú">
              <input className={academicInput} name="note" placeholder="Ghi chú thêm..." />
            </FormField>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || e.preferences.length >= 5}>
                Thêm nguyện vọng ({e.preferences.length}/5)
              </Button>
            </div>
          </form>

          <form
            className="space-y-3 border-t border-slate-200/60 pt-3"
            onSubmit={event => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              post(`${base}/advisor-request`, {
                lecturerId: Number(f.get('lecturerId')),
                agreed: f.get('agreed') === 'on',
                note: f.get('note')
              }, 'POST');
            }}
          >
            <h5 className="font-bold text-xs text-slate-800 uppercase tracking-wider">Đề xuất GVHD đã đồng ý hướng dẫn</h5>
            <select className={academicInput} name="lecturerId">
              {lecturers.filter(l => !/(^|\s)CN[.\s]/i.test(l.name)).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <input name="note" className={academicInput} placeholder="Ghi chú cho đề xuất..." />
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input name="agreed" type="checkbox" required className="accent-[#034ea1]" />
              <span>Tôi cam kết đã được giảng viên đồng ý hướng dẫn</span>
            </label>
            <Button type="submit" disabled={busy}>Gửi đề xuất</Button>
          </form>
        </>
      )}

      {e.advisorRequest && (
        <div className="text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <span>Đề xuất GVHD: <strong>{lecturers.find(l => l.id === e.advisorRequest.lecturerId)?.name}</strong> · Trạng thái: {e.advisorRequest.status}</span>
          {admin && !readOnly && e.advisorRequest.status === 'pending' && (
            <Button size="sm" onClick={() => post(`${base}/advisor-request/review`, { status: 'approved' }, 'POST')} disabled={busy}>
              Duyệt & phân công
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
