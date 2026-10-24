// Wargame D3 (2026-10-23): the deletion-due backstop sweep must not be starved by held rows at the head of the
// index. A persisted cursor wraps through every due row before starting again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deletionDueIndex,sweepDeletionDue} from '../packages/runtime/account-deletion.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const uuid=i=>`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`;
function accountsFor(late,ticks){return {get:owner=>({invoke:async()=>{ticks.push(owner);return owner===late?{action:'deleted'}:{action:'hold',reason:'admin-hold'};}})};}

test('a later due account is ticked even when 64 earlier rows stay held',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const index=deletionDueIndex(db),now=Date.now();
 for(let i=0;i<64;i++)await index.put(uuid(i),now-30*86400000+i);
 const late=uuid(999);await index.put(late,now-1000);
 const ticks=[];for(let sweep=0;sweep<3;sweep++)await sweepDeletionDue({index,accounts:accountsFor(late,ticks),now});
 assert.ok(ticks.includes(late),'the late due account was never ticked');
});

test('the cursor wraps: every due row is ticked once per cycle, rows not yet due are skipped',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const index=deletionDueIndex(db),now=Date.now();
 for(let i=0;i<10;i++)await index.put(uuid(i),now-86400000+i);
 const future=uuid(500);await index.put(future,now+86400000);
 const ticks=[];const accounts=accountsFor(null,ticks);
 await sweepDeletionDue({index,accounts,now,limit:4});await sweepDeletionDue({index,accounts,now,limit:4});await sweepDeletionDue({index,accounts,now,limit:4});
 assert.deepEqual(ticks,Array.from({length:10},(_,i)=>uuid(i)),'one full cycle in order');
 assert.equal(ticks.includes(future),false);
 await sweepDeletionDue({index,accounts,now,limit:4});
 assert.deepEqual(ticks.slice(10),[uuid(0),uuid(1),uuid(2),uuid(3)],'the next cycle starts from the beginning');
});
