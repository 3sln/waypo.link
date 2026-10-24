// Regression tests for the round-2 review of the ORG-12a/12c break-glass engine (R2-M1, R2-M2, R2-L1, R2-L2 and the
// hardenings). Each fails when its fix is reverted. Engine level, loopback fixtures and the offline Polar model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bgWorld,rejects,A,B,C,E,DAY,ORG,p,OP1,OP2} from './helpers/break-glass-world.mjs';
import {world,uuid} from './helpers/org-world.mjs';
import {OrganizationRecoveryReissue} from '../packages/orgs/creation.mjs';
import {BREAK_GLASS} from '../packages/orgs/break-glass.mjs';

const H=3600000;
const pushDead=w=>{const real=w.ownerChannels.notify;w.ownerChannels.notify=async(o,n)=>n.kind==='push'?{accepted:false}:real(o,n);};
/** Drives the alarm for `days` days, a tick and a drain every 6 hours. */
async function days(w,n){for(let i=0;i<n*4;i++){w.clock.advance(6*H);await w.sync();await w.settle();}}
const pending=async w=>(await w.summary()).ownershipOutbox.filter(e=>!e.doneAt).length;

test('R2-M1: a push channel that never accepts is marked undeliverable; the claim goes to support, which can exclude it; nothing waits forever',async()=>{const w=await bgWorld(81);try{
 pushDead(w);await w.trackA();let c=await w.claim();
 await days(w,8);c=await w.claim();const push=c.channels.find(x=>x.kind==='push');
 assert.equal(push.undeliverable,true,'8 failed attempts over 7 days');assert.equal(c.state,'held');assert.ok(c.causes.includes('channel-undeliverable'));
 assert.ok(await pending(w)<=1,'the dead channel no longer holds its rows');
 await w.proceed(OP1,OP2,{exclude:[push.id]});c=await w.claim();assert.equal(c.state,'final');
 await days(w,61);assert.equal((await w.claim()).state,'effective','the final notice reached the email channel');assert.equal((await w.summary()).ownerOfRecord.sub,B);
}finally{await w.close();}});
test('R2-M1: a final claim whose final notice no channel ever accepts goes back to support after the bound, instead of waiting forever',async()=>{const w=await bgWorld(82);try{
 const c=await (async()=>{await w.trackA();return w.claim();})();await w.run('orgs.breakglass-object',E,{claim:c.id});await w.proceed();
 w.ownerChannels.notify=async()=>({accepted:false});const f=await w.claim(),at=Math.max(f.finalEndsAt,f.paidAt+60*DAY);
 w.clock.set(at+H);await w.sync();assert.equal((await w.claim()).state,'final');assert.equal((await w.claim()).lastBlocked.reason,'notices-pending');
 w.clock.set(at+BREAK_GLASS.NOTICE_BOUND_MS+H);await w.sync();const x=await w.claim();assert.equal(x.state,'held');assert.equal(x.decision,null);assert.equal((await w.summary()).ownerOfRecord.sub,A);
}finally{await w.close();}});

test('R2-L2: an ended claim drops its undelivered notices; its closing notice gives up after 8 attempts; system effects never refuse for capacity',async()=>{const w=await bgWorld(83);try{
 w.ownerChannels.notify=async()=>({accepted:false});await w.start();await w.settle();assert.ok(await pending(w)>=1);
 await w.run('orgs.breakglass-withdraw',B,{claim:(await w.claim()).id});
 const rows=(await w.summary()).ownershipOutbox.filter(e=>e.kind==='owner-notice');assert.ok(rows.filter(e=>e.event==='start').every(e=>e.doneAt&&e.dropped));
 for(let i=0;i<12;i++){w.clock.advance(6*H);await w.settle();}
 assert.equal((await w.summary()).ownershipOutbox.filter(e=>e.kind==='owner-notice'&&!e.doneAt).length,0,'the closing notice completed (channels undeliverable)');
}finally{await w.close();}});
test('R2-L2: with the outbox backed up, a transfer still takes effect and syncs never throw; new claims are refused',async()=>{const w=await bgWorld(84);try{
 await w.offer(B);await w.acceptOffer(B);w.payLatest('transfer');await w.webhook();
 const r=await w.metadata.get('org/record-v1');for(let i=0;i<300;i++)r.ownershipOutbox.push({id:'junk-'+i,kind:'index',person:uuid(900+i),role:'member',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()+365*DAY});await w.metadata.put('org/record-v1',r);
 await rejects(w.start(C),'transfer_pending');
 const t=(await w.summary()).transfer;w.clock.set(t.notBefore+1000);await w.sync();await w.webhook();assert.equal((await w.summary()).ownerOfRecord.sub,B);
}finally{await w.close();}
 const w2=await bgWorld(85);try{const r=await w2.metadata.get('org/record-v1');for(let i=0;i<300;i++)r.ownershipOutbox.push({id:'junk-'+i,kind:'index',person:uuid(900+i),role:'member',createdAt:w2.clock.now(),doneAt:null,attempts:0,nextAt:w2.clock.now()+365*DAY});await w2.metadata.put('org/record-v1',r);
  await rejects(w2.start(),'ownership_outbox_full');}finally{await w2.close();}
});

test('R2-M2: two concurrent reissues straddling an owner change: both late confirmations rotate, neither is handed out',async()=>{const w=await bgWorld(86);try{
 const c=await (async()=>{await w.trackA();return w.claim();})();await w.reach(c.waitEndsAt+H);await w.settle();assert.equal((await w.summary()).ownerOfRecord.sub,B);
 const b1=await w.run('orgs.recovery-reissue-begin',B,{}),b2=await w.run('orgs.recovery-reissue-begin',B,{});
 await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));await w.resolve(OP1,'uphold',{claim:c.id});await w.resolve(OP2,'uphold',{claim:c.id});await w.settle();
 const rotations=async()=>(await w.summary()).ownershipOutbox.filter(e=>e.kind==='recovery-rotate'&&e.cause==='reissue-superseded').length;
 assert.deepEqual(await w.run('orgs.recovery-reissue-done',B,{kid:'k1',generation:b1.generation}),{issued:false,reason:'owner_changed'});assert.equal(await rotations(),1);
 await w.settle();assert.deepEqual(await w.run('orgs.recovery-reissue-done',B,{kid:'k2',generation:b2.generation}),{issued:false,reason:'owner_changed'});assert.equal(await rotations(),2,'the second late confirmation rotates too');
 await rejects(w.run('orgs.recovery-reissue-done',E,{kid:'k3'}),'not_found');assert.equal(await rotations(),2,'someone who began nothing causes no rotation');
 await w.settle();const b3=await w.run('orgs.recovery-reissue-begin',A,{});assert.deepEqual(await w.run('orgs.recovery-reissue-done',A,{kid:'k4',generation:b3.generation+99}),{issued:false,reason:'owner_changed'},'a confirmation naming no begun generation still rotates');assert.equal(await rotations(),3);
}finally{await w.close();}});
test('R2-M2: the edge never hands out a file when the confirmation fails for any reason',async()=>{
 const ports=done=>({org:{begin:async()=>({request:'r',generation:0}),done},identity:{record:async()=>({recoveryHash:null}),bindRecovery:async()=>({ok:true})},backup:{issue:async()=>({keychain:{signing:{kid:'k'}}})}});
 await rejects(new OrganizationRecoveryReissue(ports(async()=>{throw Object.assign(Error('x'),{code:'not_found'});})).reissue({},ORG),'organization_unavailable');
 await rejects(new OrganizationRecoveryReissue(ports(async()=>undefined)).reissue({},ORG),'organization_unavailable');
 const ok=await new OrganizationRecoveryReissue(ports(async()=>({issued:true}))).reissue({},ORG);assert.ok(ok.recoveryFile.content);
});

test('R2-L1: an ineligible initiator learns nothing about another person and writes nothing to their ledger',async()=>{const w=await bgWorld(87);try{
 const M=uuid(6);await w.join(M);w.clock.advance(DAY);await w.sync();
 await w.claimLedger.reserve(C,{org:uuid(90),claim:uuid(91),role:'candidate',at:w.clock.now()});
 for(const target of [C,uuid(4444),B])await rejects(w.start(M,target),'not_found');
 assert.equal(w.claimLedger.people.get(C).size,1,'no reservation in C’s ledger');assert.equal(w.claimLedger.people.get(M),undefined);assert.equal(w.claimLedger.people.get(B),undefined);
 await rejects(w.start(B,C),'candidacy_pending','an eligible initiator may learn the reason');
}finally{await w.close();}});

test('hardening: an operator assertion names the process kind; a lapse-claim assertion cannot act on a break-glass claim and back',async()=>{const w=await bgWorld(88);try{
 const c=await (async()=>{await w.trackA();return w.claim();})();await w.run('orgs.breakglass-object',E,{claim:c.id});
 await rejects(w.resolve(OP1,'proceed',{assertion:await w.operatorAssertion(OP1,{process:c.id,decision:'proceed',kind:'lapse-claim'})}),'operator_unverified');
 assert.deepEqual(await w.resolve(OP1,'proceed'),{decision:'proposed'});
}finally{await w.close();}});
test('hardening: email domains are IDNA-normalized before suffix hashing on both sides',async()=>{
 for(const [owner,org] of [['mail.bücher.example','BÜCHER.example'],['mail.xn--bcher-kva.example','bücher.example'],['Mail.Bücher.Example.','xn--bcher-kva.example']]){const w=await bgWorld(89);try{
  const o=w.ownerChannels.owners.get(A);o.channels=o.channels.filter(x=>x.kind!=='push');o.channels[0].domain=owner;w.ownerChannels.domainMap.set(ORG,[org]);
  await w.start();assert.ok((await w.claim()).causes.includes('no-out-of-band-channel'),owner+' vs '+org);
 }finally{await w.close();}}
});
test('hardening: an undecided contest stops blocking lapse claims 30 days after it opened (or at the window’s end), escalating to operators',async()=>{const w=await bgWorld(90);try{
 const c=await (async()=>{await w.trackA();return w.claim();})();await w.reach(c.waitEndsAt+H);
 w.clock.advance(85*DAY);await w.sync();await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));
 w.clock.advance(10*DAY);await w.sync();assert.ok(w.service.contestActive(await w.summary(),w.clock.now()),'still blocking past the window while within 30 days of opening');
 w.clock.advance(21*DAY);await w.sync();const r=await w.summary();assert.equal(w.service.contestActive(r,w.clock.now()),false);assert.equal(w.service.ownershipBusy(r),null);
 assert.ok(w.alerts.some(a=>a.reason==='contest-undecided'));assert.ok(r.breakGlassContest.escalatedAt);
 await w.resolve(OP1,'reject',{claim:c.id});await w.resolve(OP2,'reject',{claim:c.id});assert.equal((await w.summary()).breakGlassContest.state,'rejected','still decidable');
}finally{await w.close();}});
