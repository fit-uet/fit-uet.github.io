import {useEffect, useRef, useState} from 'react';
import {Button} from '../../shared/ui';
import {useProjectNavigationGuard} from './useProjectNavigationGuard';

export function useContentEditorActions({dirty, readOnly, importing, persist, onSaved, discard}: {
  dirty: boolean; readOnly: boolean; importing: boolean;
  persist: () => Promise<void | {warning?: string}>; onSaved: () => void; discard: () => void;
}) {
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(false), busy = saving || importing;
  useEffect(() => { if (dirty) setNotice(''); }, [dirty]);
  const save = async () => {
    if (pending.current || importing || readOnly) return false;
    if (!dirty) return true;
    pending.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const result = await persist(); onSaved();
      setNotice(result && result.warning ? `Đã lưu nội dung. ${result.warning}` : 'Đã lưu nội dung.');
      return true;
    } catch (error) { setError(error.message || 'Không lưu được nội dung. Thay đổi đang soạn được giữ lại.'); return false; }
    finally { pending.current = false; setSaving(false); }
  };
  const cancel = () => { if (!busy) { discard(); setError(''); setNotice('Đã hủy thay đổi chưa lưu.'); } };
  const {dialog} = useProjectNavigationGuard(dirty || busy, save, cancel, 'Bạn có nội dung đang soạn chưa lưu.', busy);
  return {dirty, busy, saving, readOnly, error, notice, save, cancel, dialog, disabled: busy || readOnly || !dirty};
}

export function ContentEditorActions({actions}: {actions: ReturnType<typeof useContentEditorActions>}) {
  return <section aria-label="Lưu nội dung" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    {actions.error && <p role="alert" className="text-sm text-rose-700">{actions.error}</p>}
    {actions.notice && <p role="status" className="text-sm text-emerald-700">{actions.notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">{actions.readOnly ? 'Nội dung chỉ xem.' : actions.dirty ? 'Chưa lưu · Áp dụng sau khi nhấn Lưu.' : 'Không có thay đổi chưa lưu.'}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={actions.busy || !actions.dirty} onClick={actions.cancel}>Hủy thay đổi</Button>
        <Button size="sm" variant="primary" aria-label="Lưu nội dung" disabled={actions.disabled} onClick={actions.save}>{actions.saving ? 'Đang lưu…' : 'Lưu'}</Button></div>
    </div>
    {actions.dialog}
  </section>;
}
