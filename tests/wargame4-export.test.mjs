// Wargame 4 M4: a non-ready export ends. Lost buffered parts are final on repeat, a persistent error stops at the
// failure cap, a job that never finishes stops at the generation deadline; system-caused failures are not charged
// to the weekly allowance and the account alarm backs off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,E,OWNER} from './helpers/export-world.mjs';
import {collectGarbageRef} from '../packages/runtime/export-pins.mjs';
import {EXPORT_GENERATION_DEADLINE,EXPORT_MAX_FAILURES,exportRetryDelay} from '../packages/runtime/export-generation.mjs';
import {methods} from '../packages/runtime/account/exports.mjs';
const DAY=86400000,OP2='00000000-0000-4000-8000-000000000002',OP3='00000000-0000-4000-8000-000000000003',OP4='00000000-0000-4000-8000-000000000004';

// Mirrors packages/runtime/account/exports.mjs exportAlarm(): expire, then step.
async function alarm(f){try{await f.op(E.ExpireExports,{actor:f.system});await f.op(E.StepExport,{actor:f.system});return null;}catch(e){return e.code;}}

test('lost buffered parts: the job fails on the repeated export_part_missing, releases pins and export/active',async t=>{
 const ref=`messages/${OWNER}/m1`;
 const contributors=[
  {name:'messages',version:1,page:async()=>({rows:[{id:'m1'}],payloads:[{entryId:'m1',kind:'message',source:{message:'m1',part:0},path:'data/messages/m1/0.bin',ref,size:3}],done:true})},
  {name:'tail',version:1,page:async()=>({rows:[{id:'t'}],done:true})},
 ];
 const f=await fixture(t,{contributors});await f.blobs.put(ref,new Uint8Array([1,2,3]));
 const job=await f.create();
 for(let i=0;i<20&&(await f.op(E.ExportStatus,{id:job.id})).state!=='sealing';i++)await alarm(f);
 assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'sealing');
 f.archives.rows.clear();await f.metadata.put('blob-garbage/g1',ref);
 const codes=[];for(let i=0;i<5;i++){f.clock.advance(60000);codes.push(await alarm(f));}
 const status=await f.op(E.ExportStatus,{id:job.id});
 assert.equal(status.state,'failed');assert.equal(status.failure,'export_part_missing');
 assert.equal(codes.filter(code=>code==='export_part_missing').length,2,'final on the second occurrence');
 assert.equal(await f.metadata.get('export/active'),undefined,'export/active no longer blocks new exports');
 assert.equal(await collectGarbageRef({metadata:f.metadata,blobs:f.blobs},'blob-garbage/g1',ref),'deleted','the dead export no longer pins the deleted blob');
 // A system-caused failure is not charged: two more exports fit in the same week.
 await f.create(OP2);await f.op(E.CancelExport,{id:(await f.op(E.ExportList)).jobs.at(-1).id});
 await f.create(OP3);await f.op(E.CancelExport,{id:(await f.op(E.ExportList)).jobs.at(-1).id});
 await assert.rejects(f.create(OP4),{code:'export_rate_limited'},'cancelled exports are still charged');
});

test('a persistent unlisted error stops at the consecutive-failure cap',async t=>{
 const contributors=[{name:'broken',version:1,page:async()=>{throw Object.assign(new Error('contributor down'),{code:'contributor_unavailable'});}}];
 const f=await fixture(t,{contributors}),job=await f.create();
 let attempts=0;for(let i=0;i<EXPORT_MAX_FAILURES+5&&(await f.op(E.ExportStatus,{id:job.id})).state!=='failed';i++){f.clock.advance(60000);await alarm(f);attempts++;}
 const status=await f.op(E.ExportStatus,{id:job.id});
 assert.equal(status.state,'failed');assert.equal(status.failure,'contributor_unavailable');assert.equal(attempts,EXPORT_MAX_FAILURES);
 assert.equal(await f.metadata.get('export/active'),undefined);
});

test('a job that keeps making progress but never finishes stops at the generation deadline',async t=>{
 let n=0;const contributors=[{name:'endless',version:1,page:async()=>({rows:[{id:'r'+n}],cursor:{n:++n},done:false})}];
 const f=await fixture(t,{contributors}),job=await f.create();
 for(let i=0;i<10;i++){f.clock.advance(60000);await alarm(f);}
 assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'generating');
 f.clock.advance(EXPORT_GENERATION_DEADLINE);await alarm(f);
 const status=await f.op(E.ExportStatus,{id:job.id});
 assert.equal(status.state,'failed');assert.equal(status.failure,'export_deadline');assert.equal(await f.metadata.get('export/active'),undefined);
});

test('an owner-caused failure (pin budget) stays charged to the weekly allowance',async t=>{
 const ref=`messages/${OWNER}/big`,contributors=[{name:'messages',version:1,page:async()=>({rows:[{id:'b'}],payloads:[{entryId:'b',kind:'message',source:{message:'b',part:0},path:'data/messages/b/0.bin',ref,size:2048}],done:true})}];
 const f=await fixture(t,{contributors});f.ports.quota=async()=>1024;await f.blobs.put(ref,new Uint8Array(2048));
 const job=await f.create();for(let i=0;i<5;i++)await alarm(f);
 assert.equal((await f.op(E.ExportStatus,{id:job.id})).failure,'export_pin_budget');
 await f.create(OP2);await f.op(E.CancelExport,{id:(await f.op(E.ExportList)).jobs.at(-1).id});
 await assert.rejects(f.create(OP3),{code:'export_rate_limited'});
});

test('the account export alarm backs off by consecutive failures (60 s doubling to 1 h)',async t=>{
 assert.deepEqual([1,2,3,4,5,6,7,30].map(exportRetryDelay),[60000,120000,240000,480000,960000,1920000,3600000,3600000]);
 const contributors=[{name:'broken',version:1,page:async()=>{throw Object.assign(new Error('down'),{code:'contributor_unavailable'});}}];
 const f=await fixture(t,{contributors}),wakes=[];
 const controller={metadata:f.metadata,archives:f.archives,blobs:f.blobs,config:{APP_ORIGIN:'https://issuer.example',flags:f.flags,exportPorts:f.ports,ACCOUNT_EXPORT_ENABLED:'true',LIFECYCLE_CLOCK:f.clock.now},warm:async()=>{},scheduleAlarm:async at=>wakes.push(at),...methods};
 await f.create();
 const delays=[];for(let i=0;i<4;i++){const before=Date.now(),result=await controller.exportAlarm();assert.equal(result.error,'contributor_unavailable');delays.push(result.wakeAt-before);}
 assert.ok(delays[0]>=60000&&delays[0]<61000,'first retry after about a minute');
 assert.ok(delays[3]>=480000&&delays[3]<481000,'fourth retry after about eight minutes, not one');
});

test('review: data failures are charged, and system failures are uncharged at most twice per week',async t=>{
 const ref=`messages/${OWNER}/gone`,contributors=[{name:'messages',version:1,page:async()=>({rows:[{id:'g'}],payloads:[{entryId:'g',kind:'message',source:{message:'g',part:0},path:'data/messages/g/0.bin',ref,size:3}],done:true})}];
 const f=await fixture(t,{contributors});// the payload blob does not exist: export_payload_missing (a data failure)
 const job=await f.create();for(let i=0;i<5;i++)await alarm(f);
 assert.equal((await f.op(E.ExportStatus,{id:job.id})).failure,'export_payload_missing');
 await f.create(OP2);await f.op(E.CancelExport,{id:(await f.op(E.ExportList)).jobs.at(-1).id});
 await assert.rejects(f.create(OP3),{code:'export_rate_limited'},'a data failure is charged');
});

test('review: a third system failure in a week is charged',async t=>{
 const contributors=[{name:'broken',version:1,page:async()=>{throw Object.assign(new Error('down'),{code:'contributor_unavailable'});}}];
 const f=await fixture(t,{contributors}),ops=[OP2,OP3,OP4,'00000000-0000-4000-8000-000000000005'];
 const fail=async operationId=>{const job=await f.create(operationId);for(let i=0;i<EXPORT_MAX_FAILURES+2&&(await f.op(E.ExportStatus,{id:job.id})).state!=='failed';i++){f.clock.advance(60000);await alarm(f);}assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'failed');};
 await fail(ops[0]);await fail(ops[1]);await fail(ops[2]);
 const history=await f.metadata.get('export/history');assert.equal(history.filter(h=>h.uncharged).length,2);
 await f.create(ops[3]);await f.op(E.CancelExport,{id:(await f.op(E.ExportList)).jobs.at(-1).id});await assert.rejects(f.create('00000000-0000-4000-8000-000000000006'),{code:'export_rate_limited'});
});
