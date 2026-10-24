// Console and recovery-page views of the reissue cooling-off window (docs/spec/recovery-identity.md "Active-account
// reissue", wargame 2026-10-23 #1): the pending replacement is shown with its usable date, the replace action is hidden,
// an earlier device can cancel, and the recovery page offers a file-cancel when recovery is refused for a pending
// replacement. Engine-level with stub ports and happy-dom; run with the browser loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {recoveryReissueEligibility} from '../../packages/runtime/recovery-eligibility.mjs';
const window=new Window({url:'https://space.example'});
for(const key of ['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'])globalThis[key]=window[key];
const {dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {recoveryFilePanel}=await import('../../apps/web/src/ui/recovery-reissue.mjs');
const {CancelPendingRecoveryReissue}=await import('../../apps/web/src/bl/recovery-reissue.mjs');
const {RecoverAccount,CancelReissueWithFile}=await import('../../apps/web/src/bl/release.mjs');
const {default:recoveryPage}=await import('../../apps/web/src/ui/release-recovery.mjs');
function render(view){const root=document.createElement('div');dodo.reconcile(root,[view]);return root;}
test.after(()=>window.happyDOM.close());
const DAY=86400000,usableAt=Date.UTC(2026,10,1);

test('a pending replacement shows its usable date, hides replace, and offers cancel only to an earlier device',()=>{
 for(const locale of ['en','es']){
  const root=render(recoveryFilePanel({locale,config:{},data:{recovery:{issuedAt:usableAt-7*DAY,reissueAvailable:true,reissueEligible:true,pendingReissue:{reissuedAt:usableAt-7*DAY,usableAt,previousRestorable:true,cancellable:true}}}}));
  assert.equal(root.querySelectorAll('.recovery-pending[role=alert]').length,1);
  const buttons=[...root.querySelectorAll('button')].map(b=>b.textContent);
  assert.equal(buttons.length,1);assert.match(buttons[0],/Cancel the replacement/,'source text; translation is applied by the console renderer');
 }
 const later=render(recoveryFilePanel({locale:'en',config:{},data:{recovery:{reissueAvailable:true,reissueEligible:true,pendingReissue:{usableAt,cancellable:false}}}}));
 assert.equal(later.querySelectorAll('button').length,0);assert.match(later.textContent,/link in the email notice/);
});

test('eligibility display: with a passkey, the password age never makes a reissue eligible',()=>{
 const now=40*DAY;
 assert.equal(recoveryReissueEligibility({passwordHash:'h',passwordSetAt:0,credentials:[{createdAt:now-DAY}]},now).reissueEligible,false);
 assert.equal(recoveryReissueEligibility({passwordHash:'h',passwordSetAt:0,credentials:[]},now).reissueEligible,true);
});

test('cancel from an earlier device posts an explicit confirmation and refreshes the account',async()=>{
 const calls=[],published=[];let state={locale:'en',session:{account:{id:'a'}}};
 const r={api:{request:async(path,body)=>{calls.push([path,body]);return {cancelled:true,restored:true};},get:async path=>{calls.push([path]);return {account:{id:'a'},recovery:{pendingReissue:null}};}},state:{peek:()=>state,transition:fn=>{state=fn({...state})??state;}},current:()=>true};
 await new CancelPendingRecoveryReissue({}).perform(r,{engineFeed:new EventTarget(),publish:v=>published.push(v)},{});
 assert.deepEqual(calls[0],['/api/auth/recovery/reissue/cancel',{confirmed:true}]);assert.deepEqual(calls[1],['/api/account']);
 assert.match(state.notice,/previous recovery file works again/);
});

test('recovery refused for a pending replacement keeps the proof in memory; cancelling with the file sends it once',async()=>{
 const secrets=new Map([['restoreFile','encrypted']]),calls=[];let state={config:{origin:'https://space.example',localDevelopment:true},unlockQuestions:[{id:'q'}],beamGeneration:0};
 const payload={version:2,recoveryToken:'id.token'};
 const r={state:{snapshot:()=>state,transition:fn=>{state=fn({...state})??state;}},browser:{secret:k=>secrets.get(k),storeSecret:(k,v)=>v===null?secrets.delete(k):secrets.set(k,v),recoveryChallenge:()=>'local-browser-test-token',clearRecoveryChallenge(){},navigate(){}},recoveryFile:{decrypt:async()=>payload},
  api:{request:async(path,body)=>{calls.push([path,body]);if(path==='/api/auth/recover')throw Object.assign(new Error('This recovery file was replaced recently.'),{code:'recovery_reissue_pending',status:409});return {cancelled:true,restored:true};}}};
 const ctx={engineFeed:new EventTarget()};
 await assert.rejects(new RecoverAccount({}).perform(r,ctx,{values:{'unlock:q':'answer'}}),{code:'recovery_reissue_pending'});
 assert.equal(state.restoreReissuePending,true);assert.deepEqual(secrets.get('reissueCancelProof'),{recoveryToken:'id.token',identityBackup:payload});
 const page=render(recoveryPage({...state,route:{kind:'recovery-restore'},recoveryStage:'unlock',locale:'en'}));
 assert.ok([...page.querySelectorAll('button')].some(b=>/Cancel the replacement with this file/.test(b.textContent)));
 await new CancelReissueWithFile({}).perform(r,ctx,{});
 assert.deepEqual(calls.at(-1),['/api/auth/recovery/reissue/cancel-file',{recoveryToken:'id.token',identityBackup:payload}]);
 assert.equal(secrets.has('reissueCancelProof'),false);assert.equal(state.restoreReissuePending,false);assert.match(state.notice,/works again/);
 await assert.rejects(new CancelReissueWithFile({}).perform(r,ctx,{}),/Unlock your recovery file again/);
});
