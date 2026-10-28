// RTC service follow-ups for the RTC-g owner UI (DEVLOG 2026-10-27 "RTC service follow-ups for the owner UI"):
// the silent end of an unanswered incoming record (review F1, spec §12, §4.4), the read-time `alert` and the caller's
// app origin in the owner session view (review F2, spec §9.1, RTC-17), and the owner's interim approval of an app's RTC
// purposes (rtc.approve-app; extensions rev 3.2 removed AMD-X1, TODO(signaling Appendix C.2: approvals move to intents
// session handler approvals)) ending what is no longer approved. Engine level: dispatched ngin Actions and Queries on
// the loopback host (tests/helpers/rtc-fixture.mjs) and the two-provider world (tests/helpers/rtc-federation-fixture.mjs).
// Local behaviour only; .example hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rtcHost,CALL,SYNC,REF,ISS,APP,OTHER_APP,subOf,fault,payloadOf} from './helpers/rtc-fixture.mjs';
import {rtcWorld,A,B,OPS as WORLD_OPS,perform} from './helpers/rtc-federation-fixture.mjs';
import {sessionView,silentEndable} from '../packages/rtc/service.mjs';
import {approvalKey} from '../packages/rtc/approvals.mjs';

const rows=async(h,n,prefix)=>(await h.rows(n,prefix)).map(([,v])=>v);
const types=events=>events.map(e=>e.type==='state'?`state:${e.state}`:e.type==='message'?payloadOf(e.message).type:e.type);
/** A (entity `from`) rings B (entity `to`) through B's ticket; B's device hears the invite. */
async function ring(h,a,b,{uses=8}={}){
 const {link}=await b.run('rtc.mint-ticket',{purposes:[CALL],uses,expires_in:3600});
 const s=await a.open(h.principal(b.n),CALL,{basis:link});await a.invite(s);await h.pump();await b.listen();
 assert.ok(b.claims().some(e=>e.sid===s.sid),'the invite reached the callee device');return s;
}
const batchesTo=(h,n)=>h.log.batches.filter(x=>x.to===subOf(n)).length;

test('silent end: an unanswered incoming invite ends at the callee only; the caller sees exactly what an ignored invite shows',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2),b2=h.device(2,{grant:h.grant(2,{clientId:OTHER_APP+'/client',origin:OTHER_APP})});
 await a.register();await b.register();await b2.register();
 const declined=await ring(h,a,b),ignored=await ring(h,a,b);await b2.listen();
 await a.listen();const callerBefore=a.events.length,toCaller=batchesTo(h,1),missed=(await h.run(2,'rtc.missed')).missed.length;
 const out=await h.run(2,'rtc.end-session',{input:{sid:declined.sid,caller:h.principal(1),silent:true}});
 assert.deepEqual(out,{sid:declined.sid,state:'ended',silent:true});
 const rec=(await rows(h,2,'rtc/in/')).find(r=>r.sid===declined.sid);assert.deepEqual([rec.state,rec.endReason],['ended','declined']);
 // The owner's own devices stop ringing: every endpoint the invite reached is told `ended`, with no control statement.
 await b.listen();await b2.listen();
 for(const d of [b,b2]){const st=d.events.filter(e=>e.type==='state'&&e.sid===declined.sid);assert.deepEqual(st.map(e=>e.state),['ended']);assert.equal(st[0].control,undefined);}
 // Nothing for the caller's provider: no outbox row, no batch, not listed as missed.
 assert.deepEqual(await rows(h,2,'rtc/outbox/'),[]);await h.pump();assert.equal(batchesTo(h,1),toCaller,'no batch went to the caller');
 assert.equal((await h.run(2,'rtc.missed')).missed.length,missed,'a declined invite is not missed');
 await a.listen();assert.equal(a.events.length,callerBefore,'the caller learns nothing');
 assert.deepEqual((await h.run(1,'rtc.sessions')).sessions.filter(s=>s.role==='caller').map(s=>s.state),['ringing','ringing'],'both calls still ring at the caller');
 // Both ring out alike at ring_until: the declined one and the one nobody touched (spec §12: no presence oracle).
 h.clock.advance(61000);await h.tickAll();await h.pump();await a.listen();
 const forSid=sid=>types(a.events.filter(e=>e.sid===sid));assert.deepEqual(forSid(declined.sid),forSid(ignored.sid));
 const outs=await rows(h,1,'rtc/out/');assert.deepEqual(outs.map(r=>[r.state,r.endReason]),[['ended','timeout'],['ended','timeout']]);
 assert.equal(batchesTo(h,1),toCaller,'still nothing from the callee provider after the ring-out');
 // Only the untouched invite is a missed call.
 assert.equal((await h.run(2,'rtc.missed')).missed.length,missed+1);
});

test('silent end matrix: an older body is forced silent; held requests; claimed, declined, outgoing and ended records refuse silent',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 // An end-session without `silent` for an unanswered incoming record is the same silent end (the engine enforces it).
 const older=await ring(h,a,b);const toCaller=batchesTo(h,1);
 assert.deepEqual(await h.run(2,'rtc.end-session',{input:{sid:older.sid,caller:h.principal(1)}}),{sid:older.sid,state:'ended',silent:true});
 await h.pump();assert.equal(batchesTo(h,1),toCaller,'no revoked control for an unanswered invite');
 // A held request (the `none` basis): ends silently, never delivered, the admission's `held` entry is all the list has.
 await h.run(2,'rtc.set-policy',{input:{requests:[CALL]}});const req=await a.open(h.principal(2),CALL);await a.invite(req);await h.pump();
 const held=(await rows(h,2,'rtc/in/')).find(r=>r.sid===req.sid);assert.equal(held.held,true);const listed=(await h.run(2,'rtc.missed')).missed.length;
 assert.equal((await h.run(2,'rtc.end-session',{input:{sid:req.sid,caller:h.principal(1),silent:true}})).state,'ended');
 assert.equal((await h.run(2,'rtc.missed')).missed.length,listed);await h.pump();assert.equal(batchesTo(h,1),toCaller);
 // Malformed: `silent` must be true and name the caller.
 for(const input of [{sid:req.sid,caller:h.principal(1),silent:false},{sid:req.sid,caller:h.principal(1),silent:'true'},{sid:req.sid,silent:true}])assert.equal((await fault(h.run(2,'rtc.end-session',{input})))?.code,'invalid_args',JSON.stringify(input));
 // Already ended: refused, nothing changes.
 assert.equal((await fault(h.run(2,'rtc.end-session',{input:{sid:older.sid,caller:h.principal(1),silent:true}})))?.code,'invalid_args');
 // Claimed (answered): `silent` never ends it; the session stays connected. Without `silent` it ends with `revoked`.
 const answered=await ring(h,a,b);const c=await b.claim(answered.sid);await b.accept(c);await h.pump();
 assert.equal((await fault(h.run(2,'rtc.end-session',{input:{sid:answered.sid,caller:h.principal(1),silent:true}})))?.code,'invalid_args');
 assert.equal((await rows(h,2,'rtc/in/')).find(r=>r.sid===answered.sid).state,'connected');
 const before=batchesTo(h,1);assert.deepEqual(await h.run(2,'rtc.end-session',{input:{sid:answered.sid,caller:h.principal(1)}}),{sid:answered.sid,state:'ended'});
 await h.pump();assert.ok(batchesTo(h,1)>before,'an answered call is ended with a control statement');
 await a.listen();assert.equal(a.events.filter(e=>e.sid===answered.sid&&e.type==='state').at(-1).state,'ended');
 // Declined by a device (a claim with outcome decline): ended, so `silent` is refused.
 const dec=await ring(h,a,b);await b.claim(dec.sid,'decline');
 assert.equal((await fault(h.run(2,'rtc.end-session',{input:{sid:dec.sid,caller:h.principal(1),silent:true}})))?.code,'invalid_args');
 // An outgoing record is not an incoming one: `silent` needs `caller`, which names only incoming records.
 const outgoing=await ring(h,a,b);assert.equal((await fault(h.run(1,'rtc.end-session',{input:{sid:outgoing.sid,silent:true}})))?.code,'invalid_args');
 assert.equal((await fault(h.run(1,'rtc.end-session',{input:{sid:outgoing.sid,caller:h.principal(2),silent:true}})))?.code,'not_found');
 assert.equal((await fault(h.run(2,'rtc.end-session',{input:{sid:'z'.repeat(22),caller:h.principal(1),silent:true}})))?.code,'not_found','an unknown record');
 // The predicate.
 assert.equal(silentEndable({role:'callee',state:'ringing',claim:null}),true);
 for(const r of [{role:'caller',state:'ringing'},{role:'callee',state:'connected',claim:{}},{role:'callee',state:'ringing',claim:{outcome:'accept'}},{role:'callee',state:'ended'}])assert.equal(silentEndable(r),false,JSON.stringify(r));
});

test('silent end of an own-entity invite ends its twin the same way: no control, no missed entry, only own devices told',async()=>{
 const h=await rtcHost();const d1=h.device(1),d2=h.device(1,{grant:h.grant(1,{clientId:OTHER_APP+'/client',origin:OTHER_APP})});await d1.register();await d2.register();
 const s=await d1.open(h.principal(1),CALL);await d1.invite(s);await h.pump();await d2.listen();assert.ok(d2.claims().some(e=>e.sid===s.sid));
 const missed=(await h.run(1,'rtc.missed')).missed.length;
 assert.deepEqual(await h.run(1,'rtc.end-session',{input:{sid:s.sid,caller:h.principal(1),silent:true}}),{sid:s.sid,state:'ended',silent:true});
 const both=[...await rows(h,1,'rtc/in/'),...await rows(h,1,'rtc/out/')].filter(r=>r.sid===s.sid);
 assert.deepEqual(both.map(r=>[r.role,r.state,r.endReason]).sort(),[['callee','ended','declined'],['caller','ended','declined']]);
 assert.deepEqual(await rows(h,1,'rtc/outbox/'),[]);assert.equal((await h.run(1,'rtc.missed')).missed.length,missed);
 await d1.listen();await d2.listen();for(const d of [d1,d2])assert.deepEqual(d.events.filter(e=>e.type==='state'&&e.sid===s.sid).map(e=>[e.state,e.control]),[['ended',undefined]],'the owner\'s own devices stop ringing');
});

test('silent end with a caller on another provider: nothing is posted to the caller provider; its session rings out',async()=>{
 const W=await rtcWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const link=await b.mintTicket({uses:2});const s=await a.open(b.principal,CALL,{basis:link});await a.invite(s);await W.pump();
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite');i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===s.sid));
 const postsToA=()=>W.posts.filter(p=>p.to===A).length,before=postsToA();
 const out=await perform(b.entity.engine,new WORLD_OPS['rtc.end-session']({actor:{kind:'owner',owner:b.entity.sub},input:{sid:s.sid,caller:a.principal,silent:true}}));
 assert.deepEqual(out,{sid:s.sid,state:'ended',silent:true});
 await b.listen();assert.equal(b.events.filter(e=>e.type==='state'&&e.sid===s.sid).at(-1).state,'ended');
 await W.pump();await a.listen();const seen=a.events.length;
 assert.equal(postsToA(),before,'no batch to the caller provider');
 // The caller's re-sent invite copies are ignored (the session exists), and it rings out at ring_until.
 for(let i=0;i<8;i++){W.clock.advance(9000);await W.tickAll();await W.pump();}
 assert.equal(postsToA(),before,'still nothing to the caller provider');
 const callerRec=[...await a.entity.store.list({prefix:'rtc/out/'})].map(([,v])=>v).find(r=>r.sid===s.sid);assert.deepEqual([callerRec.state,callerRec.endReason],['ended','timeout']);
 await a.listen();assert.deepEqual(types(a.events.slice(seen)),['state:expired'],'the caller sees only its own ring-out');
});

test('alert in the owner view: re-evaluated on every read against principal, purpose and caller-app mutes; never turned on',async()=>{
 const h=await rtcHost();const a=h.device(1),b=h.device(2);await a.register();await b.register();
 const s=await ring(h,a,b),view=async()=>(await h.run(2,'rtc.sessions')).sessions.find(x=>x.sid===s.sid);
 assert.equal((await view()).alert,true);
 for(const [kind,value] of [['app',APP+'/client'],['principal',h.principal(1)],['purpose',CALL]]){
  await h.run(2,'rtc.mute',{input:{kind,value}});assert.equal((await view()).alert,false,`muted by ${kind} while it rings`);
  await h.run(2,'rtc.unmute',{input:{kind,value}});assert.equal((await view()).alert,true,`unmuted ${kind}`);
 }
 // A mute of ANOTHER app (the callee's own, or an unrelated one) does not silence this caller's app.
 await h.run(2,'rtc.mute',{input:{kind:'app',value:OTHER_APP+'/client'}});assert.equal((await view()).alert,true);
 // An invite admitted while muted never alerts, even after the mute is lifted (admission decided `alert: false`).
 await h.run(2,'rtc.mute',{input:{kind:'app',value:APP+'/client'}});const quiet=await ring(h,a,b);await h.run(2,'rtc.unmute',{input:{kind:'app',value:APP+'/client'}});
 assert.equal((await h.run(2,'rtc.sessions')).sessions.find(x=>x.sid===quiet.sid).alert,false);
 // Held requests never alert; outgoing records carry no `alert`.
 await h.run(2,'rtc.set-policy',{input:{requests:[CALL]}});const req=await a.open(h.principal(2),CALL);await a.invite(req);await h.pump();
 assert.equal((await h.run(2,'rtc.sessions')).sessions.find(x=>x.sid===req.sid).alert,false);
 for(const x of (await h.run(1,'rtc.sessions')).sessions){assert.equal(x.role,'caller');assert.equal(Object.hasOwn(x,'alert'),false);assert.equal(Object.hasOwn(x,'callerOrigin'),false);}
 // Every incoming record carries a boolean `alert` (gate G1).
 for(const x of (await h.run(2,'rtc.sessions')).sessions)assert.equal(typeof x.alert,'boolean');
});

test('caller app origin in the owner view: the verified certificate client origin, incoming records only, nothing else',async()=>{
 const h=await rtcHost();const a=h.device(1,{grant:h.grant(1,{clientId:OTHER_APP+'/client',origin:OTHER_APP})}),b=h.device(2);await a.register();await b.register();
 const s=await ring(h,a,b),x=(await h.run(2,'rtc.sessions')).sessions.find(v=>v.sid===s.sid);
 assert.equal(x.callerOrigin,OTHER_APP);assert.equal(b.claims().find(e=>e.sid===s.sid).projection.origin,OTHER_APP,'the same value the callee app already sees (§9.1)');
 assert.deepEqual(Object.keys(x).sort(),['alert','callerOrigin','claimed','createdAt','endsAt','held','media','own','peer','purpose','ringUntil','role','sid','state']);
 const text=JSON.stringify(await h.run(2,'rtc.sessions'));for(const forbidden of ['certificate','client_id','delegate','invite','link','jkt'])assert.equal(text.includes(forbidden),false,forbidden);
 // A record admitted before the field existed: read from the held certificate. A record without either: null.
 const rec=(await rows(h,2,'rtc/in/')).find(r=>r.sid===s.sid);const {callerClient,...older}=rec;
 assert.deepEqual(callerClient,{client_id:OTHER_APP+'/client',origin:OTHER_APP});
 assert.equal(sessionView(older).callerOrigin,null,'the pure view never parses');
 assert.equal(sessionView(rec).callerOrigin,OTHER_APP);
 const store=h.account(2).store;
 const key=(await h.rows(2,'rtc/in/')).find(([,v])=>v.sid===s.sid)[0];await store.put(key,older);
 const again=(await h.run(2,'rtc.sessions')).sessions.find(v=>v.sid===s.sid);assert.deepEqual([again.callerOrigin,again.alert],[OTHER_APP,true],'older record: from the held certificate');
 await store.put(key,{...older,theirs:{...older.theirs,certificate:'not-a-certificate'}});
 const broken=(await h.run(2,'rtc.sessions')).sessions.find(v=>v.sid===s.sid);assert.deepEqual([broken.callerOrigin,broken.alert],[null,false],'unknown caller app: no origin, and no ring (the app mute cannot be checked)');
});

test('owner approval of an app\'s purposes (interim): widening needs the flag, narrowing ends the removed purposes\' sessions and registrations at once',async()=>{
 const h=await rtcHost();const owner=h.owner(2),client=APP+'/client';
 const approve=purposes=>h.run(2,'rtc.approve-app',{actor:owner,input:{clientId:client,purposes}});
 const approvals=async()=>(await h.run(2,'rtc.approvals',{actor:owner})).approvals;
 // A grant the fixture does not mirror: only the owner's own approvals decide (no host.grants entry for entity 2).
 const a=h.device(1),b=h.device(2,{grant:{id:'g-owner-approved',clientId:client,origin:APP}});await a.register();
 assert.equal((await fault(b.run('rtc.register',{purposes:[CALL]})))?.code,'forbidden','nothing approved yet');
 assert.deepEqual(await approve([SYNC,CALL]),{clientId:client,purposes:[CALL,SYNC].sort(),ended:0});
 assert.deepEqual((await approvals()).map(x=>[x.clientId,x.purposes]),[[client,[CALL,SYNC].sort()]]);
 const record=(await h.rows(2,'rtc/approval/'))[0];assert.equal(record[0],await approvalKey(crypto,client));
 assert.deepEqual(record[1].versions[CALL],{version:REF[CALL].version,digest:REF[CALL].digest},'pinned to the provider-held reference');
 await b.register([CALL,SYNC]);
 const callSession=await ring(h,a,b);const c=await b.claim(callSession.sid);await b.accept(c);await h.pump();
 assert.equal((await h.run(2,'rtc.sessions')).sessions.find(x=>x.sid===callSession.sid).state,'connected');
 // Narrowing to SYNC only: CALL's connected session ends (control `revoked` to the caller), the endpoint keeps SYNC.
 const before=batchesTo(h,1);
 assert.deepEqual(await approve([SYNC]),{clientId:client,purposes:[SYNC],ended:1});
 assert.equal((await h.run(2,'rtc.sessions')).sessions.some(x=>x.sid===callSession.sid),false,'the session for the removed purpose ended');
 assert.deepEqual((await h.run(2,'rtc.endpoint-list')).endpoints.map(e=>e.purposes),[[SYNC]]);
 await h.pump();assert.ok(batchesTo(h,1)>before,'the caller is told with a control statement (an answered call)');
 await a.listen();assert.equal(a.events.filter(e=>e.sid===callSession.sid&&e.type==='state').at(-1).state,'ended');
 assert.equal((await fault(b.run('rtc.register',{purposes:[CALL]})))?.code,'forbidden');
 // Widening back is an owner approval (the flag on); with the flag off it is the uniform not_found, narrowing is not.
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');
 assert.equal((await fault(approve([CALL,SYNC])))?.code,'not_found');
 h.flags.allow(subOf(2),'RTC_SIGNALING_ENABLED');
 assert.deepEqual((await approve([CALL,SYNC])).purposes,[CALL,SYNC].sort());assert.ok((await b.run('rtc.register',{purposes:[CALL]})).endpoint);
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');
 assert.deepEqual(await approve([]),{clientId:client,purposes:[],ended:0},'narrowing to nothing stays available while off');
 assert.deepEqual(await approvals(),[],'the record is gone');assert.deepEqual((await h.run(2,'rtc.endpoint-list')).endpoints,[],'and every registration of the app');
 h.flags.allow(subOf(2),'RTC_SIGNALING_ENABLED');
 // Exact input; only purposes this host holds; no duplicates; never as the app.
 for(const input of [{clientId:client,purposes:['https://unknown.example/purpose']},{clientId:client,purposes:[CALL,CALL]},{clientId:client},{clientId:'',purposes:[]},{clientId:client,purposes:[],extra:1}])
  assert.equal((await fault(h.run(2,'rtc.approve-app',{actor:owner,input})))?.code,'invalid_args',JSON.stringify(input));
 assert.ok(await fault(h.run(2,'rtc.approve-app',{actor:b.actor,input:{clientId:client,purposes:[CALL]}})),'an app never approves itself');
 // The grant hook (FederationService grantChanged -> rtcAppChanged purposes:null -> rtc.lifecycle app-revoked) deletes it.
 await approve([CALL]);await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'app-revoked',clientId:client}});
 assert.deepEqual(await approvals(),[]);assert.equal((await fault(b.run('rtc.register',{purposes:[CALL]})))?.code,'forbidden');
 // app-narrowed keeps the intersection only.
 await approve([CALL,SYNC]);await h.run(2,'rtc.lifecycle',{actor:h.system(2),input:{event:'app-narrowed',clientId:client,purposes:[SYNC]}});
 assert.deepEqual((await approvals()).map(x=>x.purposes),[[SYNC]]);
 // A record pinned to another version (or of the older change-log shape) approves nothing (fail closed).
 const key=await approvalKey(crypto,client),store=h.account(2).store;
 await store.put(key,{...(await store.get(key)),versions:{[SYNC]:{version:REF[SYNC].version,digest:'x'.repeat(43)}}});
 assert.equal((await fault(b.run('rtc.register',{purposes:[SYNC]})))?.code,'forbidden','a re-pinned purpose needs a new approval');
 assert.deepEqual((await approvals()).map(x=>x.purposes),[[]],'and is not shown as approved');
 await store.put(key,{clientId:client,purposes:[SYNC],revision:1,at:1});
 assert.equal((await fault(b.run('rtc.register',{purposes:[SYNC]})))?.code,'forbidden','the older record shape approves nothing');
});

test('AMD-X1 removed: no bound narrowing or bound check on the federation remote facade or the Worker allowlist',async()=>{
 const {federationRemote}=await import('../packages/federation/runtime.mjs'),{readFile}=await import('node:fs/promises');
 const remote=federationRemote({invoke:async()=>({ok:true,result:null})});
 for(const name of ['narrowBoundOptions','checkBound'])assert.equal(Object.hasOwn(remote,name),false,name);
 const source=await readFile(new URL('../apps/worker/federation.mjs',import.meta.url),'utf8'),allowed=JSON.parse(/const METHODS=(\[[^\]]*\])/.exec(source)[1].replaceAll("'",'"'));
 assert.deepEqual([...allowed].sort(),Object.keys(remote).sort());assert.ok(!allowed.includes('narrowBoundOptions')&&!allowed.includes('checkBound'));
});
