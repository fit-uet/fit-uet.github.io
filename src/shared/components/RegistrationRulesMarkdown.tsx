import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeRegistrationRulesMarkdown } from '../utils/markdown';

export const RegistrationRulesMarkdown = ({ content }: { content: string }) => (
  <div className="registration-rules-markdown text-xs text-slate-650">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ node, ...props }) => <h1 className="text-sm font-bold text-slate-800 mb-3" {...props} />,
        h2: ({ node, ...props }) => <h2 className="text-xs font-bold text-slate-800 mt-4 mb-2" {...props} />,
        h3: ({ node, ...props }) => <h3 className="text-xs font-semibold text-slate-800 mt-3 mb-2" {...props} />,
        p: ({ node, ...props }) => <p className="mb-3 leading-relaxed text-slate-650 font-medium" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 space-y-2 marker:text-blue-500" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-2 marker:text-blue-500" {...props} />,
        li: ({ node, ...props }) => <li className="pl-1 leading-relaxed text-slate-650 font-medium" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-bold text-slate-900" {...props} />,
        em: ({ node, ...props }) => <em className="text-slate-800 italic" {...props} />,
        a: ({ node, ...props }) => <a className="text-blue-600 underline hover:text-blue-700 font-semibold transition-colors" target="_blank" rel="noreferrer" {...props} />,
        code: ({ node, ...props }) => <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono text-[11px]" {...props} />,
        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-slate-300 pl-3 italic text-slate-500 my-3" {...props} />,
        table: ({ node, ...props }) => <div className="overflow-x-auto my-3"><table className="min-w-full border border-slate-200 text-xs" {...props} /></div>,
        th: ({ node, ...props }) => <th className="border border-slate-200 px-2 py-1 text-left text-slate-800 bg-slate-50 font-semibold" {...props} />,
        td: ({ node, ...props }) => <td className="border border-slate-150 px-2 py-1 text-slate-650 font-medium" {...props} />,
      }}
    >
      {normalizeRegistrationRulesMarkdown(content)}
    </ReactMarkdown>
  </div>
);
