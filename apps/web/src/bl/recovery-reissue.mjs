// Console flow for the active-account recovery reissue (docs/spec/recovery-identity.md "Active-account reissue",
// provisional). Two server phases around the existing on-device encryption:
//   begin   POST /api/auth/recovery/reissue/begin {acknowledged:true}: needs a fresh step-up (the OwnerFlow's freshAPI
//           prompts on `reauthentication_required`); the server rotates the signing key and STAGES the new file.
//   ...     encrypt with the owner's questions, download, test-unlock: all on this device, as during setup.
//   confirm POST /api/auth/recovery/reissue/confirm {recoveryToken, downloadConfirmed:true}: a 7-day window opens in which
//           the new file cannot recover yet and the old one can only cancel (POST .../reissue/cancel from an earlier
//           device, the emailed link, or the old file on the recovery page).
// The plaintext file and the encrypted copy stay in the in-memory browser secrets, never in the UI projection, storage
// or a URL. Cancelling before confirmation keeps the current file working.
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {accountReset,clearBrowserAccount} from './account-context.mjs';
import {Action} from '../shared/stack.mjs';
import {createLocalization} from '../shared/i18n.mjs';

const TOKEN=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,FILE=/^[A-Za-z0-9_.-]{1,128}\.json$/;
const STAGES=['questions','download','verify','confirm','done'];
/** The visible reissue state, or null. Never contains the file, its token or answers. */
export const reissueState=state=>state?.reissue&&STAGES.includes(state.reissue.stage)?state.reissue:null;
const cleared={reissue:null,recoveryStage:null,recoveryQuestions:null,unlockQuestions:null,downloaded:false,recoveryVerified:false};
function forget(browser){browser.storeSecret('reissue',null);browser.storeSecret('reissueEncrypted',null);}
const stage=(r,ctx,next,patch={})=>publish(r,ctx,{reissue:{...snapshot(r).reissue,stage:next},error:'',...patch});

class ReissueFlow extends OwnerFlow {static deps={state:{write:true},api:{},browser:{},recoveryFile:{}};}

export class BeginRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  if(detail.values?.acknowledged!=='on')throw Error('Confirm that your current recovery file will stop working.');
  // rotation_unavailable: the identity key could not be rotated (a moved identity's published key history is full), so
  // a new file would hold the same key. Nothing was staged; the current file keeps working.
  const result=await r.api.request('/api/auth/recovery/reissue/begin',{acknowledged:true}).catch(error=>{if(error?.code==='rotation_unavailable')throw Error('Your identity key cannot be replaced right now, so a new recovery file would not protect you. Your current recovery file keeps working. Contact support if you think it was exposed.');throw error;});
  if(typeof result?.content!=='string'||result.content.length>65536||!TOKEN.test(result.recoveryToken??'')||!FILE.test(result.fileName??''))throw Error('The service returned an invalid recovery file.');
  r.browser.storeSecret('reissue',{content:result.content,recoveryToken:result.recoveryToken,fileName:result.fileName});r.browser.storeSecret('reissueEncrypted',null);
  const t=createLocalization({locale:snapshot(r).locale}).t;
  publish(r,ctx,{...cleared,modal:null,notice:'',error:'',reissue:{stage:'questions',fileName:result.fileName,transferPending:result.transferPending===true,forced:typeof result.forced==='string'?result.forced:null,expiresAt:Number.isSafeInteger(result.expiresAt)?result.expiresAt:null},
   recoveryStage:'questions',recoveryQuestions:[{id:r.browser.id(),type:'passphrase',prompt:t('What is my private recovery passphrase?'),hint:''}]});
  r.browser.focus?.('.recovery-reissue h2');
 }
}
export class EncryptRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue');if(reissueState(s)?.stage!=='questions'||!file?.content)throw Error('Start replacing your recovery file first.');
  const answers=s.recoveryQuestions.map(question=>detail.values?.['answer:'+question.id]);let encrypted;
  try{encrypted=await r.recoveryFile.encrypt(JSON.parse(file.content),s.recoveryQuestions,answers,s.config.origin);}finally{answers.fill('');}
  if(!r.current()||r.browser.secret('reissue')!==file)return;
  r.browser.storeSecret('reissueEncrypted',JSON.stringify(encrypted,null,2));
  stage(r,ctx,'download',{recoveryStage:'download',unlockQuestions:encrypted.questions,downloaded:false,recoveryVerified:false});
 }
}
export class DownloadRecoveryReissue extends ReissueFlow {
 mutation=false;
 async perform(r,ctx){
  const encrypted=r.browser.secret('reissueEncrypted'),file=r.browser.secret('reissue');if(!encrypted||!file)throw Error('Encrypt your new recovery file before downloading.');
  r.browser.download(file.fileName,encrypted);stage(r,ctx,'verify',{recoveryStage:'verify',downloaded:true});
 }
}
export class VerifyRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue'),encrypted=r.browser.secret('reissueEncrypted');if(!s.downloaded||!file||!encrypted)throw Error('Download your new recovery file before testing it.');
  const answers=(s.unlockQuestions??[]).map(question=>detail.values?.['verify:'+question.id]);let payload;
  try{payload=await r.recoveryFile.decrypt(encrypted,answers,s.config.origin);}finally{answers.fill('');}
  if(!r.current()||r.browser.secret('reissue')!==file)return;
  if(payload.recoveryToken!==file.recoveryToken)throw Error('This recovery file does not match the replacement you started.');
  stage(r,ctx,'confirm',{recoveryStage:'confirm',recoveryVerified:true});
 }
}
export class ConfirmRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue');
  if(reissueState(s)?.stage!=='confirm'||!file||!s.downloaded||!s.recoveryVerified)throw Error('Download and test your new recovery file before replacing the old one.');
  if(detail.values?.confirmed!=='on')throw Error('Confirm that you saved your new recovery file.');
  const result=await r.api.request('/api/auth/recovery/reissue/confirm',{recoveryToken:file.recoveryToken,downloadConfirmed:true});
  forget(r.browser);
  publish(r,ctx,{...cleared,reissue:{stage:'done',transferCancelled:result?.transferCancelled===true},error:''});
  try{const data=await r.api.get('/api/account');publish(r,ctx,{data,session:{...snapshot(r).session,account:data.account}});}catch{publish(r,ctx,{notice:'Your new recovery file is active. Reload to see the latest details.'});}
  r.browser.focus?.('.recovery-reissue h2');
 }
}
/** Cancels a committed replacement during its 7-day window from this (earlier) device: the previous file works again and
 * the new one never will. The server accepts it only from a session that existed before the replacement began. */
export class CancelPendingRecoveryReissue extends ReissueFlow {
 async perform(r,ctx){
  let result;try{result=await r.api.request('/api/auth/recovery/reissue/cancel',{confirmed:true});}catch(error){
   const known={rate_limited:'Too many requests. Wait a moment, then try again.',not_found:'Not found.',forbidden:'This request could not be completed. Refresh and try again.'};
   if(error.code)throw Error(createLocalization({locale:snapshot(r).locale}).t(known[error.code]??'This request could not be completed. Refresh and try again.'));
   throw error;
  }
  // The cancel ends the sessions that staged and confirmed the replacement (DEVLOG 2026-10-23 "Cancel sessions"); when
  // this was one of them, sign this browser out of the account with the outcome instead of an "expired" error.
  if(result?.signedOut===true){if(!r.current())return;clearBrowserAccount(r);publish(r,ctx,{...accountReset(snapshot(r)),accountPicker:true,notice:'Replacement cancelled. Your previous recovery file works again and the new one never will. This device made the replacement, so it was signed out. Sign in again.'});return;}
  publish(r,ctx,{error:'',notice:'Replacement cancelled. Your previous recovery file works again and the new one never will.'});
  try{const data=await r.api.get('/api/account');publish(r,ctx,{data,session:{...snapshot(r).session,account:data.account}});}catch{}
 }
}
/** Leaves the flow. Before confirmation the current file keeps working; nothing is sent. */
export class CloseRecoveryReissue extends Action {
 static deps={state:{write:true},browser:{}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=snapshot(r);if(!reissueState(s)||s.busy)return;const done=s.reissue.stage==='done';forget(r.browser);
  publish(r,ctx,{...cleared,error:'',notice:done?'':'Replacement cancelled. Nothing changed.'});}
}
export const RECOVERY_REISSUE_INTENTS=Object.freeze({'begin-recovery-reissue':BeginRecoveryReissue,'encrypt-recovery-reissue':EncryptRecoveryReissue,'download-recovery-reissue':DownloadRecoveryReissue,'verify-recovery-reissue':VerifyRecoveryReissue,'confirm-recovery-reissue':ConfirmRecoveryReissue,'close-recovery-reissue':CloseRecoveryReissue,'cancel-pending-recovery-reissue':CancelPendingRecoveryReissue});
