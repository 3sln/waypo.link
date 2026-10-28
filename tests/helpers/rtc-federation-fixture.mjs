// RTC-e: two (or more) providers in one process, each with its own entities, account stores, certification keys,
// IdentityDirectory, key roster, foreign transport and `POST /bindle/rtc` route (the real packages/runtime/routes/rtc.mjs
// handler), joined by a fake network. Every GET (manifest, `?sub=` lookup, identity document) goes through the real
// IdentityDirectory over `world.fetchFrom(origin)`, and every POST through the real rtcEgress wrapper over
// `world.egressFrom(origin)`, so allowlists, manifest validation, pins, budgets and the route's step-1 / uniform answers
// are the production code. The network can be partitioned, taken down, held (deliveries queued for chaos: reorder,
// duplicate) and observed (`world.requests`). Hosts are reserved .example names (AGENTS.md). Local behaviour only: no
// real HTTPS, DNS, push service or relay.
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../../packages/app/memory-providers.mjs';
import {approvalKey,approvalRecord} from '../../packages/rtc/approvals.mjs';
import {RTC_FEATURE,RTC_SIGNALING_FRAGMENT} from '../../packages/rtc/extension.mjs';
import {EXT} from '../../packages/core/extensions.mjs';
import {IdentityDirectory} from '../../packages/federation/directory.mjs';
import {jwkThumbprint} from '../../packages/identity/delegation.mjs';
import {signMessage} from '../../packages/rtc/certificates.mjs';
import {linkDigest} from '../../packages/rtc/messages.mjs';
import {RTC_PURPOSE_REFERENCES} from '../../packages/rtc/purposes.mjs';
import {RtcKeyRoster,foreignRtcTransport,rtcEgress} from '../../packages/rtc/federation.mjs';
import {rtcEndpoint} from '../../packages/runtime/routes/rtc.mjs';
import {RtcService,rtcProvider,sameHostRtcTransport,RTC_ENDPOINT_OPERATIONS,RTC_OWNER_OPERATIONS,RTC_SYSTEM_OPERATIONS,RtcIngest,RtcInbox,RtcTick} from '../../packages/app/domains/rtc.mjs';
import {sdp as wireSdp,candidate as wireCandidate} from './rtc-wire-fixture.mjs';

export const A='https://alpha.example',B='https://beta.example',C='https://gamma.example',APP='https://app.example',DAY=86400000;
export const [CALL,SCREEN,FILES,SYNC]=RTC_PURPOSE_REFERENCES.map(r=>r.artefact);
export const REF=Object.fromEntries(RTC_PURPOSE_REFERENCES.map(r=>[r.artefact,{purpose:r.artefact,version:r.version,digest:r.digest}]));
export const OPS=Object.fromEntries([...RTC_ENDPOINT_OPERATIONS,...RTC_OWNER_OPERATIONS,...RTC_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
const SLOT=RTC_SIGNALING_FRAGMENT;
export const identityURI=p=>`${p.iss}/identity/${p.sub}`;
export const payloadOf=compact=>JSON.parse(Buffer.from(compact.split('.')[1],'base64url'));
export const headerOf=compact=>JSON.parse(Buffer.from(compact.split('.')[0],'base64url'));
export {perform,read};
export const fault=async promise=>{try{await promise;}catch(e){return {code:e.code,status:e.status};}return null;};
const P256={name:'ECDSA',namedCurve:'P-256'};
export async function keyPair(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
export const sdp=media=>wireSdp({media:media.map(m=>m==='data'?'application':m==='screen'?'video':m).filter((m,i,a)=>a.indexOf(m)===i)});
export const relay=(address='203.0.113.7')=>({candidate:wireCandidate('relay',{address}),sdpMid:'0',sdpMLineIndex:0,usernameFragment:'abcd'});
const json=(body,status=200,maxAge=300)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':`max-age=${maxAge}`}});

/**
 * The world. `providers`: origins (each gets `entities` people). `allow`: origin -> allowlisted issuers (default: every
 * other provider). `flags`: the RTC flags for every provider (RTC_FOREIGN on by default).
 */
export async function rtcWorld({seed=1,start=Date.UTC(2026,9,27,12),providers=[A,B],entities=2,allow,flags={},maxAge=300,directoryLimits}={}){
 const clock=fakeClock(start),ids=seededRandom(createRandom(seed));
 const W={clock,providers:new Map(),requests:[],posts:[],held:[],net:{down:new Set(),cut:new Set(),hold:false,fail:null},pushes:[]};
 const cut=(a,b)=>W.net.cut.has(a+'|'+b)||W.net.cut.has(b+'|'+a);
 /** GETs from `from` (the directory's egress): faults first, then the target provider's handler. */
 W.fetchFrom=from=>async(url,init={})=>{
  const u=new URL(url);W.requests.push({from,method:init.method??'GET',url});
  if(W.net.down.has(u.origin)||cut(from,u.origin))throw Object.assign(new Error('network down'),{code:'temporarily_unavailable'});
  const p=W.providers.get(u.origin);if(!p)return json({error:'not_found'},404);return p.serve(u,init);
 };
 /** POSTs from `from` (the {send} port an adapter injects; rtcEgress wraps it with the allowlist and bounds). */
 W.egressFrom=from=>async({url,headers,body})=>{
  const u=new URL(url);W.requests.push({from,method:'POST',url});
  if(W.net.down.has(u.origin)||cut(from,u.origin)||W.net.fail?.(from,u.origin))throw Object.assign(new Error('refused'),{code:'egress_refused'});
  const p=W.providers.get(u.origin);if(!p)return {status:404,contentType:'',bytes:new Uint8Array()};
  if(W.net.hold){W.held.push({from,to:u.origin,url,headers,body});return {status:202,contentType:'',bytes:new Uint8Array()};}
  return W.deliver(from,u.origin,url,headers,body);
 };
 W.deliver=async(from,to,url,headers,body)=>{
  const p=W.providers.get(to),response=await rtcEndpoint({request:new Request(url,{method:'POST',headers:{...headers,'CF-Connecting-IP':W.providers.get(from)?.ip??'198.51.100.250'},body}),env:p.env,local:false});
  W.posts.push({from,to,status:response.status,body,at:W.clock.now()});return {status:response.status,contentType:response.headers.get('Content-Type')??'',bytes:new Uint8Array()};
 };
 /** Delivers held POSTs (chaos): `random` orders them, `dupRate` duplicates. */
 W.flushHeld=async({random,dupRate=0}={})=>{let n=0;while(W.held.length&&n++<10000){const i=random?random.int(W.held.length):0,[h]=W.held.splice(i,1);await W.deliver(h.from,h.to,h.url,h.headers,h.body);if(random?.chance(dupRate))await W.deliver(h.from,h.to,h.url,h.headers,h.body);}};
 let index=0;
 for(const origin of providers){const i=++index;W.providers.set(origin,await provider(W,origin,i,{allow:allow?.[origin]??providers.filter(o=>o!==origin),flags,maxAge,entities,ids,directoryLimits}));}
 W.provider=origin=>W.providers.get(origin);
 W.entity=(origin,n)=>W.providers.get(origin).entity(n);
 /** Every entity's inbound queue, outbox and key roster, until quiet (`rounds` bound). */
 W.pump=async(rounds=8)=>{for(const p of W.providers.values())await p.syncApprovals();for(let r=0;r<rounds;r++){let work=0;
  for(const p of W.providers.values())for(const e of p.entities.values())if(!e.gone){const inbox=await perform(e.engine,new RtcInbox({actor:{kind:'system',owner:e.sub},input:{limit:256}})).catch(()=>({processed:0}));work+=inbox.processed;}
  for(const p of W.providers.values())for(const e of p.entities.values())if(!e.gone){const out=await e.service.drain(e.sub).catch(()=>({sent:0,pending:0}));work+=out.sent;const ros=await e.roster.run({limit:8});work+=ros.fetched>0&&r<2?1:0;}
  if(!work)return;}};
 W.tickAll=async()=>{for(const p of W.providers.values())for(const e of p.entities.values())if(!e.gone){await perform(e.engine,new RtcTick({actor:{kind:'system',owner:e.sub}})).catch(()=>null);await e.roster.run({limit:8});}};
 return W;
}

async function provider(W,origin,i,{allow,flags,maxAge,entities,ids,directoryLimits}){
 const P={origin,ip:`198.51.100.${i}`,entities:new Map(),allow,maxAge,grants:new Map(),counter:0,
  flags:{RTC_SIGNALING_ENABLED:true,RTC_TICKETS_ENABLED:true,RTC_FOREIGN_ENABLED:true,...flags},
  manifestFeature:{endpoint:`${origin}/bindle/rtc`,max_leg_certificate_seconds:600},manifestPatch:null,directoryPatch:null,documentPatch:null,abuse:new Map()};
 const subOf=n=>`0a0a0a0a-000${i}-4000-8000-${n.toString(16).padStart(12,'0')}`;
 P.manifest=()=>({version:'0',issuer:origin,authorization_request_endpoint:`${origin}/requests`,authorization_endpoint:`${origin}/authorize`,token_endpoint:`${origin}/token`,rpc_endpoint:`${origin}/bindle/rpc`,jwks_uri:`${origin}/jwks`,preferences_contract:'https://contracts.example/preferences',login_presentation:['redirect'],dpop_signing_alg_values_supported:['ES256'],
  // Extensions rev 3.2: `extensions: [{spec, options}]`; the legacy rtc extension needs directory and artefact-versions.
  extensions:[{spec:EXT.directory,options:{directory_url:`${origin}/directory`}},{spec:EXT.artefactVersions,options:{}},...P.manifestFeature?[{spec:RTC_FEATURE,options:P.manifestFeature}]:[]],...P.manifestPatch??{}});
 P.document=e=>({v:1,iss:origin,sub:e.sub,kind:'person',keys:[{kid:e.sig.kid,use:'sig',alg:'ES256',jwk:e.sig.jwk,state:'active',predecessor:null,continuity:null},...e.certKeys.map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:k.jwk,state:k.state}))]});
 P.serve=async(u,init)=>{
  if(u.pathname==='/.well-known/bindle/manifest.json')return json(P.manifest(),200,P.maxAge);
  if(u.pathname==='/directory'){const sub=u.searchParams.get('sub'),e=[...P.entities.values()].find(x=>x.sub===sub&&!x.gone);if(!e)return json({error:'not_found'},404);return json({iss:origin,sub,identity:identityURI(e.principal),...P.directoryPatch?.(e)??{}},200,P.maxAge);}
  const m=/^\/identity\/([0-9a-f-]{36})\/identity\.json$/.exec(u.pathname);
  if(m){const e=[...P.entities.values()].find(x=>x.sub===m[1]&&!x.gone);if(!e)return json({error:'not_found'},404);return json(P.documentPatch?.(P.document(e))??P.document(e),200,P.maxAge);}
  return json({error:'not_found'},404);
 };
 P.env={APP_ORIGIN:origin,RTC_CLOCK:W.clock,RTC_SIGNALING_ENABLED:'true',RTC_FOREIGN_ENABLED:'true',DIRECTORY_ENABLED:'true',EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',ABUSE_HASH_KEY:'rtc-federation-test',RTC_FOREIGN_ISSUERS:JSON.stringify(allow),
  ABUSE:{consume:async(key,{windowMs,limit})=>{const now=W.clock.now(),row=P.abuse.get(key),live=row&&row.resetAt>now?row:{count:0,resetAt:now+windowMs};if(live.count>=limit)return false;P.abuse.set(key,{count:live.count+1,resetAt:live.resetAt});return true;}},
  IDENTITY_REPOSITORY:{get:async id=>{const e=[...P.entities.values()].find(x=>x.sub===id);return e&&!e.gone?{status:'active'}:null;}},
  ACCOUNTS:{get:id=>({invoke:async({method,args})=>{// Like a real writer, a gone (suspended, deleting) entity's object still answers; the route must refuse first.
   const e=[...P.entities.values()].find(x=>x.sub===id);if(method!=='rtcPeer'||!e)return {$fault:{code:'not_found',message:'Not found.',status:404}};
   try{return await perform(e.engine,new RtcIngest({actor:{kind:'system',owner:id},input:{batch:args[1].input.batch,...typeof args[1].input.source==='string'?{source:args[1].input.source}:{},...args[1].input.dark===true?{dark:true}:{}}}));}catch(error){return {$fault:{code:error.code,message:error.message,status:error.status}};}}})}};
 const flagPort={for:()=>({enabled:name=>P.flags[name]===true})};
 // Interim owner-local approval records (packages/rtc/approvals.mjs; extensions rev 3.2 removed AMD-X1), kept in step
 // with P.grants before every dispatch: a (entity, client) record is rewritten only when the union of its active
 // grants' purposes changed since the last write. TODO(signaling Appendix C.2: approvals move to intents session
 // handler approvals)
 const synced=new Map();
 P.syncApprovals=async()=>{
  const want=new Map();for(const g of P.grants.values()){const k=g.owner+'\n'+g.clientId;if(!want.has(k))want.set(k,new Set());if(g.active)for(const l of g.purposes)want.get(k).add(l);}
  for(const [k,set] of want){const value=JSON.stringify([...set].sort());if(synced.get(k)===value)continue;synced.set(k,value);
   const [owner,clientId]=k.split('\n'),e=[...P.entities.values()].find(x=>x.sub===owner);if(!e)continue;const key=await approvalKey(crypto,clientId);
   if(set.size)await e.store.put(key,approvalRecord({clientId,purposes:[...set],refs:REF,prior:await e.store.get(key),at:W.clock.now()}));else await e.store.delete(key);}
 };
 P.push={send:async(subscription,payload,options)=>{W.pushes.push({from:origin,subscription:structuredClone(subscription),payload:structuredClone(payload),options:structuredClone(options)});if(P.pushGone)throw Object.assign(new Error('gone'),{code:'push_subscription_gone'});return {accepted:true};}};
 const local=p=>p?.iss===origin;
 async function build(e){
  // Review F4: every directory of this provider shares the host-wide limiter (WORK_AUTHORITY in the adapters: a fixed
  // window per key, as P.env.ABUSE). Review F2: the roster's control path ignores RTC_FOREIGN_ENABLED, as rtcDirectory.
  e.directory=new IdentityDirectory({store:{transaction:fn=>e.store.transaction(tx=>fn({get:k=>tx.get(k),set:(k,v)=>tx.put(k,v)}))},fetch:W.fetchFrom(origin),issuers:P.allow,enabled:true,clock:()=>W.clock.now(),features:[RTC_FEATURE],feature:'rtc',tenant:e.sub,hostLimiter:P.env.ABUSE,...directoryLimits?{limits:directoryLimits}:{}});
  e.roster=new RtcKeyRoster({issuer:origin,directory:({control=false}={})=>control||P.flags.RTC_FOREIGN_ENABLED?e.directory:null,clock:()=>W.clock.now()});
  const keys={
   certification:async p=>{if(local(p)){const x=[...P.entities.values()].find(y=>y.sub===p.sub);return x&&!x.gone?x.certKeys.filter(k=>k.state==='active').map(k=>({kid:k.kid,use:'cert',alg:'ES256',jwk:k.jwk,state:'active'})):[];}return e.roster.certification(p);},
   identity:async p=>{if(local(p)){const x=[...P.entities.values()].find(y=>y.sub===p.sub);return x&&!x.gone?identityURI(x.principal):null;}return e.roster.identity(p);},
   handle:async()=>null,aep:async()=>e.aep,
   refresh:(p,kid,options)=>local(p)?false:e.roster.refresh(p,kid,options),live:list=>e.roster.live(list),track:p=>e.roster.track(p),warm:p=>e.roster.warm(p),maxLegSeconds:p=>e.roster.maxLegSeconds(p),
  };
  const sameHost=sameHostRtcTransport({issuer:origin,dispatch:async(sub,operation,input)=>{const x=[...P.entities.values()].find(y=>y.sub===sub);if(!x||x.gone)throw Object.assign(new Error('gone'),{code:'temporarily_unavailable'});return perform(x.engine,new OPS[operation]({actor:{kind:'system',owner:sub},input}));}});
  e.transport=foreignRtcTransport({issuer:origin,local:sameHost,roster:e.roster,post:rtcEgress({send:W.egressFrom(origin),issuers:P.allow}),enabled:async()=>P.flags.RTC_FOREIGN_ENABLED===true});
  e.service=new RtcService({store:e.store,issuer:origin,clock:W.clock,random:ids,flags:flagPort,keys,signer:async()=>{const k=e.certKeys.find(c=>c.kid===e.signing);return k?{kid:k.kid,privateKey:k.privateKey}:null;},linkSigner:async()=>({kid:e.sig.kid,privateKey:e.sig.privateKey,publicJwk:e.sig.jwk}),transport:e.transport,defer:()=>{},pushTransport:P.push});
  e.engine=createAppEngine({providers:{clock:W.clock,random:ids,audit:memoryAudit({clock:W.clock}),rtc:rtcProvider(e.service)}});
 }
 P.add=async n=>{
  const sub=subOf(n),store=new SqliteMetadata(':memory:');await store.put('owner',sub);
  const cert=await keyPair(),sig=await keyPair(),kid=`cert-${i}-${n}-1`;
  const e={n,sub,store,principal:{iss:origin,sub},aep:0,gone:false,sig:{kid:`sig-${i}-${n}`,jwk:sig.jwk,privateKey:sig.privateKey},certKeys:[{kid,jwk:cert.jwk,privateKey:cert.privateKey,state:'active'}],signing:kid};
  /** Publishes a new certification key (both active); `use` switches signing to it; `retire` retires the others. */
  e.addCertKey=async({use=true,retire=false}={})=>{const k=await keyPair(),id=`cert-${i}-${n}-${e.certKeys.length+1}`;e.certKeys.push({kid:id,jwk:k.jwk,privateKey:k.privateKey,state:'active'});if(use)e.signing=id;if(retire)for(const c of e.certKeys)if(c.kid!==id)c.state='retired';return id;};
  e.retireOthers=()=>{for(const c of e.certKeys)if(c.kid!==e.signing)c.state='retired';};
  await build(e);P.entities.set(n,e);return e;
 };
 P.entity=n=>P.entities.get(n);
 P.grant=(n,{clientId=APP+'/client',origin:appOrigin=APP,purposes=[CALL,SYNC,FILES,SCREEN],active=true}={})=>{const id=`g${++P.counter}`;P.grants.set(id,{owner:subOf(n),clientId,fragment:SLOT,purposes,active});return {id,clientId,origin:appOrigin};};
 P.device=(n,options={})=>new Device(W,P,n,options);
 for(let n=1;n<=entities;n++)await P.add(n);
 return P;
}

/** A simulated application endpoint on provider P's entity n: its own leg keys, sequence numbers and signing. */
export class Device{
 constructor(world,provider,n,{grant,purposes=[CALL,SYNC,FILES,SCREEN],push}={}){Object.assign(this,{world,provider,n,purposes,pushSub:push});this.entity=provider.entity(n);this.grantInfo=grant??provider.grant(n,{purposes});this.cursor=0;this.sessions=new Map();this.events=[];}
 get actor(){return {kind:'app',owner:this.entity.sub,clientId:this.grantInfo.clientId,origin:this.grantInfo.origin,grants:[this.grantInfo.id]};}
 get principal(){return this.entity.principal;}
 auth(){return {endpoint:this.endpoint,endpoint_secret:this.secret};}
 async run(operation,input){for(const p of this.world.providers.values())await p.syncApprovals();const O=OPS[operation],op=new O({actor:this.actor,input});return O.prototype instanceof AppQuery?read(this.entity.engine,op):perform(this.entity.engine,op);}
 async register(purposes=this.purposes){const out=await this.run('rtc.register',{purposes,...this.pushSub?{push:this.pushSub}:{}});this.endpoint=out.endpoint;this.secret=out.endpoint_secret;return out;}
 async mintTicket({purposes=[CALL],uses=1,expires_in=600,principal}={}){return (await this.run('rtc.mint-ticket',{purposes,uses,expires_in,...principal!==undefined?{principal}:{}})).link;}
 async open(to,purpose=CALL,{media=['audio'],basis,leg}={}){
  leg??=await keyPair();const out=await this.run('rtc.open',{...this.auth(),to,purpose,media,delegate:leg.jwk,...basis?{basis}:{}});
  const s={sid:out.sid,role:'caller',leg,seq:0,certificate:out.certificate,aud:identityURI(to),peerLeg:null,purpose,media,result:out,...basis?{basisDigest:await linkDigest(basis)}:{}};this.sessions.set(out.sid,s);return s;
 }
 async listen(){const out=await this.run('rtc.listen',{...this.auth(),cursor:this.cursor});this.cursor=out.cursor;this.events.push(...out.events);
  for(const e of out.events)if(e.type==='message'){const p=payloadOf(e.message),s=this.sessions.get(e.sid);if(s&&!s.peerLeg)s.peerLeg=p.leg;}return out;}
 invites(){return this.events.filter(e=>e.type==='invite');}
 async claim(sid,outcome='accept'){
  const leg=await keyPair(),invite=this.events.find(e=>e.type==='invite'&&e.sid===sid);
  const out=await this.run('rtc.claim',{...this.auth(),sid,outcome,delegate:leg.jwk});
  const s={sid,role:'callee',leg,seq:0,certificate:out.certificate,aud:identityURI(invite.projection.caller),peerLeg:payloadOf(invite.invite).leg,result:out,purpose:invite.projection.purpose.purpose,media:invite.projection.media};this.sessions.set(sid,s);return s;
 }
 async sign(s,type,body,{seq,iat,to}={}){const claims={bindle:'rtc-message',v:1,iss:this.principal.iss,sub:this.principal.sub,aud:s.aud,sid:s.sid,leg:s.leg.jkt,to:to!==undefined?to:['invite','cancel'].includes(type)?null:s.peerLeg,seq:seq??s.seq,iat:iat??Math.floor(this.world.clock.now()/1000)+(this.skew??0),type,body};if(seq===undefined)s.seq++;return signMessage(claims,s.leg.privateKey);}
 send(s,messages){return this.run('rtc.send',{...this.auth(),sid:s.sid,messages});}
 inviteBody(s,extra={}){return {purpose:REF[s.purpose],media:s.media,ring_until:Math.floor(this.world.clock.now()/1000)+60,basis:s.basisDigest?{link_digest:s.basisDigest}:null,context:null,offer:null,callback_digest:null,sas_commit:null,...extra};}
 async invite(s,extra={}){return this.send(s,[await this.sign(s,'invite',this.inviteBody(s,extra))]);}
 async accept(s){return this.send(s,[await this.sign(s,'accept',{answer:null,sas_nonce:null})]);}
 async candidates(s,items=[relay()]){return this.send(s,[await this.sign(s,'candidates',{gen:0,items,complete:false})]);}
 async end(s){return this.send(s,[await this.sign(s,'end',{reason:'hangup'})]);}
 async cancel(s){return this.send(s,[await this.sign(s,'cancel',{})]);}
 renew(s){return this.run('rtc.renew',{...this.auth(),sid:s.sid});}
}
