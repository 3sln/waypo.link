// Console views of the active-account recovery reissue (bl/recovery-reissue.mjs). The questions and unlock forms are
// the setup ones (recovery-questions.mjs) with reissue intents; typed answers stay in native controls.
import {h,icon,badge,checkbox,helpers,interfaceText} from './release-primitives.mjs';
import questions,{recoveryUnlockForm} from './recovery-questions.mjs';
import {reissueState} from '../bl/recovery-reissue.mjs';

const REQUIRED={'elevated-abort':'You stopped a disputed move with your recovery file, so that file no longer works. Create a new one now.','transfer-in':'Your identity moved here. Create a recovery file in this provider\'s format.'};

/** The "Recovery file" block of the security view. */
export function recoveryFilePanel(state){
 const {btn,date}=helpers(state),view=state.data?.recovery??null;if(!view)return null;
 const required=typeof view.reissueRequired==='string'?REQUIRED[view.reissueRequired]??REQUIRED['elevated-abort']:null;
 return h('section',h('div',icon('shield')).classes('section-icon'),h('h2','Recovery file'),
  required?h('div',h('strong','You need a new recovery file.'),h('p',required)).attrs({role:'alert'}).classes('security-note','recovery-required'):
   view.issuedAt?h('p',interfaceText('Your current recovery file was created {date}.',{date:date(view.issuedAt)})).classes('muted'):h('p','This account has no current recovery file.').classes('muted'),
  view.transferEligibleAt&&!required?h('p',interfaceText('It can authorize moving your identity from {date}.',{date:date(view.transferEligibleAt)})).classes('field-help'):null,
  h('p','Replacing it makes every copy of your current recovery file stop working. Your sign-in, data and connected apps stay the same.').classes('field-help'),
  view.reissueAvailable?btn([icon('download'),required?'Create a new recovery file':'Replace recovery file'],{kind:'open-modal',modal:{kind:'reissue-recovery'}},required?'button primary':'button secondary'):h('p','Recovery files cannot be replaced on this service right now.').classes('field-help')
 ).classes('panel','recovery-file-panel').key('recovery-file-panel');
}

/** The warning dialog before anything is sent. */
export function recoveryReissueDialog(state){
 const {form}=helpers(state),required=typeof state.data?.recovery?.reissueRequired==='string';
 return {title:required?'Create a new recovery file':'Replace your recovery file?',body:form([
  h('ul',
   required?null:h('li',h('strong','Your old recovery file stops working'),' as soon as you confirm the new one. Every copy of it becomes useless, wherever it is stored.'),
   h('li','A pending move of your identity to another provider will be cancelled.'),
   h('li','The new file can authorize moving your identity only after 7 days.'),
   h('li','Your email and devices will be notified.')).classes('recovery-reissue-warnings'),
  h('p','You will confirm with a password or passkey you have had for at least 7 days, choose your questions, then save and test the new file on this device. Until you confirm, your current file keeps working.').classes('field-help'),
  checkbox('acknowledged',required?'I understand I need to save this new file somewhere safe.':'I understand my old recovery file will stop working.')
 ],{kind:'begin-recovery-reissue'},'Continue')};
}

/** The staged flow; replaces the security view while it runs. */
export function recoveryReissueView(state){
 const flow=reissueState(state);if(!flow)return null;const {btn,form,alerts}=helpers(state);
 const cancel=flow.stage==='done'?null:btn('Cancel. Keep my current file',{kind:'close-recovery-reissue'},'text-button');
 let content;
 if(flow.stage==='questions')content=h('div',flow.transferPending?h('p','Confirming this replacement will cancel your pending identity move.').attrs({role:'alert'}).classes('security-note'):null,questions(state,{intent:'encrypt-recovery-reissue'}));
 else if(flow.stage==='download')content=h('div',badge('ENCRYPTED ON YOUR DEVICE'),h('h2','Save your new recovery file.'),h('p','Every selected answer is required to unlock it. We cannot replace a lost file or reset its answers.').classes('muted'),alerts(),btn([icon('download'),'Download new recovery file'],{kind:'download-recovery-reissue'},'button primary full'),h('p','Next: enter every answer again to test the file before it replaces your old one.').classes('field-help')).classes('auth-card');
 else if(flow.stage==='verify')content=h('div',recoveryUnlockForm(state,{kind:'verify-recovery-reissue',title:'Test your new recovery file.'}),btn([icon('download'),'Download new recovery file again'],{kind:'download-recovery-reissue'},'button secondary full'));
 else if(flow.stage==='confirm')content=h('div',badge('RECOVERY FILE TESTED'),h('h2','Replace your old recovery file.'),h('div',h('strong','Your old recovery file stops working now.'),h('p','After this step only the file you just saved can recover your account.'),flow.transferPending?h('p','Your pending identity move will be cancelled.'):null).attrs({role:'alert'}).classes('security-note'),alerts(),
  form([checkbox('confirmed','I saved my new recovery file in a safe place.',false,!state.downloaded||!state.recoveryVerified)],{kind:'confirm-recovery-reissue'},'Replace my recovery file')).classes('auth-card');
 else content=h('div',badge('NEW RECOVERY FILE ACTIVE','good'),h('h2','Your new recovery file is active.'),h('p','Your old recovery file no longer works. Keep the new one private and backed up.').classes('muted'),flow.transferCancelled?h('p','Your pending identity move was cancelled.').classes('security-note'):null,btn('Back to security',{kind:'close-recovery-reissue'},'button primary')).classes('auth-card');
 return h('section',content,cancel,state.busy?h('p','Encrypting or unlocking locally. This may take a moment.').attrs({role:'status'}).classes('field-help'):null).classes('panel','recovery-reissue').attrs({'aria-label':'Replace recovery file'}).key('recovery-reissue');
}
