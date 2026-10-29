import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function EnrollmentDialog({ children, close, title }: { children: ReactNode; close: () => void; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef(close); dismiss.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); dismiss.current(); }} className="fixed inset-0 m-auto w-[calc(100%-1rem)] sm:w-[calc(100%-3rem)] max-w-[1400px] max-h-[94dvh] rounded-2xl border border-slate-200 bg-slate-50 p-0 shadow-xl backdrop:bg-slate-900/45">
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between gap-3"><h2 className="font-semibold text-sm text-slate-900">{title}</h2><button type="button" aria-label="Đóng hồ sơ" onClick={close} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button></div><div className="p-3 sm:p-5">{children}</div>
  </dialog>;
}
