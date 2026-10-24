// ORG-12d support adjudication at the ngin engine level: the admin service's production operator assertions (ES256,
// sealed key in the admin store), the durable registry the organization writer verifies against, the two-operator and
// barred-pair rules end to end, the daily limit, capability and passkey step-up, the flag gate, the case queue and the
// operator audit (design §12d.8, §12d.12). Loopback fixtures and a local WebAuthn verifier: local behaviour only, never
// production operator identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {orgCasesWorld,OP1,OP2,OP3,OP4,NOCAP,PWD,ORG,A,B,C,E,DAY,p,rejects,ISS,CATALOG} from './helpers/org-cases-world.mjs';
import {operatorScope,OPERATOR_ASSERTION_TTL_MS} from '../packages/identity/operator-assertions.mjs';
import {hmacOperatorAssertions} from '../packages/orgs/break-glass.mjs';
import {validateCatalog} from '../packages/identity/roles.mjs';
import {OWNERSHIP} from '../packages/orgs/ownership.mjs';
import {adminRoutes} from '../packages/runtime/admin-http.mjs';

const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function held(w){await w.trackA();const c=await w.claim();await w.run('orgs.breakglass-object',E,{claim:c.id});await w.settle();const h=await w.claim();assert.equal(h.state,'held');return h;}
/** Issues an assertion exactly as the admin service would, but captures it instead of forwarding it. */
async function capture(w,op,decision,input={}){let captured=null;w.port.intercept=(method,org,x)=>{captured={method,org,input:x};return method==='resolve'?{decision:'recorded'}:{decision:'close',claim:{state:'pending'}};};try{await w.decide(op,decision,input);}finally{w.port.intercept=null;}return captured;}
/** A registry-valid assertion that skips every admin-service check (a compromised or buggy admin path): the writer's own
 * rules must still hold. */
async function issue(w,operator,scope){const prepared=await w.admin.operatorSigner().prepare({operator,scope});await w.store.commit({writes:{['operator-assertion/'+prepared.jti]:prepared.record}});return prepared.assertion;}
const resolveWith=(w,input)=>w.run('orgs.breakglass-resolve','system',input);
const pushToken=w=>{const push=w.ownerChannels.sent.filter(n=>n.abort&&n.channel.startsWith('push-')).at(-1);return push.abort;};

test('signer and registry: ES256 assertions from a key sealed in the admin store; the writer verifies with the public key and the issued, single-use registry row',async()=>{const w=await orgCasesWorld(1);try{
 const c=await held(w);assert.deepEqual(await w.decide(OP1,'acknowledge'),{outcome:'recorded',decisionsLeft:19});
 const signer=await w.store.get('operator-signer'),key=await w.store.get('operator-key/'+signer.kid);
 assert.equal(key.alg,'ES256');assert.deepEqual(Object.keys(key.publicJwk).sort(),['crv','kty','x','y'],'the published key has no private scalar');
 assert.ok(!JSON.stringify(signer).includes('"d"'),'the private key is stored sealed only');assert.equal(signer.sealed.version,1);
 const issued=w.port.calls.at(-1).input.assertion;assert.match(issued,/^oa1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/,'oa1, payload and a 64-byte P1363 signature');
 const claims=JSON.parse(Buffer.from(issued.split('.')[1],'base64url'));assert.equal(claims.kid,signer.kid);assert.equal(claims.iss,ISS);assert.equal(claims.capability,'support.org-break-glass');
 assert.equal(claims.exp-claims.iat,OPERATOR_ASSERTION_TTL_MS);assert.equal(claims.scope,operatorScope({org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',exclude:[]}));
 const row=await w.store.get('operator-assertion/'+claims.jti);assert.equal(row.state,'used');assert.equal(row.operator,OP1);
 assert.ok((await w.auditLog(OP1)).entries.some(e=>e.action==='operator-key.create'),'creating the signing key is audited');
}finally{await w.close();}
 // No KEY_ENCRYPTION_KEY: no key can be sealed, so nothing is issued (fail closed).
 const x=await orgCasesWorld(2,{keyEncryptionKey:null});try{await held(x);await rejects(x.decide(OP1,'acknowledge'),'operator_assertions_unavailable');assert.equal(x.port.calls.length,0);}finally{await x.close();}
});

test('a forged assertion is refused: tampered payload, a foreign key under the real kid, the HMAC test double, an unregistered or a retired key',async()=>{const w=await orgCasesWorld(3);try{
 const c=await held(w),real=(await capture(w,OP1,'acknowledge')).input,[prefix,payload,sig]=real.assertion.split('.');
 const claims=JSON.parse(Buffer.from(payload,'base64url'));
 // Tampered payload under the original signature (the scope widened to another decision).
 const tampered=prefix+'.'+b64(JSON.stringify({...claims,scope:operatorScope({org:ORG,kind:'break-glass',process:c.id,decision:'abort',exclude:[]})}))+'.'+sig;
 await rejects(resolveWith(w,{...real,decision:'abort',assertion:tampered}),'operator_unverified');
 // A key the attacker made, presented under the real kid.
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),forgedPayload=b64(JSON.stringify({...claims,jti:crypto.randomUUID()}));
 const forgedSig=b64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode('bindle-operator-assertion-v1.'+forgedPayload))));
 await rejects(resolveWith(w,{...real,assertion:'oa1.'+forgedPayload+'.'+forgedSig}),'operator_unverified');
 // The loopback HMAC double is not accepted by the production verifier.
 const hmac=await hmacOperatorAssertions({secret:'loopback-operator-secret-0001',registered:()=>true,clock:w.clock.now}).sign({operator:OP1,scope:{org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',exclude:[]}});
 await rejects(resolveWith(w,{...real,assertion:hmac}),'operator_unverified');
 // Validly signed but never committed to the registry (the admin service did not durably issue it).
 const unregistered=await w.admin.operatorSigner().prepare({operator:OP1,scope:{org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',exclude:[]}});
 await rejects(resolveWith(w,{...real,assertion:unregistered.assertion}),'operator_unverified');
 // A registered, unused assertion whose signature bytes were altered (the registry alone would accept its payload).
 const flipped=prefix+'.'+payload+'.'+(sig[0]==='A'?'B':'A')+sig.slice(1);
 await rejects(resolveWith(w,{...real,assertion:flipped}),'operator_unverified');
 assert.equal((await w.store.get('operator-assertion/'+claims.jti)).state,'issued','a refused signature never spends the registry row');
 // A retired key verifies nothing, even for a registered, unused assertion.
 const signer=await w.store.get('operator-signer'),k=await w.store.get('operator-key/'+signer.kid),{revision,...value}=k;
 await w.store.commit({expect:{['operator-key/'+signer.kid]:revision},writes:{['operator-key/'+signer.kid]:{...value,retiredAt:w.clock.now()}}});
 await rejects(resolveWith(w,real),'operator_unverified');
 assert.equal((await w.claim()).held.ackAt,null,'nothing forged was recorded');
}finally{await w.close();}});

test('a replayed assertion is refused: once used it never decides again, in this process or any other',async()=>{const w=await orgCasesWorld(4);try{
 await held(w);const real=(await capture(w,OP1,'proceed')).input;
 assert.deepEqual(await resolveWith(w,real),{decision:'proposed'});
 await rejects(resolveWith(w,real),'operator_unverified');
 // The registry refuses it host-wide, even where the per-process nonce list would not know it.
 assert.deepEqual(await w.verifier.verify({assertion:real.assertion,operator:OP1,scope:{org:ORG,kind:'break-glass',process:real.claim,decision:'proceed',exclude:[]},at:w.clock.now()}),{ok:false});
 // An expired assertion is refused too (5 minutes).
 const late=(await capture(w,OP2,'acknowledge')).input;w.clock.advance(OPERATOR_ASSERTION_TTL_MS);await rejects(resolveWith(w,late),'operator_unverified');
}finally{await w.close();}});

test('an assertion used for another scope is refused (organization, process, decision, kind, exclusions, operator) and stays usable for its own',async()=>{const w=await orgCasesWorld(5);try{
 const c=await held(w),real=(await capture(w,OP1,'acknowledge')).input,scope={org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',exclude:[]},at=()=>w.clock.now();
 await rejects(resolveWith(w,{...real,decision:'abort'}),'operator_unverified');
 await rejects(resolveWith(w,{...real,claim:crypto.randomUUID()}),'operator_unverified');
 await rejects(resolveWith(w,{...real,operator:OP2}),'operator_unverified');
 await rejects(w.run('orgs.claim-resolve','system',{claim:c.id,decision:'close',operator:OP1,assertion:real.assertion}),'operator_unverified');
 for(const other of [{org:'99999999-9999-4999-8999-999999999999'},{kind:'lapse-claim'},{exclude:['push-aaaa']},{process:crypto.randomUUID()},{decision:'proceed'}])
  assert.deepEqual(await w.verifier.verify({assertion:real.assertion,operator:OP1,scope:{...scope,...other},at:at()}),{ok:false},JSON.stringify(other));
 assert.deepEqual(await resolveWith(w,real),{decision:'recorded'},'refused misuses did not consume it');
 assert.ok((await w.claim()).held.ackAt);
}finally{await w.close();}});

test('a single operator cannot proceed (admin and writer both refuse); one operator may only hold or abort',async()=>{const w=await orgCasesWorld(6);try{
 const c=await held(w);
 assert.equal((await w.decide(OP1,'proceed')).outcome,'proposed');assert.equal((await w.claim()).state,'held');
 const v=await w.view(OP1);assert.equal(v.proposal.mine,true);assert.ok(!v.allowed.includes('proceed'));assert.equal((await w.view(OP2)).proposal.mine,false);
 await rejects(w.decide(OP1,'proceed'),'second_operator_required');
 // The writer refuses too, with a registry-valid assertion that skipped the admin service's checks.
 await rejects(resolveWith(w,{claim:c.id,operator:OP1,decision:'proceed',assertion:await issue(w,OP1,{org:ORG,kind:'break-glass',process:c.id,decision:'proceed',exclude:[]})}),'second_operator_required');
 assert.equal((await w.claim()).state,'held','I8: no single operator reaches final');
 assert.equal((await w.decide(OP1,'acknowledge')).outcome,'recorded');assert.equal((await w.decide(OP1,'note')).outcome,'recorded');
 assert.equal((await w.decide(OP1,'abort')).outcome,'recorded');const x=await w.claim();assert.equal(x.state,'aborted');assert.equal(x.closedReason,'support');
}finally{await w.close();}});

test('barred pairs: after an excluded channel disputes, neither operator of that pair can propose or approve again; a new pair can',async()=>{const w=await orgCasesWorld(7);try{
 await w.start();await w.settle();await w.run('orgs.breakglass-abort-token','system',{token:pushToken(w)});assert.equal((await w.claim()).state,'aborted');
 w.clock.advance(31*DAY);await w.sync();await w.start(C);await w.cosign(E);await w.settle();
 await w.run('orgs.breakglass-abort-token','system',{token:pushToken(w)});await w.pay(C);await w.settle();
 let c=await w.claim();assert.equal(c.state,'held');const push=c.channels.find(x=>x.kind==='push').id;
 const v=await w.view(OP1);assert.deepEqual(v.channels.filter(x=>x.excludable).map(x=>x.id),[push],'only the disputed channel can be excluded');
 await rejects(w.decide(OP1,'proceed',{exclude:v.channels.map(x=>x.id)}),'invalid_exclusion');
 assert.equal((await w.decide(OP1,'proceed',{exclude:[push]})).outcome,'proposed');
 assert.equal((await w.decide(OP2,'proceed',{exclude:[push]})).outcome,'approved');c=await w.claim();assert.equal(c.state,'final');
 await w.settle();await w.run('orgs.breakglass-abort-token','system',{token:pushToken(w)});c=await w.claim();assert.equal(c.state,'held');assert.deepEqual(c.barredPairs,[[OP1,OP2].sort()]);
 for(const op of [OP1,OP2]){const view=await w.view(op);assert.equal(view.barred,true);assert.ok(!view.allowed.includes('proceed'));await rejects(w.decide(op,'proceed',{exclude:[push]}),'operator_pair_barred');}
 assert.equal((await w.decide(OP3,'proceed',{exclude:[push]})).outcome,'proposed');
 await rejects(w.decide(OP1,'proceed',{exclude:[push]}),'operator_pair_barred');
 await rejects(resolveWith(w,{claim:c.id,operator:OP1,decision:'proceed',exclude:[push],assertion:await issue(w,OP1,{org:ORG,kind:'break-glass',process:c.id,decision:'proceed',exclude:[push]})}),'operator_pair_barred');
 assert.equal((await w.decide(OP4,'proceed',{exclude:[push]})).outcome,'approved');c=await w.claim();assert.equal(c.state,'final');assert.deepEqual(c.decision.pair,[OP3,OP4].sort());
}finally{await w.close();}});

test('the daily limit holds: 20 decisions per operator in a 24-hour window, then decision_limit until the window ends',async()=>{const w=await orgCasesWorld(8);try{
 await held(w);
 for(let i=0;i<20;i++)assert.equal((await w.decide(OP1,i%2?'note':'acknowledge')).decisionsLeft,19-i);
 const forwarded=w.port.calls.length;await rejects(w.decide(OP1,'acknowledge'),'decision_limit');assert.equal(w.port.calls.length,forwarded,'nothing is issued or forwarded past the limit');
 assert.equal((await w.list(OP1)).decisionsLeft,0);assert.equal((await w.view(OP1)).decisionsLeft,0);
 assert.equal((await w.decide(OP2,'acknowledge')).outcome,'recorded','the limit is per operator');
 w.clock.advance(DAY-60000);await rejects(w.decide(OP1,'acknowledge'),'decision_limit');
 w.clock.advance(60000);assert.equal((await w.decide(OP1,'acknowledge')).decisionsLeft,19);
}finally{await w.close();}});

test('capability: a non-capability admin, boot, a suspended operator and a revoked capability are refused; the capability is never delegable',async()=>{const w=await orgCasesWorld(9);try{
 const c=await held(w);
 await rejects(w.list(NOCAP),'operator_capability_required');await rejects(w.view(NOCAP),'operator_capability_required');await rejects(w.decide(NOCAP,'acknowledge'),'operator_capability_required');
 await rejects(w.list(OP1,{}).then(()=>w.list(OP1,{startAfter:'x'})),'invalid_request');
 const boot={...w.contexts.get(OP1),actor:'boot'};await rejects(w.admin.orgCases({},boot),'operator_capability_required');
 // Revoked between issue and use: the writer's registry check refuses.
 const real=(await capture(w,OP2,'acknowledge')).input;
 const row=await w.store.get('principal/'+OP2),{revision,...value}=row;await w.store.commit({expect:{['principal/'+OP2]:revision},writes:{['principal/'+OP2]:{...value,roles:['admin']}}});
 await rejects(resolveWith(w,real),'operator_unverified');await rejects(w.decide(OP2,'acknowledge'),'operator_capability_required');
 // A held (suspended) operator.
 const r3=await w.store.get('principal/'+OP3),{revision:rev3,...v3}=r3;await w.store.commit({expect:{['principal/'+OP3]:rev3},writes:{['principal/'+OP3]:{...v3,hold:{at:w.clock.now()}}}});
 await rejects(w.decide(OP3,'acknowledge'),'operator_capability_required');
 // Catalog rules: internal only, never in a delegable or user-class role.
 const bad=structuredClone(CATALOG);bad.roles['support-operator'].delegable=true;assert.throws(()=>validateCatalog(bad),e=>e.code==='invalid_role_catalog');
 const user=structuredClone(CATALOG);user.capabilities['support.org-break-glass'].class='user';assert.throws(()=>validateCatalog(user),e=>e.code==='invalid_role_catalog');
 assert.equal((await w.claim()).held.ackAt,null);void c;
}finally{await w.close();}});

test('a password step-up is refused, and every decision needs its own fresh passkey assertion',async()=>{const w=await orgCasesWorld(10);try{
 await held(w);await w.stepUp(PWD,'password');
 await rejects(w.list(PWD),'step_up_required');await rejects(w.decide(PWD,'acknowledge',{},{passkey:false}),'step_up_required');
 await rejects(w.decide(OP1,'acknowledge',{},{passkey:false}),'step_up_required','a fresh console step-up alone is not a decision assertion');
 // The HTTP boundary: administrators confirm with a passkey only.
 const ctx=w.contexts.get(PWD),request=path=>new Request(ISS+path,{method:'POST',headers:{Origin:ISS,'X-Bindle-Admin-Actor':'admin'}});
 const json=(value,status=200,headers)=>Response.json(value,{status,headers});
 const res=await adminRoutes({path:'/api/admin/step-up',request:request('/api/admin/step-up'),env:{APP_ORIGIN:ISS,ADMIN_SERVICE:()=>w.admin},context:{...ctx},body:async()=>({method:'password',password:'long local operator password'}),json});
 assert.equal(res.status,403);assert.equal((await res.json()).error,'passkey_required');
 const decide=await adminRoutes({path:'/api/admin/org-cases/decide',request:request('/api/admin/org-cases/decide'),env:{APP_ORIGIN:ISS,ADMIN_SERVICE:()=>w.admin},context:{...w.contexts.get(OP1)},body:async()=>({org:ORG,kind:'break-glass',process:(await w.claim()).id,decision:'acknowledge'}),json});
 assert.equal(decide.status,403);assert.equal((await decide.json()).error,'step_up_required');
}finally{await w.close();}});

test('ORG_BREAK_GLASS_ENABLED gates the seizing direction (uniform 404) but never the queue, the case or a hold or abort',async()=>{const w=await orgCasesWorld(11);try{
 await held(w);w.flag.names.ORG_BREAK_GLASS_ENABLED=false;
 assert.equal((await w.list(OP1)).cases.length,1);const v=await w.view(OP1);assert.equal(v.seizingEnabled,false);assert.deepEqual(v.allowed,['acknowledge','note','abort']);
 await rejects(w.decide(OP1,'proceed'),'not_found');assert.equal(w.port.calls.length,0);
 assert.equal((await w.decide(OP1,'acknowledge')).outcome,'recorded');assert.equal((await w.decide(OP2,'abort')).outcome,'recorded');assert.equal((await w.claim()).state,'aborted');
}finally{await w.close();}});

test('the queue: the writer indexes held claims and open contests through its outbox; rows only move forward and the view never carries addresses',async()=>{const w=await orgCasesWorld(12);try{
 const c=await w.trackA();assert.equal(await w.caseRow(),null,'no case while the claim waits');
 await w.run('orgs.breakglass-object',E,{claim:c.id});assert.equal(await w.caseRow(),null,'routing waits for the outbox');await w.settle();
 let row=await w.caseRow();assert.equal(row.state,'held');assert.equal(row.process,c.id);
 const list=await w.list(OP1);assert.deepEqual(list.cases.map(x=>[x.kind,x.state]),[['break-glass','held']]);
 const v=await w.view(OP1),text=JSON.stringify(v);assert.ok(!/example|@|not answered/.test(text),'no address, domain or statement text');
 assert.deepEqual(v.channels.map(x=>x.kind).sort(),['credential','email','push','session']);assert.ok(v.channels.every(x=>Number.isInteger(x.ageDays)));assert.ok(v.timeline.some(x=>x.event==='object'));
 await w.decide(OP1,'proceed');await w.decide(OP2,'proceed');assert.equal((await w.claim()).state,'final');
 await w.settle();assert.equal(await w.caseRow(),null,'review L3: a decided claim\'s row is deleted');assert.equal((await w.store.get('org-case-seq/'+ORG)).seq,2,'its sequence is kept');
 // A stale (lower-sequence) write never resurrects or rewinds the row.
 const stale=await (await import('../packages/identity/operator-assertions.mjs')).supportCaseIndex({store:w.store,clock:w.clock.now}).apply(ORG,{kind:'break-glass',process:c.id,state:'held',seq:1});assert.equal(stale.stale,true);
 assert.equal((await w.list(OP1)).cases.length,0,'a closed case leaves the queue');
}finally{await w.close();}});

test('contest: two operators uphold through the admin service (a reinstatement); one alone cannot',async()=>{const w=await orgCasesWorld(13);try{
 const c=await w.trackA();await w.reach(c.waitEndsAt);assert.equal((await w.summary()).ownerOfRecord.sub,B);
 await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));await w.settle();
 assert.equal((await w.caseRow()).state,'contest');const v=await w.view(OP1);assert.deepEqual(v.allowed,['uphold','reject']);
 assert.equal((await w.decide(OP1,'uphold')).outcome,'proposed');await rejects(w.decide(OP1,'uphold'),'second_operator_required');assert.equal((await w.summary()).ownerOfRecord.sub,B);
 assert.equal((await w.decide(OP2,'uphold')).outcome,'approved');assert.equal((await w.summary()).ownerOfRecord.sub,A);
 await w.settle();assert.equal(await w.caseRow(),null);
}finally{await w.close();}});

test('lapse claims: an escalated claim is a case; proceed needs two operators, close needs one; kinds never cross',async()=>{const w=await orgCasesWorld(14);try{
 await w.service.observeAuthority(p(A),{aep:1});const a=await w.member(A);
 await w.run('orgs.reconfirm',A,{membership:a.id,aep:1,decision:'notice'},{aep:1});await w.run('orgs.reconfirm',C,{membership:a.id,aep:1,decision:'object'});
 w.clock.advance(10*DAY);await w.sweep();w.polar.lapse(w.ownerSub.subscription);await w.webhook();
 w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});w.payLatest('claim');await w.webhook();w.clock.advance(3*DAY+1000);await w.sync();await w.settle();
 const claim=(await w.summary()).billing.claim;assert.ok(Number.isSafeInteger(claim.escalatedAt));
 assert.deepEqual([(await w.caseRow()).kind,(await w.caseRow()).state],['lapse-claim','escalated']);
 const v=await w.view(OP1);assert.equal(v.kind,'lapse-claim');assert.deepEqual(v.allowed,['close','proceed']);
 await rejects(w.decide(OP1,'acknowledge',{kind:'lapse-claim'}),'invalid_request');
 await rejects(w.decide(OP1,'proceed',{kind:'break-glass',process:claim.id}),'not_found');
 assert.equal((await w.decide(OP1,'proceed',{kind:'lapse-claim'})).outcome,'proposed');await rejects(w.decide(OP1,'proceed',{kind:'lapse-claim'}),'second_operator_required');
 assert.equal((await w.decide(OP2,'proceed',{kind:'lapse-claim'})).outcome,'approved');assert.ok(Number.isSafeInteger((await w.summary()).billing.claim.operatorApprovedAt));
 assert.equal((await w.decide(OP3,'close',{kind:'lapse-claim'})).outcome,'recorded','one operator may close (the safe direction)');
 const closed=(await w.summary()).billing.claim;assert.equal(closed.state,'closed');assert.equal(closed.closedReason,'operator-closed');await w.settle();assert.equal(await w.caseRow(),null);
}finally{await w.close();}});

test('audit: every operator action is in the hash-chained admin audit with its outcome; a writer refusal is recorded as failed',async()=>{const w=await orgCasesWorld(15);try{
 await held(w);await w.operator(E);
 await rejects(w.decide(E,'acknowledge'),'operator_conflict');
 await w.decide(OP1,'acknowledge');const log=await w.auditLog(OP1);
 const decide=log.entries.filter(e=>e.action==='org-case.decide');assert.deepEqual(decide.slice(0,4).map(e=>e.phase),['applied','intent','failed','intent']);
 assert.equal(decide[2].after.code,'operator_conflict');assert.ok(decide.every(e=>e.target===ORG&&e.actor.handle));
 assert.ok(!JSON.stringify(log).includes('Reviewed the case'),'reasons are digested, never stored');
 assert.deepEqual(await w.store.verifyAudit(),{valid:true,seq:(await w.store.get('audit-head')).seq});
}finally{await w.close();}});

test('HTTP: same-origin POST, the administrator actor only, CSRF-checked context, a passkey per decision, no query strings',async()=>{const w=await orgCasesWorld(16);try{
 const c=await held(w),ctx=w.contexts.get(OP1),json=(value,status=200,headers)=>Response.json(value,{status,headers});
 const call=(path,input,{method='POST',origin=ISS,actor='admin',query=''}={})=>adminRoutes({path,request:new Request(ISS+path+query,{method,headers:{Origin:origin,'X-Bindle-Admin-Actor':actor}}),env:{APP_ORIGIN:ISS,ADMIN_SERVICE:()=>w.admin},context:{sessionToken:ctx.sessionToken,csrfToken:ctx.csrfToken,remoteIP:ctx.remoteIP},body:async()=>input,json});
 let res=await call('/api/admin/org-cases/list',{});assert.equal(res.status,200);assert.equal((await res.json()).cases.length,1);assert.equal(res.headers.get('cache-control'),'private, no-store');
 res=await call('/api/admin/org-cases/list',{},{origin:'https://evil.example'});assert.equal(res.status,403);
 res=await call('/api/admin/org-cases/list',{},{actor:'boot'});assert.equal(res.status,403);
 res=await call('/api/admin/org-cases/list',{},{query:'?x=1'});assert.equal(res.status,400);
 res=await call('/api/admin/org-cases/nope',{});assert.equal(res.status,404);
 res=await call('/api/admin/org-cases/get',{org:ORG});assert.equal((await res.json()).case.process,c.id);
 res=await call('/api/admin/org-cases/challenge',{org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge'});assert.equal(res.status,200);assert.equal((await res.json()).passkey,true);
 res=await call('/api/admin/org-cases/decide',{org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',passkeyResponse:{id:'passkey',ok:true}});assert.equal(res.status,200);assert.equal((await res.json()).outcome,'recorded');
 await assert.rejects(call('/api/admin/org-cases/decide',{org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge',passkeyResponse:{id:'wrong',ok:false}}),e=>e.code==='unauthorized','a failed passkey assertion decides nothing');
 res=await call('/api/admin/org-cases/audit',{});assert.ok((await res.json()).entries.length>=2);
}finally{await w.close();}});
