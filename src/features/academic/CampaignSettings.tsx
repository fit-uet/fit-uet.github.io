import type { CampaignSummary } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicApi } from './client';
import { academicInput, isoLocal } from './form';
import { useCampaignLayout } from './CampaignLayoutContext';
import { Clock, Save, Sliders, CheckCircle2, Calendar } from 'lucide-react';

// Operational settings live here. Each Markdown document has one dedicated
// editor with Word import/preview, so saving deadlines cannot overwrite text.
export function CampaignSettingsPanel({ token, c, run, busy }: { token: string; c: CampaignSummary; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const layout = useCampaignLayout();
  const local = (value: string) => value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T').slice(0, 19) : '';
  const times = c.group === 'project'
    ? [['topic', 'Khai đề tài'], ['submission', 'Nộp bài'], ['grading', 'Chấm điểm']]
    : [['registration', 'Đăng ký'], ['confirmation', 'Xác nhận nơi TT'], ['advisorRequest', 'Đề xuất GVHD'], ['submission', 'Nộp báo cáo'], ['grading', 'Chấm điểm']];
  const readOnly = busy || c.status === 'archived' || !!c.pendingMigration;

  return (
    <section className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0">
            <Sliders size={18} />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900">Thiết lập chung cho {c.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Thời hạn tiến độ, quyền xem điểm số và trạng thái vận hành của nhóm môn.</p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border self-start sm:self-auto ${
          c.status === 'active'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : c.status === 'archived'
            ? 'bg-slate-100 text-slate-600 border-slate-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {c.status === 'active' ? 'Đang hoạt động' : c.status === 'archived' ? 'Đã lưu trữ' : 'Bản nháp'}
        </span>
      </div>

      {/* Trạng thái nhóm môn */}
      <div className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/50 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Trạng thái vận hành</h4>
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={event => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            run(() => academicApi(token, `/api/admin/campaigns/${c.id}`, 'PATCH', {
              expectedRevision: c.revision,
              status: f.get('status'),
              reason: f.get('reason'),
            }));
          }}
        >
          <FormField label="Trạng thái">
            <select aria-label="Trạng thái nhóm môn" className={academicInput} name="status" defaultValue={c.status}>
              <option value="draft">Nháp</option>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Lưu trữ</option>
            </select>
          </FormField>
          <FormField label="Lý do thay đổi">
            <input aria-label="Lý do thay đổi trạng thái" className={academicInput} name="reason" placeholder="Lý do lưu trữ / mở lại..." />
          </FormField>
          <Button type="submit" disabled={busy || !!c.pendingMigration} leadingIcon={<CheckCircle2 size={15} />}>
            Cập nhật trạng thái
          </Button>
        </form>
      </div>

      {/* Form cấu hình thời hạn & quyền xem điểm */}
      <form
        className="space-y-6"
        onSubmit={event => {
          event.preventDefault();
          const f = new FormData(event.currentTarget), settings: any = {};
          for (const [key] of times) {
            for (const suffix of ['OpenAt', 'CloseAt']) {
              const field = key + suffix, value = String(f.get(field) || '');
              settings[field] = value === local(c.settings[field]) ? c.settings[field] : isoLocal(value);
            }
          }
          if (c.group === 'internship') settings.allowedCohorts = String(f.get('allowedCohorts') || '');
          settings.notifyOnCompletion = f.get('notifyOnCompletion') === 'on';
          settings.publishGradesToStudents = f.get('publishGradesToStudents') === 'on';
          run(() => academicApi(token, `/api/admin/campaigns/${c.id}/settings`, 'PUT', { expectedRevision: c.revision, settings }));
        }}
      >
        <fieldset disabled={readOnly} className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-[#034ea1]" />
              <h4 className="font-bold text-sm text-slate-900">Mốc thời gian tiến độ học phần</h4>
            </div>
            <p className="text-xs text-slate-500">
              Các thời điểm dùng giờ Việt Nam (GMT+7). Để trống để không giới hạn mốc mở hoặc mốc đóng tương ứng.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {times.map(([key, label]) => (
                <div key={key} className="border border-slate-200/90 bg-white rounded-xl p-4 space-y-3 shadow-2xs hover:border-slate-300 transition-colors">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                      <Calendar size={13} className="text-[#034ea1]" />
                      {label}
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    <FormField label="Mở lúc">
                      <input
                        aria-label={`${label} — Mở lúc`}
                        className={`${academicInput} text-xs`}
                        type="datetime-local"
                        step="1"
                        name={`${key}OpenAt`}
                        defaultValue={local(c.settings[`${key}OpenAt`])}
                      />
                    </FormField>
                    <FormField label="Đóng lúc">
                      <input
                        aria-label={`${label} — Đóng lúc`}
                        className={`${academicInput} text-xs`}
                        type="datetime-local"
                        step="1"
                        name={`${key}CloseAt`}
                        defaultValue={local(c.settings[`${key}CloseAt`])}
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {c.group === 'internship' && (
            <FormField label="Các khóa được phép tự tham gia (phân cách bằng dấu phẩy)">
              <input className={academicInput} name="allowedCohorts" defaultValue={c.settings.allowedCohorts} placeholder="Ví dụ: K66, K67, QH-2023..." />
            </FormField>
          )}

          {/* Nút bật/tắt cho phép sinh viên xem điểm số (mặc định tắt) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/70 border border-slate-200/90 rounded-xl gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">
                  Cho phép sinh viên xem điểm số
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  c.settings.publishGradesToStudents
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {c.settings.publishGradesToStudents ? 'Đang bật' : 'Đang tắt (mặc định)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Mặc định tắt: sinh viên chỉ theo dõi tiến độ và nhận xét, không xem điểm số trên hệ thống. Khi bật, sinh viên sẽ xem được điểm số và nhận xét chi tiết.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                name="publishGradesToStudents"
                aria-label="Cho phép sinh viên xem điểm số"
                defaultChecked={Boolean(c.settings.publishGradesToStudents)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#034ea1]"></div>
            </label>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" name="notifyOnCompletion" defaultChecked={c.settings.notifyOnCompletion} className="rounded border-slate-300 text-[#034ea1] focus:ring-[#034ea1]" />
            <span>Thông báo sinh viên khi hoàn tất đánh giá (không chứa điểm số)</span>
          </label>

          <div className="pt-2">
            <Button type="submit" variant="primary" size="lg" leadingIcon={<Save size={15} />}>
              Lưu thiết lập nhóm môn
            </Button>
          </div>
        </fieldset>
      </form>

      <section aria-label="Các trang biên tập nội dung" className="border-t border-slate-200/90 pt-5 space-y-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Nội dung hướng dẫn & quy định</h4>
          <p className="text-xs text-slate-500 mt-0.5">Mỗi nội dung được chỉnh sửa và xem trước tại trang riêng.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {[
            ['plan-editor', 'Cài đặt Kế hoạch'],
            ['guide-editor', 'Cài đặt Hướng dẫn GV'],
            ['faq-editor', 'Cài đặt FAQ'],
            ...(c.group === 'internship' ? [['rules-editor', 'Cài đặt Quy định thực tập']] : []),
          ].map(([tab, label]) => (
            <Button
              key={tab}
              size="sm"
              variant="outline"
              data-settings-tab={tab}
              onClick={() => layout?.editQuery({ tab })}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>
    </section>
  );
}
