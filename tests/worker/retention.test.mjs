// D092 policy parity on actual workerd SQLite; no blob/deletion port is supplied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NOW=1800000000000,DAY=86400000,origin='https://retention.example';
const source=`
import {DurableObject} from 'cloudflare:workers';
import {createAppEngine,read,perform} from './packages/app/engine.mjs';
import {cryptoRandom,nullAudit} from './packages/app/providers.mjs';
import {ProduceRetention,RetentionStatus,SaveRetentionKeep} from './packages/runtime/retention.mjs';
import {key} from './packages/core/records.mjs';
const OWNER='${OWNER}',NOW=${NOW},config={APP_ORIGIN:'${origin}',OVER_QUOTA_RETENTION_ENABLED:'true',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra'};
export class Probe extends DurableObject {
 engine(now){return createAppEngine({providers:{accountStore:this.ctx.storage,clock:{now:()=>now},random:cryptoRandom,audit:nullAudit,flags:{for:()=>({enabled:()=>true,background:()=>true})},config}});}
 async seed(){const s=this.ctx.storage;await s.put('owner',OWNER);await s.put('billing/state',{owner:OWNER,source:'polar',catalogVersion:2,plan:'free',billingRevision:2,retentionAuthoritative:true,reconciledAt:NOW});await s.put('billing/transition/0000000000000002',{revision:2,causalEventId:'verified-lapse',before:{plan:'paid',storageBytes:5000000000},after:{plan:'free',storageBytes:500000000},effectiveAt:NOW,reason:'lapse'});await s.put('resource/r',{id:'r',owner:OWNER,provider:'hosted',name:'Whole resource'});await s.put('hosted/r/chunk',{size:600000000,version:'original',blobRef:'must-survive'});await s.put('hosted-usage',{bytes:600000000,objects:1});await s.put(key('collection',OWNER,'inbox'),{id:'inbox',owner:OWNER,name:'Inbox'});await s.put(key('message',OWNER,'m'),{id:'m',owner:OWNER,collection:'inbox',size:10,blobRef:'message-survives'});await s.put(key('message-usage',OWNER),{bytes:10,messages:1});return {seeded:true};}
 async action(kind,now,input){const engine=this.engine(now),owner={kind:'owner',owner:OWNER};try{if(kind==='produce')return await perform(engine,new ProduceRetention({actor:{kind:'system',owner:OWNER}}));if(kind==='keep')return await perform(engine,new SaveRetentionKeep({actor:owner,input}));return await read(engine,new RetentionStatus({actor:owner}));}finally{await engine.dispose();}}
 async content(){return {hosted:await this.ctx.storage.get('hosted/r/chunk'),message:await this.ctx.storage.get(key('message',OWNER,'m')),hostedCount:(await this.ctx.storage.list({prefix:'hosted/'})).size,fence:await this.ctx.storage.get('deletion/fence-v1')??null};}
}
export default {async fetch(request,env){try{const u=new URL(request.url),p=env.PROBE.get(env.PROBE.idFromName('retention'));if(u.pathname==='/seed')return Response.json(await p.seed());if(u.pathname==='/content')return Response.json(await p.content());const input=request.method==='POST'?await request.json():undefined;return Response.json(await p.action(u.pathname.slice(1),Number(u.searchParams.get('now')??NOW),input));}catch(e){return Response.json({error:e.code??'error',message:e.message},{status:e.status??500});}}};`;
async function harness(t){const temporary=await mkdtemp(path.join(tmpdir(),'d092-worker-')),out=path.join(temporary,'probe.mjs');t.after(()=>rm(temporary,{recursive:true,force:true}));await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'d092-probe.mjs'},outfile:out,bundle:true,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],target:'es2022',logLevel:'silent'});const mf=new Miniflare(convertV4MiniflareOptions({name:'d092-retention-probe',modulesRoot:temporary,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),durableObjects:{PROBE:{className:'Probe',useSQLite:true}}}));t.after(()=>mf.dispose());return mf;}
test('workerd SQLite retention survives engine restart/replay/clock rollback with whole-unit keep and no deletion',{timeout:90000},async t=>{
 const mf=await harness(t),call=async(route,now=NOW,input)=>{const response=await mf.dispatchFetch(origin+route+'?now='+now,input?{method:'POST',body:JSON.stringify(input),headers:{'content-type':'application/json'}}:{});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 await call('/seed');const original=await call('/content');await call('/produce',NOW+3*DAY);let s=await call('/status',NOW+3*DAY),episode=s.episode;// The seeded transition predates the first producer run: a fresh backfill episode (review M1).
 assert.equal(episode.deadlineAt,NOW+33*DAY);assert.equal(episode.backfill,true);assert.equal(episode.state,'grace');assert.equal(episode.noticeSchedule[0].attempts[0].result,'not-configured');assert.equal(episode.noticeSchedule[0].attempts[0].acceptedAt,undefined);assert.equal(s.inventoryComplete,true);assert.deepEqual(s.units.map(u=>[u.id,u.bytes]),[['collection:inbox',10],['resource:r',600000000]]);
 await call('/keep',NOW+3*DAY,{episodeId:episode.id,revision:0,keepSelection:['collection:inbox']});
 // Every request constructs and disposes another Engine over the same durable SQLite.
 await call('/produce',NOW+4*DAY);s=await call('/status',NOW+4*DAY);assert.equal(s.episode.id,episode.id);assert.equal(s.episode.deadlineAt,episode.deadlineAt);assert.equal(s.episode.keepSelectionRevision,1);assert.deepEqual(s.episode.keepSelection,['collection:inbox']);assert.equal(s.episode.noticeSchedule[0].attempts.length,1);
 // The persisted observation is step-capped (review L5): one far-future reading cannot grant eligibility.
 await call('/produce',NOW+400*DAY);await call('/produce',NOW+5*DAY);s=await call('/status',NOW+5*DAY);assert.equal(s.episode.state,'grace');
 for(let day=6;day<=34;day++)await call('/produce',NOW+day*DAY);s=await call('/status',NOW+34*DAY);assert.equal(s.episode.state,'cleanup-eligible');assert.deepEqual(s.episode.noticeSchedule.map(n=>n.attempts[0].result),['not-configured','not-configured','not-configured']);
 await call('/produce',NOW);s=await call('/status',NOW);assert.equal(s.episode.state,'cleanup-eligible');assert.equal(s.episode.deadlineAt,episode.deadlineAt);assert.equal(s.removalEnabled,false);assert.deepEqual(await call('/content'),original);
});
