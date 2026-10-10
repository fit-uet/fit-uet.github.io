import React from 'react';
import { CircleHelp } from 'lucide-react';

export function PageDescriptionTooltip({ description }: { description: React.ReactNode }) {
  return (
    <span className="relative group inline-flex items-center align-middle ml-2 select-none">
      <CircleHelp size={16} className="text-slate-400 hover:text-slate-600 transition-all cursor-help" />
      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover:block bg-slate-800 text-white text-[11px] font-medium rounded-xl p-2.5 shadow-md w-64 whitespace-normal z-50 text-center leading-relaxed font-normal normal-case tracking-normal">
        {description}
      </span>
    </span>
  );
}
