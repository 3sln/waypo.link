// Red-team round 3, device authorization (D4, D5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,requestOf,DeviceApprove,DeviceReview,LinkedApprovalAction,activate,sessionContext,context,dpopKey} from './helpers/device-approval-fixture.mjs';

// routes/identity.mjs:80 — POST /api/auth/linked/approve without a `consent` array dispatches LinkedApprovalAction
// 'linkedApprove' directly, whatever the request kind. For an `app` request this skips the owner-shard consent
// (deviceConsentApprove), so the linked record becomes approved with no approval record; the device's next poll
// consumes the request, reserves lineage, then fails with access_denied. The user sees "approved" (and gets the
// approval notice) and the device request is burned.
test('an app-kind request cannot be approved through the session approval operation (no owner consent)',async()=>{
 const f=await fixture();try{
  await activate(f.id.act);const key=await dpopKey(),flow=await f.start(key);f.clock.advance(1000);
  const approver=await f.login();
  const outcome=await f.id.engine.dispatch(new LinkedApprovalAction('linkedApprove',{requestId:requestOf(flow),code:flow.user_code,approved:true},sessionContext(approver))).next('result').then(r=>r.detail,e=>e);
  const record=await f.id.deviceRequests.get(requestOf(flow));
  f.clock.advance(5000);const poll=await f.poll(key,flow);
  assert.ok(outcome instanceof Error,`session-path approval of an app request was accepted (status now ${record.status}); the device then got ${poll.status} ${poll.body.error??''} and the request is ${(await f.id.deviceRequests.get(requestOf(flow))).status}`);
  assert.equal(record.status,'pending');
 }finally{await f.dispose();}
});

// RFC 8628 §3.5: after the user approves, the device's next poll gets tokens. Here an approval landing in the last
// interval before pendingUntil is reported to the user as successful, but redeem() checks pendingUntil before the
// approved status (linked-approval.mjs:377), so the device gets expired_token.
test('an approval just before expiry is honoured on the device\'s next poll',async()=>{
 const f=await fixture();try{
  await activate(f.id.act);const key=await dpopKey(),flow=await f.start(key);
  f.clock.advance(5000);assert.equal((await f.poll(key,flow)).body.error,'authorization_pending');
  f.clock.advance(600000-5000-3000);
  const approver=await f.login();const view=await f.op(DeviceReview,{context:sessionContext(approver),requestId:requestOf(flow),code:flow.user_code});
  const approved=await f.op(DeviceApprove,{context:sessionContext(approver),requestId:requestOf(flow),code:flow.user_code,approved:view.consent.requests.map(r=>({fragment:r.fragment,fields:r.fields,revision:r.revision}))});
  assert.equal(approved.approved,true,'the approver was told the device is signed in');
  f.clock.advance(5000);const poll=await f.poll(key,flow);
  assert.equal(poll.status,200,`device poll after a successful approval: ${poll.status} ${JSON.stringify(poll.body)}`);
 }finally{await f.dispose();}
});

test('the consent path still approves an app request',async()=>{
 const f=await fixture();try{
  await activate(f.id.act);const key=await dpopKey(),flow=await f.start(key);f.clock.advance(1000);
  const approver=await f.login();const approved=await f.approve(approver,flow);assert.equal(approved.approved,true);
  f.clock.advance(5000);assert.equal((await f.poll(key,flow)).status,200);
 }finally{await f.dispose();}
});

test('a session request cannot be approved by naming the app kind',async()=>{
 const f=await fixture();try{
  await activate(f.id.act);
  const run=(method,input,ctx)=>f.id.engine.dispatch(new LinkedApprovalAction(method,input,ctx)).next('result').then(r=>r.detail);
  const request=await run('linkedStart',{deviceKind:'tv',turnstileToken:'verified'},{...context,deviceBinding:'tv-binding-'.padEnd(48,'x')});f.clock.advance(1000);
  const approver=await f.login();
  await assert.rejects(run('linkedApprove',{requestId:request.requestId,code:request.userCode,approved:true,kind:'app'},sessionContext(approver)),{code:'invalid_code'});
  assert.equal((await f.id.deviceRequests.get(request.requestId)).status,'pending');
  assert.equal((await run('linkedApprove',{requestId:request.requestId,code:request.userCode,approved:true,kind:'session'},sessionContext(approver))).approved,true);
 }finally{await f.dispose();}
});
