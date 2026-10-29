import { useState } from 'react';
import { TOPIC_STATUS_NAMES, type EnrollmentView } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicInput } from './form';
import { RecordBadge } from './CampaignRecords';

export function ProjectTopic({ enrollment: e, owner, admin, busy, post }: { enrollment: EnrollmentView; owner: boolean; admin: boolean; busy: boolean; post: (path: string, body: any, method?: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const permissions = e.topicPermissions;
  const primary = e.myAssignment.includes('primary');
  const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return <section className="space-y-3" aria-label="Đề tài Dự án">
    <div className="flex flex-wrap gap-3 items-center justify-between"><h4 className="font-medium text-sm">Đề tài</h4><RecordBadge tone={e.topicReview?.status === 'approved' ? 'success' : 'warning'}>{TOPIC_STATUS_NAMES[e.topicReview?.status || 'unregistered']}</RecordBadge></div>
    {e.topicReview?.source === 'legacy' ? <p className="text-xs text-slate-500">Đã duyệt — công nhận dữ liệu cũ</p> : e.topicReview?.approvedAt && <p className="text-xs text-slate-500">{e.topicReview.approvedByName} duyệt lúc {date(e.topicReview.approvedAt)}</p>}
    {(owner || editing) && (owner || permissions?.canEdit) ? <form key={`${e.id}:${e.topicReview?.version}`} onSubmit={async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      await post(`/api/enrollments/${e.id}/topic`, { title: data.get('title'), ...(admin && !primary ? { reason: data.get('reason') } : {}) });
    }} className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2"><input aria-label="Tên đề tài Dự án" name="title" defaultValue={e.topic} className={`${academicInput} min-w-0`} maxLength={1500} required disabled={busy || !permissions?.canEdit} /><Button type="submit" disabled={busy || !permissions?.canEdit}>{primary ? 'Lưu và duyệt' : owner ? 'Gửi GVHD duyệt' : 'Lưu và gửi chờ duyệt'}</Button></div>
      {admin && !primary && <FormField label="Lý do điều chỉnh đề tài"><input name="reason" className={academicInput} required /></FormField>}
      {owner && !permissions?.canEdit && <p className="text-xs text-slate-500">Ngoài hạn sửa đề tài hoặc bài đã khóa. Liên hệ Khoa khi cần điều chỉnh.</p>}
    </form> : <p className="text-sm whitespace-pre-wrap break-words">{e.topic || 'Chưa khai đề tài'}</p>}
    {!owner && <div className="flex flex-wrap gap-2">{permissions?.canApprove && <Button size="sm" variant="primary" disabled={busy} onClick={() => post(`/api/enrollments/${e.id}/topic/approve`, {}, 'POST')}>Duyệt đề tài</Button>}{permissions?.canEdit && <Button size="sm" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? 'Đóng chỉnh sửa' : primary ? 'Sửa và duyệt' : 'Điều chỉnh đề tài'}</Button>}</div>}
    {permissions?.requiresResubmission && <p className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">Cần nộp lại theo đề tài mới. Bài cũ được giữ để đối chiếu; sinh viên cần xác nhận nộp bộ bài theo đề tài đã duyệt trước khi chấm.</p>}
    {e.topicSubmissionUntil && <p className="text-sm text-[#034ea1]">Hạn nộp bổ sung cho hồ sơ: {date(e.topicSubmissionUntil)}. Hạn này không kéo dài thời gian SV sửa đề tài.</p>}
  </section>;
}
