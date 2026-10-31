import { useState } from 'react';
import { FileText, CheckCircle2, Clock, AlertCircle, AlertTriangle, Send, Edit3, X } from 'lucide-react';
import { TOPIC_STATUS_NAMES, type EnrollmentView } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicInput } from './form';

export function ProjectTopic({
  enrollment: e,
  owner,
  admin,
  busy,
  post,
  embedded = false,
}: {
  enrollment: EnrollmentView;
  owner: boolean;
  admin: boolean;
  busy: boolean;
  post: (path: string, body: any, method?: string) => Promise<void>;
  embedded?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const permissions = e.topicPermissions;
  const primary = e.myAssignment.includes('primary');
  const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  const status = e.topicReview?.status || 'unregistered';
  const isApproved = status === 'approved';
  const isPending = status === 'pending';

  return (
    <section className={embedded ? "space-y-4" : "bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4"} aria-label="Đề tài">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0 border border-blue-100">
              <FileText size={16} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">Đề tài</h4>
              <p className="text-xs text-slate-500">Sinh viên gửi tên đề tài để GVHD chính xem xét, duyệt trước khi nộp bài</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isApproved ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                <CheckCircle2 size={13} className="text-emerald-600" /> {TOPIC_STATUS_NAMES[status]}
              </span>
            ) : isPending ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80">
                <Clock size={13} className="text-amber-600" /> {TOPIC_STATUS_NAMES[status]}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                <AlertCircle size={13} className="text-slate-500" /> {TOPIC_STATUS_NAMES[status]}
              </span>
            )}

            {!owner && permissions?.canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(val => !val)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs"
              >
                {editing ? <X size={13} /> : <Edit3 size={13} />}
                {editing ? 'Đóng sửa' : primary ? 'Sửa & duyệt' : 'Chỉnh sửa'}
              </button>
            )}
          </div>
        </div>
      )}

      {(owner && !isApproved) || editing ? (
        <form
          key={`${e.id}:${e.topicReview?.version}`}
          onSubmit={async event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await post(`/api/enrollments/${e.id}/topic`, {
              title: data.get('title'),
              ...(admin && !primary ? { reason: data.get('reason') } : {})
            });
            setEditing(false);
          }}
          className="space-y-3"
        >
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {owner ? 'Nhập tên đề tài đăng ký' : 'Tên đề tài'} <span className="text-rose-500">*</span>
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                aria-label="Tên đề tài"
                name="title"
                defaultValue={e.topic}
                placeholder="Ví dụ: Xây dựng hệ thống phát hiện gian lận giao dịch tài chính bằng học máy..."
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm bg-[#f8fafc] focus:bg-white focus:border-[#034ea1] focus:ring-2 focus:ring-[#034ea1]/20 outline-none transition-all shadow-2xs text-slate-900 font-medium placeholder:text-slate-400"
                maxLength={1500}
                required
                disabled={busy || !permissions?.canEdit}
              />
              <button
                type="submit"
                disabled={busy || !permissions?.canEdit}
                className="px-5 py-2.5 bg-[#034ea1] hover:bg-[#023a7a] text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {primary ? <CheckCircle2 size={14} /> : <Send size={14} />}
                {primary ? 'Lưu & Duyệt' : owner ? 'Gửi GVHD duyệt' : 'Lưu & Gửi duyệt'}
              </button>
            </div>
          </div>

          {admin && !primary && (
            <FormField label="Lý do điều chỉnh đề tài (bắt buộc)">
              <input name="reason" className={academicInput} placeholder="Nhập lý do thay đổi tên đề tài..." required />
            </FormField>
          )}

          {owner && !permissions?.canEdit && (
            <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
              <AlertCircle size={14} className="shrink-0" />
              <span>Ngoài hạn sửa đề tài hoặc bài đã được khóa điểm. Vui lòng liên hệ Khoa khi cần điều chỉnh.</span>
            </div>
          )}
        </form>
      ) : (
        <div className="bg-[#f8fafc] border border-slate-200/80 rounded-xl p-4 transition-all">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Tên đề tài
          </div>
          <p className="font-semibold text-sm sm:text-[15px] text-slate-900 leading-relaxed whitespace-pre-wrap break-words">
            {e.topic || <span className="text-slate-400 italic">Chưa khai báo tên đề tài</span>}
          </p>

          <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2 text-xs">
            {e.topicReview?.source === 'legacy' ? (
              <span className="text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-600" /> Đã duyệt — công nhận dữ liệu trước nâng cấp
              </span>
            ) : e.topicReview?.approvedAt ? (
              <span className="text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-600" /> Được duyệt bởi <strong>{e.topicReview.approvedByName}</strong> lúc {date(e.topicReview.approvedAt)}
              </span>
            ) : e.topic ? (
              <span className="text-amber-700 flex items-center gap-1.5">
                <Clock size={14} className="text-amber-600" /> Đang chờ GVHD chính xem xét và thông qua
              </span>
            ) : (
              <span className="text-slate-400 italic">
                Vui lòng điền và gửi tên đề tài để GVHD phê duyệt trước khi nộp bài
              </span>
            )}

            {owner && permissions?.canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[#034ea1] hover:underline font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
              >
                <Edit3 size={12} /> Đổi tên đề tài
              </button>
            )}
          </div>
        </div>
      )}

      {!owner && permissions?.canApprove && (
        <div className="pt-1 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => post(`/api/enrollments/${e.id}/topic/approve`, {}, 'POST')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-[0.98]"
          >
            <CheckCircle2 size={14} /> Duyệt đề tài này
          </button>
        </div>
      )}

      {permissions?.requiresResubmission && (
        <div className="p-3.5 rounded-xl border border-amber-200/80 bg-amber-50/90 text-xs text-amber-900 flex items-start gap-2.5 leading-relaxed">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>Cần nộp lại theo đề tài mới:</strong> Đề tài đã được cập nhật hoặc thay đổi so với bài nộp trước. Sinh viên cần xác nhận và nộp lại bộ bài theo đúng đề tài mới trước khi giảng viên chấm điểm.
          </div>
        </div>
      )}

      {e.topicSubmissionUntil && (
        <div className="p-3 rounded-xl border border-blue-200/80 bg-blue-50/70 text-xs text-blue-900 flex items-center gap-2">
          <Clock size={14} className="text-[#034ea1] shrink-0" />
          <span>Thời hạn nộp bổ sung cho hồ sơ: <strong>{date(e.topicSubmissionUntil)}</strong> (không kéo dài hạn sửa đề tài).</span>
        </div>
      )}
    </section>
  );
}
