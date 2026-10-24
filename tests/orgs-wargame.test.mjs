// Regression tests for the 2026-10-23 organizations wargame (F-01–F-05 and the plausible items the coordinator owns),
// at the ngin engine level over the real OrganizationBilling and the offline Polar model. Each test fails if its fix is
// reverted. F-06/F-07 live in tests/orgs-member-token-cap.test.mjs and tests/orgs-key-cache-capacity.test.mjs; the
// 5,000-member scale test is tests/orgs-scale.test.mjs (npm run test:organizations). Seeded chaos: CHAOS_SEED=N.
import test from 'node:test';
import assert from 'node:assert/strict';
import {world,uuid,p,rejects,freshStats,storedSizes,A,B,C,E,DAY,ORG} from './helpers/org-world.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {OWNERSHIP,billingStanding} from '../packages/orgs/ownership.mjs';
import {organizationPowers} from '../packages/orgs/authority.mjs';
import {principalKey,memberPowers} from '../packages/orgs/grants.mjs';
import {ORG_MUTED_LIMIT} from '../packages/orgs/memberships.mjs';
import {ORG_KEYS,ORG_ROW_BYTES,ORG_RETENTION_MS,openRequest} from '../packages/orgs/roster.mjs';
import {OrganizationBilling} from '../packages/billing/organizations.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';

const DO_VALUE_LIMIT=2_000_000,G=[{resource:'https://3sln.example/r/1',methods:{'https://contract.example/v1':['get','put']}}];
const largest=async w=>(await storedSizes(w.metadata))[0];

// ---- F-01: mute ---------------------------------------------------------------------------------------------------
test('F-01: a plain member cannot grow any stored value with junk mutes (t01)',async()=>{const w=await world();try{
 await w.join(E,[]);
 for(let i=0;i<270;i++)await rejects(w.run('orgs.mute-requests',E,{requester:{iss:'https://x.example/'+i,sub:String(i).padEnd(7800,'z')},muted:true}),'invalid_request');
 // Valid principals are stored whoever they are, up to the cap; the list never grows past it.
 for(let i=0;i<64;i++)assert.deepEqual(await w.run('orgs.mute-requests',E,{requester:{iss:'https://x.example',sub:uuid(900000+i)},muted:true}),{muted:true});
 for(let i=64;i<100;i++)await rejects(w.run('orgs.mute-requests',E,{requester:{iss:'https://x.example',sub:uuid(900000+i)},muted:true}),'mute_limit');
 assert.equal((await w.member(E)).mutedRequesters.length,64);
 const top=await largest(w);assert.ok(top.bytes<ORG_ROW_BYTES&&top.bytes<DO_VALUE_LIMIT,`${top.key} is ${top.bytes} bytes`);
 for(const bad of [{iss:'http://x.example',sub:uuid(1)},{iss:'https://x.example/path',sub:uuid(1)},{iss:'https://x.example',sub:'not-a-uuid'},{iss:'https://x.example',sub:uuid(1),extra:1},null])await rejects(w.run('orgs.mute-requests',E,{requester:bad,muted:true}),'invalid_request');
}finally{await w.close();}});
test('F-01: any valid principal is stored, whoever it is, and the list is capped',async()=>{const w=await world();try{
 await w.join(E,[]);await w.join(B);await w.run('orgs.leave',B);await w.join(C);
 for(const sub of [B,C,uuid(777777)])await w.run('orgs.mute-requests',E,{requester:p(sub),muted:true});
 assert.deepEqual((await w.member(E)).mutedRequesters.map(x=>x.sub).sort(),[B,C,uuid(777777)].sort(),'a former member, a member and a stranger alike');
 await w.run('orgs.mute-requests',E,{requester:p(B),muted:false});assert.equal((await w.member(E)).mutedRequesters.length,2);
 for(let i=1;i<=62;i++)await w.run('orgs.mute-requests',E,{requester:p(uuid(i)),muted:true});
 assert.equal((await w.member(E)).mutedRequesters.length,ORG_MUTED_LIMIT);
 await rejects(w.run('orgs.mute-requests',E,{requester:p(B),muted:true}),'mute_limit');
 assert.deepEqual(await w.run('orgs.mute-requests',E,{requester:p(C),muted:true}),{muted:true},'muting someone already listed is idempotent at the cap');
}finally{await w.close();}});
test('follow-up 2: the mute cap and the mute path reveal nothing about membership',async()=>{const w=await world();try{
 await w.join(E);
 // Before the cap: muting a member and muting a stranger do the same store work and give the same answer.
 await w.join(uuid(9001));const work=async sub=>{Object.assign(w.stats,freshStats());const out=await w.run('orgs.mute-requests',E,{requester:p(sub),muted:true});return {out,writes:w.stats.writes,lists:w.stats.lists};};
 const known=await work(uuid(9001)),unknown=await work(uuid(9999));
 assert.deepEqual(unknown.out,known.out);assert.equal(unknown.writes,known.writes,'same writes');assert.equal(unknown.lists,known.lists,'same listings');
 for(let i=1;i<63;i++){await w.join(uuid(i));await w.run('orgs.mute-requests',E,{requester:p(uuid(i)),muted:true});}
 const secret=uuid(5000);await w.join(secret);
 const probe=async sub=>{try{await w.run('orgs.mute-requests',E,{requester:p(sub),muted:true});return 'muted';}catch(e){return e.code;}};
 assert.equal(await probe(secret),'mute_limit');assert.equal(await probe(uuid(7777)),'mute_limit','a full list answers the same for a member and a stranger');
}finally{await w.close();}});
// Re-review residual (2026-10-23): when only known requesters were stored, the list length leaked membership (mute 63
// people, then the target, then one more). Every valid principal is now stored, so the outcome is the same.
test('re-review: the mute list length reveals nothing about whether the requester is a member',async()=>{
 const outcomes=[];
 for(const targetIsMember of [true,false]){const w=await world();try{
  await w.join(E);for(let i=1;i<=64;i++)await w.join(uuid(i));
  for(let i=1;i<=63;i++)await w.run('orgs.mute-requests',E,{requester:p(uuid(i)),muted:true});
  const target=uuid(5000);if(targetIsMember)await w.join(target);
  const work=async input=>{Object.assign(w.stats,freshStats());const out=await w.run('orgs.mute-requests',E,input);return {out,writes:w.stats.writes,reads:w.stats.reads};};
  const mute=await work({requester:p(target),muted:true});
  let next;try{await w.run('orgs.mute-requests',E,{requester:p(uuid(64)),muted:true});next='muted';}catch(e){next=e.code;}
  const unmute=await work({requester:p(target),muted:false});
  outcomes.push({next,mute:[mute.out,mute.writes,mute.reads],unmute:[unmute.out,unmute.writes,unmute.reads]});
 }finally{await w.close();}}
 assert.equal(outcomes[0].next,'mute_limit');assert.deepEqual(outcomes[0],outcomes[1],'member and non-member targets are indistinguishable');
});
test('F-01: mute follows ORGANIZATIONS_ENABLED; decisions stay open',async()=>{const w=await world();try{
 await w.join(E,[]);await w.join(B);w.flag.on=false;
 await rejects(w.run('orgs.mute-requests',E,{requester:p(B),muted:true}),'not_found');
 assert.equal((await w.member(E)).mutedRequesters,undefined);
 await rejects(w.run('orgs.decide-grants',E,{request:'00000000-0000-4000-8000-000000000000',decision:'reject'}),'not_found');
}finally{await w.close();}});
test('F-01: every membership row is held to the byte budget; per-member client lists are capped',async()=>{const w=await world();try{
 const e=await w.join(E,[]);
 await rejects(w.run('orgs.member-grants',A,{membership:e.id,grants:[{resource:'https://3sln.example/'+'r'.repeat(ORG_ROW_BYTES),methods:{c:['get']}}]}),'member_row_limit');
 assert.deepEqual((await w.member(E)).grants,[],'a refused row rolls the whole transaction back');
 for(let i=0;i<32;i++)await w.run('orgs.member-context',E,{client:`https://app${i}.example/client.json`});
 // Review follow-up 8: past the cap the least recently used client is forgotten, never a lockout.
 await w.run('orgs.member-context',E,{client:'https://app0.example/client.json'});
 await w.run('orgs.member-context',E,{client:'https://one-more.example/client.json'});
 const clients=(await w.member(E)).contextClients;assert.equal(clients.length,32);assert.equal(clients.at(-1),'https://one-more.example/client.json');
 assert.ok(clients.includes('https://app0.example/client.json'),'a recently used client stays');assert.ok(!clients.includes('https://app1.example/client.json'),'the least recently used is forgotten');
 await rejects(w.run('orgs.member-context',E,{client:'https://'+'x'.repeat(1100)+'.example'}),'invalid_request');
}finally{await w.close();}});

// ---- F-02: the roster outside the record ------------------------------------------------------------------------
test('F-02: delivered outbox events, finished invitations and closed requests are pruned after the retention window (t02)',async()=>{const w=await world();try{
 w.service.memberEvents=async()=>true;
 const b=await w.join(B,[{power:'admin'}]);w.clock.advance(3*DAY);
 await w.run('orgs.remove-member',A,{membership:b.id,reason:'Offboarding'});
 const {requests}=await w.run('orgs.members',A);await w.run('orgs.decide-grants',A,{request:requests[0].id,decision:'retract'});
 for(let i=1;i<=40;i++){await w.join(uuid(i));await w.run('orgs.leave',uuid(i));}
 for(let k=0;k<10;k++)await w.run('orgs.member-outbox-drain','system');
 let r=await w.record();assert.ok(r.memberOutbox.filter(e=>e.deliveredAt).length>40);
 w.clock.advance(ORG_RETENTION_MS-DAY);await w.sweep();r=await w.record();assert.ok(Object.values(r.invitations).length>=40,'kept within the window');
 w.clock.advance(400*DAY);for(let k=0;k<4;k++)await w.sweep();
 r=await w.record();const delivered=r.memberOutbox.filter(e=>e.deliveredAt).length,closed=Object.values(r.invitations).filter(i=>i.state!=='pending').length,requestsLeft=Object.values(r.grantRequests).length;
 assert.ok(delivered<=8&&closed<=8&&requestsLeft===0,`after a year: ${delivered} delivered outbox rows, ${closed} finished invitations, ${requestsLeft} closed requests`);
 assert.equal(r.roster.live,1+1,'owner and B are the live members');
}finally{await w.close();}});
test('F-02: no stored value grows with the roster, and a join, a sweep, an admin decision and the default member listing cost the same at 100 and 800 members',async()=>{const w=await world(1,{plan:'org-scale'});try{
 const measure=async fn=>{Object.assign(w.stats,freshStats());await fn();return {...w.stats};};
 const cost=async n=>{const join=await measure(()=>w.join(uuid(100000+n),G)),sweep=await measure(()=>w.sweep()),grants=await measure(()=>w.run('orgs.member-grants',A,{membership:w.lastId,grants:[]})),members=await measure(()=>w.run('orgs.members',A));return {join,sweep,grants,members};};
 let n=0;const grow=async to=>{while(n<to){n++;const m=await w.join(uuid(n),G);w.lastId=m.id;}};
 await grow(100);const small=await cost(1);await grow(800);const large=await cost(2);
 for(const k of ['join','sweep','grants','members'])for(const metric of ['reads','writes','readBytes','writeBytes'])assert.ok(large[k][metric]<=small[k][metric]*1.25+64,`${k} ${metric}: ${small[k][metric]} at 100 members, ${large[k][metric]} at 800`);
 const top=await largest(w);assert.ok(top.bytes<16*1024,`largest stored value ${top.key}: ${top.bytes} bytes`);
 assert.equal((await w.summary()).roster.live,803);
}finally{await w.close();}});
test('follow-up 7: one failing sweep step neither stalls nor rolls back the others; it backs off and retries',async()=>{const w=await world();try{
 const poisoned=await w.run('orgs.invite',A,{invitee:p(B),grants:[],expiresAt:w.clock.now()+1000});
 const healthy=[];for(let i=1;i<=5;i++)healthy.push((await w.run('orgs.invite',A,{invitee:p(uuid(i)),grants:[],expiresAt:w.clock.now()+2000})).invitation);
 const step=w.service.dueStep.bind(w.service);let failures=0;
 w.service.dueStep=async(r,roster,entry,...rest)=>{if(entry.ref===poisoned.invitation){failures++;throw Object.assign(new Error('boom'),{code:'step_boom'});}return step(r,roster,entry,...rest);};
 w.clock.advance(3000);const {wakeAt}=await w.sweep();
 const r=await w.record();for(const id of healthy)assert.equal(r.invitations[id].state,'expired','the healthy steps committed');
 assert.equal(r.invitations[poisoned.invitation].state,'pending');assert.equal(failures,1,'the failing step ran once, not in a loop');
 const retry=[...(await w.metadata.list({prefix:'org/due/'})).values()].find(e=>e.ref===poisoned.invitation);assert.equal(retry.attempts,1);assert.ok(retry.at>w.clock.now()&&wakeAt<=retry.at);
 w.service.dueStep=step;w.clock.advance(retry.at-w.clock.now());await w.sweep();assert.equal((await w.record()).invitations[poisoned.invitation].state,'expired','retried after its back-off');
}finally{await w.close();}});
test('follow-up 8: a membership-id index entry pointing at another row resolves to nothing',async()=>{const w=await world();try{
 const a=await w.member(A);await w.metadata.put('org/member-id/forged-membership-0001',principalKey(p(A)));
 await rejects(w.run('orgs.remove-member',A,{membership:'forged-membership-0001'}),'not_found');
 assert.equal((await w.member(A)).id,a.id);
}finally{await w.close();}});
test('scalability follow-up: the admin listing pages members and requests by cursor; every live member appears once',async()=>{const w=await world(1,{plan:'org-scale'});try{
 for(let i=1;i<=230;i++)await w.join(uuid(i));
 const admins=[];for(const sub of [B,C,E])admins.push(await w.join(sub,[{power:'admin'}]));w.clock.advance(3*DAY);for(const x of admins)await w.run('orgs.remove-member',A,{membership:x.id,reason:'Offboarding'});
 const first=await w.run('orgs.members',A);assert.equal(first.members.length<=100,true);assert.equal(typeof first.next,'string');
 const seen=new Set(first.members.map(x=>x.id));let next=first.next;
 while(next){const page=await w.run('orgs.members',A,{after:next});for(const x of page.members){assert.ok(!seen.has(x.id),'no member twice');seen.add(x.id);}next=page.next;}
 assert.equal(seen.size,(await w.summary()).roster.live);
 const small=await w.run('orgs.members',A,{limit:2});assert.equal(small.requests.length,2);const rest=await w.run('orgs.members',A,{limit:2,requestsAfter:small.requestsNext});assert.ok(rest.requests.every(q=>!small.requests.some(x=>x.id===q.id)));
 await rejects(w.run('orgs.members',A,{limit:501}),'invalid_request');
}finally{await w.close();}});
test('F-02: a refused operation leaves no partial roster rows (atomicity)',async()=>{const w=await world();try{
 const before=await storedSizes(w.metadata);
 await rejects(w.run('orgs.member-grants',A,{membership:(await w.member(A)).id,grants:[]}),'last_admin');
 await rejects(w.run('orgs.leave',A),'owner_must_be_member');
 assert.deepEqual(await storedSizes(w.metadata),before);
}finally{await w.close();}});
test('F-02 seeded chaos: roster indexes, counts and budgets stay consistent under random membership operations',async()=>forEachSeed(10,async random=>{const w=await world(random.seed);try{
 w.service.memberEvents=async()=>random.chance(0.7);
 const subs=Array.from({length:10},(_,i)=>uuid(i+1)),pick=list=>list[random.int(list.length)];
 const live=async()=>Object.values((await w.record()).memberships).filter(m=>m.state==='live');
 for(let step=0;step<60;step++){
  const kind=random.int(11),sub=pick(subs);
  try{
   if(kind===0)await w.join(sub,random.chance(0.3)?[{power:'admin'}]:G,random.chance(0.2)?{expires_at:Math.floor(w.clock.now()/1000)+random.int(5)*DAY/1000+60}:{});
   else if(kind===1)await w.run('orgs.leave',sub);
   else if(kind===2){const m=pick(await live());if(m)await w.run('orgs.remove-member',A,{membership:m.id,reason:'Chaos'});}
   else if(kind===3){const m=pick(await live());if(m)await w.run('orgs.member-grants',A,{membership:m.id,grants:random.chance(0.5)?[]:G,reason:'Chaos'});}
   else if(kind===4){const q=pick(Object.values((await w.record()).grantRequests).filter(openRequest));if(q)await w.run('orgs.decide-grants',pick([A,q.requester.sub]),{request:q.id,decision:pick(['reject','elevate','retract','accept'])});}
   else if(kind===5)await w.run('orgs.mute-requests',pick([A,sub]),{requester:p(pick([A,...subs])),muted:random.chance(0.7)});
   else if(kind===6)await w.run('orgs.invite',A,{invitee:p(sub),grants:[],expiresAt:w.clock.now()+1000+random.int(3)*DAY});
   else if(kind===7)w.clock.advance(random.int(40)*DAY/4);
   else if(kind===8)await w.sweep();
   else if(kind===9)await w.run('orgs.member-outbox-drain','system');
   else await w.service.observeAuthority(p(sub),{aep:random.int(3)});
  }catch(error){if(!error.code||error.code==='ERR_ASSERTION')throw error;}
  if(step%10===9)await invariants(w);
 }
 await invariants(w);
}finally{await w.close();}}));
async function invariants(w){
 const rows=new Map([...await w.metadata.list({prefix:'org/'})]),r=await w.record(),now=w.clock.now(),keys=prefix=>[...rows.keys()].filter(k=>k.startsWith(prefix));
 const members=Object.entries(r.memberships);
 assert.equal(r.roster.live,members.filter(([,m])=>m.state==='live').length,'live count');
 for(const [key,m] of members){
  assert.equal(rows.get(ORG_KEYS.memberId+m.id),key,'membership id index');
  assert.equal(rows.has(ORG_KEYS.admin+key),m.state==='live'&&m.grants.some(g=>g.power==='admin'),'admin index');
  assert.ok((m.mutedRequesters??[]).length<=ORG_MUTED_LIMIT);
  if(samePrincipalOwner(r,m))assert.equal(m.state,'live','the owner of record stays a member');
 }
 assert.ok(members.some(([,m])=>memberPowers(m,now).includes('admin'))||members.some(([,m])=>m.state==='live'&&m.grants.some(g=>g.power==='admin')),'an admin remains');
 for(const q of Object.values(r.grantRequests)){
  assert.equal(rows.has(ORG_KEYS.requestOpen+q.id),openRequest(q),'open request index');
  assert.ok(rows.has(ORG_KEYS.requestTarget+q.target+'/'+q.id)&&rows.has(ORG_KEYS.requestBy+principalKey(q.requester)+'/'+q.id),'request indexes');
  // A membership change closes the requests it made stale (settle), and an ended requester's requests close too.
  if(openRequest(q)){const m=Object.values(r.memberships).find(x=>x.id===q.target);assert.ok(m?.state==='live'&&m.generation===q.generation&&JSON.stringify(m.grants)===JSON.stringify(q.base),'no stale open request');assert.equal(r.memberships[principalKey(q.requester)]?.state??'live','live','no open request by an ended member');}
 }
 for(const i of Object.values(r.invitations))assert.equal(rows.has(ORG_KEYS.invitationOpen+i.id),i.state==='pending','open invitation index');
 assert.equal(keys(ORG_KEYS.memberId).length,members.length);assert.equal(keys(ORG_KEYS.requestOpen).length,Object.values(r.grantRequests).filter(openRequest).length);
 for(const [key,value] of rows)assert.ok(JSON.stringify(value).length<ORG_ROW_BYTES,`${key} within the row budget`);
}
const samePrincipalOwner=(r,m)=>m.principal.sub===r.ownerOfRecord.sub&&(m.principal.iss??null)===(r.ownerOfRecord.iss??null);

// ---- F-03: a held owner can pay; an objected hold escalates the claim ---------------------------------------------
async function heldOwner(){
 const w=await world();await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 await w.service.observeAuthority(p(A),{aep:1});const a=await w.member(A);
 await w.run('orgs.reconfirm',A,{membership:a.id,aep:1,decision:'notice'},{aep:1});
 await w.run('orgs.reconfirm',C,{membership:a.id,aep:1,decision:'object'});
 w.clock.advance(10*DAY);await w.sweep();assert.ok((await w.member(A)).hold,'objection keeps the owner held');
 return w;
}
test('F-03: a held owner of record can still renew, and sees the renew decision (t03)',async()=>{const w=await heldOwner();try{
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();
 assert.ok(!organizationPowers(await w.service.load([p(A)]),p(A),{now:w.clock.now()}).includes('owner-of-record'),'governance stays held');
 const view=await w.run('orgs.ownership',A,{},{aep:1});assert.ok(view.decisions.includes('renew'));assert.ok(!view.decisions.includes('offer'),'no governance decision while held');
 const out=await w.run('orgs.billing-checkout',A,{plan:'org-team'},{aep:1});assert.ok(out.checkout.url);
 await rejects(w.run('orgs.billing-checkout',C,{plan:'org-team'}),'not_found');
}finally{await w.close();}});
test('F-03: an objecting admin cannot seize the organization through the lapse claim; paying defeats it, otherwise it escalates (t03)',async()=>{
 for(const pays of [true,false]){const w=await heldOwner();try{
  w.polar.lapse(w.ownerSub.subscription);await w.webhook();
  w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
  await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});w.payLatest('claim');await w.webhook();
  assert.equal((await w.summary()).billing.claim.state,'pending');
  if(pays){await w.run('orgs.billing-checkout',A,{plan:'org-team'},{aep:1});w.payLatest('renew');await w.webhook();assert.equal((await w.summary()).billing.claim.closedReason,'owner-paid');}
  w.clock.advance(3*DAY+1000);await w.sync();
  const r=await w.summary();assert.equal(r.ownerOfRecord.sub,A,'ownership was not seized');
  if(!pays){assert.equal(r.billing.claim.state,'pending');assert.ok(Number.isSafeInteger(r.billing.claim.escalatedAt));assert.equal(w.alerts.filter(a=>a.reason==='claim-owner-hold-objected').length,1);await w.sync();assert.equal(w.alerts.filter(a=>a.reason==='claim-owner-hold-objected').length,1,'one alert per escalation');}
 }finally{await w.close();}}
});

// Review follow-up 6: an escalated claim is bounded (30 days, then closed with every bound order refunded), an operator
// can resolve it, and the held owner's view shows billing and renew only.
async function escalatedClaim(){
 const w=await heldOwner();w.polar.lapse(w.ownerSub.subscription);await w.webhook();
 w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});const paid=w.payLatest('claim');await w.webhook();
 w.clock.advance(3*DAY+1000);await w.sync();const c=(await w.summary()).billing.claim;assert.ok(Number.isSafeInteger(c.escalatedAt));
 return {w,claim:c,paid};
}
test('follow-up 6: an escalated claim closes after its deadline and every order bound to it is refunded',async()=>{const {w,claim,paid}=await escalatedClaim();try{
 // A second order on the claim subscription (e.g. a renewal) is refunded too, not only the first.
 const first=w.polar.orders.get(paid.order);w.polar.orders.set('ord_claim_second',{...structuredClone(first),id:'ord_claim_second',created_at:new Date(w.clock.now()).toISOString()});
 w.clock.advance(OWNERSHIP.CLAIM_ESCALATION_MS-DAY);await w.sync();assert.equal((await w.summary()).billing.claim.state,'pending','still escalated within the window');
 w.clock.advance(DAY+1000);await w.sync();await w.drain();
 const r=await w.summary();assert.equal(r.billing.claim.state,'closed');assert.equal(r.billing.claim.closedReason,'escalation-expired');assert.equal(r.ownerOfRecord.sub,A);
 assert.deepEqual(w.polar.effects.refunds.filter(x=>x.subscription===claim.payment.subscriptionId).map(x=>x.order).sort(),[paid.order,'ord_claim_second'].sort());
}finally{await w.close();}});
test('follow-up 6: an operator can close an escalated claim or let it proceed',async()=>{
 {const {w,claim}=await escalatedClaim();try{
  await rejects(w.run('orgs.claim-resolve',C,{claim:claim.id,decision:'close'}),'forbidden');
  await w.run('orgs.claim-resolve','system',{claim:claim.id,decision:'close',note:'Owner verified by support'});await w.drain();
  const r=await w.summary();assert.equal(r.billing.claim.closedReason,'operator-closed');assert.ok(w.polar.effects.refunds.some(x=>x.subscription===claim.payment.subscriptionId));
 }finally{await w.close();}}
 {const {w,claim}=await escalatedClaim();try{
  await w.run('orgs.claim-resolve','system',{claim:claim.id,decision:'proceed'});await w.sync();
  assert.equal((await w.summary()).ownerOfRecord.sub,C,'an operator-approved claim takes effect on the next fresh step');
  await rejects(w.run('orgs.claim-resolve','system',{claim:claim.id,decision:'close'}),'not_found');
 }finally{await w.close();}}
});
test('follow-up 6: a held owner sees billing and the renew decision only',async()=>{const w=await heldOwner();try{
 await w.offer(B).catch(()=>{});w.polar.lapse(w.ownerSub.subscription);await w.webhook();
 const view=await w.run('orgs.ownership',A,{},{aep:1});
 assert.deepEqual(Object.keys(view).sort(),['billing','decisions','organization']);assert.deepEqual(view.decisions,['renew']);
}finally{await w.close();}});

// Re-review item 2: the pinned Polar SDK takes no idempotency key on refunds.create, so overlapping ownership drains
// are serialized by a lease; a refund is created once per order however the drains interleave.
test('re-review: overlapping ownership drains create each refund once',async()=>{const w=await world();try{
 const stray=w.polar.subscribe({org:ORG,owner:C,purpose:'claim',binding:'no-such-claim'});await w.sync();
 assert.ok((await w.summary()).ownershipOutbox.some(e=>e.kind==='refund'&&e.subscriptionId===stray.subscription&&!e.doneAt));
 const get=w.polar.client.orders.get;w.polar.client.orders.get=async id=>{const o=await get(id);await new Promise(r=>setTimeout(r,30));return o;};
 const actor={kind:'system',owner:ORG},results=await Promise.allSettled([w.service.drainOwnership(actor),w.service.drainOwnership(actor)]);
 w.polar.client.orders.get=get;
 assert.equal(w.polar.calls.filter(([name,body])=>name==='refunds.create'&&body.order_id===stray.order).length,1,'one refund call for the order');
 assert.ok(results.every(x=>x.status==='fulfilled'));assert.ok(results.some(x=>x.value.leased===false),'the overlapping run backed off');
 assert.equal(await w.metadata.get('org/ownership-drain-lease'),undefined,'the lease is released');
 await w.drain();assert.ok((await w.summary()).ownershipOutbox.filter(e=>e.subscriptionId===stray.subscription).every(e=>e.doneAt));
}finally{await w.close();}});

// ---- F-04 ---------------------------------------------------------------------------------------------------------
test('F-04: ownership transferred to a member with a membership expiry clears it; the owner never loses owner-of-record (t04)',async()=>{const w=await world();try{
 const until=Math.floor(w.clock.now()/1000)+60*86400;await w.join(B,[],{expires_at:until});
 await w.offer(B);await w.accept(B);w.payLatest();await w.webhook();w.clock.advance(DAY+1000);await w.sync();
 assert.equal((await w.summary()).ownerOfRecord.sub,B,'transfer effective');
 const b=await w.member(B);assert.equal(b.expires_at,undefined);assert.equal(b.expiryBlocked,undefined);
 w.clock.advance(61*DAY);await w.sweep();
 assert.ok(organizationPowers(await w.service.load([p(B)]),p(B),{now:w.clock.now()}).includes('owner-of-record'));assert.equal((await w.member(B)).state,'live');
}finally{await w.close();}});

// ---- F-05: subscription capacity, claim checkouts ----------------------------------------------------------------
test('F-05: repeated claim checkouts never wedge reconciliation; an owner who pays is observed (t05)',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 const ids=[];for(let i=0;i<15;i++){await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true});ids.push(w.polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']==='claim').id);}
 assert.equal(new Set(ids).size,1,'the open claim checkout is reused');
 for(const id of ids)w.polar.pay(id);await w.webhook();await w.drain();
 await w.run('orgs.billing-checkout',A,{plan:'org-team'});w.payLatest('renew');
 let error=null;try{await w.sync();}catch(e){error=e.code;}
 assert.equal(error,null,'reconciliation refused: '+error);
 assert.equal(billingStanding(await w.summary(),w.clock.now(),{configured:true}).standing,'paid');assert.equal((await w.summary()).billing.claim.closedReason,'owner-paid');
 // Later in the paid year, past the retention window: still reconciled and paid, with settled subscriptions forgotten.
 w.clock.advance(200*DAY);try{await w.sync();}catch(e){error=e.code;}await w.drain();await w.sync();
 assert.equal(error,null,'reconciliation refused: '+error);
 const after=await w.summary();assert.equal(billingStanding(after,w.clock.now(),{configured:true}).standing,'paid');
 assert.ok(Object.keys(after.billing.subscriptions).length<=4,`settled subscriptions are forgotten (${Object.keys(after.billing.subscriptions).length} tracked)`);
 assert.ok(Object.keys(after.billing.handled).every(id=>after.billing.subscriptions[id]),'no dangling handled entry');
}finally{await w.close();}});
test('F-05: claim checkouts are bound to the current claim and rate-limited; a superseded claim\'s payment is refunded',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 const first=await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true}),firstCheckout=w.polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']==='claim').id;
 const second=await w.run('orgs.claim-start',C,{plan:'org-business',confirm:true});assert.notEqual(second.claim.id,first.claim.id);
 const r=await w.summary();assert.equal(r.billing.claimHistory.at(-1).state,'closed');assert.equal(r.billing.claimHistory.at(-1).closedReason,'superseded');
 await w.run('orgs.claim-start',C,{plan:'org-scale',confirm:true});await w.run('orgs.claim-start',C,{plan:'org-team',confirm:true,currency:'eur'});
 await rejects(w.run('orgs.claim-start',C,{plan:'org-business',confirm:true,currency:'eur'}),'claim_limit');
 // Paying the superseded first checkout does not advance anything: it is refunded as unbound.
 w.polar.pay(firstCheckout);await w.webhook();await w.drain();
 assert.equal((await w.summary()).billing.claim.state,'awaiting-payment');assert.equal(w.polar.effects.refunds.length,1);
 w.clock.advance(DAY+1);await w.tick();await w.run('orgs.claim-start',C,{plan:'org-business',confirm:true,currency:'eur'});
}finally{await w.close();}});
test('F-05: ended subscriptions are not re-read, so however many there were they never reach the capacity, and are later forgotten',async()=>{const w=await world();try{
 const ended=[];for(let i=0;i<17;i++){const s=w.polar.subscribe({org:ORG,owner:A,purpose:'renew',binding:'renew-old-'+i});w.polar.lapse(s.subscription);ended.push(s.subscription);}
 // Tracked earlier, ended at the provider, never revoked or refunded by us (natural expiry).
 await w.metadata.transaction(async tx=>{const r=await tx.get('org/record-v1'),now=w.clock.now();for(const id of ended)r.billing.subscriptions[id]={id,owner:A,purpose:'renew',binding:'x',amount:120000,currency:'usd',paidThrough:now,endedAt:now,status:'canceled',firstSeenAt:now-DAY};await tx.put('org/record-v1',r);});
 await w.sync();assert.equal(billingStanding(await w.summary(),w.clock.now(),{configured:true}).standing,'paid');
 w.clock.advance(OWNERSHIP.BILLING_RETENTION_MS+DAY);await w.sync();
 const r=await w.summary();assert.ok(ended.every(id=>!r.billing.subscriptions[id]),'ended subscriptions are forgotten after the retention window');
}finally{await w.close();}});
test('follow-up 4: concurrent claim starts re-check reuse and the daily limit on the committed record',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 // Straight to the service: the engine serializes actions, while the account's own gate interleaves async work.
 const start=input=>w.service.claimStart(w.act(C),{confirm:true,...input});
 const [a,b]=await Promise.all([start({plan:'org-team'}),start({plan:'org-team'})]);
 assert.equal(a.claim.id,b.claim.id,'the same admin\'s concurrent starts for the same terms share one claim');
 assert.equal(((await w.summary()).billing.claimHistory??[]).length,0,'nothing was superseded');
 await start({plan:'org-business'});await start({plan:'org-scale'});
 const results=await Promise.allSettled([start({plan:'org-team',currency:'eur'}),start({plan:'org-business',currency:'eur'})]);
 assert.deepEqual(results.map(x=>x.status).sort(),['fulfilled','rejected']);assert.equal(results.find(x=>x.status==='rejected').reason.code,'claim_limit');
 const r=await w.summary();assert.equal([...r.billing.claimHistory,r.billing.claim].filter(c=>c.createdAt>w.clock.now()-DAY).length,OWNERSHIP.CLAIM_CHECKOUTS_PER_DAY);
}finally{await w.close();}});
test('F-05: the provider port counts only live or held subscriptions toward its limit',async()=>{
 const clock={now:()=>1_800_000_000_000},polar=fakeOrgPolar({clock});const billing=new OrganizationBilling({config:ORG_POLAR_CONFIG,client:polar.client,now:clock.now});
 const subs=[];for(let i=0;i<20;i++)subs.push(polar.subscribe({org:ORG,owner:A,purpose:'claim',binding:'claim-'+i}).subscription);
 await assert.rejects(billing.state(ORG,{known:Object.fromEntries(subs.map(id=>[id,{amount:120000,currency:'usd'}]))}),e=>e.code==='billing_subscription_capacity');
 for(const id of subs.slice(0,6))polar.lapse(id);
 const state=await billing.state(ORG,{known:Object.fromEntries(subs.map((id,i)=>[id,{amount:120000,currency:'usd',...i<6?{settled:true}:{}}]))});
 assert.equal(state.subscriptions.length,20);
});

// ---- plausible items ----------------------------------------------------------------------------------------------
test('item 1: a failing outbox event never blocks the events behind it; each retries on its own back-off',async()=>{const w=await world();try{
 for(let i=1;i<=40;i++)await w.join(uuid(i));
 const poison=new Set((await w.record()).memberOutbox.slice(0,32).map(e=>e.id)),delivered=new Set();
 w.service.memberEvents=async e=>{if(poison.has(e.id))return false;delivered.add(e.id);return true;};
 for(let k=0;k<4;k++){await w.run('orgs.member-outbox-drain','system');w.clock.advance(1000);}
 const r=await w.record(),others=r.memberOutbox.filter(e=>!poison.has(e.id));
 assert.ok(others.length>0&&others.every(e=>e.deliveredAt),`${others.filter(e=>!e.deliveredAt).length} healthy events stuck behind failing ones`);
 assert.ok(r.memberOutbox.filter(e=>poison.has(e.id)).every(e=>e.attempts>=1&&e.nextAt>w.clock.now()),'failures back off');
 const wake=(await w.sweep()).wakeAt;assert.ok(wake>w.clock.now());
}finally{await w.close();}});
test('item 2: ending a membership closes the requests that member made',async()=>{const w=await world();try{
 const b=await w.join(B,[{power:'admin'}]),c=await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 const {request:q}=await w.run('orgs.remove-member',B,{membership:c.id,reason:'Not needed'});assert.equal(q.state,'subject');
 await w.run('orgs.remove-member',A,{membership:b.id,reason:'Offboarding'}).then(({request})=>w.run('orgs.decide-grants',B,{request:request.id,decision:'accept'}));
 assert.equal((await w.member(B)).state,'ended');
 const after=(await w.record()).grantRequests[q.id];assert.equal(after.state,'closed','a removed member\'s request does not stay open for the owner to accept');
 assert.ok([...(await w.metadata.list({prefix:'org/audit/'})).values()].some(e=>e.action==='member-grant-request-closed'&&e.request===q.id));
}finally{await w.close();}});
test('item 3: a new subscription failing today\'s price check is held with an operator alert, never silently dropped',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);
 const s=w.polar.subscribe({org:ORG,owner:C,purpose:'claim',binding:'claim-x'});w.polar.subscriptions.get(s.subscription).amount=1;
 await w.sync();const r=await w.summary(),held=r.billing.subscriptions[s.subscription];
 assert.equal(held?.hold?.reason,'unverifiable');assert.equal(w.alerts.at(-1).reason,'subscription-unverifiable');
 assert.equal(billingStanding(r,w.clock.now(),{configured:true}).held,true);
 w.polar.subscriptions.get(s.subscription).amount=120000;await w.sync();assert.equal((await w.summary()).billing.subscriptions[s.subscription].hold,undefined,'reconciled: the hold clears');
}finally{await w.close();}});
test('item 4: a refunded earlier-period order does not mark the current period refunded',async()=>{
 let now=1_800_000_000_000;const clock={now:()=>now},polar=fakeOrgPolar({clock}),billing=new OrganizationBilling({config:ORG_POLAR_CONFIG,client:polar.client,now:clock.now});
 const s=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'test-request-00001'}),sub=polar.subscriptions.get(s.subscription),first=polar.orders.get(s.order);
 first.status='refunded';first.refunded_amount=first.net_amount;first.created_at=new Date(now-400*DAY).toISOString();
 sub.current_period_start=new Date(now-DAY).toISOString();sub.current_period_end=new Date(now+364*DAY).toISOString();
 polar.orders.set('ord_renewal',{...structuredClone(first),id:'ord_renewal',status:'paid',refunded_amount:0,created_at:new Date(now-DAY).toISOString()});
 const [v]=(await billing.state(ORG,{})).subscriptions;assert.equal(v.refunded,false);assert.equal(v.paid,true);assert.equal(v.orderId,'ord_renewal');
 polar.orders.get('ord_renewal').status='refunded';polar.orders.get('ord_renewal').refunded_amount=first.net_amount;
 const [x]=(await billing.state(ORG,{})).subscriptions;assert.equal(x.refunded,true,'the current period refunded is still refunded');
});
test('item 6: the audit read is bounded and paginated; it never reads the whole log',async()=>{const w=await world();try{
 for(let i=1;i<=110;i++)await w.join(uuid(i));
 const seq=(await w.summary()).auditSeq;
 Object.assign(w.stats,freshStats());const page=await w.run('orgs.audit',A,{limit:10});
 assert.deepEqual(page.entries.map(e=>e.seq),Array.from({length:10},(_,i)=>seq-9+i));assert.equal(page.next,seq-9);
 assert.ok(w.stats.reads<40,`one page read ${w.stats.reads} rows`);
 const older=await w.run('orgs.audit',A,{limit:10,before:page.next});assert.equal(older.entries.at(-1).seq,seq-10);
 const all=await w.run('orgs.audit',A,{limit:500});assert.equal(all.entries.length,200,'at most 200 per page');
 await rejects(w.run('orgs.audit',A,{limit:0}),'invalid_request');await rejects(w.run('orgs.audit',A,{cursor:'x'}),'invalid_request');
}finally{await w.close();}});
test('item 8: a claim is judged on the standing of the record it commits, not an earlier read',async()=>{const w=await world();try{
 await w.join(C,[{power:'admin'}]);w.clock.advance(3*DAY);
 w.polar.lapse(w.ownerSub.subscription);await w.webhook();w.clock.advance(OWNERSHIP.GRACE_MS+OWNERSHIP.CLAIM_AFTER_READ_ONLY_MS);await w.tick();
 // The owner pays and is reconciled after the claim checkout is created and before the claim commits.
 const checkout=w.billing.checkout.bind(w.billing),transaction=w.store.transaction;let armed=false;
 w.billing.checkout=async(...args)=>{const out=await checkout(...args);if(args[1].purpose==='claim')armed=true;return out;};
 w.store.transaction=async fn=>{if(armed){armed=false;w.polar.subscribe({org:ORG,owner:A,purpose:'renew',binding:'renew-race'});await w.service.sync({kind:'system',owner:ORG});}return transaction(fn);};
 await rejects(w.run('orgs.claim-start',C,{plan:'org-team',confirm:true}),'claim_unavailable');
 w.store.transaction=transaction;assert.equal((await w.summary()).billing.claim,null);
}finally{await w.close();}});
