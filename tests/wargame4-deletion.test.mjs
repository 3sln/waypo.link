// Wargame 4 L1/L2 and the Node sweep: the owner deletion request/cancel loop is bounded; a committed request is anchored
// before any external call; the Node deletion-due sweep follows the live flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deletionFixture} from './helpers/deletion-world.mjs';
import {REQUEST_KEY,REQUEST_BUDGET,RECEIPT_CAP,deletionDueIndex,deletionDueSweepRun} from '../packages/runtime/account-deletion.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {stages} from '../packages/runtime/routes/deletion.mjs';

const DAY=86400000,HOUR=3600000,turn=()=>new Promise(resolve=>setImmediate(resolve));
const op=(i,day=0)=>`op-loop-${String(day).padStart(3,'0')}-${String(i).padStart(8,'0')}`;

test('L1: one step-up cannot buy unbounded request/cancel cycles (budget, provider calls, notices)',async t=>{
 const x=await deletionFixture(t);let refused=0;
 for(let i=0;i<60;i++){try{await x.request({operationId:op(i)});}catch(error){assert.equal(error.code,'deletion_rate_limited');refused++;continue;}await x.cancel();}
 assert.equal(60-refused,REQUEST_BUDGET,'requests per account per day are bounded');
 assert.ok(x.billingCalls.length<=2*REQUEST_BUDGET,`${x.billingCalls.length} Polar calls`);
 assert.equal(x.notices.filter(n=>n.kind==='scheduled').length,REQUEST_BUDGET,'one scheduled notice per accepted request');
 x.clock.advance(DAY);await x.request({operationId:op(0,1)});assert.equal(x.notices.filter(n=>n.kind==='scheduled').length,REQUEST_BUDGET+1,'the budget refreshes after the window');
});

test('L1: receipts are capped over many days of cycles',async t=>{
 const x=await deletionFixture(t);
 for(let day=0;day<12;day++){for(let i=0;i<REQUEST_BUDGET;i++){await x.request({operationId:op(i,day)});await x.cancel();}x.clock.advance(DAY);}
 const receipts=[...(await x.metadata.list({prefix:'deletion/receipt/'})).keys()];
 assert.ok(receipts.length<=RECEIPT_CAP,`${receipts.length} receipt rows (cap ${RECEIPT_CAP})`);
 // The newest receipt still replays its own request.
 const latest=await x.request({operationId:op(0,99)}),replay=await x.request({operationId:op(0,99)});assert.equal(replay.state,latest.state);
});

test('L2: a committed request is anchored (due row and alarm) before the billing call',async t=>{
 const x=await deletionFixture(t);
 let alarm=null;x.metadata.getAlarm=async()=>alarm;x.metadata.setAlarm=async time=>{alarm=time;};
 let release;const hung=new Promise(resolve=>{release=resolve;}),original=x.ports.billing.cancelAtPeriodEnd;
 x.ports.billing.cancelAtPeriodEnd=async owner=>{await hung;return original(owner);};
 const pending=x.request().catch(error=>error);
 for(let i=0;i<50;i++)await turn();
 const request=await x.metadata.get(REQUEST_KEY),dueRows=[...(await x.dueDb.list({prefix:'deletion-due/'})).keys()];
 assert.equal(request?.state,'scheduled','precondition: committed while the Polar call is in flight');
 assert.ok(dueRows.length>0,'the deletion-due row exists before the external call');
 assert.ok(Number.isSafeInteger(alarm)&&alarm<=x.clock.now()+5*60000,'a backstop alarm is armed before the external call');
 release();await pending;
});

test('L1: the owner request and cancel routes are budgeted per session and per network',async()=>{
 const consumed=new Map(),env={APP_ORIGIN:'https://account.example',KEY_ENCRYPTION_KEY:'k'.repeat(32),ABUSE:{consume:async(key,{limit})=>{const n=(consumed.get(key)??0)+1;consumed.set(key,n);return n<=limit;}},
  ACCOUNT_DELETION_ENABLED:'true'};
 let cancels=0;const object={deletionCancel:async()=>{cancels++;return {state:'cancelled'};}};
 const route=session=>({request:new Request('https://account.example/api/account/deletion/cancel',{method:'POST',headers:{Origin:'https://account.example','Content-Type':'application/json','CF-Connecting-IP':'198.51.100.7'},body:'{}'}),env,path:'/api/account/deletion/cancel',url:new URL('https://account.example/api/account/deletion/cancel'),context:{csrfToken:'c'},id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',object,owner:{csrfToken:'c',sessionContext:session}});
 const statuses=[];for(let i=0;i<12;i++)statuses.push((await stages.beforeActivity(route('session-1'))).status);
 assert.equal(statuses.filter(s=>s===200).length,10);assert.equal(statuses.at(-1),429);
 // Another session on the same /24 still has its own session budget until the network budget (60) is spent.
 let ok=0;for(let s=2;s<12;s++)for(let i=0;i<10;i++)if((await stages.beforeActivity(route('session-'+s))).status===200)ok++;
 assert.equal(ok,50,'the network budget caps all sessions together');assert.equal(cancels,60);
});

test('Node: the deletion-due sweep runs whatever the boot-time flag was and follows the live flag on each run',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const index=deletionDueIndex(db),stepped=[];
 const owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';await index.put(owner,Date.now()-1000);
 const accounts={get:id=>({invoke:async({method})=>{stepped.push([id,method]);return {action:'waiting'};},deletionStep:async()=>{stepped.push([id,'deletionStep']);return {action:'waiting'};}})};
 let killed=true;const run=deletionDueSweepRun({flags:async()=>({background:()=>!killed}),index,accounts});
 assert.deepEqual(await run(),{skipped:true});assert.equal(stepped.length,0);
 killed=false;await run();assert.ok(stepped.some(([id])=>id===owner),'a later run sweeps once the flag allows it');
 // The Node adapter no longer gates starting the sweep on the boot-time flag value.
 const source=readFileSync(new URL('../apps/node/resources.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/else if\(siteGlobal\(config,'ACCOUNT_DELETION_ENABLED'\)\)/);assert.match(source,/deletionDueSweepRun\(/);
 assert.ok(HOUR);
});

test('review: a re-request minutes after a cancel gets its own scheduled notice and a working cancel link',async t=>{
 const x=await deletionFixture(t);
 await x.request({operationId:'op-aaaaaaaaaaaaaaaa'});const first=x.notices.filter(n=>n.kind==='scheduled')[0].cancelToken;assert.ok(first);
 await x.cancel();x.clock.advance(60000);
 await x.request({operationId:'op-bbbbbbbbbbbbbbbb'});
 const scheduled=x.notices.filter(n=>n.kind==='scheduled');assert.equal(scheduled.length,2,'the second request is announced');
 const second=scheduled[1].cancelToken;assert.ok(second&&second!==first);
 await assert.rejects(x.cancelToken(first),{code:'invalid_token'});
 assert.equal((await x.cancelToken(second)).state,'cancelled','the owner can cancel the re-request from its own notice');
});
