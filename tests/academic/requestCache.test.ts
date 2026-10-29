import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,clearRequestCache,invalidateRequestCache,requestJson} from '../../src/shared/utils/requestCache';
let original:typeof fetch;
const headers={Authorization:'Bearer cache-test-account'};
beforeEach(()=>{original=globalThis.fetch;clearRequestCache();});
afterEach(()=>{clearRequestCache();globalThis.fetch=original;});
const json=(value:any,etag='"v1"')=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json',ETag:etag}});
test('cached GET revalidates with ETag and returns isolated data on 304',async()=>{
 let calls=0;globalThis.fetch=async(_url,init)=>{calls++;assert.equal(new Headers(init?.headers).get('If-None-Match'),calls===1?null:'"v1"');return calls===1?json({items:[1]}):new Response(null,{status:304});};
 const a=await requestJson('/api/items',{headers});a.items.push(2);
 assert.deepEqual(await requestJson('/api/items',{headers}),{items:[1]});assert.equal(calls,2);
});
test('shared in-flight GET survives cancellation of one consumer',async()=>{
 let complete:(r:Response)=>void;let aborted=false,calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;init?.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise<Response>(resolve=>{complete=resolve;});};
 const a=new AbortController(),b=new AbortController();const first=requestJson('/api/shared',{headers,signal:a.signal}),second=requestJson('/api/shared',{headers,signal:b.signal});
 a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(aborted,false);complete!(json({ok:true}));assert.deepEqual(await second,{ok:true});assert.equal(calls,1);
});
test('all consumers aborting releases the request for a fresh subsequent attempt',async()=>{
 let calls=0;globalThis.fetch=async(_url,init)=>{calls++;if(calls>1)return json({fresh:true});return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));};
 const abort=new AbortController();const pending=requestJson('/api/abort',{headers,signal:abort.signal});abort.abort();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(await requestJson('/api/abort',{headers}),{fresh:true});assert.equal(calls,2);
});
for(const status of [401,403])test(`HTTP ${status} never returns cached data`,async()=>{
 globalThis.fetch=async()=>json({private:true});await requestJson('/api/private',{headers});globalThis.fetch=async()=>new Response(JSON.stringify({error:'Denied'}),{status});
 await assert.rejects(requestJson('/api/private',{headers}),e=>e instanceof ApiError&&e.status===status);
 let condition:string|null='';globalThis.fetch=async(_u,i)=>{condition=new Headers(i?.headers).get('If-None-Match');return json({public:true});};await requestJson('/api/private',{headers});assert.equal(condition,null);
});
test('network failures do not fall back to an unvalidated private cache',async()=>{
 globalThis.fetch=async()=>json({private:true});await requestJson('/api/private',{headers});globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(requestJson('/api/private',{headers}),/offline/);
});
test('force refresh, identity and scope isolate entries',async()=>{
 const conditions:(string|null)[]=[];globalThis.fetch=async(_u,i)=>{conditions.push(new Headers(i?.headers).get('If-None-Match'));return json({ok:true});};
 await requestJson('/api/data',{headers});await requestJson('/api/data',{headers,forceRefresh:true});await requestJson('/api/data',{headers:{Authorization:'Bearer another'}});await requestJson('/api/data',{headers,scope:'lecturer'});assert.deepEqual(conditions,[null,null,null,null]);
});
test('a concurrent write retries active readers rather than stranding mounted screens',async()=>{
 let complete:(r:Response)=>void,calls=0;globalThis.fetch=async()=>{calls++;return calls===1?new Promise<Response>(resolve=>{complete=resolve;}):json({version:2},'"v2"');};
 const pending=requestJson('/api/data',{headers});invalidateRequestCache();complete!(json({version:1}));assert.deepEqual(await pending,{version:2});assert.equal(calls,2);
});
test('LRU bounds entries at 100 and expires unused entries after five minutes',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1_000_000});let condition:string|null='';globalThis.fetch=async(_u,i)=>{condition=new Headers(i?.headers).get('If-None-Match');return json({ok:true});};
 for(let i=0;i<101;i++)await requestJson('/api/row/'+i,{headers});await requestJson('/api/row/0',{headers});assert.equal(condition,null);
 t.mock.timers.tick(5*60_000+1);await requestJson('/api/row/100',{headers});assert.equal(condition,null);
});
test('the 20 MB limit evicts old JSON before the entry-count limit',async()=>{
 let condition:string|null='';globalThis.fetch=async(_u,i)=>{condition=new Headers(i?.headers).get('If-None-Match');return json({value:'x'.repeat(1_100_000)});};
 for(let i=0;i<20;i++)await requestJson('/api/large/'+i,{headers});await requestJson('/api/large/0',{headers});assert.equal(condition,null);
});

test('a campaign mutation preserves unrelated campaign caches and preview operations',async()=>{
 const conditions:Record<string,(string|null)[]>={};
 globalThis.fetch=async(url,init)=>{const path=String(url);(conditions[path]||=[]).push(new Headers(init?.headers).get('If-None-Match'));return json({campaign:{id:path.endsWith('A')?'A':'B'},classes:[]});};
 await requestJson('/api/campaigns/A',{headers});await requestJson('/api/campaigns/B',{headers});
 invalidateRequestCache('/api/admin/campaigns/A',{id:'A'});
 await requestJson('/api/campaigns/A',{headers});await requestJson('/api/campaigns/B',{headers});
 assert.deepEqual(conditions['/api/campaigns/A'],[null,null]);assert.deepEqual(conditions['/api/campaigns/B'],[null,'"v1"']);
 invalidateRequestCache('/api/admin/semesters/1/reviewers/preview');await requestJson('/api/campaigns/B',{headers});assert.equal(conditions['/api/campaigns/B'].at(-1),'"v1"');
});

test('a synchronous unsubscribe and resubscribe shares the active GET',async()=>{
 let complete:(r:Response)=>void,calls=0;globalThis.fetch=async()=>{calls++;return new Promise<Response>(resolve=>{complete=resolve;});};
 const abort=new AbortController();const first=requestJson('/api/reopen',{headers,signal:abort.signal});abort.abort();const second=requestJson('/api/reopen',{headers});
 await assert.rejects(first,{name:'AbortError'});complete!(json({ok:true}));assert.deepEqual(await second,{ok:true});assert.equal(calls,1);
});
