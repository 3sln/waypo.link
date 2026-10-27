// RTC wargame M2 (ticket lifecycle) and M6 (spam-control evasion), engine level through the real ngin engines, account
// stores and same-host transport (tests/helpers/rtc-fixture.mjs), plus the two-provider world for provider-level blocks
// (tests/helpers/rtc-federation-fixture.mjs). Provisional rules (DEVLOG 2026-10-27 "RTC wargame M2/M6"), unsigned:
// - M2: a ticket records the app that minted it; an app holds at most 64 live tickets of the account's 256; removing an
//   app revokes its tickets, narrowing it revokes the tickets naming a removed purpose, deletion revokes all; legacy
//   tickets without an app stay live, are listed as an unknown app and revocable in bulk; owner bulk revocation.
// - M6: an owner blocks or mutes a whole caller provider and mutes a calling app by origin; a blocked provider's invites
//   drop exactly like a blocked principal's (no oracle); this host's own issuer and the owner's own principal can never
//   be blocked, and own-device sessions survive any stored block or mute; provider blocks are bounded (256).
// The read-only wargame's W3 PoC (ticket survives its app; cap squatting) is ported here inverted: it must now fail.
// Local behaviour only: no real federation service, push or relay; hosts under reserved .example names (AGENTS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {rtcHost,CALL,SCREEN,SYNC,ISS,APP,OTHER_APP,DAY,subOf,payloadOf,rejects} from './helpers/rtc-fixture.mjs';
import {rtcWorld,A,B,C,OPS as WOPS,perform,read} from './helpers/rtc-federation-fixture.mjs';
import {AppQuery} from '../packages/app/engine.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {TICKET_APP_QUOTA,TICKET_PREFIX,ticketRevokeTarget,ticketClient} from '../packages/rtc/tickets.mjs';
import {ISSUER_BLOCKS_MAX,K} from '../packages/rtc/admission.mjs';
import {ringable,callerProvider} from '../packages/runtime/routes/rtc-owner.mjs';

const jtiOf=link=>payloadOf(new URL(link).searchParams.get('bindle_meta')).jti;
const appDevice=(h,n,clientId,purposes=[CALL,SCREEN])=>h.device(n,{grant:h.grant(n,{clientId:clientId+'/client',origin:clientId,purposes}),purposes});
const mint=(d,{purposes=[CALL],uses=1000,expires_in=30*86400}={})=>d.run('rtc.mint-ticket',{purposes,uses,expires_in}).then(r=>r.link);
const tickets=async(h,n=2)=>(await h.run(n,'rtc.tickets')).tickets;
const lifecycle=(h,n,input)=>h.run(n,'rtc.lifecycle',{actor:h.system(n),input});
/** One ticket-basis invite from `caller` to entity `to`; returns whether `listener` got it (and its projection). */
async function ring(h,caller,to,link,{listener,purpose=CALL}={}){
 const s=await caller.open(h.principal(to),purpose,{media:['audio'],basis:link});await caller.invite(s);await h.pump();await listener.listen();
 return listener.claims().find(e=>e.sid===s.sid)??null;
}

test('W3 inverted: tickets die with the app that minted them, and one app cannot squat the cap',async()=>{
 const h=await rtcHost();
 const evil=h.device(2);await evil.register();
 const good=appDevice(h,2,OTHER_APP,[CALL]);await good.register([CALL]);
 // The malicious app mints up to its own quota only (64 of 256), then answers rate_limited...
 const links=[];for(let i=0;i<TICKET_APP_QUOTA;i++)links.push(await mint(evil));
 await rejects(mint(evil),'rate_limited','the 65th ticket of one app');
 // ...while every other app keeps minting, and keeps its callback tickets.
 const goodLink=await mint(good,{uses:5,expires_in:600});
 const callee=h.device(3);await callee.register();
 const cb=await good.open(h.principal(3),CALL,{media:['audio'],callback:true});assert.ok(cb.result.callback,'open{callback} still mints');
 // The view names the minting app (never the link).
 let view=await tickets(h);
 assert.equal(view.filter(t=>t.clientId===evil.grantInfo.clientId&&t.live).length,TICKET_APP_QUOTA);
 assert.ok(view.every(t=>!('link' in t)&&!('meta' in t)),'never the bearer link');
 assert.deepEqual(view.find(t=>t.clientId===good.grantInfo.clientId).origin,OTHER_APP);
 // The owner removes the app (grant inactive + lifecycle app-revoked, as the boundSync hook does).
 h.grants.get(evil.grantInfo.id).active=false;
 await lifecycle(h,2,{event:'app-revoked',clientId:evil.grantInfo.clientId});
 view=await tickets(h);
 assert.equal(view.filter(t=>t.clientId===evil.grantInfo.clientId&&t.live).length,0,'no ticket of the removed app is live');
 assert.ok(view.filter(t=>t.clientId===evil.grantInfo.clientId).every(t=>t.revoked),'revoked, and still listed until pruned');
 assert.ok(view.find(t=>t.clientId===good.grantInfo.clientId&&!t.callback).live,'other apps\' tickets are untouched');
 // A spammer holding a leaked ticket rings nobody; the good app's own ticket still works.
 const spam=h.device(1);await spam.register();
 assert.equal(await ring(h,spam,2,links[17],{listener:good}),null,'a leaked ticket of a removed app admits nothing');
 assert.equal(await ring(h,spam,2,links[63],{listener:good}),null);
 const ok=await ring(h,spam,2,goodLink,{listener:good});assert.ok(ok,'a live ticket of an approved app still rings');assert.equal(ok.projection.alert,true);
 assert.equal((await h.run(2,'rtc.missed')).missed.length,0,'dropped invites are never listed as missed');
});

test('M2 quota: 64 live tickets per app within the account cap of 256; callbacks count; revoked and expired ones free the quota',async()=>{
 const h=await rtcHost();
 const apps=[0,1,2,3,4].map(i=>appDevice(h,2,`https://app${i}.example`));
 for(const d of apps.slice(0,4))for(let i=0;i<TICKET_APP_QUOTA;i++)await mint(d,{uses:1,expires_in:3600});
 // Documented residual: four approved apps together still fill the account cap.
 await rejects(mint(apps[4]),'rate_limited','the account cap still holds');
 await h.run(2,'rtc.revoke-ticket',{input:{clientId:apps[0].grantInfo.clientId}});
 assert.ok(await mint(apps[4]),'revoking one app\'s tickets frees the cap for another');
 // A callback ticket is minted by the calling app and counts against its quota.
 const c=appDevice(h,1,'https://caller.example');await c.register([CALL]);
 for(let i=0;i<TICKET_APP_QUOTA;i++)await mint(c,{uses:1,expires_in:3600});
 await rejects(c.open(h.principal(3),CALL,{media:['audio'],callback:true}),'rate_limited','open{callback} over the app quota');
 const d=h.device(1,{purposes:[CALL]});await d.register([CALL]);
 const s=await d.open(h.principal(3),CALL,{media:['audio'],callback:true});assert.ok(s.result.callback,'another app\'s callback is unaffected');
 assert.equal((await tickets(h,1)).find(t=>t.callback).clientId,d.grantInfo.clientId,'the callback ticket names its app');
 // Expiry frees the quota too.
 h.clock.advance(3601*1000);assert.ok(await mint(c),'expired tickets no longer count');
});

test('M2 narrowing revokes exactly the tickets naming a removed purpose; deletion revokes every ticket',async()=>{
 const h=await rtcHost();
 const x=appDevice(h,2,'https://x.example'),y=appDevice(h,2,'https://y.example');
 const xc=jtiOf(await mint(x,{purposes:[CALL]})),xs=jtiOf(await mint(x,{purposes:[SCREEN]})),xb=jtiOf(await mint(x,{purposes:[CALL,SCREEN]})),ys=jtiOf(await mint(y,{purposes:[SCREEN]}));
 h.grants.get(x.grantInfo.id).purposes=[CALL];
 await lifecycle(h,2,{event:'app-narrowed',clientId:x.grantInfo.clientId,purposes:[CALL]});
 const live=new Map((await tickets(h)).map(t=>[t.jti,t.live]));
 assert.deepEqual([live.get(xc),live.get(xs),live.get(xb),live.get(ys)],[true,false,false,true],'only x\'s tickets naming screen sharing; y keeps its own');
 await lifecycle(h,2,{event:'app-narrowed',clientId:x.grantInfo.clientId,purposes:[CALL]});
 assert.equal((await tickets(h)).filter(t=>t.live).length,2,'idempotent');
 await lifecycle(h,2,{event:'deletion'});
 assert.equal((await tickets(h)).filter(t=>t.live).length,0,'deletion revokes everything');
});

test('M2 legacy tickets: attributed to no app, never revoked by an app event, listed as unknown and revocable in bulk',async()=>{
 const h=await rtcHost();
 const x=h.device(2),spam=h.device(1),listener=appDevice(h,2,'https://listen.example',[CALL]);await spam.register();await listener.register([CALL]);
 const legacyLink=await mint(x,{uses:5}),legacy=jtiOf(legacyLink);
 // Simulate a record minted before clientId was recorded.
 const store=h.account(2).store,row=await store.get(TICKET_PREFIX+legacy);delete row.clientId;delete row.origin;await store.put(TICKET_PREFIX+legacy,row);
 assert.equal(ticketClient(row),null);
 let t=(await tickets(h)).find(v=>v.jti===legacy);assert.equal(t.clientId,null);assert.equal(t.origin,null);assert.equal(t.live,true);
 // It counts against no app's quota.
 for(let i=0;i<TICKET_APP_QUOTA-1;i++)await mint(x,{uses:1,expires_in:600});
 assert.ok(await mint(x,{uses:1,expires_in:600}),'the legacy ticket is not charged to the app that happens to share its owner');
 h.grants.get(x.grantInfo.id).active=false;await lifecycle(h,2,{event:'app-revoked',clientId:x.grantInfo.clientId});
 t=(await tickets(h)).find(v=>v.jti===legacy);assert.equal(t.live,true,'no app event can attribute it');
 assert.ok(await ring(h,spam,2,legacyLink,{listener}),'still admits until revoked or expired (at most 30 days)');
 assert.deepEqual(await h.run(2,'rtc.revoke-ticket',{input:{clientId:null}}),{revoked:true,count:1});
 assert.equal((await tickets(h)).find(v=>v.jti===legacy).live,false);
 assert.equal(await ring(h,spam,2,legacyLink,{listener}),null);
});

test('M2 owner revocation: one, per app and all; strict targets; never gated by any flag',async()=>{
 const h=await rtcHost();
 const x=appDevice(h,2,'https://x.example'),y=appDevice(h,2,'https://y.example');
 for(let i=0;i<3;i++){await mint(x,{uses:1,expires_in:600});await mint(y,{uses:1,expires_in:600});}
 for(const input of [{},{jti:'x',all:true},{clientId:''},{clientId:7},{all:false},{all:'yes'},{jti:'bad jti'},{clientId:'x'.repeat(2049)},{principal:null}])await rejects(h.run(2,'rtc.revoke-ticket',{input}),'invalid_args',JSON.stringify(input));
 assert.throws(()=>ticketRevokeTarget([]),e=>e.code==='invalid_args');
 await rejects(h.run(2,'rtc.revoke-ticket',{input:{jti:'unknownJti'}}),'not_found');
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');h.flags.deny(subOf(2),'RTC_TICKETS_ENABLED');
 assert.deepEqual(await h.run(2,'rtc.revoke-ticket',{input:{clientId:x.grantInfo.clientId}}),{revoked:true,count:3},'narrowing works while off');
 assert.deepEqual(await h.run(2,'rtc.revoke-ticket',{input:{clientId:x.grantInfo.clientId}}),{revoked:true,count:0},'idempotent');
 const view=await tickets(h);assert.ok(view.filter(t=>t.clientId===x.grantInfo.clientId).every(t=>!t.live));assert.equal(view.filter(t=>t.clientId===y.grantInfo.clientId&&t.live).length,3);
 assert.deepEqual(await h.run(2,'rtc.revoke-ticket',{input:{all:true}}),{revoked:true,count:3});
 assert.equal((await tickets(h)).filter(t=>t.live).length,0);
 assert.deepEqual(await h.run(2,'rtc.revoke-ticket',{input:{jti:view[0].jti}}),{revoked:true},'one ticket, whatever its state');
 // Export carries the attribution, never the link.
 const exported=await h.run(2,'rtc.export');assert.ok(exported.tickets.every(t=>'clientId' in t&&!('link' in t)));
});

// ---- M6 ---------------------------------------------------------------------------------------------------------------
async function ownerOp(e,operation,input){const O=WOPS[operation],op=new O({actor:{kind:'owner',owner:e.sub},...input===undefined?{}:{input}});return O.prototype instanceof AppQuery?read(e.engine,op):perform(e.engine,op);}
/** A foreign ticket invite from `caller` (another provider) to `callee`, re-sent until delivered or `rounds` pass (the
 * first copy may find the sender's keys not yet held). Returns the delivered invite event, or null. */
async function foreignRing(W,caller,callee,link,rounds=6){
 const s=await caller.open(callee.principal,CALL,{basis:link});await caller.invite(s);await W.pump();
 for(let i=0;i<rounds;i++){await callee.listen();const got=callee.invites().find(e=>e.sid===s.sid);if(got)return got;W.clock.advance(2100);await W.tickAll();await W.pump();}
 return null;
}
const postsTo=(W,to,from)=>W.posts.filter(p=>p.to===to&&p.from===from);

test('M6 provider block: every principal of a blocked provider is dropped silently, exactly like a blocked principal',async()=>{
 const W=await rtcWorld({providers:[A,B,C]});
 const callee=W.provider(B).device(1);await callee.register();const link=await callee.mintTicket({uses:50,expires_in:86400});
 const a1=W.provider(A).device(1),a2=W.provider(A).device(2),c1=W.provider(C).device(1),c2=W.provider(C).device(2);for(const d of [a1,a2,c1,c2])await d.register();
 assert.ok(await foreignRing(W,a1,callee,link),'before the block, A rings');
 // A ringing invite from A ends silently when A is blocked.
 const ringing=await a2.open(callee.principal,CALL,{basis:link});await a2.invite(ringing);for(let i=0;i<6;i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 const b=W.entity(B,1);assert.deepEqual(await ownerOp(b,'rtc.block',{issuer:A}),{blocked:true});
 assert.ok(!(await ownerOp(b,'rtc.sessions')).sessions.some(s=>s.role==='callee'&&s.state==='ringing'&&s.peer.iss===A),'A\'s ringing invites ended');
 const blocked=await ownerOp(b,'rtc.blocked');assert.deepEqual(blocked.issuers.map(x=>x.issuer),[A]);assert.deepEqual(blocked.blocked,[]);
 assert.deepEqual((await ownerOp(b,'rtc.export')).blockedIssuers.map(x=>x.issuer),[A]);
 // A known principal and a never-seen principal of A are both dropped; C's people still ring.
 const before=W.posts.length;
 assert.equal(await foreignRing(W,a1,callee,link),null,'a known principal of the blocked provider');
 assert.equal(await foreignRing(W,a2,callee,link),null,'any principal the blocked provider mints');
 assert.ok(await foreignRing(W,c1,callee,link),'another provider still rings');
 // No oracle: the blocked provider's batches were answered exactly like everyone else's (202, same body).
 const fromA=W.posts.slice(before).filter(p=>p.from===A&&p.to===B),fromC=W.posts.slice(before).filter(p=>p.from===C&&p.to===B);
 assert.ok(fromA.length>0&&fromA.every(p=>p.status===202),'A was answered 202');assert.ok(fromC.every(p=>p.status===202));
 assert.equal((await ownerOp(b,'rtc.missed')).missed.filter(m=>m.caller.iss===A).length,0,'never listed as missed');
 // A principal block on C behaves the same way (control), and unblocking A restores it.
 await ownerOp(b,'rtc.block',{principal:c2.principal});assert.equal(await foreignRing(W,c2,callee,link),null);
 assert.deepEqual(await ownerOp(b,'rtc.unblock',{issuer:A}),{blocked:false});
 assert.ok(await foreignRing(W,a2,callee,link),'unblocked: A rings again');
 assert.equal(postsTo(W,B,A).every(p=>p.status===202),true);
});

test('M6 provider and app-origin mutes: delivered without alert; a mute set while ringing silences the ring; unmute restores alerts for new invites',async()=>{
 const W=await rtcWorld({providers:[A,B]});
 const callee=W.provider(B).device(1);await callee.register();const link=await callee.mintTicket({uses:50,expires_in:86400});
 const a1=W.provider(A).device(1);await a1.register();const b=W.entity(B,1);
 await ownerOp(b,'rtc.mute',{kind:'issuer',value:A});
 const muted=await foreignRing(W,a1,callee,link);assert.ok(muted,'still delivered');assert.equal(muted.projection.alert,false,'never alerts');
 const view=(await ownerOp(b,'rtc.sessions')).sessions.find(s=>s.sid===muted.sid);assert.equal(view.alert,false);
 await ownerOp(b,'rtc.unmute',{kind:'issuer',value:A});
 assert.equal((await ownerOp(b,'rtc.sessions')).sessions.find(s=>s.sid===muted.sid).alert,false,'an invite admitted muted never starts alerting (review F2 rule)');
 const loud=await foreignRing(W,a1,callee,link);assert.equal(loud.projection.alert,true,'a new invite alerts after unmute');
 // App origin (the caller certificate's client.origin, as the caller's provider certified it): set while `loud` rings,
 // it silences the portal ring at once, and new invites arrive without alert.
 // Review R3: an unscoped origin mute (this host's own callers) never covers a foreign caller's asserted origin.
 await ownerOp(b,'rtc.mute',{kind:'origin',value:'https://app.example'});
 assert.equal((await ownerOp(b,'rtc.sessions')).sessions.find(s=>s.sid===loud.sid).alert,true,'a same-host origin mute does not cover provider A');
 await ownerOp(b,'rtc.unmute',{kind:'origin',value:'https://app.example'});
 await ownerOp(b,'rtc.mute',{kind:'origin',value:'https://app.example',issuer:A});
 assert.equal((await ownerOp(b,'rtc.sessions')).sessions.find(s=>s.sid===loud.sid).alert,false,'re-evaluated on every read');
 const byApp=await foreignRing(W,a1,callee,link);assert.equal(byApp.projection.alert,false);
 assert.deepEqual((await ownerOp(b,'rtc.blocked')).muted.map(m=>[m.kind,m.issuer]),[['origin',A]]);
});

test('M6 own-entity rule: this host\'s issuer and the owner\'s own principal are never blocked; own-device sessions survive any stored block or mute',async()=>{
 const h=await rtcHost();
 for(const input of [{issuer:ISS},{principal:h.principal(2)},{issuer:'http://far.example'},{issuer:'https://far.example/path'},{issuer:A,principal:h.principal(1)},{},{issuer:7}])await rejects(h.run(2,'rtc.block',{input}),'invalid_args',JSON.stringify(input));
 for(const input of [{kind:'issuer',value:ISS},{kind:'issuer',value:'not an origin'},{kind:'origin',value:'https://x.example/'},{kind:'origin',value:7}])await rejects(h.run(2,'rtc.mute',{input}),'invalid_args',JSON.stringify(input));
 // Whatever is stored (a legacy self block, a hand-written own-issuer block and mute, an origin mute of the own app),
 // the owner's own devices still ring each other with alert.
 const store=h.account(2).store,now=h.clock.now();
 await store.put(K.block(h.principal(2)),{principal:h.principal(2),at:now});await store.put(K.issuerBlock(ISS),{issuer:ISS,at:now});
 await store.put(K.mute('issuer',ISS),{kind:'issuer',value:ISS,at:now});await h.run(2,'rtc.mute',{input:{kind:'origin',value:APP}});
 const d1=h.device(2),d2=h.device(2);await d1.register();await d2.register();
 const s=await d1.open(h.principal(2),CALL,{media:['audio']});await d1.invite(s);await h.pump();await d2.listen();
 const got=d2.claims().find(e=>e.sid===s.sid);assert.ok(got,'own-device invite delivered');assert.equal(got.projection.alert,true,'and alerting');
 assert.equal((await h.run(2,'rtc.sessions')).sessions.find(x=>x.sid===s.sid&&x.role==='callee').alert,true);
 // A same-host caller is still blocked by principal, and the stored own-issuer row does not block other same-host
 // people (it can never be written through the service).
 const other=h.device(1);await other.register();const link=await mint(d1,{uses:5,expires_in:600});
 const r=await ring(h,other,2,link,{listener:d2});assert.ok(r,'the own-issuer row is ignored for other people of this host');assert.equal(r.projection.alert,false,'the origin mute applies to other people');
 await h.run(2,'rtc.block',{input:{principal:h.principal(1)}});assert.equal(await ring(h,other,2,link,{listener:d2}),null);
});

test('M6 bounds and gates: at most 256 blocked providers; unblock and unmute are widening, block and mute never gated',async()=>{
 const h=await rtcHost();
 for(let i=0;i<ISSUER_BLOCKS_MAX;i++)await h.run(2,'rtc.block',{input:{issuer:`https://p${i}.example`}});
 await rejects(h.run(2,'rtc.block',{input:{issuer:'https://one-more.example'}}),'rate_limited');
 assert.deepEqual(await h.run(2,'rtc.block',{input:{issuer:'https://p7.example'}}),{blocked:true},'re-blocking a stored provider is idempotent when full');
 assert.ok(await h.run(2,'rtc.block',{input:{principal:h.principal(1)}}),'the people table is separate');
 assert.equal((await h.run(2,'rtc.blocked')).issuers.length,ISSUER_BLOCKS_MAX);
 h.flags.deny(subOf(2),'RTC_SIGNALING_ENABLED');
 await rejects(h.run(2,'rtc.unblock',{input:{issuer:'https://p1.example'}}),'not_found');
 await rejects(h.run(2,'rtc.unmute',{input:{kind:'origin',value:'https://x.example'}}),'not_found');
 assert.deepEqual(await h.run(2,'rtc.mute',{input:{kind:'issuer',value:'https://far.example'}}),{muted:true},'muting is never gated');
 h.flags.allow(subOf(2),'RTC_SIGNALING_ENABLED');
 await h.run(2,'rtc.unblock',{input:{issuer:'https://p1.example'}});assert.ok(await h.run(2,'rtc.block',{input:{issuer:'https://one-more.example'}}));
});

test('M6 route helpers: the ring offers a provider only for a foreign caller, and honours provider and origin mutes',()=>{
 const env={APP_ORIGIN:ISS},now=Date.now(),s={role:'callee',state:'ringing',held:false,claimed:false,own:false,ringUntil:now+60000,alert:true,purpose:CALL,peer:{iss:A,sub:subOf(1)},callerOrigin:'https://dialer.example'};
 const purposes=[{id:CALL,alert:true}];
 assert.equal(callerProvider(env,s),A);assert.equal(callerProvider(env,{...s,peer:{iss:ISS,sub:subOf(1)}}),null);
 const issuer=ISS;
 assert.equal(ringable(s,{purposes,muted:[],now,issuer}),true);
 assert.equal(ringable(s,{purposes,muted:[{kind:'issuer',value:A}],now,issuer}),false);
 assert.equal(ringable(s,{purposes,muted:[{kind:'origin',value:'https://dialer.example',issuer:A}],now,issuer}),false);
 assert.equal(ringable(s,{purposes,muted:[{kind:'issuer',value:B},{kind:'origin',value:'https://other.example',issuer:A}],now,issuer}),true);
 // Review R3: an origin mute is scoped to the provider that asserted it; an unscoped row (null) means this host.
 assert.equal(ringable(s,{purposes,muted:[{kind:'origin',value:'https://dialer.example',issuer:null}],now,issuer}),true,'a same-host origin mute never covers a foreign caller');
 assert.equal(ringable(s,{purposes,muted:[{kind:'origin',value:'https://dialer.example',issuer:B}],now,issuer}),true,'another provider\'s assertion');
 assert.equal(ringable({...s,peer:{iss:ISS,sub:subOf(1)}},{purposes,muted:[{kind:'origin',value:'https://dialer.example',issuer:null}],now,issuer}),false);
});

// ---- seeded chaos ------------------------------------------------------------------------------------------------------
test('seeded chaos: mint, revoke, block and app removal interleavings keep the ticket and admission invariants',async()=>{
 await forEachSeed(3,async random=>{
  const h=await rtcHost({seed:random.seed});
  const listener=appDevice(h,2,'https://listen.example');await listener.register([CALL,SCREEN]);
  const spammers={1:h.device(1),3:h.device(3)};for(const d of Object.values(spammers))await d.register();
  const apps=['https://x.example','https://y.example','https://z.example'].map(origin=>({origin,clientId:origin+'/client',device:appDevice(h,2,origin),purposes:[CALL,SCREEN],active:true}));
  const model=new Map(),blocked=new Set(),trace=[];
  const liveIn=t=>!t.revoked&&t.usesLeft>0&&t.expiresAt>h.clock.now();
  const step=async(name,fn)=>{trace.push(name);try{await fn();}catch(e){e.message=`${e.message} after ${trace.slice(-6).join(' > ')}`;throw e;}};
  for(let i=0;i<220;i++){
   const r=random.next();
   if(r<0.42){await step('mint',async()=>{
    const app=random.chance(0.6)?apps[0]:random.pick(apps),purposes=random.chance(0.5)?[...app.purposes]:[random.pick(app.purposes)],uses=1+random.int(3);
    const live=[...model.values()].filter(liveIn),mine=live.filter(t=>t.clientId===app.clientId).length;
    const attempt=app.device.run('rtc.mint-ticket',{purposes,uses,expires_in:30*86400});
    if(!app.active){await rejects(attempt,'forbidden','a removed app cannot mint');return;}
    if(mine>=TICKET_APP_QUOTA||live.length>=256){await rejects(attempt,'rate_limited','over quota');return;}
    const {link}=await attempt;model.set(jtiOf(link),{link,clientId:app.clientId,purposes,usesLeft:uses,revoked:false,expiresAt:h.clock.now()+30*DAY,createdAt:h.clock.now()});
   });}
   else if(r<0.5&&model.size){await step('revoke-one',async()=>{const [jti,t]=random.pick([...model]);await h.run(2,'rtc.revoke-ticket',{input:{jti}});t.revoked=true;});}
   else if(r<0.55){await step('revoke-app',async()=>{const app=random.pick(apps);const out=await h.run(2,'rtc.revoke-ticket',{input:{clientId:app.clientId}});let n=0;for(const t of model.values())if(t.clientId===app.clientId&&liveIn(t)){t.revoked=true;n++;}assert.equal(out.count,n);});}
   else if(r<0.57){await step('revoke-all',async()=>{const out=await h.run(2,'rtc.revoke-ticket',{input:{all:true}});let n=0;for(const t of model.values())if(liveIn(t)){t.revoked=true;n++;}assert.equal(out.count,n);});}
   else if(r<0.62){await step('app-revoked',async()=>{const app=random.pick(apps);if(!app.active)return;h.grants.get(app.device.grantInfo.id).active=false;app.active=false;await lifecycle(h,2,{event:'app-revoked',clientId:app.clientId});for(const t of model.values())if(t.clientId===app.clientId)t.revoked=true;});}
   else if(r<0.66){await step('re-approve',async()=>{const app=random.pick(apps);if(app.active)return;app.device=appDevice(h,2,app.origin);app.purposes=[CALL,SCREEN];app.active=true;});}
   else if(r<0.71){await step('app-narrowed',async()=>{const app=random.pick(apps);if(!app.active||app.purposes.length<2)return;const kept=[random.pick(app.purposes)];h.grants.get(app.device.grantInfo.id).purposes=kept;app.purposes=kept;
    await lifecycle(h,2,{event:'app-narrowed',clientId:app.clientId,purposes:kept});for(const t of model.values())if(t.clientId===app.clientId&&t.purposes.some(l=>!kept.includes(l)))t.revoked=true;});}
   else if(r<0.77){await step('block',async()=>{const n=random.pick([1,3]);if(blocked.has(n)&&random.chance(0.5)){await h.run(2,'rtc.unblock',{input:{principal:h.principal(n)}});blocked.delete(n);}else{await h.run(2,'rtc.block',{input:{principal:h.principal(n)}});blocked.add(n);}
    await rejects(h.run(2,'rtc.block',{input:{issuer:ISS}}),'invalid_args','the own issuer is never a block target');});}
   else if(model.size){await step('invite',async()=>{
    const n=random.pick([1,3]),[jti,t]=random.pick([...model]),purpose=random.chance(0.8)?random.pick(t.purposes):random.pick([CALL,SCREEN]);
    const expect=liveIn(t)&&t.purposes.includes(purpose)&&!blocked.has(n);
    const got=await ring(h,spammers[n],2,t.link,{listener,purpose});
    assert.equal(Boolean(got),expect,`invite via ${jti.slice(0,6)} (${t.clientId}, live ${liveIn(t)}, blocked ${blocked.has(n)})`);if(got)t.usesLeft--;
    // Let the ring lapse and the windows pass, so later invites are decided by the rules above, not by limits.
    h.clock.advance(11*60000);await h.tickAll();
    for(const [k,v] of model)if(v.revoked&&v.createdAt+DAY<=h.clock.now()||v.expiresAt+DAY<=h.clock.now())model.delete(k);
   });}
   // Invariants after every step.
   const view=await tickets(h),live=view.filter(v=>v.live);
   assert.deepEqual(new Set(live.map(v=>v.jti)),new Set([...model].filter(([,t])=>liveIn(t)).map(([j])=>j)),`live tickets match the model after ${trace.at(-1)}`);
   assert.ok(live.length<=256);
   for(const app of apps){const mine=live.filter(v=>v.clientId===app.clientId);assert.ok(mine.length<=TICKET_APP_QUOTA,'per-app quota');
    if(!app.active)assert.equal(mine.length,0,'no live ticket of a removed app');
    assert.ok(mine.every(v=>v.purposes.every(l=>app.purposes.includes(l))),'no live ticket names a purpose its app lost');}
  }
  assert.ok(trace.filter(x=>x==='invite').length>10&&trace.includes('app-revoked')&&trace.includes('mint'),'the schedule exercised the interleavings');
 });
});
