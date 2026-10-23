// PORT-2 seeded chaos (identity-portability design §10.3, "Source"): random interleavings of authorization, statement
// arrival (duplicated, reordered, replaced, lost responses), disputes, cancels, clock jumps, security changes,
// credential supersession, deletion racing a move (IP-R1-L10), admin holds, notice failures, kill-switch flips and
// crashes between commit phases. Rerun a failing seed with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachSeed,injectFaults} from './helpers/chaos.mjs';
import {transferFixture,DAY,HOUR,MINUTE,DEST,REDIRECT} from './helpers/transfer-out.mjs';

const TERMINAL=new Set(['cancelled','expired','aborted']);
const STEPS=[5*MINUTE,HOUR,6*HOUR,25*HOUR,3*DAY,8*DAY,31*DAY];
const swallow=async work=>{try{return await work();}catch(error){if(error?.code==='injected_fault'||typeof error?.code==='string')return undefined;throw error;}};

async function schedule(random){
 const fx=await transferFixture(null,{seed:random.seed});
 try{
  const attestations=new Set(),terminal=new Set(),bodies=[],marks={bump:[],supersede:[],deletion:[]},seen=new Map();
  const originalIdentity=fx.ports.identity,originalEffects=fx.ports.effects;let commitOp=null,crashed=false;
  const note=response=>{if(response?.status==='attested'){assert.equal(typeof response.attestation,'string');attestations.add(response.attestation);}};
  const post=async extra=>{const response=await swallow(()=>fx.post(extra));if(fx.body&&!bodies.includes(fx.body))bodies.push(fx.body);return response;};
  const ops=[
   [6,async()=>{const view=await swallow(()=>fx.start());if(view===undefined&&random.chance(0.3))await swallow(()=>fx.restartChoice('keep'));}],
   [6,async()=>note(await post())],                                         // identical body (duplicate / retry)
   [2,async()=>{if(random.chance(0.5))await post();}],                      // lost response: result ignored
   [2,async()=>{const r=await fx.get();if(r?.transfer)note(await swallow(()=>fx.post({},undefined,{fresh:true})));}], // a different statement
   [2,async()=>{if(bodies.length)note(await swallow(()=>fx.statement(random.pick(bodies))));}],                    // reordered replay
   [1,async()=>note(await swallow(()=>fx.post({redirect_base:`${DEST}/other/`})))],
   [3,async()=>{const token=fx.tokenFor(random.pick(['email','push']));if(token)await swallow(()=>fx.dispute({token,choice:random.pick(['hold','abort'])}));}],
   [2,async()=>swallow(()=>fx.cancel())],
   [8,async()=>{fx.clock.advance(random.pick(STEPS));}],
   [8,async()=>swallow(()=>fx.step())],
   [1,async()=>{await fx.bumpSecurity();marks.bump.push(i);}],
   [1,async()=>{await swallow(()=>fx.patchIdentity(a=>a.status==='active'?{...a,recoveryIssuedAt:fx.clock.now()}:a));marks.supersede.push(i);}],
   [0.5,async()=>{await fx.metadata.put(random.chance(0.5)?'deletion/request-v1':'deletion/fence-v1',{state:'scheduled'});marks.deletion.push(i);}],
   [2,async()=>{fx.state.hold=random.chance(0.6)?{held:false}:{held:true};}],
   [2,async()=>{fx.state.accept=random.pick([true,false,input=>input.channel.email!==undefined]);}],
   [2,async()=>{fx.state.flags.background=random.chance(0.75);}],
   [1,async()=>{if(crashed)return;crashed=true;
    if(random.chance(0.5))fx.ports.identity=injectFaults({...originalIdentity},[{method:'markMoved',when:1,mode:random.pick(['throw','after'])}],{random});
    else fx.ports.effects=injectFaults(originalEffects,[{method:random.pick(['revokeDelegations','severConnections','eraseGrants']),when:1,mode:random.pick(['throw','after'])}],{random});}],
  ];
  const total=ops.reduce((sum,[w])=>sum+w,0),pickOp=()=>{let x=random.next()*total;for(const [w,fn]of ops){if((x-=w)<0)return fn;}return ops.at(-1)[1];};
  let i=0;
  const observe=async()=>{
   const record=await fx.get();if(!record)return;
   if(!seen.has(record.id))seen.set(record.id,i);
   if(TERMINAL.has(record.state))terminal.add(record.id);
   if(record.state==='committed'){
    assert.ok(!terminal.has(record.id),'a cancelled, expired or aborted transfer never commits');
    attestations.add(record.attestation);
    if(commitOp===null){
     commitOp=i;const authorizedOp=seen.get(record.id);
     assert.ok(record.committedAt>=record.noticedAt+record.delay,'commit no earlier than the notified delay');
     assert.equal(fx.state.hold.held,false,'no admin hold at commit');assert.equal(fx.state.flags.background,true,'no commit under the kill switch');
     for(const [name,list]of Object.entries(marks))assert.ok(!list.some(op=>op>=authorizedOp&&op<commitOp)&&!(name==='deletion'&&list.length),`no ${name} between authorization and commit`);
    }
   }
  };
  for(;i<40;i++){await pickOp()();await observe();}
  // Recovery: everything heals, time passes, the account restarts and steps.
  fx.ports.identity=originalIdentity;fx.ports.effects=originalEffects;fx.state.hold={held:false};fx.state.accept=true;fx.state.flags.background=true;
  for(let n=0;n<8;n++,i++){fx.clock.advance(HOUR);await swallow(()=>fx.step());await observe();}
  assert.ok(attestations.size<=1,'at most one attestation per identity');
  const record=await fx.get();
  if(record?.state==='committed'){
   const identity=await fx.identityRecord();
   assert.equal(identity.status,'moved');assert.equal(identity.moved.statementDigest,record.statement.digest);
   assert.equal(identity.moved.to.iss,DEST);assert.equal(identity.moved.redirectBase,record.redirect?record.statement.redirectBase:null);if(record.redirect){assert.equal(new URL(identity.moved.redirectBase).origin,DEST);assert.ok([REDIRECT,`${DEST}/other/`].includes(identity.moved.redirectBase));}assert.equal(identity.moved.attestation,record.attestation);
   assert.equal(identity.sessions.length,0);assert.equal(identity.recoveryHash,null);
   assert.ok(fx.effects.destroyed>=1,'custody copies destroyed');
   for(const stage of ['identity','keys','delegations','connections','grants','due','notice'])assert.ok(record.stages[stage],`stage ${stage} completed`);
  }else{
   const identity=await fx.identityRecord();assert.notEqual(identity.status,'moved','no moved identity without a committed record');
   assert.equal(fx.effects.destroyed,0);
  }
  return record?.state??'none';
 }finally{await fx.engine.dispose();await fx.f.dispose();fx.idDb.close();fx.dueDb.close();}
}

test('seeded source chaos keeps the PORT-2 invariants (single attestation, no commit after cancel, deletion wins, healed crashes)',async()=>{
 const outcomes={};
 await forEachSeed(32,async random=>{const state=await schedule(random);outcomes[state]=(outcomes[state]??0)+1;});
 // The schedule mix must actually reach commits and terminal states, or the invariants above prove nothing.
 if(process.env.CHAOS_VERBOSE)console.log(outcomes);assert.ok(outcomes.committed>=1&&Object.keys(outcomes).some(state=>TERMINAL.has(state)),JSON.stringify(outcomes));
});

test('seeded happy-path chaos: duplicated statements and crashes between phases still commit exactly once',async()=>{
 let committed=0;
 await forEachSeed(16,async random=>{
  const fx=await transferFixture(null,{seed:random.seed});
  try{
   await fx.start();const attestations=new Set();
   const identity=fx.ports.identity,effects=fx.ports.effects;
   fx.ports.identity=injectFaults({...identity},[{method:'markMoved',when:random.pick([1,[1,2]]),mode:random.pick(['throw','after'])}],{random});
   fx.ports.effects=injectFaults(effects,[{method:random.pick(['revokeDelegations','severConnections','eraseGrants']),when:1,mode:random.pick(['throw','after','duplicate'])}],{random});
   for(let n=0;n<12;n++){
    if(random.chance(0.6)){const r=await fx.post();if(r.status==='attested')attestations.add(r.attestation);}
    fx.clock.advance(random.pick([MINUTE,HOUR,5*HOUR,13*HOUR]));if(random.chance(0.5))await swallow(()=>fx.step());
   }
   for(let n=0;n<6;n++){fx.clock.advance(HOUR);await swallow(()=>fx.step());const r=await fx.post();if(r.status==='attested')attestations.add(r.attestation);}
   const record=await fx.get();assert.equal(record.state,'committed');committed++;
   assert.equal(attestations.size,1);assert.ok(attestations.has(record.attestation));
   assert.equal((await fx.identityRecord()).status,'moved');
   for(const stage of ['identity','keys','delegations','connections','grants','due','notice'])assert.ok(record.stages[stage],stage);
  }finally{await fx.engine.dispose();await fx.f.dispose();fx.idDb.close();fx.dueDb.close();}
 });
 assert.equal(committed,16);
});
