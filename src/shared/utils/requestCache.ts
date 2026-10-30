// Memory-only authenticated JSON cache. Every reuse validates access on the server.
type Entry = { data: any; etag: string; bytes: number; usedAt: number; tags: string[] };
type Flight = { controller: AbortController; promise: Promise<any>; consumers: number };
const entries = new Map<string, Entry>(), flights = new Map<string, Flight>();
const MAX_ENTRIES = 100, MAX_BYTES = 20 * 1024 * 1024, IDLE_MS = 5 * 60_000;
let generation = 0;
const classCampaign = new Map<string,string>(), enrollmentCampaign = new Map<string,string>();
function responseTags(url:string,data:any) {
  const path=new URL(url,typeof location==='undefined'?'http://local.invalid':location.origin).pathname;
  const tags=new Set<string>();
  const campaign=path.match(/\/campaigns\/([^/]+)/)?.[1] || data?.campaign?.id || data?.class?.campaignId;
  if(campaign)tags.add('campaign:'+decodeURIComponent(campaign));
  if(path==='/api/me/campaigns'||path==='/api/me/classes')tags.add('catalog');
  if(path==='/api/me/unread-counts'||path.includes('/notifications'))tags.add('unread');
  if(data?.campaign?.legacy||campaign?.endsWith(':internship')||/\/api\/(?:registrations|internships|advisor|reports|lecturer|settings)(?:\/|$)|\/api\/admin\/(?:registrations|final-internships|advisor-|lecturer-quotas|grades|reports)/.test(path))tags.add('legacy');
  for(const cls of data?.classes||[])if(cls?.id&&cls?.campaignId)classCampaign.set(cls.id,cls.campaignId);
  const register=(e:any)=>{if(e?.id&&e?.classId&&classCampaign.has(e.classId))enrollmentCampaign.set(e.id,classCampaign.get(e.classId)!);};
  register(data);for(const e of data?.items||data?.enrollments||[])register(e);
  const enrollment=path.match(/\/enrollments\/([^/]+)/)?.[1] || (data?.classId?data.id:null);
  if(enrollment&&enrollmentCampaign.has(enrollment))tags.add('campaign:'+enrollmentCampaign.get(enrollment));
  if(classCampaign.size>1000)classCampaign.clear();if(enrollmentCampaign.size>5000)enrollmentCampaign.clear();
  return [...tags];
}
const aborted = () => new DOMException('Aborted', 'AbortError');
let channel: BroadcastChannel | undefined;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel('irs-data-changes');
  channel.onmessage = event => { if (event.data?.type === 'invalidate') { invalidateLocal(Array.isArray(event.data.tags)?event.data.tags:['*']); window.dispatchEvent(new Event('api-data-changed')); } };
}
export function clearRequestCache(scopePrefix?:string) {
  if(scopePrefix){generation++;for(const key of entries.keys())if(key.includes(':'+scopePrefix))entries.delete(key);return;}
  generation++; entries.clear(); classCampaign.clear(); enrollmentCampaign.clear();
  for (const flight of flights.values()) flight.controller.abort();
  flights.clear();
}
export function refreshRequestCache() { invalidateLocal(['*']); }
function invalidateLocal(tags:string[]) {
  generation++;for(const [key,entry] of entries)if(tags.includes('*')||entry.tags.some(tag=>tags.includes(tag)))entries.delete(key);
}
export function invalidateRequestCache(resource?:string,data?:any) {
  if(resource&&/\/preview$|\/email\/diagnostics$|\/export-to-sheet(?:[?]|$)/.test(resource))return;
  let tags=resource?responseTags(resource,data):['*'];
  if(!tags.length)tags=['*'];else tags=[...tags,'catalog','unread'];
  invalidateLocal(tags);channel?.postMessage({type:'invalidate',tags});
}
function prune() {
  const at = Date.now(); for (const [key, entry] of entries) if (at - entry.usedAt > IDLE_MS) entries.delete(key);
  let bytes = [...entries.values()].reduce((sum, value) => sum + value.bytes, 0);
  while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) { const key = entries.keys().next().value!; bytes -= entries.get(key)!.bytes; entries.delete(key); }
}
export class ApiError extends Error { constructor(message: string, public status: number, public data: any) { super(message); } }
export async function requestJson<T = any>(url: string, options: { headers?: HeadersInit; signal?: AbortSignal; forceRefresh?: boolean; scope?: string } = {}): Promise<T> {
  if (options.signal?.aborted) throw aborted();
  prune();
  const parsed = new URL(url, typeof location === 'undefined' ? 'http://local.invalid' : location.origin); parsed.searchParams.sort();
  const headers = new Headers(options.headers);
  const forceRefresh=options.forceRefresh||/no-cache|no-store/i.test(headers.get('Cache-Control')||'');
  // no-store controls the browser's HTTP cache. Without an explicit header,
  // browsers also add no-cache, which inadvertently bypasses the server's
  // revision-checked cache on every normal ETag revalidation.
  headers.set('Cache-Control',forceRefresh?'no-cache':'max-age=0');
  const key = `${headers.get('Authorization') || ''}:${options.scope || ''}:${parsed.href}`;
  const flightKey = forceRefresh ? key + ':forced' : key;
  if (forceRefresh) { entries.delete(key); if (!flights.has(flightKey)) generation++; }
  let flight = flights.get(flightKey);
  if (!flight) {
    const controller = new AbortController(); let epoch = generation;
    let cached = entries.get(key); if (cached?.etag) headers.set('If-None-Match', cached.etag);
    flight = { controller, consumers: 0, promise: null! };
    const current = flight;
    flight.promise = (async () => {
      for (;;) {
      const response = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
      if (!controller.signal.aborted && epoch !== generation) { epoch = generation; cached = undefined; headers.delete('If-None-Match'); await response.body?.cancel(); continue; }
      if (response.status === 304 && cached) {
        if (controller.signal.aborted || epoch !== generation) throw aborted();
        entries.delete(key); cached.usedAt = Date.now(); entries.set(key, cached); prune(); return structuredClone(cached.data);
      }
      let data: any;
      try { data = await response.json(); } catch (error) { if (controller.signal.aborted || error?.name === 'AbortError') throw aborted(); if (response.ok) throw new Error('Phản hồi từ hệ thống không hợp lệ.'); }
      if (response.status === 401 || response.status === 403) {
        // No stale fallback for denied access, including legacy cached requests.
        clearRequestCache(); if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('auth-expired'));
      }
      if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : data?.error?.message || `Không tải được dữ liệu (${response.status}).`, response.status, data);
      if (controller.signal.aborted) throw aborted();
      if (epoch !== generation) { epoch = generation; cached = undefined; headers.delete('If-None-Match'); continue; }
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
      entries.delete(key); entries.set(key, { data: structuredClone(data), etag: response.headers.get('ETag') || '', bytes, usedAt: Date.now(), tags: responseTags(url,data) }); prune();
      return data;
      }
    })().finally(() => { if (flights.get(flightKey) === current) flights.delete(flightKey); });
    flights.set(flightKey, flight);
  }
  const current = flight; current.consumers++;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = () => { if (done) return false; done = true; options.signal?.removeEventListener('abort', cancel); current.consumers--; return true; };
    const cancel = () => { if (finish()) { reject(aborted()); queueMicrotask(() => { if (!current.consumers) { current.controller.abort(); if (flights.get(flightKey) === current) flights.delete(flightKey); } }); } };
    options.signal?.addEventListener('abort', cancel, { once: true });
    current.promise.then(value => { if (finish()) resolve(structuredClone(value)); }, error => { if (finish()) reject(error); });
  });
}

// Response-compatible adapter for existing legacy screens. Binary transfers stay direct.
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input); const method = (init.method || 'GET').toUpperCase();
  const jsonGet = method === 'GET' && url.includes('/api/') && !/\/(?:download|view|attachment)(?:[?\/]|$)|export|\.xlsx|\.csv|\.zip/.test(url);
  if (jsonGet) {
    try { return new Response(JSON.stringify(await requestJson(url, { headers: init.headers, signal: init.signal || undefined, forceRefresh: init.cache === 'reload' || init.cache === 'no-store' })), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (error) { if (error instanceof ApiError) return new Response(JSON.stringify(error.data || { error: error.message }), { status: error.status, headers: { 'Content-Type': 'application/json' } }); throw error; }
  }
  const response = await fetch(input, init);
  if (response.status === 401 || response.status === 403) { clearRequestCache(); if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('auth-expired')); }
  if (method !== 'GET' && response.ok) invalidateRequestCache(url);
  return response;
}
