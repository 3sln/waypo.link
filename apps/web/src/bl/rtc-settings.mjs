// RTC-g owner settings and the portal ring (docs/architecture/rtc-signaling.md §7, §8.1 RTC-g). Engine Actions over
// the owner routes in packages/runtime/routes/rtc-owner.mjs; the rules live in packages/rtc/service.mjs. Provisional
// (coordinator), not signed off by the user; nothing here is shown while RTC_SIGNALING_ENABLED is off for the account.
//
// State: `rtc` {owner, generation, status: 'loading'|'loaded'|'error', ...GET /api/rtc/settings} and `rtcRing`
// {owner, generation, invites, idle, dismissed, declined}. `dismissed` (Not now) and `declined` ({sid, until}: invites
// and held requests declined in this tab, review F1) are local to the tab and never sent. Both are dropped when the account or its session generation changes (the
// GuardedAction epoch ticket discards late answers; the selectors below ignore another owner's state).
import {GuardedAction,snapshot,publish} from './guarded-action.mjs';

/** The account's session features include RTC (sessionFeatures.rtcSignalingEnabled, mirrored like organizations). */
export const rtcEnabled=s=>(s.data?.features?.rtcSignalingEnabled??s.session?.account?.consoleFeatures?.rtcSignalingEnabled)===true;
const current=(s,key)=>{const v=s[key];return v&&v.owner===s.session?.account?.id&&v.generation===(s.beamGeneration??0)?v:null;};
/** The loaded settings of the signed-in account, or null. */
export const rtcModel=s=>rtcEnabled(s)?current(s,'rtc'):null;
/** Sids declined in this tab whose deadline has not passed (review F1). RtcService now ends a declined record at the
 * provider (gate G2 closed), so the next read drops it; hiding it here only bridges the moment until that read. */
export const rtcDeclined=(s,now=Date.now())=>{const r=current(s,'rtcRing');return new Set((r?.declined??[]).filter(d=>d.until>now).map(d=>d.sid));};
/** Invites the portal shows, minus those dismissed or declined in this tab; never while the flag is off. */
export const rtcRingInvites=(s,now=Date.now())=>{const r=rtcEnabled(s)&&!s.offline?current(s,'rtcRing'):null;if(!r)return [];const declined=rtcDeclined(s,now);return r.invites.filter(i=>i.ringUntil>now&&!(r.dismissed??[]).includes(i.sid)&&!declined.has(i.sid));};
/** Where the ring renders (apps/web/src/ui/rtc-ring.mjs) and therefore where it is polled (review F4). */
export const rtcRingSurface=s=>rtcEnabled(s)&&Boolean(s.session?.account)&&!s.offline&&!s.accountPicker&&!s.loading&&s.route?.kind==='home';
/** Review F4, the settings read's view of the ring route's `idle` (packages/runtime/routes/rtc-owner.mjs `ringIdle`):
 * nothing is ringing and nothing could ring (no endpoint, no contact link or live call link for an alerting purpose). */
export function rtcSettingsIdle(m){
 if(m?.status!=='loaded')return null;const alerting=new Set(m.purposes.filter(p=>p.alert===true).map(p=>p.id)),any=lines=>Array.isArray(lines)&&lines.some(l=>alerting.has(l));
 return !m.sessions.some(x=>x.role==='callee'&&x.state==='ringing')&&!m.endpoints.length&&!m.contacts.some(c=>any(c.purposes))&&!m.tickets.some(t=>t.live&&any(t.purposes));
}
/** An incoming record that no device has answered: ending it is the silent local end (review F1), never a dialog. */
export const silentEnd=s=>s?.role==='callee'&&!s.claimed&&s.state==='ringing';

/** Whether an operation runs only from its confirmation dialog (`rtc-confirm`): ending, revoking, blocking and clearing
 * the whole missed list. Dismissing one entry and the silent decline of an unanswered incoming record (`silent: true`,
 * from the ring or the settings) do not ask: they change nothing the caller can see (review F1). */
export const needsConfirmation=(action,input)=>action==='end-session'?input?.silent!==true:['revoke-ticket','revoke-endpoint','block','narrow-app'].includes(action)||action==='clear-missed'&&input?.id===undefined;
export const RTC_UNAVAILABLE='This setting is not available right now.';
export const RTC_REVIEW='Review the change in the dialog, then confirm.';
export const RTC_DECLINED='Declined. The caller is not told; the call rings out.';
/** Wargame M2/M6: the notice for a provider block and a bulk revocation differs from the per-person or per-link one. */
const noticeFor=(action,input)=>action==='block'&&typeof input?.issuer==='string'?'Provider blocked. Calls and requests from everyone there are dropped without telling them.'
 :action==='unblock'&&typeof input?.issuer==='string'?'Provider unblocked.'
 :action==='mute'&&input?.kind==='origin'?'App muted. Its calls still arrive but no longer ring.'
 :action==='revoke-ticket'&&input&&!Object.hasOwn(input,'jti')?'Call links revoked.':NOTICES[action];
const NOTICES=Object.freeze({'set-policy':'Call settings saved.','set-contact-rtc':'Contact link call settings saved.',block:'Blocked. Their calls and requests are dropped without telling them.',unblock:'Unblocked.',mute:'Muted.',unmute:'Unmuted.','revoke-ticket':'Call link revoked.','end-session':'Session ended.','revoke-endpoint':'Device removed from calls.','clear-missed':'Removed from the list.','narrow-app':'App access narrowed. Its calls and connections for the removed purposes ended.'});
export const RTC_NARROW_NONE='Keep at least one purpose. To remove the app completely, use Manage app access.';
export const RTC_NARROW_SAME='Uncheck the purposes this app should no longer use.';
const sameInput=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const friendly=error=>{if(error?.status===404||error?.code==='not_found')throw Error(RTC_UNAVAILABLE);throw error;};
const values=(r,d)=>d.operationId?r.browser.consumeSubmission(d.operationId):d.values;
const owner=r=>snapshot(r).session.account.id;

async function load(r,ctx){
 const s=snapshot(r),prior=current(s,'rtc');if(!rtcEnabled(s))return;
 if(prior?.status!=='loaded')publish(r,ctx,{rtc:{owner:owner(r),generation:s.beamGeneration??0,status:'loading'}});
 try{const data=await r.api.get('/api/rtc/settings');publish(r,ctx,{rtc:{...data,owner:owner(r),generation:snapshot(r).beamGeneration??0,status:'loaded'}});}
 catch(error){if(current(snapshot(r),'rtc')?.status==='loading')publish(r,ctx,{rtc:{owner:owner(r),generation:snapshot(r).beamGeneration??0,status:'error'}});throw error;}
}
// Review F4: every ring read takes a sequence number; an answer that arrives after a later read started is stale and
// dropped, so an out-of-order response never replaces newer invites.
let ringSequence=0;
const ringBase=r=>current(snapshot(r),'rtcRing')??{owner:owner(r),generation:snapshot(r).beamGeneration??0,invites:[],idle:false,dismissed:[],declined:[]};
function applyRing(r,ctx,{invites,idle}){
 const prior=ringBase(r),list=Array.isArray(invites)?invites:[],live=new Set(list.map(i=>i.sid)),now=Date.now();
 publish(r,ctx,{rtcRing:{...prior,invites:list,idle:idle===true,dismissed:(prior.dismissed??[]).filter(sid=>live.has(sid)),declined:(prior.declined??[]).filter(d=>d.until>now)}});
}
async function ring(r,ctx){
 const s=snapshot(r);if(!rtcEnabled(s))return {ok:true,skipped:true};const sequence=++ringSequence;
 const {invites,idle}=await r.api.get('/api/rtc/ring');if(sequence!==ringSequence)return {ok:true,stale:true};
 applyRing(r,ctx,{invites,idle});return {ok:true,invites:Array.isArray(invites)?invites:[],idle:idle===true};
}
// After a change the outcome is published first; a failed refresh only reports stale data. The settings are re-read
// only while their view is open (review F3).
async function reloadAfter(r,ctx,notice){
 publish(r,ctx,{modal:null,notice,error:''});
 try{if(snapshot(r).view==='calls')await load(r,ctx);await ring(r,ctx);}catch(error){if(error.status===401)throw error;publish(r,ctx,{error:'Your change was saved, but the latest information could not be loaded. Reload to see it.'});}
}
const SID=/^[A-Za-z0-9_-]{1,64}$/;
/** Review F5: after an invite leaves the ring, focus moves to the next invite's heading, or to the console's main region. */
function focusAfterRing(r,sid,before){
 const i=before.findIndex(x=>x.sid===sid),after=before.filter(x=>x.sid!==sid),next=after[Math.min(Math.max(i,0),after.length-1)];
 r.browser.focus?.(next&&SID.test(next.sid)?`[id="rtc-ring-${next.sid}"]`:'#main-content');
}
/** Hides an invite or held request in this tab until its deadline (review F1/F3: only that sid; `dismissed` is kept). */
function declineLocally(r,ctx,sid,until){
 const prior=ringBase(r),now=Date.now();
 publish(r,ctx,{rtcRing:{...prior,invites:prior.invites.filter(i=>i.sid!==sid),declined:[...(prior.declined??[]).filter(d=>d.until>now&&d.sid!==sid),{sid,until:Number.isFinite(until)&&until>now?until:now+120000}]}});
}
const PANEL_HEADING=Object.freeze({'narrow-app':'#rtc-apps-title','clear-missed':'#rtc-missed-title',unblock:'#rtc-blocked-title',unmute:'#rtc-blocked-title',mute:'#rtc-blocked-title','end-session':'#rtc-sessions-title'});

export class LoadRtcSettings extends GuardedAction {async perform(r,ctx){await load(r,ctx);}}
/**
 * One ring read for the poller (apps/web/src/bl/rtc-ring-poll.mjs). `outcome` reports it: {ok, invites, idle, stale}
 * or {ok:false, retryAfter (seconds), status}. A failure is never an error banner; the poller backs off.
 */
export class LoadRtcRing extends GuardedAction {
 outcome=null;
 async perform(r,ctx){try{this.outcome=await ring(r,ctx);}catch(error){this.outcome={ok:false,status:error?.status,retryAfter:error?.retryAfter};if(error.status===401)throw error;}}
}
/** Invites another tab of this account read (review F4: one tab polls and shares its answer over BroadcastChannel). */
export class ApplyRtcRing extends GuardedAction {async perform(r,ctx,d){if(rtcEnabled(snapshot(r))&&Array.isArray(d.invites))applyRing(r,ctx,d);}}
/** Hides one invite in this tab only (nothing is sent; the caller learns nothing, spec §12). */
export class DismissRtcRing extends GuardedAction {async perform(r,ctx,d){const ringState=current(snapshot(r),'rtcRing');if(!ringState||typeof d.sid!=='string')return;const before=rtcRingInvites(snapshot(r));publish(r,ctx,{rtcRing:{...ringState,dismissed:[...new Set([...(ringState.dismissed??[]),d.sid])]}});focusAfterRing(r,d.sid,before);}}

/**
 * One owner operation (`d.action`, `d.input`). Destructive ones (needsConfirmation) run only from their confirmation dialog:
 * the open `rtc-confirm` modal must name the same action and input. A silent decline (`end-session` with `silent: true`,
 * review F1) also hides the record in this tab until its deadline (`d.until`), whatever the provider did with it.
 * Focus (review F5): a confirmed action returns focus to the dialog's opener (captured by `open-modal`); a decline from
 * the ring moves to the next invite or the main region; any other action moves to its panel's heading.
 */
export class RtcOwnerAction extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  if(typeof d.action!=='string'||!Object.hasOwn(NOTICES,d.action))throw Error(RTC_UNAVAILABLE);
  const confirmed=needsConfirmation(d.action,d.input),silent=d.action==='end-session'&&d.input?.silent===true;
  if(confirmed){const m=snapshot(r).modal;if(m?.kind!=='rtc-confirm'||m.action!==d.action||!sameInput(m.input,d.input))throw Error(RTC_REVIEW);}
  const before=d.ring?rtcRingInvites(snapshot(r)):[];
  await r.api.request('/api/rtc/'+d.action,d.input??{}).catch(friendly);
  if(silent&&typeof d.input.sid==='string')declineLocally(r,ctx,d.input.sid,d.until);
  await reloadAfter(r,ctx,silent?RTC_DECLINED:noticeFor(d.action,d.input));
  if(confirmed)r.browser.restoreFocus?.();else if(d.ring)focusAfterRing(r,typeof d.sid==='string'?d.sid:d.input?.sid,before);else if(PANEL_HEADING[d.action])r.browser.focus?.(PANEL_HEADING[d.action]);
 }
}

/**
 * The apps panel's narrowing form (`keep:<line>` per approved purpose of one app): opens the `rtc-confirm` dialog for
 * `narrow-app` {clientId, purposes} with the purposes still checked. Nothing is sent from here; the request runs only
 * from the dialog (RtcOwnerAction). At least one purpose stays (the slot's schema); removing every purpose is removing
 * the app's access, which the app access view offers. Only purposes the app holds can be kept (narrowing only).
 */
export class ReviewRtcNarrow extends GuardedAction {
 async perform(r,ctx,d){
  const v=values(r,d),model=rtcModel(snapshot(r));if(!v||model?.status!=='loaded'||typeof d.clientId!=='string')return;
  const app=model.apps.find(a=>a.clientId===d.clientId);if(!app)throw Error(RTC_UNAVAILABLE);
  const purposes=app.purposes.filter(l=>v['keep:'+l]==='on');
  if(!purposes.length)throw Error(RTC_NARROW_NONE);if(purposes.length===app.purposes.length)throw Error(RTC_NARROW_SAME);
  r.browser.captureFocus?.();publish(r,ctx,{modal:{kind:'rtc-confirm',action:'narrow-app',input:{clientId:app.clientId,purposes}},error:''});r.browser.modalFocus?.();
 }
}

/** The network privacy form (`other` relay|public, `self` all|public|relay) or, with `requests`, the requests form
 * (`request:<line>`). */
export class SaveRtcPolicy extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const v=values(r,d),model=rtcModel(snapshot(r));if(!v||model?.status!=='loaded')return;
  // The two forms send only their own members, so neither overwrites the other's unsaved choices.
  const input=d.requests===true?{requests:model.purposes.filter(p=>p.parties!=='self'&&v['request:'+p.id]==='on').map(p=>p.id)}:{other:v.other==='public'?'public':'relay',self:['all','public','relay'].includes(v.self)?v.self:'all'};
  r.browser.captureFocus?.();await r.api.request('/api/rtc/set-policy',input).catch(friendly);await reloadAfter(r,ctx,NOTICES['set-policy']);r.browser.restoreFocus?.();
 }
}
/** Purposes a holder of one contact link may ring for (spec §4.3: owner-side, never in the link). */
export class SaveRtcContact extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const v=values(r,d),model=rtcModel(snapshot(r));if(!v||model?.status!=='loaded'||typeof d.parent!=='string')return;
  const purposes=model.purposes.filter(p=>p.parties!=='self'&&v['purpose:'+p.id]==='on').map(p=>p.id);
  r.browser.captureFocus?.();await r.api.request('/api/rtc/set-contact-rtc',{parent:d.parent,purposes}).catch(friendly);await reloadAfter(r,ctx,NOTICES['set-contact-rtc']);r.browser.restoreFocus?.();
 }
}
/** Auto-accept between the owner's own devices for one app (spec §4.4; only purposes with auto_accept "self"). */
export class SaveRtcAutoAccept extends GuardedAction {
 mutation=true;
 async perform(r,ctx,d){
  const v=values(r,d),model=rtcModel(snapshot(r));if(!v||model?.status!=='loaded'||typeof d.clientId!=='string')return;
  const app=model.apps.find(a=>a.clientId===d.clientId),allowed=model.purposes.filter(p=>p.autoAccept==='self'&&app?.purposes.includes(p.id)).map(p=>p.id);
  const lines=allowed.filter(l=>v['auto:'+l]==='on'),autoAccept={...model.policy.autoAccept};if(lines.length)autoAccept[d.clientId]=lines;else delete autoAccept[d.clientId];
  r.browser.captureFocus?.();await r.api.request('/api/rtc/set-policy',{autoAccept}).catch(friendly);await reloadAfter(r,ctx,NOTICES['set-policy']);r.browser.restoreFocus?.();
 }
}
