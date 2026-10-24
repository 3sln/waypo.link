// Wargame F4 regressions: removal cascade drains continue past failures with per-row backoff and a stuck signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {drainRemovalCascades,cascadeBackoff,CASCADE_STUCK_ATTEMPTS,CASCADE_MAX_MS} from '../packages/runtime/app-removal-commit.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',T0=1792600000000;
const row=(connection,clientId)=>({owner:OWNER,connection,clientId,generation:2,committed_at:1000,access_ends_by:361000});
const cascadeKey=connection=>'app-removal/cascade/'+connection+'/0000000000000002';
async function seed(t,ids){const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());for(const [connection,clientId]of ids)await metadata.put(cascadeKey(connection),row(connection,clientId));return metadata;}
test('F4: a persistently failing cascade row does not block other apps\' revocation cascades',async t=>{
 const metadata=await seed(t,[['00000000-0000-4000-8000-00000000000a','https://stuck.example/app'],['ffffffff-0000-4000-8000-00000000000b','https://victim-owner-wants-gone.example/app']]);
 const revoked=[],c={metadata,config:{APP_REMOVAL_REVOKE_EXTERNAL:async r=>{if(r.clientId.includes('stuck'))throw Object.assign(Error('federation transaction too large'),{code:'unavailable'});revoked.push(r.clientId);}}};
 for(let attempt=0;attempt<10;attempt++)await drainRemovalCascades(c,OWNER);
 assert.deepEqual(revoked,['https://victim-owner-wants-gone.example/app']);
});
test('F4: failures back off exponentially per row, then mark the row stuck with one operator alert',async t=>{
 const id='00000000-0000-4000-8000-00000000000a',metadata=await seed(t,[[id,'https://stuck.example/app']]),logs=[],seen=[];
 const c={metadata,config:{LIFECYCLE_LOG:e=>logs.push(e),APP_REMOVAL_REVOKE_EXTERNAL:async r=>{seen.push(r);throw Object.assign(Error('no'),{code:'unavailable'});}}};
 let now=T0;
 for(let n=1;n<=CASCADE_STUCK_ATTEMPTS+2;n++){
  const result=await drainRemovalCascades(c,OWNER,{now});assert.equal(result.failed,1);assert.equal(result.pending,true);
  const stored=await metadata.get(cascadeKey(id));assert.equal(stored.attempts,n);assert.equal(stored.next_attempt_at,now+cascadeBackoff(n));assert.equal(result.wakeAt,stored.next_attempt_at);
  assert.equal(stored.stuck===true,n>=CASCADE_STUCK_ATTEMPTS);
  // Not retried before its time.
  assert.equal((await drainRemovalCascades(c,OWNER,{now:stored.next_attempt_at-1})).failed,0);
  now=stored.next_attempt_at;
 }
 assert.equal(cascadeBackoff(1),60000);assert.equal(cascadeBackoff(2),120000);assert.equal(cascadeBackoff(40),CASCADE_MAX_MS);
 assert.equal(logs.filter(e=>e.action==='operator-alert').length,1);
 assert.deepEqual({kind:logs[0].kind,reason:logs[0].reason,connection:logs[0].connection,attempts:logs[0].attempts},{kind:'app-removal',reason:'cascade-stuck',connection:id,attempts:CASCADE_STUCK_ATTEMPTS});
 // The external port never sees bookkeeping fields.
 for(const r of seen)assert.deepEqual(Object.keys(r).sort(),['access_ends_by','clientId','committed_at','connection','generation','owner']);
});
test('F4 chaos: every row whose revocation eventually succeeds is drained; no row is attempted early',async t=>{
 await forEachSeed(16,async random=>{
  const ids=Array.from({length:6},(_,i)=>[`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`,`https://app${i}.example/c`]);
  const metadata=new SqliteMetadata(':memory:');try{for(const [connection,clientId]of ids)await metadata.put(cascadeKey(connection),row(connection,clientId));
   const failures=new Map(ids.map(([,clientId])=>[clientId,random.int(CASCADE_STUCK_ATTEMPTS+3)])),done=new Set();let now=T0;
   const c={metadata,config:{LIFECYCLE_LOG(){},APP_REMOVAL_REVOKE_EXTERNAL:async r=>{const stored=await metadata.get(cascadeKey(r.connection));assert.ok(!(stored.next_attempt_at>now),'attempted before next_attempt_at');const left=failures.get(r.clientId);if(left>0){failures.set(r.clientId,left-1);throw Object.assign(Error('flaky'),{code:'unavailable'});}done.add(r.clientId);}}};
   for(let pass=0;pass<200&&done.size<ids.length;pass++){const result=await drainRemovalCascades(c,OWNER,{now});now=result.wakeAt??now+random.int(CASCADE_MAX_MS);if(random.chance(0.3))now+=random.int(600000);}
   assert.equal(done.size,ids.length);assert.equal((await metadata.list({prefix:'app-removal/cascade/'})).size,0);
  }finally{metadata.close();}
 });
});
test('review follow-up 4: without a revocation port rows stay pending but no alarm is armed',async t=>{
 const metadata=await seed(t,[['00000000-0000-4000-8000-00000000000a','https://app.example/c']]);
 assert.deepEqual(await drainRemovalCascades({metadata,config:{}},OWNER,{now:T0}),{drained:0,failed:0,pending:true,wakeAt:null});
 assert.equal((await metadata.list({prefix:'app-removal/cascade/'})).size,1);
});
