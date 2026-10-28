// Signaling rev 3.2 seeded lifecycle chaos test (docs/spec/extensions/signaling.md §21.1 "Engine-level and chaos
// coverage"; review 2026-10-28 "Tests"). Random interleavings over four entities (entity 4 an organization designated a
// service entity, §4.3), with the app-connection port wired, of: person and service-class offer mints (bound and open,
// long expiries for service offers), dial-backs on right, wrong, dead and expired tokens, relation-basis invites on
// cross-entity pairings, own-entity pairing invites with `target`, claims (accept, decline, after expiry), initiator
// hang-ups, relay credential requests, approval removal and restoration, app revocation (grant or lifecycle), connection
// end WITHOUT any cleanup hook (and reconnection), service designation removal and restoration, idle time (offline
// service endpoints) and ticks at arbitrary times (expiry races). After every step the engine's records are compared
// with a REFERENCE MODEL written from the spec text, not from the implementation:
//   §5.2, §5.7  an offer admits only while live (unrevoked, before expires_at, a free use), for its principal (bound) or
//          anyone else (open); bound spends at admission, open reserves then spends on accept and releases on decline or
//          unclaimed end; a use is taken only with a nonempty routing set; an offer record ends at expires_at, so a claim
//          after it fails and ends what it admitted
//   §5.4   eligible = registered for the kind, the app approved for it, its connection live (at the generation the
//          approval was recorded for), not the initiator's endpoint; routing: person offer → minting endpoint, else the
//          app; service-class offer → every eligible ONLINE endpoint of the app (listen within 60 s); relation → covered
//          endpoints; own pairing → the target
//   §5.5, §10.3  offer_match on the minting endpoint (every routed endpoint for a service offer); paired and auto_connect
//          on pairing invites only (auto_connect never cross-entity)
//   §5.8   relation admits only with the recipient's live, unexpired pairing whose peer may open; own pairings cover only
//          the named apps; deletion ends claimed sessions (revoked) and pending ones silently; restoring an approval
//          never restores a pairing
//   §14.2, §20.1.4  removing an approval, revoking the app, and the app's connection ending each end the app's sessions
//          (claimed: revoked to the peer), end pending invites delivered only to it silently, remove its endpoints for
//          the kinds, revoke its offers and delete its pairings; a dead connection admits and authorizes nothing at once,
//          and its state is cleared by the next tick (or approval) and never revives after a reconnect; removing the
//          service designation revokes the entity's offers longer than 900 s
//   §13.1  the windows with their reference values (Appendix B RTC-11; windows not restated in rev 3.2 carry the RTC-11
//          values): per (initiator, recipient) 6/10 min for bound, relation and unbased; per (sending issuer, recipient)
//          20/h, per recipient 60/h and the same-host share 40/h for unbased only; open offers only their own windows
//          (W 60/h or 3,600/h service, 6/h or 12/h per (principal, offer)) and the per-issuer fair share
//          max(W / (n + 1), F); own pairings 30/h per (pairing, endpoint pair); relation 30/h per covered endpoint (at
//          most 240) per pairing; the host-wide initiator window 30/h for every cross-entity invite after the local
//          checks; capacity: base pending 4, reserves of 2 per share (self: own pairings; cross: bound and relation),
//          open offers and pairings each at most half of base pending (2) and connected (4) capacity, connected 8, per
//          pairing at most 2 × covered (relation) or 2 per endpoint pair (own) live; initiator: 8 open sessions, `open`
//          60/h (cross-entity) or the own-device window 120/h, 64 live offers per entity and 32 per app, 120 mints/h
//   §16.7  relay credentials only for a live, accepted leg of an approved, live app
// Local behaviour only (loopback host, fake TURN and spend). Provisional and unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed} from './helpers/chaos.mjs';
import {signalingHost,standardKinds,payloadOf,APP,OTHER_APP,CALLBACK,PEER,REMOTE,subOf,ISS} from './helpers/signaling-fixture.mjs';
import {offerDigest} from '../packages/signaling/messages.mjs';
import {SignalingRelay,TURN_FLAG} from '../packages/signaling/relay.mjs';

const N=4,ORG=4,SEEDS=Number(process.env.SIGNALING_LIFECYCLE_SEEDS??6),STEPS=Number(process.env.SIGNALING_LIFECYCLE_STEPS??90),TRACE=Boolean(process.env.SIGNALING_CHAOS_TRACE);
const SEC=1000,MIN=60*SEC,HOUR=60*MIN,DAY=24*HOUR;
// Reference values (spec §13.1, Appendix B RTC-11).
const WIN={pair:[6,10*MIN],issuerRecipient:[20,HOUR],recipient:[60,HOUR],sameHost:[40,HOUR],ownPairing:[30,HOUR],offerOpen:[60,HOUR],offerOpenService:[3600,HOUR],offerPrincipal:[6,HOUR],offerPrincipalService:[12,HOUR],initiator:[30,HOUR],opens:[60,HOUR],selfOpen:[120,HOUR],mint:[120,HOUR]};
const FLOOR={person:6,service:60},RELATION_PER_ENDPOINT=30,RELATION_MAX=240;
const CAP={pending:4,connected:8,reserveSelf:2,reserveCross:2,share:0.5,initiatorOpen:8,offersEntity:64,offersApp:32,ownPairingLive:2,online:60*SEC,personOffer:900};
const KINDS=[CALLBACK,PEER,REMOTE];
/** Operation weights: destructive lifecycle operations are rare enough that sessions build up between them. */
const OPS=Object.entries({mint:4,dial:7,wrong:1,relation:4,own:3,claim:7,relay:3,burst:2,flood:2,relburst:2,revoke:1,pair:3,ownpair:2,unpair:1,unapprove:1,revokeapp:1,disconnect:1,reconnect:2,reapprove:3,designation:1,wait:1,tick:3}).flatMap(([op,w])=>Array(w).fill(op));

/** Fixed windows: a row starts at its first charge and resets after its window (counts only what was charged). */
class Windows{
 constructor(){this.rows=new Map();}
 live(key,now){const r=this.rows.get(key);return r&&r.resetAt>now?r:null;}
 open(items,now){return items.every(([key,max,,amount=1])=>{const r=this.live(key,now);return !r||r.count+amount<=max;});}
 take(items,now){if(!this.open(items,now))return false;for(const [key,max,ms,amount=1] of items){const r=this.live(key,now)??{count:0,resetAt:now+ms};this.rows.set(key,{count:r.count+amount,resetAt:r.resetAt});void max;}return true;}
}
const win=(name,parts,over)=>{const [max,ms]=over??WIN[name];return [JSON.stringify([name,...parts]),max,ms];};

class Model{
 constructor(h){
  this.h=h;this.eps=new Map();this.offers=new Map();this.sessions=new Map();this.pairings=new Map();this.windows=new Map();this.host=new Windows();this.fair=new Map();
  this.apps={};for(let n=1;n<=N;n++)this.apps[n]={[APP]:{approved:new Set(KINDS),conn:'live',gen:1,status:'live'},[OTHER_APP]:{approved:new Set([REMOTE]),conn:'live',gen:1,status:'live'}};
  this.designated=true;
 }
 now(){return this.h.clock.now();}
 w(n){let x=this.windows.get(n);if(!x){x=new Windows();this.windows.set(n,x);}return x;}
 app(n,client){return this.apps[n][client];}
 appLive(n,client){const a=this.app(n,client);return a.conn==='live'&&a.status==='live';}
 epLive(ep){return Boolean(ep)&&ep.alive&&this.appLive(ep.n,ep.client)&&ep.gen===this.app(ep.n,ep.client).gen;}
 eligible(ep,kind){return this.epLive(ep)&&ep.kinds.has(kind)&&this.app(ep.n,ep.client).approved.has(kind);}
 online(ep){return this.now()-ep.lastSeen<=CAP.online;}
 endpointsOf(n,client){return [...this.eps.values()].filter(e=>e.n===n&&e.client===client);}
 offerLive(o){return !o.dead&&o.expiresAt>this.now();}
 offerAdmits(o,m,n){return Boolean(o)&&o.n===n&&this.offerLive(o)&&o.spent+o.reserved.size<o.uses&&(o.principal===null?m!==n:o.principal===m)&&this.appLive(n,o.client);}
 /** §5.4 routing of an offer invite at admission (person: minting endpoint, else the app; service: online endpoints). */
 offerRoute(o){
  const all=this.endpointsOf(o.n,o.client).filter(e=>this.eligible(e,CALLBACK));
  if(o.service)return all.filter(e=>this.online(e)).map(e=>e.id);
  const minting=this.eps.get(o.endpoint);if(minting&&this.eligible(minting,CALLBACK))return [minting.id];
  return all.map(e=>e.id);
 }
 pairing(key){return this.pairings.get(key)??null;}
 relationLive(p){return Boolean(p)&&p.state==='live'&&p.expiresAt>this.now();}
 relationCovered(n){return this.endpointsOf(n,APP).filter(e=>this.eligible(e,PEER)).map(e=>e.id);}
 ownPairingAt(n){return this.pairing('own:'+n);}
 ownCovers(p,initiatorEp,targetEp){if(!p)return false;const fwd=initiatorEp.client===APP&&targetEp.client===OTHER_APP&&['local','both'].includes(p.opens),back=initiatorEp.client===OTHER_APP&&targetEp.client===APP&&['peer','both'].includes(p.opens);return fwd||back;}
 /** Live recipient sessions at n (capacity, §13.1). */
 live(n){return [...this.sessions.values()].filter(s=>s.n===n&&['pending','connected'].includes(s.rstate));}
 capacity(n,cls){
  const live=this.live(n),pending=live.filter(s=>s.rstate==='pending'),connected=live.filter(s=>s.rstate==='connected'),pairingCls=new Set(['relation','ownPairing']);
  const pShare=Math.floor(CAP.pending*CAP.share),cShare=Math.floor(CAP.connected*CAP.share);
  if(connected.length>=CAP.connected)return false;
  if(cls==='open'&&(pending.filter(s=>s.cls==='open').length>=pShare||connected.filter(s=>s.cls==='open').length>=cShare))return false;
  if(pairingCls.has(cls)&&(pending.filter(s=>pairingCls.has(s.cls)).length>=pShare||connected.filter(s=>pairingCls.has(s.cls)).length>=cShare))return false;
  if(pending.length<CAP.pending)return 'base';
  const share={ownPairing:'self',relation:'cross',bound:'cross'}[cls];if(!share)return false;
  const size=share==='self'?CAP.reserveSelf:CAP.reserveCross;
  return pending.filter(s=>s.reserve===share).length<size&&pending.length<CAP.pending+CAP.reserveSelf+CAP.reserveCross?share:false;
 }
 initiatorLive(m){return [...this.sessions.values()].filter(s=>s.m===m&&['pending','connected'].includes(s.istate)).length;}
 liveOffers(n,client){return [...this.offers.values()].filter(o=>o.n===n&&this.offerLive(o)&&(!client||o.client===client)).length;}
 // ---- endings ----------------------------------------------------------------------------------------------------
 releaseIfPending(s){const o=s.token?this.offers.get(s.token):null;if(o&&o.reserved.has(s.sid))o.reserved.delete(s.sid);}
 /** Ends the recipient record. `control`: a claimed leg's end reaches the initiator (§14.2 step 3). */
 endRecipient(s,{control=true}={}){
  if(!['pending','connected'].includes(s.rstate))return;const wasPendingUnclaimed=s.rstate==='pending'&&!s.claimedBy;s.rstate='ended';
  if(wasPendingUnclaimed)this.releaseIfPending(s);
  const o=s.token?this.offers.get(s.token):null;if(o)o.admitted.delete(s.sid);
  if(s.own||(control&&s.claimedBy))this.endInitiator(s,{control:false});
 }
 endInitiator(s,{control=true}={}){
  if(!['pending','connected'].includes(s.istate))return;s.istate='ended';
  if(s.own||control)this.endRecipient(s,{control:false});
 }
 deletePairing(key){
  if(!this.pairings.delete(key))return;
  // Both records that a pairing admitted: the recipient's (its pending invites silently, claimed ones `revoked`) and
  // the initiator's own session opened under its own pairing (§5.1 item 7), which ends with `revoked` to the peer.
  for(const s of this.sessions.values()){if(s.pairing===key&&['pending','connected'].includes(s.rstate))this.endRecipient(s);if(s.ipairing===key&&['pending','connected'].includes(s.istate))this.endInitiator(s);}
 }
 endOffer(o){
  if(o.dead)return;o.dead=true;
  for(const sid of [...o.admitted]){const s=this.sessions.get(sid);if(s&&s.rstate==='pending'&&!s.claimedBy)this.endRecipient(s,{control:false});}
  o.reserved.clear();o.admitted.clear();
 }
 /** §14.2 for one app at n, for `lines` (null: every kind), with `authority`. */
 narrow(n,client,lines,{authority=true}={}){
  const covers=k=>lines===null||lines.includes(k);
  for(const s of this.sessions.values()){
   if(!covers(s.kind))continue;
   if(s.m===n&&s.initiatorClient===client&&['pending','connected'].includes(s.istate)){this.endInitiator(s);continue;}
   if(s.n===n&&['pending','connected'].includes(s.rstate)){
    if(s.claimedBy&&this.eps.get(s.claimedBy)?.client===client){this.endRecipient(s);continue;}
    if(s.rstate==='pending'&&!s.claimedBy){const delivered=[...s.delivered].filter(id=>this.eps.get(id)?.alive);
     if(delivered.length&&delivered.every(id=>this.eps.get(id).client===client))this.endRecipient(s,{control:false});}
   }
  }
  for(const e of this.endpointsOf(n,client))if(e.alive){if(lines===null)this.removeEndpoint(e);else{for(const k of lines)e.kinds.delete(k);if(!e.kinds.size)this.removeEndpoint(e);}}
  if(authority){
   for(const o of this.offers.values())if(o.n===n&&o.client===client&&covers(CALLBACK))this.endOffer(o);
   for(const [key,p] of [...this.pairings])if(p.n===n&&covers(p.kind)&&(p.local===client||p.peerApp===client))this.deletePairing(key);
  }
 }
 removeEndpoint(e){
  if(!e.alive)return;e.alive=false;
  for(const s of this.sessions.values()){
   if(s.initiatorEp===e.id&&['pending','connected'].includes(s.istate))this.endInitiator(s);
   if(s.claimedBy===e.id&&['pending','connected'].includes(s.rstate))this.endRecipient(s);
   s.delivered.delete(e.id);
  }
 }
 /** §20.1.4 clearing: approvals of the app go, then §14.2 with authority for every kind. */
 clear(n,client){const a=this.app(n,client);a.approved.clear();this.narrow(n,client,null);a.status='cleared';}
 tick(){
  const now=this.now();
  for(let n=1;n<=N;n++){
   for(const client of [APP,OTHER_APP])if(this.app(n,client).status==='stale')this.clear(n,client);
   for(const o of this.offers.values())if(o.n===n&&!o.dead&&o.expiresAt<=now)this.endOffer(o);
   for(const [key,p] of [...this.pairings])if(p.n===n&&(p.expiresAt<=now||p.state!=='live'&&p.createdAt+7*DAY<=now))this.deletePairing(key);
   for(const s of this.sessions.values()){
    if(s.n===n&&(s.rstate==='pending'&&now>=s.answerBy||['pending','connected'].includes(s.rstate)&&now>=s.endsAt))this.endRecipient(s,{control:false});
    if(s.m===n&&(s.istate==='pending'&&now>=s.answerBy||['pending','connected'].includes(s.istate)&&now>=s.iEndsAt))this.endInitiator(s,{control:false});
   }
  }
 }
}

function fakeRelay(){
 const turn={n:0,async issue({ttl}){const username='u'+(++turn.n);return {iceServers:[{urls:['turn:turn.example:3478?transport=udp'],username,credential:'c-'+username}],expiresIn:ttl};},async revoke(){}};
 const spend={async reserve(){return {enforced:true,id:1};},async commit(){},async release(){}};
 return a=>new SignalingRelay({service:a.service,adapter:turn,spend,plan:async()=>'plus',wake:()=>{}});
}

test('seeded lifecycle chaos: service offers, approval removal, app revocation and connection end, expiry races, windows, own pairings and relay keep the spec invariants',async()=>{
 const stats={admitted:0,refused:0,claims:0,cleared:0,relay:0,limited:0,lateDelivered:0};
 await forEachSeed(SEEDS,async random=>{
  const h=await signalingHost({seed:random.seed,entities:N,organizations:[ORG],connections:true,flags:{[TURN_FLAG]:true},relay:fakeRelay()});
  await standardKinds(h);
  for(let n=1;n<=N;n++){for(const line of KINDS)await h.approve(n,APP,line);await h.approve(n,OTHER_APP,REMOTE);}
  await h.run(ORG,'signaling.set-service',{input:{designated:true,revision:0}});let revision=1;
  const M=new Model(h),devices=new Map(),trace=(...x)=>{if(TRACE)console.log(...x);};
  const register=async(n,client)=>{const d=h.device(n,{clientId:client,kinds:client===APP?KINDS:[REMOTE]});await d.register();devices.set(d.endpoint,d);
   M.eps.set(d.endpoint,{id:d.endpoint,n,client,kinds:new Set(client===APP?KINDS:[REMOTE]),gen:M.app(n,client).gen,alive:true,lastSeen:M.now()});return d;};
  for(let n=1;n<=N;n++){await register(n,APP);await register(n,APP);await register(n,OTHER_APP);}
  const live=(n,client=APP)=>[...M.eps.values()].filter(e=>e.n===n&&e.client===client&&M.epLive(e));
  const advance=ms=>h.clock.advance(Math.round(ms/SEC)*SEC);
  const sessionsSeen=new Map();
  /** Listens on every live endpoint; checks every invite against §5.4/§5.5 at delivery time. */
  const listenAll=async()=>{
   for(const e of [...M.eps.values()]){if(!M.epLive(e))continue;const d=devices.get(e.id);const out=await d.listen();e.lastSeen=M.now();
    for(const ev of out.events){if(ev.type!=='invite')continue;const s=M.sessions.get(ev.sid);assert.ok(s,`an invite only for a session the model admitted (${ev.sid})`);
     assert.ok(allowed(s,e),`seed ${random.seed}: ${e.id} may receive ${s.cls} invite ${s.sid}`);checkProjection(s,e,ev.projection);
     if(!s.delivered.has(e.id)&&s.admittedSeen)stats.lateDelivered++;s.delivered.add(e.id);}}
   for(const s of M.sessions.values())s.admittedSeen=true;
  };
  const allowed=(s,e)=>{
   if(s.n!==e.n||s.rstate!=='pending'||s.claimedBy)return false;
   if(s.cls==='open'||s.cls==='bound'){const o=M.offers.get(s.token);if(!o||o.dead||e.client!==o.client||!M.eligible(e,CALLBACK))return false;
    if(o.service)return M.online(e)||true;// it is online: it is listening now
    const minting=M.eps.get(o.endpoint);return minting&&M.eligible(minting,CALLBACK)?e.id===minting.id:true;}
   if(s.cls==='relation'){const p=M.pairing(s.pairing);return M.relationLive(p)&&['peer','both'].includes(p.opens)&&e.client===APP&&M.eligible(e,PEER);}
   if(s.cls==='ownPairing'){const p=M.pairing(s.pairing);return Boolean(p)&&e.id===s.targetEp&&M.eligible(e,REMOTE)&&M.ownCovers(p,s.initiatorSnapshot,e);}
   return false;
  };
  const checkProjection=(s,e,p)=>{
   if(s.cls==='open'||s.cls==='bound'){const o=M.offers.get(s.token);assert.equal(p.basis,'offer');assert.equal(p.offer_match,o.service?true:e.id===o.endpoint,'offer_match');assert.equal(p.paired,false);assert.equal(p.auto_connect,false);}
   if(s.cls==='relation'){assert.equal(p.basis,'pairing');assert.equal(p.paired,true);assert.equal(p.auto_connect,false,'never auto_connect cross-entity');assert.equal(p.offer_match,false);}
   if(s.cls==='ownPairing'){assert.equal(p.basis,'pairing');assert.equal(p.paired,true);assert.equal(p.auto_connect,true);}
  };
  const rowsOf=async n=>new Map((await h.rows(n,'sig/')).filter(([k])=>k.startsWith('sig/in/')||k.startsWith('sig/out/')).map(([k,r])=>[(k.startsWith('sig/out/')?'out:':'in:')+k.slice(k.lastIndexOf('/')+1),r]));
  const check=async label=>{
   const rows={};for(let n=1;n<=N;n++)rows[n]=await rowsOf(n);
   for(const s of M.sessions.values()){
    const r=rows[s.n].get('in:'+s.sid),i=rows[s.m].get('out:'+s.sid);
    if(s.rstate==='none')assert.ok(!r||r.state==='ended',`${label}: ${s.sid} was not admitted`);
    else if(s.rstate!=='ended'||r)assert.equal(r?.state,s.rstate,`${label}: recipient record of ${s.cls} ${s.sid}`);
    if(i)assert.equal(i.state,s.istate,`${label}: initiator record of ${s.cls} ${s.sid}`);
   }
   for(let n=1;n<=N;n++){
    const listed=new Map((await h.run(n,'signaling.offers')).offers.map(o=>[o.id,o]));let count=0;
    for(const [token,o] of M.offers){if(o.n!==n)continue;const e=listed.get(o.digest);
     if(!M.offerLive(o)){assert.equal(e,undefined,`${label}: a dead or expired offer is not listed`);continue;}count++;
     assert.ok(e,`${label}: live offer listed (${token.slice(0,6)})`);assert.equal(e.spent,o.spent,`${label}: spent`);assert.equal(e.reserved,o.reserved.size,`${label}: reserved`);assert.equal(e.service,o.service);assert.ok(e.spent+e.reserved<=e.uses);}
    assert.equal(listed.size,count,`${label}: no other offer is listed at ${n}`);
    const approvals=(await h.run(n,'intents.session-approvals')).approvals;
    for(const client of [APP,OTHER_APP])assert.deepEqual(approvals.filter(a=>a.handler===client).map(a=>a.kind).sort(),[...M.app(n,client).approved].sort(),`${label}: approvals of ${client} at ${n}`);
    const pairings=(await h.run(n,'signaling.pairings')).pairings.map(p=>p.id).sort();
    assert.deepEqual(pairings,[...M.pairings.values()].filter(p=>p.n===n).map(p=>p.id).sort(),`${label}: pairings at ${n}`);
   }
  };
  // ---- operations ---------------------------------------------------------------------------------------------------
  const mint=async n=>{
   const eps=live(n);if(!eps.length)return;const e=random.pick(eps),d=devices.get(e.id),bound=random.chance(0.5);
   const service=n===ORG&&M.designated,m=1+((n+random.int(N-1))%N);
   const wantLong=service&&random.chance(0.6)||n===ORG&&!M.designated&&random.chance(0.15);
   const expires=wantLong?CAP.personOffer+60+random.int(2*3600):60+random.int(800),uses=bound?undefined:1+random.int(service?20:4);
   const approved=M.app(n,APP).approved.has(CALLBACK);
   const capped=M.liveOffers(n)+1>CAP.offersEntity||M.liveOffers(n,APP)+1>CAP.offersApp;
   const invalid=!service&&expires>CAP.personOffer;
   let out;try{out=await d.offer(CALLBACK,{...bound?{principals:[h.principal(m)]}:{uses},expires_in:expires});}
   catch(err){
    if(!approved){assert.equal(err.code,'approval_required');return;}
    if(invalid){assert.equal(err.code,'invalid_args','a person-class offer lasts at most 900 s');return;}
    assert.equal(err.code,'rate_limited',`mint at ${n}: ${err.code}`);assert.ok(capped||!M.w(n).open([win('mint',[APP])],M.now()),'mint refused only by a cap or the mint window');stats.limited++;return;}
   assert.ok(approved&&!invalid&&!capped,`mint at ${n} succeeds only within the rules`);
   assert.ok(M.w(n).take([win('mint',[APP])],M.now()));
   const token=out.offers[0].offer;M.offers.set(token,{token,digest:await offerDigest(token),n,client:APP,endpoint:e.id,principal:bound?m:null,uses:bound?1:uses,spent:0,reserved:new Set(),admitted:new Set(),dead:false,expiresAt:M.now()+expires*SEC,createdAt:M.now(),service});
  };
  /** Opens from initiator device `d` (entity m) and predicts the initiator-side outcome (§13.1 initiator limits). */
  const openFrom=async(m,d,to,kind,options,{own=false}={})=>{
   const full=M.initiatorLive(m)>=CAP.initiatorOpen,window=own?win('selfOpen',['open'],WIN.selfOpen):win('opens',[m]);
   const windowOk=M.w(m).open([window],M.now());
   try{const s=await d.open(to,kind,options);assert.ok(!full&&windowOk,`open at ${m}: allowed only under the initiator limits`);M.w(m).take([window],M.now());return s;}
   catch(err){if(err.code==='rate_limited'){assert.ok(full||!windowOk,`open at ${m} limited only by a limit`);stats.limited++;return null;}throw err;}
  };
  const recordSession=(s,fields)=>{const rec={sid:s.sid,delivered:new Set(),rstate:'none',istate:'pending',answerBy:Math.floor(M.now()/SEC)*SEC+60*SEC,endsAt:Math.floor(M.now()/SEC)*SEC+DAY,iEndsAt:M.now()+DAY,initiatorSession:s,admittedSeen:false,...fields};M.sessions.set(s.sid,rec);return rec;};
  /** The recipient's local checks, in spec order (§9.2 step 7, §13.1), then the host-wide window and step 8. */
  const admit=(rec,{cls,limits,pairingCap=null,fair=null,route,requireRoute,host=true})=>{
   const n=rec.n,now=M.now(),W=M.w(n);
   const refuse=why=>{stats[why]=(stats[why]??0)+1;return false;};
   if(!W.open(limits,now))return refuse('window');
   if(fair&&!fairOk(fair,false))return refuse('fair');
   if(cls==='unbased'){W.take(limits,now);return false;}
   const reserve=M.capacity(n,cls);if(!reserve)return refuse('capacity');
   if(pairingCap&&M.live(n).filter(pairingCap.match).length>=pairingCap.max)return refuse('pairingCap');
   W.take(limits,now);if(fair)fairOk(fair,true);
   if(host&&!M.host.take([win('initiator',[ISS,subOf(rec.m)])],now))return refuse('host');
   if(requireRoute&&!route.length)return false;
   rec.cls=cls;rec.reserve=reserve==='base'?null:reserve;rec.rstate='pending';return true;
  };
  const fairOk=({offer,service},take)=>{
   const now=M.now(),W=(service?WIN.offerOpenService:WIN.offerOpen)[0],F=service?FLOOR.service:FLOOR.person;
   let row=M.fair.get(offer);if(!row||row.resetAt<=now)row={resetAt:now+HOUR,issuers:new Map()};
   const n=row.issuers.size,mine=row.issuers.get(ISS)??0;if(mine>=Math.max(Math.floor(W/(n+1)),F))return false;
   if(take){row.issuers.set(ISS,mine+1);M.fair.set(offer,row);}return true;
  };
  const dial=async(m,n,token)=>{
   if(!live(m).some(e=>M.eligible(e,CALLBACK))&&random.chance(0.6))await heal(m);
   const init=live(m).filter(e=>M.eligible(e,CALLBACK));if(!init.length)return;const ie=random.pick(init),d=devices.get(ie.id);
   const s=await openFrom(m,d,h.principal(n),CALLBACK,{basis:{offer:token}});if(!s)return;
   const rec=recordSession(s,{m,n,kind:CALLBACK,token,initiatorEp:ie.id,initiatorClient:APP,own:false});
   const o=M.offers.get(token),ok=M.offerAdmits(o,m,n),cls=ok?(o.principal===null?'open':'bound'):'unbased';
   const pair=win('pair',[ISS,subOf(m)]);
   const limits=cls==='open'?[win(o.service?'offerOpenService':'offerOpen',[o.digest]),win(o.service?'offerPrincipalService':'offerPrincipal',[o.digest,ISS,subOf(m)])]:cls==='bound'?[pair]:[pair,win('issuerRecipient',[ISS,subOf(m)]),win('recipient',[]),win('sameHost',[])];
   const route=ok?M.offerRoute(o):[];
   const admitted=admit(rec,{cls,limits,fair:cls==='open'?{offer:o.digest,service:o.service}:null,route,requireRoute:true});
   if(admitted){if(o.principal===null)o.reserved.add(s.sid);else o.spent++;o.admitted.add(s.sid);}
   trace('dial',m,'->',n,cls,admitted,route.length);
   await d.invite(s);await h.pump();await listenAll();
   if(admitted){stats.admitted++;assert.deepEqual([...rec.delivered].sort(),o.service?M.endpointsOf(n,APP).filter(e=>M.eligible(e,CALLBACK)).map(e=>e.id).sort():[...route].sort(),`dial ${m}->${n}: routed by §5.4`);}
   else{stats.refused++;rec.rstate='none';assert.equal(rec.delivered.size,0);await d.cancel(s);rec.istate='ended';await h.pump();}
   return rec;
  };
  /** Declines an admitted session at once (frees capacity, releases an open offer's use) and hangs up. */
  const declineNow=async rec=>{if(!rec||rec.rstate!=='pending'||!rec.delivered.size)return;const id=[...rec.delivered].find(x=>M.epLive(M.eps.get(x)));if(!id)return;
   await devices.get(id).claim(rec.sid,'decline');rec.claimedBy=id;rec.rstate='ended';const o=rec.token?M.offers.get(rec.token):null;if(o){o.reserved.delete(rec.sid);o.admitted.delete(rec.sid);}stats.claims++;await h.pump();await hangup(rec);};
  /** §13.1 windows under load: one holder dials one open offer repeatedly, declining each (the per-(principal, offer)
   * window, W and the fair share bind, never capacity); or floods unbased invites before a valid one (the shared
   * per-(initiator, recipient) window binds the valid one too). */
  const burst=async()=>{
   const open=[...M.offers.values()].filter(o=>M.offerLive(o)&&o.principal===null);if(!open.length)return;const o=random.pick(open);let holder=1+random.int(N);if(holder===o.n)holder=holder%N+1;
   for(let i=0;i<8;i++){const rec=await dial(holder,o.n,o.token);await declineNow(rec);advance(SEC);}
  };
  const flood=async(m,n)=>{
   const bound=[...M.offers.values()].filter(o=>M.offerLive(o)&&o.n===n&&o.principal===m);const dead=[...M.offers.values()].filter(o=>!M.offerLive(o));
   for(let i=0;i<6;i++){const o=dead.length?random.pick(dead):null;if(!o)break;await dial(m,n,o.token);advance(SEC);}
   if(bound.length)await declineNow(await dial(m,n,random.pick(bound).token));
  };
  const relationDial=async(m,n)=>{
   if(!live(m).some(e=>M.eligible(e,PEER))&&random.chance(0.6))await heal(m);
   if(random.chance(0.6)){if(!M.relationLive(M.pairing(`x:${m}>${n}`)))await pair(m,n);if(!M.relationLive(M.pairing(`x:${n}>${m}`)))await pair(n,m);}
   const init=live(m).filter(e=>M.eligible(e,PEER));if(!init.length)return;const ie=random.pick(init),d=devices.get(ie.id);
   const mine=M.pairing(`x:${m}>${n}`),canOpen=M.relationLive(mine)&&['local','both'].includes(mine.opens)&&M.appLive(m,APP);
   let s=null;try{s=await openFrom(m,d,h.principal(n),PEER,{basis:{relation:'pairing'}});}catch(err){assert.equal(canOpen,false,`relation open ${m}->${n} refused only without the initiator's own pairing (${err.code})`);assert.equal(err.code,'invalid_args');return;}
   if(!s)return;assert.equal(canOpen,true,`relation open ${m}->${n} needs the initiator's own pairing`);
   const rec=recordSession(s,{m,n,kind:PEER,token:null,initiatorEp:ie.id,initiatorClient:APP,own:false,ipairing:`x:${m}>${n}`});
   const p=M.pairing(`x:${n}>${m}`),ok=M.relationLive(p)&&['peer','both'].includes(p.opens)&&M.appLive(n,APP);
   const covered=ok?M.relationCovered(n):[],pairWin=win('pair',[ISS,subOf(m)]);
   const limits=ok?[win('relation',[p.id],[Math.min(RELATION_MAX,RELATION_PER_ENDPOINT*Math.max(1,covered.length)),HOUR]),pairWin]:[pairWin,win('issuerRecipient',[ISS,subOf(m)]),win('recipient',[]),win('sameHost',[])];
   const admitted=admit(rec,{cls:ok?'relation':'unbased',limits,pairingCap:ok?{match:x=>x.pairing===`x:${n}>${m}`,max:Math.max(2,2*covered.length)}:null,route:covered,requireRoute:false});
   if(admitted)rec.pairing=`x:${n}>${m}`;
   trace('relation',m,'->',n,admitted,covered.length);
   await d.invite(s);await h.pump();await listenAll();
   if(admitted){stats.admitted++;assert.deepEqual([...rec.delivered].sort(),[...covered].sort(),`relation ${m}->${n}: covered endpoints`);}
   else{stats.refused++;rec.rstate='none';await d.cancel(s);rec.istate='ended';await h.pump();}
  };
  const ownDial=async n=>{
   if(random.chance(0.5))await heal(n);if(!M.ownPairingAt(n)&&random.chance(0.7))await ownPair(n);
   const p=M.ownPairingAt(n);const candidates=[...M.eps.values()].filter(e=>e.n===n&&M.eligible(e,REMOTE));if(candidates.length<2)return;
   const ie=random.pick(candidates),targets=candidates.filter(e=>e.client!==ie.client);if(!targets.length)return;const te=random.pick(targets),d=devices.get(ie.id);
   const coveredNow=Boolean(p)&&p.state==='live'&&M.ownCovers(p,ie,te);
   let s=null;try{s=await openFrom(n,d,h.principal(n),REMOTE,{target:te.id},{own:true});}catch(err){assert.equal(coveredNow,false,`own open at ${n}: refused only without a covering pairing (${err.code})`);assert.equal(err.code,'invalid_args');return;}
   if(!s)return;assert.equal(coveredNow,true,`own open at ${n} needs a live covering pairing that lets this side open`);
   const rec=recordSession(s,{m:n,n,kind:REMOTE,token:null,initiatorEp:ie.id,initiatorClient:ie.client,own:true,targetEp:te.id,initiatorSnapshot:{...ie},pairing:'own:'+n});
   const route=M.eligible(te,REMOTE)&&coveredNow?[te.id]:[];
   const admitted=admit(rec,{cls:'ownPairing',limits:[win('ownPairing',[p.id,ie.id,te.id])],pairingCap:{match:x=>x.pairing==='own:'+n&&x.targetEp===te.id&&x.initiatorEp===ie.id,max:CAP.ownPairingLive},route,requireRoute:false,host:false});
   trace('own',n,ie.client,'->',te.client,admitted);
   await d.invite(s);await h.pump();await listenAll();
   if(admitted){stats.admitted++;assert.deepEqual([...rec.delivered],route,'own pairing: the target only');}
   else{stats.refused++;rec.rstate='none';await d.cancel(s);rec.istate='ended';await h.pump();}
  };
  const claim=async()=>{
   const pend=[...M.sessions.values()].filter(s=>s.rstate==='pending'&&!s.claimedBy&&s.delivered.size);if(!pend.length)return;
   const s=random.pick(pend),id=random.pick([...s.delivered]),e=M.eps.get(id),d=devices.get(id),outcome=random.pick(['accept','accept','decline']),now=M.now();
   const o=s.token?M.offers.get(s.token):null;
   let expect='ok';
   if(!M.epLive(e))expect='not_found';
   else if(outcome==='accept'&&!M.eligible(e,s.kind))expect='approval_required';
   else if(o&&o.expiresAt<=now&&!o.dead)expect='expired';
   else if(now>=s.answerBy)expect='claimed';
   try{await d.claim(s.sid,outcome);}
   catch(err){
    if(expect==='expired'){assert.equal(err.code,'claimed','a claim after expires_at fails (§5.7)');M.endOffer(o);return;}
    assert.equal(err.code,expect,`claim ${s.sid}: ${err.code} (expected ${expect})`);return;}
   assert.equal(expect,'ok',`claim ${s.sid} succeeded but the model expected ${expect}`);stats.claims++;
   s.claimedBy=id;if(o&&o.reserved.has(s.sid)){o.reserved.delete(s.sid);if(outcome==='accept')o.spent++;}if(o)o.admitted.delete(s.sid);
   s.rstate=outcome==='accept'?'connected':'ended';if(s.own&&outcome==='decline'){/* the twin ends when the decline reaches it; we hang up below */}
   await h.pump();await listenAll();
   if(outcome==='decline'||random.chance(0.6))await hangup(s);
  };
  const hangup=async s=>{
   if(s.istate!=='pending')return;const d=devices.get(s.initiatorEp);if(!d||!M.epLive(M.eps.get(s.initiatorEp)))return;
   await d.cancel(s.initiatorSession);s.istate='ended';if(['pending','connected'].includes(s.rstate))M.endRecipient(s,{control:false});await h.pump();
  };
  const relay=async()=>{
   const conn=[...M.sessions.values()].filter(s=>s.claimedBy&&s.rstate==='connected');if(!conn.length)return;const s=random.pick(conn),e=M.eps.get(s.claimedBy),d=devices.get(e.id);
   const authorized=M.epLive(e)&&M.eligible(e,s.kind)&&s.endsAt-M.now()>=10*SEC;
   try{await d.run('signaling.relay-credentials',{...d.auth(),sid:s.sid});assert.ok(authorized,`relay for ${s.sid}: issued only to a live, approved, accepted leg`);stats.relay++;}
   catch(err){if(authorized)assert.equal(err.code,'rate_limited',`relay for ${s.sid}: an authorized leg is refused only by relay limits (${err.code})`);else assert.ok(['not_found','forbidden'].includes(err.code),`relay refusal ${err.code}`);}
  };
  const revokeOffer=async()=>{
   const list=[...M.offers.values()].filter(o=>!o.dead);if(!list.length)return;const o=random.pick(list);
   const holder=live(o.n).find(e=>e.client===o.client);if(!holder)return;
   await devices.get(holder.id).revokeOffer([o.token]);M.endOffer(o);await h.pump();
  };
  const pair=async(n,m)=>{
   const key=`x:${n}>${m}`;if(M.pairings.has(key))return;const opens=random.pick(['local','peer','both']),expiresAt=M.now()+DAY+random.int(2)*DAY;
   const ok=M.appLive(n,APP)&&M.app(n,APP).approved.has(PEER);
   const p=await h.run(n,'signaling.pairing-create',{actor:h.owner(n,{freshAuth:true}),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(m)},opens,label:'P',activate:true,expiresAt}});
   assert.equal(p.state,ok?'live':'pending',`pairing at ${n}: live only when the local app qualifies (P1, P3)`);
   M.pairings.set(key,{id:p.id,n,kind:PEER,local:APP,peerApp:null,opens,state:p.state,expiresAt,createdAt:M.now()});
  };
  const ownPair=async n=>{
   const key='own:'+n;if(M.pairings.has(key))return;const opens=random.pick(['local','peer','both']);
   const ok=M.appLive(n,APP)&&M.app(n,APP).approved.has(REMOTE)&&M.appLive(n,OTHER_APP);
   const p=await h.run(n,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:APP,client_session:null},peer:{self:{client_id:OTHER_APP,client_session:null}},opens,label:'Own',activate:true}});
   assert.equal(p.state,ok?'live':'pending');
   M.pairings.set(key,{id:p.id,n,kind:REMOTE,local:APP,peerApp:OTHER_APP,opens,state:p.state,expiresAt:Infinity,createdAt:M.now()});
  };
  const unpair=async()=>{const keys=[...M.pairings.keys()];if(!keys.length)return;const key=random.pick(keys),p=M.pairings.get(key);await h.run(p.n,'signaling.pairing-remove',{input:{id:p.id}});M.deletePairing(key);await h.pump();};
  const unapprove=async n=>{const kind=random.pick([CALLBACK,PEER]);await h.unapprove(n,APP,kind);M.app(n,APP).approved.delete(kind);M.narrow(n,APP,[kind]);await h.pump();};
  const revokeApp=async n=>{await h.run(n,'signaling.lifecycle',{actor:h.system(n),input:{event:'app-revoked',clientId:APP}});M.clear(n,APP);stats.cleared++;await h.pump();};
  const disconnect=async n=>{const a=M.app(n,APP);if(a.conn!=='live')return;h.disconnect(n);a.conn='ended';if(a.status==='live')a.status='stale';};
  const reconnect=async n=>{const a=M.app(n,APP);if(a.conn!=='ended')return;h.reconnect(n);a.conn='live';a.gen=h.connection(n).generation;};
  const reapprove=async n=>{
   const a=M.app(n,APP);if(a.conn!=='live')return;
   for(const line of KINDS){await h.approve(n,APP,line);if(a.status==='stale'){M.clear(n,APP);stats.cleared++;}a.status='live';a.approved.add(line);}
   await h.pump();
   while(live(n).filter(e=>e.kinds.size===KINDS.length).length<2)await register(n,APP);
   await listenAll();
  };
  /** Restores entity n's app (reconnect, re-approve, fresh devices) so that sessions can build up again. */
  const heal=async n=>{if(M.app(n,APP).conn==='ended')await reconnect(n);const a=M.app(n,APP);if(a.status!=='live'||a.approved.size<KINDS.length||live(n).filter(e=>e.kinds.size===KINDS.length).length<2)await reapprove(n);};
  const designation=async()=>{
   const next=!M.designated;await h.run(ORG,'signaling.set-service',{input:{designated:next,revision}});revision++;M.designated=next;
   if(!next)for(const o of M.offers.values())if(o.n===ORG&&!o.dead&&o.expiresAt-o.createdAt>CAP.personOffer*SEC)M.endOffer(o);
   await h.pump();
  };
  const tick=async()=>{await h.tickAll();M.tick();await h.pump();};

  for(let step=0;step<STEPS;step++){
   const op=random.pick(OPS);
   const n=1+random.int(N);let m=1+random.int(N);if(m===n)m=m%N+1;
   trace(step,op,n,m);
   if(op==='mint')await mint(n);
   if(op==='dial'||op==='wrong'){const all=[...M.offers.keys()],liveTokens=all.filter(t=>M.offerLive(M.offers.get(t))),tokens=liveTokens.length&&random.chance(0.8)?liveTokens:all;if(tokens.length){const token=random.pick(tokens),o=M.offers.get(token);
    let holder=op==='wrong'?1+random.int(N):o.principal??(o.n===m?n:m);if(holder===o.n)holder=holder%N+1;await dial(holder,o.n,token);}}
   if(op==='relation')await relationDial(m,n);
   if(op==='own')await ownDial(n);
   if(op==='burst')await burst();
   if(op==='relburst')for(let i=0;i<4;i++)await relationDial(m,n);// pending relation invites pile up: the pairing sub-budget binds
   if(op==='flood')await flood(m,n);
   if(op==='claim')await claim();
   if(op==='relay')await relay();
   if(op==='revoke')await revokeOffer();
   if(op==='pair'){await pair(n,m);if(random.chance(0.85))await pair(m,n);}
   if(op==='ownpair')await ownPair(n);
   if(op==='unpair')await unpair();
   if(op==='unapprove')await unapprove(n);
   if(op==='revokeapp')await revokeApp(n);
   if(op==='disconnect'){await disconnect(n);
    // A dead connection authorizes nothing at once (§14.2): its endpoint secrets are refused before any cleanup.
    for(const e of M.endpointsOf(n,APP))if(e.alive)await assert.rejects(devices.get(e.id).listen(),err=>err.code==='not_found');}
   if(op==='reconnect')await reconnect(n);
   if(op==='reapprove')await reapprove(n);
   if(op==='designation')await designation();
   if(op==='wait')advance(61*SEC+random.int(20)*MIN);
   if(op==='tick'){advance(random.int(4)*20*SEC);await tick();}
   advance(random.int(8)*SEC);
   await check(`seed ${random.seed} step ${step} (${op})`);
  }
  // Drain: everything ends or expires, and stays consistent.
  advance(2*DAY);await tick();await check(`seed ${random.seed} final`);
  for(let n=1;n<=N;n++)for(const [k,r] of await h.rows(n,'sig/in/'))assert.equal(r.state,'ended',`${k} terminal`);
 });
 if(TRACE)console.log(stats);
 assert.ok(stats.admitted>0&&stats.claims>0&&stats.cleared>0,`the schedule exercised admission, claims and clearing ${JSON.stringify(stats)}`);
});
