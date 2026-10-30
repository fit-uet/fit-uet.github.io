import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import type {RequestHandler} from 'express';

interface QueryMetric {rowsRead:number;rowsWritten:number;durationMs:number;count:number}
export interface DatabaseMetrics extends QueryMetric {queries:Map<string,QueryMetric>}
const contexts=new AsyncLocalStorage<DatabaseMetrics>();
export function withDatabaseMetrics<T>(run:()=>T, metrics:DatabaseMetrics={rowsRead:0,rowsWritten:0,durationMs:0,count:0,queries:new Map()}){
  return contexts.run(metrics,run);
}
export function currentDatabaseMetrics(){return contexts.getStore();}
const nonnegative=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):0;

// Never log SQL, parameters, credentials, account IDs or student data. The
// fingerprint lets operators correlate expensive query shapes across requests.
export function recordDatabaseQuery(sql:string,meta:any){
  const rowsRead=nonnegative(meta?.rows_read),rowsWritten=nonnegative(meta?.rows_written),durationMs=nonnegative(meta?.duration);
  const fingerprint=createHash('sha256').update(sql.replace(/\s+/g,' ').trim()).digest('hex').slice(0,16);
  const metrics=contexts.getStore();
  if(!metrics){
    if(rowsRead>=10_000)console.warn('[database-query]',JSON.stringify({fingerprint,rowsRead,rowsWritten,durationMs}));
    return;
  }
  metrics.count++;metrics.rowsRead+=rowsRead;metrics.rowsWritten+=rowsWritten;metrics.durationMs+=durationMs;
  const previous=metrics.queries.get(fingerprint);
  if(previous){previous.count++;previous.rowsRead+=rowsRead;previous.rowsWritten+=rowsWritten;previous.durationMs+=durationMs;}
  else if(metrics.queries.size<100)metrics.queries.set(fingerprint,{count:1,rowsRead,rowsWritten,durationMs});
}

export const databaseMetricsMiddleware:RequestHandler=(req,res,next)=>{
  if(!req.path.startsWith('/api/')){next();return;}
  withDatabaseMetrics(()=>{
    const metrics=currentDatabaseMetrics()!;
    res.once('finish',()=>{
      if(!metrics.count)return;
      const role=(req as any).user?.role;
      console.info('[database-request]',JSON.stringify({method:req.method,route:typeof req.route?.path==='string'?req.route.path:'unmatched',role:['admin','lecturer','student'].includes(role)?role:undefined,status:res.statusCode,
        queryCount:metrics.count,rowsRead:metrics.rowsRead,rowsWritten:metrics.rowsWritten,durationMs:Number(metrics.durationMs.toFixed(2)),
        topQueries:[...metrics.queries].sort((a,b)=>b[1].rowsRead-a[1].rowsRead).slice(0,3).map(([fingerprint,m])=>({fingerprint,count:m.count,rowsRead:m.rowsRead}))}));
    });
    next();
  });
};
