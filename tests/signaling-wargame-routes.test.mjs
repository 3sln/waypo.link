// Signaling wargame, route-level cases (ported from rtc-wargame.test.mjs for signaling rev 3.2; the engine-level cases
// stay with that file's owner). `POST /bindle/signaling` (packages/runtime/routes/signaling.mjs) over the federation
// world (tests/helpers/signaling-federation-fixture.mjs): H1 / AMD-RW2 (an element issued by this host is refused at
// the public endpoint, §9.2 step 1), and RTCw-R1 (§9.2 "Per-entity enablement": the addressed entity's own flags never
// change the answer, its timing class or the queue behaviour; a flag-off entity's batch is queued `dark`). Local
// behaviour only; hosts are reserved .example names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingWorld,A,B,identityURI,keyPair} from './helpers/signaling-federation-fixture.mjs';
import {buildBatch,BATCH_MEDIA_TYPE} from '../packages/signaling/messages.mjs';
import {signMessage} from '../packages/signaling/certificates.mjs';
import {BOUNDS} from '../packages/app/domains/signaling.mjs';
import {signalingEndpoint} from '../packages/runtime/routes/signaling.mjs';

const seconds=ms=>Math.floor(ms/1000),INVALID='{"error":"signaling_batch_invalid"}';
const PER_ENTITY=['SIGNALING_FOREIGN_ENABLED','SIGNALING_ENABLED','SESSION_KINDS_ENABLED'];
/** An account-scoped rule turning `flag` off for `offOwner` only, while every flag stays on site-wide. */
const accountOff=(env,offOwner,flag)=>{env.flags={for:ctx=>({version:1,evaluate:name=>({value:!(name===flag&&ctx?.subject?.owner===offOwner),reason:'rule'}),envState:()=>({state:'managed'}),global:()=>true})};};
const post=async(env,body)=>{const r=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body}),env,local:false});return [r.status,await r.text()];};
const cancel=({iss,sub,aud,sid,leg,iat})=>signMessage({bindle:'signaling-message',v:1,iss,sub,aud,sid,leg:leg.jkt,to:null,seq:1,iat,type:'cancel',body:{}},leg.privateKey);

test('H1 (route): POST /bindle/signaling refuses a batch with any element issued by this host (same-host traffic only via signalingPeer)',async()=>{
 const W=await signalingWorld();const P=W.provider(B),env=P.env,b=P.device(1);await b.register();
 const leg=await keyPair(),iat=seconds(W.clock.now()),sid=Buffer.from(Array(16).fill(5)).toString('base64url'),aud=identityURI(b.principal);
 const msg=(iss,sub)=>cancel({iss,sub,aud,sid,leg,iat});
 const foreignSub='0a0a0a0a-0001-4000-8000-000000000009';
 assert.deepEqual(await post(env,buildBatch({messages:[await msg(B,P.entity(2).sub)]})),[400,INVALID]);
 assert.deepEqual(await post(env,buildBatch({messages:[await msg(A,foreignSub)]})),[202,''],'a foreign issuer\'s element passes step 1');
 assert.deepEqual(await post(env,buildBatch({messages:[await msg(A,foreignSub),await msg(B,P.entity(2).sub)]})),[400,INVALID],'one same-host element refuses the batch');
 // Nothing from the refused batches reached the writer's inbound queue.
 assert.equal([...await b.entity.store.list({prefix:'sig/inq/'})].length,1,'only the foreign batch was queued');
});

for(const flag of PER_ENTITY)test(`R1 inverted: a stale-iat batch answers the same 400 for a flag-on and a ${flag}-off entity`,async()=>{
 const W=await signalingWorld();const env=W.provider(B).env;
 const b=W.provider(B).device(1);await b.register();const a=W.provider(A).device(1);await a.register();
 const leg=await keyPair(),now=W.clock.now(),sid=Buffer.from(Array(16).fill(7)).toString('base64url');
 const make=iat=>cancel({iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid,leg,iat});
 // iat one day in the past: fails step 1 (iatWithinWindow).
 const stale=buildBatch({messages:[await make(seconds(now)-86400)]}),fresh=buildBatch({messages:[await make(seconds(now))]});
 // The route runs step 1 itself: a step-1-invalid batch never reaches the writer.
 const accounts=env.ACCOUNTS;let calls=0;env.ACCOUNTS={get:id=>{const stub=accounts.get(id);return {invoke:args=>{calls++;return stub.invoke(args);}};}};
 const on=[await post(env,stale),await post(env,fresh)];
 accountOff(env,b.entity.sub,flag);const off=[await post(env,stale),await post(env,fresh)];delete env.flags;
 env.ACCOUNTS=accounts;assert.equal(calls,2,'only the two step-1-valid batches reached the writer');
 assert.deepEqual(on,[[400,INVALID],[202,'']]);
 assert.deepEqual(off,on,'the per-account flag is not observable');
 // The flag-off batch took a queue slot `dark` (its size only, no body) and is removed unprocessed.
 const queued=[...await b.entity.store.list({prefix:'sig/inq/'})].map(([,v])=>v);
 assert.equal(queued.length,2);assert.equal(queued.filter(r=>r.dark===true&&r.batch===undefined).length,1);
 await W.pump();assert.equal([...await b.entity.store.list({prefix:'sig/inq/'})].length,0);
});

for(const flag of PER_ENTITY)test(`R1: the inbound queue fills and answers 503 alike for flag-on and ${flag}-off entities`,async()=>{
 const W=await signalingWorld();const P=W.provider(B),env=P.env;
 const a=W.provider(A).device(1);await a.register();const leg=await keyPair(),sid=Buffer.from(Array(16).fill(8)).toString('base64url');
 const batchFor=async e=>buildBatch({messages:[await cancel({iss:A,sub:a.entity.sub,aud:identityURI(e.principal),sid,leg,iat:seconds(W.clock.now())})]});
 const fill=async e=>{const body=await batchFor(e),out=[];for(let i=0;i<=BOUNDS.inbox;i++)out.push((await post(env,body))[0]);return out;};
 // Nothing drains (the fixture's defer is a no-op and nothing pumps), so each queue fills at BOUNDS.inbox.
 const on=await fill(P.entity(1));accountOff(env,P.entity(2).sub,flag);const off=await fill(P.entity(2));delete env.flags;
 assert.deepEqual(off,on);assert.equal(on.at(-1),503);assert.equal(on.filter(x=>x===202).length,BOUNDS.inbox);
 const [r]=await Promise.all([post(env,await batchFor(P.entity(2)))]);assert.equal(r[0],503,'still full');
});
