// Store-work regressions for the 2026-10-24 "Break-glass and ownership outbox scaling" fixes (probe cliffs #1 and #2,
// scratchpad scale2/REPORT.md). Engine level, real SQLite metadata, production operations; loopback fixtures only.
//  #1  an organization where every member is an admin: start, co-sign, objection and abort succeed at 50, 500 and 5,000
//      members with bounded store work (flat from 500 to 5,000; below ORG_INLINE_ADMINS admins the notice still lists
//      its recipients inline), and fan-out notices reach exactly the admins of their snapshot.
//  #2  the ownership outbox at 10, 100, 1,000 and 5,000 effects: the record stays small, no stored value passes 128 KiB,
//      appending and draining cost the same at every size, and the done rows stay capped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bgWorld,rejects,A,B,C,E,p} from './helpers/break-glass-world.mjs';
import {uuid,freshStats,storedSizes,ORG} from './helpers/org-world.mjs';
import {principalKey} from '../packages/orgs/grants.mjs';
import {OWNERSHIP} from '../packages/orgs/ownership.mjs';
import {ADMIN_KEYS,ORG_INLINE_ADMINS} from '../packages/orgs/admin-index.mjs';
import {EFFECT_KEYS,loadEffect,pendingEffects} from '../packages/orgs/ownership-effects.mjs';

const KIB=1024,SYS={kind:'system',owner:ORG};
/** Every member an admin: `n` members in all (the owner and B, C, E included), bulk-seeded from E's real row the way the
 * probe did, then the one-time admin index migration runs in an ordinary system commit. */
async function allAdmins(n,seed=n){
 const w=await bgWorld(seed),template=await w.member(E);
 for(let i=4;i<n;i++){const principal=p(uuid(20000+i)),key=principalKey(principal),row={...structuredClone(template),id:'seed'+i,principal};
  await w.metadata.put('org/member/'+key,row);await w.metadata.put('org/member-id/'+row.id,key);await w.metadata.put('org/admin/'+key,row.id);}
 const r=await w.metadata.get('org/record-v1');r.roster.live=n;delete r.roster.ix;await w.metadata.put('org/record-v1',r);
 await w.sync();const after=await w.metadata.get('org/record-v1');assert.equal(after.roster.admins,n,'the migration counted every admin');
 return w;
}
const metered=async(w,fn)=>{Object.assign(w.stats,freshStats());await fn();return {...w.stats};};

test('#1: break-glass in an all-admin organization of 50, 500 and 5,000 members succeeds with bounded, flat store work',{timeout:300000},async()=>{
 const cost={};
 for(const n of [50,500,5000]){const w=await allAdmins(n);try{
  const ops={};
  ops.start=await metered(w,()=>w.start());assert.equal((await w.claim()).state,'gathering',`${n}: started`);
  ops.cosign=await metered(w,()=>w.cosign(C));assert.equal((await w.claim()).cosigners.length,1);
  ops.object=await metered(w,async()=>w.run('orgs.breakglass-object',E,{claim:(await w.claim()).id}));assert.equal((await w.claim()).objections.length,1);
  ops.abort=await metered(w,()=>w.abort());assert.equal((await w.claim()).state,'aborted',`${n}: aborted`);
  ops.view=await metered(w,()=>w.run('orgs.breakglass',E));
  for(const [op,s] of Object.entries(ops)){
   assert.ok(s.reads<=2*ORG_INLINE_ADMINS+64,`${n} ${op}: ${s.reads} reads`);assert.ok(s.readBytes<=96*KIB,`${n} ${op}: ${s.readBytes} bytes read`);
   assert.ok(s.maxValue<=16*KIB,`${n} ${op}: largest write ${s.maxValue} bytes (${s.maxKey})`);
  }
  cost[n]=ops;
  const sizes=await storedSizes(w.metadata);assert.ok(sizes[0].bytes<=128*KIB,`${n}: largest value ${sizes[0].key} ${sizes[0].bytes}`);
  const notices=[...(await w.metadata.list({prefix:'org/outbox/pending/'})).values()].filter(e=>e.type?.startsWith('break-glass-'));
  assert.equal(notices.length,4,'one admin notice per step');
  for(const e of notices)if(n>ORG_INLINE_ADMINS){assert.ok(e.fanout,'fan-out above the inline limit');assert.ok(e.recipients.length<=4,'only the named members inline');}else assert.equal(new Set(e.recipients).size,n,'inline: every admin listed');
 }finally{await w.close();}}
 for(const op of Object.keys(cost[500]))for(const metric of ['reads','readBytes','writes'])
  assert.ok(cost[5000][op][metric]<=cost[500][op][metric]*1.25+16,`${op} ${metric}: ${cost[500][op][metric]} at 500, ${cost[5000][op][metric]} at 5,000`);
});

test('#1: fan-out notices reach exactly the admins of their snapshot, once, in bounded pages; ended-admin rows are pruned',{timeout:120000},async()=>{
 const w=await allAdmins(150,7);try{
  const seen=new Map();let calls=0;
  w.service.memberEvents=async e=>{calls++;assert.ok(e.recipients.length<=257,'a page holds at most ORG_FANOUT_PAGE admins plus the named members');const s=seen.get(e.id)??{type:e.type,membership:e.membership_id,ids:[],pages:[]};s.ids.push(...e.recipients);s.pages.push(e.page?.index??null);seen.set(e.id,s);return true;};
  const admins=async()=>new Set([...(await w.metadata.list({prefix:'org/member/'})).values()].filter(m=>m.state==='live'&&m.grants.some(g=>g.power==='admin')).map(m=>m.id));
  await w.start();const atStart=await admins();
  // After the notice is queued: one admin leaves, one new admin joins. Neither changes who the start notice is for.
  const gone=await w.member(uuid(20000+5)),leaver=uuid(20000+5);w.people.set(leaver,{kind:'person',status:'active',handle:'leaver'});
  await w.run('orgs.leave',leaver,{});
  const fresh=uuid(990001);w.people.set(fresh,{kind:'person',status:'active',handle:'fresh'});const joined=await w.join(fresh,[{power:'admin'}]);
  assert.ok([...(await w.metadata.list({prefix:ADMIN_KEYS.ended})).keys()].length>=1,'the leaver is remembered for the pending fan-out');
  for(let i=0;i<20&&[...(await w.metadata.list({prefix:'org/outbox/pending/',limit:1}))].length;i++)await w.run('orgs.member-outbox-drain','system');
  assert.equal([...(await w.metadata.list({prefix:'org/outbox/pending/'}))].length,0,'everything delivered');
  const start=[...seen.values()].find(s=>s.type==='break-glass-start');
  assert.equal(start.ids.length,new Set(start.ids).size,'no admin twice');assert.deepEqual(new Set(start.ids),atStart,'exactly the admins when the claim started');
  assert.ok(start.ids.includes(gone.id)&&!start.ids.includes(joined.id));assert.deepEqual(start.pages,[0],'150 admins fit one page');
  const join=[...seen.values()].find(s=>s.type==='member-joined'&&s.membership===joined.id);assert.ok(join.ids.includes(joined.id)&&!join.ids.includes(gone.id),'a later notice follows the later admin set');
  assert.equal([...(await w.metadata.list({prefix:ADMIN_KEYS.fanout}))].length,0);assert.equal([...(await w.metadata.list({prefix:ADMIN_KEYS.ended}))].length,0,'ended-admin rows go with the last fan-out');
 }finally{await w.close();}
 const big=await allAdmins(1200,8);try{
  const pages=[];big.service.memberEvents=async e=>{if(e.type==='break-glass-start')pages.push(e);return true;};await big.start();
  Object.assign(big.stats,freshStats());await big.run('orgs.member-outbox-drain','system');assert.ok(big.stats.reads<=8*256+64,`one drain call reads ${big.stats.reads} rows`);
  for(let i=0;i<10;i++)await big.run('orgs.member-outbox-drain','system');
  const ids=pages.flatMap(e=>e.recipients);assert.equal(ids.length,new Set(ids).size);assert.equal(new Set(ids).size,1200);
  assert.deepEqual(pages.map(e=>e.page.index),[0,1,2,3,4]);assert.ok(pages.at(-1).page.final&&pages.slice(0,-1).every(e=>!e.page.final));
 }finally{await big.close();}
});

test('#1: eligibility answers are unchanged: tenure, holds, the owner and a member-initiated claim, from the indexes',{timeout:120000},async()=>{
 const w=await allAdmins(120,9);try{
  const remigrate=async()=>{const r=await w.metadata.get('org/record-v1');delete r.roster.ix;await w.metadata.put('org/record-v1',r);await w.sync();};
  const M=uuid(880001),mKey=principalKey(p(M));w.people.set(M,{kind:'person',status:'active',handle:'member'});
  // Every admin but the owner and B is younger than 30 days; M is a plain member of 100 days.
  for(const [key,m] of await w.metadata.list({prefix:'org/member/'}))if(![A,B].some(s=>key==='org/member/'+principalKey(p(s)))){m.grants=m.grants.map(g=>({...g,grantedAt:w.clock.now()-DAYS(5)}));await w.metadata.put(key,m);}
  await w.metadata.put('org/member/'+mKey,{id:'plainmember',principal:p(M),state:'live',generation:1,grants:[],aep:0,addedUnder:null,createdAt:w.clock.now()-DAYS(100)});await w.metadata.put('org/member-id/plainmember',mKey);
  await remigrate();
  const v1=await metered(w,async()=>{const v=await w.run('orgs.breakglass',M);assert.ok(!v.decisions.includes('start'),'admins are effective, so a member cannot start');});
  assert.ok(v1.reads<=32,`the member view read ${v1.reads} rows`);
  await w.start();const c=await w.claim();assert.equal(c.quorumRequired,false,'one eligible admin: no quorum');assert.ok(c.causes.includes('single-admin'));
  await w.run('orgs.breakglass-withdraw',B,{claim:c.id});
  // Every admin other than the owner held: none is effective, so the long-standing member may start (Track S).
  for(const [key,m] of await w.metadata.list({prefix:'org/member/'}))if(key!=='org/member/'+principalKey(p(A))&&m.grants.some(g=>g.power==='admin')){m.hold={aep:0,at:w.clock.now(),noticeAt:null,objected:false};await w.metadata.put(key,m);}
  await remigrate();
  const v2=await w.run('orgs.breakglass',M);assert.ok(v2.decisions.includes('start'),'no effective admin: the member may start');
  await w.start(M,M);const m2=await w.claim();assert.equal(m2.memberInitiated,true);assert.equal(m2.state,'gathering');
 }finally{await w.close();}
});
const DAYS=d=>d*86400000;

test('#2: the ownership outbox at 10, 100, 1,000 and 5,000 effects: bounded record, values under 128 KiB, flat append and drain, 128 done rows',{timeout:300000},async()=>{
 const w=await bgWorld(31);try{
  await w.start();const c=await w.claim();const append=()=>w.service.commit(SYS,async r=>{w.service.outbox(r,'ledger',{person:B,claim:c.id,event:'ended'},w.clock.now());});
  const costs={};let total=0;
  for(const count of [10,100,1000,5000]){
   await w.service.commit(SYS,async r=>{for(let i=0;i<count;i++)w.service.outbox(r,'owner-notice',{claim:c.id,owner:p(A),event:'liveness',channels:[{channel:'email',kind:'email',abort:'x'.repeat(150)}]},w.clock.now()+60000+i);});total+=count;
   const one=await metered(w,append);
   const rec=await w.metadata.get('org/record-v1');
   assert.ok(JSON.stringify(rec).length<8*KIB,`${count}: record ${JSON.stringify(rec).length} bytes`);assert.equal(rec.ownershipOutbox,undefined);
   assert.ok(pendingEffects(rec)>=count,`${count}: ${pendingEffects(rec)} pending`);
   const sizes=await storedSizes(w.metadata);assert.ok(sizes[0].bytes<=128*KIB,`${count}: ${sizes[0].key} is ${sizes[0].bytes} bytes`);
   // A full outbox refuses a new non-critical effect and never a critical one.
   const extra=()=>w.service.commit(SYS,async r=>{w.service.outbox(r,'index',{person:B,role:'member'},w.clock.now(),{critical:false});});
   if(pendingEffects(rec)>=OWNERSHIP.OUTBOX_PENDING_MAX)await rejects(extra(),'ownership_outbox_full');else await extra();
   const drain=await metered(w,()=>w.drain());
   costs[count]={append:one,drain};
   // Complete the backlog (synthetic), then one more append prunes the done rows to the cap.
   const ids=[...(await w.metadata.list({prefix:EFFECT_KEYS.due})).keys()].map(k=>k.slice(EFFECT_KEYS.due.length+16));
   await w.service.commit(SYS,async(r,now,tx)=>{for(const id of ids){const e=await loadEffect(tx,r,id);if(e&&!e.doneAt)e.doneAt=now;}});
   await append();
   const done=[...(await w.metadata.list({prefix:EFFECT_KEYS.done}))].length,after=await w.metadata.get('org/record-v1');
   assert.ok(done<=OWNERSHIP.OUTBOX_DONE_KEPT,`${count}: ${done} done rows`);assert.equal(after.ownershipEffects.done,done);
   assert.equal([...(await w.metadata.list({prefix:EFFECT_KEYS.row}))].length,done+after.ownershipEffects.pending,'no orphan rows');
  }
  for(const op of ['append','drain'])for(const metric of ['reads','readBytes'])assert.ok(costs[5000][op][metric]<=costs[10][op][metric]*1.5+256,`${op} ${metric}: ${costs[10][op][metric]} at 10, ${costs[5000][op][metric]} at 5,000`);
  assert.ok(costs[5000].drain.maxValue<=16*KIB);
 }finally{await w.close();}
});

test('#2: a legacy in-record outbox migrates once, keeps its guarantees and drains exactly once',async()=>{
 const w=await bgWorld(32);try{
  const r=await w.metadata.get('org/record-v1');
  r.ownershipOutbox=[...Array.from({length:300},(_,i)=>({id:'old-done-'+i,kind:'index',person:uuid(500+i),role:'member',createdAt:w.clock.now()-1000,doneAt:w.clock.now()-1000+i,attempts:1,nextAt:0})),
   {id:'old-pending',kind:'index',person:uuid(499),role:'member',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()},
   {id:'old-refund',kind:'refund',subscriptionId:'sub_legacy',orderId:'ord_legacy',reason:'test',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()+86400000*365}];
  await w.metadata.put('org/record-v1',r);
  assert.equal(pendingEffects(r),2,'unmigrated rows still count');
  await w.drain();
  const after=await w.metadata.get('org/record-v1');assert.equal(after.ownershipOutbox,undefined,'the array is gone');
  assert.ok(w.indexed.some(x=>x.person===uuid(499)),'the pending effect ran');assert.equal(w.indexed.filter(x=>x.person===uuid(499)).length,1);
  await w.drain();assert.equal(w.indexed.filter(x=>x.person===uuid(499)).length,1,'and never again');
  assert.ok([...(await w.metadata.list({prefix:EFFECT_KEYS.done}))].length<=OWNERSHIP.OUTBOX_DONE_KEPT);
  assert.equal(after.ownershipEffects.subs.sub_legacy,1,'a pending refund still marks its subscription');
  assert.ok(await w.metadata.get(EFFECT_KEYS.row+'old-refund'));
 }finally{await w.close();}
});
