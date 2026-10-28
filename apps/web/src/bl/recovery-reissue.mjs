// Console flow for the active-account recovery reissue (docs/3sln/accounts/recovery-identity.md "Active-account
// reissue", provisional) and the local recovery-file check-up. Recovery file v3 (owner approval 2026-10-28): the file is
// an opaque credential encrypted on this device. Two server phases around the on-device work:
//   begin   POST /api/auth/recovery/reissue/begin {acknowledged:true}: needs a fresh step-up (the OwnerFlow's freshAPI
//           prompts on `reauthentication_required`); the server STAGES the new file (no key changes).
//   ...     encrypt with the owner's questions, download (remembering the SHA-256 of the exact encrypted bytes), test
//           the answers in memory, then the acknowledgement: the owner selects the saved file again and the browser
//           compares its SHA-256 with the downloaded bytes' hash, without decrypting it.
//   confirm POST /api/auth/recovery/reissue/confirm {recoveryToken, fileId, downloadConfirmed:true}: only after that
//           comparison. A 7-day window opens in which the new file cannot recover yet and the old one can only cancel
//           (POST .../reissue/cancel from an earlier device, the emailed link, or the old file on the recovery page).
// The plaintext file and the encrypted copy stay in the in-memory browser secrets, never in the UI projection, storage
// or a URL. Leaving before confirmation keeps the current file working: it is never cancelled before acknowledgement.
// The check-up (open/inspect/unlock-recovery-check) compares a picked file's id with the console's current file id,
// all on this device: no server call, so it is no oracle for the credential.
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {accountReset,clearBrowserAccount} from './account-context.mjs';
import {Action} from '../shared/stack.mjs';
import {createLocalization} from '../shared/i18n.mjs';

const TOKEN=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,FILE=/^[A-Za-z0-9_.-]{1,128}\.json$/,FILE_ID=/^[A-Za-z0-9_-]{21}[AQgw]$/;
const STAGES=['questions','download','verify','upload','confirm','done'];
/** The visible reissue state, or null. Never contains the file, its token or answers. */
export const reissueState=state=>state?.reissue&&STAGES.includes(state.reissue.stage)?state.reissue:null;
const cleared={reissue:null,recoveryStage:null,recoveryQuestions:null,unlockQuestions:null,downloaded:false,recoveryVerified:false,recoveryUploaded:false};
function forget(browser){browser.storeSecret('reissue',null);browser.storeSecret('reissueEncrypted',null);browser.storeSecret('reissueDigest',null);}
const stage=(r,ctx,next,patch={})=>publish(r,ctx,{reissue:{...snapshot(r).reissue,stage:next},error:'',...patch});

class ReissueFlow extends OwnerFlow {static deps={state:{write:true},api:{},browser:{},recoveryFile:{}};}
const t=r=>createLocalization({locale:snapshot(r).locale}).t;

export class BeginRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  if(detail.values?.acknowledged!=='on')throw Error('Confirm that your current recovery file will stop working.');
  const result=await r.api.request('/api/auth/recovery/reissue/begin',{acknowledged:true});
  if(typeof result?.content!=='string'||result.content.length>65536||!TOKEN.test(result.recoveryToken??'')||!FILE_ID.test(result.fileId??'')||!FILE.test(result.fileName??''))throw Error('The service returned an invalid recovery file.');
  forget(r.browser);r.browser.storeSecret('reissue',{content:result.content,recoveryToken:result.recoveryToken,fileId:result.fileId,fileName:result.fileName});
  publish(r,ctx,{...cleared,modal:null,notice:'',error:'',reissue:{stage:'questions',fileName:result.fileName,transferPending:result.transferPending===true,forced:typeof result.forced==='string'?result.forced:null,expiresAt:Number.isSafeInteger(result.expiresAt)?result.expiresAt:null},
   recoveryStage:'questions',recoveryQuestions:[{id:r.browser.id(),type:'passphrase',prompt:t(r)('What is my private recovery passphrase?'),hint:''}]});
  r.browser.focus?.('.recovery-reissue h2');
 }
}
export class EncryptRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue');if(reissueState(s)?.stage!=='questions'||!file?.content)throw Error('Start replacing your recovery file first.');
  const answers=s.recoveryQuestions.map(question=>detail.values?.['answer:'+question.id]);let encrypted;
  try{encrypted=await r.recoveryFile.encrypt(JSON.parse(file.content),s.recoveryQuestions,answers,s.config.origin);}finally{answers.fill('');}
  if(!r.current()||r.browser.secret('reissue')!==file)return;
  if(encrypted?.fileId!==file.fileId)throw Error('The service returned an invalid recovery file.');
  // The exact bytes offered for download, and their hash: the acknowledgement compares the re-selected file with these.
  const text=JSON.stringify(encrypted,null,2),digest=await r.recoveryFile.digest(text);
  if(!r.current()||r.browser.secret('reissue')!==file)return;
  r.browser.storeSecret('reissueEncrypted',text);r.browser.storeSecret('reissueDigest',digest);
  stage(r,ctx,'download',{recoveryStage:'download',unlockQuestions:encrypted.questions,downloaded:false,recoveryVerified:false,recoveryUploaded:false});
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
  if(payload.recoveryToken!==file.recoveryToken||payload.fileId!==file.fileId)throw Error('This recovery file does not match the replacement you started.');
  stage(r,ctx,'upload',{recoveryStage:'upload',recoveryVerified:true,recoveryUploaded:false});
 }
}
/** The download acknowledgement (owner approval 2026-10-28): the owner selects the file they saved; its SHA-256 must
 * equal the hash of the encrypted bytes this browser offered for download. Nothing is decrypted or sent. A different
 * file (an older one, an edited one, another download) is refused and the flow stays here. */
export class CheckRecoveryReissueUpload extends ReissueFlow {
 mutation=false;
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue'),expected=r.browser.secret('reissueDigest');
  if(reissueState(s)?.stage!=='upload'||!file||!expected||!s.downloaded||!s.recoveryVerified)throw Error('Download and test your new recovery file first.');
  const picked=detail.values?.file;if(!picked||typeof picked!=='object')throw Error('Choose the new recovery file you saved.');
  const digest=await r.recoveryFile.digest(picked);
  if(!r.current()||r.browser.secret('reissue')!==file)return;
  if(digest!==expected){publish(r,ctx,{recoveryUploaded:false});throw Error('This is not the file you just downloaded. Choose the new recovery file you saved on this device.');}
  stage(r,ctx,'confirm',{recoveryStage:'confirm',recoveryUploaded:true});
 }
}
export class ConfirmRecoveryReissue extends ReissueFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),file=r.browser.secret('reissue');
  if(reissueState(s)?.stage!=='confirm'||!file||!s.downloaded||!s.recoveryVerified||!s.recoveryUploaded)throw Error('Download your new recovery file, test it and select it again before replacing the old one.');
  if(detail.values?.confirmed!=='on')throw Error('Confirm that you saved your new recovery file.');
  const result=await r.api.request('/api/auth/recovery/reissue/confirm',{recoveryToken:file.recoveryToken,fileId:file.fileId,downloadConfirmed:true});
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
  if(result?.signedOut===true){if(!r.current())return;clearBrowserAccount(r);publish(r,ctx,{...accountReset(snapshot(r)),accountPicker:true,modal:null,notice:'Replacement cancelled. Your previous recovery file works again and the new one never will. This device made the replacement, so it was signed out. Sign in again.'});return;}
  publish(r,ctx,{error:'',modal:null,notice:'Replacement cancelled. Your previous recovery file works again and the new one never will.'});
  try{const data=await r.api.get('/api/account');publish(r,ctx,{data,session:{...snapshot(r).session,account:data.account}});}catch{}
 }
}
// ---- local check-up -------------------------------------------------------------------------------------------
// The visible check-up state: {stage:'select'|'answers'|'ok'|'previous'|'stale'}. Never holds the file or answers.
const CHECK_STAGES=['select','answers','ok','previous','stale'];
export const recoveryCheckState=state=>state?.recoveryCheck&&CHECK_STAGES.includes(state.recoveryCheck.stage)?state.recoveryCheck:null;
const checkCleared={recoveryCheck:null,unlockQuestions:null};
class CheckFlow extends OwnerFlow {static deps={state:{write:true},api:{},browser:{},recoveryFile:{}};}
export class OpenRecoveryCheck extends Action {
 static deps={state:{write:true},browser:{}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=snapshot(r);if(s.busy||reissueState(s)||!s.data?.recovery)return;r.browser.storeSecret('recoveryCheckFile',null);publish(r,ctx,{...checkCleared,modal:null,notice:'',error:'',recoveryCheck:{stage:'select'}});r.browser.focus?.('.recovery-check h2');}
}
/** Reads the picked file's public header only (no key derivation): an id that is not the current file's ends the
 * check-up at once; the previous file of a pending replacement is named as such. */
export class InspectRecoveryCheck extends CheckFlow {
 mutation=false;
 async perform(r,ctx,detail){
  const s=snapshot(r),view=s.data?.recovery;if(recoveryCheckState(s)?.stage!=='select'||!view)throw Error('Open the recovery file check again.');
  const result=await r.recoveryFile.inspect(detail.values?.file);if(!r.current()||recoveryCheckState(snapshot(r))?.stage!=='select')return;
  const id=result.header.fileId;
  if(typeof view.fileId==='string'&&id===view.fileId){r.browser.storeSecret('recoveryCheckFile',result.text);publish(r,ctx,{error:'',unlockQuestions:result.header.questions,recoveryCheck:{stage:'answers'}});return;}
  publish(r,ctx,{error:'',recoveryCheck:{stage:typeof view.pendingReissue?.previousFileId==='string'&&id===view.pendingReissue.previousFileId?'previous':'stale'}});
 }
}
/** Unlocks the current file with the owner's answers on this device and checks that its authenticated id and identity
 * match the console. Wrong answers keep the owner on this step; nothing is sent. */
export class UnlockRecoveryCheck extends CheckFlow {
 async perform(r,ctx,detail){
  const s=snapshot(r),view=s.data?.recovery,text=r.browser.secret('recoveryCheckFile');if(recoveryCheckState(s)?.stage!=='answers'||!text||!view)throw Error('Open the recovery file check again.');
  const answers=(s.unlockQuestions??[]).map(question=>detail.values?.['check:'+question.id]);let payload;
  try{payload=await r.recoveryFile.decrypt(text,answers,s.config.origin);}finally{answers.fill('');}
  if(!r.current()||r.browser.secret('recoveryCheckFile')!==text)return;
  const account=s.data?.account??s.session?.account;r.browser.storeSecret('recoveryCheckFile',null);
  publish(r,ctx,{error:'',unlockQuestions:null,recoveryCheck:{stage:payload.fileId===view.fileId&&payload.entity===account?.id?'ok':'stale'}});
 }
}
export class CloseRecoveryCheck extends Action {
 static deps={state:{write:true},browser:{}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=snapshot(r);if(!recoveryCheckState(s)||s.busy)return;r.browser.storeSecret('recoveryCheckFile',null);publish(r,ctx,{...checkCleared,error:''});}
}
/** Leaves the flow. Before confirmation the current file keeps working; nothing is sent. */
export class CloseRecoveryReissue extends Action {
 static deps={state:{write:true},browser:{}};
 constructor(detail={}){super();this.detail=detail;}
 execute(r,ctx){const s=snapshot(r);if(!reissueState(s)||s.busy)return;const done=s.reissue.stage==='done';forget(r.browser);
  publish(r,ctx,{...cleared,error:'',notice:done?'':'Replacement cancelled. Nothing changed.'});}
}
export const RECOVERY_REISSUE_INTENTS=Object.freeze({'begin-recovery-reissue':BeginRecoveryReissue,'encrypt-recovery-reissue':EncryptRecoveryReissue,'download-recovery-reissue':DownloadRecoveryReissue,'verify-recovery-reissue':VerifyRecoveryReissue,'check-recovery-reissue-upload':CheckRecoveryReissueUpload,'confirm-recovery-reissue':ConfirmRecoveryReissue,
 'open-recovery-check':OpenRecoveryCheck,'inspect-recovery-check':InspectRecoveryCheck,'unlock-recovery-check':UnlockRecoveryCheck,'close-recovery-check':CloseRecoveryCheck,'close-recovery-reissue':CloseRecoveryReissue,'cancel-pending-recovery-reissue':CancelPendingRecoveryReissue});
