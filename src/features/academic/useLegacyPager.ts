import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../../shared/config';
import { requestJson } from '../../shared/utils/requestCache';

type Page = {items:any[];total:number;studentCount:number;page:number;limit:number;totalPages:number;summary?:Record<string,any>;lecturers?:any[]};
export function useLegacyPager(token:string,endpoint:string,options:Record<string,any>={}) {
  const location=useLocation();const [outer]=useSearchParams();const enabled=location.pathname.startsWith('/campaigns/');
  const [search,setSearch]=useState(options.q??outer.get('q')??'');
  const requestedSearch=options.q??outer.get('q')??'';
  useEffect(()=>{const timer=window.setTimeout(()=>setSearch(requestedSearch),300);return()=>window.clearTimeout(timer);},[requestedSearch]);
  const query=new URLSearchParams();
  for(const name of ['courseCode','classId','lecturerId'])if(outer.get(name))query.set(name,outer.get(name)!);
  for(const [name,value] of Object.entries(options))if(value!==''&&value!==undefined&&value!==null)query.set(name,String(value));
  search?query.set('q',search):query.delete('q');
  if(enabled){query.set('pagination','1');query.set('limit','25');}
  const key=endpoint+'?'+query.toString();
  const [state,setState]=useState<{key:string;page:Page}|null>(null);const epoch=useRef(0);const controller=useRef<AbortController|null>(null);const currentKey=useRef(key);currentKey.current=key;
  const response=useRef<any>(null);
  const reload=useRef<(()=>unknown)|null>(null);const force=useRef(false);
  useEffect(()=>()=>{epoch.current++;controller.current?.abort();},[key,token]);
  useEffect(()=>{
    const update=(event:Event)=>{if(document.visibilityState==='visible'){force.current=event.type==='api-force-refresh';reload.current?.();}};
    for(const name of ['api-data-changed','api-force-refresh'])window.addEventListener(name,update);
    document.addEventListener('visibilitychange',update);
    return()=>{for(const name of ['api-data-changed','api-force-refresh'])window.removeEventListener(name,update);document.removeEventListener('visibilitychange',update);};
  },[]);
  const load=async()=>{
    if(search!==requestedSearch)throw new DOMException('Aborted','AbortError');
    controller.current?.abort();const abort=new AbortController();controller.current=abort;const version=++epoch.current;const captured=key;
    const forced=force.current;force.current=false;
    const data=await requestJson<any>(API_BASE+(enabled?key:endpoint),{headers:{Authorization:`Bearer ${token}`},signal:abort.signal,forceRefresh:forced});
    if(version!==epoch.current||captured!==currentKey.current)throw new DOMException('Aborted','AbortError');
    response.current=data;
    if(data.items){setState({key:captured,page:data});return data.items as any[];}
    setState(null);return Array.isArray(data)?data:Array.isArray(data.rows)?data.rows:[];
  };
  const allRows=async(overrides:Record<string,string>={})=>{
    if(!enabled){const data=await requestJson<any>(API_BASE+endpoint,{headers:{Authorization:`Bearer ${token}`}});return Array.isArray(data)?data:data.rows||[];}
    const filter=new URLSearchParams(query);Object.entries(overrides).forEach(([name,value])=>value?filter.set(name,value):filter.delete(name));filter.set('limit','100');
    const rows:any[]=[];let page=1,pages=1;
    do{filter.set('page',String(page));const data=await requestJson<any>(`${API_BASE}${endpoint}?${filter}`,{headers:{Authorization:`Bearer ${token}`}});if(Array.isArray(data))return data;rows.push(...data.items);pages=data.totalPages;page++;}while(page<=pages);
    return rows;
  };
  const metadata=state?.key===key?state.page:null;
  return {enabled,key,load,allRows,response,page:metadata,summary:metadata?.summary,bind:(fn:()=>unknown)=>{reload.current=fn;},accept:(data:any)=>{if(data?.items){setState({key,page:data});return data.items;}return Array.isArray(data)?data:data?.rows||[];}};
}
