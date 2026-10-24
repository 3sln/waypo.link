// Wargame 4 follow-up (operator/lifecycle M1 applied to admin.mjs): administrator suspension, closure (auto-suspend)
// and reopening end the account's sessions, and each ended session's bound push subscriptions are queued for deletion
// through the identity service's pending-cleanup row (queuePushEnds, flushPushEnds), so an attacker's subscription does
// not outlive the suspension. Local recording transports only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {adminDeletionFixture,OWNER} from './helpers/admin-deletion.mjs';

const reason='Closure following an operator review.';
async function fixture(t){
 const f=await adminDeletionFixture();t.after(()=>f.close());const ended=[];
 f.identity.accountChannels={...f.identity.accountChannels,endSessions:async(owner,input)=>{ended.push({owner,...structuredClone(input)});return {ended:input.sessionIds.length};}};
 // The owner has two live sessions (an attacker's among them) when the administrator acts.
 const sessions=[];for(let i=0;i<2;i++){const account=await f.repository.get(OWNER),s=await f.identity.session(account);await f.identity.save(account,account.revision);sessions.push(s);}
 const ids=await Promise.all((await f.repository.get(OWNER)).sessions.map(s=>f.identity.sessionID(s)));
 return {f,ended,ids};
}
const approved=async(f,patch={})=>({...await f.input(patch),...await f.assertion()});

test('admin suspend queues push-subscription ends for every session it ends, and the row is flushed',async t=>{const {f,ended,ids}=await fixture(t);
 await f.admin.suspend({owner:OWNER},f.context);
 assert.deepEqual(ended.flatMap(e=>e.sessionIds).sort(),[...ids].sort());assert.equal(ended[0].owner,OWNER);
 const account=await f.repository.get(OWNER);assert.equal(account.sessions.length,0);assert.equal(account.pendingPushEnds,undefined,'flushed after the suspension commit');
});

test('a failed flush stays queued on the account for the identity service to retry',async t=>{const {f,ids}=await fixture(t);
 f.identity.accountChannels.endSessions=async()=>{throw Object.assign(Error('account object unavailable'),{code:'unavailable'});};
 await f.admin.suspend({owner:OWNER},f.context);
 assert.deepEqual([...(await f.repository.get(OWNER)).pendingPushEnds.ids].sort(),[...ids].sort());
});

test('closure (auto-suspend) and reopening end bound push subscriptions too',async t=>{const {f,ended,ids}=await fixture(t);
 await f.run('close',await approved(f,{reason}));
 assert.deepEqual(ended.flatMap(e=>e.sessionIds).sort(),[...ids].sort());assert.equal((await f.repository.get(OWNER)).pendingPushEnds,undefined);
 // A restricted closure-export session created while closed is ended by the reopen.
 const closed=await f.repository.get(OWNER);closed.sessions=[{id:'closure-export-session',hash:'h',expiresAt:f.clock.now()+3600000,createdAt:f.clock.now(),scope:'closure-export'}];closed.revision++;await f.repository.compareAndSwap(OWNER,closed.revision-1,closed);
 ended.length=0;await f.run('reopen',await approved(f,{reason:'Appeal accepted by the operator.'}));
 assert.deepEqual(ended.flatMap(e=>e.sessionIds),['closure-export-session']);
});
