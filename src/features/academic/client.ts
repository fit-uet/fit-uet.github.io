import { API_BASE } from '../../shared/config';

const pdfs = new Map<string, { url: string; etag: string }>();
export function clearAcademicCache() {
  for (const pdf of pdfs.values()) URL.revokeObjectURL(pdf.url);
  pdfs.clear();
}
export async function academicApi<T = any>(token: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body), signal });
  let result: any;
  try { result = await response.json(); }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
    if (response.ok) throw new Error('Phản hồi từ hệ thống không hợp lệ. Vui lòng tải lại.');
    result = {};
  }
  // Aborting a response while its JSON body is being read must never turn it
  // into a successful empty result that overwrites the newly selected scope.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) {
    if (response.status === 401) { clearAcademicCache(); window.dispatchEvent(new Event('auth-expired')); }
    if (response.status === 403) clearAcademicCache();
    throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Không xử lý được yêu cầu.');
  }
  return result;
}
export async function academicPdf(token: string, enrollmentId: string, versionId: string, signal: AbortSignal) {
  const key = `${token}:${enrollmentId}:${versionId}`;
  const cached = pdfs.get(key);
  const response = await fetch(`${API_BASE}/api/enrollments/${enrollmentId}/submissions/${versionId}/view`, { headers: { Authorization: `Bearer ${token}`, ...(cached ? { 'If-None-Match': cached.etag } : {}) }, signal });
  if (response.status === 304 && cached) return cached.url;
  if (!response.ok) { if (response.status === 401 || response.status === 403) clearAcademicCache(); throw new Error('Không tải được PDF hoặc quyền truy cập đã thay đổi.'); }
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (cached) URL.revokeObjectURL(cached.url);
  // A small bounded cache; each hit still validates authorization via ETag.
  if (pdfs.size >= 8) { const oldest = pdfs.keys().next().value!; URL.revokeObjectURL(pdfs.get(oldest)!.url); pdfs.delete(oldest); }
  const url = URL.createObjectURL(blob); pdfs.set(key, { url, etag: response.headers.get('ETag') || '' }); return url;
}
export async function academicDownload(token: string, path: string, filename: string) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Không tải được file.');
  const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
