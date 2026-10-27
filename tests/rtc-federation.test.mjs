// RTC-e engine-level federation tests: two providers in one process (tests/helpers/rtc-federation-fixture.mjs), each with
// its own entities, stores, directory, key roster, foreign transport and the real `POST /bindle/rtc` route, over a fake
// network. Local behaviour only (no real HTTPS, DNS, push service or relay); hosts are reserved .example names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rtcWorld,A,B,C,CALL,SYNC,REF,OPS,identityURI,payloadOf,headerOf,fault,keyPair,relay,perform} from './helpers/rtc-federation-fixture.mjs';
import {signMessage,signLegCertificate} from '../packages/rtc/certificates.mjs';
import {buildBatch,RTC_BATCH_MEDIA_TYPE} from '../packages/rtc/messages.mjs';
import {rtcEgress,foreignRtcTransport,RtcKeyRoster,controlOnly} from '../packages/rtc/federation.mjs';
import {rtcEndpoint} from '../packages/runtime/routes/rtc.mjs';
import {createIntegrationEgress} from '../packages/federation/resource-discovery.mjs';
import {createNodeIntegrationEgress} from '../packages/federation/node-integration-egress.mjs';

const seconds=ms=>Math.floor(ms/1000),sidOf=n=>Buffer.from(Array(16).fill(n)).toString('base64url');
/** One cross-provider call through a ticket: A1 calls B1. Returns the parts. */
async function ticketCall(W,{uses=2,push}={}){
 const b=W.provider(B).device(1,{push}),a=W.provider(A).device(1);await b.register();await a.register();
 const link=await b.mintTicket({uses});const s=await a.open(b.principal,CALL,{basis:link});
 await a.invite(s);await W.pump();
 // The first copy found A's keys not held at B (dropped after a 202, refresh scheduled); the caller provider re-sends.
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite');i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 return {a,b,s,link};
}
const posts=(W,to)=>W.posts.filter(p=>!to||p.to===to);
async function rows(e,prefix){return [...await e.store.list({prefix})];}

test('cross-provider call: ticket invite, claim, connect, candidates and hangup; delivery only to manifest endpoints',async()=>{
 const W=await rtcWorld();const {a,b,s,link}=await ticketCall(W);
 assert.ok(s.result.peer_keys.length>0,'open warmed the callee keys (caller-initiated fetch, §4.1)');
 const invite=b.invites().find(e=>e.sid===s.sid);assert.ok(invite,'the invite reached the callee endpoint');
 assert.deepEqual(invite.projection.caller,a.principal);assert.equal(invite.projection.handle,null,'no foreign handle is shown');
 assert.equal(invite.projection.basis,'link');assert.ok(!JSON.stringify(b.events).includes('bindle_meta'),'the basis link is never delivered to endpoints');
 const sb=await b.claim(s.sid);assert.equal(payloadOf(sb.certificate).aud,identityURI(a.principal));
 await b.accept(sb);await W.pump();await a.listen();
 const accept=a.events.find(e=>e.type==='message'&&payloadOf(e.message).type==='accept');assert.ok(accept,'the accept reached the caller');
 await a.candidates(s);await b.candidates(sb);await W.pump();await a.listen();await b.listen();
 assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));assert.ok(a.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));
 await a.end(s);await W.pump();await b.listen();
 assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='end'));assert.equal(b.events.at(-1).state,'ended');
 // C9: every POST went to a declared manifest endpoint; C10: every GET to an allowlisted issuer's directory paths.
 for(const r of W.requests){const u=new URL(r.url);assert.ok([A,B].includes(u.origin),r.url);if(r.method==='POST')assert.equal(u.pathname,'/bindle/rtc');else assert.ok(/^\/(\.well-known\/bindle\/manifest\.json|directory|identity\/[0-9a-f-]{36}\/identity\.json)$/.test(u.pathname),r.url);}
 assert.ok(posts(W).every(p=>p.status===202),'every batch passed step 1');
 assert.ok(link.startsWith(B+'/rtc/t/'));
 // Both outboxes drain to empty.
 assert.equal((await rows(a.entity,'rtc/outbox/')).length,0);assert.equal((await rows(b.entity,'rtc/outbox/')).length,0);
});

test('a re-sent invite is deduplicated at the callee provider: one session, one delivery, until it is answered',async()=>{
 const W=await rtcWorld();const {a,b,s}=await ticketCall(W);
 for(let i=0;i<3;i++){W.clock.advance(4000);await W.tickAll();await W.pump();}
 await b.listen();assert.equal(b.invites().filter(e=>e.sid===s.sid).length,1);
 assert.ok(posts(W,B).length>=3,'the caller provider kept re-sending the unanswered invite (§8.3)');
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();const before=posts(W,B).length;
 W.clock.advance(20000);await W.tickAll();await W.pump();
 assert.equal(posts(W,B).length,before,'an answered invite is no longer re-sent');
 assert.equal((await rows(b.entity,'rtc/in/')).length,1);
});

test('key rotation mid-session: a key published before use is picked up by refresh-ahead; an abrupt rotation is dropped until refreshed',async()=>{
 const W=await rtcWorld({maxAge:60});const {a,b,s}=await ticketCall(W);const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 // B publishes a second certification key, keeps signing with the first; A's roster refreshes ahead of the TTL.
 const next=await b.entity.addCertKey({use:false});W.clock.advance(31000);await W.tickAll();
 assert.ok((await a.entity.roster.certification(b.principal)).some(k=>k.kid===next),'refresh-ahead fetched the published key');
 b.entity.signing=next;const renewed=await b.renew(sb);assert.equal(headerOf(renewed.certificate).kid,next);b.entity.retireOthers();
 await b.candidates(sb);await W.pump();await a.listen();
 const got=a.events.filter(e=>e.type==='message'&&payloadOf(e.message).type==='candidates');assert.equal(got.length,1,'the renewed leg verifies under the rotated key');
 // The same at the caller: B tracked A when A's leg verified, so its roster also refreshes A ahead of the TTL.
 const nextA=await a.entity.addCertKey({use:false});W.clock.advance(31000);await W.tickAll();
 assert.ok((await b.entity.roster.certification(a.principal)).some(k=>k.kid===nextA),'the callee provider keeps the caller warm (§8.2 step 3 roster)');
 a.entity.signing=nextA;await a.renew(s);a.entity.retireOthers();await a.candidates(s);await W.pump();await b.listen();
 assert.equal(b.events.filter(e=>e.type==='message'&&payloadOf(e.message).type==='candidates').length,1);b.events.length=0;
 // Abrupt rotation at A: the new key is used before any verifier holds it. B drops the message (202), schedules a
 // refresh naming the kid, and fetches A's document in the background.
 const before=W.requests.filter(r=>r.from===B&&r.url.endsWith(`/identity/${a.entity.sub}/identity.json`)).length;
 const kid=await a.entity.addCertKey({use:true,retire:true});await a.renew(s);await a.candidates(s);await W.pump();await b.listen();
 assert.ok(!b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'),'nothing verifies before the refresh');
 assert.ok(W.requests.filter(r=>r.from===B&&r.url.endsWith(`/identity/${a.entity.sub}/identity.json`)).length>before,'a refresh for the unknown kid ran');
 assert.ok((await b.entity.roster.certification(a.principal)).some(k=>k.kid===kid));
 // Until A renews again (its renewal was in the dropped batch), nothing from A verifies (old kid now retired).
 await a.candidates(s);await W.pump();await b.listen();assert.ok(!b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));
 // After a fresh renewal the certificate verifies, but the dropped seqs leave a gap: after 10 s the receiver ends the
 // leg `failed` with a control statement, and both providers converge to ended.
 await a.renew(s);await a.candidates(s);await W.pump();W.clock.advance(11000);await W.tickAll();await W.pump();await W.tickAll();await W.pump();
 const state=async(e,prefix)=>(await rows(e,prefix)).map(([,r])=>r.state);
 assert.deepEqual(await state(b.entity,'rtc/in/'),['ended']);assert.deepEqual(await state(a.entity,'rtc/out/'),['ended']);
});

test('provider outage: delivery backs off and retries; a 429 or 503 is retried; a 404 is dropped; nothing outlives ring_until',async()=>{
 const W=await rtcWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const link=await b.mintTicket({uses:3});const s=await a.open(b.principal,CALL,{basis:link});
 W.net.down.add(B);await a.invite(s);await W.pump();
 const [[,row]]=await rows(a.entity,'rtc/outbox/');assert.ok(row.attempts>=1&&row.notBefore>W.clock.now(),'backed off');
 W.net.down.delete(B);for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite');i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===s.sid),'delivered after the outage');
 // 429 (B sheds this network) is retried; the row stays until accepted.
 const abuse=W.provider(B).env.ABUSE.consume;W.provider(B).env.ABUSE.consume=async()=>false;
 W.provider(B).env.ABUSE.consume=abuse;const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();W.provider(B).env.ABUSE.consume=async()=>false;await a.candidates(s);await W.pump();
 assert.ok(posts(W,B).some(p=>p.status===429));assert.equal((await rows(a.entity,'rtc/outbox/')).length,1,'held for retry');
 W.provider(B).env.ABUSE.consume=abuse;W.clock.advance(5000);await W.pump();assert.equal((await rows(a.entity,'rtc/outbox/')).length,0);
 // A 404 (B turned its endpoint off) is permanent: the row is dropped, not retried.
 W.provider(B).env.RTC_FOREIGN_ENABLED='false';await a.end(s);await W.pump();
 assert.ok(posts(W,B).at(-1).status===404);assert.equal((await rows(a.entity,'rtc/outbox/')).length,0);
 W.provider(B).env.RTC_FOREIGN_ENABLED='true';
 // An outage longer than the ring: the invite and its re-sends are dropped at ring_until; the caller times out.
 const s2=await a.open(b.principal,CALL,{basis:link});W.net.down.add(B);await a.invite(s2);
 for(let i=0;i<70;i++){W.clock.advance(2000);await W.tickAll();await W.pump();}
 assert.equal((await rows(a.entity,'rtc/outbox/')).length,0,'nothing is kept past its useful life');
 assert.equal((await rows(a.entity,'rtc/out/')).find(([k])=>k.endsWith(s2.sid))[1].state,'ended');
});

/** A raw POST to B's route from `from` (a malicious or replaying provider). */
const raw=(W,body,{from=C,to=B,type=RTC_BATCH_MEDIA_TYPE}={})=>rtcEndpoint({request:new Request(`${to}/bindle/rtc`,{method:'POST',headers:{'Content-Type':type,'CF-Connecting-IP':'203.0.113.99'},body}),env:W.provider(to).env,local:false});

test('malicious provider inputs: forged keys, replayed batches, oversized batches, wrong aud or iss are refused or ignored uniformly',async()=>{
 const W=await rtcWorld({providers:[A,B,C]});const {a,b,s}=await ticketCall(W);const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 const be=b.entity,events=async()=>{await W.pump();return (await b.listen()).events;};await b.listen();
 // Forged keys: C mints a leg certificate claiming to be A1, signed by C's own certification key.
 const evil=W.provider(C).entity(1),leg=await keyPair(),now=W.clock.now();
 const sid=sidOf(1),forged=(await signLegCertificate({issuer:A,sub:a.entity.sub,identity:identityURI(a.principal),aud:identityURI(b.principal),sid,role:'caller',purpose:REF[CALL],client:{client_id:'https://app.example/client',origin:'https://app.example'},delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600},{kid:a.entity.signing,privateKey:evil.certKeys[0].privateKey})).certificate;
 const invite=await signMessage({bindle:'rtc-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid,leg:leg.jkt,to:null,seq:0,iat:seconds(now),type:'invite',body:{purpose:REF[CALL],media:['audio'],ring_until:seconds(now)+60,basis:null,context:null,offer:null,callback_digest:null,sas_commit:null}},leg.privateKey);
 const r1=await raw(W,buildBatch({certificates:[forged],messages:[invite]}));assert.equal(r1.status,202,'step 1 passes; steps 2–8 are silent');
 assert.deepEqual(await events(),[]);assert.ok(!(await rows(be,'rtc/in/')).some(([k])=>k.endsWith(sid)));
 // A certificate that claims C's own principal: C's manifest lacks rtc-signaling.v1, so B never fetches its identity.
 W.provider(C).manifestFeature=null;
 const own=(await signLegCertificate({issuer:C,sub:evil.sub,identity:identityURI(evil.principal),aud:identityURI(b.principal),sid:sidOf(2),role:'caller',purpose:REF[CALL],client:{client_id:'https://app.example/client',origin:'https://app.example'},delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600},{kid:evil.signing,privateKey:evil.certKeys[0].privateKey})).certificate;
 const inv2=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub,sid:sidOf(2)},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[own],messages:[inv2]}))).status,202);W.clock.advance(1000);await W.tickAll();await W.pump();
 assert.ok(!W.requests.some(r=>r.from===B&&r.url.includes(`${C}/identity/`)),'manifest floor first: no identity fetch from an issuer without rtc-signaling.v1');
 assert.deepEqual(await events(),[]);
 // Replay: every batch B ever accepted, re-posted: 202 each, and nothing new reaches the endpoint.
 for(const p of posts(W,B).filter(p=>p.status===202))assert.equal((await raw(W,p.body,{from:A})).status,202);
 assert.deepEqual(await events(),[],'replays are deduplicated (§6.4)');
 // Oversized and malformed batches are refused whole (400) before any writer is touched.
 const big=buildBatch({messages:[invite]}).replace('"links":[]','"links":[],"pad":"'+'x'.repeat(140000)+'"');
 for(const body of [big,'{','{"v":1,"certificates":[],"messages":[],"controls":[],"links":[]}',buildBatch({messages:[invite]}).replace('"v":1','"v":2')]){const r=await raw(W,body);assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'rtc_batch_invalid'});}
 assert.equal((await raw(W,buildBatch({messages:[invite]}),{type:'application/json'})).status,400,'exact media type');
 // Wrong aud: another origin is a step-1 failure; an unknown entity here is the uniform 404; two auds are refused.
 const toOther=await signMessage({...payloadOf(invite),aud:`${A}/identity/${a.entity.sub}`},leg.privateKey);
 assert.equal((await raw(W,buildBatch({messages:[toOther]}))).status,400);
 const unknown=await signMessage({...payloadOf(invite),aud:`${B}/identity/0a0a0a0a-0002-4000-8000-0000000000ff`},leg.privateKey);
 const u=await raw(W,buildBatch({messages:[unknown]}));assert.equal(u.status,404);assert.deepEqual(await u.json(),{error:'not_found'});
 assert.equal((await raw(W,buildBatch({certificates:[forged],messages:[unknown]}))).status,400,'one batch, one aud');
 // Wrong iss: a message whose iss differs from its certificate's is dropped silently.
 const wrongIss=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub,sid:sidOf(3)},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[forged],messages:[wrongIss]}))).status,202,'step 1 does not compare elements; later steps drop it silently');
 const wrongIss2=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[forged],messages:[wrongIss2]}))).status,202);assert.deepEqual(await events(),[]);
 // A forged control statement from a non-party for the live session is ignored; the session stays connected.
 const control=await (await import('../packages/rtc/certificates.mjs')).signControl({issuer:C,sub:evil.sub,aud:identityURI(b.principal),sid:s.sid,leg:null,reason:'revoked',now,jti:'j'.repeat(24)},{kid:evil.signing,privateKey:evil.certKeys[0].privateKey});
 assert.equal((await raw(W,buildBatch({controls:[control]}))).status,202);await W.pump();
 assert.equal((await rows(be,'rtc/in/')).find(([k])=>k.endsWith(s.sid))[1].state,'connected');
 // Per-network shedding before step 1.
 const abuse=W.provider(B).env.ABUSE.consume;W.provider(B).env.ABUSE.consume=async()=>false;const shed=await raw(W,buildBatch({messages:[invite]}));assert.equal(shed.status,429);assert.equal(shed.headers.get('Retry-After'),'60');W.provider(B).env.ABUSE.consume=abuse;
});

test('SSRF: peer identity, directory and endpoint URLs off the issuer origin, non-allowlisted issuers and private targets are never dialed',async()=>{
 const W=await rtcWorld({providers:[A,B,C],allow:{[A]:[B],[B]:[A],[C]:[]}});
 const a=W.provider(A).device(1);await a.register();const target=n=>W.provider(B).entity(n).principal;
 const dialed=host=>W.requests.some(r=>new URL(r.url).hostname===host);
 // The directory names an identity on another origin, or on a literal address: refused, never fetched.
 for(const identity of [`${C}/identity/x`,'https://127.0.0.1/identity/x','https://169.254.169.254/latest/meta-data','http://beta.example/identity/x']){
  W.provider(B).directoryPatch=()=>({identity});const B2=await W.provider(B).add(10+W.provider(B).entities.size);
  assert.equal((await fault(a.open(B2.principal,CALL))).code,'temporarily_unavailable',identity);
 }
 W.provider(B).directoryPatch=null;
 assert.ok(!dialed('gamma.example')&&!dialed('127.0.0.1')&&!dialed('169.254.169.254'));
 // The manifest's rtc-signaling.v1 endpoint on another origin (or a metadata address) is not a valid feature: no
 // identity document is fetched and nothing is ever posted there.
 for(const endpoint of ['https://169.254.169.254/bindle/rtc',`${C}/bindle/rtc`,'https://beta.example:8443/bindle/rtc','http://beta.example/bindle/rtc']){
  W.clock.advance(301000);// the cached manifest expires (max-age 300)
  W.provider(B).manifestFeature={endpoint,max_leg_certificate_seconds:600};const fresh=await W.provider(B).add(30+W.provider(B).entities.size);
  const before=W.requests.filter(r=>r.url.includes('/identity/'+fresh.sub)).length;
  assert.equal((await fault(a.open(fresh.principal,CALL))).code,'temporarily_unavailable',endpoint);
  assert.equal(W.requests.filter(r=>r.url.includes('/identity/'+fresh.sub)).length,before,'manifest floor before any identity fetch');
 }
 assert.ok(!W.requests.some(r=>r.method==='POST'),'nothing was posted');assert.ok(!dialed('169.254.169.254')&&!dialed('gamma.example'));
 W.provider(B).manifestFeature={endpoint:`${B}/bindle/rtc`,max_leg_certificate_seconds:600};
 // A callee whose issuer is not on the allowlist: refused without a single request to it.
 assert.equal((await fault(a.open(W.provider(C).entity(1).principal,CALL))).code,'temporarily_unavailable');assert.ok(!dialed('gamma.example'));
 // A sender claiming a non-allowlisted issuer never schedules a fetch to it (roster refuses), whatever it posts.
 assert.equal(a.entity.roster.refresh(W.provider(C).entity(1).principal),false);
 assert.ok(target(1));
 // The POST wrapper: only https on an allowlisted origin, no query, port, userinfo or fragment; bounded body.
 const sent=[],post=rtcEgress({send:async input=>{sent.push(input.url);return {status:202};},issuers:[B]});
 for(const url of [`${C}/bindle/rtc`,'https://127.0.0.1/bindle/rtc','http://beta.example/bindle/rtc','https://beta.example:444/bindle/rtc','https://u:p@beta.example/bindle/rtc',`${B}/bindle/rtc?x=1`,`${B}/bindle/rtc#f`])
  assert.equal((await fault(post(url,'{}'))).code,'rtc_target_refused',url);
 assert.equal((await fault(post(`${B}/bindle/rtc`,'x'.repeat(131073)))).code,'rtc_batch_invalid');assert.equal(await post(`${B}/bindle/rtc`,'{}'),202);assert.deepEqual(sent,[`${B}/bindle/rtc`]);
 // The adapters' screened egress refuses private answers before connecting (Workers: DoH + strictly public routing;
 // Node: DNS pinned, public IPv4 only).
 for(const address of ['10.0.0.1','127.0.0.1','169.254.169.254','::1','fd00::1','100.64.0.1']){
  let fetched=0;const worker=createIntegrationEgress({resolve:async()=>[address],publicRouting:true,fetcher:async()=>{fetched++;return new Response(null,{status:202});}});
  assert.equal((await fault(worker.send({url:`${B}/bindle/rtc`,headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body:'{}',maxBytes:1024,requestBytes:131072}))).code,'egress_refused',address);assert.equal(fetched,0);
  let dials=0;const node=createNodeIntegrationEgress({issuer:A,lookup:async()=>[{address,family:address.includes(':')?6:4}],request:()=>{dials++;throw new Error('dialed');}});
  assert.equal((await fault(node.send({url:`${B}/bindle/rtc`,headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body:'{}',maxBytes:1024,requestBytes:131072}))).code,'egress_refused',address);assert.equal(dials,0);
 }
});

test('flags off: no foreign session, no outbound request, the endpoint answers the uniform 404',async()=>{
 const W=await rtcWorld({flags:{RTC_FOREIGN_ENABLED:false}});const b=W.provider(B).device(1),a=W.provider(A).device(1);
 // RTC_FOREIGN_ENABLED off: an endpoint operation toward another provider is the public `unsupported_peer` fact.
 await b.register();await a.register();assert.equal((await fault(a.open(b.principal,CALL))).code,'unsupported_peer');
 assert.deepEqual(W.requests,[],'nothing dialed');assert.deepEqual(await a.entity.roster.certification(b.principal),[]);
 // RTC_SIGNALING_ENABLED off as well: register itself is the uniform not_found.
 W.provider(A).flags.RTC_SIGNALING_ENABLED=false;assert.equal((await fault(W.provider(A).device(2).register())).code,'not_found');
 // The endpoint while off, for any method and body: the uniform 404, identical to an unknown target.
 W.provider(B).env.RTC_FOREIGN_ENABLED='false';
 const answers=[];for(const [method,body] of [['POST','{}'],['GET',undefined],['PUT','x'],['POST','{"v":1}']]){const r=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method,...body!==undefined?{body,headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE}}:{}}),env:W.provider(B).env,local:false});answers.push([r.status,await r.text(),r.headers.get('Cache-Control')]);}
 assert.ok(answers.every(x=>JSON.stringify(x)===JSON.stringify([404,'{"error":"not_found"}','no-store'])),JSON.stringify(answers));
 // A transport whose foreign flag is off refuses message batches (retried by the outbox until their useful life)
 // but still delivers control statements (narrowing).
 const calls=[],roster={feature:async()=>({endpoint:`${B}/bindle/rtc`,max_leg_certificate_seconds:600})};
 const t=foreignRtcTransport({issuer:A,local:{deliver:async()=>({})},roster,post:async url=>{calls.push(url);return 202;},enabled:async()=>false});
 const ctl=JSON.stringify({v:1,certificates:[],messages:[],controls:['a.b.c'],links:[]}),msg=JSON.stringify({v:1,certificates:[],messages:['a.b.c'],controls:[],links:[]});
 assert.equal(controlOnly(ctl),true);assert.equal(controlOnly(msg),false);
 assert.equal((await fault(t.deliver({iss:A,sub:'x'},{iss:B,sub:'y'},msg))).code,'rtc_foreign_disabled');assert.deepEqual(await t.deliver({iss:A,sub:'x'},{iss:B,sub:'y'},ctl),{accepted:true});assert.equal(calls.length,1);
});

test('uniform 404: unknown, malformed, inactive and disabled targets answer the same bytes; valid batches answer an empty 202',async()=>{
 const W=await rtcWorld();const {a,b,s}=await ticketCall(W);const env=W.provider(B).env;
 const accepted=posts(W,B).find(p=>p.status===202).body,leg=await keyPair(),now=W.clock.now();
 const msg=aud=>signMessage({bindle:'rtc-message',v:1,iss:A,sub:a.entity.sub,aud,sid:s.sid,leg:leg.jkt,to:null,seq:1,iat:seconds(now),type:'cancel',body:{}},leg.privateKey);
 const answer=async body=>{const r=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body}),env,local:false});return [r.status,await r.text(),[...r.headers].filter(([k])=>!['date'].includes(k)).sort().join('|')];};
 const unknownSub=`${B}/identity/0a0a0a0a-0002-4000-8000-0000000000aa`,notIdentity=`${B}/people/${b.entity.sub}`,badUuid=`${B}/identity/not-a-uuid`;
 const results=[];for(const aud of [unknownSub,notIdentity,badUuid])results.push(await answer(buildBatch({messages:[await msg(aud)]})));
 // An entity that is gone (deleted, suspended or moved) is the same lookup.
 await W.provider(B).add(9);const gone=W.provider(B).entity(2);gone.gone=true;results.push(await answer(buildBatch({messages:[await msg(identityURI(gone.principal))]})));
 // The entity's own RTC_FOREIGN_ENABLED off (here site-wide off) is the same answer before the body is read.
 env.RTC_FOREIGN_ENABLED='false';results.push(await answer(accepted));env.RTC_FOREIGN_ENABLED='true';
 for(const r of results)assert.deepEqual(r,results[0]);assert.equal(results[0][0],404);assert.equal(results[0][1],'{"error":"not_found"}');
 // A valid batch for a known entity: 202 with an empty body, whatever steps 2–8 later decide.
 const ok=await answer(accepted);assert.equal(ok[0],202);assert.equal(ok[1],'');
 // RTC wargame L3: RTC_FOREIGN_ENABLED off for the addressed entity only (an account-scoped rule), while on site-wide,
 // answers exactly as a valid batch does (202, dropped unprocessed), so the entity's own flags are never observable.
 const offOwner=b.entity.sub;env.flags={for:ctx=>({version:1,evaluate:name=>({value:!(name==='RTC_FOREIGN_ENABLED'&&ctx?.subject?.owner===offOwner),reason:'rule'}),envState:()=>({state:'managed'}),global:()=>true})};
 assert.deepEqual(await answer(accepted),ok);
 // Wargame review R1: a step-1-invalid batch (a stale iat) for that flag-off entity answers the same 400 as for a
 // flag-on one: step 1 runs before anything per-account.
 const stale=buildBatch({messages:[await signMessage({bindle:'rtc-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid:s.sid,leg:leg.jkt,to:null,seq:1,iat:seconds(now)-86400,type:'cancel',body:{}},leg.privateKey)]});
 const offStale=await answer(stale);delete env.flags;const onStale=await answer(stale);
 assert.deepEqual(offStale,onStale);assert.equal(onStale[0],400);assert.equal(onStale[1],'{"error":"rtc_batch_invalid"}');
});

test('Web Push doorbell: one content-free push per alerting invite per endpoint, high urgency, TTL within the ring; never for muted invites; gone subscriptions are removed',async()=>{
 const p256dh=Buffer.from([4,...Array(64).fill(7)]).toString('base64url'),auth=Buffer.from(Array(16).fill(9)).toString('base64url');
 const push={endpoint:'https://fcm.googleapis.com/fcm/send/abc123',keys:{p256dh,auth}};
 const W=await rtcWorld();const {a,b,s}=await ticketCall(W,{push});
 // Re-sent copies of the invite never ring again.
 for(let i=0;i<3;i++){W.clock.advance(3000);await W.tickAll();await W.pump();}
 assert.equal(W.pushes.length,1);const [ring]=W.pushes;
 assert.deepEqual(ring.payload,{t:'rtc',endpoint:b.endpoint});assert.deepEqual(Object.keys(ring.payload).sort(),['endpoint','t']);
 assert.deepEqual(ring.subscription,push);assert.equal(ring.options.urgency,'high');
 const invite=b.invites().find(e=>e.sid===s.sid),ringUntil=payloadOf(invite.invite).body.ring_until;assert.ok(ring.options.ttl>0&&ring.options.ttl<=60,'TTL no longer than the remaining ring time');
 const text=JSON.stringify(ring.payload);for(const secret of [s.sid,a.entity.sub,A,CALL,'audio'])assert.ok(!text.includes(secret),secret);
 assert.ok(ringUntil);
 // A muted caller: delivered without alert, so no push.
 await perform_owner(b,'rtc.mute',{kind:'principal',value:a.principal});
 const link=await b.mintTicket({uses:2}),s2=await a.open(b.principal,CALL,{basis:link});await a.invite(s2);await W.pump();
 for(let i=0;i<4&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s2.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.equal(b.invites().find(e=>e.sid===s2.sid).projection.alert,false);assert.equal(W.pushes.length,1,'no doorbell without an alert');
 await perform_owner(b,'rtc.unmute',{kind:'principal',value:a.principal});
 // The push service reports the subscription gone: it is removed, and later alerting invites send nothing.
 W.provider(B).pushGone=true;const s3=await a.open(b.principal,CALL,{basis:link});await a.invite(s3);await W.pump();
 for(let i=0;i<4&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s3.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.equal(W.pushes.length,2);const [[,ep]]=(await rows(b.entity,'rtc/ep/'));assert.equal(ep.push,null);
});
function perform_owner(device,operation,input){return perform(device.entity.engine,new OPS[operation]({actor:{kind:'owner',owner:device.entity.sub},input}));}

// ---- seeded chaos over the network (design §8.2) ------------------------------------------------------------------
import {forEachSeed} from './helpers/chaos.mjs';
import {RTC_BOUNDS} from '../packages/app/domains/rtc.mjs';
const STEPS=Number(process.env.RTC_CHAOS_STEPS??150),SEEDS=Number(process.env.RTC_FED_CHAOS_SEEDS??6);
async function invariants(W,devices,wins){
 for(const p of W.providers.values())for(const e of p.entities.values()){
  const rows=new Map(await e.store.list({prefix:'rtc/'})),list=prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);
  const ins=list('rtc/in/');
  assert.ok(list('rtc/out/').filter(r=>r.state!=='ended').length<=RTC_BOUNDS.callerOpen,'caller open bound');
  assert.ok(ins.filter(r=>r.state==='ringing'&&!r.held).length<=RTC_BOUNDS.calleeRinging,'callee ringing bound');
  assert.ok(list('rtc/outbox/').length<=RTC_BOUNDS.outbox&&list('rtc/inq/').length<=RTC_BOUNDS.inbox,'outbox and inbound bounds');
  const om=rows.get('rtc/outbox-seq'),im=rows.get('rtc/inq-meta');if(om)assert.equal(om.count,list('rtc/outbox/').length);if(im)assert.equal(im.count,list('rtc/inq/').length);
  for(const r of ins){if(r.claim)assert.ok(r.delivered.includes(r.claim.endpoint)||r.state==='ended','claimant was notified');assert.ok(!r.mine||r.claim,'a callee leg only after a claim');}
  for(const [key,row] of rows)if(key.startsWith('rtc/epq/')&&row.type==='message'){const m=payloadOf(row.message),ep=key.split('/')[2];if(!['sdp','candidates'].includes(m.type))continue;
   const out=rows.get('rtc/out/'+row.sid),inn=ins.find(r=>r.sid===row.sid&&r.claim?.endpoint===ep);assert.ok(out?.mine?.endpoint===ep&&out.theirs||inn&&inn.claim.outcome==='accept','address material only to a session leg');}
  assert.ok(e.roster.roster.size<=512&&e.roster.queue.size<=64,'roster and refresh queue bounds');
 }
 for(const [sid,set] of wins)assert.ok(set.size<=1,`at most one successful claim for ${sid}`);
 // C9/C10: only allowlisted issuers are dialed; POSTs only to their manifest endpoints; step-1-valid batches get 202.
 for(const r of W.requests){const u=new URL(r.url);assert.ok([A,B].includes(u.origin),r.url);if(r.method==='POST')assert.equal(u.pathname,'/bindle/rtc');}
 // A 400 only for a batch held in flight past the §6.4 receipt window (a stale iat), never otherwise.
 for(const x of W.posts){if(x.status!==400){assert.ok([202,429,503].includes(x.status),`route answered ${x.status}`);continue;}
  const stale=JSON.parse(x.body).messages.some(m=>{const iat=payloadOf(m).iat,now=Math.floor(x.at/1000);return iat<now-120||iat>now+30;});assert.ok(stale,'a 400 is only a stale delivery');}
}
test('seeded chaos over the network: drops, duplicates, reorders, partitions, outages, rotations and clock skew keep the invariants',async()=>{
 const stats={claims:0,accepted:0,delivered:0};
 await forEachSeed(SEEDS,async random=>{
  const W=await rtcWorld({seed:random.seed,entities:2});const devices=[],wins=new Map(),calls=[],tickets=new Map();
  for(const o of [A,B])for(const n of [1,2]){const d=W.provider(o).device(n);await d.register([CALL,SYNC]);devices.push(d);tickets.set(o+n,await d.mintTicket({uses:1000,expires_in:30*86400}));}
  const tolerate=async fn=>{try{return await fn();}catch(e){if(e?.code==='ERR_ASSERTION')throw e;return null;}};
  for(let step=0;step<STEPS;step++){
   const op=random.pick(['call','call','listen','listen','listen','claim','claim','signal','signal','end','cancel','deliver','deliver','pump','pump','advance','hold','drop','partition','down','rotate','skew']);
   if(op==='call'){const d=random.pick(devices),to=random.pick(devices.filter(x=>x!==d&&x.entity!==d.entity));
    await tolerate(async()=>{const s=await d.open(to.principal,CALL,{basis:tickets.get(to.provider.origin+to.n)});calls.push({d,s});await d.invite(s);});}
   if(op==='listen')await tolerate(()=>random.pick(devices).listen());
   if(op==='claim'){const d=random.pick(devices),open=d.invites().filter(e=>!d.sessions.has(e.sid));if(open.length){const e=random.pick(open);
    await tolerate(async()=>{const c=await d.claim(e.sid);const set=wins.get(e.sid)??new Set();set.add(d.endpoint);wins.set(e.sid,set);await d.accept(c);});}}
   if(op==='signal'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.candidates(random.pick(held)));}
   if(op==='end'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.end(random.pick(held)));}
   if(op==='cancel'&&calls.length){const {d,s}=random.pick(calls);await tolerate(()=>d.cancel(s));}
   if(op==='deliver')await W.flushHeld({random,dupRate:0.25});
   if(op==='pump')await W.pump(3);
   if(op==='advance'){W.clock.advance(random.chance(0.1)?random.int(150000):random.int(8000));await W.tickAll();}
   if(op==='hold'){W.net.hold=!W.net.hold;if(!W.net.hold)await W.flushHeld({random,dupRate:0.25});}
   if(op==='drop')W.net.fail=W.net.fail?null:()=>random.chance(0.3);
   if(op==='partition'){const k=A+'|'+B;if(W.net.cut.has(k))W.net.cut.delete(k);else W.net.cut.add(k);}
   if(op==='down'){const o=random.pick([A,B]);if(W.net.down.has(o))W.net.down.delete(o);else W.net.down.add(o);}
   // A rotation published before use: the new key is used only after a refresh window.
   if(op==='rotate'){const d=random.pick(devices),e=d.entity;if(e.certKeys.length<4){if(e.pending){e.signing=e.pending;e.pending=null;}else e.pending=await e.addCertKey({use:false});}}
   if(op==='skew')random.pick(devices).skew=random.pick([0,-20,15,25,-100]);
   await invariants(W,devices,wins);
  }
  W.net={down:new Set(),cut:new Set(),hold:false,fail:null};await W.flushHeld();await W.pump();
  for(let i=0;i<4;i++){W.clock.advance(7*3600000);await W.tickAll();await W.pump();}
  for(const p of W.providers.values())for(const e of p.entities.values()){
   for(const [key,r] of await e.store.list({prefix:'rtc/'}))if(key.startsWith('rtc/out/')||key.startsWith('rtc/in/'))assert.equal(r.state,'ended',`${key} is terminal`);
   assert.equal((await e.store.list({prefix:'rtc/outbox/'})).size,0,'the outbox drains or expires');assert.equal((await e.store.list({prefix:'rtc/inq/'})).size,0,'the inbound queue drains');
  }
  await invariants(W,devices,wins);
  stats.claims+=wins.size;stats.accepted+=W.posts.filter(x=>x.status===202).length;stats.delivered+=devices.reduce((n,d)=>n+d.events.filter(e=>e.type==='message').length,0);
 });
 // The schedule really exercised cross-provider sessions (not only refusals).
 assert.ok(stats.claims>0&&stats.accepted>0&&stats.delivered>0,JSON.stringify(stats));
});

// ---- contract route, journal policy and lifecycle triggers -------------------------------------------------------
import {rtcResourceMethod} from '../packages/runtime/account/rtc.mjs';
import {FederationController,federationMetadata} from '../packages/federation/runtime.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {configuredArtefacts,reviewedSchemaFetcher} from '../packages/runtime/artefact-pins.mjs';
import {FederationService} from '../packages/federation/service.mjs';
import {RTC_SIGNALING_SLOT,RTC_SIGNALING_SLOT_MANIFEST,RTC_BOUND_ARTEFACTS,RTC_SIGNALING_CONTRACT} from '../packages/rtc/extension.mjs';

test('contract route: the app actor comes only from the verified dispatch context, with the token grant ids; listen never waits inside the gate',async()=>{
 const owner='0a0a0a0a-0009-4000-8000-000000000001',origin='https://home.example',calls=[],checks=[];
 const records=new Map(),c={metadata:{get:async k=>records.get(k)},config:{APP_ORIGIN:origin,FEDERATION_IDENTITY_CHECK:async(o,epoch)=>o===owner&&epoch==='e1'},apps:{check:async(...args)=>{checks.push(args);}},
  rtcDispatch:async(o,x)=>{calls.push(['dispatch',o,x]);return {ok:true};},rtcListen:async(o,x)=>{calls.push(['listen',o,x]);return {cursor:0,events:[],gap:false};}};
 const ctx=(over={})=>({authority:'bindle',contract:RTC_SIGNALING_CONTRACT,subject:`${origin}/entities/${owner}`,resource:`${origin}/entities/${owner}/rtc`,resourceGeneration:owner,connection:{id:'conn',generation:2},epoch:'e1',clientId:'https://app.example/client',clientOrigin:'https://app.example',grants:['g1','g2'],method:'register',args:{purposes:[CALL]},...over});
 assert.deepEqual(await rtcResourceMethod(c,owner,ctx()),{ok:true});
 assert.deepEqual(calls[0],['dispatch',owner,{operation:'rtc.register',actor:{kind:'app',owner,clientId:'https://app.example/client',origin:'https://app.example',grants:['g1','g2'],epoch:'e1',bound:{values:{},versions:{}}},input:{purposes:[CALL]}}]);
 assert.deepEqual(checks[0],[owner,'conn',2,'https://app.example/client'],'the app connection is checked live');
 await rtcResourceMethod(c,owner,ctx({method:'open',jkt:'k'.repeat(43),args:{}}));assert.equal(calls[1][2].actor.jkt,'k'.repeat(43),'a DPoP-bound token binds the endpoint key');
 await rtcResourceMethod(c,owner,ctx({method:'listen',args:{endpoint:'ep',wait:25}}));assert.equal(calls[2][0],'listen');assert.equal(calls[2][2].input.wait,0,'no long poll while holding the account gate');
 for(const [over,code] of [[{grants:[]},'forbidden'],[{grants:undefined},'forbidden'],[{resource:`${origin}/entities/${owner}/links`},'forbidden'],[{resourceGeneration:'other'},'forbidden'],[{authority:'mcp'},'forbidden'],[{subject:`${origin}/entities/other`},'forbidden'],[{connection:undefined},'forbidden'],[{method:'ingest'},'unsupported_method'],[{method:'lifecycle'},'unsupported_method'],[{epoch:'old'},'unauthorized'],[{clientOrigin:'not a url',clientId:'also not'},'forbidden']])
  assert.equal((await fault(rtcResourceMethod(c,owner,ctx(over)))).code,code,JSON.stringify(over));
 assert.equal(calls.length,3,'nothing was dispatched for a refused context');
 // RTC-i bug 1: the bound approval rides only from the verified dispatch context's `bound` for the signaling slot
 // (never from arguments); another fragment's approval, or a malformed one, approves nothing.
 const approval={values:{purposes:[CALL]},versions:{[CALL]:[{version:1,digest:'d'}]},revision:'r'};
 await rtcResourceMethod(c,owner,ctx({bound:{[RTC_SIGNALING_SLOT]:approval},args:{purposes:[CALL],bound:{values:{purposes:['x']}}}}));
 assert.deepEqual(calls[3][2].actor.bound,{values:approval.values,versions:approval.versions});
 await rtcResourceMethod(c,owner,ctx({bound:{'https://other.example/slot':approval}}));assert.deepEqual(calls[4][2].actor.bound,{values:{},versions:{}});
 await rtcResourceMethod(c,owner,ctx({bound:{[RTC_SIGNALING_SLOT]:{values:'x',versions:{}}}}));assert.deepEqual(calls[5][2].actor.bound,{values:{},versions:{}});
 // RTC-i review L1: the client's account-local approval record (written by rtcAppChanged inside the gate) narrows any
 // dispatch approval that is not newer than it; a newer approval (a later approval or narrowing) stands.
 const two={values:{purposes:[CALL,SYNC]},versions:{[CALL]:[{version:1,digest:'d'}],[SYNC]:[{version:1,digest:'s'}]},revision:'r',at:1000};
 const recordKey='rtc/approval/'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('rtc-approval\0https://app.example/client'))).toString('base64url');
 const actorWith=async(record,approval=two)=>{if(record===undefined)records.delete(recordKey);else records.set(recordKey,record);await rtcResourceMethod(c,owner,ctx({bound:{[RTC_SIGNALING_SLOT]:approval}}));return calls.at(-1)[2].actor.bound;};
 assert.deepEqual(await actorWith(undefined),{values:two.values,versions:two.versions},'no record: the dispatch approval');
 assert.deepEqual(await actorWith({clientId:'https://app.example/client',purposes:[CALL],revision:1,at:2000}),{values:{purposes:[CALL]},versions:{[CALL]:two.versions[CALL]}},'a later narrowing intersects');
 assert.deepEqual(await actorWith({clientId:'https://app.example/client',purposes:[CALL],revision:1,at:1000}),{values:{purposes:[CALL]},versions:{[CALL]:two.versions[CALL]}},'same time: intersect (fail closed)');
 assert.deepEqual(await actorWith({clientId:'https://app.example/client',purposes:null,revision:2,at:2000}),{values:{},versions:{}},'a later revocation approves nothing');
 assert.deepEqual(await actorWith({clientId:'https://app.example/client',purposes:[CALL],revision:1,at:500}),{values:two.values,versions:two.versions},'an approval newer than the record stands (re-approval)');
 assert.deepEqual(await actorWith({clientId:'https://app.example/client',purposes:[CALL],revision:1,at:2000},{...two,at:undefined}),{values:{purposes:[CALL]},versions:{[CALL]:two.versions[CALL]}},'no approval time: intersect');
 for(const bad of [{purposes:'x',at:1},{purposes:[CALL]},'x',{purposes:[CALL],at:1.5}])assert.deepEqual(await actorWith(bad),{values:{},versions:{}},'a malformed record approves nothing: '+JSON.stringify(bad));
 const broken={...c,metadata:{get:async()=>{throw new Error('down');}}};await rtcResourceMethod(broken,owner,ctx({bound:{[RTC_SIGNALING_SLOT]:two}}));
 assert.deepEqual(calls.at(-1)[2].actor.bound,{values:{},versions:{}},'an unreadable record approves nothing');
});

test('federation journal: RTC reads are never journaled and RTC write results are not retained',async()=>{
 const db=new SqliteMetadata(':memory:'),rows=new Map();let executed=0;
 const self={metadata:federationMetadata(db),clock:()=>Date.now(),dispatcher:{durableJournal:true,readOnly:x=>x.contract===RTC_SIGNALING_CONTRACT&&['listen','endpoints'].includes(x.method),retainResult:x=>x.contract!==RTC_SIGNALING_CONTRACT,execute:async()=>{executed++;return {link:'https://home.example/rtc/t/secret?bindle_meta=x'};}}};
 const ctx=method=>({subject:'https://home.example/entities/x',clientId:'c',tx:'0b9c1b44-8a5e-4a43-9a3b-0c0c0c0c0c0c',resource:'r',contract:RTC_SIGNALING_CONTRACT,method,args:{}});
 await FederationController.prototype.dispatch.call(self,ctx('listen'),crypto);
 assert.equal((await db.list({prefix:'federation/journal/'})).size,0,'listen is a read');
 const first=await FederationController.prototype.dispatch.call(self,ctx('mint_ticket'),crypto);assert.ok(first.link);
 const journal=[...(await db.list({prefix:'federation/journal/'})).values()];assert.equal(journal.length,1);assert.ok(!JSON.stringify(journal).includes('secret'),'the ticket link is not kept');
 const again=await FederationController.prototype.dispatch.call(self,ctx('mint_ticket'),crypto);assert.equal(executed,2);assert.equal(again.__federationError?.code??again.error?.code??Object.values(again)[0]?.code,'indeterminate');
 rows.clear();db.close();
});

test('lifecycle triggers: bound narrowing and grant revocation tell the occupant hook the remaining approval (null when none)',async t=>{
 const issuer='https://provider.example',subject=issuer+'/entities/alice',authority={session:'owner'},client='https://a.example/client';
 const db=new SqliteMetadata(':memory:'),config={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_SCHEMAS:{[RTC_SIGNALING_SLOT]:structuredClone(RTC_SIGNALING_SLOT_MANIFEST)}};
 const artefacts=configuredArtefacts({config,store:db});config.ARTEFACTS=artefacts;t.after(async()=>{await artefacts.engine.dispose();db.close();});
 const service=new FederationService({issuer,store:federationMetadata(db),schemaHosts:['spec.bindle.example'],schemaFetcher:reviewedSchemaFetcher(config),authenticateOwner:async()=>({subject,epoch:'epoch'}),clients:[{id:client,origin:'https://a.example',name:'a.example',redirectUris:['https://a.example/callback']}],boundOptions:true,boundArtefacts:RTC_BOUND_ARTEFACTS});
 const seen=[];service.boundChanged=async x=>{seen.push(structuredClone(x));};
 const begin=async options=>(await service.beginAuthorization({clientId:client,redirectUri:'https://a.example/callback',challenge:'A'.repeat(43),challengeMethod:'S256',state:'s',requests:[{fragment:RTC_SIGNALING_SLOT,required:true,purpose:'Ring you',fields:['signaling'],options}]})).requestId;
 const id=await begin({purposes:[CALL,SYNC].sort()});await service.configure(authority,{fragment:RTC_SIGNALING_SLOT,values:{}});const r=(await service.inspect(id,authority)).requests[0];
 await service.approve(authority,{requestId:id,approved:[{fragment:RTC_SIGNALING_SLOT,fields:['signaling'],resources:{signaling:[]},methods:{},revision:r.revision,options:{purposes:[CALL,SYNC].sort()}}]});
 await service.narrowBoundOptions(authority,{clientId:client,fragment:RTC_SIGNALING_SLOT,options:{purposes:[CALL]}});
 const {at:narrowedAt,...narrowed}=seen.at(-1);assert.deepEqual(narrowed,{subject,clientId:client,fragment:RTC_SIGNALING_SLOT,values:{purposes:[CALL]}});
 // RTC-i review L1: `at` is the shard's clock when boundSync read the remaining grants, never before the narrowing.
 const narrowedGrant=(await service.store.transaction(tx=>tx.list('federation/grant/'))).map(x=>x.value).find(g=>g.active);
 assert.ok(Number.isSafeInteger(narrowedAt)&&narrowedAt>=narrowedGrant.bound.narrowedAt,'boundChanged carries the sync time');
 const grant=(await service.store.transaction(tx=>tx.list('federation/grant/'))).map(x=>x.value).find(g=>g.active);
 await service.revoke(authority,grant.id);
 {const {at,...rest}=seen.at(-1);assert.deepEqual(rest,{subject,clientId:client,fragment:RTC_SIGNALING_SLOT,values:null},'revocation of the last bound grant: app-revoked');assert.ok(at>=narrowedAt);}
 // A hook that fails never fails the revocation (the occupant re-checks the live approval anyway).
 service.boundChanged=async()=>{throw new Error('down');};assert.deepEqual(await service.revoke(authority,grant.id),{revoked:true});
});

test('key roster: cache-only reads, bounded refresh queue per issuer and in total, negative caching, manifest floor first',async()=>{
 const calls=[];let now=0,fail=false,feature={endpoint:`${B}/bindle/rtc`,max_leg_certificate_seconds:300};
 const d={allowed:iss=>[B,C].includes(iss)||/^https:\/\/d\d\.example$/.test(iss),peek:()=>null,resolve:async()=>null,peekFeatures:()=>({'rtc-signaling.v1':feature}),
  features:async iss=>{calls.push(['manifest',iss]);if(fail)throw Object.assign(new Error('x'),{code:'temporarily_unavailable'});return {'rtc-signaling.v1':feature};},
  refresh:async x=>{calls.push(['refresh',x.issuer,x.subject,x.kid??null,x.priority]);}};
 const r=new RtcKeyRoster({issuer:A,directory:()=>d,clock:()=>now});
 const p=(iss,n)=>({iss,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});
 assert.deepEqual(await r.certification(p(B,1)),[]);assert.equal(await r.identity(p(B,1)),null);assert.deepEqual(calls,[],'reads never dial');
 // A document key the pin does not hold as active (the directory's resolve refuses it) is never used.
 const jwk=(await keyPair()).jwk;d.peek=()=>({keys:[{kid:'k1',use:'cert',state:'active',jwk},{kid:'s1',use:'sig',state:'active',jwk}]});
 assert.deepEqual(await r.certification(p(B,1)),[]);
 d.resolve=async x=>x.kid==='k1'?{kid:'k1',purpose:'certification',verifiable:true,publicJwk:jwk,identity:`${B}/identity/x`}:null;
 assert.deepEqual((await r.certification(p(B,1))).map(k=>k.kid),['k1']);assert.equal(await r.identity(p(B,1)),`${B}/identity/x`);
 d.peek=()=>null;d.resolve=async()=>null;
 assert.equal(r.refresh(p(A,1)),false,'own issuer');assert.equal(r.refresh(p('https://other.example',1)),false,'not allowlisted');assert.equal(r.refresh({iss:B,sub:'nope'}),false);
 for(let n=0;n<40;n++)r.refresh(p(B,n));assert.equal(r.queue.size,16,'per-issuer bound');
 for(let n=0;n<80;n++)r.refresh(p(C,n));assert.equal(r.queue.size,32);
 for(const host of ['d1','d2','d3','d4'])for(let n=0;n<16;n++)r.refresh(p(`https://${host}.example`,n));assert.equal(r.queue.size,64,'total bound');
 assert.ok(r.queue.size<=64);assert.equal(r.maxLegSeconds(p(B,1)),300,'the declared bound as held');
 const out=await r.run({limit:4});assert.equal(out.fetched,4);assert.ok(calls.every(c=>c[0]!=='refresh'||c[4]==='claimed'),'claims spend the directory\'s claimed class (review F1)');
 // The manifest floor first: without a valid rtc-signaling.v1, no identity document is fetched.
 calls.length=0;feature={endpoint:'https://169.254.169.254/x',max_leg_certificate_seconds:300};r.queue.clear();r.refresh(p(B,99),'kid-9');await r.run();
 assert.deepEqual(calls.map(c=>c[0]),['manifest']);
 // A failure is negatively cached for a minute; then retried.
 assert.equal(r.refresh(p(B,99)),false,'negative cache');now+=61000;assert.equal(r.refresh(p(B,99)),true);
 feature={endpoint:`${B}/bindle/rtc`,max_leg_certificate_seconds:300};calls.length=0;await r.run();assert.deepEqual(calls.at(-1),['refresh',B,p(B,99).sub,null,'claimed']);
 // A rotation names the unknown kid; the directory refetches once for it.
 r.queue.clear();calls.length=0;r.refresh(p(B,7),'kid-new');await r.run();assert.deepEqual(calls.at(-1),['refresh',B,p(B,7).sub,'kid-new','claimed']);
 // The roster itself is bounded and expires after 24 h.
 for(let n=0;n<600;n++)r.track(p(B,1000+n));assert.equal(r.roster.size,512);now+=86400001;r.queue.clear();await r.run({limit:0});assert.equal(r.roster.size,0);
 // Gated off (no directory): nothing.
 const off=new RtcKeyRoster({issuer:A,directory:()=>null});assert.equal(off.refresh(p(B,1)),false);assert.equal(await off.warm(p(B,1)),false);
});

test('endpoint size bound: an oversized body is refused without reading it whole',async()=>{
 const W=await rtcWorld();let pulled=0;const chunk=new Uint8Array(16384).fill(32);
 const stream=new ReadableStream({pull(c){if(pulled>=1048576){c.close();return;}pulled+=chunk.length;c.enqueue(chunk);}});
 const r=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE},body:stream,duplex:'half'}),env:W.provider(B).env,local:false});
 assert.equal(r.status,400);assert.ok(pulled<=131072+3*16384,`read ${pulled} bytes`);
 // A declared Content-Length above the bound is refused before any read.
 pulled=0;const s2=new ReadableStream({pull(c){pulled+=chunk.length;c.enqueue(chunk);}});
 const r2=await rtcEndpoint({request:new Request(`${B}/bindle/rtc`,{method:'POST',headers:{'Content-Type':RTC_BATCH_MEDIA_TYPE,'Content-Length':'200000'},body:s2,duplex:'half'}),env:W.provider(B).env,local:false});
 assert.equal(r2.status,400);assert.ok(pulled<=2*16384,'not read');
});

test('a peer issuer\'s declared max_leg_certificate_seconds bounds its leg certificates',async()=>{
 const W=await rtcWorld();W.provider(B).manifestFeature={endpoint:`${B}/bindle/rtc`,max_leg_certificate_seconds:300};
 const {a,b,s}=await ticketCall(W);assert.ok(b.invites().some(e=>e.sid===s.sid),'A declares 600 and issues 600: accepted');
 // B declares 300 but certifies 600 s legs: A refuses B's answer.
 const sb=await b.claim(s.sid);assert.equal(payloadOf(sb.certificate).exp-payloadOf(sb.certificate).iat,600);await b.accept(sb);await W.pump();await a.listen();
 assert.ok(!a.events.some(e=>e.type==='message'),'a certificate longer than its issuer declares never verifies');
});
