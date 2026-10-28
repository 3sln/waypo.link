// A loopback host of several entities for signaling engine tests: each entity has its own account store (SQLite in
// memory), certification key, SignalingService and ngin engine, joined by the same-host transport (through the real
// §9.2 verification path). Applications are simulated devices that hold leg keys and sign their own messages. Every
// call is a dispatched Action or Query. Local behaviour only: no foreign provider, directory, push or relay; hosts
// under reserved .example domains (AGENTS.md). Renamed and rewritten from rtc-fixture.mjs for signaling rev 3.2.
//
// Session kinds are app-published intent kinds with a `session` member (core registers none): `host.publish(spec)`
// adds one version to the in-memory `kinds` port the services read (held kinds only, never fetched). Session handler
// approvals are recorded through the owner operation `intents.session-approve` (`host.approve`), with the adapter's
// P1 evidence (`actor.parties`) supplied by the fixture from `host.connected` (apps with a live connection and grant).
// Delivery is never synchronous: `defer` records which entities asked for a pass, and `host.pump()` runs every
// entity's inbound queue and outbox until quiet. `host.network` can hold deliveries for chaos tests.
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../../packages/app/memory-providers.mjs';
import {digestJSON} from '../../packages/core/artefacts.mjs';
import {jwkThumbprint} from '../../packages/identity/delegation.mjs';
import {signMessage} from '../../packages/signaling/certificates.mjs';
import {offerDigest} from '../../packages/signaling/messages.mjs';
import {SignalingService,signalingProvider,sameHostSignalingTransport,ENDPOINT_OPERATIONS,OWNER_OPERATIONS,SYSTEM_OPERATIONS,RELAY_OPERATIONS,LIMIT_VALUES,SignalingIngest,SignalingInbox,SignalingTick} from '../../packages/app/domains/signaling.mjs';
import {sdp as wireSdp,candidate as wireCandidate} from './signaling-wire-fixture.mjs';

export const ISS='https://3sln.example',APP='https://app.example/client',OTHER_APP='https://other-app.example/client',DAY=86400000;
export const OPS=Object.fromEntries([...ENDPOINT_OPERATIONS,...OWNER_OPERATIONS,...SYSTEM_OPERATIONS,...RELAY_OPERATIONS].map(O=>[O.operation,O]));
export const subOf=n=>`0a0a0a0a-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const identityOf=sub=>`${ISS}/entities/${sub}`;
export const fault=async promise=>{try{await promise;}catch(e){return {code:e.code,status:e.status,message:e.message};}return null;};
export const rejects=(promise,code,label)=>assert.rejects(promise,e=>e.code===code||assert.fail(`${label?label+': ':''}expected ${code}, got ${e.code}: ${e.message}`));
const P256={name:'ECDSA',namedCurve:'P-256'};
export async function keyPair(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
export const sdp=()=>wireSdp({media:['audio','video','application']});
export const relay=(address='203.0.113.7')=>({candidate:wireCandidate('relay',{address}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const host=(address='1f3c6b2a-0000-4000-8000-000000000001.local')=>({candidate:wireCandidate('host',{address}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const rawHost=()=>({candidate:wireCandidate('host',{address:'192.168.1.20'}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
export const srflx=()=>({candidate:wireCandidate('srflx',{address:'198.51.100.9'}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});

/** A session-kind body (intents §4 with the AMD-SG-I1 `session` member) for `line` at `version`. */
export function kindBody({line,parties='any',profiles={webrtc:{},data:{}},bases,properties={},categories=['personal-data'],fieldCategories={},title='Kind',maxBytes=64}){
 const fields=Object.fromEntries(Object.keys(properties).map(k=>[k,{title:{en:k},categories:[...fieldCategories[k]??categories],display:'presence'}]));
 return {id:line,title:{en:title},summary:{en:title+' sessions.'},publisher:new URL(line).origin,effect:'join',capability:false,max_bytes:maxBytes,
  data:{type:'object',properties:structuredClone(properties),required:[]},disclosure:{categories:[...categories],fields},session:{v:1,parties,profiles:structuredClone(profiles),...bases?{bases:[...bases]}:{}}};
}
/** Kind lines used across tests: `SYNC` (own devices only), `CHAT` (any party, any basis), `CALLBACK` (offer only),
 * `REMOTE` (self and pairing only), `PEER` (other parties, pairing only). */
export const SYNC='https://sync.example/kinds/device-sync/v1',CHAT='https://chat.example/kinds/media/v1',CALLBACK='https://chat.example/kinds/callback/v1',REMOTE='https://remote.example/kinds/control/v1',PEER='https://peer.example/kinds/link/v1';
export const STANDARD_KINDS=Object.freeze([
 {line:SYNC,parties:'self',profiles:{data:{},webrtc:{}}},
 {line:CHAT,parties:'any',properties:{call:{type:'string',maxLength:36,format:'uuid'}}},
 {line:CALLBACK,parties:'other',profiles:{webrtc:{}},bases:['offer'],properties:{call:{type:'string',maxLength:36,format:'uuid'}}},
 {line:REMOTE,parties:'any',bases:['self','pairing']},
 {line:PEER,parties:'other',bases:['pairing']},
]);

/**
 * Builds the host. `entities` accounts (subOf(1..n)); `flags` names → boolean (SIGNALING_ENABLED and
 * SESSION_KINDS_ENABLED on by default; `host.flags.deny(sub, name)` turns one off for one entity). `organizations` lists
 * entity numbers whose entity kind is organization (service designation). `relay(a)` returns the entity's SignalingRelay.
 * `ownerPages: true` runs every service as the runtime does: owner widening actions need an owner-page review
 * (packages/signaling/owner-pages.mjs); `host.page(n, action, input, operation)` takes one and commits it once armed.
 */
export async function signalingHost({seed=1,entities=3,start=Date.UTC(2026,9,27,12),flags={},hold=false,organizations=[],relay:relayFactory=null,connections:withConnections=false,ownerPages=false}={}){
 const clock=fakeClock(start),ids=seededRandom(createRandom(seed));
 const flagState={names:{SIGNALING_ENABLED:true,SESSION_KINDS_ENABLED:true,SIGNALING_FOREIGN_ENABLED:false,...flags},deny:new Map()};
 const flagPort={for:ctx=>({enabled:name=>!flagState.deny.get(ctx?.subject?.owner)?.has(name)&&flagState.names[name]===true})};
 const accounts=new Map(),network=[],log={delivered:0,dropped:0,batches:[]},connected=new Map();
 const net={hold,down:new Set()},kicked=new Set(),hostWindows=new Map();
 // `connections: true` wires the app-connection port (§5.4 "its connection is live"): owner → clientId →
 // {state: 'live'|'paused'|'ended', generation}; an app not listed is live at generation 1. `host.disconnect`,
 // `host.reconnect` and `host.pause` change it without running any cleanup hook (as a lagging or failed hook would).
 const conns=new Map(),connState=(owner,clientId)=>conns.get(owner)?.get(clientId)??{state:'live',generation:1};
 const setConn=(owner,clientId,value)=>{const m=conns.get(owner)??new Map();m.set(clientId,value);conns.set(owner,m);};
 const connectionsPort=withConnections?{state:async(tx,owner,clientId)=>structuredClone(connState(owner,clientId))}:null;
 const hostLimits={async take(name,parts){const l=LIMIT_VALUES[name],key=JSON.stringify([name,...parts]),now=clock.now(),row=hostWindows.get(key);const live=row&&row.resetAt>now?row:{count:0,resetAt:now+l.windowMs};if(live.count>=l.max)return false;hostWindows.set(key,{count:live.count+1,resetAt:live.resetAt});return true;}};
 const keys={
  certification:async p=>{if(p.iss!==ISS)return [];const a=accounts.get(p.sub);return a&&!a.gone&&!a.keyless?a.certKeys():[];},
  identity:async p=>p.iss===ISS&&accounts.has(p.sub)&&!accounts.get(p.sub).gone?identityOf(p.sub):null,
  handle:async p=>p.iss===ISS?accounts.get(p.sub)?.handle??null:null,
  resolveHandle:async h=>{for(const a of accounts.values())if(a.handle===h&&!a.gone)return {iss:ISS,sub:a.sub};return null;},
  aep:async owner=>accounts.get(owner)?.aep??0,
 };
 // The provider-held kind versions (§3.4): line → [{version, digest, body}]. Never fetched.
 const kindStore=new Map();
 const kinds={held:ref=>{const v=kindStore.get(ref.artefact)?.find(x=>x.version===ref.version);return v&&v.digest===ref.digest?structuredClone(v.body):null;},version:(line,version)=>{const v=kindStore.get(line)?.find(x=>x.version===version);return v?{digest:v.digest,body:structuredClone(v.body)}:null;}};
 const dispatch=async(sub,operation,input)=>{const a=accounts.get(sub);if(!a||a.gone)throw Object.assign(new Error('gone'),{code:'temporarily_unavailable'});return perform(a.engine,new OPS[operation]({actor:{kind:'system',owner:sub},input}));};
 const transport=sameHostSignalingTransport({issuer:ISS,dispatch:async(sub,operation,input)=>{
  log.batches.push({to:sub,batch:input.batch});
  if(net.down.has(sub))throw Object.assign(new Error('down'),{code:'temporarily_unavailable'});
  if(net.hold){network.push({sub,operation,input});return {accepted:true};}
  log.delivered++;return dispatch(sub,operation,input);
 }});
 async function build(a){
  a.service=new SignalingService({store:a.store,issuer:ISS,clock,random:ids,flags:flagPort,keys,kinds,signer:async()=>a.cert,transport,defer:owner=>kicked.add(owner),hostLimits,connections:connectionsPort,ownerPages,entityKind:owner=>organizations.includes(accounts.get(owner)?.n)?'organization':'person'});
  a.audit=memoryAudit({clock});
  a.engine=createAppEngine({providers:{clock,random:ids,audit:a.audit,signaling:signalingProvider(a.service)}});
  // `relay(a)` builds the entity's SignalingRelay over a.service (rebuilt on restart).
  if(relayFactory)a.relay=a.service.attachRelay(relayFactory(a));
 }
 async function add(n,{handle}={}){
  const sub=subOf(n),store=new SqliteMetadata(':memory:');await store.put('owner',sub);
  const certPair=await keyPair();
  const a={n,sub,store,handle:handle??`user${n}`,aep:0,gone:false,cert:{kid:'cert-'+n,privateKey:certPair.privateKey},certJwk:certPair.jwk,certKeys:()=>[{kid:'cert-'+n,use:'cert',alg:'ES256',jwk:a.certJwk,state:'active'}]};
  await build(a);accounts.set(sub,a);connected.set(sub,new Set([APP,OTHER_APP]));return a;
 }
 for(let i=1;i<=entities;i++)await add(i);
 const H={
  ISS,clock,accounts,network,log,net,kicked,hostWindows,kindStore,connected,flags:{state:flagState,deny(sub,name){const s=flagState.deny.get(sub)??new Set();s.add(name);flagState.deny.set(sub,s);},allow(sub,name){flagState.deny.get(sub)?.delete(name);}},
  account:n=>accounts.get(subOf(n)),add,
  owner:(n,extra={})=>({kind:'owner',owner:subOf(n),parties:[...connected.get(subOf(n))??[]],...extra}),system:n=>({kind:'system',owner:subOf(n)}),principal:n=>({iss:ISS,sub:subOf(n)}),
  /** Publishes one version of a session kind (the next version of its line unless `version` is given); returns its ref. */
  async publish(spec,{version}={}){const list=kindStore.get(spec.line)??[];const v=version??list.length+1,body=kindBody(spec),digest=await digestJSON(body);list.push({version:v,digest,body});kindStore.set(spec.line,list);return {artefact:spec.line,version:v,digest};},
  ref(line,version){const v=(kindStore.get(line)??[]).find(x=>x.version===(version??(kindStore.get(line)??[]).length));return v?{artefact:line,version:v.version,digest:v.digest}:null;},
  /** Dispatch by wire name in entity n's engine. */
  async run(n,operation,{actor,input}={}){const a=accounts.get(subOf(n)),O=OPS[operation];const op=new O({actor:actor??H.owner(n),...input===undefined?{}:{input}});return O.prototype instanceof AppQuery?read(a.engine,op):perform(a.engine,op);},
  /** The owner's session handler approval of `clientId` for `line` (latest held version unless `version`). */
  approve(n,clientId,line,{version,autoConnect}={}){return H.run(n,'intents.session-approve',{input:{clientId,kind:H.ref(line,version),...autoConnect!==undefined?{autoConnect}:{}}});},
  unapprove(n,clientId,line){return H.run(n,'intents.session-unapprove',{input:{clientId,kind:line}});},
  /** An owner-page decision: the review, the fake clock moved past its arming time, then `operation` with the reviewed
   * input (plus `extra`) and the review id as adapter evidence. Returns {review, result}. */
  async page(n,action,input,operation,{extra={},actor}={}){const as=actor??H.owner(n);const review=await H.run(n,'signaling.review',{actor:as,input:{action,input}});if(!review.review)return {review,result:null};clock.set(Math.max(clock.now(),review.armAt));const result=await H.run(n,operation,{actor:{...as,review:review.review},input:{...review.input,...extra}});return {review,result};},
  async held(){await H.drainAll();return network.splice(0);},
  async drainAll(){for(const a of accounts.values())if(!a.gone)await a.service.drain(a.sub).catch(()=>null);},
  async flushNetwork({random,dropRate=0,dupRate=0}={}){
   await H.drainAll();const receivers=new Set();
   let n=0;while(network.length&&n++<10000){const i=random?random.int(network.length):0,[item]=network.splice(i,1);
    if(random&&random.chance(dropRate)){log.dropped++;continue;}
    receivers.add(item.sub);try{await dispatch(item.sub,item.operation,item.input);log.delivered++;if(random&&random.chance(dupRate))await dispatch(item.sub,item.operation,item.input);}catch{/* gone */}}
   for(const sub of receivers){const a=accounts.get(sub);if(a&&!a.gone)await perform(a.engine,new SignalingInbox({actor:{kind:'system',owner:sub},input:{limit:256}})).catch(()=>null);}
  },
  async pump(rounds=8){for(let r=0;r<rounds;r++){let pending=0;kicked.clear();
   for(const a of accounts.values())if(!a.gone){const inbox=await perform(a.engine,new SignalingInbox({actor:{kind:'system',owner:a.sub},input:{limit:256}})).catch(()=>({processed:0}));pending+=inbox.processed;}
   for(const a of accounts.values())if(!a.gone){const out=await a.service.drain(a.sub).catch(()=>({sent:0,pending:0}));pending+=out.sent+out.pending;}
   if(!pending&&!network.length)return;if(network.length&&!net.hold)await H.flushNetwork();}},
  inbox:async n=>perform(accounts.get(subOf(n)).engine,new SignalingInbox({actor:{kind:'system',owner:subOf(n)},input:{limit:256}})),
  async tick(n){const a=accounts.get(subOf(n));return perform(a.engine,new SignalingTick({actor:{kind:'system',owner:a.sub}}));},
  async tickAll(){for(const a of accounts.values())if(!a.gone)await perform(a.engine,new SignalingTick({actor:{kind:'system',owner:a.sub}}));},
  async restart(n){const a=accounts.get(subOf(n));await a.engine.dispose?.();await build(a);},
  async rows(n,prefix='sig/'){return [...await accounts.get(subOf(n)).store.list({prefix})];},
  receive:(n,batch)=>perform(accounts.get(subOf(n)).engine,new SignalingIngest({actor:{kind:'system',owner:subOf(n)},input:{batch}})),
  async ingest(n,batch){const answer=await H.receive(n,batch);await H.inbox(n);return answer;},
  device:(n,options={})=>new Device(H,n,options),
  connection:(n,clientId=APP)=>structuredClone(connState(subOf(n),clientId)),
  disconnect(n,clientId=APP){const c=connState(subOf(n),clientId);setConn(subOf(n),clientId,{state:'ended',generation:null,last:c.generation??c.last});},
  reconnect(n,clientId=APP){const c=connState(subOf(n),clientId);setConn(subOf(n),clientId,{state:'live',generation:(c.generation??c.last??0)+2});},
  pause(n,clientId=APP){const c=connState(subOf(n),clientId);setConn(subOf(n),clientId,{state:'paused',generation:(c.generation??0)+1});},
 };
 return H;
}

let grants=0;
/** A simulated application endpoint: its own leg keys, sequence numbers, offers and signing. */
export class Device{
 constructor(host,n,{clientId=APP,origin=new URL(clientId).origin,kinds=[CHAT],dpop=false,label,clientSession,memberContext,deviceLabel}={}){
  Object.assign(this,{host,n,sub:subOf(n),clientId,origin,kinds,dpop,label,clientSession,memberContext,deviceLabel});this.grant='g'+(++grants);this.cursor=0;this.sessions=new Map();this.events=[];this.offers=new Map();
 }
 get actor(){return {kind:'app',owner:this.sub,clientId:this.clientId,origin:this.origin,grants:[this.grant],...this.jkt?{jkt:this.jkt}:{},...this.clientSession!==undefined?{clientSession:this.clientSession}:{},...this.memberContext?{memberContext:true}:{},...this.deviceLabel?{deviceLabel:this.deviceLabel}:{}};}
 auth(){return {endpoint:this.endpoint,...this.secret?{endpoint_secret:this.secret}:{}};}
 run(operation,input){return this.host.run(this.n,operation,{actor:this.actor,input});}
 async register(kinds=this.kinds,extra={}){
  if(this.dpop&&!this.jkt){const k=await keyPair();this.jkt=k.jkt;}
  const out=await this.run('signaling.register',{kinds,...this.label?{label:this.label}:{},...extra});this.endpoint=out.endpoint;this.secret=out.endpoint_secret;return out;
 }
 /** `to`: a principal or handle. `basis`: {offer: token} | {relation: 'pairing'}. */
 async open(to,kind=CHAT,{profile='webrtc',params,basis,target,leg}={}){
  leg??=await keyPair();params??=profile==='webrtc'?{offer:null}:{};
  const out=await this.run('signaling.open',{...this.auth(),to,kind,profile,params,delegate:leg.jwk,...basis?{basis}:{},...target?{target}:{}});
  const peer=typeof to==='string'?null:to,cert=payloadOf(out.certificate);
  const s={sid:out.sid,role:'initiator',leg,seq:0,certificate:out.certificate,aud:identityOf(peer?.sub??[...this.host.accounts.values()].find(a=>a.handle===to)?.sub),peerLeg:null,kind:cert.kind,profile,params,result:out,
   basis:basis?.offer?{offer_digest:await offerDigest(basis.offer)}:basis?.relation?{relation:'pairing'}:null};
  this.sessions.set(out.sid,s);return s;
 }
 async offer(kind=CALLBACK,{principals,uses,expires_in=300,profile='webrtc'}={}){
  const out=await this.run('signaling.offer',{...this.auth(),kind,profile,expires_in,...principals?{principals}:{},...uses!==undefined?{uses}:{}});
  for(const o of out.offers)this.offers.set(await offerDigest(o.offer),o);return out;
 }
 revokeOffer(offers){return this.run('signaling.revoke-offer',{...this.auth(),...offers?{offers}:{}});}
 invites(){return this.events.filter(e=>e.type==='invite');}
 async listen(input={}){const out=await this.run('signaling.listen',{...this.auth(),cursor:this.cursor,...input});this.cursor=out.cursor;this.events.push(...out.events);
  for(const e of out.events)if(e.type==='message'){const p=payloadOf(e.message),s=this.sessions.get(e.sid);if(s&&!s.peerLeg)s.peerLeg=p.leg;}
  return out;}
 async claim(sid,outcome='accept',{leg}={}){
  leg??=await keyPair();const invite=this.events.find(e=>e.type==='invite'&&e.sid===sid);
  const out=await this.run('signaling.claim',{...this.auth(),sid,outcome,delegate:leg.jwk});
  const initiatorLeg=invite?payloadOf(invite.invite).leg:null;
  const s={sid,role:'recipient',leg,seq:0,certificate:out.certificate,aud:invite?identityOf(invite.projection.initiator.sub):null,peerLeg:initiatorLeg,result:out,kind:invite?.projection.kind,profile:invite?.projection.profile};
  this.sessions.set(sid,s);return s;
 }
 async sign(s,type,body,{seq,to,iat}={}){
  const claims={bindle:'signaling-message',v:1,iss:ISS,sub:this.sub,aud:s.aud,sid:s.sid,leg:s.leg.jkt,to:to!==undefined?to:['invite','cancel'].includes(type)?null:s.peerLeg,seq:seq??s.seq,iat:iat??Math.floor(this.host.clock.now()/1000),type,body};
  if(seq===undefined)s.seq++;return signMessage(claims,s.leg.privateKey);
 }
 send(s,messages){return this.run('signaling.send',{...this.auth(),sid:s.sid,messages});}
 inviteBody(s,extra={}){return {kind:s.kind,profile:s.profile,answer_by:Math.floor(this.host.clock.now()/1000)+60,basis:s.basis,context:null,params:s.params,...extra};}
 async invite(s,extra={}){return this.send(s,[await this.sign(s,'invite',this.inviteBody(s,extra))]);}
 async accept(s,params){return this.send(s,[await this.sign(s,'accept',{params:params??(s.profile==='webrtc'?{answer:null}:{})})]);}
 async decline(s){return this.send(s,[await this.sign(s,'decline',{reason:'declined'})]);}
 async cancel(s){return this.send(s,[await this.sign(s,'cancel',{})]);}
 async end(s){return this.send(s,[await this.sign(s,'end',{reason:'closed'})]);}
 async candidates(s,items){return this.send(s,[await this.sign(s,'candidates',{gen:0,items,complete:false})]);}
 async sdpOffer(s){return this.send(s,[await this.sign(s,'sdp',{gen:1,description:{type:'offer',sdp:sdp()}})]);}
 async data(s,bytes=16){return this.send(s,[await this.sign(s,'data',{payload:Buffer.alloc(bytes,7).toString('base64url')})]);}
}
/** The decoded payload of a compact JWS (tests only). */
export const payloadOf=compact=>JSON.parse(Buffer.from(compact.split('.')[1],'base64url'));
/** Publishes the standard kinds on a host and returns their refs by line. */
export async function standardKinds(host){const out={};for(const spec of STANDARD_KINDS)out[spec.line]=await host.publish(spec);return out;}
