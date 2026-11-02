import { createContext,useContext,type ReactNode } from 'react';
import type { CampaignSummary } from '../../shared/academic';
import { academicApi } from './client';

type Editor = {campaign:CampaignSummary;save:(settings:Record<string,unknown>)=>Promise<void|{warning?:string}>};
const Context=createContext<Editor|null>(null);
export const useCampaignEditor=()=>useContext(Context);
export function CampaignEditorContext({campaign,token,refresh,children}:{campaign:CampaignSummary;token:string;refresh:()=>Promise<unknown>;children:ReactNode}) {
  return <Context.Provider value={{campaign,save:async settings=>{await academicApi(token,`/api/admin/campaigns/${campaign.id}/settings`,'PUT',{expectedRevision:campaign.revision,settings});try{await refresh();}catch{return {warning:'Chưa tải lại được dữ liệu; dùng Tải lại để cập nhật.'};}}}}>{children}</Context.Provider>;
}
