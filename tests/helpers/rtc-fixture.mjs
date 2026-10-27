// A loopback host of several entities for RTC-d engine tests: each entity has its own account store (SQLite in memory),
// certification key, identity signing key, RtcService and ngin engine, joined by the same-host transport
// (sameHostRtcTransport, through the real §8.2 verification path). Applications are simulated devices that hold leg
// keys and sign their own messages. Every call is a dispatched Action or Query. Local behaviour only: no foreign
// provider, no real federation service, directory, push or relay; hosts under reserved .example domains (AGENTS.md).
//
// The bound-approval port is a stand-in for FederationService.checkBound with the same rule (the union of the token's
// live grants, a pinned {version, digest} per line), using the real boundAllows. `host.network` can hold deliveries
// for chaos tests (drop, duplicate, reorder); `host.restart(sub)` rebuilds a service over the same store (a crash).
// Delivery is never synchronous (review M2): `defer` only records which entities asked for a pass (`host.kicked`), and
// `host.pump()` runs each entity's inbound queue and outbox until quiet, as the runtime's detached task does. The
// host-wide limiter (`hostLimits`, review L1) is one fixed-window map shared by every entity, as WORK_AUTHORITY is.
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../../packages/app/memory-providers.mjs';
import {boundAllows} from '../../packages/federation/extensions.mjs';
import {jwkThumbprint} from '../../packages/identity/delegation.mjs';
import {signMessage} from '../../packages/rtc/certificates.mjs';
import {linkDigest} from '../../packages/rtc/messages.mjs';
import {RTC_PURPOSE_REFERENCES} from '../../packages/rtc/purposes.mjs';
import {RtcService,rtcProvider,sameHostRtcTransport,RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_SYSTEM_OPERATIONS,RTC_RELAY_OPERATIONS,RTC_LIMIT_VALUES,RtcIngest,RtcInbox,RtcTick} from '../../packages/app/domains/rtc.mjs';
import {sdp as wireSdp,candidate as wireCandidate} from './rtc-wire-fixture.mjs';

export const ISS='https://3sln.example',APP='https://app.example',OTHER_APP='https://other-app.example',DAY=86400000;
export const [CALL,SCREEN,FILES,SYNC]=RTC_PURPOSE_REFERENCES.map(r=>r.artefact);
export const REF=Object.fromEntries(RTC_PURPOSE_REFERENCES.map(r=>[r.artefact,{purpose:r.artefact,version:r.version,digest:r.digest}]));
export const OPS=Object.fromEntries([...RTC_ENDPOINT_OPERATIONS,...RTC_OWNER_OPERATIONS,...RTC_SYSTEM_OPERATIONS,...RTC_RELAY_OPERATIONS].map(O=>[O.operation,O]));
export const subOf=n=>`0a0a0a0a-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const identityOf=sub=>`${ISS}/entities/${sub}`;
export const fault=async promise=>{try{await promise;}catch(e){return {code:e.code,status:e.status,message:e.message};}return null;};
export const rejects=(promise,code,label)=>assert.rejects(promise,e=>e.code===code||assert.fail(`${label?label+': ':''}expected ${code}, got ${e.code}: ${e.message}`));
const P256={name:'ECDSA',namedCurve:'P-256'};
async function keyPair(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
export const sdp=media=>wireSdp({media:media.map(m=>m==='data'?'application':m==='screen'?'video':m).filter((m,i,a)=>a.indexOf(m)===i)});
export const relay=(address='203.0.113.7')=>({candidate:wireCandidate('relay',{address}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const host=(address='1f3c6b2a-0000-4000-8000-000000000001.local')=>({candidate:wireCandidate('host',{address}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const rawHost=()=>({candidate:wireCandidate('host',{address:'192.168.1.20'}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const srflx=()=>({candidate:wireCandidate('srflx',{address:'198.51.100.9'}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});

/**
 * Builds the host. `entities` accounts (subOf(1..n)); `flags` names → boolean (RTC_SIGNALING_ENABLED and
 * RTC_TICKETS_ENABLED on by default; `host.flags.deny(sub, name)` turns one off for one entity). `relay(a)` (RTC-f) returns
 * the entity's RtcRelay, attached to its service.
 */
export async function rtcHost({seed=1,entities=3,start=Date.UTC(2026,9,27,12),flags={},hold=false,relay:relayFactory=null}={}){
 const clock=fakeClock(start),ids=seededRandom(createRandom(seed));
 const flagState={names:{RTC_SIGNALING_ENABLED:true,RTC_TICKETS_ENABLED:true,RTC_FOREIGN_ENABLED:false,...flags},deny:new Map()};
 const flagPort={for:ctx=>({enabled:name=>!flagState.deny.get(ctx?.subject?.owner)?.has(name)&&flagState.names[name]===true})};
 const accounts=new Map(),grants=new Map(),contacts=new Map(),network=[],log={delivered:0,dropped:0,batches:[]};
 let counter=0;const net={hold,down:new Set()},kicked=new Set(),hostWindows=new Map();
 const hostLimits={async take(name,parts){const l=RTC_LIMIT_VALUES[name],key=JSON.stringify([name,...parts]),now=clock.now(),row=hostWindows.get(key);const live=row&&row.resetAt>now?row:{count:0,resetAt:now+l.windowMs};if(live.count>=l.max)return false;hostWindows.set(key,{count:live.count+1,resetAt:live.resetAt});return true;}};
 const keys={
  // `keyless`: the entity still runs but its keys are no longer served (a tombstoned, suspended or moved identity).
  certification:async p=>{if(p.iss!==ISS)return [];const a=accounts.get(p.sub);return a&&!a.gone&&!a.keyless?a.certKeys():[];},
  identity:async p=>p.iss===ISS&&accounts.has(p.sub)&&!accounts.get(p.sub).gone?identityOf(p.sub):null,
  handle:async p=>p.iss===ISS?accounts.get(p.sub)?.handle??null:null,
  resolveHandle:async h=>{for(const a of accounts.values())if(a.handle===h&&!a.gone)return {iss:ISS,sub:a.sub};return null;},
  aep:async owner=>accounts.get(owner)?.aep??0,
 };
 // FederationService.checkBound stand-in: union of the token's active grants for (subject, client, fragment).
 const bound={async check({subject,clientId,fragment,grants:ids,member,value,reference}){
  const values={purposes:[]},versions={};
  for(const id of ids){const g=grants.get(id);if(!g||!g.active||`${ISS}/entities/${g.owner}`!==subject||g.clientId!==clientId||g.fragment!==fragment)continue;for(const l of g.purposes){if(!values.purposes.includes(l))values.purposes.push(l);versions[l]={version:REF[l].version,digest:REF[l].digest};}}
  return boundAllows(values.purposes.length?{values,versions}:null,member,value,{reference});}};
 const dispatch=async(sub,operation,input)=>{
  const a=accounts.get(sub);if(!a||a.gone)throw Object.assign(new Error('gone'),{code:'temporarily_unavailable'});
  return perform(a.engine,new OPS[operation]({actor:{kind:'system',owner:sub},input}));
 };
 const transport=sameHostRtcTransport({issuer:ISS,dispatch:async(sub,operation,input)=>{
  log.batches.push({to:sub,batch:input.batch});
  if(net.down.has(sub))throw Object.assign(new Error('down'),{code:'temporarily_unavailable'});
  if(net.hold){network.push({sub,operation,input});return {accepted:true};}
  log.delivered++;return dispatch(sub,operation,input);
 }});
 async function build(a){
  a.service=new RtcService({store:a.store,issuer:ISS,clock,random:ids,flags:flagPort,keys,signer:async()=>a.cert,linkSigner:async()=>a.link,bound,transport,defer:owner=>kicked.add(owner),hostLimits,contacts:{inspect:async link=>{const c=contacts.get(link);return c&&c.owner===a.sub&&!c.revoked?{parent:c.parent,quarantined:c.quarantined===true}:null;}}});
  a.audit=memoryAudit({clock});
  a.engine=createAppEngine({providers:{clock,random:ids,audit:a.audit,rtc:rtcProvider(a.service)}});
  // RTC-f (tests/rtc-relay.test.mjs): `relay(a)` builds the entity's RtcRelay over a.service (rebuilt on restart).
  if(relayFactory)a.relay=a.service.attachRelay(relayFactory(a));
 }
 async function add(n,{handle}={}){
  const sub=subOf(n),store=new SqliteMetadata(':memory:');await store.put('owner',sub);
  const certPair=await keyPair(),linkPair=await keyPair();
  const a={n,sub,store,handle:handle??`user${n}`,aep:0,gone:false,cert:{kid:'cert-'+n,privateKey:certPair.privateKey},certJwk:certPair.jwk,link:{kid:'sig-'+n,privateKey:linkPair.privateKey,publicJwk:linkPair.jwk},
   certKeys:()=>[{kid:'cert-'+n,use:'cert',alg:'ES256',jwk:a.certJwk,state:'active'}]};
  await build(a);accounts.set(sub,a);return a;
 }
 for(let i=1;i<=entities;i++)await add(i);
 const H={
  ISS,clock,accounts,grants,contacts,network,log,net,kicked,hostWindows,flags:{state:flagState,deny(sub,name){const s=flagState.deny.get(sub)??new Set();s.add(name);flagState.deny.set(sub,s);},allow(sub,name){flagState.deny.get(sub)?.delete(name);}},
  account:n=>accounts.get(subOf(n)),add,
  owner:n=>({kind:'owner',owner:subOf(n)}),system:n=>({kind:'system',owner:subOf(n)}),principal:n=>({iss:ISS,sub:subOf(n)}),
  /** Dispatch by wire name in entity n's engine. */
  run(n,operation,{actor,input}={}){const a=accounts.get(subOf(n)),O=OPS[operation];const op=new O({actor:actor??{kind:'owner',owner:a.sub},...input===undefined?{}:{input}});return O.prototype instanceof AppQuery?read(a.engine,op):perform(a.engine,op);},
  /** An approved application grant for entity n: {clientId, origin, grants:[id]} usable as an app actor. */
  grant(n,{clientId=APP+'/client',origin=APP,purposes=[CALL,SYNC,FILES,SCREEN],active=true}={}){const id='g'+(++counter);grants.set(id,{owner:subOf(n),clientId,fragment:'https://spec.bindle.example/slots/rtc-signaling/v1',purposes,active});return {id,clientId,origin};},
  /** With `hold`: every outbox drained into `network`, whose items are then taken (in delivery order). */
  async held(){await H.drainAll();return network.splice(0);},
  /** Every entity's outbox once (with `hold`, deliveries go to `network`). */
  async drainAll(){for(const a of accounts.values())if(!a.gone)await a.service.drain(a.sub).catch(()=>null);},
  /** Delivers held network items (chaos), after a drain of every outbox, then runs each receiver's inbound queue:
   * `random` chooses the order, `dropRate`/`dupRate` decide faults. */
  async flushNetwork({random,dropRate=0,dupRate=0}={}){
   await H.drainAll();const receivers=new Set();
   let n=0;while(network.length&&n++<10000){const i=random?random.int(network.length):0,[item]=network.splice(i,1);
    if(random&&random.chance(dropRate)){log.dropped++;continue;}
    receivers.add(item.sub);try{await dispatch(item.sub,item.operation,item.input);log.delivered++;if(random&&random.chance(dupRate))await dispatch(item.sub,item.operation,item.input);}catch{/* gone */}}
   for(const sub of receivers){const a=accounts.get(sub);if(a&&!a.gone)await perform(a.engine,new RtcInbox({actor:{kind:'system',owner:sub},input:{limit:256}})).catch(()=>null);}
  },
  /** For every entity: its inbound queue (rtc.inbox, steps 2–8), then one outbox pass (deliveries only queue at the
   * receiver), until quiet or `rounds`. */
  async pump(rounds=8){for(let r=0;r<rounds;r++){let pending=0;kicked.clear();
   for(const a of accounts.values())if(!a.gone){const inbox=await perform(a.engine,new RtcInbox({actor:{kind:'system',owner:a.sub},input:{limit:256}})).catch(()=>({processed:0}));pending+=inbox.processed;}
   for(const a of accounts.values())if(!a.gone){const out=await a.service.drain(a.sub).catch(()=>({sent:0,pending:0}));pending+=out.sent+out.pending;}
   if(!pending&&!network.length)return;if(network.length&&!net.hold)await H.flushNetwork();}},
  /** Steps 2–8 for entity n's queued batches only (no outbox pass). */
  inbox:n=>perform(accounts.get(subOf(n)).engine,new RtcInbox({actor:{kind:'system',owner:subOf(n)},input:{limit:256}})),
  async tick(n){const a=accounts.get(subOf(n));return perform(a.engine,new RtcTick({actor:{kind:'system',owner:a.sub}}));},
  async tickAll(){for(const a of accounts.values())if(!a.gone)await perform(a.engine,new RtcTick({actor:{kind:'system',owner:a.sub}}));},
  /** A crash: the service and engine are rebuilt over the same store (memory such as long-poll waiters is lost). */
  async restart(n){const a=accounts.get(subOf(n));await a.engine.dispose?.();await build(a);},
  /** Every stored rtc/ row of entity n, as [key, value]. */
  async rows(n,prefix='rtc/'){return [...await accounts.get(subOf(n)).store.list({prefix})];},
  /** rtc.ingest only (step 1 and the queue; the answer never depends on steps 2–8). */
  receive:(n,batch)=>perform(accounts.get(subOf(n)).engine,new RtcIngest({actor:{kind:'system',owner:subOf(n)},input:{batch}})),
  /** rtc.ingest, then the receiver's inbound queue (steps 2–8); returns the ingest answer. */
  async ingest(n,batch){const answer=await H.receive(n,batch);await H.inbox(n);return answer;},
  device:(n,options={})=>new Device(H,n,options),
 };
 return H;
}

/** A simulated application endpoint: its own leg keys, sequence numbers and signing. */
export class Device{
 constructor(host,n,{grant,purposes=[CALL,SYNC,FILES,SCREEN],dpop=false,label}={}){
  this.host=host;this.n=n;this.sub=subOf(n);this.grantInfo=grant??host.grant(n,{purposes});this.purposes=purposes;this.dpop=dpop;this.label=label;this.cursor=0;this.sessions=new Map();this.events=[];
 }
 get actor(){return {kind:'app',owner:this.sub,clientId:this.grantInfo.clientId,origin:this.grantInfo.origin,grants:[this.grantInfo.id],...this.jkt?{jkt:this.jkt}:{}};}
 auth(){return {endpoint:this.endpoint,...this.secret?{endpoint_secret:this.secret}:{}};}
 run(operation,input){return this.host.run(this.n,operation,{actor:this.actor,input});}
 async register(purposes=this.purposes,extra={}){
  if(this.dpop&&!this.jkt){const k=await keyPair();this.jkt=k.jkt;}
  const out=await this.run('rtc.register',{purposes,...this.label?{label:this.label}:{},...extra});this.endpoint=out.endpoint;this.secret=out.endpoint_secret;return out;
 }
 async open(to,purpose=CALL,{media=['audio','video'],basis,target,callback,leg}={}){
  leg??=await keyPair();
  const out=await this.run('rtc.open',{...this.auth(),to,purpose,media,delegate:leg.jwk,...basis?{basis}:{},...target?{target}:{},...callback!==undefined?{callback}:{}});
  const peer=typeof to==='string'?null:to;const s={sid:out.sid,role:'caller',leg,seq:0,certificate:out.certificate,aud:identityOf(peer?.sub??[...this.host.accounts.values()].find(a=>a.handle===to)?.sub),peerLeg:null,purpose,media,result:out,
   ...basis?{basisDigest:await linkDigest(basis)}:{},...out.callback?{callbackDigest:await linkDigest(out.callback)}:{}};
  this.sessions.set(out.sid,s);return s;
 }
 claims(){return this.events.filter(e=>e.type==='invite');}
 async listen(input={}){const out=await this.run('rtc.listen',{...this.auth(),cursor:this.cursor,...input});this.cursor=out.cursor;this.events.push(...out.events);
  // The caller learns the callee leg from the first message of that leg (its accept).
  for(const e of out.events)if(e.type==='message'){const p=payloadOf(e.message),s=this.sessions.get(e.sid);if(s&&!s.peerLeg)s.peerLeg=p.leg;}
  return out;}
 async claim(sid,outcome='accept',{leg}={}){
  leg??=await keyPair();const invite=this.events.find(e=>e.type==='invite'&&e.sid===sid);
  const out=await this.run('rtc.claim',{...this.auth(),sid,outcome,delegate:leg.jwk});
  const callerLeg=invite?JSON.parse(Buffer.from(invite.invite.split('.')[1],'base64url')).leg:null;
  const s={sid,role:'callee',leg,seq:0,certificate:out.certificate,aud:invite?identityOf(invite.projection.caller.sub):null,peerLeg:callerLeg,result:out,purpose:invite?.projection.purpose.purpose,media:invite?.projection.media};
  this.sessions.set(sid,s);return s;
 }
 /** Signs one message for session `s`: `seq` defaults to the next one. */
 async sign(s,type,body,{seq,to,iat}={}){
  const claims={bindle:'rtc-message',v:1,iss:ISS,sub:this.sub,aud:s.aud,sid:s.sid,leg:s.leg.jkt,to:to!==undefined?to:['invite','cancel'].includes(type)?null:s.peerLeg,seq:seq??s.seq,iat:iat??Math.floor(this.host.clock.now()/1000),type,body};
  if(seq===undefined)s.seq++;return signMessage(claims,s.leg.privateKey);
 }
 send(s,messages){return this.run('rtc.send',{...this.auth(),sid:s.sid,messages});}
 inviteBody(s,extra={}){return {purpose:REF[s.purpose],media:s.media,ring_until:Math.floor(this.host.clock.now()/1000)+60,basis:s.basisDigest?{link_digest:s.basisDigest}:null,context:null,offer:null,callback_digest:s.callbackDigest??null,sas_commit:null,...extra};}
 async invite(s,extra={}){return this.send(s,[await this.sign(s,'invite',this.inviteBody(s,extra))]);}
 async accept(s,{answer=null}={}){return this.send(s,[await this.sign(s,'accept',{answer,sas_nonce:null})]);}
 async decline(s){return this.send(s,[await this.sign(s,'decline',{reason:'declined'})]);}
 async cancel(s){return this.send(s,[await this.sign(s,'cancel',{})]);}
 async end(s){return this.send(s,[await this.sign(s,'end',{reason:'hangup'})]);}
 async candidates(s,items){return this.send(s,[await this.sign(s,'candidates',{gen:0,items,complete:false})]);}
 async offer(s){return this.send(s,[await this.sign(s,'sdp',{gen:1,description:{type:'offer',sdp:sdp(s.media)}})]);}
}
/** The decoded payload of a compact JWS (tests only). */
export const payloadOf=compact=>JSON.parse(Buffer.from(compact.split('.')[1],'base64url'));
