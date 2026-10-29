import { CampaignToolbarActions } from './CampaignLayoutContext';
import type { ReactNode } from 'react';
import { FileText, Download, Eye, UserCheck, CheckCircle2 } from 'lucide-react';
import { Button, Badge, type BadgeVariant } from '../../shared/ui';
import type { LecturerInfo } from '../../shared/academic';
import { TOPIC_STATUS_NAMES } from '../../shared/academic';
import { gradeNames, lecturerNames, type CampaignRecord, type CampaignRecordPage, type EnrollmentPanelMode } from './campaignPresentation';

export function RecordBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const variant: BadgeVariant = tone === 'danger' ? 'error' : tone;
  return <Badge variant={variant} size="sm">{children}</Badge>;
}
export function CampaignRecords({ page, tab, project, lecturer, lecturers, query, editQuery, open, exportFile, busy, extraActions }: { page: CampaignRecordPage | null; tab: string; project: boolean; lecturer: boolean; lecturers: LecturerInfo[]; query: URLSearchParams; editQuery: (patch: Record<string, string>) => void; open: (record: CampaignRecord, mode?: EnrollmentPanelMode) => void; exportFile: () => void; busy: boolean; extraActions?:ReactNode }) {
  const studentCell = (e: CampaignRecord) => <div><button className="font-semibold text-[#034ea1] hover:underline text-left" onClick={() => open(e, 'profile')}>{e.name}</button><p className="text-xs text-slate-500 mt-1">{e.studentId} · {e.className || 'Chưa có lớp khóa học'}</p></div>;
  const subjectCell = (e: CampaignRecord) => <div><strong className="font-medium text-slate-700">{e.courseCode}</strong><p className="text-xs text-slate-500 mt-1">{e.classCode}</p></div>;
  const reportCell = (e: CampaignRecord) => <div className="space-y-1"><RecordBadge tone={e.needsRevision || e.topicPermissions?.requiresResubmission ? 'warning' : e.versions.at(-1)?.state === 'submitted' ? 'success' : 'danger'}>{e.topicPermissions?.requiresResubmission ? 'Cần nộp lại theo đề tài' : e.needsRevision ? 'Cần nộp lại' : e.versions.at(-1)?.state === 'submitted' ? 'Đã nộp' : 'Chưa nộp đủ'}</RecordBadge><p className="text-xs text-slate-500">{e.versions.at(-1)?.filename || 'Chưa có PDF'}</p></div>;
  const columns: { title: string; render: (e: CampaignRecord) => ReactNode }[] = [{ title: 'Sinh viên', render: studentCell }, { title: 'Học phần / lớp', render: subjectCell }];
  if (tab === 'assignments') {
    columns.push({ title: 'GVHD chính', render: e => lecturerNames(e, lecturers, 'primary') }, { title: 'Đồng hướng dẫn', render: e => lecturerNames(e, lecturers, 'co') });
    if (project) columns.push({ title: 'GV nhận xét', render: e => lecturerNames(e, lecturers, 'reviewer') });
    columns.push({ title: 'Đề tài', render: e => e.topic || 'Chưa khai đề tài' });
  } else if (tab === 'reports') {
    columns.push({ title: 'Đề tài / nội dung', render: e => <div className="max-w-sm"><p>{e.topic || 'Chưa khai đề tài'}</p><p className="text-xs text-slate-500 mt-1">GVHD: {lecturerNames(e, lecturers, 'primary')}</p></div> }, { title: 'Báo cáo', render: reportCell });
    if (project) columns.push({ title: 'Tài liệu bổ sung', render: e => <div className="flex flex-col gap-2 text-xs text-[#034ea1]">{e.versions.at(-1)?.slidesUrl ? <a target="_blank" rel="noreferrer" href={e.versions.at(-1)!.slidesUrl}>Mở slide ↗</a> : <span className="text-slate-400">Chưa có slide</span>}{e.versions.at(-1)?.demoUrl ? <a target="_blank" rel="noreferrer" href={e.versions.at(-1)!.demoUrl}>Video demo ↗</a> : <span className="text-slate-400">Chưa có video</span>}</div> });
    columns.push({ title: 'Nộp lúc', render: e => e.versions.at(-1)?.submittedAt ? new Date(e.versions.at(-1)!.submittedAt!).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—' });
  } else if (tab === 'grades') {
    if (project) columns.push(...(['advisor', 'reviewer'] as const).map(role => ({ title: role === 'advisor' ? 'GVHD (60%)' : 'GVNX (40%)', render: (e: CampaignRecord) => <div><strong>{e.canSeeGrades ? e.evaluations?.[e.versions.at(-1)!.id]?.[role]?.score?.toFixed(1) ?? '—' : '—'}</strong><p className="text-[11px] text-slate-500 mt-1">{lecturerNames(e, lecturers, role === 'advisor' ? 'primary' : 'reviewer')}</p></div> })));
    else columns.push(...([['progress', 'Tiến độ (20%)'], ['report', 'Báo cáo (20%)'], ['company', 'Đơn vị/GV (60%)']] as const).map(([key, title]) => ({ title, render: (e: CampaignRecord) => e.canSeeGrades ? e.internshipGrade?.[key]?.toFixed(1) ?? '—' : '—' })));
    columns.push({ title: 'Tổng kết', render: e => <strong className="text-[#034ea1]">{e.canSeeGrades && e.finalScore != null ? e.finalScore.toFixed(1) : '—'}</strong> }, { title: 'Trạng thái', render: e => <RecordBadge tone={['complete', 'locked'].includes(e.gradeStatus) ? 'success' : 'warning'}>{gradeNames[e.gradeStatus] || 'Chưa có điểm'}</RecordBadge> });
  } else if (tab === 'registrations') {
    columns.push({ title: 'Nguyện vọng', render: e => e.preferences.length ? <ol className="space-y-2">{e.preferences.map((v, i) => <li key={v.id}>{i + 1}. {v.companyName} <RecordBadge tone={v.status === 'approved' ? 'success' : v.status === 'rejected' ? 'danger' : 'warning'}>{v.status === 'approved' ? 'Đã duyệt' : v.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}</RecordBadge></li>)}</ol> : 'Chưa đăng ký' });
  } else if (tab === 'final-internships') {
    columns.push({ title: 'Nơi thực tập chính thức', render: e => e.finalInternship?.companyName || 'Chưa xác nhận' }, { title: 'Loại', render: e => e.finalInternship ? e.finalInternship.type === 'school' ? 'Tại trường' : 'Doanh nghiệp' : '—' }, { title: 'GVHD', render: e => lecturerNames(e, lecturers, 'primary') });
  } else if (lecturer) {
    columns.push({ title: 'Vai trò', render: e => <div className="flex flex-wrap gap-1">{e.myAssignment.map(role => <RecordBadge key={role}>{role === 'primary' ? 'GVHD chính' : role === 'reviewer' ? 'GV nhận xét' : 'Đồng hướng dẫn'}</RecordBadge>)}</div> }, { title: 'Đề tài', render: e => e.topic || 'Chưa khai đề tài' }, { title: 'Báo cáo', render: reportCell });
  } else {
    columns.push({ title: 'Liên hệ', render: e => <a className="text-xs text-slate-600 hover:underline" href={`mailto:${e.email}`}>{e.email}</a> }, { title: 'Đề tài', render: e => <p className="max-w-sm">{e.topic || 'Chưa khai đề tài'}</p> }, { title: 'Tư cách', render: e => <RecordBadge tone={e.status === 'active' ? 'success' : 'neutral'}>{e.status === 'active' ? 'Đang học' : 'Đã rút'}</RecordBadge> });
  }
  if (project) columns.push({ title: 'Duyệt đề tài', render: e => <div className="space-y-1"><RecordBadge tone={e.topicReview?.status === 'approved' ? 'success' : 'warning'}>{TOPIC_STATUS_NAMES[e.topicReview?.status || 'unregistered']}</RecordBadge>{e.topicReview?.source === 'legacy' && <p className="text-[11px] text-slate-500">Công nhận dữ liệu cũ</p>}</div> });
  const action = tab === 'assignments' ? { mode: 'assignments', label: 'Điều chỉnh phân công', icon: UserCheck } : tab === 'grades' ? { mode: 'grades', label: 'Xem và chấm điểm', icon: CheckCircle2 } : tab === 'reports' || lecturer ? { mode: 'reports', label: 'Xem báo cáo', icon: Eye } : { mode: 'profile', label: 'Mở hồ sơ', icon: FileText };
  return <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden" aria-label="Danh sách hồ sơ">
    <CampaignToolbarActions>{extraActions}<Button size="sm" leadingIcon={<Download size={14} />} disabled={busy} onClick={exportFile}>Xuất XLSX theo bộ lọc</Button></CampaignToolbarActions>
    <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="bg-slate-50 text-slate-500 uppercase tracking-wider"><tr>{columns.map(column => <th className="px-4 py-3 font-semibold whitespace-nowrap" key={column.title}>{column.title}</th>)}<th className="px-4 py-3 text-right">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-100">{page?.items.map(e => <tr key={e.id} className="hover:bg-slate-50/80">{columns.map(column => <td className="px-4 py-3 align-top text-slate-700" key={column.title}>{column.render(e)}</td>)}<td className="px-4 py-3 text-right align-top"><Button size="sm" leadingIcon={<action.icon size={14} />} onClick={() => open(e, action.mode as EnrollmentPanelMode)}>{action.label}</Button></td></tr>)}</tbody></table></div>
    {!page ? <p role="status" className="p-10 text-center text-sm text-slate-500">Đang tải danh sách…</p> : !page.items.length ? <p className="p-10 text-center text-sm text-slate-500">Không có hồ sơ trong bộ lọc.</p> : null}
    <div className="p-4 border-t border-slate-100 flex flex-wrap justify-between gap-3 text-xs text-slate-500"><span>{page ? `${page.total} lần học · ${page.studentCount} sinh viên` : 'Đang tải…'}</span><div className="flex gap-2 items-center"><Button size="sm" disabled={!page || page.page <= 1} onClick={() => editQuery({ page: String(page!.page - 1), enrollmentId: '', panel: '' })}>Trước</Button><span>{page?.page || 1}/{page?.totalPages || 1}</span><Button size="sm" disabled={!page || page.page >= page.totalPages} onClick={() => editQuery({ page: String(page!.page + 1), enrollmentId: '', panel: '' })}>Sau</Button></div></div>
  </section>;
}
