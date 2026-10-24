// ORG-10c relation edges (spec docs/spec/organizations.md §9.3, §9.6, §9.9; design §8b.3, §8b.6, §8b.10). An edge X→Y is
// one directional entity connection carrying X's consented fragment grants for Y. It is live exactly when:
//   X consented (X's GRANT half is live, holding X's chosen resources per access entry),
//   Y accepted (Y's ACCEPTANCE half is live; X mirrors it from Y's relation-edge-state events),
//   both participations are live, and both pin the instance's relation version (v1: one pin per instance).
// Nothing else grants anything: no transitivity (an edge A→B and an edge B→C give C nothing from A), no onward sharing
// (imported resources are never a grant value), no governance, no membership.
//
// Each side holds, per counterpart in an instance (key rel/cp/<instance>/<principal>):
//   grant          my grant half to them           {state:'pending'|'live'|'suspended'|'ended', generation, entries, at}
//   acceptance     my acceptance of their grant    {state, generation, at}
//   peerGrant      their grant half, mirrored      {state, generation, entries, at}  (from relation-edge-state)
//   peerAcceptance their acceptance, mirrored      {state, generation, at}
// Generation ordering (spec §9.9 step 6): every change raises the holder's generation; a mirror applies only a higher
// generation, and after an end nothing changes the half again, so reordering, duplication or loss never revives anything.
// A narrowing (suspend, end) is effective at the holder at once; authority never depends on event delivery.
//
// Event payloads are built here unsigned; packages/orgs/relation-events.mjs (ORG-10e) signs them at delivery with the
// sending organization's certification key (typ bindle-relation-event+jwt) and verifies spec §9.9 steps 1–3 on receipt,
// on the same host and across providers alike (RL-15).
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {edgeEntries} from './relation-documents.mjs';

const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
const EVENTS='https://spec.bindle.example/events/';
export const RELATION_EVENT=Object.freeze({
 edgeState:EVENTS+'relation-edge-state/v1',edgeEnded:EVENTS+'relation-edge-ended/v1',introduction:EVENTS+'relation-introduction/v1',
 recognition:EVENTS+'relation-recognition/v1',busAdvanced:EVENTS+'relation-bus-advanced/v1'});
export const RELATION_EVENT_TYPES=Object.freeze(Object.values(RELATION_EVENT));
export const RELATION_EVENT_PAST_S=300,RELATION_EVENT_FUTURE_S=30;
const resourceLive=(r,now)=>r.expires_at===undefined||r.expires_at>now/1000;

export const half=(state,generation,at,entries)=>({state,generation,at,...entries?{entries:structuredClone(entries)}:{}});
/** Raises a half's generation with a new state (and entries for a live grant half). Ended halves never change. */
export function bump(h,state,at,entries){
 if(!h||h.state==='ended')return h;
 const next=half(state,(h.generation??0)+1,at,entries??(state==='ended'?undefined:h.entries));
 // A suspension's cause ('moved', 'billing') survives every change that keeps the half suspended (review L2), so a
 // narrowed edge that arrived suspended after a move still needs re-binding.
 if(h.cause&&h.state==='suspended'&&state==='suspended')next.cause=h.cause;
 return next;
}
/** My edge to the counterpart (me → them) is live. */
export function outgoingLive(part,cp,now){
 return part?.state==='live'&&cp?.state==='live'&&cp.grant?.state==='live'&&cp.peerAcceptance?.state==='live'&&(cp.grant.entries??[]).length>0
  &&cp.grant.entries.some(e=>!e.resources.length||e.resources.some(r=>resourceLive(r,now)));
}
/** Their edge to me (them → me) is live as far as my records show. */
export const incomingLive=(part,cp)=>part?.state==='live'&&cp?.state==='live'&&cp.acceptance?.state==='live'&&cp.peerGrant?.state==='live';

/**
 * The grantor-side authorization hook (what ORG-10d's entity-certificate verification calls after its own checks): the
 * call (resource, contract, method) must fall within the live grant of the edge from this entity to the grantee IN THIS
 * INSTANCE only (spec §9.5). Grants on other edges between the same two entities, and every edge anyone else holds,
 * never apply. Returns a boolean only (the caller answers uniformly).
 */
export function edgeAllows(part,cp,{resource,contract,method},now){
 if(!outgoingLive(part,cp,now)||typeof resource!=='string'||typeof contract!=='string'||typeof method!=='string')return false;
 return cp.grant.entries.some(e=>e.resources.some(r=>r.resource===resource&&resourceLive(r,now)&&r.methods&&Object.hasOwn(r.methods,contract)&&Array.isArray(r.methods[contract])&&r.methods[contract].includes(method)));
}

/**
 * Resource scoping on a relation grant (design §8b.2 step 3, resource-scoping.md; spec §9.5 `scope`, §9.9 entries):
 * {prefix?, readOnly?:true, maxObjectBytes?}. Enforced by the grantor on every call, fail closed:
 *   readOnly        refuses every write-capable method (and a presign for writing);
 *   prefix          the call must name a `key` (or a `prefix`) equal to the scope prefix or inside it ("p" or "p/…");
 *                   a call that names neither is refused, and presign is refused (it would escape the prefix);
 *   maxObjectBytes  a `put` must carry `dataBase64` no larger than the bound; presign is refused.
 * Provisional reading (coordinator): unlike an attenuated child reference, a relation grantee addresses the grantor's
 * own resource ID, so keys are not rewritten; they are checked as given. No scope allows everything the methods allow.
 */
export function relationScopeAllows(scope,{method,args,write}){
 if(scope===undefined||scope===null)return true;
 if(typeof scope!=='object'||Array.isArray(scope)||Object.keys(scope).some(k=>!['prefix','readOnly','maxObjectBytes'].includes(k)))return false;
 const a=args??{};if(typeof a!=='object'||Array.isArray(a))return false;
 if((scope.prefix!==undefined||scope.maxObjectBytes!==undefined)&&method==='presign')return false;
 if(scope.readOnly===true&&(write||method==='presign'&&a.operation==='write'))return false;
 if(scope.prefix!==undefined){const p=String(scope.prefix),target=typeof a.key==='string'?a.key:typeof a.prefix==='string'?a.prefix:undefined;
  if(typeof scope.prefix!=='string'||target===undefined||!(target===p||target.startsWith(p+'/'))||target.split('/').some(s=>s==='..'||s==='.'))return false;
  if(typeof a.key==='string'&&typeof a.prefix==='string'&&!(a.prefix===p||a.prefix.startsWith(p+'/')))return false;}
 if(scope.maxObjectBytes!==undefined&&method==='put'){if(typeof a.dataBase64!=='string')return false;const d=a.dataBase64,n=Math.floor(d.length*3/4)-(d.endsWith('==')?2:d.endsWith('=')?1:0);if(n>scope.maxObjectBytes)return false;}
 return true;
}

/**
 * The scope a granted call runs under when both the edge grant and the certificate carry one (review L3): the storage
 * `assignedScope` semantics of packages/runtime/account/storage.mjs, so the ORG-10f dispatch passes it as the call's
 * `scope` and the storage adapter refuses an oversized `get` by the object's real size (the grantor cannot know it at
 * decision time). Prefixes must nest (the narrower wins); readOnly is either; maxObjectBytes the smaller. Returns null
 * when the two cannot compose (disjoint prefixes), which the caller treats as a refusal.
 */
export function composeRelationScope(a,b){
 if(!a&&!b)return {};const x=a??{},y=b??{},out={};
 if(x.prefix!==undefined||y.prefix!==undefined){const p=x.prefix,q=y.prefix;
  if(p!==undefined&&q!==undefined){if(q===p||q.startsWith(p+'/'))out.prefix=q;else if(p.startsWith(q+'/'))out.prefix=p;else return null;}else out.prefix=p??q;}
 if(x.readOnly===true||y.readOnly===true)out.readOnly=true;
 const m=[x.maxObjectBytes,y.maxObjectBytes].filter(Number.isSafeInteger);if(m.length)out.maxObjectBytes=Math.min(...m);
 return out;
}

/** Every required entry of the pair is granted (spec §9.2: an edge is live only when each required entry is granted). */
export function requiredSatisfied(doc,grantorSlot,granteeSlot,entries){
 return edgeEntries(doc,grantorSlot,granteeSlot).filter(e=>e.required).every(e=>(entries??[]).some(x=>x.index===e.index));
}

/**
 * The grantee's clamp of a received grant half (defence in depth): only entries the pinned document defines for
 * (their slot → my slot), and per resource only methods within that entry's ceilings. A grantor can never widen what
 * the grantee records beyond the matrix both pinned.
 */
export function clampEntries(doc,theirSlot,mySlot,entries){
 const defined=new Map(edgeEntries(doc,theirSlot,mySlot).map(e=>[e.index,e]));const out=[];
 for(const x of Array.isArray(entries)?entries.slice(0,64):[]){
  const e=defined.get(x?.index);if(!e||!Array.isArray(x.resources))continue;
  // Counterpart-supplied keys (a contract named `constructor` or `__proto__`) only ever meet own-member lookups on
  // null-prototype maps (review L2).
  const ceiling=new Map();for(const contracts of Object.values(e.methods))for(const [c,ms] of Object.entries(contracts))ceiling.set(c,[...new Set([...(ceiling.get(c)??[]),...ms])]);
  const resources=[];
  for(const r of x.resources.slice(0,16)){
   if(typeof r?.resource!=='string'||!r.resource||r.resource.length>2048||r.methods===null||typeof r.methods!=='object')continue;
   const methods=Object.create(null);for(const [c,ms] of Object.entries(r.methods))if(Array.isArray(ms)&&ceiling.has(c)){const kept=ms.filter(m=>typeof m==='string'&&ceiling.get(c).includes(m));if(kept.length)methods[c]=[...new Set(kept)].sort();}
   if(!Object.keys(methods).length&&Object.keys(e.methods).length)continue;
   resources.push({resource:r.resource,contracts:Object.keys(methods).sort(),methods:{...methods},...scopeShape(r.scope)?{scope:{...r.scope}}:{},...Number.isSafeInteger(r.expires_at)?{expires_at:r.expires_at}:{},...typeof r.replaces==='string'&&r.replaces.length<=2048?{replaces:r.replaces}:{}});
  }
  if(resources.length||!Object.keys(e.methods).length)out.push({index:e.index,resources});
 }
 return out.sort((a,b)=>a.index-b.index);
}
/** A well-formed relation scope (the grantee keeps only that; the grantor enforces it). */
const scopeShape=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length>0&&Object.keys(v).every(k=>['prefix','readOnly','maxObjectBytes'].includes(k))&&(v.prefix===undefined||typeof v.prefix==='string'&&v.prefix.length>0&&v.prefix.length<=512)&&(v.readOnly===undefined||v.readOnly===true)&&(v.maxObjectBytes===undefined||Number.isSafeInteger(v.maxObjectBytes)&&v.maxObjectBytes>0);
/** The grant half's entries as carried in relation-edge-state (spec §9.9): per entry, resources with contracts and methods. */
export const wireEntries=entries=>(entries??[]).map(e=>({index:e.index,resources:e.resources.map(r=>({resource:r.resource,contracts:Object.keys(r.methods).sort(),methods:structuredClone(r.methods),...r.scope?{scope:structuredClone(r.scope)}:{},...r.expires_at!==undefined?{expires_at:r.expires_at}:{},...r.replaces?{replaces:r.replaces}:{}}))}));
/** The relation-event payload for one of my halves (unsigned; ORG-10e signs it at delivery). */
export function halfEvent(kind,h){
 if(h.state==='ended')return {[RELATION_EVENT.edgeEnded]:{half:kind}};
 const state=h.state==='live'?'live':'suspended';
 return {[RELATION_EVENT.edgeState]:{half:kind,generation:h.generation,state,...kind==='grant'&&state==='live'?{entries:wireEntries(h.entries)}:{}}};
}

/**
 * Applies a counterpart's half event to my mirror of it (spec §9.9 step 6). Returns {changed, mirror}. `received` is
 * the event's single {type: payload}. Unknown or malformed payloads change nothing.
 */
export function applyMirror(mirror,received,at){
 const [[type,payload]]=Object.entries(received);
 if(mirror?.state==='ended')return {changed:false,mirror};
 if(type===RELATION_EVENT.edgeEnded)return {changed:true,mirror:{state:'ended',generation:mirror?.generation??0,at}};
 if(type!==RELATION_EVENT.edgeState||!Number.isSafeInteger(payload?.generation)||payload.generation<1||!['live','suspended'].includes(payload.state))return {changed:false,mirror};
 if(mirror&&payload.generation<=mirror.generation)return {changed:false,mirror};
 // A suspension carries no entries: the last known entries stay (unavailable while suspended).
 const entries=payload.entries??mirror?.entries;
 return {changed:true,mirror:{state:payload.state,generation:payload.generation,at,...entries?{entries:structuredClone(entries)}:{}}};
}
/** Whether a received event is a narrowing (applied whatever its `aep`, spec §9.9 step 5). */
export function narrowingEvent(received){const [[type,payload]]=Object.entries(received);return type===RELATION_EVENT.edgeEnded||type===RELATION_EVENT.edgeState&&payload?.state==='suspended';}

// ---- engine operations (organization placement unless marked) ------------------------------------------------------
const CHANGED='relations-changed';
class EdgeAction extends AppAction{static deps=['relations'];static changes=CHANGED;static entities=['organization'];}
/** Narrowing: never flag-gated, one admin, ordinary authentication, immediate (RL-3). */
export class SuspendRelationEdge extends EdgeAction{static operation='relations.suspend';static lifecycle='suspended';run({relations}){return relations.suspend(this.actor,this.input);}}
export class EndRelationEdge extends EdgeAction{static operation='relations.end';static lifecycle='suspended';run({relations}){return relations.end(this.actor,this.input);}}
export class NarrowRelationEdge extends EdgeAction{static operation='relations.narrow';static lifecycle='suspended';run({relations}){return relations.narrow(this.actor,this.input);}}
/** Resuming restores outward or inward flow, so it is treated as widening (flag, fresh step-up); see DEVLOG ORG-10a-c. */
export class ResumeRelationEdge extends EdgeAction{static operation='relations.resume';run({relations}){return relations.resume(this.actor,this.input);}}
// System (never wire-dispatchable): adapters build a system actor from verified evidence.
export class IngestRelationEvent extends AppAction{static operation='relations.ingest';static deps=['relations'];static changes=CHANGED;static lifecycle='suspended';run({relations}){return relations.ingest(this.actor,this.input);}}
export class RelationOutboxDrain extends AppAction{static operation='relations.outbox-drain';static deps=['relations'];static lifecycle='suspended';run({relations}){return relations.drain(this.actor,this.input??{});}}
export class RelationResync extends AppAction{static operation='relations.resync';static deps=['relations'];static lifecycle='suspended';run({relations}){return relations.resync(this.actor,this.input??{});}}
export class RelationEdgeCheck extends AppQuery{static operation='relations.edge-check';static deps=['relations'];fetch({relations}){return relations.edgeCheck(this.actor,this.input);}}
export const RELATION_EDGE_OPERATIONS=Object.freeze([SuspendRelationEdge,EndRelationEdge,NarrowRelationEdge,ResumeRelationEdge]);
export const RELATION_EDGE_SYSTEM_OPERATIONS=Object.freeze([IngestRelationEvent,RelationOutboxDrain,RelationResync,RelationEdgeCheck]);
export {fail as edgeFail};
