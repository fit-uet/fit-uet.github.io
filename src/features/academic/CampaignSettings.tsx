import type { CampaignSummary } from '../../shared/academic';
import { Button, FormField } from '../../shared/ui';
import { academicApi } from './client';
import { academicInput, isoLocal } from './form';
import { useCampaignLayout } from './CampaignLayoutContext';

// Operational settings live here. Each Markdown document has one dedicated
// editor with Word import/preview, so saving deadlines cannot overwrite text.
export function CampaignSettingsPanel({ token, c, run, busy }: { token: string; c: CampaignSummary; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const layout=useCampaignLayout();
  const local = (value: string) => value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T').slice(0, 19) : '';
  const times = c.group === 'project' ? [['topic', 'Khai đề tài'], ['submission', 'Nộp bài'], ['grading', 'Chấm điểm']] : [['registration', 'Đăng ký'], ['confirmation', 'Xác nhận nơi TT'], ['advisorRequest', 'Đề xuất GVHD'], ['submission', 'Nộp báo cáo'], ['grading', 'Chấm điểm']];
  const readOnly=busy||c.status==='archived'||!!c.pendingMigration;
  return <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-6"><h3 className="font-semibold">Thiết lập chung cho {c.name}</h3>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); run(() => academicApi(token, `/api/admin/campaigns/${c.id}`, 'PATCH', { expectedRevision: c.revision, status: f.get('status'), reason: f.get('reason') })); }}>
      <FormField label="Trạng thái"><select aria-label="Trạng thái nhóm môn" className={academicInput} name="status" defaultValue={c.status}><option value="draft">Nháp</option><option value="active">Đang hoạt động</option><option value="archived">Lưu trữ</option></select></FormField>
      <FormField label="Lý do thay đổi"><input aria-label="Lý do thay đổi trạng thái" className={academicInput} name="reason" placeholder="Lý do lưu trữ / mở lại" /></FormField><Button type="submit" disabled={busy||!!c.pendingMigration}>Cập nhật trạng thái</Button>
    </form>
    <form className="space-y-5" onSubmit={event => {
      event.preventDefault();const f=new FormData(event.currentTarget),settings:any={};
      for(const[key]of times)for(const suffix of ['OpenAt','CloseAt']){const field=key+suffix,value=String(f.get(field)||'');settings[field]=value===local(c.settings[field])?c.settings[field]:isoLocal(value);}
      if(c.group==='internship')settings.allowedCohorts=String(f.get('allowedCohorts')||'');
      settings.notifyOnCompletion=f.get('notifyOnCompletion')==='on';
      settings.publishGradesToStudents=f.get('publishGradesToStudents')==='on';
      run(()=>academicApi(token,`/api/admin/campaigns/${c.id}/settings`,'PUT',{expectedRevision:c.revision,settings}));
    }}>
      <fieldset disabled={readOnly} className="space-y-5">
        <p className="text-sm text-slate-500">Các thời điểm dùng giờ Việt Nam. Để trống để không giới hạn đầu/cuối tương ứng.</p>
        <div className="grid md:grid-cols-2 gap-4">{times.map(([key,label])=><div key={key} className="border border-slate-200 rounded-lg p-4 space-y-2"><h4 className="font-medium text-sm">{label}</h4><FormField label="Mở lúc"><input aria-label={`${label} — Mở lúc`} className={academicInput} type="datetime-local" step="1" name={`${key}OpenAt`} defaultValue={local(c.settings[`${key}OpenAt`])}/></FormField><FormField label="Đóng lúc"><input aria-label={`${label} — Đóng lúc`} className={academicInput} type="datetime-local" step="1" name={`${key}CloseAt`} defaultValue={local(c.settings[`${key}CloseAt`])}/></FormField></div>)}</div>
        {c.group==='internship'&&<FormField label="Các khóa được phép tự tham gia (phân cách bằng dấu phẩy)"><input className={academicInput} name="allowedCohorts" defaultValue={c.settings.allowedCohorts}/></FormField>}
        
        {/* Nút bật/tắt cho phép sinh viên xem điểm số (mặc định tắt) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl gap-3">
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
            <div className="w-11 h-6 bg-slate-250 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#034ea1]"></div>
          </label>
        </div>

        <label className="flex gap-2 text-sm"><input type="checkbox" name="notifyOnCompletion" defaultChecked={c.settings.notifyOnCompletion}/>Thông báo sinh viên khi hoàn tất đánh giá (không chứa điểm)</label>
        <Button type="submit" variant="primary">Lưu thiết lập nhóm môn</Button>
      </fieldset>
    </form>
    <section aria-label="Các trang biên tập nội dung" className="border-t border-slate-200 pt-4 space-y-3"><h4 className="text-sm font-semibold">Nội dung hướng dẫn</h4><p className="text-xs text-slate-500">Mỗi nội dung được chỉnh sửa và xem trước tại trang riêng.</p><div className="flex flex-wrap gap-2">{[['plan-editor','Cài đặt Kế hoạch'],['guide-editor','Cài đặt Hướng dẫn GV'],['faq-editor','Cài đặt FAQ'],...(c.group==='internship'?[['rules-editor','Cài đặt Quy định thực tập']]:[])].map(([tab,label])=><Button key={tab} size="sm" onClick={()=>layout?.editQuery({tab})}>{label}</Button>)}</div></section>
  </section>;
}
