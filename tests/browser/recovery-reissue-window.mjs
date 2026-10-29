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
const {recoveryFilePanel,cancelReissueDialog}=await import('../../apps/web/src/ui/recovery-reissue.mjs');
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

function intents(root,selector='button'){const seen=[];root.addEventListener('3sln-intent',event=>seen.push(event.detail.kind));return {seen,click:text=>{const b=[...root.querySelectorAll(selector)].find(x=>x.textContent===text);assert.ok(b,text);b.click();}};}

test('the cancel button only opens a warning; the cancel intent exists only in the dialog, after the warning, and dismissing sends nothing',()=>{
 const pending={recovery:{reissueAvailable:true,reissueEligible:true,pendingReissue:{usableAt,cancellable:true}}};
 const panel=render(recoveryFilePanel({locale:'en',config:{},data:pending})),p=intents(panel);
 p.click('Cancel the replacement');assert.deepEqual(p.seen,['open-modal'],'the panel never fires the cancel directly');
 for(const locale of ['en','es']){
  const dialog=cancelReissueDialog({locale,config:{},data:pending}),body=render(dialog.body),d=intents(body);
  assert.match(dialog.title,/Cancel the recovery file replacement\?/,'source text; translated by the console renderer');
  assert.match(body.textContent,/stops the pending replacement/);assert.match(body.textContent,/signs this device out of this account/);
  assert.ok(body.querySelector('button.danger-button'));
  d.click('Keep waiting');assert.deepEqual(d.seen,['close-modal'],'dismissing sends nothing');
  d.click('Cancel the replacement');assert.deepEqual(d.seen,['close-modal','cancel-pending-recovery-reissue']);
 }
});

test('the warning and its dialog strings are translated',async()=>{
 const {catalogues}=await import('../../packages/i18n/catalogues.mjs');
 for(const key of ['Cancel the recovery file replacement?','Cancelling stops the pending replacement. Your previous recovery file works again and the new one never will.','If this device started the replacement, cancelling also signs this device out of this account. Sign in again afterwards.','Keep waiting']){
  assert.ok(catalogues.en[''][key]&&catalogues.es[''][key],key);assert.notEqual(catalogues.es[''][key],key);
 }
});

test('eligibility display: only a passkey age makes a reissue eligible; a legacy password never does',()=>{
 const now=40*DAY;
 assert.equal(recoveryReissueEligibility({passwordHash:'h',passwordSetAt:0,credentials:[{createdAt:now-DAY}]},now).reissueEligible,false);
 assert.deepEqual(recoveryReissueEligibility({passwordHash:'h',passwordSetAt:0,credentials:[]},now),{reissueEligible:false,reissueEligibleAt:null},'a passkey-less account has no eligibility date');
 assert.equal(recoveryReissueEligibility({credentials:[{createdAt:now-7*DAY}]},now).reissueEligible,true);
});

test('cancel from an earlier device posts an explicit confirmation and refreshes the account',async()=>{
 const calls=[],published=[];let state={locale:'en',modal:{kind:'cancel-reissue'},session:{account:{id:'a'}}};
 const r={api:{request:async(path,body)=>{calls.push([path,body]);return {cancelled:true,restored:true};},get:async path=>{calls.push([path]);return {account:{id:'a'},recovery:{pendingReissue:null}};}},state:{peek:()=>state,transition:fn=>{state=fn({...state})??state;}},current:()=>true};
 await new CancelPendingRecoveryReissue({}).perform(r,{engineFeed:new EventTarget(),publish:v=>published.push(v)},{});
 assert.deepEqual(calls[0],['/api/auth/recovery/reissue/cancel',{confirmed:true}]);assert.deepEqual(calls[1],['/api/account']);
 assert.match(state.notice,/previous recovery file works again/);assert.equal(state.modal,null,'the warning dialog closes');
});

test('cancel from the device that made the replacement: the server ends this session, so the console signs out with the outcome, not "session expired"',async()=>{
 // recovery-reissue-browser regression (2026-10-27): the follow-up GET /api/account hit 401 and the notice was lost.
 const calls=[],secrets=[];let state={locale:'en',modal:{kind:'cancel-reissue'},busy:false,notice:'',error:'',session:{account:{id:'a'},sessionContext:'s'},data:{recovery:{pendingReissue:{cancellable:true}}}};
 const resources={state:{snapshot:()=>state,transition:fn=>{const next={...state};state=fn(next)??next;},reserve:()=>!state.busy&&(state={...state,busy:true},true)},
  api:{request:async(path,body)=>{calls.push([path,body]);return {cancelled:true,restored:true,notified:{email:false,push:false},signedOut:true};},get:async path=>{calls.push([path]);throw Object.assign(Error('Sign in to continue.'),{status:401,code:'unauthorized'});}},
  browser:{storeSecret:(key,value)=>secrets.push([key,value]),clearOwnerContext:()=>calls.push(['clearOwnerContext']),consumeSubmission:()=>({})}};
 await new CancelPendingRecoveryReissue({}).execute(resources,{engineFeed:new EventTarget()});
 assert.deepEqual(calls.map(c=>c[0]),['/api/auth/recovery/reissue/cancel','clearOwnerContext'],'no request is sent with the ended session');
 assert.equal(state.session,null);assert.equal(state.data,null);assert.equal(state.accountPicker,true);assert.equal(state.busy,false);assert.equal(state.modal,null);
 assert.equal(state.error,'');assert.match(state.notice,/^Replacement cancelled\. Your previous recovery file works again .* so it was signed out\. Sign in again\.$/);
});

test('recovery refused for a pending replacement keeps the proof in memory; cancelling with the file sends it once',async()=>{
 const secrets=new Map([['restoreFile','encrypted']]),calls=[];let state={config:{origin:'https://space.example',localDevelopment:true},unlockQuestions:[{id:'q'}],beamGeneration:0};
 const payload={version:3,recoveryToken:'id.token',fileId:'ICEiIyQlJicoKSorLC0uLw'};
 const r={state:{snapshot:()=>state,transition:fn=>{state=fn({...state})??state;}},browser:{secret:k=>secrets.get(k),storeSecret:(k,v)=>v===null?secrets.delete(k):secrets.set(k,v),recoveryChallenge:()=>'local-browser-test-token',clearRecoveryChallenge(){},navigate(){}},recoveryFile:{decrypt:async()=>payload},
  api:{request:async(path,body)=>{calls.push([path,body]);if(path==='/api/auth/recover')throw Object.assign(new Error('This recovery file was replaced recently.'),{code:'recovery_reissue_pending',status:409});return {cancelled:true,restored:true};}}};
 const ctx={engineFeed:new EventTarget()};
 await assert.rejects(new RecoverAccount({}).perform(r,ctx,{values:{'unlock:q':'answer'}}),{code:'recovery_reissue_pending'});
 assert.equal(state.restoreReissuePending,true);assert.deepEqual(secrets.get('reissueCancelProof'),{recoveryToken:'id.token'},'only the credential: v3 files carry nothing else to send');
 const page=render(recoveryPage({...state,route:{kind:'recovery-restore'},recoveryStage:'unlock',locale:'en'}));
 assert.ok([...page.querySelectorAll('button')].some(b=>/Cancel the replacement with this file/.test(b.textContent)));
 await new CancelReissueWithFile({}).perform(r,ctx,{});
 assert.deepEqual(calls.at(-1),['/api/auth/recovery/reissue/cancel-file',{recoveryToken:'id.token'}]);
 assert.equal(secrets.has('reissueCancelProof'),false);assert.equal(state.restoreReissuePending,false);assert.match(state.notice,/works again/);
 await assert.rejects(new CancelReissueWithFile({}).perform(r,ctx,{}),/Unlock your recovery file again/);
});

 test('cancel replacement maps unknown server codes to translated generic errors',async()=>{for(const locale of ['en','es']){const r={state:{snapshot:()=>({locale})},api:{request:async()=>{throw Object.assign(Error('server_error'),{code:'server_error',status:500});}}};await assert.rejects(new CancelPendingRecoveryReissue({}).perform(r,{},{}),{message:locale==='es'?'No se pudo completar esta solicitud. Actualiza y vuelve a intentarlo.':'This request could not be completed. Refresh and try again.'});}});
