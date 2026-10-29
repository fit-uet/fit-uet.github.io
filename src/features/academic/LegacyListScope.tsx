import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

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

export function LegacyListScope({ children }: { token: string; campaignId: string; children: ReactNode }) {
  // Legacy lists now filter membership in SQL; never fetch every enrollment to
  // build a second client-side membership list.
  return <Membership.Provider value={null}>{children}</Membership.Provider>;
}
