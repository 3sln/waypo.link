// Signaling owner routes (docs/spec/extensions/signaling.md §14.1; Appendix C.2: the RTC owner routes reduced to the
// generic controls, approvals moved under the intents paths). Thin adapters over the owner operations of
// packages/app/domains/signaling.mjs through the account slice's signalingDispatch, as the account owner
// ({kind:'owner'}; never an actor from the body). Provisional (coordinator), not signed off by the user. Owner stage:
// the router has already checked the origin, the session, CSRF for writes and capacity admission (narrowing paths are
// exempt below).
//
//   GET  /api/signaling/settings          IP policy, apps (approvals, endpoints, live offers, pairings per app), every
//                                         pairing, blocks (principals and providers) and live sessions, in one read
//   GET  /api/signaling/pairing?id=       one pairing for its owner page (kind, parties, peer as shown, newer version)
//   POST /api/signaling/review            {action, input}: the review an owner page takes before a widening action
//   POST /api/signaling/{action}          one owner operation with the JSON body as its input: set-policy, block,
//                                         unblock, end-session, revoke-endpoint, revoke-offers, pairing-create,
//                                         pairing-activate, pairing-update, pairing-remove, set-service
//   POST /api/intents/session-{action}    session handler approvals (AMD-SG-I1): session-approve (widening),
//                                         session-unapprove (narrowing), session-auto-connect
//   GET  /api/orgs/{org}/signaling        an organization's service designation (§4.3), for an admin of it
//   POST /api/orgs/{org}/signaling        {operation: 'review' | 'set-service', input, review?} through the organization's
//                                         owner interface authority (organizations §6.3; ORG-5 acting authority)
//
// Owner pages (packages/signaling/owner-pages.mjs; release gate "Signaling", owner pages). These JSON routes are only
// the adapters of the provider pages in apps/web (console view `signaling`): every widening action (session-approve,
// session-auto-connect on, pairing-create, pairing-activate, pairing-update that renews or re-confirms, set-service on)
// carries the `review` id the page obtained from POST /api/signaling/review, which the engine checks and consumes
// atomically with the change, and refuses before the review's server-side arming time. `review` is lifted out of the
// body here into the actor (adapter evidence) and never reaches the operation's input.
//
// Adapter evidence (never from the body): `parties` (the apps holding an active grant on the signaling fragment, from
// the owner's federation grants; pairing P1 and approvals need it), `freshAuth` (the session authenticated within the
// last 5 minutes; cross-entity pairings, §5.8) and `review`.
// Flags: SIGNALING_ENABLED and SESSION_KINDS_ENABLED gate widening only; reads, narrowing and ending stay available.
import {json,body,flagEnabled,accountHandle} from './shared.mjs';
import {WIDENING} from '../../app/domains/signaling.mjs';
import {SIGNALING_FRAGMENT} from '../../signaling/extension.mjs';
import {actingAs} from '../../orgs/authority.mjs';
import {normalizeHandle} from '../../identity/handles.mjs';

const ACTIONS=Object.freeze(['set-policy','block','unblock','end-session','revoke-endpoint','revoke-offers','pairing-create','pairing-activate','pairing-update','pairing-remove','set-service','review']);
const INTENT_ACTIONS=Object.freeze({'session-approve':'intents.session-approve','session-unapprove':'intents.session-unapprove','session-auto-connect':'intents.session-auto-connect'});
/** Narrowing actions: never refused for capacity. `set-policy`, `pairing-update`, `set-service` and auto-connect may
 * also widen; they stay exempt so narrowing is never refused, and the engine refuses a widening while off. */
const NARROWING=Object.freeze(['block','end-session','revoke-endpoint','revoke-offers','pairing-remove','set-policy','pairing-update','set-service','session-unapprove','session-auto-connect']);
/** Operations whose page decisions need the P1 party evidence, and those that may need fresh authentication. */
const PARTIES=Object.freeze(['signaling.pairing-create','signaling.pairing-activate','intents.session-approve','signaling.review','signaling.pairing']);
const FRESH=Object.freeze(['signaling.pairing-create','signaling.pairing-activate','signaling.pairing-update','signaling.review']);
const ACTION_PATH=/^\/api\/signaling\/([a-z-]+)$/,INTENT_PATH=/^\/api\/intents\/(session-[a-z-]+)$/,ORG_PATH=/^\/api\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/signaling$/;
const SETTINGS='/api/signaling/settings',PAIRING='/api/signaling/pairing',REVIEW_ID=/^rv_[A-Za-z0-9_-]{22}$/;
const FRESH_MS=300000;
const unknown=()=>json({error:'not_found'},404);
const actionOf=path=>{let m=ACTION_PATH.exec(path);if(m&&ACTIONS.includes(m[1]))return m[1];m=INTENT_PATH.exec(path);return m&&Object.hasOwn(INTENT_ACTIONS,m[1])?m[1]:null;};
export function allowedMethods(path){if(path===SETTINGS||path===PAIRING)return ['GET'];if(ORG_PATH.test(path))return ['GET','POST'];if(actionOf(path))return ['POST'];return null;}
export const admission={exempt:path=>NARROWING.includes(actionOf(path))};

/** The owner's apps holding an active grant on the signaling fragment (federation grants): {clientId -> {name, origin}}. */
async function grantedApps(env,context){
 let grants=[];try{grants=(await env.FEDERATION_AUTHORITY?.grants?.(context))?.grants??[];}catch{grants=[];}
 const apps=new Map();
 for(const g of grants){if(!g?.active||g.fragment!==SIGNALING_FRAGMENT||typeof g.clientId!=='string'||apps.has(g.clientId))continue;
  apps.set(g.clientId,{clientId:g.clientId,name:typeof g.client?.name==='string'?g.client.name:null,origin:typeof g.client?.origin==='string'?g.client.origin:null});}
 return apps;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function handleOf(env,principal){
 if(principal?.iss!==env.APP_ORIGIN||!UUID.test(principal?.sub??''))return null;
 try{const a=await env.IDENTITY_REPOSITORY?.get(principal.sub);return a?.status==='active'&&typeof a.handle==='string'?a.handle:null;}catch{return null;}
}
/** One app entry per client id named anywhere in the owner's signaling state or grants (§14.1 "Where it belongs"). */
export function settingsView({enabled,policy,approvals,endpoints,offers,pairings,blocked,sessions,granted}){
 const apps=new Map(),app=id=>{if(!apps.has(id))apps.set(id,{clientId:id,name:granted.get(id)?.name??null,origin:granted.get(id)?.origin??null,approvals:[],endpoints:[],offers:[],pairings:[]});return apps.get(id);};
 for(const id of granted.keys())app(id);
 for(const a of approvals)if(!a.feature)app(a.handler).approvals.push({kind:a.kind,version:a.version,digest:a.digest,title:a.title,autoConnect:a.autoConnect,autoConnectAllowed:a.autoConnectAllowed===true,at:a.at});
 for(const e of endpoints)if(!e.feature)app(e.clientId).endpoints.push({endpoint:e.endpoint,label:e.label,kinds:e.kinds,lastSeen:e.lastSeen});
 for(const o of offers)if(!o.feature)app(o.clientId).offers.push({id:o.id,kind:o.kind,principal:o.principal,uses:o.uses,spent:o.spent,reserved:o.reserved,expiresAt:o.expiresAt});
 for(const p of pairings){app(p.local.client_id).pairings.push(p);if(p.peer.self&&p.peer.self.client_id!==p.local.client_id)app(p.peer.self.client_id).pairings.push(p);}
 return {enabled,policy:{other:policy.other,self:policy.self,revision:policy.revision},apps:[...apps.values()].filter(a=>granted.has(a.clientId)||a.approvals.length||a.endpoints.length||a.offers.length||a.pairings.length),pairings,blocked:blocked.blocked,blockedIssuers:blocked.issuers,sessions};
}
/** Lifts the page's `review` id out of a request body (adapter evidence, never operation input). */
export function splitReview(input){
 if(input===null||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(input,'review'))return {input,review:undefined};
 const {review,...rest}=input;return {input:rest,review:typeof review==='string'&&REVIEW_ID.test(review)?review:null};
}
/** The creation page lets the owner name a peer on this provider by handle (`peer: {handle}`); the adapter resolves it
 * to the origin principal through this host's directory (handles are public, directory.v1), so the engine only ever
 * pairs a principal. A handle naming another host, or no active account, answers `peer_unknown`. */
async function resolvePeer(env,input){
 const peer=input?.input?.peer;if(input?.action!=='pairing-create'||!peer||typeof peer!=='object'||Array.isArray(peer)||Object.keys(peer).join()!=='handle')return input;
 const raw=String(peer.handle??'').trim().replace(/^@/,''),[name,host,...rest]=raw.split('@');let handle=null;
 try{if(!rest.length&&(!host||host===new URL(env.APP_ORIGIN).host))handle=normalizeHandle(name);}catch{handle=null;}
 const account=handle?await env.IDENTITY_REPOSITORY?.findByHandle?.(handle):null;
 if(!account||account.status!=='active'||typeof account.id!=='string')throw Object.assign(new Error('No account with that handle was found here.'),{code:'peer_unknown',status:404});
 return {...input,input:{...input.input,peer:{principal:{iss:env.APP_ORIGIN,sub:account.id}}}};
}
const fresh=owner=>Number.isSafeInteger(owner?.authTime)&&owner.authTime>=Date.now()-FRESH_MS;
const faults=error=>{if(error?.code==='peer_unknown')return json({error:'peer_unknown',message:error.message},404);if(error?.code==='not_found'||error?.status===404)return unknown();if(error?.code==='conflict')return json({error:'conflict'},409);throw error;};

/** GET/POST /api/orgs/{org}/signaling: the service designation, through the organization's owner interface (§4.3). */
async function organizationRoute({request,env,id,object,actor},org){
 const subject={subject:{kind:'account',owner:org}},enabled=flagEnabled(env,'ORGANIZATIONS_ENABLED',subject,true)&&flagEnabled(env,'SIGNALING_ENABLED',subject)&&flagEnabled(env,'SESSION_KINDS_ENABLED',subject);
 const orgObject=org===id?object:accountHandle(env,org),as=actingAs(actor,{kind:'organization',id:org}),owner={kind:'owner',owner:org};
 const authority=widen=>orgObject.orgsActingAuthority(org,{actor:as,power:'admin',widen});
 try{
  if(request.method==='GET'){await authority(false);return json({...await orgObject.signalingDispatch(org,{operation:'signaling.service',actor:owner}),enabled:enabled===true});}
  const raw=await body(request,8192);if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['operation','input','review'].includes(k))||!['review','set-service'].includes(raw.operation))return json({error:'invalid_request',message:'Unsupported signaling request.'},400);
  const widen=raw.operation==='review'||raw.input?.designated===true;if(widen&&!enabled)return unknown();
  await authority(widen);
  if(raw.operation==='review'){if(raw.input?.action!=='set-service')return json({error:'invalid_request',message:'Unsupported signaling request.'},400);return json(await orgObject.signalingDispatch(org,{operation:'signaling.review',actor:owner,input:raw.input}));}
  return json(await orgObject.signalingDispatch(org,{operation:'signaling.set-service',actor:{...owner,...typeof raw.review==='string'&&REVIEW_ID.test(raw.review)?{review:raw.review}:{}},input:raw.input}));
 }catch(error){return faults(error);}
}

export const stages={
 async owner(route){
  const {request,env,path,id,object,context,owner,url}=route;
  const org=ORG_PATH.exec(path);if(org)return organizationRoute(route,org[1]);
  if(path!==SETTINGS&&path!==PAIRING&&!path.startsWith('/api/signaling/')&&!INTENT_PATH.test(path))return;
  const action=actionOf(path);if(path!==SETTINGS&&path!==PAIRING&&!action)return;
  const enabled=flagEnabled(env,'SIGNALING_ENABLED',{subject:{kind:'account',owner:id}})&&flagEnabled(env,'SESSION_KINDS_ENABLED',{subject:{kind:'account',owner:id}});
  const base={kind:'owner',owner:id},call=(operation,input,actor=base)=>object.signalingDispatch(id,{operation,actor,...input===undefined?{}:{input}});
  try{
   if(path===SETTINGS){
    const [policy,approvals,endpoints,offers,pairings,blocked,sessions,granted]=await Promise.all([call('signaling.policy'),call('intents.session-approvals'),call('signaling.endpoint-list'),call('signaling.offers'),call('signaling.pairings'),call('signaling.blocked'),call('signaling.sessions'),grantedApps(env,context)]);
    const view=settingsView({enabled:enabled===true,policy,approvals:approvals.approvals,endpoints:endpoints.endpoints,offers:offers.offers,pairings:pairings.pairings,blocked,sessions:sessions.sessions,granted});
    view.blocked=await Promise.all(view.blocked.map(async b=>({...b,handle:await handleOf(env,b.principal)})));
    // The by-peer list (§5.8 P4, §14.1) names a peer by handle only with a verified binding (same-host directory).
    view.pairings=await Promise.all(view.pairings.map(async p=>p.peer?.principal?{...p,peerHandle:await handleOf(env,p.peer.principal)}:p));
    return json(view);
   }
   if(path===PAIRING){const pid=url?.searchParams?.get('id')??new URL(request.url).searchParams.get('id');return json(await call('signaling.pairing',{id:pid},{...base,parties:[...(await grantedApps(env,context)).keys()]}));}
   const operation=INTENT_ACTIONS[action]??'signaling.'+action;
   if(WIDENING.has(operation)&&!enabled)return unknown();
   let {input,review}=splitReview(await body(request,16384));if(operation==='signaling.review')input=await resolvePeer(env,input);
   // Evidence for P1 (pairing parties) and approvals, fresh authentication (cross-entity pairings) and the page's review,
   // never from the body.
   const actor={...base,...PARTIES.includes(operation)?{parties:[...(await grantedApps(env,context)).keys()]}:{},...FRESH.includes(operation)?{freshAuth:fresh(owner)}:{},...review?{review}:{}};
   return json(await call(operation,input,actor));
  }catch(error){return faults(error);}
 },
};
