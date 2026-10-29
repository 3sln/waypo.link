// Signaling owner routes (packages/runtime/routes/signaling-owner.mjs; spec §14.1, Appendix C.2) over the durable Node
// runtime and real HTTP: session cookies, CSRF, the owner stage, two people's real account writers and the same-host
// transport. Retargeted from rtc-owner-routes.test.mjs and rtc-owner-followups.test.mjs for signaling rev 3.2: the ring,
// missed list, mutes, tickets, contact configuration and `approve-app` are gone; what remains is GET
// /api/signaling/settings, the generic controls under /api/signaling/* and the session handler approvals under
// /api/intents/session-*. The application hop is supplied as tests/signaling-runtime.test.mjs supplies it (an
// {kind:'app'} actor); session kinds are operator-registered envelopes. The silent owner end is also covered at the
// engine level (tests/helpers/signaling-fixture.mjs) and across providers (signaling-federation-fixture.mjs). Local
// behaviour only; no foreign provider, relay or push service.
import {softAuthenticator,registerPending} from './helpers/soft-passkey.mjs';
import test from 'node:test';
import {reviewed,approvals,reviewedHTTP} from './helpers/signaling-owner-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {digestJSON,versionRecord,parseEnvelope} from '../packages/core/artefacts.mjs';
import {signMessage} from '../packages/signaling/certificates.mjs';
import {offerDigest} from '../packages/signaling/messages.mjs';
import {SIGNALING_FRAGMENT} from '../packages/signaling/extension.mjs';
import {stages,settingsView,allowedMethods,admission} from '../packages/runtime/routes/signaling-owner.mjs';
import {sessionView,silentEndable} from '../packages/signaling/service.mjs';
import {kindBody,CHAT,SYNC} from './helpers/signaling-fixture.mjs';

const ORIGIN='https://signaling-owner.example',APP='https://app.example/client',APP2='https://other.example/client';
const envelope=spec=>({bindle_artefact:1,id:spec.line,kind:'intent',versions:[{version:1,prev:null,body:kindBody(spec)}]});
const KINDS=[{line:CHAT,parties:'any'},{line:SYNC,parties:'self'}],ENVELOPES=Object.fromEntries(KINDS.flatMap(k=>{const e=envelope(k);return [[k.line,e],[k.line+'/envelope',e]];}));
const REF=Object.fromEntries(await Promise.all(KINDS.map(async k=>{const e=ENVELOPES[k.line];return [k.line,{artefact:k.line,version:1,digest:await digestJSON(versionRecord(parseEnvelope(e,{id:k.line}),e.versions[0]))}];})));
const CLIENTS=JSON.stringify([{id:APP,name:'App',origin:'https://app.example',redirectUris:['https://app.example/callback']},{id:APP2,name:'Other app',origin:'https://other.example',redirectUris:['https://other.example/callback']}]);
const BASE={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS,FEDERATION_CONTRACTS:JSON.stringify(ENVELOPES)};
const ON={...BASE,SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true'},OFF={...BASE,SESSION_KINDS_ENABLED:'true'};
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}
const uniform=(r,what)=>assert.deepEqual([r.status,r.body],[404,{error:'not_found'}],what);

async function host(t,flags){
 const directory=await mkdtemp(join(tmpdir(),'signaling-owner-'));let network=1;
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',WORK_LIMITS_ENABLED:'false'}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const env={...flags,APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:app.resources.repository,ACCOUNTS:app.resources.accounts};
 const fetch=(path,{user,method='GET',value,csrf=true,origin=true}={})=>app.fetch(new Request(ORIGIN+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+(network++%250+1),...user?{Cookie:user.cookie}:{},...user&&csrf?{'X-CSRF-Token':user.csrf}:{},...origin?{Origin:ORIGIN}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const call=async(user,method,path,value,options={})=>{const r=await fetch(path,{user,method,value,...options});const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body};};
 const authenticator=softAuthenticator({origin:ORIGIN});
 const person=async(handle,{approve=flags.SIGNALING_ENABLED==='true'}={})=>{
  const post=(path,value)=>fetch(path,{method:'POST',value});
  const pending=await (await post('/api/auth/signup',{handle,method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));
  await registerPending(authenticator,async(path,value)=>(await post(path,value)).json(),pending);
  const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
  const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();
  const id=session.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:APP,origin:'https://app.example',grants:['grant-ok']};
  // The owner's session handler approvals (AMD-SG-I1), recorded with the adapter's P1 evidence.
  // Recorded as the approval page records it: a review, then the armed decision (packages/signaling/owner-pages.mjs).
  if(approve)await reviewed((operation,input,as)=>object.signalingDispatch(id,{operation,actor:as,input}),{kind:'owner',owner:id,parties:[APP]},approvals(APP,[REF[CHAT],REF[SYNC]]));
  return {handle:session.account.handle,id,cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,principal:{iss:ORIGIN,sub:id},identity:`${ORIGIN}/identity/${id}`,object,
   app:(operation,input)=>object.signalingDispatch(id,{operation,actor,input}),listen:input=>object.signalingListen(id,{actor,input}),owner:(operation,input)=>object.signalingDispatch(id,{operation,actor:{kind:'owner',owner:id},...input===undefined?{}:{input}})};
 };
 /** One active grant on the signaling fragment for `user` and `clientId`, written into the owner's real federation shard. */
 const grant=async(user,clientId=APP)=>{const id='g'+Math.random().toString(36).slice(2);await app.resources.federationShard(user.id).metadata.transaction(tx=>tx.set('federation/grant/'+id,{id,active:true,subject:`${ORIGIN}/entities/${user.id}`,clientId,fragment:SIGNALING_FRAGMENT,fields:['signaling'],resources:{},methods:{},createdAt:Date.now()}));return id;};
 return {app,env,fetch,call,person,grant};
}
/** A's app dials B's app back on a bound offer B's app minted for A; B's endpoint hears the invite and does not answer. */
async function ring(a,b,{ea,eb}={}){
 ea??=await a.app('signaling.register',{kinds:[CHAT]});eb??=await b.app('signaling.register',{kinds:[CHAT],label:'Laptop'});
 const {offers}=await b.app('signaling.offer',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,kind:CHAT,profile:'webrtc',principals:[a.principal],expires_in:600});
 const leg=await legKey(),opened=await a.app('signaling.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,kind:CHAT,profile:'webrtc',params:{offer:null},delegate:leg.jwk,basis:{offer:offers[0].offer}});
 const now=Math.floor(Date.now()/1000),invite=await signMessage({bindle:'signaling-message',v:1,iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',body:{kind:REF[CHAT],profile:'webrtc',answer_by:now+60,basis:{offer_digest:await offerDigest(offers[0].offer)},context:null,params:{offer:null}}},leg.privateKey);
 await a.app('signaling.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]});
 let heard={events:[],cursor:eb.cursor??0};for(let i=0;i<4&&!heard.events.some(e=>e.type==='invite'&&e.sid===opened.sid);i++)heard=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,cursor:heard.cursor,wait:2});
 assert.ok(heard.events.some(e=>e.type==='invite'&&e.sid===opened.sid),'the invite reached the minting endpoint');eb.cursor=heard.cursor;
 return {sid:opened.sid,ea,eb,offer:offers[0].offer};
}

test('owner routes: sign-in, CSRF, origin and method are enforced by the router before any signaling operation; the RTC routes are gone',async t=>{
 const h=await host(t,ON),a=await h.person('sig_csrf_a');
 assert.equal((await h.call(null,'GET','/api/signaling/settings')).status,401,'no session');
 assert.equal((await h.call(null,'POST','/api/signaling/block',{principal:a.principal})).status,401);
 assert.equal((await h.call(null,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT})).status,401);
 const noToken=await h.call(a,'POST','/api/signaling/block',{principal:a.principal},{csrf:false});assert.deepEqual([noToken.status,noToken.body.error],[403,'csrf']);
 const noOrigin=await h.call(a,'POST','/api/signaling/block',{principal:a.principal},{origin:false});assert.deepEqual([noOrigin.status,noOrigin.body.error],[403,'csrf']);
 const noTokenIntent=await h.call(a,'POST','/api/intents/session-approve',{clientId:APP,kind:REF[CHAT]},{csrf:false});assert.deepEqual([noTokenIntent.status,noTokenIntent.body.error],[403,'csrf']);
 assert.equal((await h.call(a,'GET','/api/signaling/block')).status,405);assert.equal((await h.call(a,'POST','/api/signaling/settings',{})).status,405);assert.equal((await h.call(a,'GET','/api/intents/session-approve')).status,405);
 uniform(await h.call(a,'POST','/api/signaling/ingest',{}),'system operations have no owner route');uniform(await h.call(a,'POST','/api/signaling/register',{}),'endpoint operations have no owner route');
 uniform(await h.call(a,'POST','/api/signaling/lifecycle',{}),'lifecycle has no owner route');
 for(const gone of ['/api/rtc/settings','/api/rtc/ring','/api/signaling/ring','/api/signaling/missed'])assert.equal((await h.call(a,'GET',gone)).status,404,gone);
 for(const gone of ['/api/rtc/block','/api/rtc/approve-app','/api/signaling/mute','/api/signaling/revoke-ticket','/api/signaling/set-contact-rtc','/api/signaling/approve-app','/api/intents/session-handoff'])uniform(await h.call(a,'POST',gone,{}),gone);
 // Nothing was blocked by any refused request.
 assert.deepEqual((await h.call(a,'GET','/api/signaling/settings')).body.blocked,[]);
 const features=(await h.call(a,'GET','/api/session')).body.features;assert.equal(features.signalingEnabled,true,'the session features carry the flag');assert.equal(Object.hasOwn(features,'rtcSignalingEnabled'),false);
});

test('owner routes with signaling on: settings, CAS policy, approvals, sessions and the silent end, blocks, endpoints and offers',async t=>{
 const h=await host(t,ON),a=await h.person('sig_alice'),b=await h.person('sig_bob');
 let s=(await h.call(b,'GET','/api/signaling/settings')).body;
 assert.deepEqual(Object.keys(s).sort(),['apps','blocked','blockedIssuers','enabled','pairings','policy','sessions']);
 assert.equal(s.enabled,true);assert.deepEqual(s.policy,{other:'relay',self:'all',revision:0},'relay only with other entities by default');
 assert.deepEqual(s.apps.map(x=>[x.clientId,x.name,x.approvals.map(p=>p.kind).sort()]),[[APP,null,[CHAT,SYNC].sort()]],'an app with approvals but no grant is listed, unnamed');
 for(const key of ['pairings','blocked','blockedIssuers','sessions'])assert.deepEqual(s[key],[],key);
 // IP policy: compare-and-swap on revision (§14.1 "Concurrent edits").
 assert.deepEqual((await h.call(b,'POST','/api/signaling/set-policy',{revision:0,other:'public'})).body,{other:'public',self:'all',revision:1});
 const stale=await h.call(b,'POST','/api/signaling/set-policy',{revision:0,other:'relay'});assert.deepEqual([stale.status,stale.body],[409,{error:'conflict'}],'a stale interface cannot undo a newer choice');
 assert.equal((await h.call(b,'POST','/api/signaling/set-policy',{revision:1,other:'relay',actor:{kind:'owner',owner:a.id}})).status,400,'no member beyond the operation input, never an actor');
 assert.equal((await h.call(b,'POST','/api/signaling/set-policy',{other:'relay'})).status,400,'the revision is required');
 assert.deepEqual((await h.call(b,'POST','/api/signaling/set-policy',{revision:1,other:'relay'})).body,{other:'relay',self:'all',revision:2});
 // A pending session: the recipient's settings list it (pre-claim data only); the owner ends it silently.
 const {sid,ea,eb}=await ring(a,b);
 s=(await h.call(b,'GET','/api/signaling/settings')).body;const live=s.sessions.find(x=>x.sid===sid);
 assert.deepEqual(Object.keys(live).sort(),['answerBy','claimed','clientId','createdAt','endsAt','initiatorOrigin','kind','own','peer','profile','role','sid','state']);
 assert.deepEqual([live.role,live.state,live.claimed,live.initiatorOrigin,live.kind,live.own],['recipient','pending',false,'https://app.example',CHAT,false]);assert.deepEqual(live.peer,a.principal);
 const app=s.apps.find(x=>x.clientId===APP);assert.equal(app.endpoints.length,1);assert.equal(app.endpoints[0].label,'Laptop');
 assert.equal(app.offers.length,1,'the spent bound offer is still listed until expiry');assert.deepEqual([app.offers[0].principal,app.offers[0].uses,app.offers[0].spent],[a.principal,1,1]);
 for(const forbidden of ['endpoint_secret','secretHash','offer"','invite','certificate','delegate'])assert.equal(JSON.stringify(s).includes(`"${forbidden}`),false,forbidden);
 const before=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,wait:0});
 assert.deepEqual((await h.call(b,'POST','/api/signaling/end-session',{sid,initiator:a.principal})).body,{sid,state:'ended',silent:true});
 const told=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,cursor:eb.cursor,wait:1});
 assert.deepEqual(told.events.filter(e=>e.type==='state'&&e.sid===sid).map(e=>[e.state,e.control??null]),[['ended',null]],'the owner\'s own endpoint stops, without a control statement');
 const after=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:before.cursor,wait:1});assert.deepEqual(after.events,[],'the initiator learns nothing (§8.5)');
 assert.equal((await h.call(a,'GET','/api/signaling/settings')).body.sessions.find(x=>x.sid===sid)?.state,'pending','the initiator keeps its pending session until answer_by');
 assert.deepEqual((await h.call(b,'GET','/api/signaling/settings')).body.sessions,[],'nothing left for the owner');
 assert.deepEqual((await h.call(b,'POST','/api/signaling/end-session',{sid,initiator:a.principal})).body,{sid,state:'ended'},'ending an ended record changes nothing');
 uniform(await h.call(b,'POST','/api/signaling/end-session',{sid:'z'.repeat(22),initiator:a.principal}),'unknown session');
 uniform(await h.call(b,'POST','/api/signaling/end-session',{sid}),'without the initiator the recipient record is not named');
 assert.equal((await h.call(b,'POST','/api/signaling/end-session',{sid,initiator:a.principal,silent:true})).status,400,'no `silent` member: the provider decides');
 // The initiator may end its own pending session.
 assert.deepEqual((await h.call(a,'POST','/api/signaling/end-session',{sid})).body,{sid,state:'ended'});
 // Principal and provider blocks; the own principal and own issuer cannot be blocked.
 assert.deepEqual((await h.call(b,'POST','/api/signaling/block',{principal:a.principal})).body,{blocked:true});
 assert.deepEqual((await h.call(b,'POST','/api/signaling/block',{issuer:'https://spam.example'})).body,{blocked:true});
 s=(await h.call(b,'GET','/api/signaling/settings')).body;
 assert.deepEqual(s.blocked.map(x=>[x.principal.sub,x.handle]),[[a.id,a.handle]],'a same-host principal shows its verified handle');assert.deepEqual(s.blockedIssuers.map(x=>x.issuer),['https://spam.example']);
 assert.equal((await h.call(b,'POST','/api/signaling/block',{principal:b.principal})).status,400,'never the own principal');
 assert.equal((await h.call(b,'POST','/api/signaling/block',{issuer:ORIGIN})).status,400,'never the own issuer');
 assert.deepEqual((await h.call(b,'POST','/api/signaling/unblock',{principal:a.principal})).body,{blocked:false});
 assert.deepEqual((await h.call(b,'POST','/api/signaling/unblock',{issuer:'https://spam.example'})).body,{blocked:false});
 // Offers: the owner revokes one by id (the stored digest, never a token), all of an app's, or all.
 const {offers:[open]}=await b.app('signaling.offer',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,kind:CHAT,profile:'webrtc',uses:3,expires_in:600});
 const listed=(await h.call(b,'GET','/api/signaling/settings')).body.apps.find(x=>x.clientId===APP).offers.find(o=>o.principal===null);
 assert.equal(listed.id,await offerDigest(open.offer));assert.equal(JSON.stringify((await h.call(b,'GET','/api/signaling/settings')).body).includes(open.offer),false,'never the token');
 assert.deepEqual((await h.call(b,'POST','/api/signaling/revoke-offers',{id:listed.id})).body,{revoked:1});uniform(await h.call(b,'POST','/api/signaling/revoke-offers',{id:listed.id}),'already revoked');
 assert.equal((await h.call(b,'POST','/api/signaling/revoke-offers',{id:listed.id,all:true})).status,400,'exactly one selector');
 assert.deepEqual((await h.call(b,'POST','/api/signaling/revoke-offers',{all:true})).body,{revoked:1},'the spent bound offer, still live until expiry');
 // Endpoints.
 const endpoint=(await h.call(b,'GET','/api/signaling/settings')).body.apps.find(x=>x.clientId===APP).endpoints[0].endpoint;
 assert.deepEqual((await h.call(b,'POST','/api/signaling/revoke-endpoint',{endpoint})).body,{revoked:true});uniform(await h.call(b,'POST','/api/signaling/revoke-endpoint',{endpoint}),'already removed');
 // Owner routes act only on the signed-in owner: A sees none of B's state.
 const other=(await h.call(a,'GET','/api/signaling/settings')).body;assert.deepEqual([other.blocked,other.blockedIssuers,other.pairings],[[],[],[]]);assert.equal(other.policy.revision,0);
 uniform(await h.call(a,'POST','/api/signaling/revoke-endpoint',{endpoint:eb.endpoint}),'another owner\'s endpoint is unknown here');
});

test('approvals over the real runtime: session-approve needs the app\'s live signaling grant; unapprove ends the kind\'s sessions and registrations at once; auto-connect only for a self kind',async t=>{
 const h=await host(t,ON),a=await h.person('sig_approve_a'),b=await h.person('sig_approve_b',{approve:false});
 // Without a grant on the signaling fragment, the widening is the uniform 404 (P1 evidence comes only from the grants).
 uniform(await h.call(b,'POST','/api/intents/session-approve',{clientId:APP,kind:REF[CHAT]}),'no grant, no approval');
 await h.grant(b);
 const post=(user,path,value)=>h.call(user,'POST',path,value);
 assert.deepEqual((await post(b,'/api/intents/session-approve',{clientId:APP,kind:REF[CHAT]})).body.error,'review_required','only the approval page records an approval');
 const [ok]=await reviewedHTTP((path,value)=>post(b,path,value),[{path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP,kind:REF[CHAT]}}]);assert.equal(ok.status,200,JSON.stringify(ok.body));
 assert.deepEqual(ok.body,{kind:CHAT,clientId:APP,version:1,autoConnect:false});
 assert.equal((await h.call(b,'POST','/api/intents/session-approve',{clientId:APP,kind:REF[CHAT],actor:{kind:'owner',owner:a.id,parties:[APP]}})).status,400,'never an actor from the body');
 assert.equal((await h.call(b,'POST','/api/intents/session-approve',{clientId:APP,kind:{...REF[CHAT],digest:'sha256-'+'B'.repeat(43)}})).status,400,'a kind version the provider does not hold');
 uniform(await h.call(b,'POST','/api/intents/session-approve',{clientId:APP2,kind:REF[CHAT]}),'another app holds no grant');
 let s=(await h.call(b,'GET','/api/signaling/settings')).body;
 assert.deepEqual(s.apps.map(x=>[x.clientId,x.name,x.origin,x.approvals.map(p=>[p.kind,p.version,p.digest,p.autoConnect,p.title?.en])]),[[APP,'App','https://app.example',[[CHAT,1,REF[CHAT].digest,false,'Kind']]]]);
 // Auto-connect: only for a `parties: self` kind, and only on an existing approval.
 assert.equal((await h.call(b,'POST','/api/intents/session-auto-connect',{clientId:APP,kind:CHAT,autoConnect:true})).status,400,'CHAT is not a self kind');
 uniform(await h.call(b,'POST','/api/intents/session-auto-connect',{clientId:APP,kind:SYNC,autoConnect:true}),'no SYNC approval yet');
 assert.equal((await reviewedHTTP((path,value)=>post(b,path,value),[{path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP,kind:REF[SYNC]},extra:{autoConnect:true}}]))[0].status,200);
 assert.deepEqual((await h.call(b,'POST','/api/intents/session-auto-connect',{clientId:APP,kind:SYNC,autoConnect:false})).body,{autoConnect:false});
 // A connected session on CHAT: unapproving CHAT ends it at once (a control statement to the initiator, a claimed
 // session), removes the endpoint registered only for CHAT, and the app may not register for it again.
 const {sid,ea,eb}=await ring(a,b);const leg=await legKey();await b.app('signaling.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid,outcome:'accept',delegate:leg.jwk});
 assert.equal((await h.call(b,'GET','/api/signaling/settings')).body.sessions.find(x=>x.sid===sid).state,'connected');
 const before=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,wait:0});
 const r=await h.call(b,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT});
 assert.deepEqual([r.status,r.body],[200,{removed:true,ended:1}]);
 s=(await h.call(b,'GET','/api/signaling/settings')).body;
 assert.equal(s.sessions.some(x=>x.sid===sid),false,'the session for the removed kind ended');
 assert.deepEqual(s.apps.find(x=>x.clientId===APP).endpoints,[],'the endpoint registered only for CHAT no longer listens');
 await assert.rejects(b.app('signaling.register',{kinds:[CHAT]}),e=>e.code==='approval_required');
 let told={events:[]};for(let i=0;i<4&&!told.events.some(e=>e.sid===sid&&e.type==='state');i++)told=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:before.cursor,wait:2});
 const end=told.events.find(e=>e.sid===sid&&e.type==='state');assert.equal(end?.state,'ended');assert.ok(end.control,'the initiator of a claimed session is told with a control statement');
 // Narrowing is idempotent and never needs a grant.
 assert.deepEqual((await h.call(b,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT})).body,{removed:false,ended:0});
 assert.deepEqual((await h.call(a,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT})).body,{removed:true,ended:0},'A holds no grant, and may still narrow');
});

test('owner routes with signaling off: widening answers the uniform 404, byte-identical to an unknown path; reads, narrowing and ending stay available',async t=>{
 for(const flags of [OFF,{...BASE,SIGNALING_ENABLED:'true'}]){
  const h=await host(t,flags),a=await h.person('sig_off_a'+(flags.SIGNALING_ENABLED?'2':''),{approve:false}),b=await h.person('sig_off_b'+(flags.SIGNALING_ENABLED?'2':''),{approve:false});
  await h.grant(a);
  uniform(await h.call(a,'GET','/api/no-such-route'),'baseline');
  assert.equal((await h.call(a,'GET','/api/session')).body.features.signalingEnabled,false);
  const s=(await h.call(a,'GET','/api/signaling/settings')).body;assert.equal(s.enabled,false);assert.equal(s.policy.other,'relay');
  for(const [path,value] of [['/api/signaling/unblock',{principal:b.principal}],['/api/signaling/set-policy',{revision:0,other:'public'}],['/api/signaling/pairing-create',{kind:REF[SYNC],local:{client_id:APP,client_session:null},peer:{self:{client_id:APP2,client_session:null}},opens:'both',label:'x'}],['/api/signaling/pairing-activate',{id:'pr_'+'A'.repeat(22),revision:1}],['/api/signaling/set-service',{designated:true,revision:0}],['/api/intents/session-approve',{clientId:APP,kind:REF[CHAT]}],['/api/intents/session-auto-connect',{clientId:APP,kind:SYNC,autoConnect:true}]])
   uniform(await h.call(a,'POST',path,value),`${path} ${JSON.stringify(value)}`);
  // Narrowing and unchanged values are never gated.
  assert.deepEqual((await h.call(a,'POST','/api/signaling/set-policy',{revision:0,other:'relay',self:'public'})).body,{other:'relay',self:'public',revision:1});
  assert.deepEqual((await h.call(a,'POST','/api/signaling/block',{principal:b.principal})).body,{blocked:true});
  assert.deepEqual((await h.call(a,'POST','/api/signaling/revoke-offers',{all:true})).body,{revoked:0});
  assert.deepEqual((await h.call(a,'POST','/api/signaling/set-service',{designated:false,revision:0})).body,{designated:false,revision:1,revoked:0});
  assert.deepEqual((await h.call(a,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT})).body,{removed:false,ended:0});
  uniform(await h.call(a,'POST','/api/signaling/end-session',{sid:'z'.repeat(22)}),'unknown session');uniform(await h.call(a,'POST','/api/signaling/pairing-remove',{id:'pr_'+'A'.repeat(22)}),'unknown pairing');
  assert.deepEqual((await h.call(a,'GET','/api/signaling/settings')).body.policy.self,'public');
  // The 404 for widening is byte-for-byte the unknown-path answer.
  const widening=await h.fetch('/api/signaling/unblock',{user:a,method:'POST',value:{principal:b.principal}}),baseline=await h.fetch('/api/no-such-route',{user:a});
  assert.equal(widening.status,baseline.status);assert.equal(await widening.text(),await baseline.text());assert.equal(widening.headers.get('Content-Type'),baseline.headers.get('Content-Type'));
 }
});

test('pairings over the owner routes: create pending, explicit activation (CAS), listing with both apps, relabel, remove; cross-entity creation needs fresh authentication and expires',async t=>{
 const h=await host(t,ON),a=await h.person('sig_pair_a'),b=await h.person('sig_pair_b');
 await h.grant(a,APP);
 const own={kind:REF[SYNC],local:{client_id:APP,client_session:null},peer:{self:{client_id:APP2,client_session:null}},opens:'both',label:'Desk to phone'};
 const page=items=>reviewedHTTP((path,value)=>h.call(a,'POST',path,value),items);
 assert.equal((await h.call(a,'POST','/api/signaling/pairing-create',{...own,activate:true})).body.error,'review_required','only the creation page creates a pairing');
 const [activating]=await page([{path:'/api/signaling/pairing-create',action:'pairing-create',input:own,extra:{activate:true}}]);
 assert.deepEqual([activating.status,activating.body.error],[409,'review_required'],'a review that showed the pairing staying inactive never carries activation (§5.8 P3)');
 const [created]=await page([{path:'/api/signaling/pairing-create',action:'pairing-create',input:own}]);assert.equal(created.status,200,JSON.stringify(created.body));
 assert.equal(created.body.state,'pending','APP2 holds no grant or approval yet, so activation waits (P1, P3)');assert.equal(created.body.expires_at,null);assert.match(created.body.id,/^pr_/);
 let s=(await h.call(a,'GET','/api/signaling/settings')).body;
 assert.deepEqual(s.pairings.map(p=>p.id),[created.body.id]);
 assert.deepEqual(s.apps.filter(x=>x.pairings.some(p=>p.id===created.body.id)).map(x=>x.clientId).sort(),[APP,APP2].sort(),'an own-entity pairing is listed with both apps (P4)');
 const preview=await h.call(a,'POST','/api/signaling/review',{action:'pairing-activate',input:{id:created.body.id,revision:1}});assert.equal(preview.body.disclosure.activateNow,false,'the activation page shows the control unavailable until every party qualifies');
 const [incomplete]=await page([{path:'/api/signaling/pairing-activate',action:'pairing-activate',input:{id:created.body.id,revision:1}}]);assert.deepEqual([incomplete.status,incomplete.body.error],[409,'pairing_parties_incomplete']);
 // APP2 gets its grant and approval; activation is still an explicit owner action.
 await h.grant(a,APP2);assert.equal((await page([{path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP2,kind:REF[SYNC]}}]))[0].status,200);
 assert.equal((await h.call(a,'GET','/api/signaling/settings')).body.pairings[0].state,'pending','approving or granting a party never activates it');
 const stale=await h.call(a,'POST','/api/signaling/pairing-activate',{id:created.body.id,revision:0});assert.deepEqual([stale.status,stale.body],[409,{error:'conflict'}]);
 const [live]=await page([{path:'/api/signaling/pairing-activate',action:'pairing-activate',input:{id:created.body.id,revision:1}}]);assert.deepEqual([live.status,live.body.state,live.body.revision],[200,'live',2]);
 const relabel=await h.call(a,'POST','/api/signaling/pairing-update',{id:created.body.id,revision:2,label:'Desk'});assert.deepEqual([relabel.body.label,relabel.body.revision],['Desk',3]);
 assert.equal((await h.call(a,'POST','/api/signaling/pairing-create',{...own,peer:{feature:'https://spec.bindle.example/extensions/x/v1'}})).status,400,'a provider feature is never a pairing party');
 assert.equal((await h.call(a,'POST','/api/signaling/pairing-create',{...own,kind:REF[CHAT],peer:{self:{client_id:APP2,client_session:null}},opens:'sideways'})).status,400);
 // Cross-entity: CHAT (parties any) with B's principal. The session authenticated just now counts as fresh.
 const [cross]=await page([{path:'/api/signaling/pairing-create',action:'pairing-create',input:{kind:REF[CHAT],local:{client_id:APP,client_session:null},peer:{principal:b.principal},opens:'local',label:'Bob'}}]);
 assert.equal(cross.status,200,JSON.stringify(cross.body));assert.ok(cross.body.expires_at>Date.now()+80*86400000,'a cross-entity pairing always expires (default 90 days)');
 const again=await h.call(a,'POST','/api/signaling/review',{action:'pairing-create',input:{kind:REF[CHAT],local:{client_id:APP,client_session:null},peer:{principal:b.principal},opens:'local',label:'Bob again'}});
 assert.deepEqual(again.body,{action:'pairing-create',review:null,refusal:{code:'pairing_exists',existing:cross.body.id}},'at most one cross-entity pairing per (peer principal, kind line); the page links to the existing one');
 assert.equal((await h.call(a,'POST','/api/signaling/pairing-create',{kind:REF[SYNC],local:{client_id:APP,client_session:null},peer:{principal:b.principal},opens:'local',label:'x'})).status,400,'a self kind admits no other party');
 // Blocking the peer deletes its pairing; removing the own-entity one deletes it.
 assert.deepEqual((await h.call(a,'POST','/api/signaling/block',{principal:b.principal})).body,{blocked:true});
 s=(await h.call(a,'GET','/api/signaling/settings')).body;assert.deepEqual(s.pairings.map(p=>p.id),[created.body.id],'the blocked peer\'s pairing is gone');
 assert.deepEqual((await h.call(a,'POST','/api/signaling/pairing-remove',{id:created.body.id})).body,{removed:true});
 uniform(await h.call(a,'POST','/api/signaling/pairing-remove',{id:created.body.id}),'already removed');
 assert.deepEqual((await h.call(a,'GET','/api/signaling/settings')).body.pairings,[]);
});

test('service designation: only an organization entity can be designated; removing is narrowing (CAS)',async t=>{
 const h=await host(t,ON),a=await h.person('sig_service_a');
 uniform(await h.call(a,'POST','/api/signaling/set-service',{designated:true,revision:0}),'a person entity cannot be designated');
 assert.deepEqual((await h.call(a,'POST','/api/signaling/set-service',{designated:false,revision:0})).body,{designated:false,revision:1,revoked:0});
 assert.deepEqual((await h.call(a,'POST','/api/signaling/set-service',{designated:false,revision:0})),{status:409,body:{error:'conflict'}});
 assert.deepEqual(await a.owner('signaling.service'),{designated:false,eligible:false,revision:1,longOffers:0});
});

test('owner stage: forwarded as the signed-in owner; P1 evidence from the live signaling grants; fresh authentication from the session; narrowing paths exempt from capacity',async()=>{
 const seen=[],id='0a0a0a0a-0000-4000-8000-000000000001';
 const object={signalingDispatch:async(owner,x)=>{seen.push([owner,structuredClone(x)]);return {ok:true};}};
 const stage=async(path,value,{env={},owner={authTime:Date.now()}}={})=>{const r=await stages.owner({request:new Request(ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),env:{APP_ORIGIN:ORIGIN,SIGNALING_ENABLED:'true',SESSION_KINDS_ENABLED:'true',EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',...env},url:new URL(ORIGIN+path),path,id,object,context:{sessionToken:'s',csrfToken:'c'},owner});return {status:r.status,body:await r.json()};};
 const grants=list=>({FEDERATION_AUTHORITY:{grants:async()=>({grants:list})}});
 const input={clientId:APP,kind:REF[CHAT]};
 assert.deepEqual(await stage('/api/intents/session-approve',input),{status:200,body:{ok:true}});
 assert.deepEqual(seen.at(-1),[id,{operation:'intents.session-approve',actor:{kind:'owner',owner:id,parties:[]},input}],'no authority: no evidence');
 await stage('/api/intents/session-approve',input,{env:grants([{active:true,clientId:APP,fragment:'https://other.example/fragment'},{active:false,clientId:APP2,fragment:SIGNALING_FRAGMENT}])});assert.deepEqual(seen.at(-1)[1].actor.parties,[],'another fragment or an inactive grant is no evidence');
 await stage('/api/intents/session-approve',input,{env:grants([{active:true,clientId:APP,fragment:SIGNALING_FRAGMENT,client:{name:'App',origin:'https://app.example'}}])});assert.deepEqual(seen.at(-1)[1].actor.parties,[APP]);
 await stage('/api/intents/session-unapprove',{clientId:APP,kind:CHAT});assert.deepEqual(seen.at(-1),[id,{operation:'intents.session-unapprove',actor:{kind:'owner',owner:id},input:{clientId:APP,kind:CHAT}}],'narrowing needs no evidence');
 const pairing={kind:REF[CHAT],local:{client_id:APP,client_session:null},peer:{principal:{iss:'https://far.example',sub:id}},opens:'local',label:'x'};
 await stage('/api/signaling/pairing-create',pairing);assert.equal(seen.at(-1)[1].actor.freshAuth,true,'authenticated within 5 minutes');
 await stage('/api/signaling/pairing-create',pairing,{owner:{authTime:Date.now()-301000}});assert.equal(seen.at(-1)[1].actor.freshAuth,false,'older than 5 minutes');
 await stage('/api/signaling/pairing-create',pairing,{owner:{}});assert.equal(seen.at(-1)[1].actor.freshAuth,false,'no authentication time');
 await stage('/api/signaling/block',{principal:{iss:'https://far.example',sub:id},actor:{kind:'owner',owner:'x'}});assert.deepEqual(seen.at(-1)[1].actor,{kind:'owner',owner:id},'the body is only the input');
 // Widening while off answers the uniform 404 before reading the body; the engine is never called.
 const n=seen.length;assert.deepEqual(await stage('/api/signaling/unblock',{principal:{iss:'https://far.example',sub:id}},{env:{SIGNALING_ENABLED:'false'}}),{status:404,body:{error:'not_found'}});assert.equal(seen.length,n);
 // Faults: not_found is the uniform 404, conflict a 409.
 object.signalingDispatch=async()=>{throw Object.assign(new Error('x'),{code:'conflict',status:409});};assert.deepEqual(await stage('/api/signaling/set-policy',{revision:0}),{status:409,body:{error:'conflict'}});
 object.signalingDispatch=async()=>{throw Object.assign(new Error('x'),{code:'not_found',status:404});};assert.deepEqual(await stage('/api/signaling/block',{}),{status:404,body:{error:'not_found'}});
 // Methods and capacity admission.
 assert.deepEqual(allowedMethods('/api/signaling/settings'),['GET']);assert.deepEqual(allowedMethods('/api/signaling/block'),['POST']);assert.deepEqual(allowedMethods('/api/intents/session-approve'),['POST']);assert.equal(allowedMethods('/api/signaling/ring'),null);
 for(const path of ['/api/signaling/block','/api/signaling/end-session','/api/signaling/revoke-endpoint','/api/signaling/revoke-offers','/api/signaling/pairing-remove','/api/signaling/set-policy','/api/intents/session-unapprove'])assert.equal(admission.exempt(path),true,path);
 for(const path of ['/api/signaling/unblock','/api/signaling/pairing-create','/api/signaling/pairing-activate','/api/intents/session-approve'])assert.equal(admission.exempt(path),false,path);
});

test('settingsView: one app entry per client id named in the state or grants; feature-owned state is not an app; pairings under both apps',()=>{
 const granted=new Map([[APP,{name:'App',origin:'https://app.example'}]]),pairing={id:'pr_x',local:{client_id:APP,client_session:null},peer:{self:{client_id:APP2,client_session:null}}};
 const view=settingsView({enabled:true,policy:{other:'relay',self:'all',revision:4,v:2},granted,
  approvals:[{kind:CHAT,handler:APP2,feature:false,version:1,digest:'d',title:null,autoConnect:false,at:1},{kind:CHAT,handler:'https://spec.bindle.example/extensions/x/v1',feature:true,version:1,digest:'d',title:null,autoConnect:false,at:1}],
  endpoints:[{endpoint:'ep_1',clientId:'https://loose.example/client',feature:null,label:null,kinds:[CHAT],lastSeen:1}],offers:[],pairings:[pairing],blocked:{blocked:[],issuers:[{issuer:'https://spam.example',at:1}]},sessions:[]});
 assert.deepEqual(view.policy,{other:'relay',self:'all',revision:4});
 assert.deepEqual(view.apps.map(a=>[a.clientId,a.name,a.approvals.length,a.endpoints.length,a.pairings.map(p=>p.id)]),[[APP,'App',0,0,['pr_x']],[APP2,null,1,0,['pr_x']],['https://loose.example/client',null,0,1,[]]]);
 assert.deepEqual(view.blockedIssuers,[{issuer:'https://spam.example',at:1}]);assert.deepEqual(view.pairings,[pairing]);
});

// ---- the silent owner end (§5.5, §8.5), engine level ------------------------------------------------------------------
import {signalingHost,standardKinds,CHAT as HOST_CHAT,OTHER_APP,subOf} from './helpers/signaling-fixture.mjs';
import {signalingWorld,A as FA,B as FB,CHAT as FED_CHAT} from './helpers/signaling-federation-fixture.mjs';

/** Entity 1's app dials entity 2's app back on an offer it minted; entity 2's devices hear the invite. */
async function hostRing(host,a,b,listeners=[b]){const out=await b.offer(HOST_CHAT,{principals:[host.principal(1)]});const s=await a.open(host.principal(2),HOST_CHAT,{basis:{offer:out.offers[0].offer}});await a.invite(s);await host.pump();for(const d of listeners)await d.listen();assert.ok(b.invites().some(e=>e.sid===s.sid));return s;}
const batchesTo=(host,n)=>host.log.batches.filter(x=>x.to===subOf(n)).length;

test('silent end: a pending incoming invite ends at the recipient only; the initiator sees exactly what an ignored invite shows',async()=>{
 const host=await signalingHost({entities:2});await standardKinds(host);
 for(const [n,client] of [[1,undefined],[2,undefined]])await host.approve(n,client??'https://app.example/client',HOST_CHAT);
 const a=host.device(1),b=host.device(2);await a.register();await b.register();
 const declined=await hostRing(host,a,b),ignored=await hostRing(host,a,b);
 await a.listen();const initiatorBefore=a.events.length,toInitiator=batchesTo(host,1);
 const out=await host.run(2,'signaling.end-session',{input:{sid:declined.sid,initiator:host.principal(1)}});
 assert.deepEqual(out,{sid:declined.sid,state:'ended',silent:true});
 // The owner's own endpoint stops: told `ended`, with no control statement.
 await b.listen();const st=b.events.filter(e=>e.type==='state'&&e.sid===declined.sid);assert.deepEqual(st.map(e=>[e.state,e.control]),[['ended',undefined]]);
 // Nothing for the initiator: no outbox row, no batch.
 assert.deepEqual((await host.rows(2,'sig/outbox/')).filter(([k])=>!k.endsWith('seq')),[]);await host.pump();assert.equal(batchesTo(host,1),toInitiator,'no batch went to the initiator');
 await a.listen();assert.equal(a.events.length,initiatorBefore,'the initiator learns nothing');
 assert.deepEqual((await host.run(1,'signaling.sessions')).sessions.filter(s=>s.role==='initiator').map(s=>s.state),['pending','pending'],'both sessions still pending at the initiator');
 // Both end alike at answer_by: the ended one and the one nobody touched (§12.1: no presence oracle).
 host.clock.advance(121000);await host.tickAll();await host.pump();await a.listen();
 const forSid=sid=>a.events.filter(e=>e.sid===sid).map(e=>e.type==='state'?`state:${e.state}`:e.type);assert.deepEqual(forSid(declined.sid),forSid(ignored.sid));
 assert.deepEqual((await host.rows(1,'sig/out/')).map(([,r])=>[r.state,r.endReason]),[['ended','timeout'],['ended','timeout']]);
 assert.equal(batchesTo(host,1),toInitiator,'still nothing from the recipient provider');
});

test('silent end matrix: claimed sessions end with a control; declined and ended records change nothing; an outgoing session is named by sid alone',async()=>{
 const host=await signalingHost({entities:2});await standardKinds(host);for(const n of [1,2])await host.approve(n,'https://app.example/client',HOST_CHAT);
 const a=host.device(1),b=host.device(2);await a.register();await b.register();
 // Claimed (answered): the owner end is not silent; the initiator gets a control statement.
 const answered=await hostRing(host,a,b);const c=await b.claim(answered.sid);await b.accept(c);await host.pump();
 assert.equal((await host.rows(2,'sig/in/')).find(([,r])=>r.sid===answered.sid)[1].state,'connected');
 const before=batchesTo(host,1);assert.deepEqual(await host.run(2,'signaling.end-session',{input:{sid:answered.sid,initiator:host.principal(1)}}),{sid:answered.sid,state:'ended'});
 await host.pump();assert.ok(batchesTo(host,1)>before,'an answered session ends with a control statement');
 await a.listen();assert.equal(a.events.filter(e=>e.sid===answered.sid&&e.type==='state').at(-1).state,'ended');
 // Declined by a device: already ended, so an owner end changes nothing and sends nothing.
 const dec=await hostRing(host,a,b);await b.claim(dec.sid,'decline');const n=batchesTo(host,1);
 assert.deepEqual(await host.run(2,'signaling.end-session',{input:{sid:dec.sid,initiator:host.principal(1)}}),{sid:dec.sid,state:'ended'});assert.equal(batchesTo(host,1),n);
 // An outgoing record is named by sid alone; naming an initiator looks for an incoming record.
 const outgoing=await hostRing(host,a,b);
 assert.equal((await host.run(1,'signaling.end-session',{input:{sid:outgoing.sid,initiator:host.principal(2)}}).catch(e=>e)).code,'not_found');
 assert.deepEqual(await host.run(1,'signaling.end-session',{input:{sid:outgoing.sid}}),{sid:outgoing.sid,state:'ended'});
 assert.equal((await host.run(2,'signaling.end-session',{input:{sid:'z'.repeat(22),initiator:host.principal(1)}}).catch(e=>e)).code,'not_found','an unknown record');
 for(const input of [{sid:outgoing.sid,silent:true},{sid:outgoing.sid,caller:host.principal(2)},{sid:1}])assert.equal((await host.run(1,'signaling.end-session',{input}).catch(e=>e)).code,'invalid_args',JSON.stringify(input));
 // The predicate and the view.
 assert.equal(silentEndable({role:'recipient',state:'pending',claim:null}),true);
 for(const r of [{role:'initiator',state:'pending'},{role:'recipient',state:'connected',claim:{}},{role:'recipient',state:'pending',claim:{outcome:'accept'}},{role:'recipient',state:'ended'}])assert.equal(silentEndable(r),false,JSON.stringify(r));
 const view=sessionView({sid:'s',role:'recipient',state:'pending',own:false,initiator:{iss:'https://x.example',sub:'u'},recipient:{iss:'https://y.example',sub:'v'},kind:{artefact:HOST_CHAT,version:1,digest:'d'},profile:'webrtc',mine:null,createdAt:1,answerBy:2,endsAt:3,claim:null,initiatorClient:{client_id:APP,origin:'https://app.example',feature:null},context:{x:1},invite:'a.b.c',params:{offer:'v=0'}});
 assert.deepEqual(Object.keys(view).sort(),['answerBy','claimed','clientId','createdAt','endsAt','initiatorOrigin','kind','own','peer','profile','role','sid','state']);
 for(const forbidden of ['context','invite','params','certificate','v=0'])assert.equal(JSON.stringify(view).includes(forbidden),false,forbidden);
});

test('silent end of an own-entity invite ends its twin the same way: no control, only own devices told',async()=>{
 const host=await signalingHost({entities:1});await standardKinds(host);await host.approve(1,'https://app.example/client',HOST_CHAT);
 const d1=host.device(1),d2=host.device(1);await d1.register();await d2.register();
 const s=await d1.open(host.principal(1),HOST_CHAT);await d1.invite(s);await host.pump();await d2.listen();assert.ok(d2.invites().some(e=>e.sid===s.sid));
 assert.deepEqual(await host.run(1,'signaling.end-session',{input:{sid:s.sid,initiator:host.principal(1)}}),{sid:s.sid,state:'ended',silent:true});
 const both=[...await host.rows(1,'sig/in/'),...await host.rows(1,'sig/out/')].map(([,r])=>r).filter(r=>r.sid===s.sid);
 assert.deepEqual(both.map(r=>[r.role,r.state]).sort(),[['initiator','ended'],['recipient','ended']]);
 assert.deepEqual((await host.rows(1,'sig/outbox/')).filter(([k])=>!k.endsWith('seq')),[]);
 await d2.listen();assert.deepEqual(d2.events.filter(e=>e.type==='state'&&e.sid===s.sid).map(e=>[e.state,e.control]),[['ended',undefined]],'the owner\'s own device stops');
 void OTHER_APP;
});

test('silent end with an initiator on another provider: nothing is posted to the initiator provider; its session ends at answer_by',async()=>{
 const W=await signalingWorld();const b=W.provider(FB).device(1),a=W.provider(FA).device(1);await b.register();await a.register();
 const s=await a.open(b.principal,FED_CHAT,{basis:await b.offer(FED_CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===s.sid));
 const postsToA=()=>W.posts.filter(p=>p.to===FA).length,before=postsToA();
 assert.deepEqual(await W.provider(FB).run(1,'signaling.end-session',{sid:s.sid,initiator:a.principal}),{sid:s.sid,state:'ended',silent:true});
 await b.listen();assert.equal(b.events.filter(e=>e.type==='state'&&e.sid===s.sid).at(-1).state,'ended');
 await W.pump();await a.listen();const seen=a.events.length;
 assert.equal(postsToA(),before,'no batch to the initiator provider');
 // The initiator's re-sent invite copies are ignored (the session exists), and it ends at answer_by.
 for(let i=0;i<16;i++){W.clock.advance(9000);await W.tickAll();await W.pump();}
 assert.equal(postsToA(),before,'still nothing to the initiator provider');
 const rec=await a.entity.store.get(`sig/out/${s.sid}`);assert.deepEqual([rec.state,rec.endReason],['ended','timeout']);
 await a.listen();assert.deepEqual(a.events.slice(seen).map(e=>e.type==='state'?`state:${e.state}`:e.type),['state:expired'],'the initiator sees only its own timeout');
});

test('AMD-X1 removed: no bound narrowing or bound check on the federation remote facade or the Worker allowlist',async()=>{
 const {federationRemote}=await import('../packages/federation/runtime.mjs'),{readFile}=await import('node:fs/promises');
 const remote=federationRemote({invoke:async()=>({ok:true,result:null})});
 for(const name of ['narrowBoundOptions','checkBound'])assert.equal(Object.hasOwn(remote,name),false,name);
 const source=await readFile(new URL('../apps/worker/federation.mjs',import.meta.url),'utf8'),allowed=JSON.parse(/const METHODS=(\[[^\]]*\])/.exec(source)[1].replaceAll("'",'"'));
 assert.deepEqual([...allowed].sort(),Object.keys(remote).sort());assert.ok(!allowed.includes('narrowBoundOptions')&&!allowed.includes('checkBound'));
});
