// Wargame F5 (and plausible items 3 and 7) regressions: an open clean removal never outlives its connection's
// incarnation; it can neither block, remind about nor force a reinstallation. Records are bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform,read} from '../packages/app/engine.mjs';
import {cryptoRandom,nullAudit} from '../packages/app/providers.mjs';
import {AppConnections} from '../packages/apps/connections.mjs';
import {removalCommitTx} from '../packages/runtime/app-removal-commit.mjs';
import {AppRemovalService,appRemovalProvider,StartRemoval,ForceRemoval,CancelRemoval,RemovalList,RemovalReminderTick,REMOVAL_NOTICE,REMOVAL_RECORD,REMOVAL_OPEN,REMOVAL_CONCLUDED_LIMIT,REMOVAL_RETENTION_MS,removalOpen} from '../packages/app/domains/app-removal.mjs';
import {fakeClock,forEachSeed} from './helpers/chaos.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',CLIENT='https://tasks.example/client.json',ORIGIN='https://provider.example',binding='a'.repeat(48);
const manifest={removal:{uri:'https://tasks.example/remove',cleanup_seconds:60}};
const boundStore=tx=>({get:k=>tx.get(k),put:(k,v)=>tx.put(k,v),delete:k=>tx.delete(k),list:o=>tx.list(o),transaction:fn=>fn(tx)});
async function fixture(t,{resume}={}){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());await db.put('owner',OWNER);await db.put('identity/entity',{kind:'person'});
 const clock=fakeClock(1792600000000),apps=new AppConnections({metadata:db,origin:ORIGIN,clock:clock.now});
 const install=async()=>{const v=await apps.register(OWNER,{id:CLIENT,name:'Tasks'});const r=await db.get('resource/'+v.id);r.integration={kind:'external',snapshot:{authMethod:'none',manifest}};await db.put('resource/'+v.id,r);return r;};
 const c={config:{APP_ORIGIN:ORIGIN},metadata:db};
 const service=new AppRemovalService({metadata:db,clock,enabled:()=>true,commit:(tx,o)=>removalCommitTx(c,tx,{...o,clock:clock.now}),
  resume:resume??((tx,owner,row)=>new AppConnections({metadata:boundStore(tx),origin:ORIGIN,clock:clock.now}).transition(owner,row.id,'resume',{expectedGeneration:row.generation}))});
 const engine=createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,appRemoval:appRemovalProvider(service)}});t.after(()=>engine.dispose());
 const owner={kind:'owner',owner:OWNER},system={kind:'system',owner:OWNER},run=(O,input,actor=owner)=>O===RemovalList?read(engine,new O({actor,input})):perform(engine,new O({actor,input}));
 return {db,clock,apps,install,run,system};
}
const noticesFor=async(db,removal)=>(await db.list({prefix:REMOVAL_NOTICE+removal+'/'})).size;
test('F5: disconnect + reinstall leaves no stale clean removal that can block, remind about or sever the new incarnation',async t=>{
 const f=await fixture(t),first=await f.install();assert.equal(first.generation,1);
 const removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});assert.equal(removal.state,'pending');
 await f.apps.disconnect(OWNER,first.id,{reason:'uninstalled'});
 const old=await f.db.get(REMOVAL_RECORD+removal.removal);assert.equal(old.state,'forced');assert.equal(old.outcome,'disconnected');
 assert.equal(await f.db.get(REMOVAL_OPEN+encodeURIComponent(CLIENT)),undefined);
 const again=await f.install();assert.equal(again.status,'active');assert.equal(again.generation,3);
 const fresh=await f.run(StartRemoval,{connection:again.id,expectedGeneration:3,binding});assert.equal(fresh.state,'pending');
 f.clock.advance(61000);await f.run(RemovalReminderTick,undefined,f.system);
 assert.equal(await noticesFor(f.db,removal.removal),0,'stale reminders issued for a disconnected incarnation');
 await f.run(ForceRemoval,{removal:removal.removal}).catch(()=>{});
 const after=await f.db.get('resource/'+again.id);assert.equal(after.status,'active');assert.equal(after.generation,3);
});
test('F5: a legacy open removal from before the fix is refused by force and skipped by the tick',async t=>{
 const f=await fixture(t),first=await f.install(),removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});
 // Simulate a pre-fix disconnect that left the record open and indexed, then a reinstall.
 const row=await f.db.get('resource/'+first.id);f.clock.advance(1000);Object.assign(row,{status:'disconnected',generation:2,disconnectedAt:f.clock.now()});await f.db.put('resource/'+first.id,row);
 const again=await f.install();assert.equal(again.generation,3);
 f.clock.advance(61000);await f.run(RemovalReminderTick,undefined,f.system);assert.equal(await noticesFor(f.db,removal.removal),0);
 await assert.rejects(f.run(ForceRemoval,{removal:removal.removal}),e=>e.code==='connection_stale');
 assert.equal((await f.db.get('resource/'+again.id)).status,'active');
});
test('F5: force still follows a suspend/resume generation forward',async t=>{
 const f=await fixture(t),first=await f.install(),removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});
 await f.apps.transition(OWNER,first.id,'suspend',{expectedGeneration:1});await f.apps.transition(OWNER,first.id,'resume',{expectedGeneration:2});
 const forced=await f.run(ForceRemoval,{removal:removal.removal});assert.equal(forced.state,'forced');assert.equal((await f.db.get('resource/'+first.id)).status,'disconnected');
});
test('review follow-up 2: a generation bump while connected keeps reminding about the open removal',async t=>{
 const f=await fixture(t),first=await f.install(),removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});
 await f.apps.transition(OWNER,first.id,'suspend',{expectedGeneration:1});await f.apps.transition(OWNER,first.id,'resume',{expectedGeneration:2});
 f.clock.advance(61000);const tick=await f.run(RemovalReminderTick,undefined,f.system);
 assert.equal(tick.notified,1);assert.equal(await noticesFor(f.db,removal.removal),1);
});
test('F5: account-wide severance closes open removals in the same commit',async t=>{
 const f=await fixture(t),first=await f.install(),removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});
 await f.apps.severAll(OWNER,{reason:'suspended'});
 const r=await f.db.get(REMOVAL_RECORD+removal.removal);assert.equal(removalOpen(r),false);assert.equal(r.outcome,'disconnected');
 assert.equal(await f.db.get(REMOVAL_OPEN+encodeURIComponent(CLIENT)),undefined);
});
test('plausible-3: starting from suspended never records a removal for a connection the resume severed',async t=>{
 const f=await fixture(t),first=await f.install();
 await f.apps.transition(OWNER,first.id,'suspend',{expectedGeneration:1});
 // The account went through a suspension since: the connection's capability fence no longer matches.
 await f.db.put('lifecycle/state-v1',{phase:'active',capabilityEpoch:7,generation:1});
 const row=await f.db.get('resource/'+first.id);row.fence=0;row.suspensionReason='owner';await f.db.put('resource/'+first.id,row);
 await assert.rejects(f.run(StartRemoval,{connection:first.id,expectedGeneration:2,binding}),e=>e.code==='clean_removal_unavailable');
 assert.equal((await f.db.list({prefix:'app-removal/'})).size,0);
});
test('plausible-7: the tick rewrites only advanced records and concluded records are pruned',async t=>{
 const f=await fixture(t),first=await f.install(),removal=await f.run(StartRemoval,{connection:first.id,expectedGeneration:1,binding});
 const writes=[],transaction=f.db.transaction.bind(f.db);f.db.transaction=fn=>transaction(tx=>fn(new Proxy(tx,{get(target,k){const v=Reflect.get(target,k);if(k==='put')return (key,value)=>{writes.push(key);return v.call(target,key,value);};return typeof v==='function'?v.bind(target):v;}})));
 await f.run(RemovalReminderTick,undefined,f.system);assert.deepEqual(writes.filter(k=>k.startsWith(REMOVAL_RECORD)),[],'tick rewrote an unchanged record');
 f.db.transaction=transaction;
 const now=f.clock.now();
 for(let i=0;i<REMOVAL_CONCLUDED_LIMIT+5;i++){const id=OWNER+'.'+String(i).padStart(8,'0')+'-0000-4000-8000-000000000000';await f.db.put(REMOVAL_RECORD+id,{removal:id,entity:OWNER,client_id:'https://old.example/'+i,state:'canceled',started_at:now-1000+i,concluded_at:now-1000+i});await f.db.put(REMOVAL_NOTICE+id+'/0',{owner:OWNER,removal:id});}
 const ancient=OWNER+'.ffffffff-0000-4000-8000-000000000000';await f.db.put(REMOVAL_RECORD+ancient,{removal:ancient,entity:OWNER,client_id:'https://ancient.example/',state:'forced',started_at:0,committed_at:now-REMOVAL_RETENTION_MS-1});
 await f.run(RemovalReminderTick,undefined,f.system);
 const records=[...(await f.db.list({prefix:REMOVAL_RECORD})).values()];
 assert.equal(records.filter(r=>!removalOpen(r)).length,REMOVAL_CONCLUDED_LIMIT);assert.ok(!records.some(r=>r.removal===ancient));
 assert.ok(records.some(r=>r.removal===removal.removal&&removalOpen(r)),'an open removal was pruned');
 assert.equal((await f.db.list({prefix:REMOVAL_NOTICE})).size,REMOVAL_CONCLUDED_LIMIT,'notices of pruned records remain');
});
test('F5 chaos: open removals always belong to the live incarnation; force never severs a later one',async t=>{
 await forEachSeed(12,async random=>{
  const f=await fixture(t);let conn=await f.install();const removals=[];
  for(let step=0;step<40;step++){
   const op=random.pick(['start','disconnect','reinstall','force','cancel','tick','advance']);
   const current=await f.db.get('resource/'+conn.id);
   try{
    if(op==='start'){const r=await f.run(StartRemoval,{connection:conn.id,expectedGeneration:current.generation,binding});removals.push(r);}
    else if(op==='disconnect')await f.apps.disconnect(OWNER,conn.id,{reason:'uninstalled'});
    else if(op==='reinstall'){if(current.status==='disconnected')conn=await f.install();}
    else if(op==='force'&&removals.length){const r=random.pick(removals),before=await f.db.get('resource/'+conn.id),record=await f.db.get(REMOVAL_RECORD+r.removal);
     const stale=removalOpen(record)&&(before.status==='disconnected'||before.disconnectedAt>=record.started_at||before.connectedAt>record.started_at);
     await f.run(ForceRemoval,{removal:r.removal}).catch(e=>{if(e.code!=='connection_stale')throw e;});
     if(stale||!removalOpen(record))assert.deepEqual(await f.db.get('resource/'+conn.id),before,'force changed a connection it does not own');}
    else if(op==='cancel'&&removals.length)await f.run(CancelRemoval,{removal:random.pick(removals).removal});
    else if(op==='tick')await f.run(RemovalReminderTick,undefined,f.system);
    else if(op==='advance')f.clock.advance(random.int(3)*86400000+random.int(120000));
   }catch(error){if(!['removal_pending','clean_removal_unavailable','connection_stale','not_found'].includes(error.code))throw error;}
   const live=await f.db.get('resource/'+conn.id),open=[...(await f.db.list({prefix:REMOVAL_RECORD})).values()].filter(removalOpen),index=await f.db.get(REMOVAL_OPEN+encodeURIComponent(CLIENT));
   assert.ok(open.length<=1,'more than one open removal');
   for(const r of open){assert.equal(live.status,'active',`open removal for a disconnected connection (step ${step}, ${op})`);assert.equal(r.generation,live.generation,'open removal for another generation');assert.equal(index,r.removal);}
   if(!open.length)assert.equal(index,undefined,'dangling open index');
   for(const r of removals)if(!removalOpen(await f.db.get(REMOVAL_RECORD+r.removal)))assert.equal(await f.db.get(REMOVAL_NOTICE+r.removal+'/9'),undefined);
  }
 });
});
