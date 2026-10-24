// ORG-12d seeded chaos: support operators racing on one held break-glass claim through the real admin service, the
// production operator assertions and the organization writer. Each round starts 2–4 independent requests on their own
// macrotasks: two operators proposing and approving at once, one operator twice at once, replays of one captured
// assertion racing each other, single-operator holds and notes, owner disputes from an excluded channel (which bar the
// deciding pair), and clock jumps across the daily window. Invariants after every round:
//   S1 a final claim was decided by two distinct operators, neither in a barred pair;
//   S2 an assertion decides at most once (racing replays: exactly one succeeds), and the registry row is then `used`;
//   S3 no operator's daily window ever exceeds 20 decisions; S4 the admin audit chain verifies;
//   S5 every admin-service failure is an expected refusal code (never an unexpected error);
//   S6 once settled, the admin store's case row matches the organization's support case.
// Seeds: CHAOS_SEEDS (default 6) from CHAOS_SEED (default 1); a failure names its seed. Local behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed,concurrently} from './helpers/chaos.mjs';
import {orgCasesWorld,OP1,OP2,OP3,OP4,ORG,E,DAY} from './helpers/org-cases-world.mjs';

const OPS=[OP1,OP2,OP3,OP4];
// step_up_required: an operator racing two decisions has one bound passkey challenge at a time (review L7); the later
// challenge replaces the earlier, so the earlier decision is refused (step_up_required), or its passkey step-up fails
// because the challenge it answers was replaced (unauthorized).
const EXPECTED=new Set(['step_up_required','unauthorized','second_operator_required','operator_pair_barred','decision_unavailable','decision_limit','not_found','invalid_exclusion','last_channel','conflict','rate_limited','owner_proof_recent']);
const SEEDS=Number(process.env.CHAOS_SEEDS??6);

test(`seeded chaos: operators racing on a held claim keep S1–S6 (${SEEDS} seeds)`,async()=>{
 const coverage={final:0,barred:0,replays:0,approvedRaces:0};
 await forEachSeed(SEEDS,async random=>{
  const w=await orgCasesWorld(1000+random.seed);const decisions=new Map(),log=[];
  try{
   // Prepare a held claim whose push channel already disputed once (so it can be excluded), as in the stolen-device case.
   await w.start();await w.settle();const push=()=>w.ownerChannels.sent.filter(n=>n.abort&&n.channel.startsWith('push-')).at(-1).abort;
   await w.run('orgs.breakglass-abort-token','system',{token:push()});w.clock.advance(31*DAY);await w.sync();
   await w.start('cccccccc-cccc-4ccc-8ccc-cccccccccccc');await w.cosign(E);await w.settle();await w.run('orgs.breakglass-abort-token','system',{token:push()});
   await w.pay('cccccccc-cccc-4ccc-8ccc-cccccccccccc');await w.settle();assert.equal((await w.claim()).state,'held');
   const pushId=(await w.claim()).channels.find(x=>x.kind==='push').id;
   // Every assertion the writer accepted, by its jti (S2).
   const accepted=new Map(),base={resolve:w.port.resolve};
   w.port.resolve=async(org,input)=>{const out=await base.resolve(org,input);const jti=JSON.parse(Buffer.from(input.assertion.split('.')[1],'base64url')).jti;accepted.set(jti,(accepted.get(jti)??0)+1);return out;};
   const capture=async op=>{let got=null;w.port.intercept=(m,o,x)=>{got=x;return {decision:'recorded'};};try{await w.decide(op,'acknowledge');}finally{w.port.intercept=null;}return got;};
   for(let round=0;round<14;round++){
    for(const op of OPS)await w.signIn(op); // sessions are per round; requests inside a round race each other
    const c=await w.claim(),tasks=[],kind=random.int(6),exclude=random.chance(0.6)?[pushId]:[];
    const decide=(op,d,input={})=>()=>w.decide(op,d,d==='proceed'?input:{}).then(out=>{decisions.set(op,(decisions.get(op)??0)+1);return out;});
    if(kind===0){const [a,b]=random.shuffle([...OPS]);tasks.push(decide(a,'proceed',{exclude}),decide(b,'proceed',{exclude}));}
    else if(kind===1){const a=random.pick(OPS);tasks.push(decide(a,'proceed',{exclude}),decide(a,'proceed',{exclude}));}
    else if(kind===2&&c.state==='held'){const input=await capture(random.pick(OPS));tasks.push(()=>w.run('orgs.breakglass-resolve','system',input).then(()=>'replay-ok'),()=>w.run('orgs.breakglass-resolve','system',input).then(()=>'replay-ok'));}
    else if(kind===3){for(const op of random.shuffle([...OPS]).slice(0,2+random.int(2)))tasks.push(decide(op,random.pick(['acknowledge','note','proceed']),{exclude}));}
    else if(kind===4&&c.state==='final'){tasks.push(()=>w.run('orgs.breakglass-abort-token','system',{token:push()}),decide(random.pick(OPS),'proceed',{exclude}));}
    else tasks.push(decide(random.pick(OPS),'note'));
    const results=await concurrently(tasks);log.push({round,kind,results:results.map(r=>r.status==='fulfilled'?r.value?.outcome??r.value:r.reason?.code??String(r.reason))});
    if(kind===0&&results.some(r=>r.value?.outcome==='approved'))coverage.approvedRaces++;
    if(kind===2&&c.state==='held'){coverage.replays++;const ok=results.filter(r=>r.status==='fulfilled').length;assert.equal(ok,1,'S2: racing replays of one assertion decide exactly once');for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'operator_unverified');}
    else for(const r of results)if(r.status==='rejected')assert.ok(EXPECTED.has(r.reason?.code),'S5: unexpected '+(r.reason?.code??r.reason?.stack));
    await w.settle();
    if(random.chance(0.15))w.clock.advance(random.chance(0.5)?DAY:random.int(3600000));
    // ---- invariants
    const x=await w.claim(),barred=new Set(x.barredPairs.flat());
    if(x.state==='final')coverage.final++;if(x.barredPairs.length)coverage.barred++;
    if(x.state==='final'){assert.equal(new Set(x.decision.pair).size,2,'S1: two distinct operators');assert.ok(x.decision.pair.every(op=>OPS.includes(op)&&!barred.has(op)),'S1: no barred operator in a deciding pair');}
    assert.ok(!['effective'].includes(x.state),'no effect within these rounds');
    for(const [jti,n] of accepted){assert.equal(n,1,'S2: an assertion decides at most once');assert.equal((await w.store.get('operator-assertion/'+jti))?.state,'used');}
    for(const op of OPS){const window=await w.store.rateWindow('org-decision-'+op);assert.ok(!window||window.count<=20,'S3: the daily window');}
    assert.equal((await w.store.verifyAudit()).valid,true,'S4');
    const r=await w.summary(),expect=w.service.supportCaseOf(r),row=await w.caseRow();
    assert.equal(row?.state??null,expect?.state??null,'S6: the queue row matches the organization');if(expect)assert.equal(row.process,expect.process);
   }
  }catch(error){error.message+=' log='+JSON.stringify(log.slice(-4));throw error;}
  finally{await w.close();}
 });
 // The schedule must actually reach the interesting states (a vacuous run would pass every invariant).
 if(SEEDS>=6)for(const [name,n] of Object.entries(coverage))assert.ok(n>0,'coverage: '+name+' '+JSON.stringify(coverage));
});
