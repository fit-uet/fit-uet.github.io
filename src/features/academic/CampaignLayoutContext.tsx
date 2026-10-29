import { createContext, useContext, useEffect, useRef, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignMeta } from './campaignPresentation';

export type CampaignFilter = { key: string; label: string; options: { value: string; label: string }[] };
export type CampaignLayout = {
  meta: CampaignMeta;
  actor: any;
  tab: string;
  legacy: boolean;
  query: URLSearchParams;
  editQuery: (patch: Record<string, string>) => void;
  actionsHost: HTMLElement | null;
  setActionsHost: Dispatch<SetStateAction<HTMLElement | null>>;
  extraFilters: CampaignFilter[];
  setExtraFilters: Dispatch<SetStateAction<CampaignFilter[]>>;
};
export const CampaignLayoutContext = createContext<CampaignLayout | null>(null);
export const useCampaignLayout = () => useContext(CampaignLayoutContext);

// Keep standalone legacy pages intact; embedded pages share the campaign title
// and place their original actions beside search or in the compact page header.
export function CampaignToolbarActions({ children }: { children: ReactNode }) {
  const layout = useCampaignLayout();
  return layout?.actionsHost ? createPortal(children, layout.actionsHost) : null;
}
export function CampaignLegacyHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return useCampaignLayout() ? <CampaignToolbarActions>{actions}</CampaignToolbarActions> : <>{children}</>;
}
export function CampaignStandalone({ children }: { children: ReactNode }) {
  return useCampaignLayout() ? null : <>{children}</>;
}
export function useCampaignExtraFilters(filters: CampaignFilter[]) {
  const layout = useCampaignLayout();
  const serialized = JSON.stringify(filters);
  useEffect(() => {
    if (!layout) return;
    layout.setExtraFilters(JSON.parse(serialized));
    return () => layout.setExtraFilters([]);
  }, [layout?.setExtraFilters, serialized]);
}

export function useCampaignRefresh(refresh: () => unknown) {
  const layout = useCampaignLayout(), current = useRef(refresh); current.current = refresh;
  useEffect(() => {
    if (!layout) return;
    const reload = () => { current.current(); };
    window.addEventListener('api-force-refresh', reload);
    return () => window.removeEventListener('api-force-refresh', reload);
  }, [!!layout]);
}
