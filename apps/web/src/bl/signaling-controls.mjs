// Generic signaling owner controls (docs/spec/extensions/signaling.md rev 3.2 §14.1, Appendix C.3 and C.5 step 5),
// re-homed into existing surfaces: the IP policy and the blocked lists under Account & security, and each app's
// session handler approvals, endpoints, live offers and pairings with its entry in the owner's app connections. Engine
// Actions over the owner routes (GET /api/signaling/settings and the narrowing POSTs); the rules are the server's.
// Provisional (coordinator), not signed off by the user; nothing here is shown or requested while the account's session
// features lack signalingEnabled. Pairing creation and activation, and turning auto-connect on, are widening: they
// happen only on the owner pages (bl/signaling-pages.mjs, console view `signaling`), which these surfaces link to.
//
// State: `signaling` {owner, generation, status: 'loading'|'loaded'|'error', ...GET /api/signaling/settings}. It is
// dropped when the account or its session generation changes (the GuardedAction epoch ticket discards late answers;
// the selector below ignores another owner's state).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';

/** The account's session features include signaling (sessionFeatures.signalingEnabled, mirrored like organizations). */
export const signalingEnabled=s=>(s.data?.features?.signalingEnabled??s.session?.account?.consoleFeatures?.signalingEnabled)===true;
/** The console views that show signaling controls (release.mjs loads the settings when one is entered). */
export const SIGNALING_VIEWS=Object.freeze(['security','connections','connected-apps']);
/** The loaded (or loading) settings of the signed-in account, or null; never while the flag is off. */
export const signalingModel=s=>{if(!signalingEnabled(s))return null;const v=s.signaling;return v&&v.owner===s.session?.account?.id&&v.generation===(s.beamGeneration??0)?v:null;};
/** A stable element id for one app's signaling controls (client IDs are URLs and never go into a selector). */
export function signalingAppAnchor(clientId){let hash=2166136261;for(const c of String(clientId??''))hash=Math.imul(hash^c.codePointAt(0),16777619)>>>0;return 'signaling-app-'+hash.toString(36);}

export const SIGNALING_UNAVAILABLE='This setting is not available right now.';
export const SIGNALING_REVIEW='Review the change in the dialog, then confirm.';
export const SIGNALING_CONFLICT='These settings changed somewhere else. Review the latest choices and save again.';
export const SIGNALING_STALE='Your change was saved, but the latest settings could not be loaded. Reload to see them.';
export const SIGNALING_POLICY_SAVED='Connection privacy saved.';

const text=v=>typeof v==='string'&&v.length>0&&v.length<=2048;
const principal=p=>p&&typeof p==='object'&&text(p.iss)&&text(p.sub)?{iss:p.iss,sub:p.sub}:null;
/**
 * The owner operations this surface may send, each with its route, the only members it forwards (anything else in the
 * intent is dropped), whether it runs only from its confirmation dialog, and its notice. All are narrowing except
 * unblock, which the server gates (a 404 reads as unavailable).
 */
const OPERATIONS=Object.freeze({
 unblock:{path:'/api/signaling/unblock',input:i=>principal(i?.principal)?{principal:principal(i.principal)}:text(i?.issuer)?{issuer:i.issuer}:null,notice:i=>i.issuer?'Provider unblocked.':'Unblocked.',focus:'#signaling-blocked-title'},
 'revoke-endpoint':{path:'/api/signaling/revoke-endpoint',input:i=>text(i?.endpoint)?{endpoint:i.endpoint}:null,confirm:true,notice:()=>'Device removed.'},
 'revoke-offers':{path:'/api/signaling/revoke-offers',input:i=>text(i?.id)?{id:i.id}:text(i?.clientId)?{clientId:i.clientId}:i?.all===true?{all:true}:null,confirm:true,notice:i=>i.id?'Offer revoked.':'Offers revoked.'},
 'pairing-remove':{path:'/api/signaling/pairing-remove',input:i=>text(i?.id)?{id:i.id}:null,confirm:true,notice:()=>'Pairing removed.'},
 'session-unapprove':{path:'/api/intents/session-unapprove',input:i=>text(i?.clientId)&&text(i?.kind)?{clientId:i.clientId,kind:i.kind}:null,confirm:true,notice:()=>'Connection type removed.'},
 'session-auto-connect':{path:'/api/intents/session-auto-connect',input:i=>text(i?.clientId)&&text(i?.kind)?{clientId:i.clientId,kind:i.kind,autoConnect:false}:null,notice:()=>'Automatic connection turned off.',focusApp:true}
});
/** The members an operation would send, or null when the action or its input is not one this surface offers. */
export function signalingInput(action,input){const op=Object.hasOwn(OPERATIONS,action)?OPERATIONS[action]:null;return op?op.input(input):null;}
/** Whether an operation runs only from its `signaling-confirm` dialog (removing and revoking). */
export const needsConfirmation=action=>Object.hasOwn(OPERATIONS,action)&&OPERATIONS[action].confirm===true;
const sameInput=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const friendly=error=>{if(error?.status===404||error?.code==='not_found'||error?.error==='not_found')throw Error(SIGNALING_UNAVAILABLE);throw error;};
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
const owner=r=>snapshot(r).session.account.id;
const generation=r=>snapshot(r).beamGeneration??0;

async function load(r,ctx){
 const s=snapshot(r);if(!signalingEnabled(s))return;
 if(signalingModel(s)?.status!=='loaded')publish(r,ctx,{signaling:{owner:owner(r),generation:generation(r),status:'loading'}});
 try{const data=await r.api.get('/api/signaling/settings');publish(r,ctx,{signaling:{...data,owner:owner(r),generation:generation(r),status:'loaded'}});}
 catch(error){if(signalingModel(snapshot(r))?.status==='loading')publish(r,ctx,{signaling:{owner:owner(r),generation:generation(r),status:'error'}});throw error;}
}
// After a change the outcome is published first; a failed refresh only reports stale data.
async function reloadAfter(r,ctx,notice){
 publish(r,ctx,{modal:null,notice,error:''});
 try{await load(r,ctx);}catch(error){if(error.status===401)throw error;publish(r,ctx,{error:SIGNALING_STALE});}
}

export class LoadSignalingSettings extends GuardedAction {async perform(r,ctx){await load(r,ctx);}}

/**
 * One owner operation (`d.action`, `d.input`). Destructive ones (needsConfirmation) run only from their confirmation
 * dialog: the open `signaling-confirm` modal must name the same action and input. Focus: a confirmed action returns
 * focus to the dialog's opener (captured by `open-modal`); unblocking moves to the blocked list's heading, turning
 * auto-connect off to the app's signaling heading.
 */
export class SignalingOwnerAction extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const s=snapshot(r);if(!signalingEnabled(s))throw Error(SIGNALING_UNAVAILABLE);
  const input=signalingInput(d.action,d.input);if(!input)throw Error(SIGNALING_UNAVAILABLE);
  const op=OPERATIONS[d.action];
  if(op.confirm){const m=s.modal;if(m?.kind!=='signaling-confirm'||m.action!==d.action||!sameInput(signalingInput(m.action,m.input),input))throw Error(SIGNALING_REVIEW);}
  await r.api.request(op.path,input).catch(friendly);
  await reloadAfter(r,ctx,op.notice(input));
  if(op.confirm)r.browser.restoreFocus?.();else if(op.focusApp)r.browser.focus?.('#'+signalingAppAnchor(input.clientId));else if(op.focus)r.browser.focus?.(op.focus);
 }
}

/**
 * The connection privacy form (`other` relay|public, `self` relay|public|all), compare-and-swap on the loaded policy
 * revision (§14.1 "Concurrent edits"). An unknown value falls back to relay, the narrowest choice. A stale revision
 * (409) reloads the latest settings and asks the owner to review them; nothing is retried automatically.
 */
export class SaveSignalingPolicy extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const v=values(r,d),m=signalingModel(snapshot(r));if(!v||m?.status!=='loaded')return;
  const input={other:v.other==='public'?'public':'relay',self:['all','public','relay'].includes(v.self)?v.self:'relay',revision:m.policy?.revision??0};
  r.browser.captureFocus?.();
  try{await r.api.request('/api/signaling/set-policy',input);}
  catch(error){if(error?.status===409||error?.code==='conflict'){try{await load(r,ctx);}catch(e){if(e.status===401)throw e;}throw Error(SIGNALING_CONFLICT);}friendly(error);}
  await reloadAfter(r,ctx,SIGNALING_POLICY_SAVED);r.browser.restoreFocus?.();
 }
}
