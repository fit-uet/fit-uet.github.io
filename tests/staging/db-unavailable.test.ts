import {test,beforeEach,afterEach} from 'node:test';import assert from 'node:assert/strict';import express from 'express';import jwt from 'jsonwebtoken';import {OAuth2Client} from 'google-auth-library';
import {createAcademicFixture} from '../academic/fixture';import {db,setDb,isDbQuotaError,isTransientLibsqlError} from '../../server/db';import {JWT_SECRET} from '../../server/config';import {requireAuth} from '../../server/middlewares/auth';import {healthRouter} from '../../server/routes/health.routes';import {authRouter} from '../../server/routes/auth.routes';import {databaseAvailability} from '../../server/services/databaseAvailability';
const quota="D1 HTTP Error 400: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC).";
let client:Awaited<ReturnType<typeof createAcademicFixture>>,saved:NodeJS.ProcessEnv;
beforeEach(async()=>{saved={...process.env};process.env.DB_PROVIDER='d1';client=await createAcademicFixture();});
afterEach(()=>{client.close();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);});
async function serve(run:(base:string)=>Promise<void>){const app=express();app.use(express.json(),healthRouter,authRouter);app.get('/private',requireAuth,(_req,res)=>res.json({private:true}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));try{await run(`http://127.0.0.1:${(server.address() as any).port}`);}finally{await new Promise<void>(r=>server.close(()=>r()));}}
function unavailable(message=quota){let reads=0;setDb({execute:async()=>{reads++;throw Error(message);},executeMultiple:async()=>{},batch:async()=>[]});return()=>reads;}
test('D1 daily limit is quota, not transient or a generic D1 SQL error',()=>{
 assert.equal(isDbQuotaError(Error(quota)),true);assert.equal(isTransientLibsqlError(Error(quota)),false);
 assert.equal(isDbQuotaError(Error('reads are blocked, do you need to upgrade your plan?')),true);
 assert.equal(isDbQuotaError(Error('D1 Query Error 7500: no such table')),false);
 const data=databaseAvailability(Error(quota),Date.parse('2026-10-30T01:45:00Z'));assert.equal(data.databaseProvider,'d1');assert.equal(data.retryAt,'2026-10-31T00:00:00.000Z');assert.ok(!data.error.includes('Turso'));
});
test('a valid session gets 503 on database failure; invalid JWT still gets 401 without a database read',async()=>{
 const reads=unavailable();const token=jwt.sign({email:'admin@vnu.edu.vn'},JWT_SECRET);
 await serve(async base=>{const bad=await fetch(base+'/private',{headers:{Authorization:'Bearer invalid'}});assert.equal(bad.status,401);assert.equal(reads(),0);
  const response=await fetch(base+'/private',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,503);const data=await response.json();assert.equal(data.code,'DB_QUOTA_EXCEEDED');assert.equal(data.database,'quota_blocked');assert.equal(reads(),1);assert.equal(data.private,undefined);});
});
test('readiness returns provider and retry time without exposing a database error',async()=>{
 unavailable();await serve(async base=>{const response=await fetch(base+'/api/ready');assert.equal(response.status,503);const data=await response.json();assert.equal(data.code,'DB_QUOTA_EXCEEDED');assert.equal(data.databaseProvider,'d1');assert.ok(Number.isFinite(Date.parse(data.retryAt)));assert.ok(!JSON.stringify(data).includes('D1 HTTP Error'));});
});
test('Google login distinguishes database quota and invalid database API token from Google credentials',async()=>{
 const original=OAuth2Client.prototype.verifyIdToken;OAuth2Client.prototype.verifyIdToken=async()=>({getPayload:()=>({email:'admin@vnu.edu.vn',name:'Khoa'})}) as any;
 try{await serve(async base=>{for(const message of[quota,'D1 HTTP Error 403: Invalid API token private-secret']){unavailable(message);const response=await fetch(base+'/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:'local-test'})});assert.equal(response.status,503);const data=await response.json();assert.equal(data.code,message===quota?'DB_QUOTA_EXCEEDED':'DB_CONNECTION_ERROR');assert.ok(!JSON.stringify(data).includes('private-secret'));}});}finally{OAuth2Client.prototype.verifyIdToken=original;}
});
