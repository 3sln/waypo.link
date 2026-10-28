// RTC-g owner routes (packages/runtime/routes/rtc-owner.mjs) over the durable Node runtime and real HTTP: session
// cookies, CSRF, the owner stage, two people's real account writers and the same-host transport. The application hop
// (RTC-e) is supplied as tests/rtc-runtime.test.mjs supplies it: an {kind:'app'} actor; the owner approves call for
// that app through the interim owner operation rtc.approve-app (extensions rev 3.2 removed AMD-X1 and checkBound).
// Local behaviour only; no foreign provider, relay or push service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {linkService} from '../packages/runtime/account/links.mjs';
import {MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {jwkThumbprint} from '../packages/identity/delegation.mjs';
import {signMessage} from '../packages/rtc/certificates.mjs';
import {linkDigest} from '../packages/rtc/messages.mjs';
import {RTC_PURPOSE_REFERENCES} from '../packages/rtc/purposes.mjs';
import {ringable,ringIdle,heldPurposes,stages,RTC_SILENT_END_SUPPORTED} from '../packages/runtime/routes/rtc-owner.mjs';

const ORIGIN='https://rtc-owner.example',CALL=RTC_PURPOSE_REFERENCES[0],SYNC='https://spec.bindle.example/rtc-purposes/device-sync/v1';
const ON={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true',RTC_TICKETS_ENABLED:'true'};
const OFF={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'};
async function legKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);const jwk={kty:'EC',crv:'P-256',x,y};return {...pair,jwk,jkt:await jwkThumbprint(jwk)};}

async function host(t,flags){
 const directory=await mkdtemp(join(tmpdir(),'rtc-owner-'));let network=1;
 const app=await createNodeServer({directory,config:{...flags,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',WORK_LIMITS_ENABLED:'false'}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const env={...flags,APP_ORIGIN:ORIGIN,IDENTITY_REPOSITORY:app.resources.repository,ACCOUNTS:app.resources.accounts};
 const fetch=(path,{user,method='GET',value,csrf=true,origin=true}={})=>app.fetch(new Request(ORIGIN+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+(network++%250+1),...user?{Cookie:user.cookie}:{},...user&&csrf?{'X-CSRF-Token':user.csrf}:{},...origin?{Origin:ORIGIN}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const call=async(user,method,path,value,options={})=>{const r=await fetch(path,{user,method,value,...options});return {status:r.status,body:await r.json()};};
 const person=async handle=>{
  const post=(path,value)=>fetch(path,{method:'POST',value});
  const pending=await (await post('/api/auth/signup',{handle,method:'password',password:'RTC owner route fixture password, long!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();assert.ok(pending.pendingToken,JSON.stringify(pending));
  const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
  const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();
  const id=session.account.id,object=accountHandle(env,id),actor={kind:'app',owner:id,clientId:'https://app.example/client',origin:'https://app.example',grants:['grant-ok']};
  if(flags.RTC_SIGNALING_ENABLED==='true')await object.rtcDispatch(id,{operation:'rtc.approve-app',actor:{kind:'owner',owner:id},input:{clientId:actor.clientId,purposes:[CALL.artefact]}});
  return {handle:session.account.handle,id,cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,principal:{iss:ORIGIN,sub:id},identity:`${ORIGIN}/identity/${id}`,
   app:(operation,input)=>object.rtcDispatch(id,{operation,actor,input}),listen:input=>object.rtcListen(id,{actor,input})};
 };
 /** One active contact link of `user`: a contact parent issued through the core links service (the account's
  * `contacts` list, packages/links/parents.mjs), for set-contact-rtc. Legacy contact grants left the core on 2026-10-27. */
 const service=user=>linkService(app.resources.accounts.get(user.id));
 const issue=(user,extra={})=>service(user).issue(user.id,{type:MESSAGING_CONTACT_LINK_TYPE,claims:{resource:'contact',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:4096,maxMessageBytes:1024},expiresAt:Date.now()+3600000,handle:user.handle,...extra});
 const contact=async user=>(await issue(user)).jti;
 const revoke=(user,jti)=>service(user).revoke(user.id,jti);
 return {app,env,fetch,call,person,contact,issue,revoke};
}
/** A rings B for a call through B's ticket; B's app endpoint hears it and does not answer. */
async function ring(a,b){
 const ea=await a.app('rtc.register',{purposes:[CALL.artefact]}),eb=await b.app('rtc.register',{purposes:[CALL.artefact],label:'Laptop'});
 const {link}=await b.app('rtc.mint-ticket',{purposes:[CALL.artefact],uses:2,expires_in:600});
 const leg=await legKey(),opened=await a.app('rtc.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,purpose:CALL.artefact,media:['audio'],delegate:leg.jwk,basis:link});
 const now=Math.floor(Date.now()/1000),invite=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',
  body:{purpose:{purpose:CALL.artefact,version:CALL.version,digest:CALL.digest},media:['audio'],ring_until:now+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null}},leg.privateKey);
 await a.app('rtc.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]});
 const heard=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,wait:3});assert.equal(heard.events[0]?.type,'invite');
 return {sid:opened.sid,eb};
}
const uniform=(r,what)=>assert.deepEqual([r.status,r.body],[404,{error:'not_found'}],what);

test('owner routes: sign-in, CSRF, origin and method are enforced by the router before any RTC operation',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_csrf_a');
 assert.equal((await h.call(null,'GET','/api/rtc/settings')).status,401,'no session');
 assert.equal((await h.call(null,'POST','/api/rtc/block',{principal:a.principal})).status,401);
 const noToken=await h.call(a,'POST','/api/rtc/block',{principal:a.principal},{csrf:false});assert.deepEqual([noToken.status,noToken.body.error],[403,'csrf']);
 const noOrigin=await h.call(a,'POST','/api/rtc/block',{principal:a.principal},{origin:false});assert.deepEqual([noOrigin.status,noOrigin.body.error],[403,'csrf']);
 assert.equal((await h.call(a,'GET','/api/rtc/block')).status,405);assert.equal((await h.call(a,'POST','/api/rtc/settings',{})).status,405);
 uniform(await h.call(a,'POST','/api/rtc/ingest',{}),'system operations have no owner route');uniform(await h.call(a,'POST','/api/rtc/register',{}),'endpoint operations have no owner route');
 assert.equal((await h.call(a,'GET','/api/rtc/blocked')).status,404);
 assert.equal((await h.call(a,'GET','/api/rtc/block',undefined,{csrf:false})).status,405);
 // Nothing was blocked by any refused request.
 assert.deepEqual((await h.call(a,'GET','/api/rtc/settings')).body.blocked,[]);
 assert.equal((await h.call(a,'GET','/api/session')).body.features.rtcSignalingEnabled,true,'the session features carry the flag');
});

test('owner routes with RTC on: settings, policy, contact links, blocks, mutes, the ring, ending, tickets and devices',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_alice'),b=await h.person('rtc_bob');
 let s=(await h.call(b,'GET','/api/rtc/settings')).body;
 assert.equal(s.enabled,true);assert.deepEqual([s.policy.other,s.policy.self,s.policy.requests],['relay','all',[]],'relay only with other people by default');
 assert.deepEqual(s.purposes.map(p=>p.id),heldPurposes().map(p=>p.id));assert.deepEqual(s.apps,[],'no federation grants on this host');
 for(const key of ['contacts','sessions','missed','blocked','muted','tickets','endpoints'])assert.deepEqual(s[key],[],key);
 assert.deepEqual((await h.call(b,'POST','/api/rtc/set-policy',{other:'public',requests:[CALL.artefact]})).body,{other:'public',self:'all',requests:[CALL.artefact],autoAccept:{}});
 assert.equal((await h.call(b,'POST','/api/rtc/set-policy',{autoAccept:{'https://app.example/client':[CALL.artefact]}})).status,400,'only auto_accept "self" purposes');
 assert.equal((await h.call(b,'POST','/api/rtc/set-policy',{other:'relay',actor:{kind:'owner',owner:a.id}})).status,400,'no member beyond the operation input, never an actor');
 const parent=await h.contact(b);
 assert.equal((await h.call(b,'POST','/api/rtc/set-contact-rtc',{parent,purposes:[CALL.artefact]})).status,200);
 assert.deepEqual((await h.call(b,'GET','/api/rtc/settings')).body.contacts,[{parent,purposes:[CALL.artefact]}]);
 // The ring: only pre-claim data, the caller's handle because this host verified it, and the owner's own apps.
 const {sid}=await ring(a,b);
 const rung=(await h.call(b,'GET','/api/rtc/ring')).body.invites;assert.equal(rung.length,1);
 assert.deepEqual(Object.keys(rung[0]).sort(),['apps','caller','callerHandle','callerOrigin','callerOriginReportedBy','callerProvider','media','purpose','ringUntil','sid','title']);
 assert.equal(rung[0].callerOrigin,'https://app.example','the calling app\'s verified origin (spec §9.1, RTC-17)');
 assert.equal(rung[0].callerOriginReportedBy,null,'a same-host caller\'s origin is certified by this host: unlabelled (RTCs follow-up (a))');
 assert.deepEqual([rung[0].sid,rung[0].callerHandle,rung[0].purpose,rung[0].caller],[sid,a.handle,CALL.artefact,a.principal]);assert.deepEqual(rung[0].apps,[{clientId:'https://app.example/client',origin:'https://app.example'}]);
 assert.deepEqual((await h.call(a,'GET','/api/rtc/ring')).body.invites,[],'the caller is never rung by its own call');
 // A flag turned off while an invite still rings: the portal stops ringing at once (the owner stage as the router calls it).
 const offEnv={...h.env,RTC_SIGNALING_ENABLED:'false'},request=new Request(ORIGIN+'/api/rtc/ring');
 const quiet=await stages.owner({request,env:offEnv,url:new URL(request.url),path:'/api/rtc/ring',id:b.id,object:accountHandle(h.env,b.id),context:{}});assert.deepEqual(await quiet.json(),{invites:[]});
 s=(await h.call(b,'GET','/api/rtc/settings')).body;const live=s.sessions.find(x=>x.sid===sid);
 assert.deepEqual([live.role,live.state,live.peerHandle,live.held,live.claimed,live.alert,live.callerOrigin],['callee','ringing',a.handle,false,false,true,'https://app.example']);
 assert.equal(s.endpoints.length,1);assert.equal(s.endpoints[0].label,'Laptop');assert.equal(s.tickets.length,1);assert.equal(s.tickets[0].live,true);
 for(const forbidden of ['endpoint_secret','secretHash','link','invite','certificate'])assert.equal(JSON.stringify(s).includes(`"${forbidden}"`),false,forbidden);
 // A mute of the purpose silences the portal ring at once.
 assert.equal((await h.call(b,'POST','/api/rtc/mute',{kind:'purpose',value:CALL.artefact})).status,200);assert.deepEqual((await h.call(b,'GET','/api/rtc/ring')).body.invites,[]);
 assert.equal((await h.call(b,'POST','/api/rtc/unmute',{kind:'purpose',value:CALL.artefact})).status,200);assert.equal((await h.call(b,'GET','/api/rtc/ring')).body.invites.length,1);
 // Gate G1: a mute of the CALLER'S APP, set while the invite rings, silences the portal ring too (the engine's alert).
 assert.equal((await h.call(b,'POST','/api/rtc/mute',{kind:'app',value:'https://app.example/client'})).status,200);assert.deepEqual((await h.call(b,'GET','/api/rtc/ring')).body.invites,[]);
 assert.equal((await h.call(b,'GET','/api/rtc/settings')).body.sessions.find(x=>x.sid===sid).alert,false);
 assert.equal((await h.call(b,'POST','/api/rtc/unmute',{kind:'app',value:'https://app.example/client'})).status,200);assert.equal((await h.call(b,'GET','/api/rtc/ring')).body.invites.length,1);
 // Declining from the ring is the silent local end (review F1; covered in its own test); an unknown session is the
 // uniform 404. Blocking ends the ringing invite silently.
 assert.deepEqual((await h.call(b,'POST','/api/rtc/end-session',{sid,caller:a.principal,silent:true})).body,{sid,state:'ended',silent:true});
 assert.deepEqual((await h.call(b,'GET','/api/rtc/ring')).body.invites,[],'a declined invite no longer rings');
 assert.equal((await h.call(b,'POST','/api/rtc/end-session',{sid,caller:a.principal,silent:true})).status,400,'silent names only an unanswered incoming record');
 uniform(await h.call(b,'POST','/api/rtc/end-session',{sid:'z'.repeat(22),caller:a.principal}),'unknown session');
 assert.equal((await h.call(b,'POST','/api/rtc/end-session',{sid})).status,404,'without the caller the callee record is not named');
 // Blocking, then unblocking.
 assert.deepEqual((await h.call(b,'POST','/api/rtc/block',{principal:a.principal})).body,{blocked:true});assert.deepEqual((await h.call(b,'GET','/api/rtc/ring')).body.invites,[]);
 assert.deepEqual((await h.call(b,'GET','/api/rtc/settings')).body.blocked.map(x=>[x.principal.sub,x.handle]),[[a.id,a.handle]]);
 assert.deepEqual((await h.call(b,'POST','/api/rtc/unblock',{principal:a.principal})).body,{blocked:false});
 // Tickets and devices.
 const jti=(await h.call(b,'GET','/api/rtc/settings')).body.tickets[0].jti;
 assert.deepEqual((await h.call(b,'POST','/api/rtc/revoke-ticket',{jti})).body,{revoked:true});assert.equal((await h.call(b,'GET','/api/rtc/settings')).body.tickets[0].revoked,true);
 const endpoint=(await h.call(b,'GET','/api/rtc/settings')).body.endpoints[0].endpoint;
 assert.deepEqual((await h.call(b,'POST','/api/rtc/revoke-endpoint',{endpoint})).body,{revoked:true});uniform(await h.call(b,'POST','/api/rtc/revoke-endpoint',{endpoint}),'already removed');
 assert.deepEqual((await h.call(b,'POST','/api/rtc/clear-missed',{})).body.cleared>=0,true);
 // Owner routes act only on the signed-in owner: A sees none of B's state.
 const other=(await h.call(a,'GET','/api/rtc/settings')).body;assert.deepEqual([other.contacts,other.tickets,other.blocked],[[],[],[]]);
 uniform(await h.call(a,'POST','/api/rtc/revoke-ticket',{jti}),'another owner\'s ticket is unknown here');
});

test('owner routes with RTC off: widening answers the uniform 404; reads, narrowing and ending stay available; nothing rings',async t=>{
 const h=await host(t,OFF),a=await h.person('rtc_off_a'),b=await h.person('rtc_off_b');
 const unknownPath=await h.call(a,'GET','/api/no-such-route');uniform(unknownPath,'baseline');
 assert.equal((await h.call(a,'GET','/api/session')).body.features.rtcSignalingEnabled,false);
 const s=(await h.call(a,'GET','/api/rtc/settings')).body;assert.equal(s.enabled,false);assert.equal(s.policy.other,'relay');
 assert.deepEqual((await h.call(a,'GET','/api/rtc/ring')).body,{invites:[]});
 for(const [path,value] of [['/api/rtc/unblock',{principal:b.principal}],['/api/rtc/unmute',{kind:'principal',value:b.principal}],['/api/rtc/set-policy',{other:'public'}],['/api/rtc/set-policy',{self:'all',requests:[CALL.artefact]}],['/api/rtc/set-contact-rtc',{parent:'p1',purposes:[CALL.artefact]}]])
  uniform(await h.call(a,'POST',path,value),`${path} ${JSON.stringify(value)}`);
 // Narrowing and unchanged values are never gated.
 assert.equal((await h.call(a,'POST','/api/rtc/set-policy',{other:'relay',self:'public'})).status,200);
 assert.equal((await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:'p1',purposes:[]})).status,200);
 assert.deepEqual((await h.call(a,'POST','/api/rtc/block',{principal:b.principal})).body,{blocked:true});
 assert.deepEqual((await h.call(a,'POST','/api/rtc/mute',{kind:'purpose',value:CALL.artefact})).body,{muted:true});
 assert.equal((await h.call(a,'POST','/api/rtc/clear-missed',{})).status,200);
 uniform(await h.call(a,'POST','/api/rtc/revoke-ticket',{jti:'nothing'}),'unknown ticket');uniform(await h.call(a,'POST','/api/rtc/end-session',{sid:'z'.repeat(22)}),'unknown session');
 assert.deepEqual((await h.call(a,'GET','/api/rtc/settings')).body.policy.self,'public');
 // The 404 for widening is byte-for-byte the unknown-path answer.
 const widening=await h.fetch('/api/rtc/unblock',{user:a,method:'POST',value:{principal:b.principal}}),baseline=await h.fetch('/api/no-such-route',{user:a});
 assert.equal(widening.status,baseline.status);assert.equal(await widening.text(),await baseline.text());assert.equal(widening.headers.get('Content-Type'),baseline.headers.get('Content-Type'));
});

test('ringable: only unclaimed, unheld, alerting, unmuted invites from others before their deadline',()=>{
 const purposes=heldPurposes(),now=1000,peer={iss:ORIGIN,sub:'p'},base={role:'callee',state:'ringing',held:false,claimed:false,own:false,ringUntil:2000,purpose:CALL.artefact,peer,alert:true};
 assert.equal(ringable(base,{purposes,muted:[],now}),true);
 for(const change of [{alert:false},{role:'caller'},{state:'connected'},{held:true},{claimed:true},{own:true},{ringUntil:1000},{purpose:SYNC},{purpose:'https://unknown.example/p'}])assert.equal(ringable({...base,...change},{purposes,muted:[],now}),false,JSON.stringify(change));
 assert.equal(ringable(base,{purposes,muted:[{kind:'principal',value:peer}],now}),false);assert.equal(ringable(base,{purposes,muted:[{kind:'purpose',value:CALL.artefact}],now}),false);
 assert.equal(ringable(base,{purposes,muted:[{kind:'principal',value:{iss:ORIGIN,sub:'q'}}],now}),true);
});

// ——— Review follow-ups (2026-10-27) ———
test('F1: declining or ending an unanswered incoming invite sends the caller nothing (the caller rings out)',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_f1_a'),b=await h.person('rtc_f1_b');
 const ea=await a.app('rtc.register',{purposes:[CALL.artefact]}),eb=await b.app('rtc.register',{purposes:[CALL.artefact]});
 const {link}=await b.app('rtc.mint-ticket',{purposes:[CALL.artefact],uses:4,expires_in:600});
 const call=async()=>{const leg=await legKey(),opened=await a.app('rtc.open',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,to:b.principal,purpose:CALL.artefact,media:['audio'],delegate:leg.jwk,basis:link});
  const now=Math.floor(Date.now()/1000),invite=await signMessage({bindle:'rtc-message',v:1,iss:ORIGIN,sub:a.id,aud:b.identity,sid:opened.sid,leg:leg.jkt,to:null,seq:0,iat:now,type:'invite',
   body:{purpose:{purpose:CALL.artefact,version:CALL.version,digest:CALL.digest},media:['audio'],ring_until:now+60,basis:{link_digest:await linkDigest(link)},context:null,offer:null,callback_digest:null,sas_commit:null}},leg.privateKey);
  await a.app('rtc.send',{endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,sid:opened.sid,messages:[invite]});return opened.sid;};
 /** Reads B's endpoint queue from `cursor` until `count` events of `type` arrived (bounded). */
 const hear=async(cursor,predicate,count)=>{const events=[];for(let i=0;i<6&&events.filter(predicate).length<count;i++){const e=await b.listen({endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,cursor,wait:2});cursor=e.cursor;events.push(...e.events);}return {cursor,events};};
 assert.equal(RTC_SILENT_END_SUPPORTED,true,'gate G2: RtcService honours the silent end');
 // The ring's Decline (silent) and an older client's Decline (no `silent`): each ends the callee record at the provider.
 const silentSid=await call(),olderSid=await call();
 const rang=await hear(0,e=>e.type==='invite',2);assert.equal(rang.events.filter(e=>e.type==='invite').length,2);
 const before=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,wait:0});
 for(const [sid,value] of [[silentSid,{sid:silentSid,caller:a.principal,silent:true}],[olderSid,{sid:olderSid,caller:a.principal}]]){
  const r=await h.call(b,'POST','/api/rtc/end-session',value);assert.equal(r.status,200);assert.deepEqual(r.body,{sid,state:'ended',silent:true},JSON.stringify(value));
 }
 // The owner's own app stops ringing: it is told `ended`, without a control statement.
 const told=await hear(rang.cursor,e=>e.type==='state',2);
 assert.deepEqual(told.events.filter(e=>e.type==='state').map(e=>[e.sid,e.state,e.control??null]).sort(),[[silentSid,'ended',null],[olderSid,'ended',null]].sort());
 const after=await a.listen({endpoint:ea.endpoint,endpoint_secret:ea.endpoint_secret,cursor:before.cursor,wait:1});
 assert.deepEqual(after.events,[],'no state change, no revoked control: the caller learns nothing');
 const mine=(await h.call(a,'GET','/api/rtc/settings')).body.sessions;for(const sid of [silentSid,olderSid])assert.equal(mine.find(s=>s.sid===sid)?.state,'ringing','the caller simply keeps ringing until its deadline');
 const theirs=(await h.call(b,'GET','/api/rtc/settings')).body;assert.equal(theirs.sessions.length,0);assert.deepEqual(theirs.missed,[],'a declined invite is not missed');
 // Malformed silent requests are refused; a silent end of an answered call is refused and ends nothing.
 assert.equal((await h.call(b,'POST','/api/rtc/end-session',{sid:silentSid,caller:a.principal,silent:'yes'})).status,400);
 assert.equal((await h.call(b,'POST','/api/rtc/end-session',{sid:silentSid,silent:true})).status,400,'silent names an incoming record');
 const answered=await call();await hear(told.cursor,e=>e.type==='invite'&&e.sid===answered,1);const claimLeg=await legKey();
 await b.app('rtc.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid:answered,outcome:'accept',delegate:claimLeg.jwk});
 assert.equal((await h.call(b,'POST','/api/rtc/end-session',{sid:answered,caller:a.principal,silent:true})).status,400,'never a silent end of an answered call');
 assert.equal((await h.call(b,'GET','/api/rtc/settings')).body.sessions.find(s=>s.sid===answered)?.state,'connected');
 assert.deepEqual((await h.call(b,'POST','/api/rtc/end-session',{sid:answered,caller:a.principal})).body,{sid:answered,state:'ended'},'an answered call ends normally (both sides are told)');
 // The caller may end its own call.
 assert.deepEqual((await h.call(a,'POST','/api/rtc/end-session',{sid:silentSid})).body,{sid:silentSid,state:'ended'});
});

test('F2: ringable honours the session `alert` once the owner view carries it',()=>{
 const purposes=heldPurposes(),now=1000,base={role:'callee',state:'ringing',held:false,claimed:false,own:false,ringUntil:2000,purpose:CALL.artefact,peer:{iss:ORIGIN,sub:'p'}};
 assert.equal(ringable(base,{purposes,muted:[],now}),false,'absent: never rings (gate G1 closed: the engine always sends it)');
 assert.equal(ringable({...base,alert:true},{purposes,muted:[],now}),true);
 for(const alert of [false,null,undefined,'true',1])assert.equal(ringable({...base,alert},{purposes,muted:[],now}),false,String(alert));
});

test('F4: the ring answer says `idle` only while nothing could ring the portal',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_f4_a'),b=await h.person('rtc_f4_b');
 assert.deepEqual((await h.call(b,'GET','/api/rtc/ring')).body,{invites:[],idle:true},'no endpoint, contact configuration or call link');
 const parent=await h.contact(b);await h.call(b,'POST','/api/rtc/set-contact-rtc',{parent,purposes:[CALL.artefact]});assert.equal((await h.call(b,'GET','/api/rtc/ring')).body.idle,false,'a contact link can ring');
 await h.call(b,'POST','/api/rtc/set-contact-rtc',{parent,purposes:[]});assert.equal((await h.call(b,'GET','/api/rtc/ring')).body.idle,true);
 await b.app('rtc.register',{purposes:[CALL.artefact]});assert.equal((await h.call(b,'GET','/api/rtc/ring')).body.idle,false,'an endpoint can be rung');
 const purposes=heldPurposes(),empty={invites:[],endpoints:[],contacts:[],tickets:[],purposes};
 assert.equal(ringIdle(empty),true);assert.equal(ringIdle({...empty,tickets:[{live:true,purposes:[CALL.artefact]}]}),false);assert.equal(ringIdle({...empty,tickets:[{live:false,purposes:[CALL.artefact]}]}),true);
 assert.equal(ringIdle({...empty,contacts:[{parent:'p',purposes:[SYNC]}]}),true,'a purpose that never alerts');assert.equal(ringIdle({...empty,invites:[{}]}),false);
 void a;
});

test('review L6: the RTC compatibility port admits only an unconditional contact-type link as a contact basis',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_l6_a'),b=await h.person('rtc_l6_b');
 const plain=await h.issue(a),conditional=await h.issue(a,{audience:{}}),theirs=await h.issue(b),controller=h.app.resources.accounts.get(a.id);
 assert.deepEqual(await controller.endpoints.inspect(plain.link),{grant:{id:plain.jti,owner:a.id,quarantined:false}},'an unconditional contact link');
 assert.equal(await controller.endpoints.inspect(conditional.link),null,'a conditional link: its audience policy needs the caller, which the port does not receive');
 await assert.rejects(controller.endpoints.inspect(theirs.link),'another owner\'s link never verifies here');
 // The owner route refuses to configure a parent the port would never admit, with the uniform 404.
 uniform(await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:conditional.jti,purposes:[CALL.artefact]}),'a conditional link');
 assert.equal((await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:plain.jti,purposes:[CALL.artefact]})).status,200);
 await h.revoke(a,plain.jti);await assert.rejects(controller.endpoints.inspect(plain.link),'a revoked link');
});

test('F7: set-contact-rtc names one of the owner\'s active contact links; anything else is the uniform 404',async t=>{
 const h=await host(t,ON),a=await h.person('rtc_f7_a'),b=await h.person('rtc_f7_b');
 for(let i=0;i<5;i++)uniform(await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:'not-a-real-link-'+i,purposes:[CALL.artefact]}),'an invented parent');
 const mine=await h.contact(a),theirs=await h.contact(b);
 uniform(await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:theirs,purposes:[CALL.artefact]}),'another owner\'s link');
 assert.equal((await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:mine,purposes:[CALL.artefact]})).status,200);
 await h.revoke(a,mine);
 uniform(await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:mine,purposes:[CALL.artefact]}),'a revoked link');
 assert.equal((await h.call(a,'POST','/api/rtc/set-contact-rtc',{parent:mine,purposes:[]})).status,200,'a leftover configuration can always be removed');
 assert.deepEqual((await h.call(a,'GET','/api/rtc/settings')).body.contacts,[],'nothing invented was stored');
});

// ——— Interim owner approval of an app's RTC purposes from the console (extensions rev 3.2 removed AMD-X1 `bind` and
// `narrow-app`; TODO(signaling Appendix C.2: approvals move to intents session handler approvals)) ———
import {RTC_SIGNALING_FRAGMENT} from '../packages/rtc/extension.mjs';
const APP_CLIENT='https://app.example/client',FEDERATION={FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([{id:APP_CLIENT,name:'App',origin:'https://app.example',redirectUris:['https://app.example/callback']}])};
/** One active grant on the legacy signaling fragment for `user` and the test app, written into the owner's real
 * federation shard (no bound options: the grant only says the app may reach the signaling resource). */
async function rtcGrant(h,user){
 const id='g'+Math.random().toString(36).slice(2);
 await h.app.resources.federationShard(user.id).metadata.transaction(tx=>tx.set('federation/grant/'+id,{id,active:true,subject:`${ORIGIN}/entities/${user.id}`,clientId:APP_CLIENT,fragment:RTC_SIGNALING_FRAGMENT,fields:['signaling'],resources:{},methods:{},createdAt:Date.now()}));
 return id;
}

test('approve-app: the router enforces sign-in, CSRF, origin and method; the body is exact',async t=>{
 const h=await host(t,{...ON,...FEDERATION}),a=await h.person('rtc_approve_csrf');await rtcGrant(h,a);
 const body={clientId:APP_CLIENT,purposes:[SYNC]};
 assert.equal((await h.call(null,'POST','/api/rtc/approve-app',body)).status,401,'no session');
 const noToken=await h.call(a,'POST','/api/rtc/approve-app',body,{csrf:false});assert.deepEqual([noToken.status,noToken.body.error],[403,'csrf']);
 const noOrigin=await h.call(a,'POST','/api/rtc/approve-app',body,{origin:false});assert.deepEqual([noOrigin.status,noOrigin.body.error],[403,'csrf']);
 assert.equal((await h.call(a,'GET','/api/rtc/approve-app')).status,405);
 assert.equal((await h.call(a,'POST','/api/rtc/narrow-app',body)).status,404,'narrow-app is gone');
 for(const bad of [{clientId:APP_CLIENT},{purposes:[SYNC]},{clientId:APP_CLIENT,purposes:[SYNC],fragment:'https://evil.example/fragment'},{clientId:APP_CLIENT,purposes:SYNC},{clientId:'',purposes:[SYNC]},{clientId:APP_CLIENT,purposes:[1]},{clientId:APP_CLIENT,purposes:['https://unknown.example/purpose']}])
  assert.equal((await h.call(a,'POST','/api/rtc/approve-app',bad)).status,400,JSON.stringify(bad));
 // Nothing changed by a refused request: the app (from the grant) with the purposes the owner approved.
 assert.deepEqual((await h.call(a,'GET','/api/rtc/settings')).body.apps.map(x=>[x.clientId,x.name,x.purposes]),[[APP_CLIENT,'App',[CALL.artefact]]]);
});

test('approve-app over the real runtime: narrowing ends the removed purpose\'s session at once; widening needs a live grant',async t=>{
 const h=await host(t,{...ON,...FEDERATION}),a=await h.person('rtc_approve_a'),b=await h.person('rtc_approve_b');await rtcGrant(h,b);
 const {sid,eb}=await ring(a,b);const leg=await legKey();await b.app('rtc.claim',{endpoint:eb.endpoint,endpoint_secret:eb.endpoint_secret,sid,outcome:'accept',delegate:leg.jwk});
 assert.equal((await h.call(b,'GET','/api/rtc/settings')).body.sessions.find(s=>s.sid===sid).state,'connected');
 const r=await h.call(b,'POST','/api/rtc/approve-app',{clientId:APP_CLIENT,purposes:[SYNC]});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{clientId:APP_CLIENT,purposes:[SYNC],ended:1});
 const s=(await h.call(b,'GET','/api/rtc/settings')).body;
 assert.deepEqual(s.apps.map(x=>[x.clientId,x.purposes]),[[APP_CLIENT,[SYNC]]]);
 assert.equal(s.sessions.some(x=>x.sid===sid),false,'the connected CALL session ended (rtc.approve-app ends it in the same transaction)');
 assert.deepEqual(s.endpoints,[],'the device registered only for CALL no longer listens');
 await assert.rejects(b.app('rtc.register',{purposes:[CALL.artefact]}),e=>e.code==='forbidden');
 // Widening back is the owner's approval here (the app holds a live grant); then the app may register for it again.
 const back=await h.call(b,'POST','/api/rtc/approve-app',{clientId:APP_CLIENT,purposes:[CALL.artefact,SYNC]});assert.deepEqual([back.status,back.body.purposes],[200,[CALL.artefact,SYNC].sort()]);
 assert.ok((await b.app('rtc.register',{purposes:[CALL.artefact]})).endpoint);
 // A has approved CALL for the app but holds no grant on the signaling fragment: widening is the uniform 404, narrowing is not.
 uniform(await h.call(a,'POST','/api/rtc/approve-app',{clientId:APP_CLIENT,purposes:[CALL.artefact,SYNC]}),'A holds no grant for the app');
 uniform(await h.call(b,'POST','/api/rtc/approve-app',{clientId:'https://unknown.example/client',purposes:[SYNC]}),'an unknown app');
 assert.deepEqual((await h.call(a,'POST','/api/rtc/approve-app',{clientId:APP_CLIENT,purposes:[]})).body,{clientId:APP_CLIENT,purposes:[],ended:0});
});

test('approve-app with RTC off: narrowing stays available, a widening answers the uniform 404, byte-identical to an unknown path',async t=>{
 const h=await host(t,{...OFF,...FEDERATION}),a=await h.person('rtc_approve_off');await rtcGrant(h,a);
 const widening=await h.fetch('/api/rtc/approve-app',{user:a,method:'POST',value:{clientId:APP_CLIENT,purposes:[CALL.artefact,SYNC]}}),baseline=await h.fetch('/api/no-such-route',{user:a});
 assert.equal(widening.status,404);assert.equal(await widening.text(),await baseline.text());
 const r=await h.call(a,'POST','/api/rtc/approve-app',{clientId:APP_CLIENT,purposes:[]});assert.deepEqual([r.status,r.body],[200,{clientId:APP_CLIENT,purposes:[],ended:0}]);
});

test('approve-app through the owner stage: forwarded as the signed-in owner; a widening needs the app\'s live signaling grant',async()=>{
 const seen=[],body=purposes=>JSON.stringify({clientId:APP_CLIENT,purposes});
 const object={rtcDispatch:async(id,x)=>{seen.push([id,x]);if(x.operation==='rtc.approvals')return {approvals:[{clientId:APP_CLIENT,purposes:[CALL.artefact,SYNC],at:1}]};return {clientId:x.input.clientId,purposes:[...x.input.purposes].sort(),ended:0};}};
 const stage=async(env,purposes)=>{const r=await stages.owner({request:new Request(ORIGIN+'/api/rtc/approve-app',{method:'POST',headers:{'Content-Type':'application/json'},body:body(purposes)}),env:{APP_ORIGIN:ORIGIN,...env},url:new URL(ORIGIN+'/api/rtc/approve-app'),path:'/api/rtc/approve-app',id:'0a0a0a0a-0000-4000-8000-000000000001',object,context:{sessionToken:'s',csrfToken:'c'}});return {status:r.status,body:await r.json()};};
 const granted={grants:async()=>({grants:[{active:true,clientId:APP_CLIENT,fragment:RTC_SIGNALING_FRAGMENT,client:{name:'App',origin:'https://app.example'}}]})};
 assert.deepEqual(await stage({},[SYNC]),{status:200,body:{clientId:APP_CLIENT,purposes:[SYNC],ended:0}},'narrowing needs no grant read');
 assert.deepEqual(seen.at(-1),['0a0a0a0a-0000-4000-8000-000000000001',{operation:'rtc.approve-app',actor:{kind:'owner',owner:'0a0a0a0a-0000-4000-8000-000000000001'},input:{clientId:APP_CLIENT,purposes:[SYNC]}}]);
 const widen=[CALL.artefact,SYNC,'https://spec.bindle.example/rtc-purposes/file-transfer/v1'];
 assert.deepEqual(await stage({},widen),{status:404,body:{error:'not_found'}},'no authority: no grant, so no widening');
 assert.deepEqual(await stage({FEDERATION_AUTHORITY:{grants:async()=>({grants:[{active:true,clientId:APP_CLIENT,fragment:'https://other.example/fragment'}]})}},widen),{status:404,body:{error:'not_found'}},'a grant on another fragment');
 assert.deepEqual(await stage({FEDERATION_AUTHORITY:{grants:async()=>({grants:[{active:false,clientId:APP_CLIENT,fragment:RTC_SIGNALING_FRAGMENT}]})}},widen),{status:404,body:{error:'not_found'}},'an inactive grant');
 assert.equal((await stage({FEDERATION_AUTHORITY:granted},widen)).status,200);
});
