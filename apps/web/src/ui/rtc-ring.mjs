// RTC-g portal ring (docs/architecture/rtc-signaling.md §7 "Incoming ring", RTC-16): a fallback notice for an incoming
// alerting invite, so the owner can hand it to one of their registered apps or decline it. The call experience is
// always the app's: "Open" only navigates to the app's verified origin, where its endpoint listens and claims.
// Before a claim it shows only what spec §9.1 lets a callee see: the verified caller (a handle only when this host
// verified it), the calling app's origin (RTC-17; for a foreign caller labelled as reported by its provider), the purpose and its media, and the owner's own apps
// registered for that purpose. Never the invite
// context, links or anything from the caller's provider. Nothing renders while RTC_SIGNALING_ENABLED is off. The
// ring root in release.mjs is a polite live region, so a new invite is announced without taking focus.
// Provisional wording (DEVLOG 2026-10-27 RTC-g), not signed off by the user.
import {h,icon,helpers,interfaceText} from './release-primitives.mjs';
import {rtcEnabled,rtcRingInvites,rtcRingSurface} from '../bl/rtc-settings.mjs';
import {purposeTitle,principalLabel} from './rtc-settings.mjs';

const literal=value=>h('span',String(value??'')).attrs({translate:'no'});
const MEDIA={audio:'Audio',video:'Video',data:'Data',screen:'Screen sharing'};
const host=origin=>{try{return new URL(origin).host;}catch{return String(origin??'');}};
/** A verified app origin the ring may link to: https (or loopback http in local development), nothing else. */
export function safeOrigin(origin,{local=false}={}){try{const u=new URL(origin);if(u.username||u.password||u.origin!==origin)return null;if(u.protocol==='https:'||local&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))return u.origin+'/';}catch{}return null;}

export function rtcRing(state,{now=Date.now()}={}){
 if(!rtcRingSurface(state))return null;
 const invites=rtcRingInvites(state,now);if(!invites.length)return null;
 const {btn}=helpers(state),locale=state.locale??'en';
 return h('aside',...invites.slice(0,3).map(i=>{const title=i.title?.[locale]??i.title?.en??purposeTitle(state.rtc,i.purpose,locale),apps=i.apps.map(a=>({...a,href:safeOrigin(a.origin,{local:state.config?.localDevelopment===true})})).filter(a=>a.href);
  // The heading takes focus after a neighbouring invite is declined or put off (review F5; bl/rtc-settings.mjs).
  return h('section',h('div',icon('bell'),h('h2',h('span','Incoming'),' ',literal(title)).props({id:'rtc-ring-'+i.sid,tabIndex:-1})).classes('rtc-ring-heading'),
   h('p',h('span','From'),' ',literal(principalLabel(i.caller,i.callerHandle))),
   // RTC-17 (provisional): the calling app's origin, as the callee's own apps see it before a claim (§9.1). For a
   // caller on another provider it is only what that provider certified, so it is labelled as reported by it (RTCs
   // follow-up (a)); a same-host caller's origin stays unlabelled.
   typeof i.callerOrigin==='string'&&i.callerOrigin?h('p',typeof i.callerOriginReportedBy==='string'&&i.callerOriginReportedBy?h('span',interfaceText('Calling app (reported by {provider}):',{provider:i.callerOriginReportedBy})):h('span','Calling app:'),' ',literal(host(i.callerOrigin))).classes('field-help'):null,
   h('p',...i.media.flatMap((x,n)=>[n?', ':'',MEDIA[x]??x]).filter(Boolean)).classes('field-help'),
   apps.length?h('div',...apps.map(a=>h('a',interfaceText('Open in {app}',{app:host(a.origin)})).props({href:a.href,target:'_blank',rel:'noopener noreferrer'}).classes('button','primary').key(a.clientId))).classes('buttons')
    :h('p','None of your apps is ready to answer this. Open the app you use for calls on this device.').classes('field-help'),
   // Decline is the silent local end (review F1): the caller is told nothing and rings out.
   h('div',btn('Decline',{kind:'rtc-action',action:'end-session',input:{sid:i.sid,caller:i.caller,silent:true},ring:true,until:i.ringUntil},'button secondary'),
    btn('Not now',{kind:'dismiss-rtc-ring',sid:i.sid},'text-button'),
    btn('Block caller',{kind:'open-modal',modal:{kind:'rtc-confirm',action:'block',input:{principal:i.caller}}},'text-button danger')).classes('buttons'),
   h('p','The caller is not told whether you declined or put this off: the call just rings out. Not now only hides this notice here.').classes('field-help')
  ).attrs({'aria-label':'Incoming call'}).classes('panel','rtc-ring').key(i.sid);
 })).attrs({role:'region','aria-label':'Incoming calls'}).classes('rtc-ring-stack');
}

/**
 * Composition wrapper (apps/web/src/release.mjs): hides the "Calls & connections" navigation entry unless the
 * account's session features include RTC. The ring itself renders into its own root next to the console (release.mjs),
 * so its arrival never rebuilds the console tree (focus and typed text stay put).
 */
export function withRtcSurface(render){
 return s=>rtcEnabled(s)||!Array.isArray(s.navigation)?render(s):render({...s,navigation:s.navigation.filter(item=>(Array.isArray(item)?item[0]:item.view??item.id)!=='calls')});
}
