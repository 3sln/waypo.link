// ORG-12b at the engine level: the production owner-channels adapter (packages/identity/owner-channels.mjs), the
// person-side hints, the identity sign-in liveness hook (packages/identity/service.mjs `interactive`) and the abort
// tokens, driven through the production engine operations over the break-glass world (tests/helpers/break-glass-world.mjs).
// Loopback fixtures and an offline Polar model: local behaviour only. Acceptance by a fake mailer is not delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bgWorld,rejects,A,B,C,E,DAY,ORG,p} from './helpers/break-glass-world.mjs';
import {ownerChannelsAdapter,orgClaimAbortUrl,OWNER_NOTICE_KINDS} from '../packages/identity/owner-channels.mjs';
import {emailDomainHashes,memoryClaimHints,hintApply,liveHints,BreakGlassService,BREAK_GLASS} from '../packages/orgs/break-glass.mjs';
import {sessionContext,stepUpPasskey,signInPasskey} from './helpers/identity-engine.mjs';
import {fixture,channelWorld,identityFor} from './helpers/break-glass-channels-world.mjs';

const ISS='https://3sln.example',SECRET='owner-channels-test-secret-0001',H=3600000;
const sha=text=>createHash('sha256').update(text).digest('hex');
test('snapshot: emails (current and replaced within 30 days), push, passkeys and known sessions (no password channel since 2026-10-28); ids only, never addresses',async()=>{
 const now=1_800_000_000_000,f=fixture(now),r=f.records.get(A);
 r.previousEmails=[{email:'old@acme.example',verifiedAt:now-400*DAY,replacedAt:now-10*DAY},{email:'ancient@gone.example',verifiedAt:now-500*DAY,replacedAt:now-40*DAY}];
 r.sessions.push({id:'later',createdAt:now+1,expiresAt:now+H},{id:'expired',createdAt:now-30*H,expiresAt:now-6*H},{id:'closure',createdAt:now-H,expiresAt:now+H,scope:'closure-export'});
 const snap=await f.adapter.snapshot(p(A),{org:ORG,at:now});
 assert.equal(snap.status,'active');assert.equal(snap.lastInteractiveAt,now-90*DAY);
 assert.deepEqual(snap.channels.map(c=>c.kind),['email','email','push','credential','session'],'out-of-band channels first (the engine keeps 16)');
 assert.ok(snap.channels.every(c=>/^(email|push|passkey|session):[0-9a-f]{32}$/.test(c.id)));
 const text=JSON.stringify(snap);for(const secret of ['@','example','pushrow','cred-','sess-'])assert.ok(!text.includes(secret),'no address, domain or raw id crosses the port: '+secret);
 assert.deepEqual(snap.channels[0].domainHashes,await emailDomainHashes('home-alice.example'),'hashed with the engine’s own rule');
 assert.ok(snap.channels[1].domainHashes.includes(sha('acme.example')));
 assert.equal(new Set(snap.channels.map(c=>c.id)).size,5);
 {const legacy=fixture(now).records.get(A);legacy.passwordHash='fake';legacy.passwordSetAt=now-100*DAY;const g=ownerChannelsAdapter({origin:ISS,secret:SECRET,identity:async()=>legacy});assert.equal((await g.snapshot(p(A),{org:ORG,at:now})).channels.filter(c=>c.kind==='credential').length,1,'a stored legacy password hash is never a known channel');}
 assert.equal((await f.adapter.snapshot(p(A),{org:ORG,at:now})).channels[0].id,snap.channels[0].id,'stable ids');
 const other=ownerChannelsAdapter({origin:ISS,secret:'a-different-deployment-secret',identity:async sub=>f.records.get(sub)});
 assert.notEqual((await other.snapshot(p(A),{org:ORG,at:now})).channels[0].id,snap.channels[0].id,'ids are keyed by the deployment secret');
 assert.deepEqual(await f.adapter.snapshot({iss:'https://other.example',sub:A},{org:ORG,at:now}),{status:'unknown',lastInteractiveAt:null,channels:[]},'a foreign owner has no channels here');
 assert.equal((await f.adapter.snapshot(p('99999999-9999-4999-8999-999999999999'),{org:ORG,at:now})).status,'deleted');
 assert.equal((await f.adapter.snapshot(p(ORG),{org:ORG,at:now})).status,'unknown','an organization never has owner channels');
 delete r.lastInteractiveAt;assert.equal((await f.adapter.snapshot(p(A),{org:ORG,at:now})).lastInteractiveAt,null,'unknown activity stays unknown (Track S, review L2)');
 const down=ownerChannelsAdapter({origin:ISS,secret:SECRET,identity:async()=>{throw new Error('down');}});
 await assert.rejects(down.snapshot(p(A),{org:ORG,at:now}),e=>e.code==='break_glass_unavailable'&&e.status===503);
 assert.throws(()=>ownerChannelsAdapter({origin:ISS,secret:'short',identity:async()=>null}),TypeError,'a missing deployment secret fails closed');
});

test('domains: suffix hashes after IDNA, for the organization and local principals only',async()=>{
 const now=Date.now(),f=fixture(now);Object.assign(f.records.get(ORG),{verifiedEmail:'ops@MAIL.Acme.Example',emailVerifiedAt:now-DAY});f.records.get(C).verifiedEmail='c@bücher.example';
 const out=await f.adapter.domains({org:ORG,principals:[p(C),{iss:'https://other.example',sub:B}]});
 const all=out.flatMap(x=>x.hashes);assert.ok(out.every(x=>Array.isArray(x.hashes)&&x.hashes.every(h=>/^[0-9a-f]{64}$/.test(h))));
 assert.ok(all.includes(sha('mail.acme.example'))&&all.includes(sha('acme.example')),'every parent suffix, lowercased');
 assert.ok(all.includes(sha('xn--bcher-kva.example')),'IDNA to ASCII before hashing');
 assert.ok(!all.includes(sha('bob-family.example')),'a foreign principal’s local record is never read');
 assert.ok(!JSON.stringify(out).includes('acme'),'no domain crosses the port');
});

test('notify: the recorded email gets the single-use abort link in a fragment; push and the interstitial; failures are not acceptance',async()=>{
 const now=Date.now(),f=fixture(now),snap=await f.adapter.snapshot(p(A),{org:ORG,at:now}),[email,,]=snap.channels,pushChannel=snap.channels.find(c=>c.kind==='push');
 const claim='12345678-1234-4234-8234-123456789abc',token=`bg1.${claim}.${'87654321-4321-4321-8321-cba987654321'}.${'x'.repeat(43)}`;
 assert.deepEqual(await f.adapter.notify(p(A),{org:ORG,claim,event:'start',channel:email.id,kind:'email',abort:token}),{accepted:true});
 assert.deepEqual(f.sent[0],{email:'alice@home-alice.example',event:'claim-started',orgHandle:'acme',abortUrl:`${ISS}/org-claim/abort#org=${ORG}&token=${token}&handle=acme`});
 assert.equal(orgClaimAbortUrl(ISS,ORG,token,'acme'),f.sent[0].abortUrl);assert.equal(orgClaimAbortUrl(ISS,ORG,token,'<b>'),`${ISS}/org-claim/abort#org=${ORG}&token=${token}`,'an unusable handle is left out');
 assert.equal((await f.adapter.notify(p(A),{org:ORG,claim,event:'remind',channel:'email:'+'0'.repeat(32),kind:'email'})).accepted,false,'an unrecorded channel is never mailed');
 assert.equal((await f.adapter.notify(p(A),{org:ORG,claim,event:'start',channel:email.id,kind:'email',abort:'not-a-token'})).accepted,false);
 assert.deepEqual(await f.adapter.notify(p(A),{org:ORG,claim,event:'effect',channel:email.id,kind:'email'}),{accepted:true});assert.equal(f.sent[1].event,'effective');assert.equal(f.sent[1].abortUrl,null);
 // A replaced email recorded at T1 still receives notices while it is retained (§12d.3).
 const r=f.records.get(A);r.previousEmails=[{email:r.verifiedEmail,verifiedAt:r.emailVerifiedAt,replacedAt:now}];r.verifiedEmail='new@new.example';r.emailVerifiedAt=now;
 await f.adapter.notify(p(A),{org:ORG,claim,event:'remind-72h',channel:email.id,kind:'email'});assert.equal(f.sent.at(-1).email,'alice@home-alice.example');assert.equal(f.sent.at(-1).event,'final-reminder');
 assert.deepEqual(await f.adapter.notify(p(A),{org:ORG,claim,event:'proceed',channel:pushChannel.id,kind:'push',abort:token}),{accepted:true});
 assert.deepEqual(f.pushes[0],{sub:A,subscription:'pushrow-alice-0001',notice:{event:'proceed',org:ORG,path:`/org-claim/abort#org=${ORG}&token=${token}&handle=acme`}});
 for(const kind of ['session','credential'])assert.deepEqual(await f.adapter.notify(p(A),{org:ORG,claim,event:'start',channel:'session:x',kind}),{accepted:true},'shown by the sign-in interstitial');
 const failing=fixture(now,{fail:()=>true}),s2=await failing.adapter.snapshot(p(A),{org:ORG,at:now});
 assert.equal((await failing.adapter.notify(p(A),{org:ORG,claim,event:'start',channel:s2.channels[0].id,kind:'email'})).accepted,false,'a provider failure is not acceptance');
 const nomail=fixture(now,{mail:false}),s3=await nomail.adapter.snapshot(p(A),{org:ORG,at:now});
 assert.equal((await nomail.adapter.notify(p(A),{org:ORG,claim,event:'start',channel:s3.channels[0].id,kind:'email'})).accepted,false,'no mail transport, no acceptance');
 for(const event of Object.keys(OWNER_NOTICE_KINDS))assert.ok(typeof OWNER_NOTICE_KINDS[event]==='string');
});

test('hint rows: reordered and retried effects converge; a contest entry ends with its window',()=>{
 const put=(row,claim,at,role='owner',extra={})=>hintApply(row,{op:'put',org:ORG,claim,role,at,...extra}),drop=(row,claim,at,role='owner')=>hintApply(row,{op:'drop',org:ORG,claim,role,at});
 const c1='11111111-1111-4111-8111-111111111111',c2='22222222-2222-4222-8222-222222222222';
 assert.equal(liveHints(drop(put(undefined,c1,1),c1,5),9).length,0);
 assert.equal(liveHints(put(drop(undefined,c1,5),c1,1),9).length,0,'a put delivered after its drop stays dropped');
 assert.equal(liveHints(put(put(undefined,c1,1),c1,1),9).length,1,'a retried put is idempotent');
 assert.deepEqual(liveHints(put(put(undefined,c2,10),c1,1),11).map(h=>h.claim),[c2],'an older claim never displaces a newer one');
 assert.deepEqual(liveHints(drop(put(undefined,c2,10),c1,12),13).map(h=>h.claim),[c2],'a drop for another claim leaves the hint');
 // Seed 216 of the liveness chaos: an old claim's retried put after a newer claim also ended stays dropped.
 assert.equal(liveHints(put(drop(put(drop(undefined,c1,5),c2,6),c2,9),c1,1),10).length,0,'every ended claim keeps its own tombstone');
 const contest=put(undefined,c1,1,'former-owner',{until:100});assert.equal(liveHints(contest,99).length,1);assert.equal(liveHints(contest,100).length,0);
});

test('the engine with the production adapter: no address is stored, Track A needs an out-of-band channel off every signer’s domain',async()=>{
 {const w=await channelWorld(32);try{
  await w.start();const c=await w.claim();assert.equal(c.track,'A');assert.deepEqual(c.channels.map(ch=>ch.kind),['email','push','credential','session']);
  assert.ok(!/@|home-alice|pushrow|cred-|sess-/.test(JSON.stringify(c.channels)+JSON.stringify(c.adminDomains)),'claims hold ids and hashes only');
  assert.ok(c.channels.filter(ch=>ch.kind==='email').every(ch=>ch.domainHashes.length>=1));
 }finally{await w.close();}}
 {const w=await channelWorld(33);try{
  // The owner's only email is a subdomain of the co-signer's domain and there is no push: not out of band (BG-R1-H2, M4).
  w.f.records.get(A).verifiedEmail='alice@mail.carol.example';w.f.pushRows.delete(A);
  await w.start();assert.equal((await w.claim()).track,'A');await w.cosign(C);const c=await w.claim();assert.equal(c.track,'S');assert.ok(c.causes.includes('no-out-of-band-channel'));
 }finally{await w.close();}}
 {const w=await channelWorld(34);try{w.f.records.get(A).lastInteractiveAt=w.clock.now()-3*DAY;await w.start();assert.ok((await w.claim()).causes.includes('recent-owner-sign-in'),'the identity record’s last interactive sign-in feeds Track A');}finally{await w.close();}}
});

test('M1 acceptance gate: provider-accepted out-of-band notices let Track A take effect; without them the claim is held',async()=>{
 {const w=await channelWorld(35);try{
  const c=await w.trackA();await w.settle();await w.reach(c.waitEndsAt);await w.settle();await w.sync();
  const after=await w.claim();assert.equal(after.state,'effective',JSON.stringify(after.lastBlocked??after.log.at(-1)));
  assert.deepEqual([...new Set(w.f.sent.map(n=>n.event))].sort(),['claim-started','effective','final-reminder','reminder','wait-started'].sort());
  assert.ok(w.f.sent.filter(n=>n.event!=='effective').every(n=>n.abortUrl?.startsWith(ISS+'/org-claim/abort#org='+ORG+'&token=bg1.')),'every open-claim mail carries an abort link');
  assert.ok(w.f.pushes.length>=3,'push notices too');
 }finally{await w.close();}}
 {const w=await channelWorld(36,{fixture:{fail:()=>true}});try{
  const c=await w.trackA();await w.settle();await w.reach(c.waitEndsAt);await w.settle();await w.sync();
  const after=await w.claim();assert.equal(after.state,'held','I13: no Track A effect without accepted out-of-band notices');assert.ok(after.causes.some(x=>['notice-undelivered','channel-undeliverable'].includes(x)),after.causes.join());
 }finally{await w.close();}}
});

test('hints: the owner and co-signers get rows at T1; they are dropped at the end; the former owner holds a contest entry for 90 days',async()=>{
 const w=await channelWorld(37);try{
  await w.start(B,B);await w.settle();
  assert.deepEqual((await w.hints(A)).map(h=>h.role),['owner']);
  assert.deepEqual((await w.hints(C)).map(h=>h.role),['admin']);assert.deepEqual((await w.hints(E)).map(h=>h.role),['admin']);
  assert.deepEqual(await w.hints(B),[],'the initiator acts in the console; no item');
  await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});await w.settle();
  for(const sub of [A,C,E])assert.deepEqual(await w.hints(sub),[],'every hint is dropped when the claim ends');
  w.clock.advance(31*DAY);await w.sync();
  const c=await w.trackA();await w.settle();await w.reach(c.waitEndsAt);await w.settle();await w.sync();await w.settle();
  assert.equal((await w.claim()).state,'effective');
  const former=await w.hints(A);assert.deepEqual(former.map(h=>h.role),['former-owner']);assert.equal(former[0].until,(await w.summary()).breakGlassContest.until);
  assert.deepEqual(await w.hints(C),[]);
  const view=await w.run('orgs.breakglass',A);assert.deepEqual(view.decisions,['contest']);assert.equal(view.organization.name,'Acme');
  w.clock.set(former[0].until+1);await w.sync();await w.settle();assert.deepEqual(await w.hints(A),[],'the window closed: the entry is gone');
 }finally{await w.close();}
});

test('sign-in liveness: an interactive owner sign-in holds a waiting claim (T9) and never aborts it; the interstitial then aborts with a known proof',async()=>{
 const w=await channelWorld(38);try{
  const c=await w.trackA();await w.settle();assert.equal(c.state,'waiting');const id=await identityFor(w);
  const session=await id.login();assert.deepEqual(id.calls.map(x=>[x.owner,x.kind]),[[A,'sign-in']]);
  let now=await w.claim();assert.equal(now.state,'held','T9: the sign-in holds the claim for support');assert.equal(now.track,'S');assert.ok(now.causes.includes('owner-liveness'));
  assert.equal(id.repository.records.get(A).lastInteractiveAt,w.clock.now(),'the record keeps the last interactive sign-in for the next snapshot');
  await stepUpPasskey(id.act,sessionContext(session),id.credentialId);await id.service.settleBackground();assert.equal(id.calls.at(-1).kind,'step-up');
  // The interstitial: a session created after T1 alone is no proof (it is not a known channel); a session from before T1,
  // or a step-up with a credential enrolled before T1, is (§12d.3; the route adds the session's creation time).
  await rejects(w.run('orgs.breakglass-abort',A,{claim:c.id},{verification:{sessionCreatedAt:w.clock.now()}}),'owner_proof_required');
  await w.abort(w.tier0(c));now=await w.claim();assert.equal(now.state,'aborted','a session from before T1 aborts a held claim (T10)');
  await id.login();assert.equal((await w.claim()).state,'aborted','sign-ins after the end change nothing');
 }finally{await w.close();}
});

test('sign-in liveness: gathering stays gathering on Track S; final becomes held and the decision is void; owners of no claim are not signalled',async()=>{
 {const w=await channelWorld(39);try{await w.start();await w.settle();const id=await identityFor(w);await id.login();const c=await w.claim();assert.equal(c.state,'gathering');assert.equal(c.track,'S');}finally{await w.close();}}
 {const w=await channelWorld(40);try{
  const c=await w.trackA();await w.run('orgs.breakglass-object',E,{claim:c.id});await w.proceed();assert.equal((await w.claim()).state,'final');await w.settle();
  const id=await identityFor(w);await id.login();const after=await w.claim();assert.equal(after.state,'held');assert.equal(after.decision,null,'BG-R1-M2: liveness voids a final decision');
 }finally{await w.close();}}
 {const w=await channelWorld(41);try{const id=await identityFor(w);await id.login();assert.deepEqual(await w.signal(A,{kind:'sign-in',at:w.clock.now()}),{signalled:0});}finally{await w.close();}}
});

test('no-claim sign-in cost: the same identity writes as without the hook, and no write in the person’s account or any organization',async()=>{
 const w=await channelWorld(42);try{
  const plain=await identityFor(w,{wired:false});await plain.login();const baseline=plain.cas.count;
  const wired=await identityFor(w);const before=JSON.stringify(await w.summary()),stats=await w.personStats(A),writes=stats.writes;
  await wired.login();
  assert.equal(wired.cas.count,baseline,'lastInteractiveAt rides the sign-in CAS: no extra identity write');
  assert.equal(wired.calls.length,1,'one fire-and-forget hint read');
  assert.equal((await w.personStats(A)).writes,writes,'no write in the person’s account');
  assert.equal(JSON.stringify(await w.summary()),before,'the organization is never reached');
  // A refused sign-in signals nothing.
  await rejects(signInPasskey(wired.act,'alice','passkey-not-enrolled'),'unauthorized');await wired.service.settleBackground();assert.equal(wired.calls.length,1);
 }finally{await w.close();}
});

test('abort tokens over the production adapter: single use, wrong tokens identical, valid only for an open claim',async()=>{
 const w=await channelWorld(43);try{
  await w.trackA();await w.settle();const links=w.f.sent.filter(n=>n.abortUrl).map(n=>new URLSearchParams(new URL(n.abortUrl).hash.slice(1)).get('token'));assert.ok(links.length>=2);
  const forged=links[0].slice(0,-4)+'AAAA',other=links[0].replace(/^bg1\.[^.]+/,'bg1.'+crypto.randomUUID());
  for(const token of [forged,other,'bg1.garbage','x'.repeat(300)])assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token}),{received:true,outcome:'refused'});
  assert.equal((await w.claim()).state,'waiting','wrong tokens change nothing');assert.equal((await w.claim()).tokenFailures,1,'failures are counted per claim (a shape-valid token naming this claim)');
  assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token:links[0]}),{received:true,outcome:'stopped'},'review L1: the writer tells the route privately');const c=await w.claim();assert.equal(c.state,'aborted');assert.equal(c.closedReason,'owner');
  assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token:links[0]}),{received:true,outcome:'refused'},'a replay is refused (the route answers identically)');
  assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token:links[1]}),{received:true,outcome:'refused'},'another link of an ended claim is inert');
  assert.equal((await w.claim()).state,'aborted');assert.ok(c.tokens.filter(t=>t.usedAt).length===1,'single use');
 }finally{await w.close();}
});

test('the hint ceiling: at most HINTS rows per claim, the owner first',async()=>{
 const w=await channelWorld(44);try{
  for(let i=0;i<BREAK_GLASS.HINTS+4;i++){const sub=`0000${i.toString(16).padStart(4,'0')}-0000-4000-8000-${i.toString(16).padStart(12,'0')}`;await w.join(sub,[{power:'admin'}]);}
  w.clock.advance(31*DAY);await w.sync();await w.start();const c=await w.claim();assert.equal(c.hinted.length,BREAK_GLASS.HINTS);assert.deepEqual(c.hinted[0],{sub:A,role:'owner'});
 }finally{await w.close();}
});

// ---- review follow-ups (2026-10-23, round ORG-12b/12e) ---------------------------------------------------------------
test('review M1: a sign-in whose signal was lost is found at the effect (Track A and final); a later decision is not voided again',async()=>{
 {const w=await channelWorld(50);try{
  const c=await w.trackA();await w.settle();w.f.records.get(A).lastInteractiveAt=w.clock.now()+DAY;// a sign-in no signal delivered
  await w.reach(c.waitEndsAt);await w.settle();await w.sync();const after=await w.claim();
  assert.equal(after.state,'held','Track A never takes effect over a newer owner sign-in');assert.ok(after.causes.includes('owner-liveness'));assert.ok(after.livenessAt>c.createdAt);
 }finally{await w.close();}}
 {const w=await channelWorld(51);try{
  const c=await w.trackA();await w.run('orgs.breakglass-object',E,{claim:c.id});await w.proceed();let f=await w.claim();assert.equal(f.state,'final');await w.settle();
  w.f.records.get(A).lastInteractiveAt=f.decision.at+1000;// signed in after the decision, signal lost
  w.clock.set(Math.max(f.finalEndsAt,f.paidAt+w.BREAK_GLASS.WAIT_S_MS)+H);await w.sync();await w.settle();await w.sync();f=await w.claim();
  assert.equal(f.state,'held','a final claim is held, its decision void');assert.equal(f.decision,null);
 }finally{await w.close();}}
 {const w=await channelWorld(52);try{
  // The sign-in is delivered (held), support then decides to proceed: that sign-in is older than the decision, so the
  // effect-time re-read does not void it a second time.
  const c=await w.trackA();await w.settle();const at=w.clock.now()+1000;w.clock.advance(2000);w.f.records.get(A).lastInteractiveAt=at;
  await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at});assert.equal((await w.claim()).state,'held');
  await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at});assert.equal((await w.claim()).log.filter(x=>x.event==='liveness').length,1,'a retried signal is applied once');
  w.clock.advance(DAY);await w.proceed();let f=await w.claim();assert.equal(f.state,'final');await w.settle();
  w.clock.set(Math.max(f.finalEndsAt,f.paidAt+w.BREAK_GLASS.WAIT_S_MS)+H);await w.sync();await w.settle();await w.sync();f=await w.claim();
  assert.equal(f.state,'effective',JSON.stringify(f.lastBlocked));
 }finally{await w.close();}}
 {const w=await channelWorld(53);try{
  const c=await w.trackA();await w.settle();const real=w.f.adapter.snapshot;let down=true;w.service.ownerChannels.snapshot=async(...a)=>{if(down)throw new Error('identity down');return real(...a);};
  await w.reach(c.waitEndsAt);await w.settle();await w.sync();const blocked=await w.claim();assert.equal(blocked.state,'waiting','an unreadable owner never lets the claim take effect');assert.equal(blocked.lastBlocked.reason,'owner-unverified');
 }finally{await w.close();}}
});
