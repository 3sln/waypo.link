// "Continue with email" on the original tab R (sign-in and intents spike §3.4, §3.6, §4.3, §4.6; P3, behind
// EMAIL_FLOW_V2 projected as config.emailFlowEnabled). The flow stays in this tab: it starts the flow with a fresh secret
// S, polls the server every `interval` seconds (and at once on a BroadcastChannel wake-up, which carries no authority),
// and redeems with S (plus the code from another device when the helper showed one). A sign-in ends in the shared
// sign-in step, which resumes this tab's continuation (an intent or app authorization entry; SI-8). A create-account
// link ends in the terms and age confirmation, then the recovery file (no passkey step).
//
// State `emailFlow` (projection only; S never enters it):
//   {stage:'waiting', email, expiresAt, nextPollAt, codeRequested, codeError?, remaining?, challenge?}
//   {stage:'signup', maskedAddress, expiresAt}
//   {stage:'ended', reason:'cancelled'|'expired'|'locked'|'link-cancelled'}
import {Query,Action} from '../shared/stack.mjs';
import {Flow,publishState as update,readState as current,accept,resumeAfterSignIn,startSetupRecovery} from './release.mjs';
import {interfaceText} from '../ui/interface-text.mjs';
export const EMAIL_FLOW_POLL='email-flow-poll-due',EMAIL_FLOW_RESTORE='email-flow-restore',EMAIL_FLOW_ABANDON='email-flow-abandon';
const mask=email=>{const [local='',domain='']=String(email).split('@');return `${local.slice(0,1)}•••@${domain}`;};
const ended=(r,ctx,reason)=>{r.emailFlow.clear();update(r,ctx,{emailFlow:{stage:'ended',reason},auth:'email'});};
class EmailFlowAction extends Flow{static deps={...Flow.deps,emailFlow:{}};}
export const emailFlowEnabled=s=>s.config?.emailFlowEnabled===true;

/** Schedules polls for a waiting flow (like the device sign-in poll), turns accepted wake-ups into an immediate poll, and
 * restores a flow or sign-up binding this tab kept across a reload. It never mutates state. */
export class EmailFlowSchedule extends Query {
 static deps=['state','browser','emailFlow'];
 boot({state,browser,emailFlow},{notify,engineFeed}){
  this.feed=engineFeed;this.cancel=null;let restored=false;
  const due=()=>engineFeed.dispatchEvent(new Event(EMAIL_FLOW_POLL));
  this.publish=()=>{
   const s=state.snapshot();notify(s.emailFlow??null);this.cancel?.();this.cancel=null;
   if(!emailFlowEnabled(s)||s.loading)return;
   if(!restored&&!s.busy&&!s.session?.account&&!s.emailFlow&&!s.pending&&(emailFlow.current()||emailFlow.signup())){restored=true;queueMicrotask(()=>engineFeed.dispatchEvent(new Event(EMAIL_FLOW_RESTORE)));return;}
   const flow=s.emailFlow;
   // Signing in another way (or switching account) while waiting ends this tab's flow (spike §4.3 step 9).
   if(flow?.stage==='waiting'&&(s.session?.sessionContext??null)!==(flow.startedSession??null)){queueMicrotask(()=>engineFeed.dispatchEvent(new Event(EMAIL_FLOW_ABANDON)));return;}
   if(flow?.stage==='waiting'&&!s.busy&&!s.offline)this.cancel=browser.delay(due,Math.max(0,Math.min(flow.nextPollAt,flow.expiresAt)-browser.now()));
  };
  this.wake=emailFlow.onWake(()=>{const s=state.snapshot();if(s.emailFlow?.stage==='waiting')due();});
  engineFeed.addEventListener('browser-state-updated',this.publish);this.publish();
 }
 kill(){this.feed.removeEventListener('browser-state-updated',this.publish);this.cancel?.();this.wake?.();}
}

export class StartEmailFlow extends EmailFlowAction {
 async perform(r,ctx,detail){
  const s=current(r);if(!emailFlowEnabled(s))throw new Error('Email sign-in is not available on this service.');if(s.offline)throw new Error('Reconnect before continuing.');
  const email=String(detail.values?.email??'').trim();if(!email)throw new Error('Enter your email address.');
  const proofs=await r.emailFlow.prepare();
  const result=await r.api.request('/api/auth/email/flow/start',{email,...proofs,...r.browser.captcha(s.config),locale:s.locale==='es'?'es':'en'});
  const kept=r.emailFlow.begin({flowId:result.flowId,expiresIn:result.expiresIn,interval:result.interval,email:mask(email)});
  update(r,ctx,{emailFlow:{stage:'waiting',email:kept.email,expiresAt:kept.expiresAt,nextPollAt:r.browser.now()+kept.interval*1000,codeRequested:false,startedSession:current(r).session?.sessionContext??null},error:'',notice:''});
 }
}
export class RestoreEmailFlow extends EmailFlowAction {
 async perform(r,ctx){
  const s=current(r);if(s.session?.account||s.emailFlow||s.pending)return;
  const signup=r.emailFlow.signup();if(signup){update(r,ctx,{auth:'email',emailFlow:{stage:'signup',maskedAddress:signup.maskedAddress,expiresAt:signup.expiresAt}});return;}
  const flow=r.emailFlow.current();if(flow)update(r,ctx,{auth:'email',emailFlow:{stage:'waiting',email:flow.email,expiresAt:flow.expiresAt,nextPollAt:r.browser.now(),codeRequested:false,startedSession:null}});
 }
}
export class PollEmailFlow extends EmailFlowAction {
 async perform(r,ctx){
  const s=current(r),flow=s.emailFlow,proof=r.emailFlow.proof();if(flow?.stage!=='waiting')return;if(!proof){ended(r,ctx,'expired');return;}
  if(flow.expiresAt<=r.browser.now()){ended(r,ctx,'expired');return;}
  const result=await r.api.request('/api/auth/email/flow/status',proof),interval=(Number(result.interval)||3)*1000;
  if(current(r).emailFlow?.stage!=='waiting'||r.emailFlow.proof()?.flowId!==proof.flowId)return;
  if(result.status==='approved'){await redeem(r,ctx,{});return;}
  if(result.status==='pending'||result.status==='slow_down'){update(r,ctx,{emailFlow:{...current(r).emailFlow,nextPollAt:r.browser.now()+interval*(result.status==='slow_down'?2:1)}});return;}
  if(result.status==='code'){update(r,ctx,{emailFlow:{...current(r).emailFlow,codeRequested:true,nextPollAt:r.browser.now()+interval}});return;}
  ended(r,ctx,result.status==='cancelled'?'link-cancelled':result.status==='locked'?'locked':'expired');
 }
}
export class SubmitEmailFlowCode extends EmailFlowAction {
 async perform(r,ctx,detail){
  const code=String(detail.values?.code??'').replace(/[\s-]/g,'');if(!/^\d{6}$/.test(code)){update(r,ctx,{emailFlow:{...current(r).emailFlow,codeError:'Enter the 6-digit code shown on your other device.'}});return;}
  await redeem(r,ctx,{code,...current(r).emailFlow?.challenge?r.browser.captcha(current(r).config):{}});
 }
}
async function redeem(r,ctx,extra){
 const proof=r.emailFlow.proof();if(!proof){ended(r,ctx,'expired');return;}
 let result;
 try{result=await r.api.request('/api/auth/email/flow/redeem',{...proof,confirmed:true,...extra});}
 catch(error){
  const flow=current(r).emailFlow;
  if(error.code==='invalid_code'){update(r,ctx,{emailFlow:{...flow,codeError:'That code does not match. Check the code on your other device.',remaining:Number.isSafeInteger(error.remaining)?error.remaining:null},error:''});return;}
  if(error.code==='challenge_required'){update(r,ctx,{emailFlow:{...flow,challenge:true,codeError:'Complete the security check and enter the code again.'},error:''});return;}
  if(error.code==='flow_locked'){ended(r,ctx,'locked');return;}
  if(error.code==='invalid_flow'){ended(r,ctx,'expired');return;}
  throw error;
 }
 r.emailFlow.clear();
 if(result.signup){r.emailFlow.keepSignup(result.signup);update(r,ctx,{emailFlow:{stage:'signup',maskedAddress:result.signup.maskedAddress,expiresAt:result.signup.expiresAt},error:''});return;}
 update(r,ctx,{emailFlow:null});
 // The shared sign-in step (SI-8): the continuation this tab kept resumes here; "Signed in as" otherwise (SI-11).
 await accept(r,ctx,result,{resume:false});
 if(!resumeAfterSignIn(r,result))update(r,ctx,{notice:interfaceText('Signed in as {handle}.',{handle:'\u2068@'+result.account.handle+'\u2069'})});
}
export class ResendEmailFlow extends EmailFlowAction {
 async perform(r,ctx){const proof=r.emailFlow.proof();if(!proof){ended(r,ctx,'expired');return;}try{await r.api.request('/api/auth/email/flow/resend',proof);}catch(error){if(error.code==='invalid_flow'){ended(r,ctx,'expired');return;}throw error;}update(r,ctx,{emailFlow:{...current(r).emailFlow,codeRequested:false,codeError:null,remaining:null,nextPollAt:r.browser.now()+3000},notice:'We sent a new link. Older links no longer work.'});}
}
/** Cancel (spike §4.3 step 9): the person chose Cancel or Back, or signed in another way. Not a Flow, so a poll in flight
 * never swallows it. */
export class CancelEmailFlow extends Action {
 static deps={state:{write:true},api:{},emailFlow:{}};
 constructor(detail={}){super();this.detail=detail;}
 async execute(r,ctx){const proof=r.emailFlow.proof(),quiet=this.detail.quiet===true;r.emailFlow.clear();r.emailFlow.dropSignup();if(r.state.snapshot().emailFlow)update(r,ctx,{emailFlow:null,...quiet?{}:{notice:'',error:''}});if(proof)try{await r.api.request('/api/auth/email/flow/cancel',proof);}catch{/* Expiry ends it anyway. */}}
}
/** Sign-up on this tab after a redeemed create-account link (spike §3.4 step 3): the current terms and the age
 * attestation, then the recovery file. */
export class ConfirmEmailSignup extends EmailFlowAction {
 async perform(r,ctx,detail){
  const s=current(r),binding=r.emailFlow.signup();if(!binding){ended(r,ctx,'expired');return;}
  if(detail.values?.termsAccepted!=='on')throw new Error('Agree to the account terms to continue.');
  const age=Number.parseInt(String(detail.values?.ageConfirmed??''),10);
  const result=await r.api.request('/api/auth/email/signup',{signupToken:binding.signupToken,termsAccepted:true,termsVersion:s.config.termsVersion,...Number.isSafeInteger(age)?{ageConfirmed:age}:{}});
  r.emailFlow.dropSignup();
  await startSetupRecovery(r,ctx,result);
 }
}
/** Dismisses a 3sln.me system item (the passkey suggestion) until it repeats. */
export class DismissHostItem extends EmailFlowAction {
 async perform(r,ctx,detail){if(detail.id!=='passkey-suggestion')return;const result=await r.api.request('/api/auth/host-items/dismiss',{id:detail.id});const session=current(r).session;update(r,ctx,{...session?{session:{...session,account:result.account}}:{},...current(r).data?{data:{...current(r).data,account:result.account}}:{}});}
}
export const EMAIL_FLOW_INTENTS=Object.freeze({'start-email-flow':StartEmailFlow,'email-flow-code':SubmitEmailFlowCode,'resend-email-flow':ResendEmailFlow,'cancel-email-flow':CancelEmailFlow,'confirm-email-signup':ConfirmEmailSignup,'dismiss-host-item':DismissHostItem});
