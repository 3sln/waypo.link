import test from 'node:test';
import assert from 'node:assert/strict';
import {AppConnections} from '../packages/apps/connections.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {connectionsProvider,SeverAccountConnections,DisconnectConnection} from '../packages/app/domains/connections.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {enqueueIntegrationEvent,integrationEventsProvider,DeliverIntegrationEvents,IntegrationEventStatus} from '../packages/runtime/integration-events.mjs';
const ids={live:'11111111-1111-4111-8111-111111111111',paused:'22222222-2222-4222-8222-222222222222',removed:'33333333-3333-4333-8333-333333333333',invalid:'44444444-4444-4444-8444-444444444444'};
const issuer='https://issuer.example',actor={kind:'system',owner:OWNER};
async function world(t){
 const clock=fakeClock(1800000000000),sent=[],h=await createTestEngine({clock});t.after(()=>h.dispose());await h.metadata.put('owner',OWNER);
 const row=id=>({id:ids[id],owner:OWNER,kind:'app-connection',provider:'app',clientId:`https://${id}.example/client.json`,state:'active',status:'active',generation:1,integration:{kind:'external',snapshot:{manifest:{events_endpoint:`https://${id}.example/events`}}}});
 for(const id of ['live','paused','removed','invalid']){const r=row(id);if(id==='invalid'){r.state='manifest-invalid';r.status='suspended';}await h.metadata.put('resource/'+ids[id],r);}
 const connections=new AppConnections({metadata:h.metadata,origin:issuer,clock:clock.now,subjectDeleted:async(tx,r,now)=>{await enqueueIntegrationEvent(tx,{type:'subject-deleted',connection:r.id,generation:r.generation,notBefore:now+360000},{now});return true;}});
 const random={uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit=memoryAudit({clock}),engine=createAppEngine({providers:{accountStore:h.metadata,clock,random,audit,connections:connectionsProvider({connections,enabled:true}),integrationEvents:integrationEventsProvider({enabled:true,store:h.metadata,issuer,signer:{sign:async(_purpose,claims)=>({kid:'event.test',message:new TextEncoder().encode(JSON.stringify({...claims,cti:[...claims.cti]}))})},egress:{send:async request=>{sent.push(JSON.parse(new TextDecoder().decode(request.body)));return {status:202};}},connections:()=>({list:()=>connections.list(OWNER)})})}});t.after(()=>engine.dispose());
 const sever=reason=>perform(engine,new SeverAccountConnections({actor,input:{reason}})),status=()=>read(engine,new IntegrationEventStatus({actor}));
 return {clock,h,connections,engine,sent,sever,status};
}
test('AU-S5 deletion includes earlier account severance, excludes removed and manifest-invalid, and repeats once',async t=>{
 const w=await world(t);await perform(w.engine,new DisconnectConnection({actor:{kind:'owner',owner:OWNER},input:{connection:ids.removed}}));await w.sever('suspended');assert.equal((await w.status()).pending.length,0);await w.sever('deleted');await w.sever('deleted');
 assert.deepEqual((await w.status()).pending.map(r=>r.connection).sort(),[ids.live,ids.paused]);
 await perform(w.engine,new DeliverIntegrationEvents({actor}));assert.equal(w.sent.length,0);w.clock.advance(360000);await perform(w.engine,new DeliverIntegrationEvents({actor}));assert.equal(w.sent.length,2);assert.ok(w.sent.every(c=>Object.keys(c.events)[0].endsWith('/subject-deleted/v1')));
});
test('AU-S5 a nondeletion portability severance never emits subject-deleted',async t=>{const w=await world(t);await w.sever('system');assert.equal((await w.status()).pending.length,0);});
test('AU-S5 subject-deleted survives coalescing and a full row budget',async t=>{
 const w=await world(t),tx=w.h.metadata,now=w.clock.now();await tx.transaction(async tx=>{
  await enqueueIntegrationEvent(tx,{type:'subject-deleted',connection:'live',generation:1,notBefore:now+360000},{now,limits:{rows:0,perConnection:0}});
  await enqueueIntegrationEvent(tx,{type:'subject-deleted',connection:'live',generation:1,notBefore:now+360000},{now,limits:{rows:0,perConnection:0}});
  await enqueueIntegrationEvent(tx,{type:'connection-revoked',connection:'live',floor:2,terminal:true},{now});
  await enqueueIntegrationEvent(tx,{type:'connection-revoked',connection:'live',floor:3,terminal:true},{now});
 });assert.equal((await w.status()).pending.filter(r=>r.type==='subject-deleted').length,1);
});

test('AU-S5 controller gates enqueue, forces pending removals even flag off, and preserves enqueued delivery across flag changes',async t=>{
 const {AccountController}=await import('../packages/runtime/accounts.mjs'),{SqliteMetadata,SerialGate}=await import('../apps/node/resources.mjs');
 for(const enabled of [false,true]){const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const bucket={put:async()=>{},get:async()=>null,delete:async()=>{}},config={APP_ORIGIN:issuer,KEY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),INTEGRATIONS_ENABLED:'true',SUBJECT_DELETED_EVENTS_ENABLED:enabled?'true':'false'},a=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await a.touch(OWNER);
 await db.put('resource/'+ids.live,{id:ids.live,owner:OWNER,kind:'app-connection',provider:'app',clientId:'https://live.example/client.json',state:'active',status:'active',generation:1,integration:{kind:'external',snapshot:{manifest:{events_endpoint:'https://live.example/events'}}}});
 await db.put('app-removal/record/pending',{entity:OWNER,client_id:'https://live.example/client.json',state:'pending'});await db.put('app-removal/open/'+encodeURIComponent('https://live.example/client.json'),'pending');
 await a.connectionsSeverAccount(OWNER,{reason:'deleted'});assert.equal((await db.get('app-removal/record/pending')).state,'forced');assert.equal(await db.get('app-removal/open/'+encodeURIComponent('https://live.example/client.json')),undefined);
 const rows=[...(await db.list({prefix:'integration-events/row/'})).values()].filter(r=>r.type==='subject-deleted');assert.equal(rows.length,enabled?1:0);if(enabled){config.SUBJECT_DELETED_EVENTS_ENABLED='false';await a.connectionsSeverAccount(OWNER,{reason:'deleted'});assert.equal([...(await db.list({prefix:'integration-events/row/'})).values()].filter(r=>r.type==='subject-deleted').length,1);}
 }
});

test('AU-S5 seeded owner removal versus deletion has one linearized recipient set and no duplicate signal',async t=>{
 const {forEachSeed,createScheduler}=await import('./helpers/chaos.mjs');await forEachSeed(24,async random=>{const w=await world(t),order=[],scheduler=createScheduler(random),calls=scheduler.wrap({remove:async()=>{order.push('remove');return perform(w.engine,new DisconnectConnection({actor:{kind:'owner',owner:OWNER},input:{connection:ids.live}}));},deleted:async()=>{order.push('deleted');return w.sever('deleted');}});
 const results=await scheduler.run([()=>calls.remove(),()=>calls.deleted()]);assert.ok(results.every(r=>r.status==='fulfilled'));await w.sever('deleted');const rows=(await w.status()).pending.filter(r=>r.connection===ids.live&&r.type==='subject-deleted');assert.equal(rows.length,order[0]==='deleted'?1:0);
 });
});
