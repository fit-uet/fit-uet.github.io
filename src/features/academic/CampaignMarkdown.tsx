import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function CampaignMarkdown({ content }: { content: string }) {
  return <div className="min-w-0 text-sm text-slate-700 leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-slate-900 mb-4" {...props} />,
    h2: ({ node, ...props }) => <h2 className="text-base font-semibold text-[#034ea1] mt-6 mb-3" {...props} />,
    h3: ({ node, ...props }) => <h3 className="font-semibold text-slate-900 mt-5 mb-2" {...props} />,
    p: ({ node, ...props }) => <p className="mb-3 break-words" {...props} />,
    ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-2" {...props} />,
    a: ({ node, ...props }) => <a className="text-[#034ea1] underline break-words" {...props} />,
    table: ({ node, ...props }) => <div className="max-w-full overflow-x-auto border border-slate-200 rounded-lg my-5"><table className="w-full min-w-[700px] text-sm" {...props} /></div>,
    th: ({ node, ...props }) => <th className="bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700" {...props} />,
    td: ({ node, ...props }) => <td className="border-t border-slate-200 px-4 py-3 align-top" {...props} />,
  }}>{content}</ReactMarkdown></div>;
}
