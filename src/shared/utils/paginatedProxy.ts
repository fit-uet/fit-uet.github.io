import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface PaginatedQuery {
  page: number; limit: number; search?: string; filter?: Record<string, any>; sort?: { key: string; direction: 'asc' | 'desc' };
}
export interface PaginatedResult<T> { items: T[]; total: number; page: number; limit: number; totalPages: number }
export type PageFetcher<T> = (query: PaginatedQuery, forceRefresh?: boolean, signal?: AbortSignal) => Promise<PaginatedResult<T>>;
export interface IPaginatedSource<T> { fetchPage(query: PaginatedQuery, forceRefresh?: boolean, signal?: AbortSignal): Promise<PaginatedResult<T>> }
export class RealPaginatedSource<T> implements IPaginatedSource<T> {
  constructor(private fetcher: PageFetcher<T>) {}
  fetchPage(query: PaginatedQuery, forceRefresh = false, signal?: AbortSignal) { return this.fetcher(query, forceRefresh, signal); }
}
export interface ProxyCacheEntry<T> { data: PaginatedResult<T>; timestamp: number }
export interface PaginatedProxyOptions { ttlMs?: number; maxCacheEntries?: number }
// Compatibility facade: authenticated payloads live only in requestCache, where
// identity, ETag validation, invalidation and memory limits are shared by all screens.
export class PaginatedVirtualProxy<T> implements IPaginatedSource<T> {
  private realSource: IPaginatedSource<T>;
  constructor(source: IPaginatedSource<T> | PageFetcher<T>, _options?: PaginatedProxyOptions) { this.realSource = typeof source === 'function' ? new RealPaginatedSource(source) : source; }
  buildKey(query: PaginatedQuery) { return JSON.stringify([query.page,query.limit,query.search||'',Object.entries(query.filter||{}).sort(),query.sort]); }
  hasCached(_query: PaginatedQuery) { return false; }
  getCached(_query: PaginatedQuery): PaginatedResult<T> | null { return null; }
  fetchPage(query: PaginatedQuery, forceRefresh = false, signal?: AbortSignal) { return this.realSource.fetchPage(query,forceRefresh,signal); }
  async prefetch(query: PaginatedQuery) { await this.fetchPage(query); }
  invalidate() {} // A write already invalidates the shared cache; refresh passes forceRefresh.
  invalidateMatching(_predicate: (key: string) => boolean) {}
  getStats() { return {cacheSize:0,pendingRequests:0}; }
}
export interface UsePaginatedProxyOptions<T> {
  fetcher: PageFetcher<T>; initialPage?: number; pageSize?: number; search?: string; filter?: Record<string, any>;
  sort?: {key:string;direction:'asc'|'desc'}; enablePrefetch?: boolean; ttlMs?: number;
}
export function usePaginatedProxy<T>({fetcher,initialPage=1,pageSize=25,search='',filter={},sort}:UsePaginatedProxyOptions<T>) {
  const [currentPage,setCurrentPage]=useState(initialPage),[debouncedSearch,setDebouncedSearch]=useState(search);
  useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedSearch(search),300);return()=>window.clearTimeout(timer);},[search]);
  const [data,setData]=useState<PaginatedResult<T>>({items:[],total:0,page:initialPage,limit:pageSize,totalPages:1});
  const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const proxy=useMemo(()=>new PaginatedVirtualProxy(fetcher),[fetcher]);
  const filterKey=JSON.stringify(Object.entries(filter).sort());const selectionKey=JSON.stringify([debouncedSearch,filterKey,sort?.key,sort?.direction,pageSize]);
  const previousSelection=useRef(selectionKey);const selectionChanged=previousSelection.current!==selectionKey;
  const queryPage=selectionChanged?1:currentPage;
  const query=useMemo<PaginatedQuery>(()=>({page:queryPage,limit:pageSize,search:debouncedSearch,filter:Object.fromEntries(JSON.parse(filterKey)),sort}),[queryPage,pageSize,debouncedSearch,filterKey,sort?.key,sort?.direction]);
  useEffect(()=>{if(previousSelection.current!==selectionKey){previousSelection.current=selectionKey;setCurrentPage(1);}},[selectionKey]);
  const active=useRef<AbortController|null>(null);const execution=useRef(0);
  const loadPage=useCallback(async(page:number,forceRefresh=false)=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;const version=++execution.current;
    setLoading(true);setError(null);
    try{const result=await proxy.fetchPage({...query,page},forceRefresh,controller.signal);if(!controller.signal.aborted&&version===execution.current){setData(result);setLoading(false);}}
    catch(error){if(!controller.signal.aborted&&version===execution.current){setError(error?.message||'Không thể tải dữ liệu trang.');setLoading(false);}}
  },[proxy,query]);
  useEffect(()=>{loadPage(query.page);return()=>{execution.current++;active.current?.abort();};},[loadPage,query.page]);
  useEffect(()=>{
    const update=(event:Event)=>{if(document.visibilityState==='visible')loadPage(query.page,event.type==='api-force-refresh');};
    document.addEventListener('visibilitychange',update);window.addEventListener('api-data-changed',update);window.addEventListener('api-force-refresh',update);
    return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('api-data-changed',update);window.removeEventListener('api-force-refresh',update);};
  },[loadPage,query.page]);
  const refresh=useCallback(()=>loadPage(query.page,true),[loadPage,query.page]);
  return {...data,loading,error,setPage:setCurrentPage,refresh,proxy,prefetchPage:useCallback((page:number)=>proxy.prefetch({...query,page}),[proxy,query])};
}
