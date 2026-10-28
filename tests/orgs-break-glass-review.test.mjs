// Regression tests for the 2026-10-23 adversarial review of the ORG-12a/12c break-glass engine (H1–H3, M1–M4, L1–L8).
// Each fails when its fix is reverted. Engine level, loopback fixtures and the offline Polar model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bgWorld,rejects,A,B,C,E,DAY,ORG,p,OP1,OP2,OP3} from './helpers/break-glass-world.mjs';
import {world,uuid} from './helpers/org-world.mjs';
import {OrganizationRecoveryReissue} from '../packages/orgs/creation.mjs';
import {BREAK_GLASS} from '../packages/orgs/break-glass.mjs';

const H=3600000;
async function waiting(w){await w.trackA();const c=await w.claim();assert.equal(c.state,'waiting');return c;}
const pending=async w=>(await w.summary()).ownershipOutbox.filter(e=>!e.doneAt).length;
/** Fills the ownership outbox with pending, undeliverable effects, as a stuck provider would. */
async function fillOutbox(w,n=300){const r=await w.metadata.get('org/record-v1');for(let i=0;i<n;i++)(r.ownershipOutbox??=[]).push({id:'junk-'+i,kind:'index',person:uuid(900+i),role:'member',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()+365*DAY});await w.metadata.put('org/record-v1',r);}

test('H1: a full ownership outbox never blocks an owner abort, an abort link, liveness, a withdrawal or a support abort, and their refunds queue',async()=>{
 for(const [label,stop] of [
  ['tier 0',async w=>w.abort()],
  ['tier 1',async w=>w.abort(w.tier1(await w.claim()))],
  ['abort link',async w=>{const id=(await w.claim()).id,t=w.tokens().find(x=>x.includes(id));await w.run('orgs.breakglass-abort-token','system',{token:t});}],
  ['withdraw',async w=>w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id})],
  ['liveness then support abort',async w=>{await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});await w.resolve(OP1,'abort');}]
 ]){const w=await bgWorld(51);try{
  const c=await waiting(w);await w.settle();await fillOutbox(w);assert.ok(await pending(w)>=256);
  await rejects(w.start(C),'break_glass_pending');
  await stop(w);const x=await w.claim();assert.ok(['aborted','withdrawn'].includes(x.state),label+': '+x.state);
  assert.ok((await w.summary()).ownershipOutbox.some(e=>e.kind==='refund'&&e.subscriptionId===c.payment.subscriptionId&&!e.doneAt),label+': the refund is queued');
 }finally{await w.close();}}
});
test('H1: done rows no longer count toward the cap; one objection per admin; owner notices per claim are capped',async()=>{const w=await bgWorld(52);try{
 const r=await w.metadata.get('org/record-v1');for(let i=0;i<300;i++)(r.ownershipOutbox??=[]).push({id:'done-'+i,kind:'index',createdAt:w.clock.now(),doneAt:w.clock.now(),attempts:0,nextAt:w.clock.now()});await w.metadata.put('org/record-v1',r);
 await w.start();assert.ok((await w.summary()).ownershipOutbox.length<=BREAK_GLASS.OWNER_NOTICES_PER_CLAIM+140,'done rows are bounded');
 const c=await w.claim();
 // 200 stuck pending effects plus 128 kept done rows: over 256 rows in all, yet a non-critical effect still queues.
 const rec=await w.metadata.get('org/record-v1');for(let i=0;i<200;i++)(rec.ownershipOutbox??=[]).push({id:'stuck-'+i,kind:'index',person:uuid(700+i),role:'member',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()+365*DAY});await w.metadata.put('org/record-v1',rec);
 assert.ok((await w.summary()).ownershipOutbox.length>256);
 for(let i=0;i<10;i++)await w.run('orgs.breakglass-object',E,{claim:c.id});
 let x=await w.claim();assert.equal(x.objections.length,1,'one objection per admin');
 const objectRows=(await w.summary()).ownershipOutbox.filter(e=>e.kind==='owner-notice'&&e.claim===c.id&&e.event==='object').length;assert.equal(objectRows,1);
 x.noticeRows=BREAK_GLASS.OWNER_NOTICES_PER_CLAIM;await w.metadata.put('org/claim/'+c.id,x);await w.run('orgs.breakglass-object',C,{claim:c.id});
 assert.equal((await w.summary()).ownershipOutbox.filter(e=>e.kind==='owner-notice'&&e.claim===c.id&&e.event==='object').length,1,'a non-critical notice past the cap is dropped');
 await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});assert.ok((await w.summary()).ownershipOutbox.some(e=>e.kind==='owner-notice'&&e.claim===c.id&&e.event==='liveness'),'critical notices always go out');
}finally{await w.close();}});
test('H1: the coalition junk-claim schedule from the review: the owner still aborts and nothing takes effect',async()=>{const w=await bgWorld(53);try{
 for(const starter of [B,C])for(let i=0;i<4;i++){await w.start(starter).catch(()=>{});const c=await w.claim();if(c?.state!=='gathering')continue;for(let k=0;k<32;k++)await w.run('orgs.breakglass-object',E,{claim:c.id}).catch(()=>{});await w.run('orgs.breakglass-withdraw',starter,{claim:c.id});await w.settle();}
 assert.ok(await pending(w)<16,'junk claims leave nothing pending');
 await w.start(E);await w.cosign(C);await w.pay(E);await w.abort();assert.equal((await w.claim()).state,'aborted');
}finally{await w.close();}});
test('H1: a final claim never takes effect while its owner notices are still undelivered',async()=>{const w=await bgWorld(54);try{
 const c=await waiting(w);await w.run('orgs.breakglass-object',E,{claim:c.id});await w.proceed();
 const real=w.ownerChannels.notify;w.ownerChannels.notify=async()=>({accepted:false});await w.settle();
 const f=await w.claim();w.clock.set(f.paidAt+61*DAY);await w.sync();let x=await w.claim();assert.equal(x.state,'final');assert.equal(x.lastBlocked.reason,'notices-pending');
 w.ownerChannels.notify=real;w.clock.advance(7*H);await w.settle();await w.sync();assert.equal((await w.claim()).state,'effective');
}finally{await w.close();}});

test('H2: a chargeback or cancellation of the claim payment closes the claim; a fresh sync never throws',async()=>{
 for(const mode of ['chargeback','cancel']){const w=await bgWorld(55);try{
  const c=await waiting(w);
  if(mode==='chargeback'){const o=w.polar.orders.get(c.payment.orderId);o.refunded_amount=o.net_amount;o.status='refunded';}else w.polar.lapse(c.payment.subscriptionId);
  await w.webhook();const x=await w.claim();assert.equal(x.state,'closed',mode);assert.equal(x.closedReason,'payment-failed');
  await w.reach(c.waitEndsAt+H);await w.sync();await w.webhook();assert.equal((await w.summary()).ownerOfRecord.sub,A);
 }finally{await w.close();}}
});
test('H2: a transfer whose payment is charged back fails instead of wedging every sync',async()=>{const w=await world(56);try{
 await w.join(B,[{power:'admin'}]);w.clock.advance(31*DAY);await w.sync();await w.offer(B);await w.accept(B);const paid=w.payLatest('transfer');await w.webhook();
 const t=(await w.summary()).transfer,o=w.polar.orders.get(paid.order);o.refunded_amount=o.net_amount;o.status='refunded';await w.webhook();
 w.clock.set(t.notBefore+1000);await w.sync();await w.webhook();const r=await w.summary();assert.equal(r.ownerOfRecord.sub,A);assert.equal(r.transfer.state,'failed');assert.equal(r.transfer.closedReason,'payment-failed');
}finally{await w.close();}});
test('H2: a lapse claim whose payment is charged back closes',async()=>{const w=await world(57);try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(4*DAY);w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(45*DAY);await w.sync();
 await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});const paid=w.payLatest('claim');await w.webhook();
 const o=w.polar.orders.get(paid.order);o.refunded_amount=o.net_amount;o.status='refunded';w.clock.advance(3*DAY+H);await w.sync();
 const r=await w.summary();assert.equal(r.ownerOfRecord.sub,A);assert.equal(r.billing.claim.closedReason,'payment-failed');
}finally{await w.close();}});

test('H3: during the contest window no lapse claim or new break-glass claim can start, and a lapse payment is refused',async()=>{const w=await bgWorld(58);try{
 const c=await waiting(w);await w.reach(c.waitEndsAt+H);assert.equal((await w.summary()).ownerOfRecord.sub,B);
 const o=w.polar.orders.get(c.payment.orderId);o.refunded_amount=o.net_amount;o.status='refunded';await w.webhook();
 for(let d=0;d<46;d++){w.clock.advance(DAY);await w.sync();}
 assert.ok(!(await w.run('orgs.ownership',C)).decisions.includes('claim'));
 await rejects(w.run('orgs.claim-start',C,{plan:'org-team',confirm:true}),'contest_window');
 await rejects(w.start(C),'contest_window');
 assert.equal((await w.summary()).ownerOfRecord.sub,B);
}finally{await w.close();}});
test('H3: a reinstatement restores the former owner from whoever owns the organization now',async()=>{const w=await bgWorld(59);try{
 const c=await waiting(w);await w.reach(c.waitEndsAt+H);await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));
 const r=await w.metadata.get('org/record-v1');r.ownerOfRecord=p(C);await w.metadata.put('org/record-v1',r); // an ownership change that slipped through
 await w.resolve(OP1,'uphold',{claim:c.id});await w.resolve(OP2,'uphold',{claim:c.id});assert.equal((await w.summary()).ownerOfRecord.sub,A);
}finally{await w.close();}});

test('M1: Track A never takes effect without a provider-accepted out-of-band notice; it is held for support',async()=>{
 for(const [label,accept] of [['nothing accepted',()=>false],['only the session channel',n=>n.kind==='session']]){const w=await bgWorld(60);try{
  const real=w.ownerChannels.notify;w.ownerChannels.notify=async(owner,n)=>accept(n)?real(owner,n):{accepted:false};
  const c=await waiting(w);await w.reach(c.waitEndsAt+H);const x=await w.claim();
  assert.equal((await w.summary()).ownerOfRecord.sub,A,label);assert.equal(x.state,'held',label);assert.ok(x.causes.includes('notice-undelivered'));
 }finally{await w.close();}}
 const w=await bgWorld(61);try{const c=await waiting(w);w.clock.set(c.waitEndsAt+H);await w.sync();assert.equal((await w.claim()).state,'held','a 72 h notice never delivered (no tick before the end) also holds');}finally{await w.close();}
});

test('M2: a reissue begun before an owner change is never confirmed; the file is invalidated again and not handed out',async()=>{const w=await bgWorld(62);try{
 await rejects(w.run('orgs.recovery-reissue-done',A,{fileId:'k-unbegun'}),'not_found');assert.notEqual((await w.summary()).recovery?.state,'issued','done without a begun reissue confirms nothing');
 const begun=await w.run('orgs.recovery-reissue-begin',A,{});const c=await waiting(w);
 await w.reach(c.waitEndsAt+H);assert.equal((await w.summary()).ownerOfRecord.sub,B);await w.settle();assert.equal((await w.summary()).recovery.state,'missing');
 const out=await w.run('orgs.recovery-reissue-done',A,{fileId:'k-old',generation:begun.generation});assert.deepEqual(out,{issued:false,reason:'owner_changed'});
 const r=await w.summary();assert.equal(r.recovery.state,'rotation-pending');assert.ok(r.ownershipOutbox.some(e=>e.kind==='recovery-rotate'&&e.cause==='reissue-superseded'&&!e.doneAt));
 await rejects(w.run('orgs.recovery-reissue-done',C,{fileId:'k',generation:begun.generation}),'not_found');
 // The edge never returns that file.
 const edge=new OrganizationRecoveryReissue({org:{begin:async()=>({request:'r',generation:0}),done:async()=>({issued:false,reason:'owner_changed'})},identity:{record:async()=>({recoveryHash:null}),bindRecovery:async()=>({ok:true})},backup:{issue:async()=>({file:{version:3,fileId:'AAAAAAAAAAAAAAAAAAAAAA',issuedAt:1},fileId:'AAAAAAAAAAAAAAAAAAAAAA'})}});
 await rejects(edge.reissue({},ORG),'organization_owner_changed');
}finally{await w.close();}});
test('M2: an owner with a passkey must step up with it to reissue the organization recovery file',async()=>{const w=await bgWorld(63);try{
 await rejects(w.run('orgs.recovery-reissue-begin',A,{},{verification:w.verification({hasPasskey:true,method:'password'})}),'passkey_required');
 await w.run('orgs.recovery-reissue-begin',A,{},{verification:w.verification({hasPasskey:true,method:'passkey'})});
}finally{await w.close();}});

test('M3: operator decisions need a verified assertion for exactly that operator and scope, once',async()=>{const w=await bgWorld(64);try{
 const c=await waiting(w);await w.run('orgs.breakglass-object',E,{claim:c.id});
 await rejects(w.run('orgs.breakglass-resolve','system',{claim:c.id,operator:OP1,decision:'proceed'}),'operator_unverified');
 await rejects(w.resolve(OP1,'proceed',{assertion:await w.operatorAssertion(OP2,{kind:'break-glass',process:c.id,decision:'proceed'})}),'operator_unverified');
 await rejects(w.resolve(OP1,'proceed',{assertion:await w.operatorAssertion(OP1,{kind:'break-glass',process:c.id,decision:'abort'})}),'operator_unverified');
 await rejects(w.resolve(OP1,'proceed',{exclude:[],assertion:await w.operatorAssertion(OP1,{kind:'break-glass',process:c.id,decision:'proceed',exclude:['x']})}),'operator_unverified');
 w.operatorRegistry.allow=op=>op!==OP1;await rejects(w.resolve(OP1,'proceed'),'operator_unverified');w.operatorRegistry.allow=()=>true;
 const a=await w.operatorAssertion(OP1,{kind:'break-glass',process:c.id,decision:'acknowledge',exclude:[]});await w.resolve(OP1,'acknowledge',{assertion:a});await rejects(w.resolve(OP1,'acknowledge',{assertion:a}),'operator_unverified');
 w.clock.advance(6*60000);const stale=await w.operatorAssertion(OP2,{kind:'break-glass',process:c.id,decision:'proceed'});w.clock.advance(6*60000);await rejects(w.resolve(OP2,'proceed',{assertion:stale}),'operator_unverified');
 await rejects(w.run('orgs.breakglass-resolve',B,{claim:c.id,operator:OP1,decision:'proceed'}),'forbidden');
}finally{await w.close();}});

test('M4: an email on a subdomain of a signer’s domain is not out of band',async()=>{const w=await bgWorld(65);try{
 const o=w.ownerChannels.owners.get(A);o.channels=o.channels.filter(x=>x.kind!=='push');o.channels[0].domain='mail.acme.example';w.ownerChannels.domainMap.set(ORG,['acme.example']);
 await w.start();const c=await w.claim();assert.ok(c.causes.includes('no-out-of-band-channel'));assert.ok(!JSON.stringify(c).includes('acme'));
}finally{await w.close();}});

test('L1: delivered owner notices keep no raw abort token',async()=>{const w=await bgWorld(66);try{
 await w.start();await w.settle();const row=(await w.summary()).ownershipOutbox.find(e=>e.kind==='owner-notice');assert.ok(row.doneAt);assert.ok(row.channels.every(ch=>!('abort' in ch)));
 assert.ok(!JSON.stringify(await w.summary()).includes('bg1.'));
 // Undelivered rows of an ended claim are scrubbed too.
 w.ownerChannels.notify=async()=>({accepted:false});await w.run('orgs.breakglass-object',E,{claim:(await w.claim()).id});await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});
 assert.ok(!JSON.stringify(await w.summary()).includes('bg1.'));
}finally{await w.close();}});
test('L2: unknown owner activity sends the claim to Track S',async()=>{const w=await bgWorld(67);try{w.ownerChannels.owners.get(A).lastInteractiveAt=null;await w.start();assert.equal((await w.claim()).track,'S');}finally{await w.close();}});
test('L3: owner liveness while held clears a pending proposal',async()=>{const w=await bgWorld(68);try{
 const c=await waiting(w);await w.run('orgs.breakglass-object',E,{claim:c.id});await w.resolve(OP1,'proceed');assert.ok((await w.claim()).proposal);
 await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});assert.equal((await w.claim()).proposal,null);
 assert.deepEqual(await w.resolve(OP2,'proceed'),{decision:'proposed'},'the old proposal cannot be approved');
}finally{await w.close();}});
test('L4: an owner decision about a held member still aborts a pending claim (T14)',async()=>{const w=await bgWorld(69);try{
 const e=await w.member(E),q=(await w.run('orgs.member-grants',B,{membership:e.id,grants:[],reason:'Gone'})).request;await w.run('orgs.decide-grants',E,{request:q.id,decision:'reject'});await w.run('orgs.decide-grants',B,{request:q.id,decision:'elevate'});
 await w.start(B);await w.cosign(C);await w.run('orgs.observe-authority','system',{principal:p(E),aep:1});
 await w.run('orgs.decide-grants',A,{request:q.id,decision:'reject'});assert.equal((await w.claim()).closedReason,'owner-active');
}finally{await w.close();}});
test('L7: a token reserve keeps abort links for the final notice',async()=>{const w=await bgWorld(70);try{
 const c=await waiting(w);await w.run('orgs.breakglass-object',E,{claim:c.id});const x=await w.claim();
 x.tokens=Array.from({length:BREAK_GLASS.TOKENS-BREAK_GLASS.TOKEN_RESERVE},(_,i)=>({id:uuid(5000+i),channel:'none',hash:'0'.repeat(64),issuedAt:0,usedAt:null}));await w.metadata.put('org/claim/'+c.id,x);
 await w.run('orgs.breakglass-liveness','system',{principal:p(A),kind:'sign-in',at:w.clock.now()});await w.settle();assert.equal(w.tokens('liveness').length,0,'ordinary notices stop at the reserve');
 await w.proceed();await w.settle();assert.equal(w.tokens('proceed').length,2,'the final notice still carries links');
}finally{await w.close();}});
test('L8: start answers uniformly for unknown or ineligible candidates; admins see only "closed"',async()=>{const w=await bgWorld(71);try{
 const M=uuid(72);await w.join(M);w.people.set(uuid(73),{kind:'organization',status:'active',handle:'org'});w.people.set(E,{kind:'person',status:'suspended',handle:'erin'});
 const errors=[];for(const cand of [uuid(73),uuid(74),M,E])errors.push(await w.start(B,cand).then(()=>null,e=>[e.code,e.message]));
 assert.deepEqual(new Set(errors.map(e=>JSON.stringify(e))).size,1,JSON.stringify(errors));
 w.clock.advance(100*DAY);await w.sync();await rejects(w.start(M,uuid(73)),'not_found','a non-admin initiator learns nothing about the candidate');
 await w.start();await w.abort(w.tier1(await w.claim()));const v=await w.run('orgs.breakglass',C);assert.equal(v.claim.state,'closed');assert.equal(v.claim.closedReason,null);
 const o=await w.run('orgs.breakglass',A);assert.equal(o.claim.closedReason,'owner-elevated');
 assert.ok(!JSON.stringify((await w.audits()).filter(a=>a.action?.startsWith('organization-break-glass'))).includes('owner-elevated'));
}finally{await w.close();}});
