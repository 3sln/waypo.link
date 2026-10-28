// Signaling security review follow-ups (retargeted from rtc-review-followups.test.mjs for signaling rev 3.2; DEVLOG
// 2026-10-27 "RTC-e foreign transport, endpoint and key roster", "Review follow-ups", carried by signaling Appendix B.6
// and C.4). The three review proofs of concept (roster starvation, refresh amplification with the kill switch, Node
// egress budget reset) are kept as regressions that assert the fixed behaviour, beside the other findings (F5 inbound
// shedding keys, F6 invite re-send bound, F7 allowlist gating and parallel doorbells), the verification follow-ups
// (V1 to V5) and two owner follow-ups retargeted to rev 3.2: (a) the reported initiator origin is the projection's
// `reported_by`, and (b) removing an app's approval ends a pending invite that reached only that app, silently. The
// link lane of review F1 is now the offer lane (§9.2 step 3, AMD-RV2). Engine level over
// tests/helpers/signaling-federation-fixture.mjs; local behaviour only (no real HTTPS, DNS, Cloudflare, push service or
// relay). Hosts are reserved .example names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {signalingWorld,A,B,CHAT,SYNC,CLIENT,identityURI,keyPair,fault,perform} from './helpers/signaling-federation-fixture.mjs';
import {signLegCertificate} from '../packages/signaling/certificates.mjs';
import {buildBatch,BATCH_MEDIA_TYPE} from '../packages/signaling/messages.mjs';
import {SignalingKeyRoster,ROSTER_LIMITS} from '../packages/signaling/federation.mjs';
import {SIGNALING_EXTENSION} from '../packages/signaling/extension.mjs';
import {SignalingLifecycle,SignalingService,SignalingInbox,INVITE_RESEND_DELAYS} from '../packages/signaling/service.mjs';
import {K} from '../packages/signaling/admission.mjs';
import {stages as relationStages} from '../packages/runtime/routes/relations.mjs';
import {signalingEndpoint} from '../packages/runtime/routes/signaling.mjs';
import {admitSourceNetwork,WORKER_NETWORK_CEILING} from '../packages/runtime/routes/shared.mjs';
import {nodeDirectoryEgress,createNodeDirectoryBudget} from '../packages/federation/node-directory-fetch.mjs';
import {IdentityDirectory,DIRECTORY_LIMITS} from '../packages/federation/directory.mjs';
import {directoryHostLimiter,foreignDirectory} from '../packages/runtime/account/foreign-directory.mjs';
import {EXPORT_CLAIMED_PREFIXES,EXPORT_EXCLUDED_PREFIXES,exportInventory} from '../packages/runtime/export-contributors.mjs';

const sid=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const posts=(W,to)=>W.posts.filter(p=>!to||p.to===to);
const client={client_id:CLIENT,origin:'https://app.example',feature:null};
/** A leg certificate claiming a random subject on B (an allowlisted issuer), signed by a key nobody holds. */
const claimCert=async(W,target,{evil,leg})=>(await signLegCertificate({issuer:B,sub:crypto.randomUUID(),identity:`${B}/identity/${crypto.randomUUID()}`,aud:identityURI(target.principal),sid:sid(),role:'initiator',kind:W.ref(CHAT),profile:'webrtc',client,delegate:leg.jwk,aep:0,now:W.clock.now(),lifetime:600,maxSeconds:600},{kid:'x',privateKey:evil.privateKey})).certificate;
const post=(W,to,body,ip)=>signalingEndpoint({request:new Request(to+'/bindle/signaling',{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE,'CF-Connecting-IP':ip},body}),env:W.provider(to).env,local:false});

/** Step-1-valid batches to `victim` whose certificates claim random subjects on B: nobody can verify them, so each
 * claimed sender asks for a key refresh. `net` picks the source /48. */
async function flood(W,victim,{evil,leg,n,net,claims=4}){
 for(let k=0;k<n;k++){const certs=[];for(let c=0;c<claims;c++)certs.push(await claimCert(W,victim,{evil,leg}));
  await post(W,A,buildBatch({certificates:certs}),`2001:db8:${net.toString(16)}::${k.toString(16)}`);}
}
/** Pumps until `device` hears an invite for `s` (bounded). */
async function until(W,device,s,steps=8){for(let i=0;i<steps&&!(await device.listen()).events.some(e=>e.type==='invite'&&e.sid===s.sid);i++){W.clock.advance(3100);await W.tickAll();await W.pump();}return device.invites().some(e=>e.sid===s.sid);}

// ---- F1: unauthenticated roster starvation (review PoC 4) --------------------------------------------------------------
for(const attack of [false,true])test(`F1 roster starvation: an honest offer invite and the victim's own open succeed ${attack?'under a claim flood from rotating networks':'(baseline)'}`,async()=>{
 const W=await signalingWorld({entities:3});const evil=await keyPair(),leg=await keyPair();
 const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();const victim=W.entity(A,1);
 if(attack){await flood(W,victim,{evil,leg,n:50,net:1});await W.pump();}
 // Honest B1 dials A1 back on A1's offer (B1 is new to A1, so its keys are not held either).
 const offer=await a.offer(CHAT,{principals:[b.principal]});const s=await b.open(a.principal,CHAT,{basis:offer});await b.invite(s);
 let got=false,steps=0;
 for(;steps<24&&!got;steps++){// up to 120 s in 5 s steps, ~600 claim batches a minute from a new /48 each step
  if(attack)await flood(W,victim,{evil,leg,n:50,net:2+steps});
  await W.pump();W.clock.advance(5000);await W.tickAll();await W.pump();
  got=(await a.listen()).events.some(e=>e.type==='invite'&&e.sid===s.sid);
 }
 assert.equal(got,true,'the honest invite reached A1 (offer lane: its offer_digest names a live offer here)');
 assert.ok(steps<=4,`within ${steps*5} s`);
 // A1 opens to a foreign recipient it has never seen (B2): the initiator-initiated warm has its own interactive budget.
 const b2=W.provider(B).device(2);await b2.register();const tk=await b2.offer(CHAT,{principals:[a.principal]});
 if(attack){await flood(W,victim,{evil,leg,n:50,net:99});await W.pump();}
 assert.equal(await fault(a.open(b2.principal,CHAT,{basis:tk})),null,'open to a new foreign recipient succeeds');
 if(attack){
  // The flood spent only the claimed class: at most a third of the per-site budget per minute (plus the window edge).
  const gets=W.requests.filter(r=>r.from===A&&r.method==='GET'&&r.url.includes('/directory?sub='));
  const minutes=Math.ceil((steps*5+10)/60)+1;assert.ok(gets.length<=minutes*(10+10+30),`${gets.length} lookups from A`);
  // Per source network: at most perSource plain claims queued per network.
  const counts=new Map();for(const q of victim.roster.queue.values())if(q.lane==='claimed')counts.set(q.source,(counts.get(q.source)??0)+1);
  assert.ok([...counts.values()].every(n=>n<=ROSTER_LIMITS.perSource),JSON.stringify([...counts.values()]));
  assert.ok([...counts.keys()].every(k=>typeof k==='string'&&/^[0-9a-f]{64}$/.test(k)),'the source is a pseudonymous network key, never an address');
 }
});

test('F1 roster lanes: live peers first, then offer-backed claims, then plain claims capped per source network; classes spend their own budgets',async()=>{
 const calls=[];let now=0;const limited=new Set();
 const d={allowed:()=>true,peek:()=>null,resolve:async()=>null,peekFeatures:()=>null,
  features:async(iss,priority)=>{if(limited.has(priority))throw Object.assign(new Error('x'),{code:'rate_limited'});return {[SIGNALING_EXTENSION]:{endpoint:`${iss}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data','webrtc']}};},
  refresh:async x=>{calls.push([x.subject.slice(-3),x.priority]);}};
 const r=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});
 const p=n=>({iss:B,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});
 // Plain claims from one network: perSource queued, sourceRate schedules a minute.
 let ok=0;for(let n=0;n<20;n++)if(r.refresh(p(n),undefined,{source:'net1'}))ok++;assert.equal(ok,ROSTER_LIMITS.perSource,'perSource queued');
 await r.run({limit:2});
 ok=0;for(let n=20;n<40;n++)if(r.refresh(p(n),undefined,{source:'net1'}))ok++;assert.equal(ok,2,'refilled up to perSource');
 await r.run({limit:64});assert.equal(r.queue.size,0);
 ok=0;for(let n=40;n<60;n++)if(r.refresh(p(n),undefined,{source:'net1'}))ok++;assert.equal(ok,ROSTER_LIMITS.sourceRate-ROSTER_LIMITS.perSource-2,'the network\'s schedules a minute, with an empty queue');
 await r.run({limit:64});ok=0;for(let n=60;n<70;n++)if(r.refresh(p(n),undefined,{source:'net1'}))ok++;assert.equal(ok,0,'sourceRate reached');
 assert.equal(r.refresh(p(70),undefined,{source:'net2'}),true,'another network has its own allowance');
 now+=61000;await r.run({limit:64});calls.length=0;
 ok=0;for(let n=80;n<100;n++)if(r.refresh(p(n),undefined,{source:'net1'}))ok++;assert.equal(ok,ROSTER_LIMITS.perSource,'a new minute');
 // An offer lane: laneRate schedules a minute even when its entry keeps leaving the queue.
 const lr=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});ok=0;
 for(let n=0;n<10;n++){if(lr.refresh(p(2000+n),undefined,{lane:'offer:rate'}))ok++;await lr.run({limit:8});}
 assert.equal(ok,ROSTER_LIMITS.laneRate);
 // Live and linked lanes share one bound.
 const pr=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});ok=0;
 const pi=n=>({...p(3000+n),iss:`https://p${n%8}.example`});// several issuers: one issuer is capped at priorityPerIssuer
 for(let n=0;n<ROSTER_LIMITS.priority+8;n++)if(pr.refresh(pi(n),undefined,{lane:'offer:'+n}))ok++;assert.equal(ok,ROSTER_LIMITS.priority);
 pr.live([p(4000)]);assert.equal(pr.refresh(p(4000)),false,'a live peer waits for room too');assert.equal(pr.refresh(p(4001),undefined,{source:'net1'}),true,'plain claims have their own bound');
 calls.length=0;
 // An offer-backed claim and a live peer jump the queue; each spends the linked class.
 assert.equal(r.refresh(p(900),undefined,{source:'net1',lane:'offer:abc'}),true,'the per-source cap never applies to an offer-backed claim');
 assert.equal(r.refresh(p(901),undefined,{lane:'offer:abc'}),false,'one queued entry per offer');
 r.live([p(950)]);assert.equal(r.refresh(p(950),'kid-x',{source:'net9'}),true);
 await r.run({limit:3});
 assert.deepEqual(calls.slice(0,3),[['950','linked'],['900','linked'],[p(80).sub.slice(-3),'claimed']]);
 // A plain claim already queued moves up when a live session or a live offer names it.
 calls.length=0;r.queue.clear();r.refresh(p(300),undefined,{source:'net2'});r.refresh(p(301),undefined,{source:'net3'});r.refresh(p(301),undefined,{lane:'offer:def'});
 await r.run({limit:1});assert.deepEqual(calls,[['301','linked']]);
 // A refused class stops for this pass, keeps its entries and does not count against the pass.
 calls.length=0;r.queue.clear();limited.add('claimed');for(let n=400;n<404;n++)r.refresh(p(n),undefined,{source:'net4'});
 r.track(p(500));const out=await r.run({limit:2});assert.equal(r.queue.size,4,'claimed entries kept');
 assert.deepEqual(calls.filter(c=>c[1]==='background').map(c=>c[0]),['500'],'refresh-ahead still ran');assert.equal(out.fetched,1);
 // warm spends interactive.
 calls.length=0;limited.clear();await r.warm(p(600));assert.deepEqual(calls,[['600','interactive']]);
});

/** The lane the recipient roster gives B1's invite to A1 on `offer` (B1 is new to A1). */
async function laneFor(W,a,b,offer){
 const s=await b.open(a.principal,CHAT,{basis:offer});await b.invite(s);await b.entity.service.drain(b.entity.sub);
 await perform(a.entity.engine,new SignalingInbox({actor:{kind:'system',owner:a.entity.sub},input:{limit:16}}));const q=[...a.entity.roster.queue.values()].find(x=>x.sub===b.entity.sub);a.entity.roster.queue.clear();return q?.lane;
}
test('F1 offer lane (§9.2 step 3, AMD-RV2): an invite whose offer_digest names a live offer here is linked; an unknown or revoked offer is claimed',async()=>{
 const W=await signalingWorld({entities:3});const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();
 assert.equal(await laneFor(W,a,b,await a.offer(CHAT,{principals:[b.principal]})),'linked','an offer bound to this sender');
 assert.equal(await laneFor(W,a,b,await a.offer(CHAT,{uses:2})),'linked','an open offer');
 assert.equal(await laneFor(W,a,b,token()),'claimed','an unknown digest gives no priority');
 const revoked=await a.offer(CHAT,{principals:[b.principal]});await a.run('signaling.revoke-offer',{...a.auth(),offers:[revoked]});
 assert.equal(await laneFor(W,a,b,revoked),'claimed','a revoked offer gives no priority');
});

test('F1 offer lane: a bound offer for another principal gives no priority (as a principal-bound ticket gave none)',async()=>{
 const W=await signalingWorld({entities:3});const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();
 assert.equal(await laneFor(W,a,b,await a.offer(CHAT,{principals:[W.entity(B,2).principal]})),'claimed');
});

test('F5 relation endpoints: per-network shedding through the shared helper',async()=>{
 const org='0a0a0a0a-0000-4000-8000-0000000000aa',store=new Map();
 const env={APP_ORIGIN:A,ABUSE_HASH_KEY:'k',ABUSE:{consume:async(key,{limit})=>{const n=store.get(key)??0;if(n>=limit)return false;store.set(key,n+1);return true;}},
  IDENTITY_REPOSITORY:{get:async()=>({status:'active',kind:'organization'})},ACCOUNTS:{get:()=>({invoke:async()=>({})})}};
 const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),jws=`${b64({alg:'ES256'})}.${b64({aud:`${A}/identity/${org}`})}.sig`;
 const send=ip=>relationStages.public({request:new Request(A+'/relations/events',{method:'POST',headers:{'Content-Type':'application/secevent+jwt','CF-Connecting-IP':ip},body:jws}),env,path:'/relations/events',local:false});
 const statuses=[];for(let i=0;i<602;i++)statuses.push((await send('198.51.100.'+(i%200))).status);
 assert.equal(statuses.filter(x=>x===202).length,600);assert.deepEqual(statuses.slice(-2),[429,429]);
 assert.equal((await send('203.0.113.1')).status,202,'another network');
 assert.ok([...store.keys()].every(k=>/^relations\/events\/(?:n\/)?[0-9a-f]{64}$/.test(k)));
});

test('F1 directory classes: interactive, background, claimed and linked have disjoint per-site buckets; claims never spend the member bucket',async()=>{
 const spent=[];const windows=new Map();
 const limiter={async consume(name,{limit}){const n=windows.get(name)??0;if(n>=limit)return false;windows.set(name,n+1);spent.push(name);return true;}};
 const fetch=async url=>{const u=new URL(url);if(u.pathname==='/.well-known/bindle/manifest.json')return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});};
 const d=new IdentityDirectory({store:{transaction:async fn=>fn({get:async()=>undefined,set:async()=>{}})},fetch,enabled:true,issuers:[B],limiter,limits:{perSite:{windowMs:60000,limit:9},global:{windowMs:60000,limit:1000}}});
 for(let i=0;i<20;i++)await d.json(`${B}/directory?sub=${i}`,8192,'claimed').catch(()=>{});
 for(let i=0;i<20;i++)await d.json(`${B}/directory?sub=l${i}`,8192,'linked').catch(()=>{});
 const count=prefix=>spent.filter(n=>n.startsWith(prefix)).length;
 assert.equal(count('directory/claimed/'),3);assert.equal(count('directory/linked/'),3);assert.equal(count('directory/site/'),0,'claims never spend the member (background) bucket');
 for(let i=0;i<20;i++)await d.json(`${B}/directory?sub=i${i}`,8192,'interactive').catch(()=>{});
 assert.equal(count('directory/interactive/'),9);assert.equal(count('directory/site/'),0);
 let ok=0;for(let i=0;i<20;i++)await d.json(`${B}/directory?sub=b${i}`,8192,'background').then(()=>ok++,()=>{});assert.equal(ok,9,'background keeps its whole per-site budget');
});

// ---- F4: host-wide directory budget (review PoC 1) ---------------------------------------------------------------------
test('F4 refresh amplification: claims aimed at many writers draw on one host-wide per-site budget, not one per writer',async()=>{
 const N=20,hostClaimed=30;const W=await signalingWorld({entities:N,directoryLimits:{...DIRECTORY_LIMITS,host:{...DIRECTORY_LIMITS.host,claimed:hostClaimed}}});const evil=await keyPair(),leg=await keyPair();
 let accepted=0,windows=0;
 for(let minute=0;minute<2;minute++){
  for(let n=1;n<=N;n++){const target=W.entity(A,n);
   for(let k=0;k<10;k++){
    const certs=[];for(let c=0;c<4;c++)certs.push(await claimCert(W,target,{evil,leg}));
    const r=await post(W,A,buildBatch({certificates:certs}),'2001:db8:'+minute+'::'+n.toString(16)+':'+k);
    if(r.status===202)accepted++;
   }}
  for(let i=0;i<10;i++){await W.pump(2);W.clock.advance(5000);}
  windows++;
 }
 const gets=W.requests.filter(r=>r.from===A&&r.method==='GET'&&r.url.includes('/directory?sub='));
 assert.equal(accepted,400);
 // Fixed host windows of 60 s over ~100 s of clock: at most three windows' worth, against 580 before the fix.
 assert.ok(gets.length<=(windows+1)*hostClaimed,`${gets.length} lookups from A across ${N} writers`);
 assert.ok([...W.provider(A).abuse.keys()].some(k=>k.startsWith('directory-host-v1/signaling/claimed/')),'the host limiter was used under the signaling feature');
});

test('F4 host limiter: shared by every directory on the host through WORK_AUTHORITY, per class and site; a failing limiter refuses',async()=>{
 const keys=[];const authority={consume:async(key,limits)=>{keys.push([key,limits]);return keys.length<=2;}};
 const host=directoryHostLimiter({WORK_AUTHORITY:authority});assert.equal(directoryHostLimiter({}),null);
 const fetch=async()=>new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
 const make=()=>new IdentityDirectory({store:{transaction:async fn=>fn({get:async()=>undefined,set:async()=>{}})},fetch,enabled:true,issuers:[B],hostLimiter:host});
 const [d1,d2]=[make(),make()];
 assert.ok(await d1.json(`${B}/directory?sub=1`,8192,'claimed'));assert.ok(await d2.json(`${B}/directory?sub=2`,8192,'claimed'));
 assert.equal((await fault(d1.json(`${B}/directory?sub=3`,8192,'claimed'))).code,'rate_limited','the third request on the host is refused');
 assert.deepEqual(keys.map(([k])=>k),Array(3).fill('directory-host-v1/other/claimed/beta.example'),'no tenant: the class key only');assert.deepEqual(keys[0][1],{windowMs:60000,limit:DIRECTORY_LIMITS.host.claimed});
 const broken=new IdentityDirectory({store:{transaction:async fn=>fn({get:async()=>undefined,set:async()=>{}})},fetch,enabled:true,issuers:[B],hostLimiter:{consume:async()=>{throw new Error('down');}}});
 assert.equal((await fault(broken.json(`${B}/directory?sub=4`,8192,'background'))).code,'rate_limited','fails closed');
 assert.equal(new IdentityDirectory({store:{transaction:async fn=>fn({})},fetch,enabled:true,issuers:[B],feature:'rtc'}).feature,'other','the retired rtc feature key is gone');
});

test('F4 wiring: the organization directory spends the same host-wide budget',()=>{
 const authority={consume:async()=>true},store={transaction:async fn=>fn({get:async()=>undefined,put:async()=>{}})};
 const d=foreignDirectory({DIRECTORY_EGRESS:()=>async()=>new Response(null,{status:404}),DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',ORG_FOREIGN_MEMBERS_ENABLED:'true',ORG_FOREIGN_ISSUERS:JSON.stringify([B]),WORK_AUTHORITY:authority},{store,owner:'0a0a0a0a-0000-4000-8000-000000000001'});
 assert.ok(d);assert.equal(typeof d.hostLimiter?.consume,'function');assert.equal(d.feature,'org','its host keys name the organization feature (verification follow-ups)');
});

test('F1 live peers: a connected session keeps its foreign peer first in the roster past the tracking window (tick hint); refresh-ahead rotates',async()=>{
 const W=await signalingWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();
 assert.ok(await until(W,b,s));
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();
 const k=[...b.entity.roster.lives.keys()].find(x=>x.includes(a.entity.sub));assert.ok(k,'verified peer marked live');
 for(let i=0;i<12;i++){W.clock.advance(60000);await W.tickAll();}// 12 minutes, no messages
 assert.equal(b.entity.roster.isLive(k),true,'still live through the session tick');
 // Refresh-ahead visits every roster entry over successive passes, not the same first few.
 const seen=new Set();const d={allowed:()=>true,peek:()=>null,resolve:async()=>null,peekFeatures:()=>null,features:async iss=>({[SIGNALING_EXTENSION]:{endpoint:`${iss}/bindle/signaling`,max_leg_certificate_seconds:600,profiles:['data','webrtc']}}),refresh:async x=>{seen.add(x.subject);}};
 const r=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>0});for(let n=0;n<20;n++)r.track({iss:B,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});r.lives.clear();
 for(let i=0;i<5;i++)await r.run({limit:4});assert.equal(seen.size,20);
});

// ---- F2: the kill switch never suppresses control statements (review PoC 2) ----------------------------------------
test('F2 kill switch: with SIGNALING_FOREIGN_ENABLED off, an app revocation still delivers the revoked control to the peer provider',async()=>{
 const W=await signalingWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();
 assert.ok(await until(W,b,s));
 const sb=await b.claim(s.sid);await b.accept(sb);await W.pump();await a.listen();
 // A cold feature cache too: the control path fetches the manifest under the directory budgets.
 a.entity.directory.manifests.clear();
 W.provider(A).flags.SIGNALING_FOREIGN_ENABLED=false;// the kill switch at A
 const before=W.posts.length;
 const out=await perform(a.entity.engine,new SignalingLifecycle({actor:{kind:'system',owner:a.entity.sub},input:{event:'app-revoked',clientId:a.clientId}}));
 for(let i=0;i<5;i++){await W.pump();W.clock.advance(3000);await W.tickAll();}
 const sent=W.posts.slice(before).filter(p=>p.from===A);
 assert.equal(out.ended,1);assert.ok(sent.length>=1&&sent.every(p=>p.status===202),'the control statement reached B');
 await b.listen();assert.equal(b.events.filter(e=>e.type==='state'&&e.sid===s.sid).at(-1)?.state,'ended','B ended the session');
 // New sessions stay off: open to a foreign recipient is refused while the switch is off.
 await a.register();assert.equal((await fault(a.open(b.principal,CHAT,{basis:token()}))).code,'unsupported_peer');
});

// ---- F3: Node egress budget state is process-wide (review PoC 3) -----------------------------------------------------
test('F3 Node directory egress: alternating allowlists share one budget state; a tenant never gets a fresh budget',async()=>{
 const lookup=async()=>[{address:'93.184.216.34',family:4}];
 const request=(opts,cb)=>{const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=404;res.headers={};res.destroy=()=>{};cb(res);setImmediate(()=>res.emit('end'));};req.destroy=()=>{};return req;};
 const egress=nodeDirectoryEgress({lookup,request});const SIG=['https://beta.example'],ORG=['https://org.example'];
 const budget={tenant:'t1',priority:'background',allowance:30};
 const fetchA=egress(SIG);let ok=0;for(let i=0;i<100;i++){try{await fetchA('https://beta.example/directory?sub=x'+i,{budget});ok++;}catch(e){if(e.code!=='rate_limited')throw e;}}
 egress(ORG);// another controller builds its organization directory
 const fetchB=egress(SIG);let ok2=0;for(let i=0;i<100;i++){try{await fetchB('https://beta.example/directory?sub=y'+i,{budget});ok2++;}catch(e){if(e.code!=='rate_limited')throw e;}}
 assert.equal(ok,30);assert.equal(ok2,0,'no fresh budget after the allowlist alternated');assert.equal(fetchA,fetchB,'fetchers are cached per allowlist');
 // Even a fetcher for the other allowlist spends the same tenant budget.
 const fetchC=egress(ORG);await assert.rejects(fetchC('https://org.example/directory?sub=z',{budget}),e=>e.code==='rate_limited');
 // The allowlist still applies per fetcher.
 await assert.rejects(fetchB('https://org.example/directory?sub=z',{budget:{tenant:'t2',priority:'background'}}),/outside the registered/);
});

test('F1/F3 Node egress classes: a claim flood at one tenant never spends its background allowance, and claims are capped host-wide',async()=>{
 const budget=createNodeDirectoryBudget({maxRequestsPerMinute:600});let now=0;
 const admit=(tenant,priority,allowance=30)=>{const g=budget.admit({tenant,priority,allowance},'https://beta.example',now);if(g)budget.release(g);return Boolean(g);};
 let claimed=0;for(let i=0;i<100;i++)if(admit('t1','claimed'))claimed++;assert.equal(claimed,10,'a third of the tenant allowance');
 let background=0;for(let i=0;i<100;i++)if(admit('t1','background'))background++;assert.equal(background,30,'the whole background allowance is left');
 now+=60000;let total=0;for(let t=0;t<200;t++)for(let i=0;i<10;i++)if(admit('t'+t,'claimed'))total++;
 assert.equal(total,75,'claims host-wide: a quarter of the background group window');
 let rest=0;for(let t=0;t<20;t++)for(let i=0;i<30;i++)if(admit('u'+t,'background'))rest++;assert.ok(rest>=150,`background still admitted ${rest}`);
});

// ---- F5: inbound shedding keys -----------------------------------------------------------------------------------------
test('F5 inbound shedding: CF-Worker refines the network key under a network ceiling; the Node adapter honours only its configured trusted header',async()=>{
 const store=new Map(),env={ABUSE_HASH_KEY:'k',ABUSE:{consume:async(key,{limit})=>{const n=store.get(key)??0;if(n>=limit)return false;store.set(key,n+1);return true;}}};
 const req=headers=>new Request('https://alpha.example/bindle/signaling',{method:'POST',headers});
 // Two Worker-hosted providers behind the same Cloudflare network get separate budgets.
 let a=0,b=0;for(let i=0;i<5;i++){if((await admitSourceNetwork(env,req({'CF-Connecting-IP':'2a06:98c0::1','CF-Worker':'one.example'}),false,'s',3)).ok)a++;if((await admitSourceNetwork(env,req({'CF-Connecting-IP':'2a06:98c0::2','CF-Worker':'two.example'}),false,'s',3)).ok)b++;}
 assert.deepEqual([a,b],[3,3]);
 const one=await admitSourceNetwork(env,req({'CF-Connecting-IP':'2a06:98c0::1','CF-Worker':'one.example'}),false,'s',3),plain=await admitSourceNetwork(env,req({'CF-Connecting-IP':'2a06:98c0::1'}),false,'s',3);
 assert.equal(one.source,plain.source,'a zone never buys its own roster source (verification follow-ups)');assert.ok(/^[0-9a-f]{64}$/.test(plain.source));
 // Forged zones buy at most the ceiling for the network they really come from.
 let forged=0;for(let i=0;i<200;i++)if((await admitSourceNetwork(env,req({'CF-Connecting-IP':'2001:db8:7::1','CF-Worker':`z${i}.example`}),false,'s',3)).ok)forged++;
 assert.equal(forged,3*WORKER_NETWORK_CEILING);
 // Off loopback without an abuse store: closed.
 assert.deepEqual(await admitSourceNetwork({},req({}),false,'s',3),{ok:false,source:null});assert.deepEqual(await admitSourceNetwork({},req({}),true,'s',3),{ok:true,source:null});
 // Node: the client address comes from TRUSTED_CLIENT_IP_HEADER only when configured; client copies are dropped.
 const {nodeRequestHeaders,createNodeServer}=await import('../apps/node/server.mjs');
 const raw={'cf-connecting-ip':'198.51.100.1','x-forwarded-for':'198.51.100.2','x-real-ip':'198.51.100.3','cf-worker':'forged.example','x-client-ip':'203.0.113.9',accept:'*/*'};
 const plainNode=nodeRequestHeaders(raw,'192.0.2.7');
 assert.equal(plainNode.get('CF-Connecting-IP'),'192.0.2.7','unset: the socket address');assert.equal(plainNode.get('CF-Worker'),null,'a client CF-Worker never passes');assert.equal(plainNode.get('X-Forwarded-For'),null);
 const proxied=nodeRequestHeaders(raw,'192.0.2.7',{clientIpHeader:'x-client-ip'});
 assert.equal(proxied.get('CF-Connecting-IP'),'203.0.113.9','configured: the trusted header');assert.equal(proxied.get('x-client-ip'),null,'the raw header is not passed on');
 for(const value of ['203.0.113.9, 198.51.100.4','not-an-ip',undefined])assert.equal(nodeRequestHeaders({...raw,'x-client-ip':value},'192.0.2.7',{clientIpHeader:'x-client-ip'}).get('CF-Connecting-IP'),'unknown',`appended, invalid or missing (${value}): unknown`);
 await assert.rejects(createNodeServer({config:{APP_ORIGIN:'http://127.0.0.1:1',LOCAL_DEVELOPMENT:'true',TRUSTED_CLIENT_IP_HEADER:'bad header'}}),/TRUSTED_CLIENT_IP_HEADER/);
 // The route keys its shedding under the renamed limiter scope.
 const W=await signalingWorld();await post(W,A,'{}','198.51.100.77');
 assert.ok([...W.provider(A).abuse.keys()].some(k=>k.startsWith('signaling/inbound/')),'scope signaling/inbound');assert.ok(![...W.provider(A).abuse.keys()].some(k=>k.startsWith('rtc/')),'no rtc scope');
});

// ---- F6: invite re-send bound ------------------------------------------------------------------------------------------
test('F6 invite re-send: only after the first 202, at most twice, and never after a permanent refusal',async()=>{
 const W=await signalingWorld();const b=W.provider(B).device(1),a=W.provider(A).device(1);await b.register();await a.register();
 const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();
 for(let i=0;i<30;i++){W.clock.advance(4000);await W.tickAll();await W.pump();}// 120 s: the whole answer window
 const invites=posts(W,B).filter(p=>p.from===A);
 assert.equal(invites.length,1+INVITE_RESEND_DELAYS.length,`${invites.length} POSTs for one unanswered invite`);
 assert.ok(invites.every(p=>p.status===202));assert.ok(invites.every(p=>JSON.parse(p.body).offers?.length===1),'every copy carries its offer token');
 const rec=await a.entity.store.get(`sig/out/${s.sid}`);assert.equal(rec.inviteRetry,undefined);assert.equal(rec.inviteCompact,undefined,'the stored invite copy is dropped once re-sending ends');assert.equal(rec.offerToken,undefined,'and the token with it (§5.7)');
 // Before any 202 (a partition), the outbox retries the one row; nothing is re-sent on top of it.
 const W2=await signalingWorld();const b2=W2.provider(B).device(1),a2=W2.provider(A).device(1);await b2.register();await a2.register();
 const s2=await a2.open(b2.principal,CHAT,{basis:await b2.offer(CHAT,{principals:[a2.principal]})});W2.net.cut.add(A+'|'+B);await a2.invite(s2);
 for(let i=0;i<10;i++){W2.clock.advance(2000);await W2.tickAll();await W2.pump();}
 assert.equal((await a2.entity.store.list({prefix:'sig/outbox/'})).size,1,'one outbox row, no re-send copies');
 // A permanent refusal (404) for that session ends re-sending.
 const W3=await signalingWorld();const b3=W3.provider(B).device(1),a3=W3.provider(A).device(1);await b3.register();await a3.register();
 const s3=await a3.open(b3.principal,CHAT,{basis:await b3.offer(CHAT,{principals:[a3.principal]})});W3.provider(B).env.SIGNALING_FOREIGN_ENABLED='false';await a3.invite(s3);await W3.pump();
 for(let i=0;i<10;i++){W3.clock.advance(4000);await W3.tickAll();await W3.pump();}
 assert.equal(posts(W3,B).filter(p=>p.from===A).length,1,'refused once (404), never re-sent');const rec3=await a3.entity.store.get(`sig/out/${s3.sid}`);assert.equal(rec3.inviteRetry,undefined);assert.equal(rec3.offerToken,undefined);
});

// ---- F7: allowlist gating and parallel doorbells -----------------------------------------------------------------------
test('F7 empty SIGNALING_FOREIGN_ISSUERS: /bindle/signaling answers the uniform 404, byte-identical to an unknown target',async()=>{
 const W=await signalingWorld();const env={...W.provider(A).env};const body=buildBatch({controls:['x.y.z']});
 const call=async e=>{const r=await signalingEndpoint({request:new Request(A+'/bindle/signaling',{method:'POST',headers:{'Content-Type':BATCH_MEDIA_TYPE},body}),env:e,local:true});return [r.status,await r.text()];};
 const off=await call({...env,SIGNALING_FOREIGN_ISSUERS:'[]'}),flagOff=await call({...env,SIGNALING_FOREIGN_ENABLED:'false'}),invalid=await call({...env,SIGNALING_FOREIGN_ISSUERS:'["http://x.example"]'}),unset=await call({...env,SIGNALING_FOREIGN_ISSUERS:undefined});
 assert.equal(off[0],404);assert.deepEqual(off,flagOff);assert.deepEqual(invalid,flagOff);assert.deepEqual(unset,flagOff);
 assert.deepEqual(await call({...env,RTC_FOREIGN_ISSUERS:env.SIGNALING_FOREIGN_ISSUERS,SIGNALING_FOREIGN_ISSUERS:undefined}),flagOff,'the retired RTC_FOREIGN_ISSUERS name is not read');
 assert.equal((await call(env))[0],400,'with an allowlist the endpoint is live (this batch fails step 1)');
});

test('F7 doorbells go out in parallel with a bounded concurrency',async()=>{
 let active=0,peak=0;const sent=[];
 const svc=Object.create(SignalingService.prototype);Object.assign(svc,{clock:{now:()=>0},store:{transaction:async fn=>fn({get:async()=>null,put:async()=>{}})},
  pushTransport:{send:async(sub)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;sent.push(sub.endpoint);}}});
 const doorbells=Array.from({length:10},(_,i)=>({endpoint:'ep_'+i,subscription:{endpoint:'https://push.example/'+i},answerBy:60000}));
 const t0=Date.now();await svc.ring(doorbells);const took=Date.now()-t0;
 assert.equal(sent.length,10);assert.ok(peak>1&&peak<=4,`peak ${peak}`);assert.ok(took<10*20,`${took} ms for ten 20 ms pushes`);
});

// ---- Owner follow-ups, retargeted ----------------------------------------------------------------------------------------
test('(a) initiator origin: a foreign initiator\'s origin is labelled with the reporting provider (`reported_by`); a same-host initiator\'s is not',async()=>{
 const W=await signalingWorld({entities:2});const b=W.provider(B).device(1),a=W.provider(A).device(1),b2=W.provider(B).device(2,{clientId:'https://other.example/client'});
 for(const d of [a,b,b2])await d.register();
 const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();assert.ok(await until(W,b,s));
 const foreign=b.invites().find(e=>e.sid===s.sid).projection;assert.deepEqual([foreign.origin,foreign.client_id,foreign.reported_by],['https://app.example',CLIENT,A]);
 const s2=await b2.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[b2.principal]})});await b2.invite(s2);await W.pump();await b.listen();
 const local=b.invites().find(e=>e.sid===s2.sid).projection;assert.deepEqual([local.origin,local.client_id,local.reported_by],['https://other.example','https://other.example/client',null],'certified by this host: unlabelled');
});

test('(b) removing an app\'s approval, or revoking the app, ends a pending invite that reached only that app, silently towards the initiator',async()=>{
 const W=await signalingWorld();const a=W.provider(A).device(1);await a.register();
 const b=W.provider(B).device(1,{kinds:[CHAT,SYNC]});await b.register();
 const ring=async()=>{const s=await a.open(b.principal,CHAT,{basis:await b.offer(CHAT,{principals:[a.principal]})});await a.invite(s);await W.pump();assert.ok(await until(W,b,s));return s;};
 const live=async sidv=>(await W.provider(B).run(1,'signaling.sessions')).sessions.find(x=>x.sid===sidv);
 // The approval for CHAT removed (intents.session-unapprove, narrowing): the pending invite ends; nothing goes to A.
 const s1=await ring();assert.equal((await live(s1.sid))?.state,'pending');
 const before=W.posts.length;const out=await W.provider(B).run(1,'intents.session-unapprove',{clientId:b.clientId,kind:CHAT});
 assert.deepEqual(out,{removed:true,ended:1});assert.equal(await live(s1.sid),undefined,'no longer pending for the owner');
 for(let i=0;i<3;i++){await W.pump();W.clock.advance(2000);await W.tickAll();}
 assert.equal(W.posts.slice(before).filter(p=>p.from===B).length,0,'nothing goes to the initiator\'s provider (no control, §8.5)');
 assert.deepEqual((await W.provider(B).run(1,'signaling.endpoint-list')).endpoints.map(e=>e.kinds),[[SYNC]],'the endpoint keeps only its still-approved kind');
 // A revoked app (grant revoked or connection ended: lifecycle app-revoked) ends its pending invites the same way and
 // clears every approval of the app.
 await b.register([CHAT,SYNC]);const s2=await ring();const before2=W.posts.length;
 const revoked=await perform(b.entity.engine,new SignalingLifecycle({actor:{kind:'system',owner:b.entity.sub},input:{event:'app-revoked',clientId:b.clientId}}));
 assert.equal(revoked.ended,1);assert.equal(await live(s2.sid),undefined);
 for(let i=0;i<3;i++){await W.pump();W.clock.advance(2000);await W.tickAll();}
 assert.equal(W.posts.slice(before2).filter(p=>p.from===B).length,0);
 assert.deepEqual((await W.provider(B).run(1,'intents.session-approvals')).approvals,[],'approvals cleared');
 assert.equal((await fault(b.run('signaling.register',{kinds:[CHAT]}))).code,'approval_required');
 // The initiator's session ends at answer_by, as for an invite nobody answered.
 W.clock.advance(130000);await W.tickAll();await W.pump();
 for(const sidv of [s1.sid,s2.sid])assert.equal((await a.entity.store.get(`sig/out/${sidv}`)).endReason,'timeout');
});

// ---- Verification follow-ups (DEVLOG RTC-e "Verification follow-ups"): the verification review's five proofs of
// concept, each kept as a regression that asserts the attack now fails. --------------------------------------------------
test('V1 host budget per feature and tenant: a one-network flood at many signaling writers never refuses an organization directory on the same host',async()=>{
 const N=20;const W=await signalingWorld({entities:N+1});const evil=await keyPair(),leg=await keyPair();
 for(let round=0;round<3;round++){for(let n=1;n<=N;n++){const t=W.entity(A,n);
  for(let k=0;k<2;k++){const certs=[];for(let c=0;c<4;c++)certs.push(await claimCert(W,t,{evil,leg}));
   const r=await post(W,A,buildBatch({certificates:certs}),'2001:db8:1::5');
   assert.equal(r.status,202);}}
 for(let i=0;i<3;i++){await W.pump(2);W.clock.advance(1000);}}
 const abuse=W.provider(A).abuse;
 assert.equal(abuse.get('directory-host-v1/claimed/beta.example'),undefined,'no feature-less key any more');
 assert.ok(abuse.get('directory-host-v1/signaling/claimed/beta.example')?.count>0,'the flood spent the signaling claimed class');
 const share=Math.ceil(DIRECTORY_LIMITS.host.claimed/DIRECTORY_LIMITS.host.share);
 const tenants=[...abuse].filter(([k])=>k.startsWith('directory-host-v1/signaling/claimed/beta.example/t/'));
 assert.ok(tenants.length>1&&tenants.every(([,v])=>v.count<=share),'each targeted writer spends at most its tenant share');
 // An organization directory of an untargeted tenant on the same host keeps its own budget.
 const d=new IdentityDirectory({store:{transaction:async fn=>fn({get:async()=>undefined,set:async()=>{}})},fetch:W.fetchFrom(A),enabled:true,issuers:[B],clock:()=>W.clock.now(),hostLimiter:W.provider(A).env.ABUSE,tenant:'victim',feature:'org'});
 const f=await fault(d.json(`${B}/directory?sub=honest`,8192,'claimed'));
 assert.notEqual(f?.code,'rate_limited','the untargeted organization lookup is not refused');
});

test('V1 tenant shares: one tenant spends at most 1/16 of a class host-wide; interactive has only the tenant share',async()=>{
 const counts=new Map();const host={consume:async(key,{limit})=>{const n=counts.get(key)??0;if(n>=limit)return false;counts.set(key,n+1);return true;}};
 const fetch=async()=>new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
 const make=(tenant,feature='signaling')=>new IdentityDirectory({store:{transaction:async fn=>fn({get:async()=>undefined,set:async()=>{}})},fetch,enabled:true,issuers:[B],hostLimiter:host,tenant,feature,limits:{perSite:{windowMs:60000,limit:1000},global:{windowMs:60000,limit:100000}}});
 const ok=async(d,cls,n)=>{let k=0;for(let i=0;i<n;i++)await d.json(`${B}/directory?sub=${cls}${i}`,8192,cls).then(()=>k++,()=>{});return k;};
 const t1=make('t1'),t2=make('t2');
 assert.equal(await ok(t1,'claimed',50),Math.ceil(DIRECTORY_LIMITS.host.claimed/16),'claimed: 1/16 of the class per tenant');
 assert.ok(await ok(t2,'claimed',5)===5,'another tenant is unaffected');
 assert.equal(await ok(t1,'interactive',100),DIRECTORY_LIMITS.host.tenant.interactive,'interactive: the tenant share');
 assert.equal(await ok(t2,'interactive',10),10);
 assert.equal([...counts.keys()].some(k=>/\/interactive\/beta\.example$/.test(k)),false,'no host-wide interactive class key');
 // A tenant whose share is spent spends nothing of the class (share first).
 const cls=counts.get('directory-host-v1/signaling/claimed/beta.example');await ok(t1,'claimed',10);assert.equal(counts.get('directory-host-v1/signaling/claimed/beta.example'),cls);
 // Features are disjoint: the same tenant's organization directory has its own budget.
 assert.equal(await ok(make('t1','org'),'claimed',3),3);
 // A background share grows with the directory's roster-scaled per-site budget, up to a quarter of the class.
 const big=make('t3');assert.equal(big.tenantShare('background',DIRECTORY_LIMITS.host,DIRECTORY_LIMITS.host.background),DIRECTORY_LIMITS.host.background/4);
 const small=make('t4');small.limits={...small.limits,perSite:{windowMs:60000,limit:30}};assert.equal(small.tenantShare('background',DIRECTORY_LIMITS.host,DIRECTORY_LIMITS.host.background),Math.ceil(DIRECTORY_LIMITS.host.background/16));
 assert.ok([...counts.keys()].every(k=>/^directory-host-v1\/(signaling|org)\/(claimed|interactive)\/beta\.example(\/t\/[0-9a-f]{32})?$/.test(k)),'tenant ids are hashed');
});

test('V2 interactive starvation: attacker accounts opening to unknown foreign recipients cannot make an honest owner\'s open fail; warm is limited per owner',async()=>{
 const N=20;const W=await signalingWorld({entities:N+1});const refused=new Map();
 for(let n=1;n<=N;n++){const dev=W.provider(A).device(n);await dev.register();
  for(let k=0;k<30;k++){const f=await fault(dev.open({iss:B,sub:crypto.randomUUID()},CHAT,{basis:token()}));refused.set(f?.code,(refused.get(f?.code)??0)+1);}}
 assert.ok(refused.get('rate_limited')>=N*(30-20),'each account\'s warms stop at its limit: '+JSON.stringify([...refused]));
 assert.equal(W.provider(A).abuse.get('directory-host-v1/signaling/interactive/beta.example'),undefined,'no host-wide interactive class budget');
 const honest=W.provider(A).device(N+1);await honest.register();const recipient=W.provider(B).device(1);await recipient.register();
 assert.equal(await fault(honest.open(recipient.principal,CHAT,{basis:await recipient.offer(CHAT,{principals:[honest.principal]})})),null,'the honest open succeeds');
 assert.equal(W.entity(A,1).roster.roster.size,0,'failed opens track nobody');
 // A recipient whose keys are held spends no warm.
 const rows=async()=>new Map([...await honest.entity.store.transaction(tx=>tx.list({prefix:K.limitPrefix}))].map(([k,v])=>[k,v.count]));
 const before=await rows();assert.equal(await fault(honest.open(recipient.principal,CHAT,{basis:await recipient.offer(CHAT,{principals:[honest.principal]})})),null);
 const after=await rows();assert.equal([...after].filter(([k,n])=>n!==(before.get(k)??0)).length,1,'only the opens limit moved');
});

test('V3 IPv4-mapped addresses: the trusted proxy header and subnet() unmap them, so IPv4 clients keep separate /24 buckets',async()=>{
 const {nodeRequestHeaders}=await import('../apps/node/server.mjs');const {subnet,subnet64,normalizeClientIp}=await import('../packages/runtime/routes/shared.mjs');
 const h1=nodeRequestHeaders({'x-client-ip':'::ffff:198.51.100.1'},'127.0.0.1',{clientIpHeader:'x-client-ip'});
 const h2=nodeRequestHeaders({'x-client-ip':'::ffff:203.0.113.9'},'127.0.0.1',{clientIpHeader:'x-client-ip'});
 assert.equal(h1.get('CF-Connecting-IP'),'198.51.100.1');assert.notEqual(subnet(h1.get('CF-Connecting-IP')),subnet(h2.get('CF-Connecting-IP')));
 assert.equal(nodeRequestHeaders({},'::ffff:192.0.2.7').get('CF-Connecting-IP'),'192.0.2.7','a dual-stack socket address too');
 assert.equal(nodeRequestHeaders({'x-client-ip':'fe80::1%eth0'},'127.0.0.1',{clientIpHeader:'x-client-ip'}).get('CF-Connecting-IP'),'fe80::1','zone stripped');
 for(const v of ['::ffff:198.51.100.1','::FFFF:c633:6401','0:0:0:0:0:ffff:198.51.100.1'])assert.equal(subnet(v),'198.51.100/24',v);
 assert.notEqual(subnet('::ffff:198.51.100.1'),subnet('::ffff:203.0.113.9'));assert.equal(subnet64('::ffff:c633:6401'),'198.51.100/24');
 assert.equal(normalizeClientIp('2001:db8::1'),'2001:db8::1');assert.equal(subnet('2001:db8:1::5'),'2001:db8:1::/48');
});

test('V4 roster bound: principals of one issuer cannot fill the live/linked bound; an honest offer-backed claim of another issuer gets in',async()=>{
 let now=0;const d={allowed:()=>true,peek:()=>null,resolve:async()=>null,peekFeatures:()=>null,features:async()=>{throw Object.assign(new Error('x'),{code:'rate_limited'});},refresh:async()=>{}};
 const r=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});const p=n=>({iss:B,sub:`0a0a0a0a-0000-4000-8000-${String(n).padStart(12,'0')}`});
 let queued=0;for(let n=0;n<32;n++){r.track(p(n));if(r.refresh(p(n),'kid-unknown'))queued++;}
 assert.equal(queued,ROSTER_LIMITS.priorityPerIssuer,'live entries capped per issuer');
 await r.run({limit:8});
 assert.equal(r.refresh({iss:'https://gamma.example',sub:p(999).sub},undefined,{lane:'offer:honest'}),true);
 // warm does not track (SignalingService tracks once a session record exists).
 const w=new SignalingKeyRoster({issuer:A,directory:()=>d,clock:()=>now});await w.warm(p(5));assert.equal(w.roster.size,0);assert.equal(w.lives.size,0);
});

test('V4 service: a verified invite that is never admitted does not track its sender or mark it live',async()=>{
 const W=await signalingWorld();const a=W.provider(A).device(1),b=W.provider(B).device(1);await a.register();await b.register();
 // A bound offer for another principal admits nothing, so A drops B1's invite after verification. The first copy
 // schedules the key refresh (A holds no keys for B1 yet); a later one verifies.
 const wrong=await a.offer(CHAT,{principals:[W.entity(B,2).principal]});
 for(let i=0;i<2;i++){const s=await b.open(a.principal,CHAT,{basis:wrong});await b.invite(s);await W.pump();W.clock.advance(3100);await W.tickAll();await W.pump();}
 assert.ok((await a.entity.roster.certification(b.principal)).length>0,'A holds B1\'s keys, so a later invite verified');
 assert.equal((await a.listen()).events.some(e=>e.type==='invite'),false,'not admitted');
 const k=[...a.entity.roster.roster.keys(),...a.entity.roster.lives.keys()].filter(x=>x.includes(b.entity.sub));
 assert.deepEqual(k,[],'neither tracked nor live');
 // An admitted invite does track the initiator.
 const s=await b.open(a.principal,CHAT,{basis:await a.offer(CHAT,{principals:[b.principal]})});await b.invite(s);await W.pump();
 assert.ok([...a.entity.roster.lives.keys()].some(x=>x.includes(b.entity.sub)),'the admitted initiator is live');
});

test('V5 CF-Worker zones: forged or rotated zones from one network share its roster source and its 16x ceiling',async()=>{
 const store=new Map(),env={ABUSE_HASH_KEY:'k',ABUSE:{consume:async(key,{limit})=>{const n=store.get(key)??0;if(n>=limit)return false;store.set(key,n+1);return true;}}};
 const req=h=>new Request('https://alpha.example/bindle/signaling',{method:'POST',headers:h});
 const sources=new Set();let ok=0;
 for(let i=0;i<60;i++){const r=await admitSourceNetwork(env,req({'CF-Connecting-IP':'198.51.100.7','CF-Worker':`z${i}.example`}),false,'s',3);if(r.ok){ok++;sources.add(r.source);}}
 for(let i=0;i<10;i++){const r=await admitSourceNetwork(env,req({'CF-Connecting-IP':'198.51.100.7'}),false,'s',3);if(r.ok){ok++;sources.add(r.source);}}
 assert.equal(ok,3*WORKER_NETWORK_CEILING,'the network total is the ceiling');assert.equal(sources.size,1,'one roster source per network');
 // Plain first, then zones: still the ceiling in total.
 store.clear();ok=0;for(let i=0;i<10;i++)if((await admitSourceNetwork(env,req({'CF-Connecting-IP':'198.51.100.7'}),false,'s',3)).ok)ok++;
 for(let i=0;i<60;i++)if((await admitSourceNetwork(env,req({'CF-Connecting-IP':'198.51.100.7','CF-Worker':`z${i}.example`}),false,'s',3)).ok)ok++;
 assert.equal(ok,3*WORKER_NETWORK_CEILING);
});

// ---- §12.6 export: the provider-block gap is closed ----------------------------------------------------------------
test('export inventory (§12.6, Appendix C): provider blocks are exported beside principal blocks; pairings exported; offers and transient state excluded; no rtc family remains',()=>{
 const inv=Object.fromEntries(exportInventory(['sig/policy','sig/block/x','sig/block-iss/https%3A%2F%2Fspam.example','sig/service','sig/pairing/pr_x','sig/offer/d','sig/ep/ep_x','sig/in/x/s','sig/outbox/x/1','sig/pairing-peer/h']).map(r=>[r.prefix,r]));
 assert.equal(inv['sig/block-iss/https%3A%2F%2Fspam.example'].contributor,'signaling','provider blocks are claimed (the rtc/block-iss/ gap is closed)');
 assert.equal(inv['sig/block/x'].contributor,'signaling');assert.equal(inv['sig/policy'].contributor,'signaling');assert.equal(inv['sig/service'].contributor,'signaling');
 assert.equal(inv['sig/pairing/pr_x'].contributor,'signaling-pairings');
 for(const k of ['sig/offer/d','sig/ep/ep_x','sig/in/x/s','sig/outbox/x/1','sig/pairing-peer/h']){assert.equal(inv[k].contributor,undefined,k);assert.equal(typeof inv[k].reason,'string',k);}
 assert.equal(EXPORT_CLAIMED_PREFIXES['sig/block-iss/'],'signaling');
 assert.ok(!Object.keys(EXPORT_CLAIMED_PREFIXES).some(p=>p.startsWith('rtc/')),'no rtc/ family is exported');assert.ok(Object.keys(EXPORT_EXCLUDED_PREFIXES).filter(p=>p.startsWith('rtc/')).every(p=>p==='rtc/'),'leftover rtc/ rows are only excluded wholesale, pending the reset');
 assert.equal(EXPORT_CLAIMED_PREFIXES['intent-memory/'],'intent-choices','session handler approvals export with intent-choices');
});
