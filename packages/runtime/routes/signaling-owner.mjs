// Signaling owner routes (docs/spec/extensions/signaling.md §14.1; Appendix C.2: the RTC owner routes reduced to the
// generic controls, approvals moved under the intents paths). Thin adapters over the owner operations of
// packages/app/domains/signaling.mjs through the account slice's signalingDispatch, as the account owner
// ({kind:'owner'}; never an actor from the body). Provisional (coordinator), not signed off by the user. Owner stage:
// the router has already checked the origin, the session, CSRF for writes and capacity admission (narrowing paths are
// exempt below).
//
//   GET  /api/signaling/settings          IP policy, apps (approvals, endpoints, live offers, pairings per app), every
//                                         pairing, blocks (principals and providers) and live sessions, in one read
//   POST /api/signaling/{action}          one owner operation with the JSON body as its input: set-policy, block,
//                                         unblock, end-session, revoke-endpoint, revoke-offers, pairing-create,
//                                         pairing-activate, pairing-update, pairing-remove, set-service
//   POST /api/intents/session-{action}    session handler approvals (AMD-SG-I1): session-approve (widening),
//                                         session-unapprove (narrowing), session-auto-connect
//
// Adapter evidence (never from the body): `parties` (the apps holding an active grant on the signaling fragment, from
// the owner's federation grants; pairing P1 and approvals need it) and `freshAuth` (the session authenticated within
// the last 5 minutes; cross-entity pairing creation, §5.8). The provider pages that meet the §5.8 and §20.1.4 page
// obligations (armed controls, disclosures, nothing preselected) are NOT built yet (Appendix C.5 steps 5 and 7): these
// routes are the engine's adapters only, and the re-homed web controls use only the narrowing ones.
// Flags: SIGNALING_ENABLED and SESSION_KINDS_ENABLED gate widening only; reads, narrowing and ending stay available.
import {json,body,flagEnabled} from './shared.mjs';
import {WIDENING} from '../../app/domains/signaling.mjs';
import {SIGNALING_FRAGMENT} from '../../signaling/extension.mjs';

const ACTIONS=Object.freeze(['set-policy','block','unblock','end-session','revoke-endpoint','revoke-offers','pairing-create','pairing-activate','pairing-update','pairing-remove','set-service']);
const INTENT_ACTIONS=Object.freeze({'session-approve':'intents.session-approve','session-unapprove':'intents.session-unapprove','session-auto-connect':'intents.session-auto-connect'});
/** Narrowing actions: never refused for capacity. `set-policy`, `pairing-update`, `set-service` and auto-connect may
 * also widen; they stay exempt so narrowing is never refused, and the engine refuses a widening while off. */
const NARROWING=Object.freeze(['block','end-session','revoke-endpoint','revoke-offers','pairing-remove','set-policy','pairing-update','set-service','session-unapprove','session-auto-connect']);
const ACTION_PATH=/^\/api\/signaling\/([a-z-]+)$/,INTENT_PATH=/^\/api\/intents\/(session-[a-z-]+)$/,SETTINGS='/api/signaling/settings';
const FRESH_MS=300000;
const unknown=()=>json({error:'not_found'},404);
const actionOf=path=>{let m=ACTION_PATH.exec(path);if(m&&ACTIONS.includes(m[1]))return m[1];m=INTENT_PATH.exec(path);return m&&Object.hasOwn(INTENT_ACTIONS,m[1])?m[1]:null;};
export function allowedMethods(path){if(path===SETTINGS)return ['GET'];if(actionOf(path))return ['POST'];return null;}
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
 for(const a of approvals)if(!a.feature)app(a.handler).approvals.push({kind:a.kind,version:a.version,digest:a.digest,title:a.title,autoConnect:a.autoConnect,at:a.at});
 for(const e of endpoints)if(!e.feature)app(e.clientId).endpoints.push({endpoint:e.endpoint,label:e.label,kinds:e.kinds,lastSeen:e.lastSeen});
 for(const o of offers)if(!o.feature)app(o.clientId).offers.push({id:o.id,kind:o.kind,principal:o.principal,uses:o.uses,spent:o.spent,reserved:o.reserved,expiresAt:o.expiresAt});
 for(const p of pairings){app(p.local.client_id).pairings.push(p);if(p.peer.self&&p.peer.self.client_id!==p.local.client_id)app(p.peer.self.client_id).pairings.push(p);}
 return {enabled,policy:{other:policy.other,self:policy.self,revision:policy.revision},apps:[...apps.values()].filter(a=>granted.has(a.clientId)||a.approvals.length||a.endpoints.length||a.offers.length||a.pairings.length),pairings,blocked:blocked.blocked,blockedIssuers:blocked.issuers,sessions};
}

export const stages={
 async owner({request,env,path,id,object,context,owner}){
  if(path!==SETTINGS&&!path.startsWith('/api/signaling/')&&!INTENT_PATH.test(path))return;
  const action=actionOf(path);if(path!==SETTINGS&&!action)return;
  const enabled=flagEnabled(env,'SIGNALING_ENABLED',{subject:{kind:'account',owner:id}})&&flagEnabled(env,'SESSION_KINDS_ENABLED',{subject:{kind:'account',owner:id}});
  const base={kind:'owner',owner:id},call=(operation,input,actor=base)=>object.signalingDispatch(id,{operation,actor,...input===undefined?{}:{input}});
  try{
   if(path===SETTINGS){
    const [policy,approvals,endpoints,offers,pairings,blocked,sessions,granted]=await Promise.all([call('signaling.policy'),call('intents.session-approvals'),call('signaling.endpoint-list'),call('signaling.offers'),call('signaling.pairings'),call('signaling.blocked'),call('signaling.sessions'),grantedApps(env,context)]);
    const view=settingsView({enabled:enabled===true,policy,approvals:approvals.approvals,endpoints:endpoints.endpoints,offers:offers.offers,pairings:pairings.pairings,blocked,sessions:sessions.sessions,granted});
    view.blocked=await Promise.all(view.blocked.map(async b=>({...b,handle:await handleOf(env,b.principal)})));
    return json(view);
   }
   const operation=INTENT_ACTIONS[action]??'signaling.'+action;
   if(WIDENING.has(operation)&&!enabled)return unknown();
   const input=await body(request,16384);
   // Evidence for P1 (pairing parties) and approvals, and fresh authentication (cross-entity pairings), never from the body.
   const needsParties=['signaling.pairing-create','signaling.pairing-activate','intents.session-approve'].includes(operation);
   const actor={...base,...needsParties?{parties:[...(await grantedApps(env,context)).keys()]}:{},...operation==='signaling.pairing-create'?{freshAuth:Number.isSafeInteger(owner?.authTime)&&owner.authTime>=Date.now()-FRESH_MS}:{}};
   return json(await call(operation,input,actor));
  }catch(error){
   if(error?.code==='not_found'||error?.status===404)return unknown();
   if(error?.code==='conflict')return json({error:'conflict'},409);
   throw error;
  }
 },
};
