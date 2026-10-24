// ORG-12a seeded chaos (design §12d.12): random interleavings of claim actions, owner aborts from each channel kind,
// owner sign-ins and refreshes, co-signature churn, candidate security changes and authority resets, transfer offers,
// lapse onset, file recovery start/cancel/effect, deletion scheduling and cancellation, webhook replay and duplicates,
// provider outages and stale snapshots, member removal, flag flips, operator decisions (including conflicted and
// repeated operators), clock jumps and service restarts (a fresh BreakGlassService over the same store). After every
// step the ten invariants I1–I10 are checked. The schedule is logged; rerun one seed with CHAOS_SEED=N.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed} from './helpers/chaos.mjs';
import {bgWorld,A,B,C,E,DAY,p,OP1,OP2,OP3,OP4} from './helpers/break-glass-world.mjs';
import {BREAK_GLASS_OPEN,BREAK_GLASS_TERMINAL} from '../packages/orgs/break-glass.mjs';

const STATES=new Set(),EVENTS=new Set();
const H=3600000,OPERATORS=[OP1,OP2,OP3,OP4],ADMINS=[B,C,E];
const CHANGE_AUDITS=['organization-break-glass-effect','organization-ownership-transferred','organization-lapse-claim-effective'];

async function chaos(random,{steps=90}={}){
 const w=await bgWorld(random.seed),trace=[],seen=new Set(),claims=new Map();
 const pick=list=>list[random.int(list.length)];
 const claim=()=>w.claim();
 const tolerate=async fn=>{try{return await fn();}catch(error){if(typeof error?.code!=='string'||!Number.isSafeInteger(error?.status))throw error;return {refused:error.code};}};
 // I11 (review H2): a fresh sync, with the provider up, never throws.
 const fresh=async()=>{if(outage)return tolerate(()=>w.tick());try{return await w.sync();}catch(error){
  // The provider port's documented capacity refusal (wargame F-05) asks for an operator; it is not a payment wedge.
  if(error?.code==='billing_subscription_capacity')return {refused:error.code};
  assert.fail(`I11: a fresh sync threw ${error?.code}: ${error?.message}; trace=${trace.join(',')}`);}};
 let notifyFailing=false,pushDead=false,filled=false;const begun=[];const realNotify=w.ownerChannels.notify;w.ownerChannels.notify=async(owner,n)=>notifyFailing||pushDead&&n.kind==='push'?{accepted:false}:realNotify(owner,n);
 const run=(op,sub,input,extra)=>tolerate(()=>w.run(op,sub,input,extra));
 let outage=false,flagOff=false;
 const real=w.polar.client.customers.getStateExternal;
 const actions={
  start:async()=>{const by=pick(ADMINS);return tolerate(()=>w.start(by,random.chance(0.7)?by:pick(ADMINS)));},
  accept:async()=>{const c=await claim();if(c)return run('orgs.breakglass-accept',c.candidate.sub,{claim:c.id});},
  cosign:async()=>{const c=await claim();if(c)return run('orgs.breakglass-cosign',pick(ADMINS),{claim:c.id});},
  uncosign:async()=>{const c=await claim();if(c?.cosigners?.length)return run('orgs.breakglass-uncosign',pick(c.cosigners).principal.sub,{claim:c.id});},
  pay:async()=>{const c=await claim();if(!c||c.state!=='gathering')return;const view=await tolerate(()=>w.run('orgs.breakglass',c.candidate.sub));const d=view?.claim?.disclosure?.[0];if(!d)return;
   const out=await run('orgs.breakglass-checkout',c.candidate.sub,{claim:c.id,disclosure:d.digest,confirm:true});if(out?.refused)return out;
   const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_binding']===c.id);if(k)w.polar.pay(k.id);if(!outage)return tolerate(()=>w.webhook());},
  abortTier0:async()=>{const c=await claim();if(c&&random.chance(0.25))return run('orgs.breakglass-abort',A,{claim:c.id},w.tier0(c));},
  abortTier1:async()=>{const c=await claim();if(c&&random.chance(0.3))return run('orgs.breakglass-abort',A,{claim:c.id},w.tier1(c));},
  abortToken:async()=>{await tolerate(()=>w.settle());const sent=w.ownerChannels.sent.filter(n=>n.abort);if(sent.length&&random.chance(0.3))return run('orgs.breakglass-abort-token','system',{token:pick(sent).abort});},
  signIn:async()=>{if(random.chance(0.35))return run('orgs.breakglass-liveness','system',{principal:p(A),kind:pick(['sign-in','step-up']),at:w.clock.now()});},
  refresh:async()=>run('orgs.breakglass-liveness','system',{principal:p(A),kind:'refresh',at:w.clock.now()}),
  object:async()=>{const c=await claim();if(c&&random.chance(0.4))return run('orgs.breakglass-object',pick(ADMINS),{claim:c.id});},
  withdraw:async()=>{const c=await claim();if(c&&random.chance(0.25))return run('orgs.breakglass-withdraw',pick([c.initiator.sub,c.candidate.sub]),{claim:c.id});},
  securityChange:async()=>{if(random.chance(0.1))return run('orgs.breakglass-security-change','system',{principal:p(pick(ADMINS)),at:w.clock.now()});},
  authorityReset:async()=>{if(random.chance(0.1)){const sub=pick(ADMINS),m=await w.member(sub);if(m)return run('orgs.observe-authority','system',{principal:p(sub),aep:(m.aep??0)+1});}},
  operator:async()=>{const c=await claim();if(!c)return;const decision=pick(['acknowledge','abort','proceed','proceed','proceed','uphold','reject']);if(decision==='abort'&&!random.chance(0.3))return;
   const disputed=[...new Set((c.disputes??[]).map(d=>d.channel))].filter(id=>c.channels?.some(ch=>ch.id===id));const exclude=disputed.length&&random.chance(0.5)?[pick(disputed)]:undefined;
   const operator=random.chance(0.1)?pick(ADMINS):pick(OPERATORS),process=decision==='uphold'||decision==='reject'?((await w.summary()).breakGlassContest?.claim??c.id):c.id;
   // Mostly a valid assertion for this exact scope; sometimes a forged one (another operator's), which must be refused.
   const assertion=await w.operatorAssertion(random.chance(0.1)?pick(OPERATORS):operator,{kind:'break-glass',process,decision,exclude:exclude??[]});
   return run('orgs.breakglass-resolve','system',{claim:process,operator,decision,assertion,...exclude?{exclude}:{}});},
  contest:async()=>{const r=await w.summary(),k=r.breakGlassContest;if(k){const c=await w.metadata.get('org/claim/'+k.claim);return run('orgs.breakglass-contest',A,{claim:k.claim},random.chance(0.5)?w.tier1(c):w.tier0(c));}},
  transferOffer:async()=>{if(random.chance(0.08))return tolerate(()=>w.offer(pick(ADMINS)));},
  withdrawOffer:async()=>{const t=(await w.summary()).transfer;if(t?.state==='offered')return run('orgs.transfer-withdraw',(await w.summary()).ownerOfRecord.sub,{transfer:t.id});},
  lapse:async()=>{if(random.chance(0.05)){w.polar.lapse(w.ownerSub.subscription);return tolerate(()=>w.webhook());}},
  fileRecovery:async()=>{if(random.chance(0.2))return run('orgs.breakglass-file-recovery','system',{event:pick(['started','cancelled','cancelled','effective'])});},
  deletion:async()=>{if(random.chance(0.06)){const owner=(await w.summary()).ownerOfRecord.sub;return run(random.chance(0.5)?'orgs.schedule-deletion':'orgs.cancel-deletion',owner,{});}},
  removeMember:async()=>{if(random.chance(0.05)){const sub=pick(ADMINS);return run('orgs.leave',sub,{});}},
  webhookReplay:async()=>{const id='replay_'+random.int(3);return tolerate(()=>w.webhook(id,'b'.repeat(64)));},
  outage:async()=>{outage=!outage;w.polar.client.customers.getStateExternal=outage?async()=>{throw Object.assign(Error('down'),{statusCode:503});}:real;},
  flag:async()=>{flagOff=!flagOff;w.flag.names.ORG_BREAK_GLASS_ENABLED=!flagOff;},
  clock:async()=>{w.clock.advance(pick([H,6*H,DAY,DAY,3*DAY,7*DAY,8*DAY,20*DAY,31*DAY]));const out=await fresh();if(random.chance(0.5))await tolerate(()=>w.settle());return out;},
  sync:async()=>fresh(),
  // Walks a waiting or final claim to its next deadline (the 72 h reminder, then the effect), delivering on the way.
  march:async()=>{const c=await claim();if(!c||!['waiting','final'].includes(c.state))return;const last=c.state==='waiting'?c.waitEndsAt-3*DAY:null,end=c.state==='waiting'?c.waitEndsAt:Math.max(c.finalEndsAt,c.paidAt+60*DAY);
   w.clock.set(Math.max(w.clock.now(),last&&w.clock.now()<last?last:end)+1000);await tolerate(()=>w.settle());const out=await fresh();await tolerate(()=>w.settle());return out;},
  // Review schedules: chargebacks of the claim payment, objection spam, undeliverable owner notices, a stuck outbox, and
  // lapse claims during a contest window.
  chargeback:async()=>{const c=await claim();if(c?.payment&&BREAK_GLASS_OPEN.includes(c.state)&&random.chance(0.3)){const o=w.polar.orders.get(c.payment.orderId);if(o){o.refunded_amount=o.net_amount;o.status='refunded';}return outage?null:tolerate(()=>w.webhook());}},
  objectionSpam:async()=>{const c=await claim();if(c)for(const sub of ADMINS)for(let i=0;i<3;i++)await run('orgs.breakglass-object',sub,{claim:c.id});},
  notifyFail:async()=>{notifyFailing=!notifyFailing;},
  // Round-2 schedules: a dead owner's push subscription (410 forever), and recovery reissues racing owner changes.
  pushDead:async()=>{pushDead=true;},
  reissueBegin:async()=>{const owner=(await w.summary()).ownerOfRecord.sub,out=await run('orgs.recovery-reissue-begin',owner,{});if(!out?.refused)begun.push({owner,generation:out.generation});return out;},
  reissueDone:async()=>{if(!begun.length)return;const b=begun.splice(random.int(begun.length),1)[0],out=await run('orgs.recovery-reissue-done',b.owner,{kid:'k',generation:b.generation},{verification:w.verification(),aep:0});
   // I16 (review R2-M2): a reissue is confirmed only for the current owner in the generation it began.
   const r=await w.summary();if(out?.issued===true)assert.ok(r.ownerOfRecord.sub===b.owner&&(r.recoveryGeneration??0)===b.generation,`I16: a reissue confirmed for a superseded owner; trace=${trace.join(',')}`);
   if(out?.issued===false)assert.ok(r.ownershipOutbox.some(e=>e.kind==='recovery-rotate'&&!e.doneAt)||r.recovery?.state!=='issued',`I16: an unconfirmed reissue left no rotation; trace=${trace.join(',')}`);return out;},
  outboxFill:async()=>{if(!filled&&random.chance(0.3)){filled=true;const r=await w.metadata.get('org/record-v1');for(let i=0;i<260;i++)r.ownershipOutbox.push({id:'junk-'+random.int(1e9),kind:'index',person:'00000000-0000-4000-8000-000000000000',role:'member',createdAt:w.clock.now(),doneAt:null,attempts:0,nextAt:w.clock.now()+400*DAY});await w.metadata.put('org/record-v1',r);}},
  lapseClaim:async()=>{if(random.chance(0.2)){const sub=pick(ADMINS),out=await run('orgs.claim-start',sub,{plan:'org-team',confirm:true});if(!out?.refused){w.payLatest('claim');if(!outage)return tolerate(()=>w.webhook());}return out;}},
  drain:async()=>tolerate(()=>w.settle()),
  restart:async()=>{w.restart();}
 };
 const names=Object.keys(actions),PROGRESS=['start','accept','cosign','pay','operator','operator','object','clock','sync','drain'];
 // Half the steps push a claim forward (so seeds reach held, final, effective and contests); half are anything at all.
 const next=async()=>{if(!random.chance(0.6))return pick(names);const c=await claim();if(!c||!BREAK_GLASS_OPEN.includes(c.state))return random.chance(0.6)?'start':pick(PROGRESS);
  if(c.state==='gathering')return pick(c.candidacy?(c.quorumAt?['pay','pay','cosign']:['cosign','cosign','accept']):['accept','cosign']);
  return pick(['operator','operator','operator','clock','drain','sync','march','march','object','contest']);};
 // A few deliberate starts early, so most seeds reach payment and beyond.
 const plan=['start','cosign','pay'];
 let previousOwner=A,epochEvents=0;
 for(let i=0;i<steps+3;i++){const name=i<plan.length?plan[i]:await next();
  const before=await claim(),flagWasOff=flagOff;trace.push(name);
  const result=await actions[name]();
  if(result?.refused==='ownership_outbox_full'&&['abortTier0','abortTier1','abortToken','signIn','withdraw','operator'].includes(name))assert.fail(`I12: ${name} refused for outbox capacity; trace=${trace.join(',')}`);
  const c=await claim(),r=await w.summary();if(c){STATES.add(c.state);for(const x of c.log)EVENTS.add(x.event);}
  // I10: with the flag off an abort, withdrawal or refund is never refused by the gate.
  if(flagWasOff&&['abortTier0','abortTier1','withdraw'].includes(name)&&before&&BREAK_GLASS_OPEN.includes(before.state)&&result?.refused==='not_found'&&before.id===c?.id)
   assert.fail(`I10: ${name} refused with the flag off; trace=${trace.join(',')}`);
  for(const e of r.ownershipOutbox??[])if(e.kind==='owner-notice')seen.add(e.claim+'/'+e.event+'/'+(e.channels??[]).length);
  if(c)claims.set(c.id,c);
  await check(w,{claims,seen,trace,previousOwner,epochEvents});
  previousOwner=r.ownerOfRecord.sub;
 }
 // Final settlement: every paid claim that did not take effect is refunded exactly once (I4).
 w.polar.client.customers.getStateExternal=real;outage=false;notifyFailing=false;w.flag.names.ORG_BREAK_GLASS_ENABLED=true;
 for(let i=0;i<4;i++){w.clock.advance(H);await tolerate(()=>w.sync());await tolerate(()=>w.settle());}
 // I15 (review R2-L2): an ended claim's owner notices complete or are dropped within days, even with a dead channel.
 for(let i=0;i<16;i++){w.clock.advance(6*H);await tolerate(()=>w.settle());}
 {const r=await w.summary();for(const e of r.ownershipOutbox.filter(e=>e.kind==='owner-notice'&&!e.doneAt)){const c=await w.metadata.get('org/claim/'+e.claim);assert.ok(c&&BREAK_GLASS_OPEN.includes(c.state),`I15: an ended claim still has a pending owner notice (${e.event}); trace=${trace.join(',')}`);}}
 const r=await w.summary();
 for(const c of claims.values()){
  const now=await w.metadata.get('org/claim/'+c.id);if(!now?.payment||!BREAK_GLASS_TERMINAL.includes(now.state)||now.state==='effective')continue;
  const rows=(r.ownershipOutbox??[]).filter(e=>e.kind==='refund'&&e.subscriptionId===now.payment.subscriptionId);
  assert.ok(rows.length<=1,`I4: one refund effect per claim payment; trace=${trace.join(',')}`);
  const order=w.polar.orders.get(now.payment.orderId),charged=order.status==='refunded'&&!w.polar.effects.refunds.some(x=>x.order===order.id),expected=now.refund?.retainProcessingFee&&!charged?order.net_amount-6050:order.net_amount;
  assert.equal(order.refunded_amount,expected,`I4: claim ${now.id} (${now.state}/${now.closedReason}) refunded ${order.refunded_amount}; trace=${trace.join(',')}`);
 }
 await w.close();
 return trace;
}

async function check(w,{claims,seen,trace}){
 const r=await w.summary(),audits=[...(await w.metadata.list({prefix:'org/audit/'})).values()],where=()=>`trace=${trace.join(',')}`;
 // I1 and I5: every owner change is an effect, reinstatement, transfer or lapse commit, and each one starts from the
 // owner the previous change left (so at most one process takes effect per owner of record).
 let owner=A,epoch=0,windowUntil=0;
 for(const a of audits){
  // I14 (review H3): inside a contest window the owner changes only through a reinstatement.
  if(CHANGE_AUDITS.includes(a.action)&&a.at<windowUntil)assert.fail(`I14: ${a.action} inside a contest window; ${where()}`);
  if(a.action==='organization-break-glass-effect')windowUntil=a.contestUntil;
  if(a.action==='organization-break-glass-contest-resolved'&&a.reinstated)windowUntil=0;
  const reinstated=a.action==='organization-break-glass-contest-resolved'&&a.reinstated;
  if(CHANGE_AUDITS.includes(a.action)||reinstated){
   const from=reinstated?null:(a.from?.sub??null),to=reinstated?a.reinstated.sub:a.to?.sub;
   if(from!==null)assert.equal(from,owner,`I5: an ownership change from ${from} while the owner was ${owner}; ${where()}`);
   owner=to;if(a.action==='organization-break-glass-effect'||reinstated)epoch++;
  }
 }
 assert.equal(r.ownerOfRecord.sub,owner,`I1: the owner of record changed outside an owner-change commit; ${where()}`);
 // I3: the epoch rises exactly once per effect or reinstatement.
 assert.equal(r.authorityEpoch??0,epoch,`I3: aep ${r.authorityEpoch} after ${epoch} effects/reinstatements; ${where()}`);
 for(const id of claims.keys()){
  const c=await w.metadata.get('org/claim/'+id);if(!c)continue;claims.set(id,c);
  // I7: exactly one audit entry per transition.
  const mine=audits.filter(a=>a.claim===c.id&&a.action.startsWith('organization-break-glass-')&&a.action!=='organization-break-glass-contest-window-closed');
  assert.equal(mine.length,c.log.length,`I7: ${mine.length} audit entries for ${c.log.length} transitions of ${c.id}; ${where()}`);
  const log=c.log.map(x=>x.event);
  // I6: notices to every recorded owner channel were enqueued (at T1) before any wait started.
  if(log.includes('paid'))assert.ok(seen.has(c.id+'/start/'+c.channels.length),`I6: no start notice to every channel before the wait; ${where()}`);
  // I8: no single operator reaches final: every proceed is a pair of two distinct operators.
  for(const a of mine.filter(a=>a.action==='organization-break-glass-proceed'))assert.ok(Array.isArray(a.pair)&&a.pair.length===2&&a.pair[0]!==a.pair[1],`I8; ${where()}`);
  if(c.state==='effective'){
   const effect=c.log.find(x=>x.event==='effect');
   // I13 (review M1): a Track A effect only after provider-accepted out-of-band notices at T1, T5 and 72 h.
   if(effect.from==='waiting')for(const e of ['start','paid','remind-72h'])assert.ok(w.service.deliveredOutOfBand(c,e),`I13: Track A effect without an accepted ${e} notice; ${where()}`);
   // I9: never from held.
   assert.ok(['waiting','final'].includes(effect.from),`I9: effect from ${effect.from}; ${where()}`);
   // I2: never after tier 1; never with every channel excluded; after any tier-0 dispute only with a later decision.
   assert.equal(c.tier1At,null,`I2: effect after tier 1; ${where()}`);
   assert.ok(c.channels.length===0||c.channels.some(ch=>!ch.excluded),`I2: effect with every channel excluded; ${where()}`);
   const lastStop=Math.max(-1,...c.log.map((x,i)=>['dispute','liveness'].includes(x.event)?i:-1)),lastProceed=Math.max(-1,...c.log.map((x,i)=>x.event==='proceed'?i:-1));
   if(lastStop>=0)assert.ok(lastProceed>lastStop,`I2: effect after a stop without a later two-operator decision; ${where()}`);
   if(c.disputes.some(d=>d.excluded)){const proceeds=mine.filter(a=>a.action==='organization-break-glass-proceed');assert.ok(proceeds.length>=2,`I2: excluded dispute then effect without a new decision; ${where()}`);}
  }
  // I4 (running): at most one refund effect per claim payment, and never one for an effective claim.
  if(c.payment){const rows=(r.ownershipOutbox??[]).filter(e=>e.kind==='refund'&&e.subscriptionId===c.payment.subscriptionId);assert.ok(rows.length<=1,`I4: ${rows.length} refund effects; ${where()}`);if(c.state==='effective')assert.equal(rows.length,0,`I4: an effective claim was refunded; ${where()}`);}
 }
}

test('seeded chaos: break-glass claims against owners, operators, billing, recovery, deletion, flags and time keep I1–I10',async()=>{
 const reached=new Set();
 await forEachSeed(Number(process.env.CHAOS_SEEDS??24),async random=>{const trace=await chaos(random);for(const t of trace)reached.add(t);});
 assert.ok(['start','pay','operator','abortToken','fileRecovery','flag','clock','restart'].every(t=>reached.has(t)),'the schedule covers the interesting actions');
 // With the default 24 seeds the schedule reaches every state, including held, final and effective.
 if(Number(process.env.CHAOS_SEEDS??24)>=24&&!process.env.CHAOS_SEED)assert.ok(['gathering','waiting','held','final','effective','aborted','closed','withdrawn'].every(x=>STATES.has(x)),'states reached: '+[...STATES].join(','));
});
