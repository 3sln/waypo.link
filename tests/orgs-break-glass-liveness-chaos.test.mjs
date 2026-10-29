// ORG-12b seeded chaos: owner sign-ins and step-ups through the real identity hook, background refreshes, abort-link
// POSTs (valid, replayed, forged, for other claims, and concurrent duplicates racing a sign-in), claim progress (start,
// co-sign, payment, objections, withdrawal), flaky hint and mail effects (so hint puts and drops are retried and applied
// out of order), clock jumps and outbox drains, over the production owner-channels adapter and real person-side hints
// (tests/helpers/break-glass-channels-world.mjs). The schedule is logged; rerun one seed with CHAOS_SEED=N; CHAOS_SEEDS
// sets how many seeds run. Loopback fixtures: local behaviour only.
//
// Invariants, checked after every step:
//   L1 a sign-in or step-up of the owner holds a waiting or final claim (T9) and moves a gathering claim to Track S;
//      it never aborts, and never completes, a claim by itself;
//   L2 a background refresh changes nothing;
//   L3 an abort-link use changes the claim only when its token is unused, issued for this open claim, and its channel
//      recorded; then the claim is aborted or (where tier 0 is a dispute) held, or stays gathering on Track S with the
//      dispute recorded, and the token is marked used exactly once;
//      every other use changes nothing but the per-claim failure count;
//   L4 no claim ever takes effect after an owner sign-in, step-up or abort-link stop during it, even when the sign-in's
//      signal was dropped (review M1: the effect re-reads the owner's activity; no operator acts here);
//   L5 after the effects settle, hints match the organization: an owner hint exactly while a claim is open, admin hints
//      only while it is open, and a former-owner hint exactly while a contest window runs;
//   L6 a sign-in with no hint writes nothing to the person's account and never reaches the organization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed} from './helpers/chaos.mjs';
import {A,B,C,E,DAY} from './helpers/break-glass-world.mjs';
import {channelWorld,identityFor,H} from './helpers/break-glass-channels-world.mjs';
import {sessionContext,stepUpPasskey} from './helpers/identity-engine.mjs';
import {BREAK_GLASS_OPEN} from '../packages/orgs/break-glass.mjs';

const ADMINS=[B,C,E],SEEN=new Set(),OUTCOMES=new Set();
const view=c=>c?JSON.stringify({state:c.state,track:c.track,causes:c.causes,tokens:c.tokens.map(t=>t.usedAt),decision:c.decision}):null;

async function chaos(random,{steps=90}={}){
 let mailFailing=false,hintFailing=false;
 const w=await channelWorld(random.seed+100,{fixture:{fail:()=>mailFailing}}),trace=[],stops=new Map();
 const realApply=w.claimHints.apply.bind(w.claimHints);w.claimHints.apply=async(sub,input)=>hintFailing&&random.chance(0.6)?{ok:false}:realApply(sub,input);
 // Review M1: the identity record keeps every interactive sign-in (the adapter reads it at the effect); the hook's signal
 // can be dropped (`signalsDropped`), and then only the effect-time re-read protects the owner.
 let signalsDropped=false;const deliver=w.signal;w.signal=async(sub,input)=>{w.f.records.get(sub).lastInteractiveAt=input.at;return signalsDropped?{signalled:0}:deliver(sub,input);};
 const id=await identityFor(w);let session=await id.login();
 const pick=list=>list[random.int(list.length)];
 const tolerate=async fn=>{try{return await fn();}catch(error){if(typeof error?.code!=='string'||!Number.isSafeInteger(error?.status))throw error;return {refused:error.code};}};
 const run=(op,sub,input,extra)=>tolerate(()=>w.run(op,sub,input,extra));
 const tokens=()=>w.f.sent.filter(n=>n.abortUrl).map(n=>new URLSearchParams(new URL(n.abortUrl).hash.slice(1)).get('token'));
 const forge=()=>{const t=pick(tokens()??[]);if(!t)return 'bg1.'+crypto.randomUUID()+'.'+crypto.randomUUID()+'.'+'A'.repeat(43);return random.chance(0.5)?t.slice(0,-2)+(t.endsWith('AA')?'BB':'AA'):t.replace(/^bg1\.[^.]+/,'bg1.'+crypto.randomUUID());};
 const owned=async()=>{const c=await w.claim();return c&&BREAK_GLASS_OPEN.includes(c.state)?c:null;};
 const signIn=async kind=>{
  const before=await owned(),hints=await w.hints(A),writes=(await w.personStats(A)).writes,summary=JSON.stringify(await w.summary());
  if(kind==='sign-in')session=await id.login();else{try{await stepUpPasskey(id.act,sessionContext(session),id.credentialId);}catch(error){if(error?.code!=='unauthorized')throw error;/* the 24 h session ended: sign in instead */session=await id.login();}await id.service.settleBackground();}
  const after=await w.claim();
  if(before)stops.set(before.id,true);
  if(before&&!signalsDropped&&hints.some(h=>h.role==='owner'&&h.claim===before.id)){
   OUTCOMES.add('liveness-'+before.state);
   if(['waiting','final'].includes(before.state))assert.equal(after.state,'held',`L1: ${kind} holds a ${before.state} claim; trace=${trace.join(',')}`);
   if(before.state==='gathering')assert.equal(after.track,'S',`L1: ${kind} moves gathering to Track S; trace=${trace.join(',')}`);
   assert.ok(BREAK_GLASS_OPEN.includes(after.state),`L1: ${kind} never ends a claim by itself (${after.state}); trace=${trace.join(',')}`);
  }
  if(!hints.length){assert.equal((await w.personStats(A)).writes,writes,'L6: no write in the person’s account');assert.equal(JSON.stringify(await w.summary()),summary,'L6: the organization is not reached');}
 };
 const abortLink=async token=>{
  const before=await w.claim(),t=before?.tokens.find(x=>`bg1.${before.id}.${x.id}.`===token.slice(0,4+36+1+36+1)),valid=Boolean(before&&BREAK_GLASS_OPEN.includes(before.state)&&t&&!t.usedAt&&w.f.sent.some(n=>n.abortUrl&&new URLSearchParams(new URL(n.abortUrl).hash.slice(1)).get('token')===token));
  await w.run('orgs.breakglass-abort-token','system',{token});const after=await w.claim();
  if(!valid){assert.equal(view(after),view(before),`L3: an unusable token changes nothing; trace=${trace.join(',')}`);return;}
  stops.set(before.id,true);OUTCOMES.add('link-'+after.state);
  // A claim within 180 days of an owner abort treats tier 0 as a dispute (DEVLOG ORG-12a reading 1): a gathering claim
  // then stays gathering on Track S with the dispute recorded; it can never take effect without operators.
  const dispute=before.state==='gathering'&&after.state==='gathering'&&after.disputes.length===before.disputes.length+1&&after.track==='S';
  assert.ok(['aborted','held'].includes(after.state)||dispute,`L3: a valid token stops the claim (${after.state}); trace=${trace.join(',')}`);
  assert.equal(after.tokens.filter(x=>x.usedAt).length,before.tokens.filter(x=>x.usedAt).length+1,'L3: exactly one token is used');
 };
 const actions={
  start:async()=>{const by=pick(ADMINS);return tolerate(()=>w.start(by,by));},
  cosign:async()=>{const c=await owned();if(c)return run('orgs.breakglass-cosign',pick(ADMINS),{claim:c.id});},
  pay:async()=>{const c=await owned();if(!c||c.state!=='gathering')return;const v=await tolerate(()=>w.run('orgs.breakglass',c.candidate.sub));const d=v?.claim?.disclosure?.[0];if(!d)return;const out=await run('orgs.breakglass-checkout',c.candidate.sub,{claim:c.id,disclosure:d.digest,confirm:true});if(out?.refused)return out;const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_binding']===c.id);if(k)w.polar.pay(k.id);return tolerate(()=>w.webhook());},
  object:async()=>{const c=await owned();if(c&&random.chance(0.3))return run('orgs.breakglass-object',E,{claim:c.id});},
  withdraw:async()=>{const c=await owned();if(c&&random.chance(0.2))return run('orgs.breakglass-withdraw',c.initiator.sub,{claim:c.id});},
  signIn:()=>signIn('sign-in'),
  stepUp:()=>signIn('step-up'),
  refresh:async()=>{const before=view(await w.claim());await w.run('orgs.breakglass-liveness','system',{principal:{iss:'https://3sln.example',sub:A},kind:'refresh',at:w.clock.now()});assert.equal(view(await w.claim()),before,'L2: a refresh changes nothing');},
  abortValid:async()=>{const t=pick(tokens());if(t)return abortLink(t);},
  abortForged:()=>abortLink(forge()),
  // A race: duplicate posts of one link and an owner sign-in, all in flight together. Whatever the order, the claim is
  // stopped at most once and every replay is inert (checked against the end state).
  race:async()=>{const t=pick(tokens());const before=await w.claim();if(!t||!before)return;
   await Promise.all([w.run('orgs.breakglass-abort-token','system',{token:t}),w.run('orgs.breakglass-abort-token','system',{token:t}),id.login().then(s=>{session=s;})]);
   const after=await w.claim();if(after.id===before.id&&BREAK_GLASS_OPEN.includes(before.state)){assert.ok(after.tokens.filter(x=>x.usedAt).length-before.tokens.filter(x=>x.usedAt).length<=1,'L3: a raced link is used at most once');if(after.state!==before.state)stops.set(before.id,true);}},
  drain:async()=>{await w.settle();},
  sync:async()=>{await tolerate(()=>w.sync());},
  jump:async()=>{w.clock.advance(pick([H,6*H,DAY,3*DAY,8*DAY,31*DAY]));await tolerate(()=>w.sync());await w.settle();},
  flakyHints:async()=>{hintFailing=!hintFailing;},
  flakyMail:async()=>{mailFailing=random.chance(0.3);},
  dropSignals:async()=>{signalsDropped=!signalsDropped;},
 };
 // Weighted so claims progress far enough (paid, waiting) for sign-ins and links to meet every state.
 const names=Object.keys(actions).flatMap(name=>Array(({start:2,cosign:3,pay:3,signIn:2,jump:3}[name])??1).fill(name));
 try{
  for(let i=0;i<steps;i++){
   const prior=await w.claim(),name=pick(names);trace.push(name);SEEN.add(name);await actions[name]();
   const c=await w.claim();
   // The effect-time re-read (review M1) at work: a waiting claim with an earlier stop that a clock step moved to held.
   if(prior?.id===c?.id&&prior?.state==='waiting'&&c?.state==='held'&&['jump','sync','drain'].includes(name)&&c.causes.includes('owner-liveness'))OUTCOMES.add('held-at-effect');
   if(c?.state)OUTCOMES.add('state-'+c.state);
   if(c?.state==='effective')assert.ok(!stops.get(c.id),`L4: no effect after an owner sign-in or stop; trace=${trace.join(',')}`);
  }
  // L5: settle every effect (no failures), then the hints must match the organization exactly.
  hintFailing=false;mailFailing=false;for(let i=0;i<12;i++){const out=await w.drain();if(!out.pending)break;w.clock.advance(7*H);}
  const c=await w.claim(),s=await w.summary(),open=c&&BREAK_GLASS_OPEN.includes(c.state),owner=(await w.hints(A)).filter(h=>h.role==='owner'),former=(await w.hints(A)).filter(h=>h.role==='former-owner'),admins=(await Promise.all([C,E].map(x=>w.hints(x)))).flat().filter(h=>h.role==='admin');
  assert.equal(owner.length,open?1:0,`L5: owner hint iff a claim is open (${c?.state}); trace=${trace.join(',')}`);if(open)assert.equal(owner[0].claim,c.id);
  if(!open)assert.equal(admins.length,0,`L5: no admin hint without an open claim; trace=${trace.join(',')}`);
  const window=s.breakGlassContest&&s.breakGlassContest.state==='window'&&s.breakGlassContest.until>w.clock.now();
  assert.equal(former.length,window?1:0,`L5: a contest entry exactly while the window runs; trace=${trace.join(',')}`);
 }finally{await w.close();}
 return trace;
}

test('ORG-12b chaos: sign-in liveness and abort-link races keep L1–L6',async()=>{
 await forEachSeed(Number(process.env.CHAOS_SEEDS??12),random=>chaos(random));
 for(const name of ['signIn','stepUp','refresh','abortValid','abortForged','race','pay','jump','dropSignals'])assert.ok(SEEN.has(name),'schedule covers '+name);
 for(const outcome of ['liveness-gathering','link-aborted','state-held','state-aborted'])assert.ok(OUTCOMES.has(outcome),'outcomes reached: '+outcome+' in '+[...OUTCOMES].join(','));
 if(process.env.CHAOS_REPORT)console.log('OUTCOMES',[...OUTCOMES].join(','));
});

// Review M1, directed: a paid Track A claim runs to its end while owner sign-ins happen with their signals dropped,
// delayed or delivered, mixed with flaky hint effects, drains and clock steps. Invariant: a claim takes effect only when no
// owner sign-in happened during it; every dropped signal is caught by the effect-time re-read (held-at-effect).
test('ORG-12b chaos (review M1): dropped liveness signals never let a claim take effect',async()=>{
 let caught=0,effective=0;
 await forEachSeed(Number(process.env.CHAOS_SEEDS??12),async random=>{
  const w=await channelWorld(random.seed+500),trace=[];let hintFailing=false;const realApply=w.claimHints.apply.bind(w.claimHints);w.claimHints.apply=async(sub,input)=>hintFailing&&random.chance(0.5)?{ok:false}:realApply(sub,input);
  try{
   const c=await w.trackA();await w.settle();let signedIn=false;const present=random.chance(0.6);// an absent owner never signs in
   for(let i=0;i<14;i++){const now=await w.claim();if(!BREAK_GLASS_OPEN.includes(now.state))break;
    const step=present?['dropped','delivered','quiet','quiet','hints','drain'][random.int(6)]:['quiet','hints','drain'][random.int(3)];trace.push(step);
    if(step==='dropped'||step==='delivered'){const at=w.clock.now();w.f.records.get(A).lastInteractiveAt=at;signedIn=true;if(step==='delivered')await w.signal(A,{kind:'sign-in',at});}
    if(step==='hints')hintFailing=!hintFailing;if(step==='drain')await w.settle();
    w.clock.advance(Math.floor((c.waitEndsAt-c.paidAt)/10));await w.sync();await w.settle();}
   hintFailing=false;await w.reach(Math.max(w.clock.now(),c.waitEndsAt)+H);await w.settle();await w.sync();
   const end=await w.claim();
   if(signedIn)assert.notEqual(end.state,'effective',`no effect after an owner sign-in; trace=${trace.join(',')}`);
   if(signedIn&&end.state==='held'&&!trace.includes('delivered'))caught++;if(end.state==='effective')effective++;
  }finally{await w.close();}
 });
 assert.ok(caught>0,'a dropped signal was caught at the effect at least once');assert.ok(effective>0,'quiet claims still take effect');
});
