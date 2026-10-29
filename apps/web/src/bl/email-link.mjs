// The email-link helper page H (/email/link; sign-in and intents spike §4.3 steps 3-6, §4.4, §4.5; P3). It shows the
// request from server-captured context, takes one explicit decision, and never creates a session by itself (EL-1):
//   - same browser (the server recognised the HttpOnly marker on inspect): approve, post the tagged BroadcastChannel
//     wake-up, and close once the original tab acknowledges; without an acknowledgement within 2 s it asks the server
//     whether the flow was redeemed and otherwise offers "sign in in this tab instead" (complete-here, N8), which drops
//     any intent;
//   - another device: reveal the 6-digit code with the warning, for the person to type on the original device.
// The link token stays in this module's memory (the address bar was scrubbed before any request), never in storage.
import {Action,Query} from '../shared/stack.mjs';
import {wakeMessage,acceptAck,EMAIL_FLOW_CHANNEL} from '../shared/email-flow.mjs';
import {CONTINUATION_KEY,LEGACY_CONTINUATION_KEYS} from '../shared/continuation.mjs';
export const LINK_UPDATED='email-link-updated';
export const ACK_MS=2000,CLOSE_CHECK_MS=300;
export const initialLinkState=patch=>Object.freeze({phase:'loading',locale:'en',busy:false,error:'',view:null,code:null,codeExpiresAt:null,codeDevice:null,surface:0,...patch});
export function linkState(initial){let state=initial;return {snapshot:()=>state,patch:patch=>{state=Object.freeze({...state,...patch,...'phase' in patch?{surface:state.surface+1}:{}});}};}
const update=(r,ctx,patch)=>{r.state.patch(patch);ctx.engineFeed.dispatchEvent(new Event(LINK_UPDATED));};
export class LinkState extends Query {static deps=['state'];boot({state},{notify,engineFeed}){this.feed=engineFeed;this.listener=()=>notify(state.snapshot());engineFeed.addEventListener(LINK_UPDATED,this.listener);this.listener();}kill(){this.feed.removeEventListener(LINK_UPDATED,this.listener);}}
class LinkFlow extends Action {
 static deps={state:{write:true},link:{}};
 constructor(detail={}){super();this.detail=detail;}
 async execute(r,ctx){if(r.state.snapshot().busy)return;update(r,ctx,{busy:true,error:''});try{await this.perform(r,ctx,this.detail);}catch(error){if(error?.code==='invalid_link')update(r,ctx,{phase:'invalid'});else update(r,ctx,{error:error?.code==='rate_limited'?'rate_limited':'unavailable'});}finally{update(r,ctx,{busy:false});}}
}
export class InitializeLink extends LinkFlow {
 async perform(r,ctx){if(!r.link.token){update(r,ctx,{phase:'invalid'});return;}const view=await r.link.post('/api/auth/email/link/inspect',{t:r.link.token});update(r,ctx,view?.invalid||!view?.purpose?{phase:'invalid'}:{phase:'review',view});}
}
export class AskCancel extends LinkFlow {async perform(r,ctx){if(r.state.snapshot().phase==='review')update(r,ctx,{phase:'confirm-cancel'});}}
export class BackToReview extends LinkFlow {async perform(r,ctx){if(r.state.snapshot().phase==='confirm-cancel')update(r,ctx,{phase:'review'});}}
export class CancelLink extends LinkFlow {async perform(r,ctx){if(r.state.snapshot().phase!=='confirm-cancel')return;await r.link.post('/api/auth/email/link/cancel',{t:r.link.token,confirmed:true});update(r,ctx,{phase:'cancelled'});}}
/** "Yes, this is me". */
export class ConfirmLink extends LinkFlow {
 async perform(r,ctx){
  const s=r.state.snapshot();if(s.phase!=='review')return;
  if(!s.view.sameBrowser){const revealed=await r.link.post('/api/auth/email/link/reveal',{t:r.link.token,confirmed:true});update(r,ctx,{phase:'code',code:revealed.code,codeExpiresAt:revealed.expiresAt,codeDevice:revealed.requester?.uaSummary??null});return;}
  const approved=await r.link.post('/api/auth/email/link/approve',{t:r.link.token,confirmed:true});
  update(r,ctx,{phase:'waiting-ack'});
  const acknowledged=await r.link.wake({flowId:approved.flowId,channelTag:approved.channelTag},ACK_MS);
  if(acknowledged){update(r,ctx,{phase:'done'});r.link.closeSoon(CLOSE_CHECK_MS);return;}
  const status=await r.link.post('/api/auth/email/link/status',{t:r.link.token});
  if(status.state==='redeemed'){update(r,ctx,{phase:'done'});r.link.closeSoon(CLOSE_CHECK_MS);return;}
  update(r,ctx,{phase:status.state==='approved'?'closed-tab':'invalid'});
 }
}
/** "The tab that asked for this is closed. Sign in in this tab instead?" (N8). Any intent the closed tab held is gone,
 * and nothing this tab may hold is resumed. */
export class CompleteHere extends LinkFlow {
 async perform(r,ctx){
  if(r.state.snapshot().phase!=='closed-tab')return;
  const result=await r.link.post('/api/auth/email/link/complete-here',{t:r.link.token,confirmed:true});
  r.link.dropContinuation();
  if(result.signup){r.link.handOffSignup(result.signup);update(r,ctx,{phase:'signed-in'});r.link.navigate('/console?signin=1');return;}
  update(r,ctx,{phase:'signed-in'});r.link.navigate('/console');
 }
}
export class ToggleLinkLocale extends Action {static deps={state:{write:true}};execute({state},{engineFeed}){state.patch({locale:state.snapshot().locale==='es'?'en':'es'});engineFeed.dispatchEvent(new Event(LINK_UPDATED));}}
export const LINK_INTENTS=Object.freeze({'confirm-link':ConfirmLink,'ask-cancel':AskCancel,'back-to-review':BackToReview,'cancel-link':CancelLink,'complete-here':CompleteHere,'link-locale':ToggleLinkLocale});
/** Decisions that need the armed surface (EL-4): inert until visible and focused for 600 ms, no default focus. */
export const ARMED_INTENTS=Object.freeze(['confirm-link','ask-cancel','cancel-link','complete-here']);

/** The page's browser resource: same-origin POSTs (the marker cookie rides along; Fetch Metadata is sent by the
 * browser), the BroadcastChannel wake-up and acknowledgement, closing, and the hand-offs of complete-here. */
export function createLinkResource({token,fetch=globalThis.fetch,Channel=globalThis.BroadcastChannel,storage=globalThis.sessionStorage,win=globalThis.window,location=globalThis.location,setTimer=setTimeout}={}){
 return {
  token:typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)?token:null,
  async post(path,body){const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});let value=null;try{value=await response.json();}catch{}if(!response.ok)throw Object.assign(new Error(value?.message??'unavailable'),{code:value?.error??'unavailable',status:response.status});return value;},
  /** Posts the wake-up and resolves whether the original tab acknowledged within `ms`. */
  wake({flowId,channelTag},ms){if(typeof Channel!=='function')return Promise.resolve(false);let channel;try{channel=new Channel(EMAIL_FLOW_CHANNEL);}catch{return Promise.resolve(false);}return new Promise(resolve=>{const done=value=>{clearTimeout(timer);try{channel.close();}catch{}resolve(value);},timer=setTimer(()=>done(false),ms);channel.onmessage=event=>{if(acceptAck(event.data,flowId))done(true);};try{channel.postMessage(wakeMessage({flowId,channelTag}));}catch{done(false);}});},
  /** HTML lets script close a tab whose history holds one document (a tab opened from a mail app); otherwise the page
   * already says it can be closed. */
  closeSoon(){try{win.close();}catch{}},
  dropContinuation(){try{storage?.removeItem(CONTINUATION_KEY);for(const key of LEGACY_CONTINUATION_KEYS)storage?.removeItem(key);}catch{}},
  handOffSignup(signup){try{storage?.setItem('3sln-email-signup',JSON.stringify({signupToken:signup.signupToken,maskedAddress:signup.maskedAddress,expiresAt:signup.expiresAt}));}catch{}},
  navigate(target){location.assign(target);},
 };
}
