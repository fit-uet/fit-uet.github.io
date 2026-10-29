import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { academicApi } from './client';
export function ContextRedirect({ token, tab, internshipOnly = false, view }: { token: string; tab: string; internshipOnly?: boolean; view?: string }) {
  const [target, setTarget] = useState('');
  useEffect(() => { const a = new AbortController(); academicApi(token, '/api/me/campaigns?section=base', 'GET', undefined, a.signal).then(data => {
    if (a.signal.aborted) return;
    const choices = data.campaigns.filter(p => !internshipOnly || p.group === 'internship');
    if (data.legacyInternshipUnmapped && !choices.some(p => p.legacy) && (internshipOnly || !choices.length)) {
      setTarget(`/internship/legacy?tab=${tab}`); return;
    }
    const p = choices.find(p => p.id === sessionStorage.getItem('academic:campaign')) || choices.find(p => p.legacy) || choices.find(p => p.status === 'active') || choices[0];
    setTarget(p ? `/campaigns/${p.id}?tab=${tab}${view ? `&view=${view}` : ''}` : '/classes');
  }).catch(e => { if (e.name !== 'AbortError' && !a.signal.aborted) setTarget('/classes'); }); return () => a.abort(); }, [token, tab, internshipOnly, view]);
  return target ? <Navigate to={target} replace /> : <p role="status">Đang mở nhóm môn…</p>;
}
