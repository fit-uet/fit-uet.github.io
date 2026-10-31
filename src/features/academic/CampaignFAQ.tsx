import { useState } from 'react';
import { CircleHelp, ChevronDown, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type FaqItem = {
  question: string;
  answer: string;
};

function parseFaq(content: string): { title: string; items: FaqItem[]; generalText: string } {
  const lines = content.split('\n');
  let title = '';
  const items: FaqItem[] = [];
  let currentQ = '';
  let currentA: string[] = [];
  const leadingText: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# ') && !title) {
      title = line.replace(/^#\s+/, '').trim();
    } else if (line.startsWith('### ') || line.startsWith('## ')) {
      if (currentQ) {
        items.push({ question: currentQ, answer: currentA.join('\n').trim() });
      }
      currentQ = line.replace(/^#+\s+/, '').trim();
      currentA = [];
    } else if (currentQ) {
      currentA.push(line);
    } else if (line.trim() && !line.startsWith('#')) {
      leadingText.push(line);
    }
  }

  if (currentQ) {
    items.push({ question: currentQ, answer: currentA.join('\n').trim() });
  }

  return {
    title: title || 'Câu hỏi thường gặp',
    items,
    generalText: leadingText.join('\n').trim(),
  };
}

export function CampaignFAQ({ content, isStudent }: { content: string; isStudent?: boolean }) {
  const { title, items, generalText } = parseFaq(content);

  // Fallback for empty or purely unformatted text
  if (!items.length) {
    return (
      <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0 border border-blue-100/60">
            <CircleHelp size={17} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Quy chế và hướng dẫn nghiệp vụ do Khoa CNTT ban hành</p>
          </div>
        </div>
        <div className="text-xs sm:text-sm text-slate-700 leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Câu hỏi thường gặp" className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
      {/* Card Header */}
      <div className="p-5 border-b border-slate-100 bg-[#f8fafc] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#034ea1] flex items-center justify-center shrink-0 border border-blue-100/60">
            <BookOpen size={17} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isStudent
                ? 'Các quy định, mốc thời gian và hướng dẫn cho sinh viên'
                : 'Quy trình đánh giá, thời hạn và lưu ý nghiệp vụ cho giảng viên'}
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200/80 text-slate-600 rounded-lg shadow-2xs">
          {items.length} câu hỏi
        </span>
      </div>

      {generalText && (
        <div className="px-5 py-3.5 bg-blue-50/40 border-b border-blue-100/60 text-xs text-blue-900 leading-relaxed font-medium">
          {generalText}
        </div>
      )}

      {/* Accordion List */}
      <div className="p-4 sm:p-5 space-y-2.5">
        {items.map((item, idx) => (
          <details
            key={idx}
            open={idx === 0}
            className="group border border-slate-200/80 rounded-xl overflow-hidden transition-all bg-white hover:border-slate-300"
          >
            <summary className="flex items-center justify-between p-3.5 sm:p-4 cursor-pointer select-none bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3 pr-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-[#034ea1] font-bold text-[11px] flex items-center justify-center shrink-0">
                  Q{idx + 1}
                </span>
                <span className="font-bold text-xs sm:text-sm text-slate-800 group-open:text-[#034ea1] transition-colors">
                  {item.question}
                </span>
              </div>
              <ChevronDown
                size={16}
                className="text-slate-400 group-open:rotate-180 group-open:text-[#034ea1] transition-transform shrink-0"
              />
            </summary>
            <div className="p-4 pt-3 text-xs sm:text-sm text-slate-600 leading-relaxed bg-white border-t border-slate-100/80">
              <div className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  A
                </span>
                <div className="flex-1 min-w-0 prose prose-sm prose-slate max-w-none text-slate-700 leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.answer}</ReactMarkdown>
                </div>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

