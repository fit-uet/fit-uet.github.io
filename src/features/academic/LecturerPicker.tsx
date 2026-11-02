import {useEffect, useId, useRef, useState} from 'react';
import {Check, ChevronDown, Search, X} from 'lucide-react';
import type {LecturerInfo} from '../../shared/academic';
import {Button, FormField} from '../../shared/ui';
import {CampaignPopover} from './CampaignPopover';
import {academicInput} from './form';

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().trim();
const undergraduate = (lecturer: LecturerInfo) => /(^|[\s.])CN[.\s]|^CN$/iu.test(lecturer.name);

export function LecturerPicker({label, studentId, lecturers, value, onChange, multiple = false, disabled = false, invalid = false}: {
  label: string; studentId: string; lecturers: LecturerInfo[]; value: number[];
  onChange: (ids: number[]) => void; multiple?: boolean; disabled?: boolean; invalid?: boolean;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null), composing = useRef(false);
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [active, setActive] = useState<number | null>(null);
  const names = value.map(id => lecturers.find(l => l.id === id)?.name || `Giảng viên #${id}`).join('; ');
  const filtered = lecturers.filter(l => normalize(`${l.name} ${l.email} ${l.work_unit}`).includes(normalize(search)));
  const eligible = filtered.filter(l => multiple || !undergraduate(l));
  const activeId = eligible.some(l => l.id === active) ? active : null;
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open && activeId !== null) document.getElementById(`${id}-${activeId}`)?.scrollIntoView({block:'nearest'}); }, [open, activeId, id]);
  const choose = (lecturer: LecturerInfo) => {
    if (disabled || !multiple && undergraduate(lecturer)) return;
    if (!multiple && value.length === 1 && value[0] === lecturer.id) { setOpen(false); return; }
    onChange(multiple ? value.includes(lecturer.id) ? value.filter(id => id !== lecturer.id) : [...value, lecturer.id] : [lecturer.id]);
    if (multiple) { setSearch(''); setActive(null); input.current?.focus(); }
    else setOpen(false);
  };
  return <FormField label={label} htmlFor={id}>
    <button ref={trigger} id={id} type="button" disabled={disabled} aria-label={`${label} ${studentId}`} aria-invalid={invalid} aria-haspopup="dialog" aria-expanded={open}
      title={names || 'Chưa phân công'} className={`${academicInput} flex items-center gap-2 text-left`}
      onClick={() => { setSearch(''); setActive(null); composing.current = false; setOpen(value => !value); }}>
      <span className="min-w-0 flex-1 break-words">{names || 'Chưa phân công'}</span><ChevronDown size={14} className="shrink-0"/>
    </button>
    {open && <CampaignPopover title={`Chọn ${label} · ${studentId}`} trigger={trigger} close={() => setOpen(false)} width={400} flip>
      <div className="space-y-3">
        <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-3 text-slate-400"/>
          <input ref={input} role="combobox" aria-label={`Tìm ${label}`} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`}
            aria-activedescendant={activeId === null ? undefined : `${id}-${activeId}`} className={`${academicInput} pl-9`} placeholder="Gõ tên hoặc email giảng viên…" autoComplete="off" spellCheck={false} value={search} disabled={disabled}
            onChange={event => { setSearch(event.target.value); setActive(null); }}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; setSearch(event.currentTarget.value); setActive(null); }}
            onKeyDown={event => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const index = eligible.findIndex(l => l.id === activeId), direction = event.key === 'ArrowDown' ? 1 : -1;
                const next = index < 0 ? direction > 0 ? 0 : eligible.length - 1 : (index + direction + eligible.length) % eligible.length;
                setActive(eligible[next]?.id ?? null);
              } else if (event.key === 'Enter') {
                event.preventDefault(); const lecturer = eligible.find(l => l.id === activeId) || eligible[0]; if (lecturer) choose(lecturer);
              }
            }}/>
        </div>
        {multiple && value.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Giảng viên đã chọn">
          {value.map(selected => { const name = lecturers.find(l => l.id === selected)?.name || `Giảng viên #${selected}`; return <button key={selected} type="button" disabled={disabled} aria-label={`Bỏ ${name}`}
            className="inline-flex max-w-full items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs text-[#034ea1]"
            onClick={() => { onChange(value.filter(id => id !== selected)); input.current?.focus(); }}><span className="break-words">{name}</span><X size={12} className="shrink-0"/></button>; })}
        </div>}
        <div id={`${id}-options`} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-slate-200">
          {filtered.map(lecturer => { const unavailable = !multiple && undergraduate(lecturer); return <button key={lecturer.id} id={`${id}-${lecturer.id}`} type="button" role="option" tabIndex={-1}
            aria-selected={value.includes(lecturer.id)} disabled={disabled || unavailable}
            className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-xs last:border-b-0 disabled:opacity-50 ${activeId === lecturer.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(lecturer)}>
            <Check size={14} aria-hidden="true" className={`mt-0.5 shrink-0 text-[#034ea1] ${value.includes(lecturer.id) ? '' : 'invisible'}`}/>
            <span className="min-w-0"><strong className="block text-slate-800">{lecturer.name}</strong><span className="block break-all text-slate-500">{lecturer.email}</span>
              {lecturer.work_unit && <span className="block text-slate-500">{lecturer.work_unit}</span>}{unavailable && <span className="block text-amber-700">Chỉ đồng hướng dẫn</span>}
            </span>
          </button>; })}
          {!filtered.length && <p role="status" className="p-3 text-sm text-slate-500">Không tìm thấy giảng viên.</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" disabled={disabled || !value.length} onClick={() => { onChange([]); if (!multiple) setOpen(false); else input.current?.focus(); }}>Bỏ lựa chọn</Button>
          <Button size="sm" onClick={() => setOpen(false)}>Xong</Button>
        </div>
      </div>
    </CampaignPopover>}
  </FormField>;
}
