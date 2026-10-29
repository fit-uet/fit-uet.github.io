import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useCampaignLayout } from './CampaignLayoutContext';

const Membership = createContext<ReadonlySet<string> | null>(null);
export const useLegacyMembership = () => useContext(Membership);
export const legacyStudentInScope = (ids: ReadonlySet<string> | null, studentId: unknown) => !ids || ids.has(String(studentId || ''));

export function useLegacySearch(): [string, (value: string) => void] {
  return useLegacyFilter('q');
}

// Embedded legacy pages share the applied URL filters with the campaign toolbar.
// Standalone routes retain their original local state.
export function useLegacyFilter(name: string): [string, (value: string) => void] {
  const layout = useCampaignLayout();
  const location = useLocation(); const [query, setQuery] = useSearchParams();
  const [local, setLocal] = useState('');
  return location.pathname.startsWith('/campaigns/')
    ? [query.get(name) || '', value => {
      if ((query.get(name) || '') === value) return;
      if (layout) layout.editQuery({[name]:value,enrollmentId:'',panel:''});
      else setQuery(old => { const next = new URLSearchParams(old); value ? next.set(name, value) : next.delete(name); next.delete('page'); next.delete('enrollmentId'); next.delete('panel'); return next; });
    }]
    : [local, setLocal];
}

export function useLegacyPage(): [number, (value: number) => void] {
  const layout = useCampaignLayout();
  const location = useLocation(); const [query, setQuery] = useSearchParams();
  const [local, setLocal] = useState(1);
  const page = Math.max(1, Number(query.get('page')) || 1);
  return location.pathname.startsWith('/campaigns/')
    ? [page, value => { if (value !== page) { if (layout) layout.editQuery({page:value>1?String(value):''}); else setQuery(old => { const next = new URLSearchParams(old); value > 1 ? next.set('page', String(value)) : next.delete('page'); return next; }); } }]
    : [local, setLocal];
}

export function LegacyListScope({ children }: { token: string; campaignId: string; children: ReactNode }) {
  // Legacy lists now filter membership in SQL; never fetch every enrollment to
  // build a second client-side membership list.
  return <Membership.Provider value={null}>{children}</Membership.Provider>;
}
