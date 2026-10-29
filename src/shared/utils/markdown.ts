
export const normalizeRegistrationRulesMarkdown = (content: string) => {
  const text = String(content || '').trim();
  if (!text) return '';
  const hasMarkdownSyntax = /(^|\n)\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```|\|.+\|)/.test(text)
    || /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/.test(text);
  if (hasMarkdownSyntax) return text.replace(/^(\s*)•\s+/gm, '$1- ');
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map(line => `- ${line}`)
    .join('\n');
};

export const convertDocxFileToMarkdown = async (file: File) => {
  const [{default:mammoth}, {default:TurndownService}] = await Promise.all([import('mammoth'), import('turndown')]);
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content: string) => `~~${content}~~`,
  });
  return td.turndown(result.value);
};
