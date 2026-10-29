import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function useCampaignWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return wide;
}
export function CampaignPopover({ title, trigger, close, children, width = 384 }: {
  title: string; trigger: RefObject<HTMLButtonElement | null>; close: () => void; children: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null), label = useId();
  const wide = useCampaignWide();
  const dismiss = useRef(close); dismiss.current = close;
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const available = Math.min(width, window.innerWidth - 24);
      setPosition(wide ? { position: 'fixed', width: available, left: Math.max(12, Math.min(anchor.right - available, window.innerWidth - available - 12)), top: anchor.bottom + 8, maxHeight: Math.max(160, window.innerHeight - anchor.bottom - 24) }
        : { position: 'fixed', left: 8, right: 8, bottom: 8, maxHeight: '85dvh' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [wide, width, trigger]);
  useEffect(() => {
    const previous = trigger.current;
    const overflow = document.body.style.overflow;
    if (!wide) document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('select, input, button, [href], textarea')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss.current(); }
      if (event.key === 'Tab' && !wide) {
        const controls = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.removeEventListener('keydown', keydown, true); if (!wide) document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [wide, trigger]);
  return createPortal(<div className="fixed inset-0 z-[100]">
    <div className={wide ? 'absolute inset-0' : 'absolute inset-0 bg-slate-900/30'} onMouseDown={() => dismiss.current()} />
    <div ref={ref} role="dialog" aria-modal={!wide || undefined} aria-labelledby={label} style={position} className="overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-xl text-slate-800">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 id={label} className="text-sm font-semibold">{title}</h2><button type="button" aria-label={`Đóng ${title.toLowerCase()}`} className="rounded-lg p-2 hover:bg-slate-100" onClick={close}><X size={16}/></button></div>
      <div className="p-4">{children}</div>
    </div>
  </div>, document.body);
}
