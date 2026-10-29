import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { academicApi } from './client';

const Membership = createContext<ReadonlySet<string> | null>(null);
export const useLegacyMembership = () => useContext(Membership);
export const legacyStudentInScope = (ids: ReadonlySet<string> | null, studentId: unknown) => !ids || ids.has(String(studentId || ''));

export function useLegacySearch(): [string, (value: string) => void] {
  const location = useLocation(); const [query, setQuery] = useSearchParams();
  const [local, setLocal] = useState('');
  return location.pathname.startsWith('/campaigns/')
    ? [query.get('q') || '', value => setQuery(old => { const next = new URLSearchParams(old); value ? next.set('q', value) : next.delete('q'); next.delete('page'); return next; })]
    : [local, setLocal];
}

export function LegacyListScope({ token, campaignId, children }: { token: string; campaignId: string; children: ReactNode }) {
  const [query] = useSearchParams();
  const lecturerId = query.get('lecturerId') || '';
  const key = `${campaignId}:${lecturerId}`;
  const [scope, setScope] = useState<{ key: string; members: Set<string> } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!lecturerId) return;
    const abort = new AbortController(); setError('');
    (async () => {
      const members = new Set<string>(); let page = 1, pages = 1;
      do {
        const result = await academicApi(token, `/api/campaigns/${campaignId}/enrollments?lecturerId=${encodeURIComponent(lecturerId)}&limit=100&page=${page}`, 'GET', undefined, abort.signal);
        for (const item of result.items) members.add(String(item.studentId));
        pages = result.totalPages; page++;
      } while (page <= pages);
      if (!abort.signal.aborted) setScope({ key, members });
    })().catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [token, campaignId, lecturerId, key]);
  if (lecturerId && scope?.key !== key) return <p role={error ? 'alert' : 'status'} className="p-6 text-sm text-slate-500">{error || 'Đang lọc hồ sơ theo giảng viên…'}</p>;
  return <Membership.Provider value={lecturerId ? scope!.members : null}>{children}</Membership.Provider>;
}
