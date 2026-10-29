// Email-bridge removal reset `email-bridge-retired-v1` (owner direction 2026-10-28: strike the email bridge for now;
// provisional, unsigned): the retired provider-feature grant, its notices, the public-intake field and its announcement
// state are deleted in bounded slices, marker last; every other connections row is kept. Also: the export skips the
// retired rows before the reset runs, the account methods run it, and a persisted purge job drops the retired
// `email-bridge` stage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {resetEmailBridge,retiredEmailBridgeRow,EMAIL_BRIDGE_RESET_MARKER,RETIRED_EMAIL_BRIDGE} from '../packages/runtime/email-bridge-reset.mjs';
import {createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {purgeBatch,PURGE_KEY,PURGE_PLANS} from '../packages/runtime/lifecycle-storage.mjs';
import {digest} from '../packages/core/records.mjs';
import {EXT} from '../packages/core/extensions.mjs';
import {MESSAGING_INGRESS_FRAGMENT} from '../packages/identity/messaging-ingress.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ORIGIN='https://provider.example';
const d=value=>digest(globalThis.crypto,value);
function store(t){const db=new SqliteMetadata(':memory:');t.after(()=>db.close());return db;}
async function keys(){
 const spec=await d(RETIRED_EMAIL_BRIDGE.spec),fragment=await d(RETIRED_EMAIL_BRIDGE.fragment),mailbox=await d(EXT.messagingMailbox),ingress=await d(MESSAGING_INGRESS_FRAGMENT);
 return {feature:'connections/feature/'+spec,field:'connections/field/'+fragment,muted:'connections/announce-muted/'+fragment,announced:'connections/announced/'+fragment+'/',
  keptFeature:'connections/feature/'+mailbox,keptField:'connections/field/'+ingress,keptMuted:'connections/announce-muted/'+ingress,keptAnnounced:'connections/announced/'+ingress+'/'};
}
// The retired rows, `per` announcement rows so small limits must page.
async function seedRetired(db,{per=3}={}){
 const k=await keys();
 await db.put(k.feature,{spec:RETIRED_EMAIL_BRIDGE.spec,fragment:RETIRED_EMAIL_BRIDGE.fragment,field:'intake',state:'active',grant:'g1',approved:['s1']});
 await db.put(k.field,{fragment:RETIRED_EMAIL_BRIDGE.fragment,revision:2,entries:[{seat:'s1',connection:'c1'}]});
 await db.put(k.muted,true);
 for(let i=0;i<per;i++)await db.put(`${k.announced}${i}`,{at:i});
 await db.put('connections/notice/0000000000000001',{id:'0000000000000001',kind:'feature-suspended',feature:RETIRED_EMAIL_BRIDGE.spec});
 await db.put('connections/notice/0000000000000003',{id:'0000000000000003',kind:'announcement',fragment:RETIRED_EMAIL_BRIDGE.fragment});
 return k;
}
async function seedKept(db){
 const k=await keys(),kept={
  'owner':OWNER,
  [k.keptFeature]:{spec:EXT.messagingMailbox,fragment:MESSAGING_INGRESS_FRAGMENT,field:'mailbox',state:'active',grant:'g2',approved:['s2']},
  [k.keptField]:{fragment:MESSAGING_INGRESS_FRAGMENT,revision:1,entries:[{seat:'s2',connection:'c2'}]},
  [k.keptMuted]:true,[`${k.keptAnnounced}0`]:{at:1},
  'connections/notice/0000000000000002':{id:'0000000000000002',kind:'feature-suspended',feature:EXT.messagingMailbox},
  'connections/meta':{notice:3},
  // A brokered record listing the retired contract beside the mailbox contract stays (the string is inert).
  'integrations/record/r1':{v:1,id:'r1',contracts:['https://spec.bindle.example/messaging/v1/contracts/mailbox','https://spec.bindle.example/contracts/public-intake/v1']},
  'migration/contact-links-retired-v1':{version:1},
 };
 for(const [path,value]of Object.entries(kept))await db.put(path,value);
 return kept;
}
async function retiredLeft(db){
 const k=await keys(),out=[];
 for(const path of [k.feature,k.field,k.muted])if(await db.get(path)!==undefined)out.push(path);
 for(const path of (await db.list({prefix:k.announced})).keys())out.push(path);
 for(const [path,row]of await db.list({prefix:'connections/notice/'}))if(retiredEmailBridgeRow(row))out.push(path);
 return out;
}
async function assertKept(db,kept){for(const [path,value]of Object.entries(kept))assert.deepEqual(await db.get(path),value,path);}
async function drain(db,limit){let slices=0,result;do{result=await resetEmailBridge(db,{limit});slices++;assert.ok(result.deleted<=limit+2,`slice deleted ${result.deleted} > ${limit}+2`);assert.ok(slices<1000,'the reset terminates');}while(!result.done);return slices;}

test('bounded slices: every limit completes, deletes exactly the retired rows and keeps everything else',async t=>{
 for(const limit of [1,2,5,64,1000]){
  const db=store(t);await seedRetired(db,{per:6});const kept=await seedKept(db);
  const slices=await drain(db,limit);if(limit===1)assert.ok(slices>3,'small limits really page');
  assert.deepEqual(await retiredLeft(db),[]);await assertKept(db,kept);
  assert.equal((await db.get(EMAIL_BRIDGE_RESET_MARKER)).version,1);
 }
 await assert.rejects(resetEmailBridge(new Map(),{limit:0}),TypeError);
});

test('marker last: an interrupted slice leaves the marker absent; idempotent after it, and rows that only look alike stay',async t=>{
 const db=store(t);const k=await seedRetired(db,{per:4});await seedKept(db);
 const first=await resetEmailBridge(db,{limit:1});assert.equal(first.done,false);assert.equal(await db.get(EMAIL_BRIDGE_RESET_MARKER),undefined);
 await drain(db,3);assert.deepEqual(await resetEmailBridge(db),{done:true,deleted:0});
 // After the marker nothing runs, even if a row reappears (no code writes these rows any more).
 await db.put(k.field,{fragment:RETIRED_EMAIL_BRIDGE.fragment,entries:[]});assert.deepEqual(await resetEmailBridge(db),{done:true,deleted:0});assert.ok(await db.get(k.field));
 // A row under the feature key whose spec does not match is never deleted (digest keys are checked against content).
 const other=store(t);await other.put(k.feature,{spec:'https://other.example/extensions/x/v1'});await other.put(k.field,{fragment:'https://other.example/fragments/y/v1'});
 assert.equal((await resetEmailBridge(other)).done,true);assert.ok(await other.get(k.feature));assert.ok(await other.get(k.field));
});

test('export: the integrations contributor skips the retired rows before the reset deletes them',async t=>{
 const db=store(t);await seedRetired(db);const kept=await seedKept(db);
 const integrations=createExportContributors({accountStore:db,flags:{for:()=>({evaluate:()=>({value:false})})}}).find(c=>c.name==='integrations');
 const records=[];let cursor=null;do{const page=await integrations.page({owner:OWNER,cursor,limit:2});records.push(...page.rows.map(r=>r.record));cursor=page.cursor;}while(cursor);
 assert.equal(records.some(r=>retiredEmailBridgeRow(r)),false,JSON.stringify(records));
 assert.ok(records.some(r=>r.spec===EXT.messagingMailbox),'the kept feature is exported');assert.ok(records.some(r=>r.fragment===MESSAGING_INGRESS_FRAGMENT),'the kept field is exported');
 assert.ok(kept);
});

test('account methods: resetEmailBridge runs the slices, reschedules until done and is a no-op after the marker',async t=>{
 const db=store(t);await db.put('owner',OWNER);await seedRetired(db,{per:5});
 const alarms=[],c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN},sql:db.sql});
 c.scheduleAlarm=async at=>{alarms.push(at);};
 const partial=await c.resetEmailBridge(OWNER,{limit:1,alarm:true});assert.equal(partial.done,false);assert.equal(alarms.length,1,'an unfinished slice reschedules');
 let guard=0;while(!(await c.resetEmailBridge(OWNER,{limit:2,alarm:true})).done)assert.ok(++guard<100);
 assert.deepEqual(await retiredLeft(db),[]);assert.deepEqual(await c.resetEmailBridge(OWNER),{done:true,deleted:0});
});

test('purge jobs: a persisted plan drops the retired email-bridge stage and resumes at the next stage',async t=>{
 for(const PLAN of Object.values(PURGE_PLANS))assert.equal(PLAN.includes('email-bridge'),false);
 for(const at of ['email-bridge','vectors','exports']){
  const db=store(t),old=['billing-stop','identity','grants','drain','vectors','email-bridge','exports','archive','blobs','billing-anonymize','metadata'];
  await db.put(PURGE_KEY,{version:1,owner:OWNER,reason:'moved',basis:'moved',plan:old,stage:at,cursor:null,archiveIndex:0,archiveDigest:null,deleted:0,foreign:0,startedAt:1,hooks:{'email-bridge':{x:1}},evidence:{}});
  const executor={metadata:db,blobs:{async delete(){}},archives:{async delete(){}},config:{}};
  const result=await purgeBatch(executor,OWNER,{identity:{get:async()=>null},fence:async()=>false,reason:'moved',basis:'moved',stages:{}});
  const job=await db.get(PURGE_KEY);assert.deepEqual(job.plan,PURGE_PLANS.moved);assert.equal(job.stage,at==='email-bridge'?'exports':at);assert.equal(Object.hasOwn(job.hooks,'email-bridge'),false);
  assert.equal(result.halted,true,'the fence still runs before the next destructive stage');
 }
});

test('seeded chaos: reset slices interleaved with writes to kept connections rows never lose a kept write and always finish clean',async()=>{
 await forEachSeed(12,async random=>{
  const db=new SqliteMetadata(':memory:');try{
   await db.put('owner',OWNER);await seedRetired(db,{per:1+random.int(6)});const k=await keys();
   const scheduler=createScheduler(random),wrapped=scheduler.wrap(db,'store'),kept=new Map();let n=0;
   const work=Array.from({length:6+random.int(8)},()=>{const id=n++,kind=random.pick(['reset','reset','kept','kept','notice']);
    if(kind==='reset'){const limit=1+random.int(4);return ()=>resetEmailBridge(wrapped,{limit});}
    if(kind==='notice'){const path=`connections/notice/${String(100+id).padStart(16,'0')}`,value={id,kind:'feature-resumed',feature:EXT.messagingMailbox};kept.set(path,value);return ()=>wrapped.put(path,value);}
    const path=random.pick([`${k.keptAnnounced}${id}`,`connections/outbox/${id}`,`integrations/record/r${id}`]),value={at:id};
    kept.set(path,value);return ()=>wrapped.put(path,value);});
   const results=await scheduler.run(work);for(const r of results)if(r.status==='rejected')throw r.reason;
   let guard=0;while(!(await resetEmailBridge(db,{limit:1+random.int(5)})).done)assert.ok(++guard<500);
   assert.deepEqual(await retiredLeft(db),[]);
   for(const [path,value]of kept)assert.deepEqual(await db.get(path),value,path);
   assert.equal((await db.get(EMAIL_BRIDGE_RESET_MARKER)).version,1);
  }finally{db.close();}
 });
});
