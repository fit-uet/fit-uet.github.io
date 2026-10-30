import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {CloudflareD1Client} from '../../server/db';
import {withDatabaseMetrics,currentDatabaseMetrics,databaseMetricsMiddleware} from '../../server/services/databaseMetrics';

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const client=()=>new CloudflareD1Client('private-account','private-database','private-token');
const response=(counts:number[])=>Response.json({success:true,result:counts.map(n=>({results:[],meta:{rows_read:n,rows_written:1,duration:2,changes:1}}))});

test('D1 metrics include every statement in execute, executeMultiple and batch without extra database queries',async()=>{
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return response([10,20]);})as typeof fetch;
  await withDatabaseMetrics(async()=>{
    await client().execute('SELECT 1; SELECT 2');
    await client().executeMultiple('SELECT 1; SELECT 2');
    await client().batch([{sql:'SELECT ?',args:['private-person@vnu.edu.vn']},{sql:'SELECT 2'}]);
    const metrics=currentDatabaseMetrics()!;
    assert.equal(calls,3);assert.equal(metrics.count,6);assert.equal(metrics.rowsRead,90);assert.equal(metrics.rowsWritten,6);assert.equal(metrics.durationMs,12);
    assert.ok([...metrics.queries.keys()].every(k=>/^[a-f0-9]{16}$/.test(k)));
  });
});

test('concurrent requests keep counters separate and request logs contain only a route template and numeric aggregates',async()=>{
  const originalInfo=console.info,logs:any[]=[];
  console.info=(prefix,...args)=>{if(prefix==='[database-request]')logs.push(JSON.parse(String(args[0])));};
  globalThis.fetch=(async(_url,init)=>{const payload=JSON.parse(String(init?.body));await new Promise(r=>setTimeout(r,payload.params[0]===1?15:1));return response([payload.params[0]]);})as typeof fetch;
  const app=express();app.use(databaseMetricsMiddleware);app.get('/api/enrollments/:id',async(req,res)=>{await client().execute({sql:'SELECT ?',args:[Number(req.params.id)]});res.json({ok:true});});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{
    const base=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
    await Promise.all([1,2].map(async n=>{const r=await originalFetch(base+`/api/enrollments/${n}?secret=private`);await r.text();}));
  }finally{await new Promise<void>(r=>server.close(()=>r()));console.info=originalInfo;}
  assert.equal(logs.length,2);assert.deepEqual(logs.map(v=>v.rowsRead).sort(),[1,2]);
  for(const log of logs){assert.equal(log.route,'/api/enrollments/:id');assert.equal(log.queryCount,1);assert.equal(log.status,200);assert.doesNotMatch(JSON.stringify(log),/private|vnu\.edu|params|SELECT/);}
});
