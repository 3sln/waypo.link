// ORG-12a/12c break-glass at the ngin engine level (packages/orgs/break-glass.mjs; design §12d.5 every transition and
// timer, §12d.6 billing, §12d.8 limits and operators), against the real OrganizationBilling over the offline Polar model.
// Each security property has a test that fails if its guard is removed. Loopback fixtures: local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bgWorld,rejects,A,B,C,E,DAY,ORG,p,OP1,OP2,OP3,OP4} from './helpers/break-glass-world.mjs';
import {uuid} from './helpers/org-world.mjs';
import {BREAK_GLASS,BREAK_GLASS_TRANSITIONS,breakGlassTransition,breakGlassDisclosureDigest,ledgerDecision,BreakGlassService} from '../packages/orgs/break-glass.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {OWNERSHIP} from '../packages/orgs/ownership.mjs';
import {organizationProcessingFee} from '../packages/billing/organizations.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {fakeClock,seededRandom,createRandom} from '../packages/app/memory-providers.mjs';

const H=3600000,FOREIGN='https://other.example';
const events=c=>c.log.map(x=>x.event);
async function waiting(w){await w.trackA();const c=await w.claim();assert.equal(c.state,'waiting');return c;}
async function held(w){const c=await waiting(w);await w.run('orgs.breakglass-object',E,{claim:c.id});const h=await w.claim();assert.equal(h.state,'held');return h;}
async function final(w,input={}){const c=await held(w);await w.proceed(OP1,OP2,input);const f=await w.claim();assert.equal(f.state,'final');return f;}
/** A foreign admin (homed elsewhere) written straight into the roster: only certificates admit them in production. */
async function foreignAdmin(w,sub){const principal={iss:FOREIGN,sub},key=principalKey(principal),id='f'+sub.replaceAll('-','').slice(0,20);
 await w.metadata.put('org/member/'+key,{id,principal,state:'live',generation:1,grants:[{power:'admin',grantedBy:p(A),grantedAt:w.clock.now()-90*DAY,notBefore:w.clock.now()-80*DAY}],aep:0,addedUnder:null,createdAt:w.clock.now()-90*DAY});
 await w.metadata.put('org/member-id/'+id,key);await w.metadata.put('org/admin/'+key,id);return {principal:{iss:FOREIGN,sub}};}

test('the transition table: every row of §12d.5, terminal states never move, and the function is pure',()=>{
 const rows=new Set(Object.values(BREAK_GLASS_TRANSITIONS).map(x=>x.t));
 for(const t of ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','T14','T15','T16','T17','T18','T19','T20','T21','T22','T23','T24/T25','T27'])assert.ok(rows.has(t),t);
 const c={id:'x',state:'waiting',track:'A',log:[]},frozen=structuredClone(c);
 const h=breakGlassTransition(c,'object',1);assert.equal(h.state,'held');assert.deepEqual(c,frozen,'pure');assert.deepEqual(h.log.at(-1),{event:'object',t:'T8',from:'waiting',to:'held',at:1});
 assert.equal(breakGlassTransition({state:'gathering',track:'S',log:[]},'paid',1).state,'held');assert.equal(breakGlassTransition({state:'gathering',track:'A',log:[]},'paid',1).state,'waiting');
 for(const terminal of ['effective','aborted','withdrawn','closed'])for(const event of ['abort','withdraw','effect','proceed','paid','liveness'])assert.throws(()=>breakGlassTransition({state:terminal,log:[]},event,1),e=>e.code==='invalid_transition');
 assert.throws(()=>breakGlassTransition({state:'held',log:[]},'effect',1),e=>e.code==='invalid_transition','I9: a held claim never takes effect');
 assert.throws(()=>breakGlassTransition({state:'waiting',log:[]},'proceed',1),e=>e.code==='invalid_transition');
 const closed=breakGlassTransition({state:'held',log:[]},'expire',5,{reason:'expired'});assert.equal(closed.closedReason,'expired');assert.equal(closed.closedAt,5);
});

test('T1: eligibility, one claim at a time, notices to every owner channel, and uniform not_found with the flag off or for non-members',async()=>{const w=await bgWorld();try{
 w.flag.names.ORG_BREAK_GLASS_ENABLED=false;await rejects(w.start(),'not_found');await rejects(w.run('orgs.breakglass',B),'not_found');
 w.flag.names.ORG_BREAK_GLASS_ENABLED=true;w.flag.names.ORGANIZATIONS_ENABLED=false;await rejects(w.start(),'not_found','the flag requires organizations');delete w.flag.names.ORGANIZATIONS_ENABLED;
 await rejects(w.start(uuid(77),uuid(77)),'not_found');await rejects(w.run('orgs.breakglass',uuid(77)),'not_found');
 await rejects(w.start(A,B),'invalid_decision');
 const D=uuid(5);await w.join(D,[{power:'admin'}]);w.clock.advance(4*DAY);await rejects(w.start(D),'not_found','an admin of less than 30 days cannot start');
 await rejects(w.start(B,D),'candidate_ineligible','a candidate needs 30 days of admin tenure');
 const M=uuid(6);await w.join(M);w.clock.advance(100*DAY);await w.sync();await rejects(w.start(M),'not_found','a plain member cannot start while admins are effective');
 await rejects(w.start(B,B,{candidate:{iss:FOREIGN,sub:C}}),'candidate_ineligible','a foreign candidate is refused');
 await rejects(w.start(B,B,{statement:'x'.repeat(2001)}),'invalid_statement');await rejects(w.start(B,B,{category:'boredom'}),'invalid_request');await rejects(w.start(B,B,{confirm:false}),'review_required');
 const out=await w.start();assert.equal(out.claim.state,'gathering');assert.equal(out.claim.track,undefined,'admins never see the track');
 const c=await w.claim();assert.equal(c.track,'A');assert.deepEqual(c.causes,[]);assert.deepEqual(events(c),['start','accept']);
 assert.equal(c.channels.length,4);assert.ok(c.channels.every(ch=>!JSON.stringify(ch).includes('example')),'addresses never stored');
 const row=(await w.summary()).ownershipOutbox.find(e=>e.kind==='owner-notice'&&e.event==='start');
 assert.deepEqual(row.channels.map(x=>x.kind).sort(),['credential','email','push','session'],'I6: every recorded channel at T1');
 assert.equal(row.channels.filter(x=>x.abort).length,2,'abort links go to email and push');assert.equal(c.tokens.length,2);assert.ok(c.tokens.every(t=>/^[a-f0-9]{64}$/.test(t.hash)&&!('raw' in t)));
 const audit=(await w.audits()).find(e=>e.action==='organization-break-glass-start');assert.equal(audit.statementDigest,c.statementDigest);assert.ok(!JSON.stringify(audit).includes('not answered'),'the audit never carries the statement');
 await rejects(w.start(C),'break_glass_pending');
 await w.settle();assert.equal(w.ownerChannels.sent.filter(n=>n.event==='start').length,4);assert.ok((await w.summary()).ownershipOutbox.find(e=>e.kind==='owner-notice').channels.every(ch=>!('abort' in ch)),'raw abort tokens are erased once delivered (review L1)');
}finally{await w.close();}});

test('T1: member-initiated claims exist only when no admin is effective, and are always Track S',async()=>{const w=await bgWorld(2,{admins:[]});try{
 const M=uuid(9);await w.join(M);w.clock.advance(91*DAY);await w.sync();
 await rejects(w.start(M,B),'not_found','a member is both initiator and candidate');
 await w.start(M);const c=await w.claim();assert.equal(c.memberInitiated,true);assert.equal(c.track,'S');assert.ok(c.causes.includes('member-initiated'));assert.equal(c.quorumRequired,false);
}finally{await w.close();}});

test('T1 Track S triggers: one admin, no out-of-band channel, an admin-domain email, a recent interactive owner sign-in, a deleted owner',async()=>{
 {const w=await bgWorld(3,{admins:[B]});try{await w.start();assert.deepEqual((await w.claim()).causes,['single-admin']);}finally{await w.close();}}
 {const w=await bgWorld(4);try{w.ownerChannels.owners.get(A).channels=w.ownerChannels.owners.get(A).channels.filter(x=>!['email','push'].includes(x.kind));await w.start();assert.ok((await w.claim()).causes.includes('no-out-of-band-channel'));}finally{await w.close();}}
 {const w=await bgWorld(5);try{const o=w.ownerChannels.owners.get(A);o.channels=o.channels.filter(x=>x.kind!=='push');o.channels[0].domain='acme.example';w.ownerChannels.domainMap.set(ORG,['acme.example']);
  await w.start();assert.ok((await w.claim()).causes.includes('no-out-of-band-channel'),'BG-R1-H2: an email on the organization’s domain is not out of band');}finally{await w.close();}}
 {const w=await bgWorld(6);try{const o=w.ownerChannels.owners.get(A);o.channels=o.channels.filter(x=>x.kind!=='push');o.channels[0].domain='carol.example';w.ownerChannels.domainMap.set(C,['carol.example']);
  await w.start();assert.equal((await w.claim()).track,'A');await w.cosign(C);assert.equal((await w.claim()).track,'S','a co-signer’s domain stops counting as out of band');}finally{await w.close();}}
 {const w=await bgWorld(7);try{w.ownerChannels.owners.get(A).lastInteractiveAt=w.clock.now()-5*DAY;await w.start();assert.ok((await w.claim()).causes.includes('recent-owner-sign-in'));}finally{await w.close();}}
 {const w=await bgWorld(8);try{w.ownerChannels.owners.get(A).status='deleted';await w.start();assert.ok((await w.claim()).causes.includes('owner-account'));}finally{await w.close();}}
});

test('T2: the candidate accepts with P18 items 1–2; a recent security change or a young credential is refused',async()=>{const w=await bgWorld();try{
 await rejects(w.start(B,B,{},{verification:w.verification({securityChangedAt:w.clock.now()-10*DAY})}),'candidate_ineligible');
 await w.start(B,C);let c=await w.claim();assert.equal(c.candidacy,null);
 await rejects(w.accept(B),'not_found','only the candidate accepts');
 await rejects(w.accept(C,{verification:w.verification({securityChangedAt:w.clock.now()-10*DAY})}),'candidate_ineligible');
 await rejects(w.accept(C,{verification:w.verification({enrolledAt:w.clock.now()-DAY})}),'tight_verification_required');
 await w.accept(C);c=await w.claim();assert.ok(c.candidacy);assert.ok(c.quorumAt,'initiator and candidate are a quorum of two');
}finally{await w.close();}});

test('T3: co-signatures from eligible admins only; foreign and young admins refused; withdrawal and the daily budget',async()=>{const w=await bgWorld();try{
 const F=uuid(31);await foreignAdmin(w,F);
 await w.start();
 await rejects(w.cosign(F,{principal:{iss:FOREIGN,sub:F}}),'not_found','a foreign admin cannot co-sign in v1');
 const D=uuid(32);await w.join(D,[{power:'admin'}]);w.clock.advance(4*DAY);await rejects(w.cosign(D),'not_found','tenure');
 await rejects(w.cosign(B),'not_found','the initiator is already a signer');
 await w.cosign(C);let c=await w.claim();assert.equal(c.cosigners.length,1);assert.ok(c.quorumAt);
 await w.run('orgs.breakglass-uncosign',C,{claim:c.id});c=await w.claim();assert.equal(c.cosigners.length,0);assert.equal(c.quorumAt,null,'quorum lost before payment');
 for(let i=0;i<4;i++){await w.cosign(C);await w.run('orgs.breakglass-uncosign',C,{claim:c.id});}
 await rejects(w.cosign(C),'cosign_limit','10 co-signature changes per admin per day');
 w.clock.advance(DAY);await w.cosign(C);
}finally{await w.close();}});

test('T4: payment needs quorum, candidacy, the disclosure digest, P18 and the flag; the checkout is the candidate’s, purpose break-glass',async()=>{const w=await bgWorld();try{
 await w.start();const c=await w.claim(),r=await w.summary();
 const view=await w.run('orgs.breakglass',B);assert.ok(!view.claim.decisions.includes('pay'),'no quorum yet');
 const plans=await w.billing.plans('usd'),plan=plans.plans.find(x=>x.id==='org-team'),digest=await breakGlassDisclosureDigest(r,c,{plan:'org-team',currency:'usd',amount:plan.price.amount});
 await rejects(w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:digest,confirm:true}),'quorum_required');
 await w.cosign(C);
 await rejects(w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:'0'.repeat(64),confirm:true}),'disclosure_changed');
 await rejects(w.run('orgs.breakglass-checkout',C,{claim:c.id,disclosure:digest,confirm:true}),'not_found','only the candidate pays');
 await rejects(w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:digest,confirm:true},{verification:w.verification({securityChangedAt:w.clock.now()-DAY})}),'candidate_ineligible','P18 rechecked at checkout');
 w.flag.names.ORG_BREAK_GLASS_ENABLED=false;await rejects(w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:digest,confirm:true}),'not_found');w.flag.names.ORG_BREAK_GLASS_ENABLED=true;
 await w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:digest,confirm:true});
 const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_purpose']==='break-glass');assert.equal(k.metadata['3sln_me_org_binding'],c.id);assert.equal(k.metadata['3sln_me_org_owner'],B);
 const again=await w.run('orgs.breakglass-checkout',B,{claim:c.id,disclosure:digest,confirm:true});assert.equal(again.checkout.url,k.url,'an open checkout is reused');
}finally{await w.close();}});

test('T5/§12d.6: a verified payment starts the wait; it confers nothing; a payment bound to a closed claim is refunded in full',async()=>{const w=await bgWorld();try{
 await w.start();await w.cosign(C);await w.checkout(B);const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_purpose']==='break-glass');
 // Paid only after the claim was withdrawn: refunded in full as unbound (no processing fee kept).
 await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});const paid=w.polar.pay(k.id);await w.webhook();await w.settle();
 assert.equal((await w.claim()).state,'withdrawn');assert.equal(w.refundsOf(paid.subscription).reduce((n,x)=>n+x.amount,0),120000);
 w.clock.advance(DAY);await w.start(C);await w.cosign(E);const c0=await w.claim();await w.pay(C);const c=await w.claim();
 assert.equal(c.state,'waiting');assert.equal(c.waitEndsAt-c.paidAt,30*DAY);assert.ok(c.counted);
 const standing=(await w.run('orgs.ownership',A)).billing;assert.equal(standing.source,'polar');assert.equal((await w.summary()).ownerOfRecord.sub,A,'the claim’s subscription confers nothing');
 const s=(await w.summary()).billing.subscriptions[c.payment.subscriptionId];assert.equal(s.purpose,'break-glass');assert.equal((await w.summary()).billing.handled[s.id],'break-glass');
 assert.ok(c0.state==='gathering');
}finally{await w.close();}});

test('T5: a payment that arrives after the quorum fell short does not start the wait; it is refunded in full as unbound',async()=>{const w=await bgWorld();try{
 await w.start();await w.cosign(C);await w.checkout(B);const c=await w.claim();await w.run('orgs.breakglass-uncosign',C,{claim:c.id});
 const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_purpose']==='break-glass'),paid=w.polar.pay(k.id);await w.webhook();await w.settle();
 const x=await w.claim();assert.equal(x.state,'gathering');assert.equal(x.payment,null);assert.equal(w.refundsOf(paid.subscription).reduce((n,y)=>n+y.amount,0),120000);
}finally{await w.close();}});
test('T5: a Track S claim is held for support after payment, and waits 60 days',async()=>{const w=await bgWorld(9,{admins:[B]});try{
 await w.start();await w.pay(B);const c=await w.claim();assert.equal(c.state,'held');assert.equal(c.waitEndsAt-c.paidAt,60*DAY);assert.ok(c.held.enteredAt);
}finally{await w.close();}});

test('T6: 7 days without quorum and candidacy, or 7 days from quorum without payment, close the claim uncounted; boundaries hold',async()=>{const w=await bgWorld();try{
 await w.start(B,C);const c=await w.claim();w.clock.advance(7*DAY-1000);await w.sync();assert.equal((await w.claim()).state,'gathering');
 w.clock.advance(1000);await w.sync();let x=await w.claim();assert.equal(x.state,'closed');assert.equal(x.closedReason,'quorum-lapsed');assert.equal(x.counted,false);assert.equal((await w.summary()).breakGlassMarks.counted.length,0);
 await w.settle();w.clock.advance(DAY);await w.start(C);await w.cosign(E);const q=(await w.claim()).quorumAt;
 w.clock.advance(7*DAY-1000);await w.sync();assert.equal((await w.claim()).state,'gathering');
 w.clock.advance(1000);await w.sync();x=await w.claim();assert.equal(x.state,'closed');assert.equal(x.closedReason,'unpaid');assert.equal(x.counted,false);assert.ok(q);
 assert.ok(c.id!==x.id);
}finally{await w.close();}});

test('T7: reminders 7 and 21 days after the wait starts and 72 h before effect, each with fresh abort links',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.settle();const before=w.tokens().length;
 for(const at of [7*DAY,21*DAY,27*DAY]){w.clock.set(c.waitStartedAt+at-1000);await w.sync();const n=(await w.claim()).reminders.length;w.clock.set(c.waitStartedAt+at);await w.sync();assert.equal((await w.claim()).reminders.length,n+1,'reminder at '+at/DAY);}
 await w.settle();assert.equal(events(await w.claim()).filter(e=>e==='remind').length,3);assert.equal(w.tokens('remind').length+w.tokens('remind-72h').length,6,'two links per reminder');assert.equal(w.tokens('remind-72h').length,2);assert.ok(w.tokens().length>before);
}finally{await w.close();}});

test('T8: an admin objection holds a waiting claim for support, one way; foreign admins may object; admins never see the cause',async()=>{const w=await bgWorld();try{
 const F=uuid(41);await foreignAdmin(w,F);const c=await waiting(w);
 await rejects(w.run('orgs.breakglass-object',B,{claim:c.id}),'not_found','the initiator cannot object');
 await w.run('orgs.breakglass-object',F,{claim:c.id},{principal:{iss:FOREIGN,sub:F}});const h=await w.claim();
 assert.equal(h.state,'held');assert.equal(h.track,'S');assert.ok(h.causes.includes('admin-objection'));
 const view=await w.run('orgs.breakglass',C);assert.equal(view.claim.state,'held-for-support');assert.equal(view.claim.track,undefined);assert.ok(!JSON.stringify(view).includes('admin-objection'));
 await w.resolve(OP1,'acknowledge');w.clock.advance(40*DAY);await w.sync();assert.equal((await w.claim()).state,'held','a held claim never returns to Track A or takes effect');
}finally{await w.close();}});

test('T9: an interactive owner sign-in holds waiting and final claims; gathering becomes Track S; a session refresh is not liveness',async()=>{const w=await bgWorld();try{
 await w.start();await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'refresh',at:w.clock.now()});assert.equal((await w.claim()).track,'A','BG-R1-M2: refresh is not liveness');
 const out=await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});assert.deepEqual(out,{received:true});
 let c=await w.claim();assert.equal(c.state,'gathering');assert.equal(c.track,'S');
 await w.run('orgs.breakglass-withdraw',B,{claim:c.id});await w.settle();
 w.clock.advance(DAY);c=await waiting(w);await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'step-up',at:w.clock.now()});assert.equal((await w.claim()).state,'held');
}finally{await w.close();}});
test('T9: owner liveness voids a final decision',async()=>{const w=await bgWorld();try{
 await final(w);await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});const c=await w.claim();assert.equal(c.state,'held');assert.equal(c.decision,null);
}finally{await w.close();}});

test('T10: the owner aborts with tier 0 from a known session or an email link: refunded in full, counted, locked 30 days, then Track S for 180 days',async()=>{const w=await bgWorld();try{
 let c=await waiting(w);
 await rejects(w.run('orgs.breakglass-abort',A,{claim:c.id},{verification:{sessionCreatedAt:c.createdAt+1}}),'owner_proof_required','a session created after T1 is not a known channel');
 await rejects(w.run('orgs.breakglass-abort',B,{claim:c.id},w.tier0(c)),'not_found');
 const out=await w.abort();assert.equal(out.tier,0);c=await w.claim();assert.equal(c.state,'aborted');assert.equal(c.closedReason,'owner');
 await w.settle();assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,x)=>n+x.amount,0),120000,'refunded in full; the fee is absorbed');
 const marks=(await w.summary()).breakGlassMarks;assert.ok(marks.lockUntil>=w.clock.now()+30*DAY-1000);assert.ok(marks.trackSUntil>=w.clock.now()+179*DAY);
 await rejects(w.start(C),'break_glass_locked');w.clock.advance(31*DAY);await w.sync();await w.start(C);assert.ok((await w.claim()).causes.includes('recent-owner-abort'));
}finally{await w.close();}});
test('T10: an email abort link works once; used, unknown and malformed tokens get the identical answer',async()=>{const w=await bgWorld();try{
 await w.start();await w.settle();const [token]=w.tokens('start'),c=await w.claim();
 const forged=token.slice(0,-4)+'AAAA',unknown=`bg1.${c.id}.${uuid(1).replace(/^0000/,'0000')}.${'A'.repeat(43)}`;
 for(const t of [forged,unknown,'nonsense',`bg1.${uuid(2)}.${uuid(3)}.${'B'.repeat(43)}`])assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token:t}),{received:true});
 assert.equal((await w.claim()).state,'gathering','a forged or unknown token changes nothing');
 assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token}),{received:true});assert.equal((await w.claim()).state,'aborted');
 assert.deepEqual(await w.run('orgs.breakglass-abort-token','system',{token}),{received:true},'replay: identical answer');
 assert.equal((await w.claim()).tokens.filter(t=>t.usedAt).length,1);
}finally{await w.close();}});
test('T10: a held owner may abort with tier 0 (BG-9)',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.run('orgs.observe-authority','system',{principal:p(A),aep:1});assert.ok((await w.member(A)).hold);
 await w.run('orgs.breakglass-abort',A,{claim:c.id},{aep:1,...w.tier0(c)});assert.equal((await w.claim()).state,'aborted');
}finally{await w.close();}});

test('T11/T12/T22: two operators proceed with a final notice and fresh links; a tier-0 dispute returns it to support; tier 1 ends it and blocks support',async()=>{const w=await bgWorld();try{
 const h=await held(w);
 assert.deepEqual(await w.resolve(OP1,'proceed'),{decision:'proposed'});w.clock.advance(H);await w.sync();assert.equal((await w.claim()).state,'held','I8: one operator never reaches final');
 await rejects(w.resolve(OP1,'proceed'),'second_operator_required');
 const out=await w.resolve(OP2,'proceed');assert.equal(out.state,'final');let c=await w.claim();assert.deepEqual(c.decision.pair,[OP1,OP2].sort());assert.equal(c.finalEndsAt,w.clock.now()+7*DAY);
 await w.settle();assert.equal(w.tokens('proceed').length,2,'fresh links to every email and push channel');
 await w.abort();c=await w.claim();assert.equal(c.state,'held','T11: tier 0 after a decision is a dispute');assert.equal(c.decision,null);
 await w.proceed(OP1,OP2);c=await w.claim();assert.equal(c.state,'final','the same pair may decide again after a dispute from a channel not excluded');
 await w.abort(w.tier1(c));c=await w.claim();assert.equal(c.state,'aborted');assert.equal(c.closedReason,'owner-elevated');
 assert.ok((await w.summary()).breakGlassMarks.noProceedUntil>=w.clock.now()+30*DAY-1000);assert.ok(h.id===c.id);
}finally{await w.close();}});
test('T12: a credential enrolled less than 7 days before T1 is only tier 0, so in final it disputes instead of aborting',async()=>{const w=await bgWorld();try{
 const f=await final(w);await w.abort({verification:{stepUpAt:w.clock.now(),enrolledAt:f.createdAt-DAY,securityChangedAt:f.createdAt-90*DAY}});
 const c=await w.claim();assert.equal(c.state,'held');assert.equal(c.tier1At,null);
}finally{await w.close();}});
test('T22: exclusions name only channels that disputed; the owner’s last channel can never be excluded',async()=>{const w=await bgWorld();try{
 await held(w);const c=await w.claim(),push=c.channels.find(x=>x.kind==='push').id;
 await w.resolve(OP1,'proceed',{exclude:[push]}).then(()=>assert.fail('allowed'),e=>assert.equal(e.code,'invalid_exclusion'));
}finally{await w.close();}});

test('T14: owner-interface actions abort a pending claim (a transfer offer, deletion, a decision, a reissue); a renewal does not',async()=>{
 {const w=await bgWorld(11);try{const c=await waiting(w);await w.offer(E);const x=await w.claim();assert.equal(x.state,'aborted');assert.equal(x.closedReason,'owner-active');assert.equal((await w.summary()).transfer.state,'offered');assert.ok(c);}finally{await w.close();}}
 {const w=await bgWorld(12);try{await waiting(w);await w.run('orgs.schedule-deletion',A,{});assert.equal((await w.claim()).closedReason,'owner-active');}finally{await w.close();}}
 {const w=await bgWorld(13);try{await waiting(w);await w.run('orgs.recovery-reissue-begin',A,{});assert.equal((await w.claim()).closedReason,'owner-active');}finally{await w.close();}}
 {const w=await bgWorld(14);try{
  const e=await w.member(E),q=(await w.run('orgs.member-grants',B,{membership:e.id,grants:[],reason:'Gone'})).request;await w.run('orgs.decide-grants',E,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',B,{request:q.id,decision:'elevate'});
  await waiting(w);await w.run('orgs.decide-grants',A,{request:q.id,decision:'reject'});assert.equal((await w.claim()).closedReason,'owner-active');}finally{await w.close();}}
 {const w=await bgWorld(15);try{
  const c=await waiting(w);w.polar.lapse(w.ownerSub.subscription);await w.webhook();await w.run('orgs.billing-checkout',A,{plan:'org-team'});w.payLatest('renew');await w.webhook();
  assert.equal((await w.claim()).state,'waiting','a renewal is not proof of presence (F-03)');assert.ok(c);}finally{await w.close();}}
});

test('T15/§12d.6: a voluntary withdrawal keeps the processing fee; owner, support and expiry endings refund in full; each exactly once',async()=>{const w=await bgWorld();try{
 let c=await waiting(w);await w.run('orgs.breakglass-withdraw',C,{claim:c.id}).then(()=>assert.fail('co-signer withdrew'),e=>assert.equal(e.code,'not_found'));
 await w.run('orgs.breakglass-withdraw',B,{claim:c.id});await w.settle();await w.settle();c=await w.claim();
 const fee=organizationProcessingFee(120000,'usd');assert.equal(fee,6050);
 assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,x)=>n+x.amount,0),120000-fee,'the processing fee is kept');
 const order=w.polar.orders.get(c.payment.orderId);assert.equal(order.refunded_amount,120000-fee);
 // A retried drain never refunds the fee.
 await w.billing.refundAll(ORG,{subscriptionId:c.payment.subscriptionId,retainProcessingFee:true});assert.equal(w.polar.orders.get(c.payment.orderId).refunded_amount,120000-fee);
 assert.equal((await w.claim()).state,'withdrawn');assert.ok(c.counted,'a paid claim counts');
}finally{await w.close();}});

test('T16: the candidate becoming ineligible closes the claim with a full refund; a withdrawn co-signature after payment too',async()=>{
 for(const [label,act] of [
  ['left',async w=>{await w.run('orgs.leave',B,{});}],
  ['authority reset',async w=>{await w.run('orgs.observe-authority','system',{principal:p(B),aep:1});}],
  ['security change hint',async w=>{await w.run('orgs.breakglass-security-change','system',{principal:p(B),at:w.clock.now()});}],
  ['account suspended',async w=>{w.people.set(B,{kind:'person',status:'suspended',handle:'bob'});}],
  ['security change at the account',async w=>{w.clock.advance(H);w.people.set(B,{kind:'person',status:'active',handle:'bob',securityChangedAt:w.clock.now()});}],
  ['co-signature withdrawn',async w=>{await w.run('orgs.breakglass-uncosign',C,{claim:(await w.claim()).id});}]
 ]){const w=await bgWorld(20);try{
  const c=await waiting(w);await act(w);await w.sync();const x=await w.claim();assert.equal(x.state,'closed',label);assert.ok(['ineligible','quorum-withdrawn','candidate-left'].includes(x.closedReason),label+': '+x.closedReason);
  // Review L5: the candidate leaving or a co-signer withdrawing ended it by choice, so the processing fee is kept.
  const voluntary=['left','co-signature withdrawn'].includes(label);
  await w.settle();assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,y)=>n+y.amount,0),voluntary?120000-6050:120000,label+': refund');assert.equal(x.refund.retainProcessingFee,voluntary,label);
 }finally{await w.close();}}
});

test('T17–T19: a file recovery freezes the claim, its cancellation resumes it (effect checked at once), and its effect supersedes it',async()=>{const w=await bgWorld();try{
 let c=await waiting(w);await rejects(w.run('orgs.breakglass-file-recovery','system',{event:'bogus'}),'invalid_request');
 await w.run('orgs.breakglass-file-recovery','system',{event:'started'});c=await w.claim();assert.equal(c.frozen,true);
 await w.reach(c.waitEndsAt+DAY);assert.equal((await w.claim()).state,'waiting','nothing takes effect while frozen');assert.equal((await w.claim()).lastBlocked.reason,'frozen');
 await w.run('orgs.breakglass-file-recovery','system',{event:'cancelled'});await w.settle();await w.sync();assert.equal((await w.claim()).state,'effective','the effect check runs once unfrozen');
}finally{await w.close();}
 {const w=await bgWorld(21);try{const c=await waiting(w);await w.run('orgs.breakglass-file-recovery','system',{event:'started'});await rejects(w.start(C),'break_glass_pending');
  await w.run('orgs.breakglass-file-recovery','system',{event:'effective'});const x=await w.claim();assert.equal(x.closedReason,'superseded');await w.settle();assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,y)=>n+y.amount,0),120000);
  await rejects(w.start(C),'break_glass_locked').catch(async()=>{/* not locked */});}finally{await w.close();}}
});

test('T20/T21/T23: operators acknowledge and abort alone; a held claim expires unacknowledged (30 d), undecided (60 d) or after 120 d in total, uncounted and unlocked',async()=>{
 {const w=await bgWorld(22);try{await held(w);assert.deepEqual(await w.resolve(OP1,'acknowledge'),{decision:'recorded'});const c=await w.claim();assert.ok(c.held.ackAt);
  await w.resolve(OP1,'abort');const x=await w.claim();assert.equal(x.closedReason,'support');assert.ok((await w.summary()).breakGlassMarks.lockUntil>w.clock.now());}finally{await w.close();}}
 {const w=await bgWorld(23);try{const h=await held(w);w.clock.set(h.held.enteredAt+30*DAY-1000);await w.sync();assert.equal((await w.claim()).state,'held');
  w.clock.set(h.held.enteredAt+30*DAY);await w.sync();const x=await w.claim();assert.equal(x.closedReason,'expired');assert.equal(x.counted,false,'BG-17: never counted');
  const s=await w.summary();assert.equal(s.breakGlassMarks.counted.length,0);assert.ok(!(s.breakGlassMarks.lockUntil>w.clock.now()),'no lock');assert.ok(w.alerts.some(a=>a.reason==='held-claim-expired'));
  await w.settle();assert.equal(w.refundsOf(x.payment.subscriptionId).reduce((n,y)=>n+y.amount,0),120000);await w.start(C);}finally{await w.close();}}
 {const w=await bgWorld(24);try{const h=await held(w);await w.resolve(OP1,'acknowledge');w.clock.set(h.held.enteredAt+60*DAY-1000);await w.sync();assert.equal((await w.claim()).state,'held');
  w.clock.set(h.held.enteredAt+60*DAY);await w.sync();assert.equal((await w.claim()).closedReason,'expired');}finally{await w.close();}}
 {const w=await bgWorld(25);try{const h=await held(w);await w.resolve(OP1,'acknowledge');
  // 50 days held, a decision, a dispute back to held (the clock restarts), 50 more: past the 120-day total.
  w.clock.set(h.held.enteredAt+50*DAY);await w.sync();await w.proceed();await w.abort();let c=await w.claim();assert.equal(c.state,'held');await w.resolve(OP1,'acknowledge');
  w.clock.advance(50*DAY);await w.sync();assert.equal((await w.claim()).state,'held');await w.proceed(OP3,OP4);await w.abort();c=await w.claim();await w.resolve(OP3,'acknowledge');
  w.clock.advance(21*DAY);await w.sync();assert.equal((await w.claim()).closedReason,'expired','at most 120 days held in total');}finally{await w.close();}}
});

test('T24/§12d.5 effect commit: owner, aep +1 once, rotation, former owner held and not removable, elevations, index, 90-day cooling and restrictions',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.reach(c.waitEndsAt-1000);assert.equal((await w.claim()).state,'waiting');
 await w.reach(c.waitEndsAt);const r=await w.summary(),x=await w.claim();
 assert.equal(x.state,'effective');assert.equal(r.ownerOfRecord.sub,B);assert.equal(r.authorityEpoch,1);assert.equal(r.recovery.state,'rotation-pending');assert.equal(r.moveCoolingUntil,w.clock.now()+90*DAY);
 const former=await w.member(A);assert.equal(former.state,'live');assert.equal(former.hold.cause,'break-glass');
 assert.equal(r.billing.handled[c.payment.subscriptionId],'owner');assert.equal(r.billing.handled[w.ownerSub.subscription],'revoke','the previous owner’s subscription is revoked, no automatic refund');
 await w.settle();assert.equal((await w.summary()).recovery.state,'missing');assert.ok(w.indexed.some(i=>i.person===B&&i.role==='owned'));assert.ok(w.polar.effects.revoked.includes(w.ownerSub.subscription));assert.equal(w.refundsOf(w.ownerSub.subscription).length,0);
 await w.sync();await w.sync();assert.equal((await w.summary()).authorityEpoch,1,'I3: exactly once');
 // Contest-window restrictions (BG-7, BG-R1-M3).
 await rejects(w.offer(E),'contest_window');await rejects(w.run('orgs.schedule-deletion',B,{}),'contest_window');
 await rejects(w.metadata.transaction(async tx=>{const r=await w.service.open(tx,[p(A)]);await w.service.end(r,r.memberships[principalKey(p(A))],{kind:'system'},'removed',w.clock.now(),tx);}),'contest_window');
 assert.ok(!(await w.run('orgs.ownership',B)).decisions.includes('offer'));
 const e=await w.member(E),q=(await w.run('orgs.member-grants',C,{membership:e.id,grants:[],reason:'Gone'})).request;await w.run('orgs.decide-grants',E,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',C,{request:q.id,decision:'elevate'});
 await rejects(w.run('orgs.decide-grants',B,{request:q.id,decision:'accept'}),'contest_window');
 w.clock.advance(90*DAY);await w.sync();assert.equal((await w.summary()).breakGlassContest.state,'closed');await w.run('orgs.decide-grants',B,{request:q.id,decision:'accept'});
}finally{await w.close();}});
test('T25/T26: Track S takes effect only after a decision, the 7-day final notice and 60 days; stale snapshots, billing holds and the flag hold it',async()=>{const w=await bgWorld();try{
 const f=await final(w);w.clock.set(f.finalEndsAt);await w.sync();assert.equal((await w.claim()).state,'final','the 60-day Track S wait has not passed');
 w.clock.set(f.paidAt+60*DAY);w.flag.names.ORG_BREAK_GLASS_ENABLED=false;await w.settle();await w.sync();let c=await w.claim();assert.equal(c.state,'final');assert.equal(c.lastBlocked.reason,'flag-off');
 w.flag.names.ORG_BREAK_GLASS_ENABLED=true;w.clock.advance(10*60000);await w.tick();c=await w.claim();assert.equal(c.state,'final');assert.equal(c.lastBlocked.reason,'stale-snapshot','the tick alone never changes the owner');
 const real=w.polar.client.subscriptions.get;w.polar.client.subscriptions.get=async id=>{if(id===c.payment.subscriptionId)throw Object.assign(Error('gone'),{statusCode:404});return real(id);};
 await w.sync();assert.equal((await w.claim()).lastBlocked.reason,'billing-held');assert.equal((await w.summary()).ownerOfRecord.sub,A);
 w.polar.client.subscriptions.get=real;await w.sync();assert.equal((await w.claim()).state,'effective');assert.equal((await w.summary()).ownerOfRecord.sub,B);
}finally{await w.close();}});

test('T27: the former owner contests with tier 1 within 90 days; two operators uphold (a reinstatement) or reject',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.reach(c.waitEndsAt);
 await rejects(w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier0(c)),'tight_verification_required');
 await rejects(w.run('orgs.breakglass-contest',C,{claim:c.id},w.tier1(c)),'not_found');
 assert.ok((await w.run('orgs.breakglass',A,{},{aep:0})).decisions.includes('contest'));
 await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));assert.equal((await w.summary()).breakGlassContest.state,'open');
 await rejects(w.resolve(B,'uphold'),'operator_conflict');
 assert.deepEqual(await w.resolve(OP1,'uphold'),{decision:'proposed'});assert.equal((await w.summary()).ownerOfRecord.sub,B,'one operator cannot reinstate');
 await rejects(w.resolve(OP1,'uphold'),'second_operator_required');
 await w.resolve(OP2,'uphold');const r=await w.summary();
 assert.equal(r.ownerOfRecord.sub,A);assert.equal(r.authorityEpoch,2,'raised again at reinstatement');assert.equal(r.recovery.state,'rotation-pending');assert.equal(r.breakGlassContest.state,'upheld');
 assert.equal((await w.member(B)).hold.cause,'reinstatement');assert.equal((await w.member(A)).hold,null);assert.equal(r.billing.handled[c.payment.subscriptionId],'revoke');
 const view=await w.run('orgs.ownership',A);assert.equal(view.billing.standing,'grace','a 14-day grace to set up billing');
}finally{await w.close();}
 {const w=await bgWorld(31);try{const c=await waiting(w);await w.reach(c.waitEndsAt);await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));await w.proceed(OP1,OP2).catch(()=>{});
  await w.resolve(OP1,'reject');await w.resolve(OP2,'reject');assert.equal((await w.summary()).breakGlassContest.state,'rejected');assert.equal((await w.summary()).ownerOfRecord.sub,B);
  w.clock.advance(91*DAY);await rejects(w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c)),'not_found');}finally{await w.close();}}
});

test('§12d.8 limits: 3 counted claims per organization a year; unpaid claims never count; per person one candidacy, 2 counted, 4 unpaid starts',async()=>{const w=await bgWorld();try{
 // Quota spam: unpaid starts withdrawn at once never count toward the organization's limit (BG-R1-H3).
 for(let i=0;i<4;i++){await w.start();await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});await w.settle();}
 await rejects(w.start(),'break_glass_start_limit');assert.equal((await w.summary()).breakGlassMarks.counted.length,0);
 // Three counted claims by different people, each withdrawn after payment (no lock).
 for(const [by,co] of [[C,E],[E,C]]){await w.start(by);await w.cosign(co);await w.pay(by);await w.run('orgs.breakglass-withdraw',by,{claim:(await w.claim()).id});await w.settle();}
 const F=uuid(51);await w.join(F,[{power:'admin'}]);w.clock.advance(31*DAY);await w.sync();await w.start(F);await w.cosign(C);await w.pay(F);await w.run('orgs.breakglass-withdraw',F,{claim:(await w.claim()).id});await w.settle();
 assert.equal((await w.summary()).breakGlassMarks.counted.length,3);await rejects(w.start(C),'break_glass_limit');
 w.clock.advance(366*DAY);await w.sync();await w.start(C);
}finally{await w.close();}});
test('§12d.8 per-person ledger: pure decision rules and the person-side operation',async()=>{
 const now=1000*DAY,row=(o)=>({org:uuid(1),claim:uuid(2),role:'initiator',state:'ended',startedAt:now-DAY,countedAt:null,...o});
 assert.equal(ledgerDecision([row({role:'candidate',state:'pending'})],{org:uuid(9),claim:uuid(8),role:'candidate'},now),'candidacy_pending');
 assert.equal(ledgerDecision([row({role:'candidate',state:'pending'})],{org:uuid(9),claim:uuid(8),role:'initiator'},now),null);
 assert.equal(ledgerDecision([row({countedAt:now-DAY,claim:uuid(3)}),row({countedAt:now-DAY,claim:uuid(4)})],{org:uuid(9),claim:uuid(8),role:'initiator'},now),'break_glass_person_limit');
 assert.equal(ledgerDecision([row({countedAt:now-400*DAY,claim:uuid(3)}),row({countedAt:now-DAY,claim:uuid(4)})],{org:uuid(9),claim:uuid(8),role:'initiator'},now),null,'older than a year');
 assert.equal(ledgerDecision([1,2,3,4].map(n=>row({claim:uuid(10+n)})),{org:uuid(9),claim:uuid(8),role:'initiator'},now),'break_glass_start_limit');
 const metadata=new SqliteMetadata(':memory:'),person=uuid(70);await metadata.put('owner',person);
 const service=new BreakGlassService({metadata,clock:fakeClock(now),random:seededRandom(createRandom(1)),flags:{for:()=>({enabled:()=>true})}}),actor={kind:'system',owner:person};
 assert.deepEqual(await service.breakGlassLedger(actor,{op:'reserve',org:uuid(1),claim:uuid(2),role:'candidate',at:now}),{ok:true});
 assert.deepEqual(await service.breakGlassLedger(actor,{op:'reserve',org:uuid(3),claim:uuid(4),role:'candidate',at:now}),{ok:false,reason:'candidacy_pending'},'one pending candidacy anywhere');
 await service.breakGlassLedger(actor,{op:'update',org:uuid(1),claim:uuid(2),event:'ended',at:now});
 assert.deepEqual(await service.breakGlassLedger(actor,{op:'reserve',org:uuid(3),claim:uuid(4),role:'candidate',at:now}),{ok:true});
 await rejects(service.breakGlassLedger({kind:'system',owner:uuid(71)},{op:'reserve',org:uuid(1),claim:uuid(5),role:'initiator',at:now}),'forbidden');
 await rejects(service.breakGlassLedger({kind:'owner',owner:person},{op:'reserve',org:uuid(1),claim:uuid(5),role:'initiator',at:now}),'forbidden');
 metadata.close();
});
test('§12d.8: a person may be the candidate in only one pending claim anywhere (cross-organization ledger)',async()=>{const w=await bgWorld();try{
 await w.claimLedger.reserve(B,{org:uuid(90),claim:uuid(91),role:'candidate',at:w.clock.now()});
 await rejects(w.start(),'candidacy_pending');await w.start(C);
 const c=await w.claim();assert.equal(w.claimLedger.people.get(C).get(ORG+'/'+c.id).state,'pending');
 await w.run('orgs.breakglass-withdraw',C,{claim:c.id});await w.settle();assert.equal(w.claimLedger.people.get(C).get(ORG+'/'+c.id).state,'ended');
}finally{await w.close();}});

test('shared owner-change commit: it refuses a changed owner, a stale snapshot, an unverified payment and the same owner',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);
 const attempt=async(mutate,opts={})=>w.metadata.transaction(async tx=>{const r=w.service.ensure(await w.service.open(tx));mutate?.(r);await w.service.changeOwner(r,p(B),c.payment,w.clock.now(),tx,{cause:'break-glass',id:c.id,expect:p(A),...opts});throw Object.assign(Error('rollback'),{code:'ok'});});
 await w.sync();
 await rejects(attempt(null,{expect:p(C)}),'owner_change_refused');
 await rejects(attempt(r=>{r.billing.reconciledAt=w.clock.now()-10*60000;}),'owner_change_refused');
 await rejects(attempt(r=>{r.billing.handled[c.payment.subscriptionId]='refund';}),'owner_change_refused');
 await rejects(attempt(r=>{r.billing.subscriptions[c.payment.subscriptionId].hold={reason:'missing',since:0};}),'owner_change_refused');
 await rejects(attempt(r=>{r.state='deletion-scheduled';}),'owner_change_refused');
 await rejects(w.metadata.transaction(async tx=>{const r=w.service.ensure(await w.service.open(tx));await w.service.changeOwner(r,p(A),c.payment,w.clock.now(),tx,{cause:'break-glass',id:c.id,expect:p(A)});}),'owner_change_refused');
 await rejects(attempt(null),'ok','the guarded commit passes with every precondition');
}finally{await w.close();}});

test('views: role-filtered; members see a banner; the owner sees channel kinds and ages; admins never the cause or channels',async()=>{const w=await bgWorld();try{
 const M=uuid(60);await w.join(M);await waiting(w);
 const member=await w.run('orgs.breakglass',M);assert.deepEqual(Object.keys(member.claim).sort(),['closedReason','createdAt','earliestEffectAt','id','state']);
 const admin=await w.run('orgs.breakglass',C);assert.equal(admin.claim.channels,undefined);assert.ok(admin.claim.decisions.includes('uncosign'));
 const owner=await w.run('orgs.breakglass',A);assert.equal(owner.claim.channels.length,4);assert.ok(owner.claim.channels.every(ch=>Object.keys(ch).sort().join()==='enrolledAt,excluded,kind'));assert.deepEqual(owner.claim.decisions,['abort']);
 const cs=await w.run('orgs.breakglass-case','system');assert.equal(cs.case.statement,undefined);assert.ok(cs.case.statementDigest);
}finally{await w.close();}});

test('ORG-12r: the owner’s recovery-file reissue needs an aged credential; a recent security change blocks replacing a file but not reissuing a missing one; admins are notified',async()=>{const w=await bgWorld();try{
 await rejects(w.run('orgs.recovery-reissue-begin',A,{},{verification:w.verification({enrolledAt:w.clock.now()-DAY})}),'tight_verification_required');
 await rejects(w.run('orgs.recovery-reissue-begin',A,{},{verification:w.verification({securityChangedAt:w.clock.now()-DAY})}),'recovery_reissue_cooling');
 await rejects(w.run('orgs.recovery-reissue-begin',B,{}),'not_found','admins can never reissue');
 await w.run('orgs.recovery-reissue-begin',A,{});await w.run('orgs.recovery-reissue-done',A,{kid:'k1'});assert.equal((await w.summary()).recovery.state,'issued');
 const c=await waiting(w);await w.reach(c.waitEndsAt);await w.settle();assert.equal((await w.summary()).recovery.state,'missing');
 await w.run('orgs.recovery-reissue-begin',B,{},{verification:w.verification({securityChangedAt:w.clock.now()-DAY})});
 const notices=[...(await w.metadata.list({prefix:'org/outbox/pending/'})).values()].filter(n=>n.type==='organization-recovery-reissue-started');assert.ok(notices.length>=2&&notices.every(n=>n.recipients.length>0));
}finally{await w.close();}});

// ---- named adversarial cases (§12d.12) ----------------------------------------------------------------------------
test('adversarial: a full admin coalition against a live owner: the owner aborts; a restart goes to support',async()=>{const w=await bgWorld();try{
 await w.start(B);await w.cosign(C);await w.cosign(E);await w.pay(B);await w.abort();assert.equal((await w.claim()).state,'aborted');
 w.clock.advance(31*DAY);await w.sync();await w.start(C);await w.cosign(B);await w.cosign(E);await w.pay(C);const c=await w.claim();
 assert.equal(c.track,'S');assert.equal(c.state,'held','within 180 days of an owner abort a claim is held for support');
 w.clock.advance(61*DAY);await w.sync();assert.notEqual((await w.summary()).ownerOfRecord.sub,C,'no timeout seizes it');
}finally{await w.close();}});
test('adversarial: a stolen owner device aborts, then support excludes it, its further dispute needs a new operator pair, and the real owner’s tier 1 ends it',async()=>{const w=await bgWorld();try{
 await w.start();await w.settle();const push=(await w.claim()).channels.find(x=>x.kind==='push').id,pushToken=()=>w.ownerChannels.sent.filter(n=>n.channel===push&&n.abort).at(-1).abort;
 await w.run('orgs.breakglass-abort-token','system',{token:pushToken()});assert.equal((await w.claim()).state,'aborted');
 w.clock.advance(31*DAY);await w.sync();await w.start(C);await w.cosign(E);await w.settle();
 await w.run('orgs.breakglass-abort-token','system',{token:pushToken()});let c=await w.claim();assert.equal(c.state,'gathering','after an owner abort, tier 0 disputes instead of aborting');
 await w.pay(C);c=await w.claim();assert.equal(c.state,'held');
 await w.proceed(OP1,OP2,{exclude:[push]});c=await w.claim();assert.equal(c.state,'final');assert.ok(c.channels.find(x=>x.id===push).excluded);
 await w.settle();assert.ok(w.ownerChannels.sent.some(n=>n.event==='proceed'&&n.channel===push&&n.abort),'excluded channels still get fresh links');
 await w.run('orgs.breakglass-abort-token','system',{token:pushToken()});c=await w.claim();assert.equal(c.state,'held','BG-R1-H1: an excluded channel still stops the effect');
 // Review L6: the new pair shares no operator with the barred pair; a barred operator cannot even propose.
 await rejects(w.resolve(OP1,'proceed',{exclude:[push]}),'operator_pair_barred');await rejects(w.resolve(OP2,'proceed',{exclude:[push]}),'operator_pair_barred');
 await w.resolve(OP3,'proceed',{exclude:[push]});await rejects(w.resolve(OP1,'proceed',{exclude:[push]}),'operator_pair_barred');
 await w.resolve(OP4,'proceed',{exclude:[push]});c=await w.claim();assert.equal(c.state,'final');assert.deepEqual(c.decision.pair,[OP3,OP4].sort());
 await w.abort(w.tier1(c));c=await w.claim();assert.equal(c.state,'aborted');assert.equal(c.closedReason,'owner-elevated');
}finally{await w.close();}});
test('adversarial: two operators cannot exclude an email-only owner’s only channel',async()=>{const w=await bgWorld();try{
 const o=w.ownerChannels.owners.get(A);o.channels=o.channels.filter(x=>x.kind==='email');
 await w.start();await w.cosign(C);await w.pay(B);await w.run('orgs.breakglass-object',E,{claim:(await w.claim()).id});await w.proceed();await w.settle();
 const email=(await w.claim()).channels[0].id;await w.run('orgs.breakglass-abort-token','system',{token:w.ownerChannels.sent.filter(n=>n.event==='proceed').at(-1).abort});
 assert.equal((await w.claim()).state,'held');await rejects(w.resolve(OP3,'proceed',{exclude:[email]}),'last_channel');
}finally{await w.close();}});
test('adversarial: a single operator, a member operator, a party operator and a self-approval are all refused',async()=>{const w=await bgWorld();try{
 const M=uuid(61);await w.join(M);await held(w);
 await rejects(w.resolve(M,'proceed'),'operator_conflict');await rejects(w.resolve(C,'abort'),'operator_conflict');await rejects(w.resolve(A,'proceed'),'operator_conflict');
 await w.resolve(OP1,'proceed');await rejects(w.resolve(OP1,'proceed'),'second_operator_required');
 w.clock.advance(3*DAY+1);await w.sync().catch(()=>{});assert.deepEqual(await w.resolve(OP2,'proceed'),{decision:'proposed'},'a proposal lapses after 72 h');assert.equal((await w.claim()).state,'held');
}finally{await w.close();}});
test('adversarial: an attacker with the aged passkey ends the claim with tier 1; support can never override it',async()=>{const w=await bgWorld();try{
 const c=await held(w);await w.abort(w.tier1(c));const x=await w.claim();assert.equal(x.state,'aborted');await rejects(w.proceed(),'not_found');
}finally{await w.close();}});
test('adversarial: an admin probing the owner’s activity learns only "held for support"',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});
 const view=JSON.stringify(await w.run('orgs.breakglass',B));assert.ok(view.includes('held-for-support'));for(const word of ['liveness','owner-liveness','sign-in','channels'])assert.ok(!view.includes(word),word);
 assert.ok(!JSON.stringify((await w.audits()).filter(a=>a.claim===c.id)).includes('owner-liveness'),'the audit carries no Track S cause');
}finally{await w.close();}});
test('adversarial: a claim racing a transfer, and a lapse claim racing break-glass',async()=>{
 {const w=await bgWorld(41);try{await w.offer(E);await rejects(w.start(),'transfer_pending');}finally{await w.close();}}
 {const w=await bgWorld(42);try{
  w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(45*DAY);await w.sync();
  await w.run('orgs.claim-start',E,{plan:'org-team',confirm:true});const lapse=w.polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']==='claim');
  await w.start(B);await w.cosign(C);
  await rejects(w.run('orgs.claim-start',E,{plan:'org-team',confirm:true}),'break_glass_pending');
  const paid=w.polar.pay(lapse.id);await w.webhook();await w.settle();assert.equal((await w.summary()).billing.claim.state,'awaiting-payment','a lapse payment during break-glass is refused');assert.ok(w.refundsOf(paid.subscription).length>0);
  await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});
  await w.run('orgs.claim-start',E,{plan:'org-team',confirm:true});w.payLatest('claim');await w.webhook();assert.equal((await w.summary()).billing.claim.state,'pending');
  await rejects(w.start(E),'claim_pending');
 }finally{await w.close();}}
});
test('adversarial: harassment beyond the limits, and a candidate taken over during the wait',async()=>{const w=await bgWorld();try{
 await w.start();await w.abort();for(let i=0;i<3;i++)await rejects(w.start(C),'break_glass_locked');
 w.clock.advance(31*DAY);await w.sync();await w.start(C);await w.cosign(E);await w.pay(C);
 await w.run('orgs.breakglass-security-change','system',{principal:p(C),at:w.clock.now()});const c=await w.claim();assert.equal(c.closedReason,'ineligible');await w.settle();assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,x)=>n+x.amount,0),120000);
}finally{await w.close();}});
test('adversarial: a chargeback after effect leaves ownership as it is',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);await w.reach(c.waitEndsAt);const order=w.polar.orders.get(c.payment.orderId);order.refunded_amount=order.net_amount;order.status='refunded';
 await w.webhook();assert.equal((await w.summary()).ownerOfRecord.sub,B);assert.notEqual((await w.run('orgs.ownership',B)).billing.standing,'paid');
}finally{await w.close();}});
test('I10: with the flag off, aborts, withdrawals, objections, operator holds and refunds still work; starting and the effect do not',async()=>{const w=await bgWorld();try{
 const c=await waiting(w);w.flag.names.ORG_BREAK_GLASS_ENABLED=false;w.flag.names.ORGANIZATIONS_ENABLED=false;
 await w.run('orgs.breakglass-object',E,{claim:c.id});await w.resolve(OP1,'acknowledge');await w.abort();await w.settle();
 assert.equal((await w.claim()).state,'aborted');assert.equal(w.refundsOf(c.payment.subscriptionId).reduce((n,x)=>n+x.amount,0),120000);
 w.flag.names.ORGANIZATIONS_ENABLED=true;w.clock.advance(31*DAY);await rejects(w.start(C),'not_found');
}finally{await w.close();}});
test('the timer constants match §12d.5',()=>{
 assert.equal(BREAK_GLASS.GATHER_MS,7*DAY);assert.equal(BREAK_GLASS.PAYMENT_MS,7*DAY);assert.equal(BREAK_GLASS.WAIT_A_MS,30*DAY);assert.equal(BREAK_GLASS.WAIT_S_MS,60*DAY);assert.deepEqual([...BREAK_GLASS.REMINDERS_MS],[7*DAY,21*DAY]);
 assert.equal(BREAK_GLASS.REMINDER_BEFORE_MS,72*H);assert.equal(BREAK_GLASS.ACK_MS,30*DAY);assert.equal(BREAK_GLASS.DECIDE_MS,60*DAY);assert.equal(BREAK_GLASS.HELD_TOTAL_MS,120*DAY);assert.equal(BREAK_GLASS.FINAL_MS,7*DAY);
 assert.equal(BREAK_GLASS.CONTEST_MS,90*DAY);assert.equal(BREAK_GLASS.LOCK_MS,30*DAY);assert.equal(BREAK_GLASS.TRACK_S_AFTER_ABORT_MS,180*DAY);assert.equal(OWNERSHIP.OPERATOR_APPROVAL_MS,72*H);
});
