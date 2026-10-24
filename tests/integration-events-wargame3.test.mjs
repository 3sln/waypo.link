// Wargame round 3, F2 (DEVLOG 2026-10-23): one integration's revocation backlog must not block other integrations'
// SETs. Ported from the red-team repros (outbox-caps, outbox-cascade) plus the plausible items in the same area.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {AppConnections} from '../packages/apps/connections.mjs';
import * as C from '../packages/app/domains/connections.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
import {brokeringKeys} from '../packages/federation/signing.mjs';
import {account as introspectionAccount,ACCESS_ENDS_BY_MS} from '../packages/federation/introspection.mjs';
import * as E from '../packages/runtime/integration-events.mjs';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {ISSUER} from './fixtures/integration-server.mjs';

const L=E.INTEGRATION_EVENT_LIMITS,ROW='integration-events/row/';
const A='aaaaaaaa-0000-4000-8000-000000000001',B='bbbbbbbb-0000-4000-8000-000000000002';
const grants=(n,width=64)=>Array.from({length:width},(_,j)=>`g${n}-${j}`);
// A storage stub that (like some adapters) ignores startAfter, so the paging must still terminate and count exactly.
function tx(){const map=new Map();return {map,get:async k=>structuredClone(map.get(k)),put:async(k,v)=>{map.set(k,structuredClone(v));},delete:async k=>{map.delete(k);},
 list:async({prefix='',limit=Infinity}={})=>{const out=new Map();for(const k of [...map.keys()].sort()){if(!k.startsWith(prefix))continue;if(out.size>=limit)break;out.set(k,structuredClone(map.get(k)));}return out;},
 transaction(fn){return fn(this);}};}
const rowsOf=(t,connection)=>[...t.map.keys()].filter(k=>k.startsWith(ROW+connection+'/'));

test('F2: one connection cannot hold more than 2 x perConnection revocation rows (exact per-connection count)',async()=>{
 const t=tx();let refused=0;
 // 64 distinct grants per event, so nothing merges: every accepted event is a row.
 for(let i=0;i<300;i++){try{await E.enqueueIntegrationEvent(t,{type:'credential-revoked',connection:A,grants:grants(i),until:2e9},{now:1});}catch(e){assert.equal(e.code,'integration_events_full');refused++;}}
 assert.ok(refused>0,'the hard ceiling is reachable and fails visibly');
 assert.ok(rowsOf(t,A).length<=L.perConnection*2,`one connection holds ${rowsOf(t,A).length} rows (ceiling ${L.perConnection*2})`);
});

test('F2: one connection\'s revocation backlog does not refuse other connections\' rows',async()=>{
 const t=tx();
 for(let i=0;i<600;i++){try{await E.enqueueIntegrationEvent(t,{type:'credential-revoked',connection:A,grants:grants(i),until:2e9},{now:1});}catch{break;}}
 await assert.doesNotReject(E.enqueueIntegrationEvent(t,{type:'resource-detached',connection:B,resource:'https://other.example/r/1'},{now:1}));
});

test('F2: credential-revoked rows merge per connection: grants are unioned and the latest until kept',async()=>{
 const t=tx();
 for(let i=0;i<300;i++)await E.enqueueIntegrationEvent(t,{type:'credential-revoked',connection:A,grants:['g'+i],until:1000+(i===7?5000:i)},{now:1});
 const rows=rowsOf(t,A).map(k=>t.map.get(k));
 assert.equal(rows.length,Math.ceil(300/64),'one row per 64 grants');
 assert.deepEqual(new Set(rows.flatMap(r=>r.grants)),new Set(Array.from({length:300},(_,i)=>'g'+i)),'no grant is lost');
 assert.ok(rows.every(r=>r.grants.length<=64));
 assert.equal(Math.max(...rows.map(r=>r.until)),6000,'the latest until is kept');
 // Re-revoking a pending grant adds no row.
 await E.enqueueIntegrationEvent(t,{type:'credential-revoked',connection:A,grants:['g1'],until:1},{now:2});
 assert.equal(rowsOf(t,A).length,rows.length);
});

function snapshot(host){
 const clientId=`https://${host}/bindle/client.json`,redirectUris=[`https://${host}/bindle/callback`],jwksUri=`https://${host}/bindle/jwks.json`;
 const r=validateIntegrationManifest({v:1,events_endpoint:`https://${host}/bindle/events`},{clientId,confidential:true,redirectUris,jwksUri});assert.equal(r.status,'valid');
 return {client:{id:clientId,name:host},snapshot:{clientId,redirectUris,authMethod:'private_key_jwt',jwksUri,thumbprints:['A'.repeat(43)],manifest:r.manifest}};
}
function keyStore(){const map=new Map();let tail=Promise.resolve();return {transaction(fn){const run=tail.then(()=>fn({get:async k=>structuredClone(map.get(k)),set:async(k,v)=>{map.set(k,structuredClone(v));}}));tail=run.catch(()=>{});return run;}};}
async function world(t,{limits,down=new Set(['evil.example'])}={}){
 const clock=fakeClock(Date.UTC(2026,9,20,12)),keys=brokeringKeys({issuer:ISSUER,secret:Buffer.alloc(32,7).toString('base64'),metadata:keyStore(),clock:()=>clock.now()});
 const seen=new Map();
 const egress={async send({url,body}){const host=new URL(url).host;if(down.has(host))return {status:500,bytes:new Uint8Array()};
  const claims=JSON.parse(Buffer.from(body.split('.')[1],'base64url'));const [[type,payload]]=Object.entries(claims.events);(seen.get(host)??seen.set(host,[]).get(host)).push({type:type.split('/').at(-2),...payload});return {status:202,bytes:new Uint8Array()};}};
 const system={kind:'system',owner:OWNER},owner={kind:'owner',owner:OWNER,authTime:clock.now()};let x4;
 const op=(Operation,actor,input)=>{const o=new Operation({actor,...input===undefined?{}:{input}});return o instanceof AppQuery?read(x4,o):perform(x4,o);};
 const port=()=>({outbox:i=>op(C.ConnectionOutbox,system,i),ack:i=>op(C.AckConnectionOutbox,system,i),list:()=>op(C.ConnectionList,system),health:i=>op(C.ConnectionHealth,system,i)});
 const harness=await createTestEngine({clock,providers:{integrationEvents:E.integrationEventsProvider({enabled:true,issuer:ISSUER,signer:keys,egress,snapshot:async()=>({revision:null,values:null}),connections:port,limits})}});
 t.after(()=>harness.dispose());await harness.metadata.put('owner',OWNER);
 const connections=new AppConnections({metadata:harness.metadata,origin:ISSUER,clock:clock.now});
 x4=createAppEngine({providers:{clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit:memoryAudit({clock}),connections:C.connectionsProvider({connections,enabled:true,account:async()=>({status:'active'})})}});
 t.after(()=>x4.dispose());
 const ev={ingest:()=>harness.perform(new E.IngestIntegrationEvents({actor:system})),deliver:()=>harness.perform(new E.DeliverIntegrationEvents({actor:system})),enqueue:input=>harness.perform(new E.EnqueueIntegrationEvent({actor:system,input})),status:()=>harness.read(new E.IntegrationEventStatus({actor:system}))};
 const generation=async id=>(await op(C.ConnectionList,system)).connections.find(c=>c.id===id).generation;
 const pauseResumeDisconnect=async id=>{await op(C.SuspendConnection,owner,{connection:id,expectedGeneration:await generation(id)});await op(C.ResumeConnection,owner,{connection:id,expectedGeneration:await generation(id)});await op(C.DisconnectConnection,owner,{connection:id,expectedGeneration:await generation(id)});};
 const rows=async id=>[...(await harness.metadata.list({prefix:ROW+id+'/'})).values()];
 return {clock,seen,op,system,ev,harness,connect:host=>op(C.ConnectIntegration,system,snapshot(host)),pauseResumeDisconnect,rows};
}

test('F2: a failing integration\'s revocation backlog does not stop another integration\'s disconnect SET',async t=>{
 const w=await world(t),A=await w.connect('evil.example'),B=await w.connect('good.example');
 await w.ev.ingest();
 // Severance drains / federation session invalidations each append one credential-revoked event for A.
 for(let n=0;n<600;n++){try{await w.ev.enqueue({type:'credential-revoked',connection:A.id,grants:grants(n),until:Math.floor(w.clock.now()/1000)+360});}catch{break;}}
 await w.pauseResumeDisconnect(B.id);
 for(let i=0;i<20;i++){await w.ev.ingest();await w.ev.deliver();w.clock.advance(15000);}
 const toB=w.seen.get('good.example')??[];
 assert.ok(toB.some(e=>e.type==='connection-revoked'&&e.terminal===true),`B never received its terminal revocation; got ${JSON.stringify(toB.map(e=>[e.type,e.terminal]))}`);
 assert.ok((await w.rows(A.id)).length<=L.perConnection*2,'A stays within its ceiling');
});

test('F2: ingest skips a refused resume (setting resync) instead of stopping before a later revocation',async t=>{
 const w=await world(t,{limits:{rows:4,perConnection:4}}),A=await w.connect('evil.example'),B=await w.connect('good.example');
 await w.ev.ingest();
 for(let n=0;n<4;n++)await w.ev.enqueue({type:'credential-revoked',connection:A.id,grants:grants(n),until:Math.floor(w.clock.now()/1000)+360});
 await w.pauseResumeDisconnect(B.id);
 const out=await w.ev.ingest();
 assert.equal(out.resync,true,'the skipped resume is left for the resync');
 assert.ok((await w.rows(B.id)).some(r=>r.type==='connection-revoked'&&r.terminal===true),'B\'s terminal revocation behind the refused resume was ingested');
});

test('F2 review: a skipped resume survives later unmapped events that advance the generation (pendingResume)',async t=>{
 const w=await world(t,{limits:{rows:4,perConnection:4}}),A=await w.connect('evil.example'),B=await w.connect('good.example');
 await w.ev.ingest();
 for(let n=0;n<4;n++)await w.ev.enqueue({type:'credential-revoked',connection:A.id,grants:grants(n),until:Math.floor(w.clock.now()/1000)+360});
 const gen=async()=>(await w.op(C.ConnectionList,w.system)).connections.find(c=>c.id===B.id).generation,owner={kind:'owner',owner:OWNER,authTime:w.clock.now()};
 await w.op(C.SuspendConnection,owner,{connection:B.id,expectedGeneration:await gen()});
 await w.op(C.ResumeConnection,owner,{connection:B.id,expectedGeneration:await gen()});
 // An unmapped X4 event (health) for B follows the refused resume and carries B's current generation.
 try{await w.op(C.ConnectionHealth,w.system,{connection:B.id,expectedGeneration:await gen(),degraded:true});}catch{}
 const first=await w.ev.ingest();assert.equal(first.resync,true);
 assert.ok(!(await w.rows(B.id)).some(r=>r.type==='connection-resumed'),'the resume was refused while the outbox was full');
 assert.equal((await w.harness.metadata.get('integration-events/conn/'+B.id)).pendingResume,true);
 // Room returns (A's backlog clears); the resync must still re-derive B's resume.
 for(const k of [...(await w.harness.metadata.list({prefix:ROW+A.id+'/'})).keys()])await w.harness.metadata.delete(k);
 {const n=(await w.rows(B.id)).length;await w.harness.metadata.transaction(async tx=>{const m=await tx.get('integration-events/meta');m.rows=n;await tx.put('integration-events/meta',m);});}
 for(let i=0;i<3;i++)await w.ev.ingest();
 assert.ok((await w.rows(B.id)).some(r=>r.type==='connection-resumed'),'resync dropped the skipped resume for good');
 assert.equal((await w.harness.metadata.get('integration-events/conn/'+B.id)).pendingResume,undefined);
 await w.ev.deliver();
 assert.ok((w.seen.get('good.example')??[]).some(e=>e.type==='connection-resumed'),'B never received its resume');
});
test('F2: delivery and status page per connection, so rows of later connection ids are never hidden',async t=>{
 const w=await world(t,{down:new Set()}),B=await w.connect('good.example');
 await w.ev.ingest();
 // Six other connection ids that sort before B's each hold a full revocation backlog (more rows than one listing page).
 await w.ev.enqueue({type:'credential-revoked',connection:B.id,grants:['b-grant'],until:Math.floor(w.clock.now()/1000)+360});
 await w.harness.metadata.transaction(async tx=>{for(let c=0;c<6;c++)for(let n=0;n<L.perConnection*2;n++)await E.enqueueIntegrationEvent(tx,{type:'credential-revoked',connection:`0000000${c}-0000-4000-8000-000000000000`,grants:grants(n),until:2e9},{now:w.clock.now()});});
 const pending=(await w.ev.status()).pending;
 assert.ok(pending.some(r=>r.connection===B.id&&r.type==='credential-revoked'),'status lists B\'s row');
 await w.ev.deliver();
 assert.ok((w.seen.get('good.example')??[]).some(e=>e.type==='credential-revoked'&&e.grants?.includes('b-grant')),'B\'s row is delivered');
});

test('F2: expiry clears the connection\'s whole backlog, including one larger than a listing page',async t=>{
 const w=await world(t),A=await w.connect('evil.example');
 await w.ev.ingest();
 // A backlog left by the pre-fix uncapped enqueue (rows written directly, as old storage may already hold them).
 await w.harness.metadata.transaction(async tx=>{const m=await tx.get('integration-events/meta')??{v:1,cursor:0,order:0,rows:0,log:0,unacked:0,bells:0};
  for(let i=0;i<300;i++){m.order++;m.rows++;const key=`${ROW}${A.id}/c:${String(m.order).padStart(16,'0')}`;await tx.put(key,{type:'credential-revoked',connection:A.id,grants:['g'+i],until:2e9,key,order:m.order,priority:0,createdAt:w.clock.now(),nextAt:w.clock.now(),attempts:0});}
  await tx.put('integration-events/meta',m);});
 await w.ev.deliver();assert.equal((await w.rows(A.id)).length,300,'the first attempt fails and starts the window');
 w.clock.advance(L.window+3600000);
 assert.equal((await w.ev.deliver()).expired,1);
 assert.equal((await w.rows(A.id)).length,0,'one expiry clears the connection\'s whole backlog');
});

function store(){const map=new Map(),api={map,get:async k=>structuredClone(map.get(k)),put:async(k,v)=>{map.set(k,structuredClone(v));},delete:async k=>{map.delete(k);},
 list:async({prefix='',startAfter='',limit=Infinity}={})=>{const out=new Map();for(const k of [...map.keys()].sort()){if(!k.startsWith(prefix)||k<=startAfter)continue;if(out.size>=limit)break;out.set(k,structuredClone(map.get(k)));}return out;}};
 return {...api,transaction:fn=>fn(api)};}
function federationHost(){const metadata=store();metadata.map.set('owner',OWNER);return {metadata,config:{INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true',APP_ORIGIN:ISSUER},kicks:0,async integrationEventsKick(){this.kicks++;}};}
const fed=(host,source,grant)=>introspectionAccount.methods.brokeredFederationEvent.call(host,OWNER,{source,event:{type:'credential-revoked',connection:'conn-1',grants:[grant],until:Math.floor(Date.now()/1000)+360}});

test('F2: a federation revocation marker carries until = now + ACCESS_ENDS_BY_MS',async()=>{
 const host=federationHost(),before=Date.now();
 await fed(host,'src-1','grant-1');
 const marker=host.metadata.map.get('integrations/x8/revoked/grant-1');
 assert.ok(Number.isSafeInteger(marker?.until)&&marker.until>=before+ACCESS_ENDS_BY_MS&&marker.until<=Date.now()+ACCESS_ENDS_BY_MS,`marker ${JSON.stringify(marker)} would be swept at the next drain`);
});

test('F2: the brokered federation dedupe cap evicts old markers instead of stalling the drain',async()=>{
 const host=federationHost(),future=Date.now()+3600000;
 for(let i=0;i<1024;i++)host.metadata.map.set('integrations/x8/federation/old-'+String(i).padStart(4,'0'),future+i);
 await assert.doesNotReject(fed(host,'src-new','grant-2'),'a full dedupe set refused the event');
 const markers=[...host.metadata.map.keys()].filter(k=>k.startsWith('integrations/x8/federation/'));
 assert.ok(markers.length<=1024);assert.ok(markers.includes('integrations/x8/federation/src-new'));assert.ok(!markers.includes('integrations/x8/federation/old-0000'),'the oldest marker is evicted');
 assert.deepEqual(await fed(host,'src-new','grant-2'),{duplicate:true});
});
