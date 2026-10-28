// Console views of the active-account recovery reissue (bl/recovery-reissue.mjs). The questions and unlock forms are
// the setup ones (recovery-questions.mjs) with reissue intents; typed answers stay in native controls.
import {h,icon,badge,checkbox,field,helpers,interfaceText} from './release-primitives.mjs';
import questions,{recoveryUnlockForm} from './recovery-questions.mjs';
import {reissueState,recoveryCheckState} from '../bl/recovery-reissue.mjs';

const REQUIRED={'elevated-abort':'You stopped a disputed move with your recovery file, so that file no longer works. Create a new one now.','transfer-in':'Your identity moved here. Create a recovery file in this provider\'s format.','legacy-format':'Your recovery file uses an older format that no longer works. Create a new one now.'};
/** The annual offer (a reminder only; the current file keeps working). */
function reminderNote(view,date){
 const stage=view.reminder?.stage;if(!['upcoming','due','overdue'].includes(stage))return null;
 return h('div',h('strong','Time for a new recovery file?'),h('p',stage==='upcoming'?interfaceText('Your recovery file will be a year old on {date}. We suggest creating a new one each year.',{date:date(view.reminder.anniversaryAt)}):'Your recovery file is more than a year old. We suggest creating a new one each year.'),h('p','Nothing stops working. Your current file keeps working until you confirm a new one.')).attrs({role:'status'}).classes('security-note','recovery-reminder');
}

/** The "Recovery file" block of the security view. */
export function recoveryFilePanel(state){
 const {btn,date}=helpers(state),view=state.data?.recovery??null;if(!view)return null;
 const required=typeof view.reissueRequired==='string'?REQUIRED[view.reissueRequired]??REQUIRED['elevated-abort']:null;
 return h('section',h('div',icon('shield')).classes('section-icon'),h('h2','Recovery file'),
  view.pendingReissue?h('div',h('strong','Your recovery file was replaced recently.'),h('p',interfaceText(view.pendingReissue.previousFileCanCancel===false?'The new file can recover your account from {date}. It was confirmed with a passkey, so your previous file cannot cancel it; use an earlier device or the email link.':'The new file can recover your account from {date}. Until then your previous file can only cancel the replacement.',{date:date(view.pendingReissue.usableAt)})),
   view.pendingReissue.cancellable?h('p','Not you? Cancel the replacement from this device.'):h('p',view.pendingReissue.previousFileCanCancel===false?'To cancel, use a device that was signed in before the replacement started or the link in the email notice.':'To cancel, use a device that was signed in before the replacement started, the link in the email notice, or your previous recovery file.'),
   view.pendingReissue.cancellable?btn('Cancel the replacement',{kind:'open-modal',modal:{kind:'cancel-reissue'}},'button secondary'):null).attrs({role:'alert'}).classes('security-note','recovery-pending'):null,
  required?h('div',h('strong','You need a new recovery file.'),h('p',required)).attrs({role:'alert'}).classes('security-note','recovery-required'):
   view.issuedAt?h('p',interfaceText('Your current recovery file was created {date}.',{date:date(view.issuedAt)})).classes('muted'):h('p','This account has no current recovery file.').classes('muted'),
  view.fileId&&!required?h('p','File ID',': ',h('code',view.fileId).attrs({translate:'no'})).classes('field-help','recovery-file-id'):null,
  view.transferEligibleAt&&!required?h('p',interfaceText('It can authorize moving your identity from {date}.',{date:date(view.transferEligibleAt)})).classes('field-help'):null,
  required||view.pendingReissue?null:reminderNote(view,date),
  view.reissueEligible===false?h('p',view.reissueEligibleAt?interfaceText('You can replace your recovery file from {date}.',{date:date(view.reissueEligibleAt)}):'Add a password or passkey and keep it for 7 days before replacing your recovery file.').classes('field-help').attrs({role:'status'}):null,
  h('p','Replacing it makes every copy of your current recovery file stop working. Your sign-in, data and connected apps stay the same.').classes('field-help'),
  view.pendingReissue?null:view.reissueAvailable?btn([icon('download'),required?'Create a new recovery file':'Replace recovery file'],{kind:'open-modal',modal:{kind:'reissue-recovery'}},required?'button primary':'button secondary',view.reissueEligible===false):h('p','Recovery files cannot be replaced on this service right now.').classes('field-help'),
  view.fileId||view.pendingReissue?.previousFileId?btn('Check my recovery file',{kind:'open-recovery-check'},'button secondary'):null
 ).classes('panel','recovery-file-panel').key('recovery-file-panel');
}

/** The warning dialog before anything is sent. */
export function recoveryReissueDialog(state){
 const {form}=helpers(state),required=typeof state.data?.recovery?.reissueRequired==='string';
 return {title:required?'Create a new recovery file':'Replace your recovery file?',body:form([
  h('ul',
   required?null:h('li',h('strong','Your old recovery file stops working'),' as soon as you confirm the new one. Every copy of it becomes useless, wherever it is stored.'),
   h('li','For 7 days after you confirm, the new file cannot recover your account. During that time the replacement can be cancelled from a device that was signed in before it started, from the link in the email notice, or with your old file if you confirm without a passkey. This protects you if someone else started it.'),
   h('li','A pending move of your identity to another provider will be cancelled.'),
   h('li','Your email and devices will be notified.')).classes('recovery-reissue-warnings'),
  h('p','You will confirm with a password or passkey you have had for at least 7 days, choose your questions, save the new file, test your answers, then select the saved file again. Until you confirm, your current file keeps working.').classes('field-help'),
  h('p','If your account has a passkey, confirm with the passkey; a password is not enough.').classes('field-help'),
  checkbox('acknowledged',required?'I understand I need to save this new file somewhere safe.':'I understand my old recovery file will stop working.')
 ],{kind:'begin-recovery-reissue'},'Continue')};
}

/** The confirmation before the pending replacement is cancelled. The server ends the sessions that staged and confirmed
 * the replacement, so the device that started it is signed out; the console cannot tell which device that was. */
export function cancelReissueDialog(state){
 const {btn}=helpers(state);
 return {title:'Cancel the recovery file replacement?',body:h('div',
  h('ul',h('li','Cancelling stops the pending replacement. Your previous recovery file works again and the new one never will.'),
   h('li','If this device started the replacement, cancelling also signs this device out of this account. Sign in again afterwards.')).classes('recovery-reissue-warnings'),
  h('div',btn('Cancel the replacement',{kind:'cancel-pending-recovery-reissue'},'button danger-button'),btn('Keep waiting',{kind:'close-modal'},'text-button')).classes('buttons'))};
}

/** The staged flow; replaces the security view while it runs. */
export function recoveryReissueView(state){
 const flow=reissueState(state);if(!flow)return null;const {btn,form,alerts}=helpers(state);
 const cancel=flow.stage==='done'?null:btn('Cancel. Keep my current file',{kind:'close-recovery-reissue'},'text-button');
 let content;
 if(flow.stage==='questions')content=h('div',flow.transferPending?h('p','Confirming this replacement will cancel your pending identity move.').attrs({role:'alert'}).classes('security-note'):null,questions(state,{intent:'encrypt-recovery-reissue'}));
 else if(flow.stage==='download')content=h('div',badge('ENCRYPTED ON YOUR DEVICE'),h('h2','Save your new recovery file.'),h('p','Every selected answer is required to unlock it. We cannot replace a lost file or reset its answers.').classes('muted'),alerts(),btn([icon('download'),'Download new recovery file'],{kind:'download-recovery-reissue'},'button primary full'),h('p','Next: enter every answer again to test the file, then select the saved file before it replaces your old one.').classes('field-help')).classes('auth-card');
 else if(flow.stage==='verify')content=h('div',recoveryUnlockForm(state,{kind:'verify-recovery-reissue',title:'Test your new recovery file.'}),btn([icon('download'),'Download new recovery file again'],{kind:'download-recovery-reissue'},'button secondary full'));
 // The acknowledgement: the saved file is selected again and compared byte for byte (by hash) on this device.
 else if(flow.stage==='upload')content=h('div',badge('ANSWERS TESTED'),h('h2','Select the file you saved.'),h('p','Choose the new recovery file from where you saved it. This device checks that it is exactly the file you downloaded. It is not decrypted or sent anywhere.').classes('muted'),alerts(),
  form([field('file','New recovery file','file',{accept:'.json,application/json',required:true})],{kind:'check-recovery-reissue-upload'},'Check the saved file'),btn([icon('download'),'Download new recovery file again'],{kind:'download-recovery-reissue'},'button secondary full')).classes('auth-card');
 else if(flow.stage==='confirm')content=h('div',badge('SAVED FILE CHECKED'),h('h2','Replace your old recovery file.'),h('div',h('strong','Your old recovery file stops working now.'),h('p','After this step only the file you just saved can recover your account.'),flow.transferPending?h('p','Your pending identity move will be cancelled.'):null).attrs({role:'alert'}).classes('security-note'),alerts(),
  h('p','Keep a second copy somewhere other than this device. We cannot check that for you.').classes('field-help'),
  form([checkbox('confirmed','I saved my new recovery file in a safe place.',false,!state.downloaded||!state.recoveryVerified||!state.recoveryUploaded)],{kind:'confirm-recovery-reissue'},'Replace my recovery file')).classes('auth-card');
 else content=h('div',badge('NEW RECOVERY FILE ACTIVE','good'),h('h2','Your new recovery file is active.'),h('p','Your old recovery file no longer works. Keep the new one private and backed up.').classes('muted'),h('p','For the next 7 days the new file cannot recover your account, and your old file can only cancel this replacement.').classes('field-help'),flow.transferCancelled?h('p','Your pending identity move was cancelled.').classes('security-note'):null,btn('Back to security',{kind:'close-recovery-reissue'},'button primary')).classes('auth-card');
 return h('section',content,cancel,state.busy?h('p','Encrypting or unlocking locally. This may take a moment.').attrs({role:'status'}).classes('field-help'):null).classes('panel','recovery-reissue').attrs({'aria-label':'Replace recovery file'}).key('recovery-reissue');
}

/** The local check-up; replaces the security view while it runs. Nothing here reaches the server. */
export function recoveryCheckView(state){
 const flow=recoveryCheckState(state);if(!flow)return null;const {btn,form,alerts}=helpers(state);
 const close=btn(flow.stage==='select'||flow.stage==='answers'?'Cancel':'Back to security',{kind:'close-recovery-check'},flow.stage==='select'||flow.stage==='answers'?'text-button':'button primary');
 let content;
 if(flow.stage==='select')content=h('div',badge('CHECKED ON YOUR DEVICE'),h('h2','Check your recovery file.'),h('p','Choose your recovery file and enter your answers. This device checks that the file opens and that it is your current file. Nothing is sent.').classes('muted'),alerts(),
  form([field('file','Encrypted recovery file','file',{accept:'.json,application/json',required:true})],{kind:'inspect-recovery-check'},'Read recovery questions')).classes('auth-card');
 else if(flow.stage==='answers')content=recoveryUnlockForm(state,{kind:'unlock-recovery-check',title:'Check your recovery file.',prefix:'check:'});
 else if(flow.stage==='ok')content=h('div',badge('RECOVERY FILE CHECKED','good'),h('h2','Your recovery file is current and opens with your answers.'),h('p','Keep it private, and keep a second copy somewhere other than this device.').classes('muted')).classes('auth-card');
 else if(flow.stage==='previous')content=h('div',badge('PREVIOUS FILE'),h('h2','This is your previous recovery file.'),h('p',state.data?.recovery?.pendingReissue?.previousFileCanCancel===false?'It was replaced recently with a passkey confirmation, so it cannot cancel the replacement, and it stops working when the 7-day waiting period ends. To cancel, use a device that was signed in before the replacement started or the link in the email notice.':'It was replaced recently. During the 7-day waiting period it can only cancel the replacement; after that it stops working.').classes('muted')).classes('auth-card');
 else content=h('div',badge('NOT YOUR CURRENT FILE'),h('h2','This is not your current recovery file.'),h('p','It cannot recover your account. Find your current file, or replace your recovery file to get a new one that works.').classes('muted')).classes('auth-card');
 return h('section',content,close,state.busy?h('p','Encrypting or unlocking locally. This may take a moment.').attrs({role:'status'}).classes('field-help'):null).classes('panel','recovery-check').attrs({'aria-label':'Check your recovery file'}).key('recovery-check');
}
