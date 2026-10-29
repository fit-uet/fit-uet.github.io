import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { academicApi } from './client';
export function AcademicClassPage({ token }: { token: string; user: any }) {
  const { classId = '' } = useParams(); const [target, setTarget] = useState(''); const [error, setError] = useState('');
  useEffect(() => { const a = new AbortController(); academicApi(token, `/api/classes/${classId}?section=base`, 'GET', undefined, a.signal).then(data => setTarget(`/campaigns/${data.class.campaignId}?tab=students&classId=${classId}`)).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => a.abort(); }, [token, classId]);
  return target ? <Navigate to={target} replace /> : <p role="status">{error || 'Đang mở nhóm môn…'}</p>;
}
