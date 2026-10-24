// ORG-12d independent review follow-ups (2026-10-24: 3 Medium, 7 Low). Each test fails when its fix is reverted
// (checked one revert at a time in a scratch copy). Engine level, the real admin service and production verifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {orgCasesWorld,OP1,OP2,OP3,ORG,A,B,C,E,DAY,KEY,p,rejects} from './helpers/org-cases-world.mjs';
import {OWNERSHIP} from '../packages/orgs/ownership.mjs';
import {supportCaseIndex} from '../packages/identity/operator-assertions.mjs';
import {AdminStorage,narrowAdminStore,NARROW} from '../packages/identity/admin-store.mjs';
import {organizationAdminPorts} from '../packages/runtime/admin-org-cases.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

async function held(w){await w.trackA();const c=await w.claim();await w.run('orgs.breakglass-object',E,{claim:c.id});await w.settle();const h=await w.claim();assert.equal(h.state,'held');return h;}
const patchPrincipal=async(w,id,patch)=>{const row=await w.store.get('principal/'+id),{revision,...value}=row;await w.store.commit({expect:{['principal/'+id]:revision},writes:{['principal/'+id]:{...value,...patch}}});};
async function escalatedLapse(w){
 await w.service.observeAuthority(p(A),{aep:1});const a=await w.member(A);
 await w.run('orgs.reconfirm',A,{membership:a.id,aep:1,decision:'notice'},{aep:1});await w.run('orgs.reconfirm',C,{membership:a.id,aep:1,decision:'object'});
 w.clock.advance(10*DAY);await w.sweep();w.polar.lapse(w.ownerSub.subscription);await w.webhook();
 w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});w.payLatest('claim');await w.webhook();w.clock.advance(3*DAY+1000);await w.sync();await w.settle();
 return (await w.summary()).billing.claim;
}
const orgAudits=async w=>[...(await w.metadata.list({prefix:'org/audit/'})).values()];

test('M1: a revoked or held operator never counts as one of the two; the writer re-checks the proposer at approval',async()=>{
 // The writer's own check (the proposer lost the capability with no admin-side cancellation at all).
 {const w=await orgCasesWorld(201);try{
  await held(w);assert.equal((await w.decide(OP1,'proceed')).outcome,'proposed');
  await patchPrincipal(w,OP1,{roles:['admin']});
  const v=await w.view(OP2);assert.equal(v.proposal.proposerActive,false,'the case view says the proposer is no longer active');
  assert.equal((await w.decide(OP2,'proceed')).outcome,'proposed','the approval becomes a new proposal');
  const c=await w.claim();assert.equal(c.state,'held');assert.equal(c.proposal.operator,OP2);
  assert.ok((await orgAudits(w)).some(a=>a.action==='organization-support-proposal-cancelled'&&a.operator===OP1&&a.reason==='proposer-inactive'));
  assert.equal((await w.decide(OP3,'proceed')).outcome,'approved');assert.deepEqual((await w.claim()).decision.pair,[OP2,OP3].sort());
 }finally{await w.close();}}
 // The admin service cancels on revoke (boot changes the roles) and on hold (boot suspends), with audit entries both sides.
 {const w=await orgCasesWorld(202);try{
  await held(w);await w.decide(OP1,'proceed');const boot=await w.boot();
  const target=await w.admin.principalFor(await w.repository.get(OP1));
  await w.admin.setRoles({owner:OP1,roles:['admin'],expectedRevision:target.revision},boot);
  assert.equal((await w.claim()).proposal,null,'revoking the capability cancelled the pending proposal');
  const admins=(await w.store.list('audit/',{limit:100})).map(r=>r.value);assert.ok(admins.some(e=>e.action==='org-case.proposal-cancel'&&e.after.operator===OP1&&e.after.reason==='revoked'&&e.after.cancelled===1));
  assert.ok((await orgAudits(w)).some(a=>a.action==='organization-support-proposal-cancelled'&&a.reason==='revoked'));
  await w.decide(OP2,'proceed');await w.admin.suspend({owner:OP2},boot);
  assert.equal((await w.claim()).proposal,null,'holding an operator cancelled their proposal');
  assert.ok((await orgAudits(w)).some(a=>a.action==='organization-support-proposal-cancelled'&&a.reason==='held'));
 }finally{await w.close();}}
 // Lapse claims follow the same rule at the writer.
 {const w=await orgCasesWorld(203);try{
  await escalatedLapse(w);await w.decide(OP1,'proceed',{kind:'lapse-claim'});await patchPrincipal(w,OP1,{hold:{at:w.clock.now()}});
  assert.equal((await w.view(OP2)).proposal.proposerActive,false);
  assert.equal((await w.decide(OP2,'proceed',{kind:'lapse-claim'})).outcome,'proposed');assert.equal((await w.summary()).billing.claim.operatorApprovedAt,undefined);
 }finally{await w.close();}}
});

test('M2: the kill switch never blocks upholding a contest (two operators still); reject stays gated',async()=>{const w=await orgCasesWorld(204);try{
 const c=await w.trackA();await w.reach(c.waitEndsAt);await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));await w.settle();
 w.flag.names.ORG_BREAK_GLASS_ENABLED=false;
 assert.deepEqual((await w.view(OP1)).allowed,['uphold']);await rejects(w.decide(OP1,'reject'),'not_found');
 assert.equal((await w.decide(OP1,'uphold')).outcome,'proposed');assert.equal((await w.summary()).ownerOfRecord.sub,B,'one operator never reinstates');
 assert.equal((await w.decide(OP2,'uphold')).outcome,'approved');assert.equal((await w.summary()).ownerOfRecord.sub,A);
}finally{await w.close();}});

test('M3/L2: reason text never reaches the organization; it stays in an admin-only notes row linked by digest',async()=>{const w=await orgCasesWorld(205);try{
 await escalatedLapse(w);const reason='Out-of-band: claimant ID check failed, owner reached by phone.';
 await w.decide(OP1,'proceed',{kind:'lapse-claim',reason});
 const orgText=JSON.stringify(await w.run('orgs.audit',C,{}))+JSON.stringify(await orgAudits(w))+JSON.stringify(await w.summary());
 assert.ok(!orgText.includes(reason),'the claimant (an org admin) cannot read the operator note');
 const intent=(await w.store.list('audit/',{limit:100})).map(r=>r.value).find(e=>e.action==='org-case.decide'&&e.phase==='intent');
 assert.match(intent.after.reasonDigest,/^[a-f0-9]{64}$/);assert.ok(orgText.includes(intent.after.reasonDigest),'the organization keeps the same digest');
 const note=await w.store.get('org-case-note/'+intent.after.reasonDigest);assert.equal(note.text,reason);assert.equal(note.operator,OP1);
 assert.ok(!JSON.stringify((await w.store.list('audit/',{limit:100})).map(r=>r.value)).includes(reason),'the hash-chained audit holds only the digest');
 const log=await w.auditLog(OP2);assert.equal(log.entries.find(e=>e.after?.reasonDigest===intent.after.reasonDigest).reason,reason,'operators read it in the operator audit');
 // Break-glass decisions forward only the digest as well.
 const x=await orgCasesWorld(206);try{await held(x);await x.decide(OP1,'abort',{reason:'Spoke to the owner by phone; channel compromised.'});assert.equal(x.port.calls.at(-1).input.reason,undefined);assert.match(x.port.calls.at(-1).input.reasonDigest,/^[a-f0-9]{64}$/);}finally{await x.close();}
}finally{await w.close();}});

test('L1: lapse reasons are capped at 280 before anything is spent; the writer validates a note before the assertion',async()=>{const w=await orgCasesWorld(207);try{
 const claim=await escalatedLapse(w),before=await w.admin.decisionsLeft(OP1);
 await rejects(w.decide(OP1,'close',{kind:'lapse-claim',reason:'x'.repeat(281)}),'invalid_reason');
 assert.equal(await w.admin.decisionsLeft(OP1),before,'no decision spent');assert.equal(w.port.calls.length,0,'nothing issued');
 // Writer: a bad note is refused before verifyOperator, so a registry-valid assertion stays unused.
 const prepared=await w.admin.operatorSigner().prepare({operator:OP1,scope:{org:ORG,kind:'lapse-claim',process:claim.id,decision:'close',exclude:[]}});await w.store.commit({writes:{['operator-assertion/'+prepared.jti]:prepared.record}});
 await rejects(w.run('orgs.claim-resolve','system',{claim:claim.id,decision:'close',operator:OP1,note:'y'.repeat(300),assertion:prepared.assertion}),'invalid_reason');
 assert.equal((await w.store.get('operator-assertion/'+prepared.jti)).state,'issued');
}finally{await w.close();}});

test('L3: closed cases leave the queue store (only the sequence is kept), so they never fill a page',async()=>{const w=await orgCasesWorld(208);try{
 await held(w);const idx=supportCaseIndex({store:w.store,clock:w.clock.now});
 for(let i=0;i<60;i++){const org='0'+String(i).padStart(7,'0')+'-0000-4000-8000-000000000000';await idx.apply(org,{kind:'break-glass',process:crypto.randomUUID(),state:'held',seq:1});await idx.apply(org,{state:null,seq:2});
  assert.equal(await w.store.get('org-case/'+org),null);assert.equal((await w.store.get('org-case-seq/'+org)).seq,2);}
 const page=await w.list(OP1);assert.deepEqual(page.cases.map(x=>x.org),[ORG]);assert.equal(page.next,null);
 const org0='00000000-0000-4000-8000-000000000000';assert.equal((await idx.apply(org0,{kind:'break-glass',process:crypto.randomUUID(),state:'held',seq:1})).stale,true,'a late effect never resurrects a closed case');
}finally{await w.close();}});

test('L4: retiring the signing key rotates to a new one under compare-and-swap (audited); decisions keep working',async()=>{const w=await orgCasesWorld(209);try{
 await held(w);await w.decide(OP1,'acknowledge');const old=await w.store.get('operator-signer'),k=await w.store.get('operator-key/'+old.kid),{revision,...value}=k;
 await w.store.commit({expect:{['operator-key/'+old.kid]:revision},writes:{['operator-key/'+old.kid]:{...value,retiredAt:w.clock.now()}}});
 const left=await w.admin.decisionsLeft(OP2);assert.equal((await w.decide(OP2,'note')).outcome,'recorded');assert.equal(await w.admin.decisionsLeft(OP2),left-1);
 const now=await w.store.get('operator-signer');assert.notEqual(now.kid,old.kid);assert.equal((await w.store.get('operator-key/'+now.kid)).retiredAt,null);
 assert.ok((await w.auditLog(OP1)).entries.some(e=>e.action==='operator-key.rotate'&&e.target===now.kid));
}finally{await w.close();}});

test('L5: account objects get only the narrow admin-store client, bound to the calling organization',async()=>{
 const db=new SqliteMetadata(':memory:'),store=new AdminStorage(db);try{
  const calls=[],client=narrowAdminStore((method,args)=>{calls.push(method);return store.invoke(method,args);},async()=>ORG);
  assert.deepEqual(Object.keys(client).sort(),[...NARROW].sort(),'no get, list or commit');
  assert.deepEqual(await client.applySupportCase('99999999-9999-4999-8999-999999999999',{kind:'break-glass',process:crypto.randomUUID(),state:'held',seq:1}),{ok:false,refused:'org_mismatch'});assert.equal(calls.length,0);
  assert.deepEqual(await client.applySupportCase(ORG,{kind:'break-glass',process:crypto.randomUUID(),state:'held',seq:1}),{ok:true});
  assert.deepEqual(await client.verifyOperatorAssertion({assertion:'oa1.x.y',operator:OP1,scope:{},at:1}),{ok:false});assert.equal(await client.operatorRegistered(OP1),false);
  const ports=organizationAdminPorts({narrow:client,config:{APP_ORIGIN:'https://3sln.example'}});
  assert.deepEqual(Object.keys(ports.ORGANIZATION_OPERATOR_ASSERTIONS).sort(),['registered','verify']);assert.deepEqual(Object.keys(ports.ORGANIZATION_SUPPORT_CASES),['apply']);
  await assert.rejects(store.invoke('delete',[]),/Unknown admin storage method/);
 }finally{db.close();}
});

test('L6: the signing key is sealed with its own purpose (AAD operator-signer/<kid>); other credentials keep the default',async()=>{const w=await orgCasesWorld(210);try{
 await held(w);await w.decide(OP1,'acknowledge');const row=await w.store.get('operator-signer');
 await assert.rejects(decryptSecret(row.sealed,KEY),'the default AAD cannot open it');
 assert.equal((await decryptSecret(row.sealed,KEY,'operator-signer/'+row.kid)).kty,'EC');
 await assert.rejects(decryptSecret(row.sealed,KEY,'operator-signer/'+crypto.randomUUID()),'another kid cannot open it');
 const plain=await encryptSecret({a:1},KEY);assert.deepEqual(await decryptSecret(plain,KEY),{a:1},'default sealing is unchanged');
}finally{await w.close();}});

test('L7: the passkey challenge is bound to one decision; another decision, a missing or a reused challenge is refused',async()=>{const w=await orgCasesWorld(211);try{
 const c=await held(w);
 await rejects(w.decide(OP1,'abort',{},{bind:{decision:'acknowledge'}}),'step_up_required');
 await rejects(w.decide(OP1,'acknowledge',{},{bind:{process:crypto.randomUUID()}}),'step_up_required');
 assert.equal((await w.claim()).state,'held');assert.equal(w.port.calls.length,0);
 // A plain console step-up (no bound challenge) is not enough, and a bound challenge is consumed by its decision.
 await w.stepUp(OP1);const {adminOperatorPasskeyContext,DecideOrgCase}=await import('../packages/identity/admin.mjs');
 const {perform}=await import('../packages/app/engine.mjs'),ctx=w.contexts.get(OP1);
 const input={org:ORG,kind:'break-glass',process:c.id,decision:'acknowledge'};
 await rejects(perform(w.adminEngine,new DecideOrgCase({actor:{kind:'admin-http',context:adminOperatorPasskeyContext(w.admin,ctx,'local-challenge')},input})),'step_up_required');
 // The bound challenge for THIS decision, but the passkey answered a different (plain console) challenge.
 await w.challenge(OP1,input);await w.identity.stepUpBegin({},ctx);const other=await w.admin.pendingStepUpChallenge(ctx);await w.identity.stepUp({method:'passkey',response:{id:'passkey',ok:true}},ctx);
 await rejects(perform(w.adminEngine,new DecideOrgCase({actor:{kind:'admin-http',context:adminOperatorPasskeyContext(w.admin,ctx,other)},input})),'step_up_required');
 assert.equal((await w.decide(OP1,'acknowledge')).outcome,'recorded');assert.equal(await w.store.get('operator-challenge/'+OP1),null,'consumed');
 await rejects(perform(w.adminEngine,new DecideOrgCase({actor:{kind:'admin-http',context:adminOperatorPasskeyContext(w.admin,ctx,'local-challenge')},input})),'step_up_required');
}finally{await w.close();}});
