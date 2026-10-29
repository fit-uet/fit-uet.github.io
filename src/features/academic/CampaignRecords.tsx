import { CampaignToolbarActions, useCampaignLayout } from './CampaignLayoutContext';
import type { ReactNode } from 'react';
import {
  FileText, Download, Eye, UserCheck, CheckCircle2, Clock, AlertCircle,
  Lock, Users, Award, ExternalLink, Presentation, Video
} from 'lucide-react';
import { Button, Badge, type BadgeVariant } from '../../shared/ui';
import type { LecturerInfo } from '../../shared/academic';
import { TOPIC_STATUS_NAMES } from '../../shared/academic';
import {
  gradeNames, lecturerNames, toLetterGrade,
  type CampaignRecord, type CampaignRecordPage, type EnrollmentPanelMode
} from './campaignPresentation';
import { academicDownload } from './client';

export function RecordBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const variant: BadgeVariant = tone === 'danger' ? 'error' : tone;
  return <Badge variant={variant} size="sm">{children}</Badge>;
}

function ExecutiveKpiRow({ tab, project, page, meta }: { tab: string; project: boolean; page: CampaignRecordPage | null; meta: any }) {
  if (!page && !meta) return null;
  const items = page?.items || [];
  const total = page?.total ?? meta?.stats?.enrollmentCount ?? 0;

  if (tab === 'reports') {
    const submitted = meta?.stats?.submitted ?? items.filter(e => e.versions.at(-1)?.state === 'submitted' && !e.topicPermissions?.requiresResubmission).length;
    const needsRevision = items.filter(e => e.needsRevision || e.topicPermissions?.requiresResubmission).length;
    const graded = meta?.stats?.graded ?? items.filter(e => ['complete', 'locked'].includes(e.gradeStatus)).length;
    const missing = Math.max(0, total - submitted - needsRevision);

    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã nộp báo cáo</span>
            <FileText size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#034ea1] tracking-tight">{submitted}</span>
            <span className="text-xs text-[#64748b]">/ {total} hồ sơ</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-1.5 font-medium">Chờ giảng viên chấm điểm</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa nộp đủ</span>
            <Clock size={16} className="text-[#64748b]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#64748b] tracking-tight">{missing}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-[#64748b] mt-1.5 font-medium">Cần đôn đốc nộp bài</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Cần nộp lại / sửa</span>
            <AlertCircle size={16} className="text-[#c2410c]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#c2410c] tracking-tight">{needsRevision}</span>
            <span className="text-xs text-[#64748b]">báo cáo</span>
          </div>
          <span className="text-[11px] text-[#c2410c] mt-1.5 font-medium">Cần hoàn thiện theo đề tài</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã có điểm</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight">{graded}</span>
            <span className="text-xs text-[#64748b]">hồ sơ</span>
          </div>
          <span className="text-[11px] text-emerald-600 mt-1.5 font-medium">
            {total > 0 ? `${((graded / total) * 100).toFixed(1)}% hoàn thành` : 'Chưa có'}
          </span>
        </div>
      </div>
    );
  }

  if (tab === 'grades') {
    const graded = meta?.stats?.graded ?? items.filter(e => ['complete', 'locked'].includes(e.gradeStatus)).length;
    const advisorMissing = meta?.stats?.advisorMissing ?? items.filter(e => e.canSeeGrades && !e.evaluations?.[e.versions.at(-1)!.id]?.advisor).length;
    const reviewerMissing = meta?.stats?.reviewerMissing ?? items.filter(e => e.canSeeGrades && !e.evaluations?.[e.versions.at(-1)!.id]?.reviewer).length;

    const scoredItems = items.filter(e => e.finalScore != null && !isNaN(e.finalScore));
    const avgScore = scoredItems.length > 0
      ? (scoredItems.reduce((acc, curr) => acc + (curr.finalScore ?? 0), 0) / scoredItems.length).toFixed(1)
      : '—';

    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã hoàn thành điểm</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight">{graded}</span>
            <span className="text-xs text-[#64748b]">/ {total} hồ sơ</span>
          </div>
          <span className="text-[11px] text-emerald-600 mt-1.5 font-medium">
            {total > 0 ? `${((graded / total) * 100).toFixed(1)}% hoàn thành` : 'Chưa có'}
          </span>
        </div>

        {project ? (
          <>
            <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
                <span>Chờ GVHD chấm (60%)</span>
                <Clock size={16} className="text-amber-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 tracking-tight">{advisorMissing}</span>
                <span className="text-xs text-[#64748b]">hồ sơ</span>
              </div>
              <span className="text-[11px] text-amber-600 mt-1.5 font-medium">Giảng viên hướng dẫn</span>
            </div>

            <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
                <span>Chờ GVNX chấm (40%)</span>
                <Clock size={16} className="text-indigo-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-indigo-600 tracking-tight">{reviewerMissing}</span>
                <span className="text-xs text-[#64748b]">hồ sơ</span>
              </div>
              <span className="text-[11px] text-indigo-600 mt-1.5 font-medium">Giảng viên nhận xét</span>
            </div>
          </>
        ) : (
          <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
              <span>Chưa hoàn tất điểm</span>
              <Clock size={16} className="text-rose-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 tracking-tight">{Math.max(0, total - graded)}</span>
              <span className="text-xs text-[#64748b]">sinh viên</span>
            </div>
            <span className="text-[11px] text-rose-600 mt-1.5 font-medium">Chưa đủ các đầu điểm</span>
          </div>
        )}

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Điểm trung bình</span>
            <Award size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#034ea1] tracking-tight">{avgScore}</span>
            <span className="text-xs text-[#64748b]">thang 10</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-1.5 font-medium">Hồ sơ đã có điểm kết luận</span>
        </div>
      </div>
    );
  }

  if (tab === 'assignments') {
    const hasPrimary = items.filter(e => e.assignments.some(a => a.role === 'primary')).length;
    const missingPrimary = total - hasPrimary;
    const hasReviewer = items.filter(e => e.assignments.some(a => a.role === 'reviewer')).length;
    const missingReviewer = total - hasReviewer;

    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã có GVHD chính</span>
            <UserCheck size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#034ea1] tracking-tight">{hasPrimary}</span>
            <span className="text-xs text-[#64748b]">/ {total} hồ sơ</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-1.5 font-medium">Giảng viên hướng dẫn chính</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa có GVHD</span>
            <Clock size={16} className="text-rose-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 tracking-tight">{Math.max(0, missingPrimary)}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-rose-600 mt-1.5 font-medium">Cần phân công GVHD</span>
        </div>

        {project && (
          <>
            <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
                <span>Đã phân công GVNX</span>
                <Users size={16} className="text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight">{hasReviewer}</span>
                <span className="text-xs text-[#64748b]">/ {total} hồ sơ</span>
              </div>
              <span className="text-[11px] text-emerald-600 mt-1.5 font-medium">Giảng viên nhận xét</span>
            </div>

            <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
                <span>Chưa phân công GVNX</span>
                <AlertCircle size={16} className="text-amber-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 tracking-tight">{Math.max(0, missingReviewer)}</span>
                <span className="text-xs text-[#64748b]">sinh viên</span>
              </div>
              <span className="text-[11px] text-amber-600 mt-1.5 font-medium">Cần cân bằng GVNX</span>
            </div>
          </>
        )}
      </div>
    );
  }

  if (tab === 'students') {
    const approved = items.filter(e => e.topicReview?.status === 'approved').length;
    const pending = items.filter(e => e.topicReview?.status === 'pending').length;
    const unregistered = items.filter(e => !e.topic || e.topicReview?.status === 'unregistered').length;

    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Tổng sinh viên</span>
            <Users size={16} className="text-[#034ea1]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#034ea1] tracking-tight">{total}</span>
            <span className="text-xs text-[#64748b]">lần học</span>
          </div>
          <span className="text-[11px] text-[#034ea1] mt-1.5 font-medium">Danh sách sinh viên trong nhóm</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Đã duyệt đề tài</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight">{approved}</span>
            <span className="text-xs text-[#64748b]">hồ sơ</span>
          </div>
          <span className="text-[11px] text-emerald-600 mt-1.5 font-medium">Đã được GVHD thông qua</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chờ GV duyệt</span>
            <Clock size={16} className="text-amber-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 tracking-tight">{pending}</span>
            <span className="text-xs text-[#64748b]">hồ sơ</span>
          </div>
          <span className="text-[11px] text-amber-600 mt-1.5 font-medium">Chờ giảng viên phản hồi</span>
        </div>

        <div className="bg-white border border-black/[0.06] rounded-2xl p-4.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#64748b] text-[11px] font-bold uppercase tracking-wider mb-2">
            <span>Chưa khai đề tài</span>
            <AlertCircle size={16} className="text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-600 tracking-tight">{unregistered}</span>
            <span className="text-xs text-[#64748b]">sinh viên</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1.5 font-medium">Chưa đăng ký tên đề tài</span>
        </div>
      </div>
    );
  }

  return null;
}

export function CampaignRecords({
  token,
  page,
  tab,
  project,
  lecturer,
  lecturers,
  query,
  editQuery,
  open,
  exportFile,
  busy,
  extraActions
}: {
  token?: string;
  page: CampaignRecordPage | null;
  tab: string;
  project: boolean;
  lecturer: boolean;
  lecturers: LecturerInfo[];
  query: URLSearchParams;
  editQuery: (patch: Record<string, string>) => void;
  open: (record: CampaignRecord, mode?: EnrollmentPanelMode) => void;
  exportFile: () => void;
  busy: boolean;
  extraActions?: ReactNode;
}) {
  const layout = useCampaignLayout();
  const meta = layout?.meta;

  const studentCell = (e: CampaignRecord) => (
    <div>
      <button
        className="font-bold text-[13px] text-[#034ea1] hover:underline text-left block leading-tight cursor-pointer"
        onClick={() => open(e, 'profile')}
      >
        {e.name}
      </button>
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200/60 px-1.5 py-0.5 rounded">
          {e.studentId}
        </span>
        <span className="text-[11px] text-slate-500 truncate max-w-[140px]">
          {e.className || 'Chưa có lớp'}
        </span>
      </div>
    </div>
  );

  const subjectCell = (e: CampaignRecord) => (
    <div>
      <span className="inline-block font-bold text-xs text-slate-800 bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-md">
        {e.courseCode}
      </span>
      <p className="text-[11px] text-slate-500 mt-1 font-medium">{e.classCode}</p>
    </div>
  );

  const reportCell = (e: CampaignRecord) => {
    const lastVersion = e.versions.at(-1);
    const isResubmission = e.topicPermissions?.requiresResubmission;
    const isRevision = e.needsRevision;
    const isSubmitted = lastVersion?.state === 'submitted';

    return (
      <div className="space-y-1.5">
        <div>
          {isResubmission ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              <AlertCircle size={11} /> Cần nộp lại theo đề tài
            </span>
          ) : isRevision ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-orange-50 text-orange-800 border border-orange-200">
              <AlertCircle size={11} /> Cần nộp lại
            </span>
          ) : isSubmitted ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 size={11} /> Đã nộp
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
              <Clock size={11} /> Chưa nộp đủ
            </span>
          )}
        </div>

        {lastVersion?.filename ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <FileText size={13} className="text-rose-600 shrink-0" />
            <span className="truncate max-w-[150px] font-medium" title={lastVersion.filename}>
              {lastVersion.filename}
            </span>
            {token && (
              <button
                type="button"
                title="Tải PDF"
                onClick={(ev) => {
                  ev.stopPropagation();
                  academicDownload(token, `/api/enrollments/${e.id}/submissions/${lastVersion.id}/download`, lastVersion.filename || 'report.pdf');
                }}
                className="text-[#034ea1] hover:text-blue-800 p-0.5 rounded hover:bg-blue-50 transition-colors cursor-pointer"
              >
                <Download size={13} />
              </button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-slate-400 italic">Chưa có PDF</span>
        )}
      </div>
    );
  };

  const columns: { title: string; render: (e: CampaignRecord) => ReactNode }[] = [
    { title: 'Sinh viên', render: studentCell },
    { title: 'Học phần / lớp', render: subjectCell }
  ];

  if (tab === 'assignments') {
    columns.push(
      {
        title: 'GVHD chính',
        render: e => {
          const names = lecturerNames(e, lecturers, 'primary');
          const isAssigned = names !== 'Chưa phân công';
          return (
            <div>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${isAssigned ? 'text-slate-800' : 'text-rose-600 font-medium'}`}>
                {isAssigned && <UserCheck size={12} className="text-[#034ea1]" />}
                {names}
              </span>
            </div>
          );
        }
      },
      {
        title: 'Đồng hướng dẫn',
        render: e => <span className="text-xs text-slate-600">{lecturerNames(e, lecturers, 'co')}</span>
      }
    );
    if (project) {
      columns.push({
        title: 'GV nhận xét',
        render: e => {
          const names = lecturerNames(e, lecturers, 'reviewer');
          const isAssigned = names !== 'Chưa phân công';
          return isAssigned ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800">
              <Users size={12} className="text-indigo-600" />
              {names}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              Chưa phân công GVNX
            </span>
          );
        }
      });
    }
    columns.push({
      title: 'Đề tài',
      render: e => (
        <div className="max-w-xs">
          <p className="text-xs font-medium text-slate-900 line-clamp-2" title={e.topic || 'Chưa khai đề tài'}>
            {e.topic || <span className="text-slate-400 italic">Chưa khai đề tài</span>}
          </p>
        </div>
      )
    });
  } else if (tab === 'reports') {
    columns.push(
      {
        title: 'Đề tài / GVHD',
        render: e => (
          <div className="max-w-sm">
            <p className="text-xs font-semibold text-slate-900 line-clamp-2" title={e.topic || 'Chưa khai đề tài'}>
              {e.topic || <span className="text-slate-400 italic">Chưa khai đề tài</span>}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <span className="font-semibold text-slate-600">GVHD:</span> {lecturerNames(e, lecturers, 'primary')}
            </p>
          </div>
        )
      },
      { title: 'Báo cáo PDF', render: reportCell }
    );
    if (project) {
      columns.push({
        title: 'Tài liệu bổ sung',
        render: e => {
          const lastVersion = e.versions.at(-1);
          return (
            <div className="flex flex-col gap-1 text-xs">
              {lastVersion?.slidesUrl ? (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={lastVersion.slidesUrl}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#034ea1] bg-blue-50 hover:bg-blue-100 border border-blue-200/80 px-2 py-0.5 rounded-md transition-colors w-fit"
                >
                  <Presentation size={12} /> Slide ↗
                </a>
              ) : (
                <span className="text-[11px] text-slate-400">Chưa có slide</span>
              )}
              {lastVersion?.demoUrl ? (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={lastVersion.demoUrl}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200/80 px-2 py-0.5 rounded-md transition-colors w-fit"
                >
                  <Video size={12} /> Video demo ↗
                </a>
              ) : (
                <span className="text-[11px] text-slate-400">Chưa có video</span>
              )}
            </div>
          );
        }
      });
    }
    columns.push({
      title: 'Nộp lúc',
      render: e => {
        const lastV = e.versions.at(-1);
        return lastV?.submittedAt ? (
          <span className="text-xs text-slate-600 font-medium">
            {new Date(lastV.submittedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        );
      }
    });
  } else if (tab === 'grades') {
    if (project) {
      columns.push(
        {
          title: 'GVHD (60%)',
          render: (e: CampaignRecord) => {
            const lastV = e.versions.at(-1);
            const score = e.canSeeGrades && lastV ? e.evaluations?.[lastV.id]?.advisor?.score : undefined;
            return (
              <div>
                <span className={`font-bold text-sm ${score != null ? 'text-slate-900' : 'text-slate-400'}`}>
                  {score != null ? score.toFixed(1) : '—'}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {lecturerNames(e, lecturers, 'primary')}
                </p>
              </div>
            );
          }
        },
        {
          title: 'GVNX (40%)',
          render: (e: CampaignRecord) => {
            const lastV = e.versions.at(-1);
            const score = e.canSeeGrades && lastV ? e.evaluations?.[lastV.id]?.reviewer?.score : undefined;
            return (
              <div>
                <span className={`font-bold text-sm ${score != null ? 'text-slate-900' : 'text-slate-400'}`}>
                  {score != null ? score.toFixed(1) : '—'}
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {lecturerNames(e, lecturers, 'reviewer')}
                </p>
              </div>
            );
          }
        }
      );
    } else {
      columns.push(
        ...([
          ['progress', 'Tiến độ (20%)'],
          ['report', 'Báo cáo (20%)'],
          ['company', 'Đơn vị/GV (60%)']
        ] as const).map(([key, title]) => ({
          title,
          render: (e: CampaignRecord) => (
            <span className="font-semibold text-slate-800">
              {e.canSeeGrades ? e.internshipGrade?.[key]?.toFixed(1) ?? '—' : '—'}
            </span>
          )
        }))
      );
    }
    columns.push(
      {
        title: 'Tổng kết',
        render: e => {
          if (!e.canSeeGrades || e.finalScore == null) return <span className="text-slate-400 font-bold">—</span>;
          const letter = toLetterGrade(e.finalScore);
          return (
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm text-[#034ea1]">
                {e.finalScore.toFixed(1)}
              </span>
              {letter && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-[#034ea1] border border-blue-200 font-mono">
                  {letter}
                </span>
              )}
            </div>
          );
        }
      },
      {
        title: 'Trạng thái',
        render: e => {
          if (e.gradeStatus === 'locked') {
            return (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <Lock size={11} /> Đã khóa
              </span>
            );
          }
          if (e.gradeStatus === 'complete') {
            return (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={11} /> Đã nộp điểm
              </span>
            );
          }
          if (e.gradeStatus === 'partial') {
            return (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Clock size={11} /> Chưa đủ điểm
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
              Chưa có điểm
            </span>
          );
        }
      }
    );
  } else if (tab === 'registrations') {
    columns.push({
      title: 'Nguyện vọng',
      render: e => e.preferences.length ? (
        <ol className="space-y-1.5">
          {e.preferences.map((v, i) => (
            <li key={v.id} className="text-xs">
              {i + 1}. <span className="font-medium text-slate-800">{v.companyName}</span>{' '}
              <RecordBadge tone={v.status === 'approved' ? 'success' : v.status === 'rejected' ? 'danger' : 'warning'}>
                {v.status === 'approved' ? 'Đã duyệt' : v.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}
              </RecordBadge>
            </li>
          ))}
        </ol>
      ) : <span className="text-xs text-slate-400">Chưa đăng ký</span>
    });
  } else if (tab === 'final-internships') {
    columns.push(
      {
        title: 'Nơi thực tập chính thức',
        render: e => <span className="font-semibold text-xs text-slate-800">{e.finalInternship?.companyName || 'Chưa xác nhận'}</span>
      },
      {
        title: 'Loại',
        render: e => <span className="text-xs text-slate-600">{e.finalInternship ? (e.finalInternship.type === 'school' ? 'Tại trường' : 'Doanh nghiệp') : '—'}</span>
      },
      {
        title: 'GVHD',
        render: e => <span className="text-xs text-slate-700">{lecturerNames(e, lecturers, 'primary')}</span>
      }
    );
  } else if (lecturer) {
    columns.push(
      {
        title: 'Vai trò',
        render: e => (
          <div className="flex flex-wrap gap-1">
            {e.myAssignment.map(role => (
              <span key={role} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-[#034ea1] border border-blue-200">
                {role === 'primary' ? 'GVHD chính' : role === 'reviewer' ? 'GV nhận xét' : 'Đồng hướng dẫn'}
              </span>
            ))}
          </div>
        )
      },
      {
        title: 'Đề tài',
        render: e => <p className="text-xs font-medium text-slate-800 max-w-sm line-clamp-2">{e.topic || <span className="text-slate-400 italic">Chưa khai đề tài</span>}</p>
      },
      { title: 'Báo cáo', render: reportCell }
    );
  } else {
    // tab === 'students'
    columns.push(
      {
        title: 'Liên hệ',
        render: e => (
          <a className="text-xs text-slate-600 hover:text-[#034ea1] hover:underline font-mono" href={`mailto:${e.email}`}>
            {e.email}
          </a>
        )
      },
      {
        title: 'Đề tài',
        render: e => (
          <p className="text-xs font-medium text-slate-800 max-w-sm line-clamp-2" title={e.topic || 'Chưa khai đề tài'}>
            {e.topic || <span className="text-slate-400 italic">Chưa khai đề tài</span>}
          </p>
        )
      },
      {
        title: 'Tư cách',
        render: e => (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
            e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
          }`}>
            {e.status === 'active' ? 'Đang học' : 'Đã rút'}
          </span>
        )
      }
    );
  }

  if (project) {
    columns.push({
      title: 'Duyệt đề tài',
      render: e => {
        const status = e.topicReview?.status || 'unregistered';
        return (
          <div className="space-y-0.5">
            {status === 'approved' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={10} /> Đã duyệt đề tài
              </span>
            ) : status === 'pending' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Clock size={10} /> Chờ GV duyệt
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                Chưa khai báo
              </span>
            )}
            {e.topicReview?.source === 'legacy' && (
              <p className="text-[10px] text-slate-400 italic">Công nhận dữ liệu cũ</p>
            )}
          </div>
        );
      }
    });
  }

  const action = tab === 'assignments'
    ? { mode: 'assignments', label: 'Điều chỉnh phân công', icon: UserCheck }
    : tab === 'grades'
    ? { mode: 'grades', label: 'Xem và chấm điểm', icon: CheckCircle2 }
    : tab === 'reports' || lecturer
    ? { mode: 'reports', label: 'Xem báo cáo', icon: Eye }
    : { mode: 'profile', label: 'Mở hồ sơ', icon: FileText };

  return (
    <div className="space-y-4">
      {/* Apple Executive KPI Row */}
      <ExecutiveKpiRow tab={tab} project={project} page={page} meta={meta} />

      {/* Main Table Card */}
      <section className="bg-white border border-black/[0.06] rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden" aria-label="Danh sách hồ sơ">
        <CampaignToolbarActions>
          {extraActions}
          <Button size="sm" leadingIcon={<Download size={14} />} disabled={busy} onClick={exportFile}>
            Xuất XLSX theo bộ lọc
          </Button>
        </CampaignToolbarActions>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#f8fafc] text-[11px] uppercase font-bold text-[#64748b] tracking-wider border-b border-black/[0.05] select-none">
              <tr>
                {columns.map(column => (
                  <th className="px-4 py-3.5 font-bold whitespace-nowrap" key={column.title}>
                    {column.title}
                  </th>
                ))}
                <th className="px-4 py-3.5 text-right font-bold whitespace-nowrap">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {page?.items.map(e => (
                <tr key={e.id} className="hover:bg-blue-50/30 transition-colors">
                  {columns.map(column => (
                    <td className="px-4 py-3.5 align-top text-slate-700" key={column.title}>
                      {column.render(e)}
                    </td>
                  ))}
                  <td className="px-4 py-3.5 text-right align-top whitespace-nowrap">
                    <Button
                      size="sm"
                      leadingIcon={<action.icon size={13} />}
                      onClick={() => open(e, action.mode as EnrollmentPanelMode)}
                    >
                      {action.label}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!page ? (
          <div className="p-12 text-center text-sm text-slate-500">
            <div className="w-7 h-7 rounded-full border-2 border-[#034ea1] border-t-transparent animate-spin mx-auto mb-2" />
            Đang tải danh sách…
          </div>
        ) : !page.items.length ? (
          <div className="p-12 text-center text-sm text-slate-500">
            <p className="font-medium">Không có hồ sơ trong bộ lọc.</p>
            <p className="text-xs text-slate-400 mt-1">Thử thay đổi học phần, lớp hoặc từ khóa tìm kiếm.</p>
          </div>
        ) : null}

        {/* Apple Pagination Bar */}
        <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 bg-[#f8fafc]/50">
          <span className="font-medium">
            {page ? (
              <>
                Hiển thị <span className="font-semibold text-slate-800">{page.items.length}</span> trong tổng số{' '}
                <span className="font-semibold text-slate-800">{page.total}</span> lần học ·{' '}
                <span className="font-semibold text-slate-800">{page.studentCount}</span> sinh viên
              </>
            ) : (
              'Đang tải…'
            )}
          </span>
          <div className="flex gap-2 items-center">
            <Button
              size="sm"
              disabled={!page || page.page <= 1}
              onClick={() => editQuery({ page: String(page!.page - 1), enrollmentId: '', panel: '' })}
            >
              Trước
            </Button>
            <span className="px-2 font-semibold text-slate-700">
              Trang {page?.page || 1} / {page?.totalPages || 1}
            </span>
            <Button
              size="sm"
              disabled={!page || page.page >= page.totalPages}
              onClick={() => editQuery({ page: String(page!.page + 1), enrollmentId: '', panel: '' })}
            >
              Sau
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
