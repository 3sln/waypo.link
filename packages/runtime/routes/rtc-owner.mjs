// RTC-g owner routes (docs/architecture/rtc-signaling.md §7, §8.1 RTC-g; spec docs/spec/rtc-signaling.md §4.3, §10,
// §12, §13). Thin adapters over the RtcService owner operations (RTC_OWNER_OPERATIONS in packages/app/domains/rtc.mjs)
// through the account slice's rtcDispatch, as the account owner ({kind:'owner'}; never an actor from the body).
// Provisional (coordinator), not signed off by the user. Owner stage: the router has already checked the origin, the
// session, CSRF for writes and capacity admission (narrowing paths are exempt below).
//
//   GET  /api/rtc/settings   the owner's settings and lists in one read: policy, held purposes, contact-link RTC
//                            configuration, apps with bound RTC purposes (from the owner's federation grants), live
//                            sessions, missed and held invites, blocks and mutes, tickets and endpoints
//   GET  /api/rtc/ring       incoming invites the portal may ring for (see `ringable`): only what spec §9.1 lets a
//                            callee see before a claim (verified caller, a handle only when this host holds it, the
//                            calling app's verified origin (RTC-17), purpose, media, ring deadline) plus this owner's
//                            own apps registered for the purpose
//   POST /api/rtc/{action}   one owner operation `rtc.{action}` with the JSON body as its input
//   POST /api/rtc/narrow-app {clientId, purposes}: narrows an app's approved RTC purposes (FederationService
//                            narrowBoundOptions on the signaling slot; never gated, see narrowApp)
//
// Flags: RTC_SIGNALING_ENABLED gates widening only. While it is off, `unblock` and `unmute` (RTC_WIDENING) and any
// set-policy or set-contact-rtc change that widens (decided by the engine against the stored value) answer the uniform
// 404, exactly like an unknown /api path. Reads, narrowing and ending stay available (design §3.2).
import {json,body,flagEnabled} from './shared.mjs';
import {RTC_WIDENING,RTC_FRAGMENT,heldPurpose} from '../../app/domains/rtc.mjs';
import {REGISTERED_PURPOSES} from '../../rtc/purposes.mjs';

const ACTIONS=Object.freeze(['set-policy','set-contact-rtc','block','unblock','mute','unmute','revoke-ticket','end-session','revoke-endpoint','clear-missed','narrow-app']);
/** Narrowing actions: never refused for capacity (protective, as withdrawing contact sharing is). */
const NARROWING=Object.freeze(['block','mute','revoke-ticket','end-session','revoke-endpoint','clear-missed','narrow-app']);
const ACTION_PATH=/^\/api\/rtc\/([a-z-]+)$/;
const READS=['/api/rtc/settings','/api/rtc/ring'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unknown=()=>json({error:'not_found'},404);
const actionOf=path=>{const m=ACTION_PATH.exec(path);return m&&ACTIONS.includes(m[1])?m[1]:null;};

export function allowedMethods(path){if(READS.includes(path))return ['GET'];if(actionOf(path))return ['POST'];return null;}
export const admission={exempt:path=>NARROWING.includes(actionOf(path))};

/** The purposes this host holds pinned (the only usable versions, spec §3.5 item 3): presentation metadata only. */
export function heldPurposes(){
 return REGISTERED_PURPOSES.map(e=>heldPurpose(e.id)).filter(Boolean).map(({ref,body:b})=>({id:ref.purpose,version:ref.version,title:structuredClone(b.title),summary:structuredClone(b.summary),media:[...b.media],alert:b.alert===true,parties:b.parties,autoAccept:b.auto_accept}));
}
/** A handle only for a principal of this host whose account is active (the provider's own verified binding). */
async function handleOf(env,principal){
 if(principal?.iss!==env.APP_ORIGIN||!UUID.test(principal?.sub??''))return null;
 try{const a=await env.IDENTITY_REPOSITORY?.get(principal.sub);return a?.status==='active'&&typeof a.handle==='string'?a.handle:null;}catch{return null;}
}
/** RTCs follow-up (a): the host of the caller's provider when the caller is on another provider and a caller origin
 * is shown. That origin is only what the caller's provider certified (it may be malicious), so the ring labels it as
 * reported by that provider; a same-host caller's origin was certified by this host and stays unlabelled (null). */
export function callerOriginReporter(env,s){if(typeof s.callerOrigin!=='string'||s.peer?.iss===env.APP_ORIGIN)return null;try{return new URL(s.peer.iss).host;}catch{return null;}}
/** The owner's apps holding an active grant on the signaling slot, with their approved bound purposes (AMD-X1). */
async function rtcApps(env,context){
 let grants=[];try{grants=(await env.FEDERATION_AUTHORITY?.grants?.(context))?.grants??[];}catch{grants=[];}
 const apps=new Map();
 for(const g of grants){if(!g?.active||g.fragment!==RTC_FRAGMENT||typeof g.clientId!=='string')continue;const purposes=Array.isArray(g.bound?.values?.purposes)?g.bound.values.purposes.filter(l=>typeof l==='string'):[];
  const app=apps.get(g.clientId)??{clientId:g.clientId,name:typeof g.client?.name==='string'?g.client.name:null,origin:typeof g.client?.origin==='string'?g.client.origin:null,purposes:[]};
  for(const l of purposes)if(!app.purposes.includes(l))app.purposes.push(l);apps.set(g.clientId,app);}
 return [...apps.values()].map(a=>({...a,purposes:a.purposes.sort()}));
}
/**
 * Whether the portal may ring for a live session (spec §4.4, design §7 "Incoming ring", RTC-16): an incoming,
 * unclaimed, ringing, not held invite from another entity, for a purpose that alerts, not muted by principal or purpose,
 * before its deadline, whose engine `alert` is true. Review F2 (gate G1 closed): RtcService's owner view always carries
 * `alert` for incoming records, re-evaluated on every read against the current mutes (principal, purpose and the
 * caller's application), so a record without `alert === true` never rings.
 */
export function ringable(s,{purposes,muted,now}){
 if(s.role!=='callee'||s.state!=='ringing'||s.held||s.claimed||s.own||!(s.ringUntil>now))return false;
 if(s.alert!==true)return false;
 if(purposes.find(p=>p.id===s.purpose)?.alert!==true)return false;
 return !muted.some(m=>m.kind==='purpose'&&m.value===s.purpose||m.kind==='principal'&&m.value?.iss===s.peer.iss&&m.value?.sub===s.peer.sub);
}
/**
 * Whether nothing can ring this owner's portal (review F4): no ringing incoming invite, no registered endpoint (which
 * the `self` basis needs), no contact link configured for an alerting purpose and no live call link for one. The ring
 * answer carries it as `idle` so the console stops polling until something changes; apps/web/src/bl/rtc-settings.mjs
 * applies the same rule to the settings read.
 */
export function ringIdle({invites,endpoints,contacts,tickets,purposes}){
 const alerting=new Set(purposes.filter(p=>p.alert===true).map(p=>p.id)),any=lines=>Array.isArray(lines)&&lines.some(l=>alerting.has(l));
 return !invites.length&&!endpoints.length&&!contacts.some(c=>any(c.purposes))&&!tickets.some(t=>t.live&&any(t.purposes));
}

/**
 * Review F1 (coordinator decision (a), silent end; gate G2 closed). Declining or ending an UNCLAIMED INCOMING record
 * sends the caller nothing, so the caller's session simply rings out (spec §12 "No presence oracle"; §4.4: a decline
 * reveals that a device saw the invite). RtcService enforces it for every such record (`rtc.end-session` with or
 * without `silent`: reason `declined`, `state: ended` only to this owner's own endpoints, no control statement, not
 * recorded as missed) and refuses `silent: true` for anything else (a claimed or outgoing session), so the route only
 * checks the body's shape and forwards it. The constant stays exported for the tests and the console.
 */
export const RTC_SILENT_END_SUPPORTED=true;
const invalidArgs=()=>Object.assign(new Error('Unsupported signaling request.'),{code:'invalid_args',status:400});
function endSession(call,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalidArgs();
 if(input.silent!==undefined&&(input.silent!==true||input.caller===undefined))throw invalidArgs();
 return call('rtc.end-session',input);
}
/**
 * Narrowing an app's approved RTC purposes (AMD-X1 item 3, spec §14 "Slot changes"): `{clientId, purposes}` becomes
 * FederationService.narrowBoundOptions for the signaling slot fragment, as the signed-in owner (the federation shard
 * re-authenticates the session and CSRF token as a mutation). It keeps the intersection on every active grant of that
 * app, and its boundSync hook then runs `rtc.lifecycle` `app-narrowed`, which ends the app's sessions and endpoint
 * registrations for the removed purposes. Never gated (narrowing); a widening is refused by the federation service,
 * and while RTC_SIGNALING_ENABLED is off it answers the uniform 404 like any other widening.
 */
const NARROW_KEYS=['clientId','purposes'];
async function narrowApp(env,context,input,enabled){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!NARROW_KEYS.includes(k))||typeof input.clientId!=='string'||!input.clientId||input.clientId.length>2048||!Array.isArray(input.purposes)||input.purposes.length>16||input.purposes.some(l=>typeof l!=='string'||l.length>256))throw invalidArgs();
 if(typeof env.FEDERATION_AUTHORITY?.narrowBoundOptions!=='function')return unknown();
 try{const out=await env.FEDERATION_AUTHORITY.narrowBoundOptions(context,{clientId:input.clientId,fragment:RTC_FRAGMENT,options:{purposes:[...input.purposes]}});
  return json({clientId:out.clientId,purposes:Array.isArray(out.values?.purposes)?[...out.values.purposes].sort():[]});}
 catch(error){if(error?.code==='bound_options_widening')return enabled?json({error:'bound_options_widening',message:'Approving more purposes needs a new approval in the app.'},400):unknown();if(error?.code==='invalid_args')throw invalidArgs();throw error;}
}

export const stages={
 async owner({request,env,path,id,object,context}){
  if(!path.startsWith('/api/rtc/'))return;
  const action=actionOf(path);if(!READS.includes(path)&&!action)return;
  const actor={kind:'owner',owner:id},call=(operation,input)=>object.rtcDispatch(id,{operation,actor,...input===undefined?{}:{input}});
  const enabled=flagEnabled(env,'RTC_SIGNALING_ENABLED',{subject:{kind:'account',owner:id}});
  try{
   if(path==='/api/rtc/settings'){
    const [policy,contacts,sessions,missed,blocked,tickets,endpoints,apps]=await Promise.all([call('rtc.policy'),call('rtc.export'),call('rtc.sessions'),call('rtc.missed'),call('rtc.blocked'),call('rtc.tickets'),call('rtc.endpoint-list'),rtcApps(env,context)]);
    const handles=new Map(),named=async p=>{const key=p?.iss+'\n'+p?.sub;if(!handles.has(key))handles.set(key,await handleOf(env,p));return handles.get(key);};
    return json({enabled:enabled===true,policy,purposes:heldPurposes(),contacts:contacts.contacts.map(c=>({parent:c.parent,purposes:[...c.purposes]})),apps,
     sessions:await Promise.all(sessions.sessions.map(async s=>({...s,peerHandle:await named(s.peer)}))),
     missed:await Promise.all(missed.missed.map(async m=>({...m,callerHandle:await named(m.caller)}))),
     blocked:await Promise.all(blocked.blocked.map(async b=>({...b,handle:await named(b.principal)}))),muted:blocked.muted,
     tickets:tickets.tickets,endpoints:endpoints.endpoints});
   }
   if(path==='/api/rtc/ring'){
    // Nothing rings while the flag is off (no new sessions are admitted then either).
    if(!enabled)return json({invites:[]});
    const [sessions,blocked,endpoints]=await Promise.all([call('rtc.sessions'),call('rtc.blocked'),call('rtc.endpoint-list')]),purposes=heldPurposes(),now=Date.now();
    const invites=[];
    for(const s of sessions.sessions)if(ringable(s,{purposes,muted:blocked.muted,now}))invites.push({sid:s.sid,caller:{iss:s.peer.iss,sub:s.peer.sub},callerHandle:await handleOf(env,s.peer),callerOrigin:typeof s.callerOrigin==='string'?s.callerOrigin:null,callerOriginReportedBy:callerOriginReporter(env,s),purpose:s.purpose,title:structuredClone(purposes.find(p=>p.id===s.purpose).title),media:[...s.media],ringUntil:s.ringUntil,
     apps:[...new Map(endpoints.endpoints.filter(e=>e.purposes.includes(s.purpose)).map(e=>[e.clientId,{clientId:e.clientId,origin:e.origin}])).values()]});
    // `idle` only when nothing could ring (the extra reads run only without endpoints and invites).
    const idle=!invites.length&&!endpoints.endpoints.length&&ringIdle({invites,endpoints:endpoints.endpoints,...await Promise.all([call('rtc.export'),call('rtc.tickets')]).then(([c,t])=>({contacts:c.contacts,tickets:t.tickets})),purposes});
    return json({invites,idle});
   }
   if(RTC_WIDENING.has('rtc.'+action)&&!enabled)return unknown();
   const input=await body(request,16384);
   if(action==='end-session')return json(await endSession(call,input));
   if(action==='narrow-app')return await narrowApp(env,context,input,enabled);
   // Review F7: a contact-link configuration names one of this owner's active contact links (the account's contact-grant
   // list); an unknown or inactive parent is the uniform 404. Removing a configuration (no purposes) stays available
   // for any parent, so a revoked link's leftover configuration can always be cleared.
   if(action==='set-contact-rtc'&&Array.isArray(input?.purposes)&&input.purposes.length&&!(await object.contacts(id)).some(c=>c.id===input.parent&&c.active===true))return unknown();
   return json(await call('rtc.'+action,input));
  }catch(error){
   // The uniform 404: a widening change while off, and any unknown target, answer exactly like an unknown path.
   if(error?.code==='not_found'||error?.status===404)return unknown();
   throw error;
  }
 },
};
