// Regression tests for the 2026-10-24 review of "Break-glass and ownership outbox scaling" (L1–L3). Each fails when its
// fix is reverted. Engine level, loopback fixtures and the offline Polar model: local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bgWorld,A,E,DAY,p,OP1,OP2} from './helpers/break-glass-world.mjs';
import {uuid} from './helpers/org-world.mjs';
import {principalKey} from '../packages/core/principals.mjs';

const H=3600000;

test('L1: an undecided contest escalated to operators is a logged transition, one audit entry per log entry (I7)',async()=>{const w=await bgWorld(90);try{
 await w.trackA();const c=await w.claim();await w.reach(c.waitEndsAt+H);assert.equal((await w.claim()).state,'effective');
 w.clock.advance(85*DAY);await w.sync();await w.run('orgs.breakglass-contest',A,{claim:c.id},w.tier1(c));
 w.clock.advance(31*DAY);await w.sync();
 const x=await w.claim(),r=await w.summary();assert.ok(r.breakGlassContest.escalatedAt);
 assert.equal(x.state,'effective');assert.deepEqual(x.log.at(-1),{event:'contest-escalated',t:'T27',from:'effective',to:'effective',at:r.breakGlassContest.escalatedAt});
 const audits=[...(await w.metadata.list({prefix:'org/audit/'})).values()].filter(a=>a.claim===c.id&&a.action.startsWith('organization-break-glass-')&&a.action!=='organization-break-glass-contest-window-closed');
 assert.equal(audits.length,x.log.length,'I7');
 await w.resolve(OP1,'reject',{claim:c.id});await w.resolve(OP2,'reject',{claim:c.id});assert.equal((await w.summary()).breakGlassContest.state,'rejected','still decidable');
}finally{await w.close();}});

test('L2: an owner sign-in after the T1 snapshot read but before the claim commit is liveness: the claim never takes effect',async()=>{const w=await bgWorld(91);try{
 const port=w.ownerChannels,real=port.snapshot.bind(port);let reads=0;
 // The owner signs in right after the start's last read of their activity (same millisecond as T1).
 port.snapshot=async(owner,ctx)=>{const out=await real(owner,ctx);if(++reads===2)port.owners.get(A).lastInteractiveAt=w.clock.now();return out;};
 await w.start();port.snapshot=real;const c0=await w.claim();
 assert.ok(Number.isSafeInteger(c0.snapshotAt)&&c0.snapshotAt<=c0.createdAt,'the claim records its snapshot time');assert.equal(c0.track,'A','the read saw a quiet owner');
 await w.cosign('cccccccc-cccc-4ccc-8ccc-cccccccccccc');await w.pay('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 const c=await w.claim();assert.equal(c.state,'waiting');await w.reach(c.waitEndsAt+H);
 const x=await w.claim();assert.notEqual(x.state,'effective','the sign-in at T1 holds the claim');assert.equal(x.state,'held');assert.ok(x.causes.includes('owner-liveness'));
 assert.equal((await w.summary()).ownerOfRecord.sub,A);
}finally{await w.close();}});

test('L3: a fan-out never reaches an admin twice when it leaves after a live page already covered it',async()=>{
 const w=await bgWorld(92),template=await w.member(E);try{
  for(let i=4;i<300;i++){const principal=p(uuid(30000+i)),key=principalKey(principal),row={...structuredClone(template),id:'seed'+i,principal};await w.metadata.put('org/member/'+key,row);await w.metadata.put('org/member-id/'+row.id,key);await w.metadata.put('org/admin/'+key,row.id);}
  const r=await w.metadata.get('org/record-v1');r.roster.live=300;delete r.roster.ix;await w.metadata.put('org/record-v1',r);await w.sync();
  const leaver=uuid(30000+5),gone=await w.member(leaver);w.people.set(leaver,{kind:'person',status:'active',handle:'leaver'});
  const got=[];let left=false;
  w.service.memberEvents=async e=>{if(e.type!=='break-glass-start')return true;got.push(...e.recipients);
   // After page 0 (which listed the leaver), the leaver leaves; page 1 still follows.
   if(e.page.index===0&&!left){left=true;assert.ok(e.recipients.includes(gone.id));await w.run('orgs.leave',leaver,{});}
   return true;};
  await w.start();for(let i=0;i<10;i++)await w.run('orgs.member-outbox-drain','system');
  assert.ok(left);assert.equal(got.filter(id=>id===gone.id).length,1,'the leaver is told once');assert.equal(got.length,new Set(got).size,'no admin twice');
  assert.equal(new Set(got).size,300,'every admin of the snapshot, the leaver included');
 }finally{await w.close();}
});
