// Organization billing standing, the lapse claim and ownership transfer at the ngin engine level (packages/orgs/
// ownership.mjs), against the real OrganizationBilling over an offline Polar model (tests/helpers/org-polar.mjs).
// Seeded chaos: transfer vs. removal vs. deletion vs. billing lapse vs. webhook replay. Rerun one seed with CHAOS_SEED=N.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../packages/app/engine.mjs';
import {memoryAudit} from '../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../packages/app/memory-providers.mjs';
import {OwnershipService,OWNERSHIP,billingStanding,organizationEntitlementPort} from '../packages/orgs/ownership.mjs';
import {ORG_RECORD} from '../packages/orgs/organizations.mjs';
import {principalKey,memberPowers} from '../packages/orgs/grants.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS} from '../packages/app/domains/orgs.mjs';
import {OrganizationBilling} from '../packages/billing/organizations.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';
import {forEachSeed,createScheduler,injectFaults} from './helpers/chaos.mjs';

const ISS='https://3sln.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc',E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',DAY=86400000,REQUEST='test-request-00001';
const p=sub=>({iss:ISS,sub}),OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code||assert.fail(`expected ${code}, got ${e.code}: ${e.message}`));

async function world(seed=1,{allowlist='',configured=true,owner=A}={}){
 const metadata=new SqliteMetadata(':memory:'),clock=fakeClock(400*DAY),random=seededRandom(createRandom(seed)),flag={on:true};await metadata.put('owner',ORG);
 const polar=fakeOrgPolar({clock}),config=configured?ORG_POLAR_CONFIG:{...ORG_POLAR_CONFIG,POLAR_SERVER:'production'};
 const billing=new OrganizationBilling({config,client:polar.client,now:clock.now});
 const people=new Map([[A,{kind:'person',status:'active',handle:'alice'}],[B,{kind:'person',status:'active',handle:'bob'}],[C,{kind:'person',status:'active',handle:'carol'}],[E,{kind:'person',status:'active',handle:'erin'}]]);
 const indexed=[],rotations=[];
 const effects={rotateRecovery:async org=>{rotations.push(org);return {rotated:true};},index:async(person,input)=>{indexed.push({person,...input});return true;}};
 const service=new OwnershipService({metadata,clock,random,issuer:ISS,flags:{for:()=>({enabled:()=>flag.on})},plans:organizationEntitlementPort({allowlist,billing}),billing,accounts:{get:async sub=>people.get(sub)??null},effects});
 const engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 await perform(engine,new OPS['orgs.initialize']({actor:{kind:'system',owner:ORG},input:{request:REQUEST,creator:p(owner),name:'Acme',plan:{source:'polar',plan:'org-team'}}}));
 const verification=(extra={})=>({stepUpAt:clock.now(),enrolledAt:clock.now()-30*DAY,securityChangedAt:clock.now()-60*DAY,...extra});
 const act=(sub,extra={})=>({kind:'owner',owner:ORG,principal:p(sub),entity:{kind:'organization',id:ORG},powers:[],authTime:clock.now(),epoch:0,aep:0,verification:verification(),addedUnder:{kid:'identity-key-'+sub.slice(0,4),publicKey:{kty:'EC'},certificationKid:null,authentication:'same-host-session'},...extra});
 const run=(op,sub,input={},extra={})=>{const action=new OPS[op]({actor:sub==='system'?{kind:'system',owner:ORG}:act(sub,extra),input});return action instanceof AppQuery?read(engine,action):perform(engine,action);};
 const record=()=>metadata.get(ORG_RECORD),member=async sub=>(await record()).memberships[principalKey(p(sub))];
 const join=async(sub,grants=[])=>{const invite=await run('orgs.invite',owner,{invitee:p(sub),grants});await run('orgs.accept',sub,{invitation:invite.invitation});return member(sub);};
 const sync=()=>run('orgs.billing-sync','system'),tick=()=>run('orgs.ownership-tick','system'),drain=()=>run('orgs.ownership-drain','system');
 let events=0;const webhook=(id='auto_'+(++events),bodyHash='a'.repeat(64))=>run('orgs.billing-webhook','system',{id,bodyHash,type:'subscription.updated'});
 const ownerSub=configured?polar.subscribe({org:ORG,owner,purpose:'create',binding:REQUEST}):null;
 if(configured)await sync();
 /** Offer (owner), accept (recipient, with the digest the view discloses) and pay. Returns the transfer id. */
 const offer=async(to=B,handle=people.get(to).handle,input={})=>(await run('orgs.transfer-offer',(await record()).ownerOfRecord.sub,{recipient:to,handle,confirm:true,...input})).transfer.id;
 const accept=async(to=B)=>{const view=await run('orgs.ownership',to);const plan=view.offer.plans[0];const result=await run('orgs.transfer-accept',to,{transfer:view.offer.id,disclosure:plan.digest,confirm:true,...view.offer.choosePlan?{plan:plan.plan}:{}});return result;};
 const payLatest=(purpose='transfer')=>polar.pay(polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']===purpose).id);
 return {metadata,service,engine,clock,flag,polar,billing,people,indexed,rotations,act,run,record,member,join,sync,tick,drain,webhook,offer,accept,payLatest,ownerSub,verification,close:async()=>{await engine.dispose();metadata.close();}};
}

test('offer needs the owner of record, P18 tight verification, an active named person account and billing',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 await rejects(w.run('orgs.transfer-offer',A,{recipient:B,handle:'bob'}),'review_required');
 await rejects(w.run('orgs.transfer-offer',C,{recipient:B,handle:'bob',confirm:true}),'not_found');
 await rejects(w.run('orgs.transfer-offer',A,{recipient:B,handle:'bob',confirm:true},{verification:w.verification({enrolledAt:w.clock.now()-DAY})}),'tight_verification_required');
 await rejects(w.run('orgs.transfer-offer',A,{recipient:B,handle:'bob',confirm:true},{verification:w.verification({stepUpAt:w.clock.now()-10*60000})}),'tight_verification_required');
 await rejects(w.run('orgs.transfer-offer',A,{recipient:B,handle:'mallory',confirm:true}),'recipient_unavailable');
 w.people.set(E,{kind:'organization',status:'active',handle:'erin'});await rejects(w.run('orgs.transfer-offer',A,{recipient:E,handle:'erin',confirm:true}),'recipient_unavailable');
 w.people.set(E,{kind:'person',status:'suspended',handle:'erin'});await rejects(w.run('orgs.transfer-offer',A,{recipient:E,handle:'erin',confirm:true}),'recipient_unavailable');
 const id=await w.offer();const r=await w.record();assert.equal(r.transfer.state,'offered');assert.equal(r.transfer.notBefore,r.transfer.offeredAt+OWNERSHIP.TRANSFER_MIN_DELAY_MS);assert.equal(r.transfer.expiresAt,r.transfer.offeredAt+OWNERSHIP.OFFER_LAPSE_MS);assert.equal(r.transfer.blockableUntil,null);
 const notice=r.memberOutbox.find(e=>e.type==='ownership-offered');assert.equal(notice.recipientHandle,'bob');assert.deepEqual(notice.principals,[p(B)]);assert.ok(notice.recipients.includes((await w.member(C)).id));
 await rejects(w.offer(C,'carol'),'transfer_pending');
 assert.deepEqual((await w.run('orgs.ownership',C)).decisions,['object']);const view=await w.run('orgs.ownership',B);assert.equal(view.offer.id,id);assert.equal(view.offer.plans.length,1);assert.equal(view.offer.plans[0].plan,'org-team');assert.equal(view.transfer,undefined);
 await rejects(w.run('orgs.ownership',E),'not_found');
 await w.drain();assert.deepEqual(w.indexed.map(x=>[x.person,x.role]),[[B,'offer']]);
 }finally{await w.close();}});

test('a held owner, a pending deletion or no billing refuses an offer; a recent security change returns the admins’ block',async()=>{
 const w=await world();try{
  await w.service.observeAuthority(p(A),{aep:1});await rejects(w.offer(),'authority_held');
 }finally{await w.close();}
 const d=await world();try{await d.run('orgs.schedule-deletion',A,{});await rejects(d.offer(),'organization_deletion_pending');}finally{await d.close();}
 const n=await world(1,{configured:false,allowlist:A});try{await rejects(n.offer(),'billing_unavailable');}finally{await n.close();}
 const s=await world();try{
  await s.join(C,[{power:'admin'}]);s.clock.advance(3*DAY);
  const changed=s.clock.now()-5*DAY,id=(await s.run('orgs.transfer-offer',A,{recipient:B,handle:'bob',confirm:true},{verification:s.verification({securityChangedAt:changed})})).transfer.id;
  assert.equal((await s.record()).transfer.blockableUntil,changed+30*DAY);assert.deepEqual((await s.run('orgs.ownership',C)).decisions,['object','block']);
  await s.run('orgs.transfer-object',C,{transfer:id,reason:'Unexpected'});assert.equal((await s.record()).transfer.objections.length,1);
  await s.accept();s.payLatest();await s.webhook();assert.equal((await s.record()).transfer.state,'paid');
  await s.run('orgs.transfer-block',C,{transfer:id,reason:'Owner account changed'});const r=await s.record();assert.equal(r.transfer.state,'blocked');
  await s.drain();assert.equal(s.polar.effects.refunds.length,1);assert.equal((await s.record()).ownerOfRecord.sub,A);
  s.clock.advance(2*DAY);await s.tick();assert.equal((await s.record()).ownerOfRecord.sub,A);
 }finally{await s.close();}
});

test('transfer takes effect only on a verified payment, no earlier than 24 h, in one commit with every §12b.3a effect',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 // An elevated request that must pass to the new owner (§12b.2a item 9).
 const c=await w.member(C);const {request:q}=await w.run('orgs.member-grants',A,{membership:c.id,grants:[],reason:'Reduce'});await w.run('orgs.decide-grants',C,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',A,{request:q.id,decision:'elevate'});
 const id=await w.offer(B,'bob',{admin:true});
 await rejects(w.run('orgs.transfer-accept',B,{transfer:id,disclosure:'0'.repeat(64),confirm:true}),'disclosure_changed');
 await rejects(w.run('orgs.transfer-accept',B,{transfer:id,disclosure:'0'.repeat(64),confirm:true},{addedUnder:undefined}),'identity_provenance_required');
 const {checkout}=await w.accept();assert.match(checkout.url,/^https:\/\/sandbox\.polar\.sh\//);
 // A created checkout, or a redirect, never counts: no payment yet.
 await w.webhook();assert.equal((await w.record()).transfer.state,'offered');
 // A pending (uncaptured) payment does not count either.
 const pending=w.polar.pay(w.polar.checkoutBy(k=>k.metadata['3sln_me_org_purpose']==='transfer').id,{paid:false});await w.webhook();assert.equal((await w.record()).transfer.state,'offered');
 w.polar.orders.get(pending.order).status='paid';w.polar.orders.get(pending.order).paid=true;await w.webhook();
 let r=await w.record();assert.equal(r.transfer.state,'paid');assert.equal(r.transfer.payment.subscriptionId,pending.subscription);
 await rejects(w.run('orgs.transfer-withdraw',A,{transfer:id}),'transfer_not_withdrawable');
 await w.tick();assert.equal((await w.record()).ownerOfRecord.sub,A);
 w.clock.advance(DAY);await w.tick();r=await w.record();
 assert.equal(r.ownerOfRecord.sub,B);assert.equal(r.transfer.state,'effective');
 const b=r.memberships[principalKey(p(B))];assert.equal(b.state,'live');assert.deepEqual(memberPowers(b,w.clock.now()),[]);assert.equal(b.grants[0].notBefore,w.clock.now()+3*DAY);assert.equal(b.addedUnder.kid,'identity-key-bbbb');
 assert.equal(r.memberships[principalKey(p(A))].state,'live');assert.ok(r.memberships[principalKey(p(A))].grants.some(g=>g.power==='admin'));
 assert.equal(r.moveCoolingUntil,w.clock.now()+30*DAY);assert.equal(r.recovery.state,'rotation-pending');
 assert.equal(r.billing.handled[w.ownerSub.subscription],'revoke');assert.ok(r.memberOutbox.some(e=>e.type==='ownership-changed'));
 const audit=[...(await w.metadata.list({prefix:'org/audit/'})).values()].map(e=>e.action);assert.ok(audit.includes('organization-ownership-transferred'));
 await w.drain();assert.deepEqual(w.polar.effects.revoked,[w.ownerSub.subscription]);assert.equal(w.polar.effects.refunds.length,0);assert.deepEqual(w.rotations,[ORG]);
 assert.equal((await w.record()).recovery.state,'reissue-required');assert.ok(w.indexed.some(x=>x.person===A&&x.role==='member')&&w.indexed.some(x=>x.person===B&&x.role==='owned'));
 // The previous owner's subscription is gone and the new period stands alone (billing starts fresh).
 await w.sync();const standing=billingStanding(await w.record(),w.clock.now());assert.equal(standing.standing,'paid');assert.equal(standing.paidUntil,Date.parse(w.polar.subscriptions.get(pending.subscription).current_period_end));
 // The elevated request passed: the old owner can no longer decide it, the new owner can (tight verification).
 await rejects(w.run('orgs.decide-grants',A,{request:q.id,decision:'accept'}),'invalid_decision');
 await w.run('orgs.decide-grants',B,{request:q.id,decision:'accept'});assert.deepEqual((await w.member(C)).grants,[]);
 // The previous owner stays a member and can now leave; the new owner cannot.
 await rejects(w.run('orgs.leave',B),'owner_must_be_member');await rejects(w.run('orgs.leave',A),'last_admin');w.clock.advance(3*DAY);await w.run('orgs.leave',A);assert.equal((await w.member(A)).state,'ended');
 }finally{await w.close();}});

test('withdrawn, lapsed, declined and unbound payments are refunded in full exactly once; replays change nothing',async()=>{const w=await world();try{
 let id=await w.offer();await w.accept();await w.run('orgs.transfer-withdraw',A,{transfer:id});w.payLatest();
 await w.webhook('evt_1');await w.webhook('evt_1');await rejects(w.webhook('evt_1','b'.repeat(64)),'webhook_id_conflict');await w.webhook('evt_2');
 let r=await w.record();assert.equal(r.transfer.state,'withdrawn');assert.equal(r.ownershipOutbox.filter(e=>e.kind==='refund').length,1);
 await w.drain();await w.drain();await w.webhook('evt_3');await w.drain();assert.equal(w.polar.effects.refunds.length,1);
 id=await w.offer();await w.accept();w.clock.advance(15*DAY);await w.tick();assert.equal((await w.record()).transfer.state,'lapsed');w.payLatest();await w.webhook();await w.drain();assert.equal(w.polar.effects.refunds.length,2);
 id=await w.offer(C,'carol');await w.run('orgs.transfer-decline',C,{transfer:id});assert.equal((await w.record()).transfer.state,'declined');
 // A former owner's or stranger's renewal checkout (not the owner of record) is refunded too.
 const checkout=await w.billing.checkout(ORG,{owner:C,plan:'org-team',purpose:'renew',binding:'renew-x',returnPath:'/console?org_billing=x'});w.polar.pay(checkout.checkoutId);await w.webhook();await w.drain();assert.equal(w.polar.effects.refunds.length,3);
 r=await w.record();assert.equal(r.ownerOfRecord.sub,A);assert.equal(w.polar.effects.revoked.length,3);
 }finally{await w.close();}});

test('a failed effect after payment (recipient suspended, organization not active) refunds in full and changes nothing',async()=>{
 const w=await world();try{
  await w.offer();await w.accept();w.payLatest();await w.webhook();w.people.set(B,{kind:'person',status:'suspended',handle:'bob'});w.clock.advance(DAY);await w.tick();
  const r=await w.record();assert.equal(r.transfer.state,'failed');assert.equal(r.transfer.closedReason,'recipient-unavailable');assert.equal(r.ownerOfRecord.sub,A);await w.drain();assert.equal(w.polar.effects.refunds.length,1);
 }finally{await w.close();}
 const d=await world();try{
  await d.offer();await d.accept();d.payLatest();await d.webhook();
  await rejects(d.run('orgs.schedule-deletion',A,{}),'transfer_pending');
  // Even if the organization left 'active' by another route, the effect refuses and refunds.
  await d.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);r.state='deletion-due';await tx.put(ORG_RECORD,r);});d.clock.advance(DAY);await d.tick();
  const r=await d.record();assert.equal(r.transfer.closedReason,'organization-unavailable');assert.equal(r.ownerOfRecord.sub,A);
 }finally{await d.close();}
 const e=await world();try{const id=await e.offer();await e.run('orgs.schedule-deletion',A,{});const r=await e.record();assert.equal(r.transfer.state,'withdrawn');assert.equal(r.transfer.closedReason,'deletion');assert.equal(r.transfer.id,id);}finally{await e.close();}
});

test('billing lapse: grace, read-only without cutting severance, then a 72 h break-glass claim that the owner cancels by paying',async()=>{const w=await world();try{
 const c=await w.join(C,[{power:'admin'}]),e=await w.join(E,[{resource:'https://3sln.example/r/1',methods:{'https://contract.example/v1':['get']}}]);w.clock.advance(3*DAY);
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();let r=await w.record(),s=billingStanding(r,w.clock.now(),{configured:true});assert.equal(s.standing,'grace');
 w.clock.advance(OWNERSHIP.GRACE_MS);await w.tick();r=await w.record();s=billingStanding(r,w.clock.now(),{configured:true});assert.equal(s.standing,'read-only');
 await rejects(w.run('orgs.rename',A,{name:'Renamed'}),'organization_read_only');await rejects(w.run('orgs.invite',A,{grants:[]}),'organization_read_only');
 await rejects(w.run('orgs.member-grants',A,{membership:e.id,grants:[{resource:'https://3sln.example/r/2',methods:{'https://contract.example/v1':['get']}}]}),'organization_read_only');
 await w.run('orgs.member-grants',A,{membership:e.id,grants:[]});await w.run('orgs.remove-member',A,{membership:e.id,reason:'Offboarding'});assert.equal((await w.member(E)).state,'ended');
 await rejects(w.run('orgs.claim-start',C,{plan:'org-team',confirm:true}),'claim_unavailable');
 w.clock.advance(OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();assert.deepEqual((await w.run('orgs.ownership',C)).decisions,['claim']);
 await rejects(w.run('orgs.claim-start',A,{plan:'org-team',confirm:true}),'invalid_decision');
 // The owner may still offer a transfer while read-only, until a claim is pending.
 const {claim}=await w.run('orgs.claim-start',C,{plan:'org-business',confirm:true});w.payLatest('claim');await w.webhook();r=await w.record();assert.equal(r.billing.claim.state,'pending');assert.equal(r.billing.claim.notBefore,w.clock.now()+3*DAY);
 await rejects(w.offer(),'claim_pending');
 // The old owner cancels it by paying: the claimant is refunded in full.
 w.clock.advance(DAY);await w.run('orgs.billing-checkout',A,{plan:'org-team'});w.payLatest('renew');await w.webhook();r=await w.record();
 assert.equal(r.billing.claim.state,'closed');assert.equal(r.billing.claim.closedReason,'owner-paid');assert.equal(r.ownerOfRecord.sub,A);assert.equal(billingStanding(r,w.clock.now()).standing,'paid');
 await w.drain();assert.equal(w.polar.effects.refunds.length,1);assert.equal(claim.state,'awaiting-payment');
 await w.run('orgs.rename',A,{name:'Renamed'});
 }finally{await w.close();}});

test('an unanswered claim takes effect after 72 h; a transfer verified during the claim closes it instead',async()=>{
 const w=await world();try{
  await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
  await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});w.payLatest('claim');await w.webhook();w.clock.advance(3*DAY);await w.tick();
  const r=await w.record();assert.equal(r.ownerOfRecord.sub,C);assert.equal(r.billing.claim.state,'effective');assert.equal(r.recovery.state,'rotation-pending');assert.equal(r.moveCoolingUntil,w.clock.now()+30*DAY);assert.equal(billingStanding(r,w.clock.now()).standing,'paid');
  await w.drain();assert.deepEqual(w.rotations,[ORG]);assert.equal(w.polar.effects.refunds.length,0);
 }finally{await w.close();}
 const t=await world();try{
  await t.join(C,[{power:'admin'}]);t.clock.advance(3*DAY);const id=await t.offer();t.polar.lapse(t.ownerSub.subscription);await t.webhook();t.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await t.tick();
  assert.equal((await t.record()).transfer.state,'lapsed');const second=await t.offer();assert.notEqual(second,id);
  await t.run('orgs.claim-start',C,{plan:'org-team',confirm:true});t.payLatest('claim');await t.webhook();assert.equal((await t.record()).billing.claim.state,'pending');
  await t.accept();t.payLatest('transfer');await t.webhook();let r=await t.record();assert.equal(r.billing.claim.state,'closed');assert.equal(r.billing.claim.closedReason,'transfer-paid');assert.equal(billingStanding(r,t.clock.now()).standing,'paid');
  t.clock.advance(3*DAY);await t.tick();r=await t.record();assert.equal(r.ownerOfRecord.sub,B);await t.drain();assert.equal(t.polar.effects.refunds.length,1);
 }finally{await t.close();}
});

test('allowlist stays an operator override; creation payment is verified against the bound request only',async()=>{
 const w=await world(1,{allowlist:ORG});try{w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(60*DAY);await w.tick();assert.equal((await w.run('orgs.ownership',A)).billing.standing,'paid');await w.run('orgs.rename',A,{name:'Still paid'});}finally{await w.close();}
 const clock=fakeClock(400*DAY),polar=fakeOrgPolar({clock}),billing=new OrganizationBilling({config:ORG_POLAR_CONFIG,client:polar.client,now:clock.now}),port=organizationEntitlementPort({allowlist:'',billing});
 assert.equal(port.payable,true);assert.deepEqual(await port.check({creator:p(A)}),{paid:false,reason:'payment_required'});
 polar.subscribe({org:ORG,owner:B,purpose:'create',binding:REQUEST});assert.equal((await port.check({creator:p(A),org:ORG,request:REQUEST})).paid,false);
 polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'other-request-0001'});assert.equal((await port.check({creator:p(A),org:ORG,request:REQUEST})).paid,false);
 polar.subscribe({org:ORG,owner:A,purpose:'create',binding:REQUEST});const ok=await port.check({creator:p(A),org:ORG,request:REQUEST});assert.equal(ok.paid,true);assert.equal(ok.source,'polar');
 assert.equal((await organizationEntitlementPort({allowlist:A,billing:null}).check({creator:p(A)})).source,'allowlist');assert.equal(organizationEntitlementPort({allowlist:A,billing:null}).payable,false);
});

test('person placement: unpaid reservation, creation checkout and payment verification',async()=>{
 const metadata=new SqliteMetadata(':memory:'),clock=fakeClock(400*DAY),random=seededRandom(createRandom(3)),polar=fakeOrgPolar({clock});await metadata.put('owner',A);
 const billing=new OrganizationBilling({config:ORG_POLAR_CONFIG,client:polar.client,now:clock.now});
 const service=new OwnershipService({metadata,clock,random,issuer:ISS,flags:{for:()=>({enabled:()=>true})},plans:organizationEntitlementPort({allowlist:'',billing}),billing});
 const engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 const actor={kind:'owner',owner:A,principal:{iss:null,sub:A},entity:{kind:'person',id:A},powers:['owner'],authTime:clock.now(),epoch:0};
 try{
  const row=await perform(engine,new OPS['orgs.reserve']({actor,input:{request:REQUEST,name:'Acme',plan:'org-business'}}));assert.equal(row.payment.state,'required');assert.equal(row.plan.plan,'org-business');
  await rejects(perform(engine,new OPS['orgs.reserve']({actor,input:{request:'test-request-00002',name:'Acme',plan:'org-gold'}})),'invalid_plan');
  assert.equal((await perform(engine,new OPS['orgs.creation-payment']({actor,input:{request:REQUEST}}))).payment,'required');
  const {checkout}=await perform(engine,new OPS['orgs.creation-checkout']({actor,input:{request:REQUEST,plan:'org-business'}}));assert.match(checkout.url,/sandbox\.polar\.sh/);
  const again=await perform(engine,new OPS['orgs.creation-checkout']({actor,input:{request:REQUEST,plan:'org-business'}}));assert.equal(again.checkout.url,checkout.url);
  const session=polar.checkoutBy(()=>true);assert.equal(session.external_customer_id,row.org);assert.equal(session.metadata['3sln_me_org_owner'],A);assert.equal(session.metadata['3sln_me_org_binding'],REQUEST);
  polar.pay(session.id);const paid=await perform(engine,new OPS['orgs.creation-payment']({actor,input:{request:REQUEST}}));assert.equal(paid.payment,'verified');assert.deepEqual(paid.plan,{source:'polar',plan:'org-business'});
  const list=await read(engine,new OPS['orgs.list']({actor}));assert.equal(list.pending[0].payment,'verified');
 }finally{await engine.dispose();metadata.close();}
});

test('ownership index hints follow an ownership change on the person side',async()=>{
 const metadata=new SqliteMetadata(':memory:'),clock=fakeClock(400*DAY),random=seededRandom(createRandom(4));await metadata.put('owner',B);
 const service=new OwnershipService({metadata,clock,random,issuer:ISS,flags:{for:()=>({enabled:()=>true})}}),engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 const system={kind:'system',owner:B},actor={kind:'owner',owner:B,principal:{iss:null,sub:B},entity:{kind:'person',id:B},powers:['owner'],authTime:clock.now(),epoch:0};
 try{
  await perform(engine,new OPS['orgs.ownership-index']({actor:system,input:{org:ORG,role:'offer'}}));assert.deepEqual((await read(engine,new OPS['orgs.offers']({actor}))).offers.map(o=>o.id),[ORG]);
  await perform(engine,new OPS['orgs.ownership-index']({actor:system,input:{org:ORG,role:'owned',handle:'acme'}}));const c=await read(engine,new OPS['orgs.candidates']({actor}));assert.deepEqual(c.owned.map(o=>o.id),[ORG]);assert.deepEqual(c.offers,[]);
  await perform(engine,new OPS['orgs.ownership-index']({actor:system,input:{org:ORG,role:'member'}}));const d=await read(engine,new OPS['orgs.candidates']({actor}));assert.deepEqual(d.owned,[]);assert.deepEqual(d.joined.map(o=>o.id),[ORG]);
  await rejects(perform(engine,new OPS['orgs.ownership-index']({actor,input:{org:ORG,role:'owned'}})),'forbidden');
 }finally{await engine.dispose();metadata.close();}
});

// ---- seeded chaos -----------------------------------------------------------------------------------------------
/** Faults inside the SDK's nested services (injectFaults proxies one object's methods). */
const faulty=(client,rules,random)=>({...client,...Object.fromEntries(Object.entries(rules).map(([service,list])=>[service,injectFaults(client[service],list,{random})]))});
/** Invariants that must hold after any interleaving. */
async function invariants(w,label){
 const r=await w.record(),now=w.clock.now(),owner=r.memberships[principalKey(r.ownerOfRecord)];
 assert.equal(owner?.state,'live',`${label}: the owner of record is a live member`);
 const effective=[r.transfer,...r.transferHistory].filter(t=>t?.state==='effective');
 for(const t of effective){assert.ok(t.payment?.subscriptionId,`${label}: an effective transfer has a verified payment`);assert.ok(t.effectiveAt>=t.notBefore,`${label}: no effect before the 24 h minimum`);assert.notEqual(r.billing.handled[t.payment.subscriptionId],'refund',`${label}: the effective payment is never refunded`);}
 const refunds=w.polar.effects.refunds.map(x=>x.order);assert.equal(new Set(refunds).size,refunds.length,`${label}: no order is refunded twice`);
 for(const s of Object.values(r.billing.subscriptions))if(s.paid&&!s.refunded&&['transfer','claim'].includes(s.purpose)){const bound=effective.some(t=>t.payment.subscriptionId===s.id)||r.transfer?.payment?.subscriptionId===s.id&&r.transfer.state==='paid'||r.billing.claim?.payment?.subscriptionId===s.id&&['pending','effective'].includes(r.billing.claim.state);if(!bound)assert.equal(r.billing.handled[s.id],'refund',`${label}: an unbound payment is queued for a full refund`);}
 if(r.state!=='active')assert.ok(!(r.transfer?.state==='effective'&&r.transfer.effectiveAt>r.deletion.requestedAt),`${label}: no transfer takes effect after deletion is scheduled`);
 assert.ok(r.ownershipOutbox.filter(e=>e.kind==='refund').every((e,i,list)=>list.findIndex(x=>x.subscriptionId===e.subscriptionId)===i),`${label}: one refund effect per subscription`);
 return {r,now};
}
test('seeded chaos: transfer vs. removal vs. deletion vs. billing lapse vs. webhook replay',async()=>forEachSeed(16,async random=>{const w=await world(random.seed);try{
 await w.join(C,[{power:'admin'}]);await w.join(E);w.clock.advance(3*DAY);
 const scheduler=createScheduler(random),original=w.service.metadata;w.service.metadata=scheduler.wrap(original,'org-store');
 // At-least-once and partially failing provider effects: duplicated refunds and revokes, refunds that apply but report failure.
 w.billing.clientOverride=faulty(w.polar.client,{refunds:[{method:'create',when:0.3,mode:random.pick(['after','duplicate'])}],subscriptions:[{method:'revoke',when:0.3,mode:random.pick(['after','duplicate'])}]},random);
 const id=await w.offer(B,'bob',{admin:random.chance(0.5)});
 const tasks=[
  ()=>w.accept().then(()=>{w.payLatest();return w.webhook('evt_pay');}),
  ()=>w.webhook('evt_pay'),
  ()=>w.webhook('evt_replay'),
  ()=>random.chance(0.4)?w.run('orgs.transfer-withdraw',A,{transfer:id}):w.run('orgs.transfer-object',C,{transfer:id,reason:'Chaos'}),
  ()=>w.member(random.chance(0.5)?E:A).then(m=>w.run('orgs.remove-member',C,{membership:m.id,reason:'Offboarding'})),
  ()=>random.chance(0.3)?w.run('orgs.schedule-deletion',A,{}):w.tick(),
  ()=>{if(random.chance(0.5))w.polar.lapse(w.ownerSub.subscription,{status:random.pick(['past_due','canceled'])});return w.webhook('evt_lapse');},
  ()=>w.drain(),
 ];
 await scheduler.run(tasks);w.service.metadata=original;
 await invariants(w,'after race');
 // Settle: replay every webhook, advance past every timer, drain until quiet. Rules must converge and stay idempotent.
 for(const step of [0,DAY,DAY,3*DAY,15*DAY]){w.clock.advance(step);await w.webhook('evt_pay');await w.webhook('evt_settle_'+step);await w.tick();for(let i=0;i<4;i++)await w.drain();await invariants(w,'settle +'+step);}
 const {r}=await invariants(w,'final');
 const t=[r.transfer,...r.transferHistory].find(x=>x?.id===id);if(process.env.CHAOS_TRACE)console.log(JSON.stringify({seed:random.seed,transfer:t.state,reason:t.closedReason??null,state:r.state,refunds:w.polar.effects.refunds.length,standing:billingStanding(r,w.clock.now()).standing}));
 if(t.state==='effective'){assert.equal(r.ownerOfRecord.sub,B);assert.ok(w.polar.effects.revoked.includes(w.ownerSub.subscription)||w.polar.subscriptions.get(w.ownerSub.subscription).status==='canceled');assert.equal(r.recovery.state,'reissue-required');}
 else{assert.equal(r.ownerOfRecord.sub,A);if(t.payment)assert.ok(w.polar.effects.refunds.some(x=>x.subscription===t.payment.subscriptionId),'a closed paid transfer is refunded');}
 assert.equal(r.ownershipOutbox.filter(e=>!e.doneAt).length,0,'every effect completed');
 }finally{await w.close();}}));

test('seeded chaos: a refund or revoke that applies but reports failure is retried without a second refund',async()=>forEachSeed(8,async random=>{const w=await world(random.seed);try{
 const id=await w.offer();await w.accept();await w.run('orgs.transfer-withdraw',A,{transfer:id});w.payLatest();await w.webhook();
 w.billing.clientOverride=faulty(w.polar.client,{refunds:[{method:'create',when:1,mode:'after'}],subscriptions:[{method:'revoke',when:random.chance(0.5)?1:[],mode:'after'}],orders:[{method:'get',when:0.2,mode:'timeout'}]},random);
 for(let i=0;i<12;i++){w.clock.advance(OWNERSHIP.RETRY_MS*2**Math.min(i,9));await w.drain();}
 w.billing.clientOverride=w.polar.client;for(let i=0;i<3;i++){w.clock.advance(7*3600000);await w.drain();}
 assert.equal(w.polar.effects.refunds.length,1);const r=await w.record();assert.equal(r.ownershipOutbox.filter(e=>!e.doneAt).length,0);
 }finally{await w.close();}}));
