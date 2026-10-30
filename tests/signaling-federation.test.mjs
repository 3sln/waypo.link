// Signaling federation, engine level (retargeted from rtc-federation.test.mjs for signaling rev 3.2): two providers in
// one process (tests/helpers/signaling-federation-fixture.mjs), each with its own entities, stores, directory, key
// roster, foreign transport and the real `POST /bindle/signaling` route, over a fake network. Cross-entity sessions
// carry an offer basis (§5.7; the ticket and link bases are withdrawn, §5.3) or a relation basis. Local behaviour only
// (no real HTTPS, DNS, push service or relay); hosts are reserved .example names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingWorld,A,B,C,CHAT,SYNC,CALLBACK,CLIENT,OPS,identityURI,payloadOf,headerOf,fault,keyPair,relay,perform} from './helpers/signaling-federation-fixture.mjs';
import {signMessage,signLegCertificate,signControl} from '../packages/signaling/certificates.mjs';
import {buildBatch,BATCH_MEDIA_TYPE,offerDigest} from '../packages/signaling/messages.mjs';
import {signalingEgress,foreignSignalingTransport,SignalingKeyRoster,controlOnly} from '../packages/signaling/federation.mjs';
import {signalingEndpoint} from '../packages/runtime/routes/signaling.mjs';
import {signJws,MESSAGE_TYP} from '../packages/signaling/jws.mjs';
import {createIntegrationEgress} from '../packages/federation/resource-discovery.mjs';
import {createNodeIntegrationEgress} from '../packages/federation/node-integration-egress.mjs';

const seconds=ms=>Math.floor(ms/1000),sidOf=n=>Buffer.from(Array(16).fill(n)).toString('base64url');
const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
/** One cross-provider session on a bound offer: B1's app mints an offer for A1, A1 dials back. Returns the parts. */
async function offerCall(W,{push}={}){
 const b=W.provider(B).device(1,{push}),a=W.provider(A).device(1);await b.register();await a.register();
 const offer=await b.offer(CHAT,{principals:[a.principal]});const s=await a.open(b.principal,CHAT,{basis:offer});
 await a.invite(s);await W.pump();
 // The first copy found A's keys not held at B (dropped after a 202, refresh scheduled); the initiator provider re-sends.
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 return {a,b,s,offer};
}
const posts=(W,to)=>W.posts.filter(p=>!to||p.to===to);
async function rows(e,prefix){return [...await e.store.list({prefix})];}
const REF=W=>W.ref(CHAT);

test('cross-provider session: offer invite, claim, connect, candidates and close; delivery only to manifest endpoints',async()=>{
 const W=await signalingWorld();const {a,b,s,offer}=await offerCall(W);
 assert.ok(s.result.peer_keys.length>0,'open warmed the recipient keys (initiator-initiated fetch, §5.1)');
 const invite=b.invites().find(e=>e.sid===s.sid);assert.ok(invite,'the invite reached the minting endpoint');
 assert.deepEqual(invite.projection.initiator,a.principal);assert.equal(invite.projection.handle,undefined,'no foreign handle is shown');
 assert.equal(invite.projection.basis,'offer');assert.equal(invite.projection.offer_match,true,'offer_match on the minting endpoint');assert.equal(invite.projection.reported_by,A);
 assert.ok(!JSON.stringify(b.events).includes(offer),'the offer token is never delivered to endpoints');
 const sb=await b.claim(s.sid);assert.equal(payloadOf(sb.certificate).aud,identityURI(a.principal));assert.equal(payloadOf(sb.certificate).role,'recipient');
 await b.accept(sb);await W.pump();await a.listen();
 const accept=a.events.find(e=>e.type==='message'&&payloadOf(e.message).type==='accept');assert.ok(accept,'the accept reached the initiator');
 await a.candidates(s);await b.candidates(sb);await W.pump();await a.listen();await b.listen();
 assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));assert.ok(a.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='candidates'));
 await a.end(s);await W.pump();await b.listen();
 assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='end'));assert.equal(b.events.at(-1).state,'ended');
 // Every POST went to a declared manifest endpoint; every GET to an allowlisted issuer's directory paths.
 for(const r of W.requests){const u=new URL(r.url);assert.ok([A,B].includes(u.origin),r.url);if(r.method==='POST')assert.equal(u.pathname,'/bindle/signaling');else assert.ok(/^\/(\.well-known\/bindle\/manifest\.json|directory|identity\/[0-9a-f-]{36}\/identity\.json)$/.test(u.pathname),r.url);}
 assert.ok(posts(W).every(p=>p.status===202),'every batch passed step 1');
 // The invite batches to B carried the token beside the invite (§9.1 `offers`); nothing else did.
 const carried=posts(W,B).filter(p=>JSON.parse(p.body).offers?.includes(offer));assert.ok(carried.length>=1);
 assert.ok(carried.every(p=>JSON.parse(p.body).messages.some(m=>payloadOf(m).type==='invite')),'the token rides only beside its invite');
 // The bound offer was spent at admission (single-use, §5.2).
 assert.deepEqual((await W.provider(B).run(1,'signaling.offers')).offers.map(o=>[o.principal?.sub,o.uses,o.spent,o.reserved]),[[a.entity.sub,1,1,0]],'spent at admission; listed as used up (§14.1) until it expires');
 // Both outboxes drain to empty, and the holder deleted the token with the invite payload (§5.7).
 assert.equal((await rows(a.entity,'sig/outbox/')).length,0);assert.equal((await rows(b.entity,'sig/outbox/')).length,0);
 assert.equal((await a.entity.store.get(`sig/out/${s.sid}`)).offerToken,undefined);
});

test('a re-sent invite is deduplicated at the recipient provider: one session, one delivery, until it is answered',async()=>{
 const W=await signalingWorld();const {b,s}=await offerCall(W);
 for(let i=0;i<3;i++){W.clock.advance(4000);await W.tickAll();await W.pump();}
 await b.listen();assert.equal(b.invites().filter(e=>e.sid===s.sid).length,1);
 assert.ok(posts(W,B).length>=2,'the initiator provider re-sent the unanswered invite (§9.3)');
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();const before=posts(W,B).length;
 W.clock.advance(20000);await W.tickAll();await W.pump();
 assert.equal(posts(W,B).length,before,'an answered invite is no longer re-sent');
 assert.equal((await rows(b.entity,'sig/in/')).length,1);
});

test('key rotation mid-session: a key published before use is picked up by refresh-ahead; an abrupt rotation is dropped until refreshed',async()=>{
 const W=await signalingWorld({maxAge:60});const {a,b,s}=await offerCall(W);const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 // B publishes a second certification key, keeps signing with the first; A's roster refreshes ahead of the TTL.
 const next=await b.entity.addCertKey({use:false});W.clock.advance(31000);await W.tickAll();
 assert.ok((await a.entity.roster.certification(b.principal)).some(k=>k.kid===next),'refresh-ahead fetched the published key');
 b.entity.signing=next;const renewed=await b.renew(sb);assert.equal(headerOf(renewed.certificate).kid,next);b.entity.retireOthers();
 await b.candidates(sb);await W.pump();await a.listen();
 const got=a.events.filter(e=>e.type==='message'&&payloadOf(e.message).type==='candidates');assert.equal(got.length,1,'the renewed leg verifies under the rotated key');
 // The same at the initiator: B tracked A when A's leg verified, so its roster also refreshes A ahead of the TTL.
 const nextA=await a.entity.addCertKey({use:false});W.clock.advance(31000);await W.tickAll();
 assert.ok((await b.entity.roster.certification(a.principal)).some(k=>k.kid===nextA),'the recipient provider keeps the initiator warm (§9.2 step 3)');
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
 assert.deepEqual(await state(b.entity,'sig/in/'),['ended']);assert.deepEqual(await state(a.entity,'sig/out/'),['ended']);
});

test('provider outage: delivery backs off and retries; a 429 or 503 is retried; a 404 is dropped; nothing outlives answer_by',async()=>{
 const W=await signalingWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});
 W.net.down.add(B);await a.invite(s);await W.pump();
 const [[,row]]=await rows(a.entity,'sig/outbox/');assert.ok(row.attempts>=1&&row.notBefore>W.clock.now(),'backed off');
 W.net.down.delete(B);for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite');i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===s.sid),'delivered after the outage');
 // 429 (B sheds this network) is retried; the row stays until accepted.
 const abuse=W.provider(B).env.ABUSE.consume;
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();W.provider(B).env.ABUSE.consume=async()=>false;await a.candidates(s);await W.pump();
 assert.ok(posts(W,B).some(p=>p.status===429));assert.equal((await rows(a.entity,'sig/outbox/')).length,1,'held for retry');
 W.provider(B).env.ABUSE.consume=abuse;W.clock.advance(5000);await W.pump();assert.equal((await rows(a.entity,'sig/outbox/')).length,0);
 // A 404 (B turned its endpoint off) is permanent: the row is dropped, not retried.
 W.provider(B).env.SIGNALING_FOREIGN_ENABLED='false';await a.end(s);await W.pump();
 assert.ok(posts(W,B).at(-1).status===404);assert.equal((await rows(a.entity,'sig/outbox/')).length,0);
 W.provider(B).env.SIGNALING_FOREIGN_ENABLED='true';
 // An outage longer than the answer window: the invite and its re-sends are dropped at answer_by; the initiator ends.
 const s2=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});W.net.down.add(B);await a.invite(s2);
 for(let i=0;i<70;i++){W.clock.advance(2000);await W.tickAll();await W.pump();}
 assert.equal((await rows(a.entity,'sig/outbox/')).length,0,'nothing is kept past its useful life');
 const rec=(await rows(a.entity,'sig/out/')).find(([k])=>k.endsWith(s2.sid))[1];assert.equal(rec.state,'ended');assert.equal(rec.offerToken,undefined,'the token went with the invite');
});

/** A raw POST to B's route from `from` (a malicious or replaying provider). */
const raw=(W,body,{to=B,type=BATCH_MEDIA_TYPE}={})=>signalingEndpoint({request:new Request(`${to}/bindle/signaling`,{method:'POST',headers:{'Content-Type':type,'CF-Connecting-IP':'203.0.113.99'},body}),env:W.provider(to).env,local:false});
const inviteBody=(W,now,extra={})=>({kind:REF(W),profile:'webrtc',answer_by:seconds(now)+60,basis:null,context:null,params:{offer:null},...extra});

test('malicious provider inputs: forged keys, replayed batches, oversized batches, wrong aud or iss are refused or ignored uniformly',async()=>{
 const W=await signalingWorld({providers:[A,B,C]});const {a,b,s}=await offerCall(W);const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 const be=b.entity,events=async()=>{await W.pump();return (await b.listen()).events;};await b.listen();
 // Forged keys: C mints a leg certificate claiming to be A1, signed by C's own certification key.
 const evil=W.provider(C).entity(1),leg=await keyPair(),now=W.clock.now(),client={client_id:CLIENT,origin:'https://app.example',feature:null};
 const sid=sidOf(1),forged=(await signLegCertificate({issuer:A,sub:a.entity.sub,identity:identityURI(a.principal),aud:identityURI(b.principal),sid,role:'initiator',kind:REF(W),profile:'webrtc',client,delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600},{kid:a.entity.signing,privateKey:evil.certKeys[0].privateKey})).certificate;
 const invite=await signMessage({bindle:'signaling-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid,leg:leg.jkt,to:null,seq:0,iat:seconds(now),type:'invite',body:inviteBody(W,now)},leg.privateKey);
 const r1=await raw(W,buildBatch({certificates:[forged],messages:[invite]}));assert.equal(r1.status,202,'step 1 passes; steps 2–8 are silent');
 assert.deepEqual(await events(),[]);assert.ok(!(await rows(be,'sig/in/')).some(([k])=>k.endsWith(sid)));
 // A certificate that claims C's own principal: C's manifest lacks the signaling declaration, so B never fetches its identity.
 W.provider(C).manifestFeature=null;
 const own=(await signLegCertificate({issuer:C,sub:evil.sub,identity:identityURI(evil.principal),aud:identityURI(b.principal),sid:sidOf(2),role:'initiator',kind:REF(W),profile:'webrtc',client,delegate:leg.jwk,aep:0,now,lifetime:600,maxSeconds:600},{kid:evil.signing,privateKey:evil.certKeys[0].privateKey})).certificate;
 const inv2=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub,sid:sidOf(2)},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[own],messages:[inv2]}))).status,202);W.clock.advance(1000);await W.tickAll();await W.pump();
 assert.ok(!W.requests.some(r=>r.from===B&&r.url.includes(`${C}/identity/`)),'manifest floor first: no identity fetch from an issuer without the signaling declaration');
 assert.deepEqual(await events(),[]);
 // Replay: every batch B ever accepted, re-posted: 202 each, and nothing new reaches the endpoint.
 for(const p of posts(W,B).filter(p=>p.status===202))assert.equal((await raw(W,p.body)).status,202);
 assert.deepEqual(await events(),[],'replays are deduplicated (§7.3)');
 // Oversized and malformed batches are refused whole (400) before any writer is touched.
 const big=buildBatch({messages:[invite]}).replace('"v":1','"v":1,"pad":"'+'x'.repeat(140000)+'"');
 for(const body of [big,'{','{"v":1,"certificates":[],"messages":[],"controls":[]}',buildBatch({messages:[invite]}).replace('"v":1','"v":2')]){const r=await raw(W,body);assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'signaling_batch_invalid'});}
 assert.equal((await raw(W,buildBatch({messages:[invite]}),{type:'application/json'})).status,400,'exact media type');
 assert.equal((await raw(W,buildBatch({messages:[invite]}),{type:'application/vnd.bindle.rtc+json'})).status,400,'the RTC media type is gone');
 // Wrong aud: another origin is a step-1 failure; an unknown entity here is the uniform 404 (AMD-RI1); two auds are
 // refused with 400 (AMD-RI2).
 const toOther=await signMessage({...payloadOf(invite),aud:`${A}/identity/${a.entity.sub}`},leg.privateKey);
 assert.equal((await raw(W,buildBatch({messages:[toOther]}))).status,400);
 const unknown=await signMessage({...payloadOf(invite),aud:`${B}/identity/0a0a0a0a-0002-4000-8000-0000000000ff`},leg.privateKey);
 const u=await raw(W,buildBatch({messages:[unknown]}));assert.equal(u.status,404);assert.deepEqual(await u.json(),{error:'not_found'});
 const two=await raw(W,buildBatch({certificates:[forged],messages:[unknown]}));assert.equal(two.status,400,'one batch, one aud');assert.deepEqual(await two.json(),{error:'signaling_batch_invalid'});
 // AMD-RW2: an element whose iss is this host is refused at the public endpoint (same-host traffic is internal only).
 const sameHost=await signMessage({...payloadOf(invite),iss:B,sub:W.entity(B,2).sub,sid:sidOf(4)},leg.privateKey);
 assert.equal((await raw(W,buildBatch({messages:[sameHost]}))).status,400,'this host\'s own iss');
 // Wrong iss: a message whose iss differs from its certificate's is dropped silently.
 const wrongIss=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub,sid:sidOf(3)},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[forged],messages:[wrongIss]}))).status,202,'step 1 does not compare elements; later steps drop it silently');
 const wrongIss2=await signMessage({...payloadOf(invite),iss:C,sub:evil.sub},leg.privateKey);
 assert.equal((await raw(W,buildBatch({certificates:[forged],messages:[wrongIss2]}))).status,202);assert.deepEqual(await events(),[]);
 // A forged control statement from a non-party for the live session is ignored; the session stays connected.
 const control=await signControl({issuer:C,sub:evil.sub,aud:identityURI(b.principal),sid:s.sid,leg:null,reason:'revoked',now,jti:'j'.repeat(24)},{kid:evil.signing,privateKey:evil.certKeys[0].privateKey});
 assert.equal((await raw(W,buildBatch({controls:[control]}))).status,202);await W.pump();
 assert.equal((await rows(be,'sig/in/')).find(([k])=>k.endsWith(s.sid))[1].state,'connected');
 // Per-network shedding before step 1.
 const abuse=W.provider(B).env.ABUSE.consume;W.provider(B).env.ABUSE.consume=async()=>false;const shed=await raw(W,buildBatch({messages:[invite]}));assert.equal(shed.status,429);assert.equal(shed.headers.get('Retry-After'),'60');W.provider(B).env.ABUSE.consume=abuse;
});

test('withdrawn members (§5.3, §7.2, §9.1): an invite carrying callback_digest or link_digest, and a batch carrying links, fail step 1',async()=>{
 const W=await signalingWorld();const a=W.entity(A,1),b=W.entity(B,1),leg=await keyPair(),now=W.clock.now();
 // signMessage refuses an invalid payload, so the withdrawn shapes are signed raw (a correctly signed, low-S JWS).
 const msg=body=>signJws({typ:MESSAGE_TYP,kid:leg.jkt,claims:{bindle:'signaling-message',v:1,iss:A,sub:a.sub,aud:identityURI(b.principal),sid:sidOf(7),leg:leg.jkt,to:null,seq:0,iat:seconds(now),type:'invite',body},privateKey:leg.privateKey});
 const ok=buildBatch({messages:[await msg(inviteBody(W,now))]});
 assert.equal((await raw(W,ok)).status,202,'the baseline invite passes step 1');
 const answers=[];
 for(const body of [inviteBody(W,now,{callback_digest:null}),inviteBody(W,now,{callback_digest:'A'.repeat(43)}),inviteBody(W,now,{basis:{link_digest:'A'.repeat(43)}}),inviteBody(W,now,{media:['audio']}),inviteBody(W,now,{ring_until:seconds(now)+60}),inviteBody(W,now,{sas_commit:null})])answers.push((await raw(W,JSON.stringify({v:1,certificates:[],messages:[await msg(body)],controls:[]}))).status);
 assert.deepEqual(answers,[400,400,400,400,400,400],'each withdrawn invite member is unknown, so invalid');
 const links=JSON.stringify({...JSON.parse(ok),links:[]});const r=await raw(W,links);assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'signaling_batch_invalid'});
 assert.equal((await raw(W,JSON.stringify({...JSON.parse(ok),links:['x.y.z']}))).status,400);
 // `offers` carries only well-formed tokens (22 to 43 base64url characters), at most 4.
 assert.equal((await raw(W,JSON.stringify({...JSON.parse(ok),offers:['short']}))).status,400);
 assert.equal((await raw(W,JSON.stringify({...JSON.parse(ok),offers:[token(),token(),token(),token(),token()]}))).status,400);
});

test('SSRF: peer identity, directory and endpoint URLs off the issuer origin, non-allowlisted issuers and private targets are never dialed',async()=>{
 const W=await signalingWorld({providers:[A,B,C],allow:{[A]:[B],[B]:[A],[C]:[]}});
 const a=W.provider(A).device(1);await a.register();
 const dialed=host=>W.requests.some(r=>new URL(r.url).hostname===host);
 // A cross-entity open needs a basis; the initiator cannot check an offer (only the minting provider holds it), so any
 // well-formed token reaches the recipient issuer checks.
 // The directory names an identity on another origin, or on a literal address: refused, never fetched.
 for(const identity of [`${C}/identity/x`,'https://127.0.0.1/identity/x','https://169.254.169.254/latest/meta-data','http://beta.example/identity/x']){
  W.provider(B).directoryPatch=()=>({identity});const B2=await W.provider(B).add(10+W.provider(B).entities.size);
  assert.equal((await fault(a.open(B2.principal,CHAT,{basis:token()}))).code,'temporarily_unavailable',identity);
 }
 W.provider(B).directoryPatch=null;
 assert.ok(!dialed('gamma.example')&&!dialed('127.0.0.1')&&!dialed('169.254.169.254'));
 // The manifest's signaling `endpoint` on another origin (or a metadata address) is not a valid declaration: no
 // identity document is fetched and nothing is ever posted there. The manifest is then held with no valid declaration,
 // a public fact (`unsupported_peer`, §5.1).
 for(const endpoint of ['https://169.254.169.254/bindle/signaling',`${C}/bindle/signaling`,'https://beta.example:8443/bindle/signaling','http://beta.example/bindle/signaling']){
  W.clock.advance(301000);// the cached manifest expires (max-age 300)
  W.provider(B).manifestFeature={endpoint,max_leg_certificate_seconds:600,profiles:['data','webrtc']};const fresh=await W.provider(B).add(30+W.provider(B).entities.size);
  const before=W.requests.filter(r=>r.url.includes('/identity/'+fresh.sub)).length;
  assert.equal((await fault(a.open(fresh.principal,CHAT,{basis:token()}))).code,'unsupported_peer',endpoint);
  assert.equal(W.requests.filter(r=>r.url.includes('/identity/'+fresh.sub)).length,before,'manifest floor before any identity fetch');
  assert.equal((await fault(a.open(fresh.principal,CHAT,{basis:token()}))).code,'unsupported_peer','held manifest without a valid declaration');
 }
 assert.ok(!W.requests.some(r=>r.method==='POST'),'nothing was posted');assert.ok(!dialed('169.254.169.254')&&!dialed('gamma.example'));
 W.provider(B).manifestFeature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data','webrtc']};
 // A recipient whose issuer is not on the allowlist: refused without a single request to it.
 assert.equal((await fault(a.open(W.provider(C).entity(1).principal,CHAT,{basis:token()}))).code,'temporarily_unavailable');assert.ok(!dialed('gamma.example'));
 // A sender claiming a non-allowlisted issuer never schedules a fetch to it (roster refuses), whatever it posts.
 assert.equal(a.entity.roster.refresh(W.provider(C).entity(1).principal),false);
 // The POST wrapper: only https on an allowlisted origin, no query, port, userinfo or fragment; bounded body.
 const sent=[],post=signalingEgress({send:async input=>{sent.push(input.url);return {status:202};},issuers:[B]});
 for(const url of [`${C}/bindle/signaling`,'https://127.0.0.1/bindle/signaling','http://beta.example/bindle/signaling','https://beta.example:444/bindle/signaling','https://u:p@beta.example/bindle/signaling',`${B}/bindle/signaling?x=1`,`${B}/bindle/signaling#f`])
  assert.equal((await fault(post(url,'{}'))).code,'signaling_target_refused',url);
 assert.equal((await fault(post(`${B}/bindle/signaling`,'x'.repeat(131073)))).code,'signaling_batch_invalid');assert.equal(await post(`${B}/bindle/signaling`,'{}'),202);assert.deepEqual(sent,[`${B}/bindle/signaling`]);
 // The adapters' screened egress refuses private answers before connecting (Workers: DoH + strictly public routing;
 // Node: DNS pinned, public IPv4 only).
 for(const address of ['10.0.0.1','127.0.0.1','169.254.169.254','::1','fd00::1','100.64.0.1']){
  let fetched=0;const worker=createIntegrationEgress({resolve:async()=>[address],publicRouting:true,fetcher:async()=>{fetched++;return new Response(null,{status:202});}});
  assert.equal((await fault(worker.send({url:`${B}/bindle/signaling`,headers:{'Content-Type':BATCH_MEDIA_TYPE},body:'{}',maxBytes:1024,requestBytes:131072}))).code,'egress_refused',address);assert.equal(fetched,0);
  let dials=0;const node=createNodeIntegrationEgress({issuer:A,lookup:async()=>[{address,family:address.includes(':')?6:4}],request:()=>{dials++;throw new Error('dialed');}});
  assert.equal((await fault(node.send({url:`${B}/bindle/signaling`,headers:{'Content-Type':BATCH_MEDIA_TYPE},body:'{}',maxBytes:1024,requestBytes:131072}))).code,'egress_refused',address);assert.equal(dials,0);
 }
});

test('profiles (§3.1, §5.1): open fails with unsupported_peer when the peer declaration lacks the profile; a data session connects',async()=>{
 const W=await signalingWorld();W.provider(B).manifestFeature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data']};
 const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();
 // The issuer's manifest is fetched (an initiator-initiated fetch) before the outcome.
 await a.entity.roster.feature(B,'interactive');assert.deepEqual(a.entity.roster.profiles(b.principal),['data'],'held as declared');
 assert.equal((await fault(a.open(b.principal,CHAT,{basis:token()}))).code,'unsupported_peer','webrtc is not declared');
 assert.equal((await fault(a.offer(CHAT,{principals:[b.principal]}))).code,'unsupported_peer','offer checks the peer profile too');
 // A data-profile session on an offer connects across providers.
 const s=await a.open(b.principal,CHAT,{profile:'data',basis:await b.offer(CHAT,{principals:[a.principal],profile:'data'})});await a.invite(s);await W.pump();
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 await a.data(s,32);await W.pump();await b.listen();
 assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='data'),'data relayed after the claim');
});

test('profiles (§5.1): the first open to an issuer whose manifest is not yet held still answers unsupported_peer for an undeclared profile',async()=>{
 const W=await signalingWorld();W.provider(B).manifestFeature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data']};
 const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();
 assert.equal((await fault(a.open(b.principal,CHAT,{basis:token()})))?.code,'unsupported_peer');
});

test('flags off: no foreign session, no outbound request, the endpoint answers the uniform 404',async()=>{
 const W=await signalingWorld({flags:{SIGNALING_FOREIGN_ENABLED:false}});const b=W.provider(B).device(1),a=W.provider(A).device(1);
 // SIGNALING_FOREIGN_ENABLED off: an endpoint operation toward another provider is the public `unsupported_peer` fact.
 await b.register();await a.register();assert.equal((await fault(a.open(b.principal,CHAT,{basis:token()}))).code,'unsupported_peer');
 assert.equal((await fault(a.offer(CHAT,{principals:[b.principal]}))).code,'unsupported_peer');
 assert.deepEqual(W.requests,[],'nothing dialed');assert.deepEqual(await a.entity.roster.certification(b.principal),[]);
 // SIGNALING_ENABLED (or SESSION_KINDS_ENABLED) off as well: register itself is the uniform not_found.
 W.provider(A).flags.SIGNALING_ENABLED=false;assert.equal((await fault(W.provider(A).device(2,{approve:false}).register())).code,'not_found');
 W.provider(A).flags.SIGNALING_ENABLED=true;W.provider(A).flags.SESSION_KINDS_ENABLED=false;assert.equal((await fault(W.provider(A).device(2,{approve:false}).register())).code,'not_found');
 // The endpoint while off, for any method and body: the uniform 404, identical to an unknown target.
 W.provider(B).env.SIGNALING_FOREIGN_ENABLED='false';
 const answers=[];for(const [method,body] of [['POST','{}'],['GET',undefined],['PUT','x'],['POST','{"v":1}']]){const r=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method,...body!==undefined?{body,headers:{'Content-Type':BATCH_MEDIA_TYPE}}:{}}),env:W.provider(B).env,local:false});answers.push([r.status,await r.text(),r.headers.get('Cache-Control')]);}
 assert.ok(answers.every(x=>JSON.stringify(x)===JSON.stringify([404,'{"error":"not_found"}','no-store'])),JSON.stringify(answers));
 for(const name of ['SIGNALING_ENABLED','SESSION_KINDS_ENABLED']){const env={...W.provider(B).env,SIGNALING_FOREIGN_ENABLED:'true',[name]:'false'};const r=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method:'POST',body:'{}',headers:{'Content-Type':BATCH_MEDIA_TYPE}}),env,local:false});assert.equal(r.status,404,name);}
 // A transport whose foreign flag is off refuses message batches (retried by the outbox until their useful life)
 // but still delivers control statements (narrowing).
 const calls=[],roster={feature:async()=>({endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data','webrtc']})};
 const t=foreignSignalingTransport({issuer:A,local:{deliver:async()=>({})},roster,post:async url=>{calls.push(url);return 202;},enabled:async()=>false});
 const ctl=JSON.stringify({v:1,certificates:[],messages:[],controls:['a.b.c']}),msg=JSON.stringify({v:1,certificates:[],messages:['a.b.c'],controls:[]});
 assert.equal(controlOnly(ctl),true);assert.equal(controlOnly(msg),false);assert.equal(controlOnly(JSON.stringify({v:1,certificates:[],messages:[],controls:['a.b.c'],links:[]})),false,'a batch with links is not a batch');
 assert.equal((await fault(t.deliver({iss:A,sub:'x'},{iss:B,sub:'y'},msg))).code,'signaling_foreign_disabled');assert.deepEqual(await t.deliver({iss:A,sub:'x'},{iss:B,sub:'y'},ctl),{accepted:true});assert.equal(calls.length,1);
});

test('uniform 404: unknown, malformed, inactive and disabled targets answer the same bytes; valid batches answer an empty 202',async()=>{
 const W=await signalingWorld();const {a,b,s}=await offerCall(W);const env=W.provider(B).env;
 const accepted=posts(W,B).find(p=>p.status===202).body,leg=await keyPair(),now=W.clock.now();
 const msg=aud=>signMessage({bindle:'signaling-message',v:1,iss:A,sub:a.entity.sub,aud,sid:s.sid,leg:leg.jkt,to:null,seq:1,iat:seconds(now),type:'cancel',body:{}},leg.privateKey);
 const answer=async body=>{const r=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body}),env,local:false});return [r.status,await r.text(),[...r.headers].filter(([k])=>!['date'].includes(k)).sort().join('|')];};
 const unknownSub=`${B}/identity/0a0a0a0a-0002-4000-8000-0000000000aa`,notIdentity=`${B}/people/${b.entity.sub}`,badUuid=`${B}/identity/not-a-uuid`;
 const results=[];for(const aud of [unknownSub,notIdentity,badUuid])results.push(await answer(buildBatch({messages:[await msg(aud)]})));
 // An entity that is gone (deleted, suspended or moved) is the same lookup.
 await W.provider(B).add(9);const gone=W.provider(B).entity(2);gone.gone=true;results.push(await answer(buildBatch({messages:[await msg(identityURI(gone.principal))]})));
 // SIGNALING_FOREIGN_ENABLED off site-wide is the same answer before the body is read.
 env.SIGNALING_FOREIGN_ENABLED='false';results.push(await answer(accepted));env.SIGNALING_FOREIGN_ENABLED='true';
 for(const r of results)assert.deepEqual(r,results[0]);assert.equal(results[0][0],404);assert.equal(results[0][1],'{"error":"not_found"}');
 // A valid batch for a known entity: 202 with an empty body, whatever steps 2–8 later decide.
 const ok=await answer(accepted);assert.equal(ok[0],202);assert.equal(ok[1],'');
 // RTCw-L3 / §9.2 per-entity enablement: any of the addressed entity's own signaling flags off (an account-scoped
 // rule), while on site-wide, answers exactly as a valid batch does (202, queued dark), so they are never observable.
 const offOwner=b.entity.sub;
 for(const flag of ['SIGNALING_FOREIGN_ENABLED','SIGNALING_ENABLED','SESSION_KINDS_ENABLED']){
  env.flags={for:ctx=>({version:1,evaluate:name=>({value:!(name===flag&&ctx?.subject?.owner===offOwner),reason:'rule'}),envState:()=>({state:'managed'}),global:()=>true})};
  assert.deepEqual(await answer(accepted),ok,flag);
 }
 const dark=(await rows(b.entity,'sig/inq/')).map(([,r])=>r);assert.ok(dark.some(r=>r.dark===true&&r.batch===undefined),'a dark batch keeps no payload');
 // Wargame review R1: a step-1-invalid batch (a stale iat) for that flag-off entity answers the same 400 as for a
 // flag-on one: step 1 runs before anything per-account.
 const stale=buildBatch({messages:[await signMessage({bindle:'signaling-message',v:1,iss:A,sub:a.entity.sub,aud:identityURI(b.principal),sid:s.sid,leg:leg.jkt,to:null,seq:1,iat:seconds(now)-86400,type:'cancel',body:{}},leg.privateKey)]});
 const offStale=await answer(stale);delete env.flags;const onStale=await answer(stale);
 assert.deepEqual(offStale,onStale);assert.equal(onStale[0],400);assert.equal(onStale[1],'{"error":"signaling_batch_invalid"}');
});

test('offers over the network (§21.2): an inbound offer-basis invite is admitted within its uses and routed to the minter',async()=>{
 const W=await signalingWorld({entities:3});const b=W.provider(B).device(1),b2=W.provider(B).device(1);await b.register();await b2.register();
 const as=[1,2,3].map(n=>W.provider(A).device(n));for(const d of as)await d.register();
 const open=await b.offer(CHAT,{uses:2});
 const sessions=[];for(const d of as){const s=await d.open(b.principal,CHAT,{basis:open});await d.invite(s);sessions.push(s);}
 // Each holder's first copy schedules a key refresh (one queued entry per offer lane); the re-sends (after 3 s and 12 s
 // more) then verify.
 await W.pump();for(let i=0;i<10;i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 await b.listen();await b2.listen();
 const got=sessions.filter(s=>b.invites().some(e=>e.sid===s.sid));
 assert.equal(got.length,2,'exactly `uses` invites admitted');
 assert.ok(got.every(s=>b.invites().find(e=>e.sid===s.sid).projection.offer_match===true),'offer_match on the minting endpoint');
 assert.deepEqual(b2.invites(),[],'never another endpoint while the minter is eligible (§5.4 case 3)');
 const [o]=(await W.provider(B).run(1,'signaling.offers')).offers;assert.deepEqual([o.uses,o.spent,o.reserved,o.principal],[2,0,2,null],'two uses reserved');
 assert.equal((await rows(b.entity,'sig/in/')).length,2,'the excess invite created no record');
 // An accept spends one reserved use; a decline releases the other, after which another holder can use it.
 const first=got[0],sb=await b.claim(first.sid);await b.accept(sb);
 const second=got[1];await b.claim(second.sid,'decline');
 const [o2]=(await W.provider(B).run(1,'signaling.offers')).offers;assert.deepEqual([o2.spent,o2.reserved],[1,0]);
 const late=as.find(d=>!got.some(s=>s.sid===[...d.sessions.keys()][0]));const s3=await late.open(b.principal,CHAT,{basis:open});await late.invite(s3);await W.pump();
 for(let i=0;i<10&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s3.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===s3.sid),'the released use admitted a new dial-back');
 // The minting entity itself can never use its own open offer.
 const self=W.provider(B).device(1,{clientId:'https://other.example/client'});await self.register([CHAT]);
 assert.ok(await fault(self.open(b.principal,CHAT,{basis:open})),'an own-entity open takes no basis');
});

test('offers over the network (§21.2): a bound offer presented by the wrong principal admits nothing and reserves nothing',async()=>{
 const W=await signalingWorld({entities:2});const b=W.provider(B).device(1),a1=W.provider(A).device(1),a2=W.provider(A).device(2);for(const d of [b,a1,a2])await d.register();
 const forA2=await b.offer(CHAT,{principals:[a2.principal]});
 const wrong=await a1.open(b.principal,CHAT,{basis:forA2});await a1.invite(wrong);await W.pump();
 for(let i=0;i<8;i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(posts(W,B).filter(p=>p.from===A).every(p=>p.status===202),'the uniform 202');
 await b.listen();assert.deepEqual(b.invites(),[],'nothing admitted');assert.equal((await rows(b.entity,'sig/in/')).length,0,'no record');
 const [o]=(await W.provider(B).run(1,'signaling.offers')).offers;assert.deepEqual([o.spent,o.reserved],[0,0],'nothing reserved or spent');
 // The right principal can still use it.
 const right=await a2.open(b.principal,CHAT,{basis:forA2});await a2.invite(right);await W.pump();
 for(let i=0;i<6&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===right.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.ok(b.invites().some(e=>e.sid===right.sid));assert.deepEqual((await W.provider(B).run(1,'signaling.offers')).offers.map(o=>[o.spent,o.reserved]),[[1,0]],'spent at admission');
 // A second dial-back by the same principal on the spent offer admits nothing.
 const again=await a2.open(b.principal,CHAT,{basis:forA2});await a2.invite(again);await W.pump();for(let i=0;i<6;i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 await b.listen();assert.ok(!b.invites().some(e=>e.sid===again.sid));
});

test('Web Push doorbell: one content-free push per delivered invite per endpoint, high urgency, TTL within answer_by; never for an unadmitted invite; gone subscriptions are removed',async()=>{
 const p256dh=Buffer.from([4,...Array(64).fill(7)]).toString('base64url'),auth=Buffer.from(Array(16).fill(9)).toString('base64url');
 const push={endpoint:'https://fcm.googleapis.com/fcm/send/abc123',keys:{p256dh,auth}};
 const W=await signalingWorld();const {a,b,s}=await offerCall(W,{push});
 // Re-sent copies of the invite never ring again.
 for(let i=0;i<3;i++){W.clock.advance(3000);await W.tickAll();await W.pump();}
 assert.equal(W.pushes.length,1);const [ring]=W.pushes;
 assert.deepEqual(ring.payload,{t:'signal',endpoint:b.endpoint});assert.deepEqual(Object.keys(ring.payload).sort(),['endpoint','t']);
 assert.deepEqual(ring.subscription,push);assert.equal(ring.options.urgency,'high');
 const invite=b.invites().find(e=>e.sid===s.sid),answerBy=payloadOf(invite.invite).body.answer_by;assert.ok(ring.options.ttl>0&&ring.options.ttl<=60,'TTL no longer than the remaining answer window');
 const text=JSON.stringify(ring.payload);for(const secret of [s.sid,a.entity.sub,A,CHAT,'webrtc'])assert.ok(!text.includes(secret),secret);
 assert.ok(answerBy);
 // A blocked initiator: the invite is not admitted (silently), so no push.
 await W.provider(B).run(1,'signaling.block',{principal:a.principal});
 const s2=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s2);await W.pump();
 for(let i=0;i<4;i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 await b.listen();assert.ok(!b.invites().some(e=>e.sid===s2.sid));assert.equal(W.pushes.length,1,'no doorbell without a delivery');
 await W.provider(B).run(1,'signaling.unblock',{principal:a.principal});
 // The push service reports the subscription gone: it is removed, and later delivered invites send nothing.
 W.provider(B).pushGone=true;const s3=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s3);await W.pump();
 for(let i=0;i<4&&!(await b.listen()).events.some(e=>e.type==='invite'&&e.sid===s3.sid);i++){W.clock.advance(2100);await W.tickAll();await W.pump();}
 assert.equal(W.pushes.length,2);const [[,ep]]=(await rows(b.entity,'sig/ep/'));assert.equal(ep.push,null);
});

// ---- seeded chaos over the network (§21.1 engine-level and chaos coverage) ----------------------------------------
import {forEachSeed} from './helpers/chaos.mjs';
import {BOUNDS} from '../packages/app/domains/signaling.mjs';
const STEPS=Number(process.env.SIGNALING_CHAOS_STEPS??150),SEEDS=Number(process.env.SIGNALING_FED_CHAOS_SEEDS??6);
async function invariants(W,devices,wins){
 for(const p of W.providers.values())for(const e of p.entities.values()){
  const rows=new Map(await e.store.list({prefix:'sig/'})),list=prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);
  const ins=list('sig/in/');
  assert.ok(list('sig/out/').filter(r=>r.state!=='ended').length<=BOUNDS.initiatorOpen,'initiator open bound');
  assert.ok(ins.filter(r=>r.state==='pending').length<=BOUNDS.recipientPending+BOUNDS.reserveSelf+BOUNDS.reserveCross,'recipient pending bound');
  assert.ok(ins.filter(r=>r.state==='connected').length<=BOUNDS.recipientConnected,'recipient connected bound');
  assert.ok(list('sig/outbox/').length<=BOUNDS.outbox&&list('sig/inq/').length<=BOUNDS.inbox,'outbox and inbound bounds');
  const om=rows.get('sig/outbox-seq'),im=rows.get('sig/inq-meta');if(om)assert.equal(om.count,list('sig/outbox/').length);if(im)assert.equal(im.count,list('sig/inq/').length);
  for(const r of ins){if(r.claim)assert.ok(r.delivered.includes(r.claim.endpoint)||r.state==='ended','claimant was notified');assert.ok(!r.mine||r.claim,'a recipient leg only after a claim');}
  for(const o of list('sig/offer/'))assert.ok(o.spent+o.reserved<=o.uses,'spent plus reserved never exceed uses');
  for(const [key,row] of rows)if(key.startsWith('sig/epq/')&&row.type==='message'){const m=payloadOf(row.message),ep=key.split('/')[2];if(!['sdp','candidates'].includes(m.type))continue;
   const out=rows.get('sig/out/'+row.sid),inn=ins.find(r=>r.sid===row.sid&&r.claim?.endpoint===ep);assert.ok(out?.mine?.endpoint===ep&&out.theirs||inn&&inn.claim.outcome==='accept','address material only to a session leg');}
  for(const [key,row] of rows)if(key.startsWith('sig/epq/')&&row.type==='invite')assert.ok(!JSON.stringify(row).includes('"offers"'),'no batch offers member in an event');
  assert.ok(e.roster.roster.size<=512&&e.roster.queue.size<=64,'roster and refresh queue bounds');
 }
 for(const [sid,set] of wins)assert.ok(set.size<=1,`at most one successful claim for ${sid}`);
 // Only allowlisted issuers are dialed; POSTs only to their manifest endpoints; step-1-valid batches get 202.
 for(const r of W.requests){const u=new URL(r.url);assert.ok([A,B].includes(u.origin),r.url);if(r.method==='POST')assert.equal(u.pathname,'/bindle/signaling');}
 // A 400 only for a batch held in flight past the §7.3 receipt window (a stale iat), never otherwise.
 for(const x of W.posts){if(x.status!==400){assert.ok([202,429,503].includes(x.status),`route answered ${x.status}`);continue;}
  const stale=JSON.parse(x.body).messages.some(m=>{const iat=payloadOf(m).iat,now=Math.floor(x.at/1000);return iat<now-120||iat>now+30;});assert.ok(stale,'a 400 is only a stale delivery');}
}
test('seeded chaos over the network: drops, duplicates, reorders, partitions, outages, rotations and clock skew keep the invariants',async()=>{
 const stats={claims:0,accepted:0,delivered:0};
 await forEachSeed(SEEDS,async random=>{
  const W=await signalingWorld({seed:random.seed,entities:2});const devices=[],wins=new Map(),calls=[];
  for(const o of [A,B])for(const n of [1,2]){const d=W.provider(o).device(n);await d.register([CHAT,SYNC]);devices.push(d);}
  const tolerate=async fn=>{try{return await fn();}catch(e){if(e?.code==='ERR_ASSERTION')throw e;return null;}};
  for(let step=0;step<STEPS;step++){
   const op=random.pick(['call','call','listen','listen','listen','claim','claim','signal','signal','end','cancel','revoke','deliver','deliver','pump','pump','advance','hold','drop','partition','down','rotate','skew']);
   // The recipient's app hands the initiator a bound offer (out of band), which the initiator's app dials back.
   if(op==='call'){const d=random.pick(devices),to=random.pick(devices.filter(x=>x!==d&&x.entity!==d.entity));
    await tolerate(async()=>{const offer=random.chance(0.2)?await to.offer(CHAT,{uses:3}):await to.offer(CHAT,{principals:[d.principal]});const s=await d.open(to.principal,CHAT,{basis:offer});calls.push({d,s,to,offer});await d.invite(s);});}
   if(op==='listen')await tolerate(()=>random.pick(devices).listen());
   if(op==='claim'){const d=random.pick(devices),open=d.invites().filter(e=>!d.sessions.has(e.sid));if(open.length){const e=random.pick(open);
    await tolerate(async()=>{const c=await d.claim(e.sid,random.chance(0.15)?'decline':'accept');if(c.result&&d.sessions.get(e.sid)){const set=wins.get(e.sid)??new Set();set.add(d.endpoint);wins.set(e.sid,set);}if(random.chance(0.85))await d.accept(c);});}}
   if(op==='signal'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.candidates(random.pick(held)));}
   if(op==='end'){const d=random.pick(devices),held=[...d.sessions.values()].filter(s=>s.peerLeg);if(held.length)await tolerate(()=>d.end(random.pick(held)));}
   if(op==='cancel'&&calls.length){const {d,s}=random.pick(calls);await tolerate(()=>d.cancel(s));}
   if(op==='revoke'&&calls.length){const {to,offer}=random.pick(calls);await tolerate(()=>to.run('signaling.revoke-offer',{...to.auth(),offers:[offer]}));}
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
   for(const [key,r] of await e.store.list({prefix:'sig/'}))if(key.startsWith('sig/out/')||key.startsWith('sig/in/'))assert.equal(r.state,'ended',`${key} is terminal`);
   assert.equal((await e.store.list({prefix:'sig/outbox/'})).size,0,'the outbox drains or expires');assert.equal((await e.store.list({prefix:'sig/inq/'})).size,0,'the inbound queue drains');
   assert.equal((await e.store.list({prefix:'sig/offer/'})).size,0,'offer records go at expiry');
  }
  await invariants(W,devices,wins);
  stats.claims+=wins.size;stats.accepted+=W.posts.filter(x=>x.status===202).length;stats.delivered+=devices.reduce((n,d)=>n+d.events.filter(e=>e.type==='message').length,0);
 });
 // The schedule really exercised cross-provider sessions (not only refusals).
 assert.ok(stats.claims>0&&stats.accepted>0&&stats.delivered>0,JSON.stringify(stats));
});

// ---- contract route, journal policy and lifecycle triggers -------------------------------------------------------
import {signalingResourceMethod} from '../packages/runtime/account/signaling.mjs';
import {FederationController,federationMetadata} from '../packages/federation/runtime.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {configuredArtefacts,reviewedSchemaFetcher} from '../packages/runtime/artefact-pins.mjs';
import {FederationService} from '../packages/federation/service.mjs';
import {SIGNALING_FRAGMENT,SIGNALING_FRAGMENT_DOCUMENT,SIGNALING_CONTRACT,SIGNALING_EXTENSION} from '../packages/signaling/extension.mjs';

test('contract route: the app actor comes only from the verified dispatch context, with the token grant ids; listen never waits inside the gate; nothing else rides the context',async()=>{
 const owner='0a0a0a0a-0009-4000-8000-000000000001',origin='https://home.example',calls=[],checks=[];
 const records=new Map(),c={metadata:{get:async k=>records.get(k)},config:{APP_ORIGIN:origin,FEDERATION_IDENTITY_CHECK:async(o,epoch)=>o===owner&&epoch==='e1'},apps:{check:async(...args)=>{checks.push(args);}},
  signalingDispatch:async(o,x)=>{calls.push(['dispatch',o,x]);return {ok:true};},signalingListen:async(o,x)=>{calls.push(['listen',o,x]);return {cursor:0,events:[],gap:false};}};
 const ctx=(over={})=>({authority:'bindle',contract:SIGNALING_CONTRACT,subject:`${origin}/entities/${owner}`,resource:`${origin}/entities/${owner}/signaling`,resourceGeneration:owner,connection:{id:'conn',generation:2},epoch:'e1',clientId:'https://app.example/client',clientOrigin:'https://app.example',grants:['g1','g2'],grant:{fragment:SIGNALING_FRAGMENT,digest:'d',readSince:'g1'},method:'register',args:{kinds:[CHAT]},...over});
 assert.deepEqual(await signalingResourceMethod(c,owner,ctx()),{ok:true});
 assert.deepEqual(calls[0],['dispatch',owner,{operation:'signaling.register',actor:{kind:'app',owner,clientId:'https://app.example/client',origin:'https://app.example',grants:['g1','g2'],epoch:'e1',clientSession:null,memberContext:false},input:{kinds:[CHAT]}}]);
 assert.deepEqual(checks[0],[owner,'conn',2,'https://app.example/client'],'the app connection is checked live');
 await signalingResourceMethod(c,owner,ctx({method:'open',jkt:'k'.repeat(43),args:{}}));assert.equal(calls[1][2].actor.jkt,'k'.repeat(43),'a DPoP-bound token binds the endpoint key');
 await signalingResourceMethod(c,owner,ctx({method:'listen',args:{endpoint:'ep',wait:25}}));assert.equal(calls[2][0],'listen');assert.equal(calls[2][2].input.wait,0,'no long poll while holding the account gate');
 await signalingResourceMethod(c,owner,ctx({method:'offer',args:{}}));assert.equal(calls[3][2].operation,'signaling.offer');
 await signalingResourceMethod(c,owner,ctx({method:'revoke_offer',args:{}}));assert.equal(calls[4][2].operation,'signaling.revoke-offer');
 for(const [over,code] of [[{grants:[]},'forbidden'],[{grants:undefined},'forbidden'],[{resource:`${origin}/entities/${owner}/links`},'forbidden'],[{resource:`${origin}/entities/${owner}/rtc`},'forbidden'],[{resourceGeneration:'other'},'forbidden'],[{authority:'mcp'},'forbidden'],[{subject:`${origin}/entities/other`},'forbidden'],[{connection:undefined},'forbidden'],[{method:'ingest'},'unsupported_method'],[{method:'lifecycle'},'unsupported_method'],[{method:'mint_ticket'},'unsupported_method'],[{method:'mint_link'},'unsupported_method'],[{epoch:'old'},'unauthorized'],[{clientOrigin:'not a url',clientId:'also not'},'forbidden'],[{grant:undefined},'forbidden'],[{grant:{fragment:'https://other.example/fragment'}},'forbidden'],[{contract:'https://spec.bindle.example/contracts/rtc-signaling/v1'},'forbidden']])
  assert.equal((await fault(signalingResourceMethod(c,owner,ctx(over)))).code,code,JSON.stringify(over));
 assert.equal(calls.length,5,'nothing was dispatched for a refused context');
 // Nothing in the context or the arguments carries a kind approval to the actor: the service reads the session handler
 // approval from the owner's own intents memory (AMD-SG-I1).
 await signalingResourceMethod(c,owner,ctx({bound:{[SIGNALING_FRAGMENT]:{values:{kinds:[CHAT]},versions:{}}},args:{kinds:[CHAT]}}));
 assert.deepEqual(Object.keys(calls[5][2].actor).sort(),['clientId','clientSession','epoch','grants','kind','memberContext','origin','owner'],'no approval or bound member on the actor');
 // §4.3 (review M-4): a member-context token's dispatch context carries `member`, and its endpoints are marked so a
 // designated service entity's member apps never become service-class.
 await signalingResourceMethod(c,owner,ctx({member:true}));assert.equal(calls[6][2].actor.memberContext,true);
 await signalingResourceMethod(c,owner,ctx({member:'yes'}));assert.equal(calls[7][2].actor.memberContext,false,'only the boolean marker counts');
});

test('federation journal: signaling reads are never journaled and signaling write results (offer tokens) are not retained',async()=>{
 const db=new SqliteMetadata(':memory:');let executed=0;
 const self={metadata:federationMetadata(db),clock:()=>Date.now(),dispatcher:{durableJournal:true,readOnly:x=>x.contract===SIGNALING_CONTRACT&&['listen','endpoints'].includes(x.method),retainResult:x=>x.contract!==SIGNALING_CONTRACT,execute:async()=>{executed++;return {offers:[{principal:null,offer:'secret-offer-token-AAAAAAAAAAAAAA'}],expires_at:1};}}};
 const ctx=method=>({subject:'https://home.example/entities/x',clientId:'c',tx:'0b9c1b44-8a5e-4a43-9a3b-0c0c0c0c0c0c',resource:'r',contract:SIGNALING_CONTRACT,method,args:{}});
 await FederationController.prototype.dispatch.call(self,ctx('listen'),crypto);
 assert.equal((await db.list({prefix:'federation/journal/'})).size,0,'listen is a read');
 const first=await FederationController.prototype.dispatch.call(self,ctx('offer'),crypto);assert.ok(first.offers);
 const journal=[...(await db.list({prefix:'federation/journal/'})).values()];assert.equal(journal.length,1);assert.ok(!JSON.stringify(journal).includes('secret-offer-token'),'the offer token is not kept (§5.7)');
 const again=await FederationController.prototype.dispatch.call(self,ctx('offer'),crypto);assert.equal(executed,2);assert.equal(again.__federationError?.code??again.error?.code??Object.values(again)[0]?.code,'indeterminate');
 db.close();
});

test('lifecycle trigger: revoking the last grant on the signaling fragment tells grantChanged (inactive), which the runtime maps to signalingAppRevoked',async t=>{
 const issuer='https://provider.example',subject=issuer+'/entities/alice',authority={session:'owner'},client='https://a.example/client';
 const db=new SqliteMetadata(':memory:'),config={ARTEFACT_VERSIONS_ENABLED:'true',SIGNALING_ENABLED:'true',SESSION_KINDS_ENABLED:'true',FEDERATION_SCHEMAS:{[SIGNALING_FRAGMENT]:structuredClone(SIGNALING_FRAGMENT_DOCUMENT)}};
 const artefacts=configuredArtefacts({config,store:db});config.ARTEFACTS=artefacts;t.after(async()=>{await artefacts.engine.dispose();db.close();});
 const service=new FederationService({issuer,store:federationMetadata(db),schemaHosts:['spec.bindle.example'],schemaFetcher:reviewedSchemaFetcher(config),authenticateOwner:async()=>({subject,epoch:'epoch'}),clients:[{id:client,origin:'https://a.example',name:'a.example',redirectUris:['https://a.example/callback']}]});
 const seen=[];service.grantChanged=async x=>{seen.push(structuredClone(x));};
 const begin=async()=>(await service.beginAuthorization({clientId:client,redirectUri:'https://a.example/callback',challenge:'A'.repeat(43),challengeMethod:'S256',state:'s',requests:[{fragment:SIGNALING_FRAGMENT,required:true,purpose:'Connect your devices',fields:['signaling']}]})).requestId;
 const id=await begin();await service.configure(authority,{fragment:SIGNALING_FRAGMENT,values:{}});const r=(await service.inspect(id,authority)).requests[0];
 assert.equal(Object.hasOwn(r,'bound'),false,'no bound options in the consent view');
 await service.approve(authority,{requestId:id,approved:[{fragment:SIGNALING_FRAGMENT,fields:['signaling'],resources:{signaling:[]},methods:{},revision:r.revision}]});
 const grant=(await service.store.transaction(tx=>tx.list('federation/grant/'))).map(x=>x.value).find(g=>g.active);
 assert.equal(Object.hasOwn(grant,'bound'),false,'grants carry no bound options');
 const before=Date.now();await service.revoke(authority,grant.id);
 const last=seen.findLast(x=>x.fragment===SIGNALING_FRAGMENT);assert.ok(last,'grantChanged ran for the signaling fragment');
 {const {at,...rest}=last;assert.deepEqual(rest,{subject,clientId:client,fragment:SIGNALING_FRAGMENT,active:false});assert.ok(Number.isSafeInteger(at)&&at>=before-1000);}
 // A hook that fails never fails the revocation.
 service.grantChanged=async()=>{throw new Error('down');};assert.deepEqual(await service.revoke(authority,grant.id),{revoked:true});
});

test('key roster: cache-only reads, bounded refresh queue per issuer and in total, negative caching, manifest floor first, held profiles, issuer-level warming',async()=>{
 const calls=[];let now=0,fail=false,feature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:300,profiles:['data','webrtc']};
 const d={allowed:iss=>[B,C].includes(iss)||/^https:\/\/d\d\.example$/.test(iss),peek:()=>null,resolve:async()=>null,peekFeatures:()=>({[SIGNALING_EXTENSION]:feature}),
  features:async(iss,priority)=>{calls.push(['manifest',iss,priority]);if(fail)throw Object.assign(new Error('x'),{code:'temporarily_unavailable'});return {[SIGNALING_EXTENSION]:feature};},
  refresh:async x=>{calls.push(['refresh',x.issuer,x.subject,x.kid??null,x.priority]);}};
 const r=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});
 const p=(iss,n)=>({iss,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});
 assert.deepEqual(await r.certification(p(B,1)),[]);assert.equal(await r.identity(p(B,1)),null);assert.deepEqual(calls,[],'reads never dial');
 assert.deepEqual(r.profiles(p(B,1)),['data','webrtc'],'the held declaration\'s profiles');assert.equal(r.unsupported(p(B,1)),false);
 // A document key the pin does not hold as active (the directory's resolve refuses it) is never used.
 const jwk=(await keyPair()).jwk;d.peek=()=>({keys:[{kid:'k1',use:'cert',state:'active',jwk},{kid:'s1',use:'sig',state:'active',jwk}]});
 assert.deepEqual(await r.certification(p(B,1)),[]);
 d.resolve=async x=>x.kid==='k1'?{kid:'k1',purpose:'certification',verifiable:true,publicJwk:jwk,identity:`${B}/identity/x`}:null;
 assert.deepEqual((await r.certification(p(B,1))).map(k=>k.kid),['k1']);assert.equal(await r.identity(p(B,1)),`${B}/identity/x`);
 d.peek=()=>null;d.resolve=async()=>null;
 // §5.7 issuer-level warming at `offer`: the manifest only, never a principal's document or keys.
 calls.length=0;d.peekFeatures=()=>null;r.warmIssuer(C);await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,[['manifest',C,'background']]);
 r.warmIssuer(A);await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1,'never its own issuer');calls.length=0;
 // A held manifest without a valid declaration (here: profiles not ascending, or an unknown profile) is unsupported.
 for(const bad of [{...feature,profiles:['webrtc','data']},{...feature,profiles:['webrtc','video']},{...feature,profiles:[]},{endpoint:feature.endpoint,max_leg_certificate_seconds:300}]){d.peekFeatures=()=>({[SIGNALING_EXTENSION]:bad});assert.equal(r.unsupported(p(B,1)),true,JSON.stringify(bad));assert.equal(r.profiles(p(B,1)),null);}
 d.peekFeatures=()=>({[SIGNALING_EXTENSION]:feature});
 assert.equal(r.refresh(p(A,1)),false,'own issuer');assert.equal(r.refresh(p('https://other.example',1)),false,'not allowlisted');assert.equal(r.refresh({iss:B,sub:'nope'}),false);
 for(let n=0;n<40;n++)r.refresh(p(B,n));assert.equal(r.queue.size,16,'per-issuer bound');
 for(let n=0;n<80;n++)r.refresh(p(C,n));assert.equal(r.queue.size,32);
 for(const host of ['d1','d2','d3','d4'])for(let n=0;n<16;n++)r.refresh(p(`https://${host}.example`,n));assert.equal(r.queue.size,64,'total bound');
 assert.ok(r.queue.size<=64);assert.equal(r.maxLegSeconds(p(B,1)),300,'the declared bound as held');
 const out=await r.run({limit:4});assert.equal(out.fetched,4);assert.ok(calls.every(c=>c[0]!=='refresh'||c[4]==='claimed'),'claims spend the directory\'s claimed class (review F1)');
 // The manifest floor first: without a valid signaling declaration, no identity document is fetched.
 calls.length=0;feature={endpoint:'https://169.254.169.254/x',max_leg_certificate_seconds:300,profiles:['data']};r.queue.clear();r.refresh(p(B,99),'kid-9');await r.run();
 assert.deepEqual(calls.map(c=>c[0]),['manifest']);
 // A failure is negatively cached for a minute; then retried.
 assert.equal(r.refresh(p(B,99)),false,'negative cache');now+=61000;assert.equal(r.refresh(p(B,99)),true);
 feature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:300,profiles:['data']};calls.length=0;await r.run();assert.deepEqual(calls.at(-1),['refresh',B,p(B,99).sub,null,'claimed']);
 // A rotation names the unknown kid; the directory refetches once for it.
 r.queue.clear();calls.length=0;r.refresh(p(B,7),'kid-new');await r.run();assert.deepEqual(calls.at(-1),['refresh',B,p(B,7).sub,'kid-new','claimed']);
 // The roster itself is bounded and expires after 24 h.
 for(let n=0;n<600;n++)r.track(p(B,1000+n));assert.equal(r.roster.size,512);now+=86400001;r.queue.clear();await r.run({limit:0});assert.equal(r.roster.size,0);
 // Gated off (no directory): nothing.
 const off=new SignalingKeyRoster({issuer:A,directory:()=>null});assert.equal(off.refresh(p(B,1)),false);assert.equal(await off.warm(p(B,1)),false);assert.equal(off.profiles(p(B,1)),null);
});

test('endpoint size bound: an oversized body is refused without reading it whole',async()=>{
 const W=await signalingWorld();let pulled=0;const chunk=new Uint8Array(16384).fill(32);
 const stream=new ReadableStream({pull(c){if(pulled>=1048576){c.close();return;}pulled+=chunk.length;c.enqueue(chunk);}});
 const r=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body:stream,duplex:'half'}),env:W.provider(B).env,local:false});
 assert.equal(r.status,400);assert.ok(pulled<=131072+3*16384,`read ${pulled} bytes`);
 // A declared Content-Length above the bound is refused before any read.
 pulled=0;const s2=new ReadableStream({pull(c){pulled+=chunk.length;c.enqueue(chunk);}});
 const r2=await signalingEndpoint({request:new Request(`${B}/bindle/signaling`,{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE,'Content-Length':'200000'},body:s2,duplex:'half'}),env:W.provider(B).env,local:false});
 assert.equal(r2.status,400);assert.ok(pulled<=2*16384,'not read');
});

test('a peer issuer\'s declared max_leg_certificate_seconds bounds its leg certificates',async()=>{
 const W=await signalingWorld();W.provider(B).manifestFeature={endpoint:`${B}/bindle/signaling`,max_leg_certificate_seconds:300,profiles:['data','webrtc']};
 const {a,b,s}=await offerCall(W);assert.ok(b.invites().some(e=>e.sid===s.sid),'A declares 600 and issues 600: accepted');
 // B declares 300 but certifies 600 s legs: A refuses B's answer.
 const sb=await b.claim(s.sid);assert.equal(payloadOf(sb.certificate).exp-payloadOf(sb.certificate).iat,600);await b.accept(sb);await W.pump();await a.listen();
 assert.ok(!a.events.some(e=>e.type==='message'),'a certificate longer than its issuer declares never verifies');
});

void OPS;void perform;void CALLBACK;void offerDigest;

test('minting an offer publishes the certification key a foreign initiator pins before open (lazy keys)',async()=>{
 // Certification keys are minted on first use. An entity that has only registered and minted an offer has signed
 // nothing yet; without a published key the foreign initiator's `open` fails temporarily_unavailable (found by the
 // multi-provider simulation: a Meet host on one provider could not be called from another).
 const W=await signalingWorld(),b=W.provider(B).device(1),a=W.provider(A).device(1),e=b.entity;
 e.certKeys=[];e.signing=null;
 e.service.signer=async()=>{if(!e.signing)await e.addCertKey();const k=e.certKeys.find(c=>c.kid===e.signing);return {kid:k.kid,privateKey:k.privateKey};};
 await b.register();await a.register();
 assert.equal(e.certKeys.length,0,'registering an endpoint mints no certification key');
 const offer=await b.offer(CHAT,{principals:[a.principal]});
 assert.equal(e.certKeys.length,1,'minting the offer published a certification key');
 const s=await a.open(b.principal,CHAT,{basis:offer});
 assert.ok(s.result?.peer_keys?.length>0,'the foreign initiator found the recipient key and opened: '+JSON.stringify(s.error??s.result));
});
