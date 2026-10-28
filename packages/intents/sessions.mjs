// Session kinds and session handler approvals: signaling AMD-SG-I1 (docs/spec/extensions/signaling.md §3.4, §20.1),
// proposed and unsigned, NOT applied to docs/spec/extensions/intents.md. Implemented locally behind SESSION_KINDS_ENABLED
// and SIGNALING_ENABLED (default off). Provisional (coordinator), not signed off by the user.
//
// A session kind is an intent kind whose body carries `session` (§20.1.1); validateIntentKind (schema.mjs) applies
// `sessionMemberValid` and the extra body rules below. The growth table needs no row: no rule in core/artefacts.mjs
// matches `/session`, so any change under it is non-additive ("frozen", §20.1.1).
//
// A session handler approval (§20.1.4) is an owner record in the entity's intents memory, beside the routing default
// of the same kind line (`intent-memory/<owner>/<line>`, member `approvals`), so it is exported with the
// `intent-choices` family and deleted with the account. Signaling reads it in its own storage transaction (the
// approval check is local: no federation-shard call inside the account gate, SG-3). Records:
//   approvals: [{handler, feature, version, digest, at, autoConnect}]
// `handler` is the app's client_id, or for a provider feature the spec URL of its extension (`feature: true`).
import {plain} from '../core/strict-json.mjs';
import {getDomain} from '../../vendor/tldts/index.js';

/** Profiles registered by signaling §3.5 (a profile is added only by a revision of signaling). */
export const SESSION_PROFILES=Object.freeze(['data','webrtc']);
export const SESSION_BASES=Object.freeze(['self','pairing','offer']);
export const SESSION_PARTIES=Object.freeze(['self','other','any']);
const exactly=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
/** §20.1.1: `session` is exactly {v:1, parties, profiles} plus the optional `bases`. Both profiles take `{}`. */
export function sessionMemberValid(s){
 if(!exactly(s,['v','parties','profiles'],['bases'])||s.v!==1||!SESSION_PARTIES.includes(s.parties)||!plain(s.profiles))return false;
 const names=Object.keys(s.profiles);if(names.length<1||names.length>4||names.some(n=>!SESSION_PROFILES.includes(n)||!exactly(s.profiles[n],[])))return false;
 if(s.bases!==undefined&&!(Array.isArray(s.bases)&&s.bases.length>0&&new Set(s.bases).size===s.bases.length&&s.bases.every(b=>SESSION_BASES.includes(b))))return false;
 return true;
}
/** §20.1.1: a body with `session` also has effect join, capability false, no capability-format field, max_bytes at most
 * 2,048 and at most 8 data properties. Called by validateIntentKind on an otherwise valid body. */
export function sessionBodyValid(b){
 if(b.session===undefined)return true;
 if(!sessionMemberValid(b.session)||b.effect!=='join'||b.capability!==false||!Number.isSafeInteger(b.max_bytes)||b.max_bytes>2048)return false;
 const props=Object.values(b.data?.properties??{});
 return props.length<=8&&!props.some(f=>['capability','contact-link'].includes(f?.format));
}
export const isSessionKind=body=>plain(body)&&plain(body.session);
/** Whether the kind admits a party type: `own` true for an own-entity session (§3.4 `parties`). */
export const partiesAdmit=(body,{own})=>body.session.parties==='any'||(body.session.parties==='self')===(own===true);
/** Whether the kind allows a basis (`self`, `pairing` or `offer`); an absent `bases` allows every basis (§3.4). */
export const basisAllowed=(body,basis)=>body.session.bases===undefined||body.session.bases.includes(basis);
export const profileAllowed=(body,profile)=>Object.hasOwn(body.session.profiles,profile);

/** Whether `next` adds disclosure over `old` (intents §7.2): a new data property whose categories, or the kind's own
 * categories, include one the old version did not disclose. Re-approval and pairing re-confirmation follow from it. */
export function addsDisclosure(old,next){
 const categories=new Set([...old.disclosure.categories,...Object.values(old.disclosure.fields).flatMap(f=>f.categories)]);
 if(next.disclosure.categories.some(c=>!categories.has(c)))return true;
 return Object.entries(next.disclosure.fields).some(([name,f])=>!Object.hasOwn(old.data.properties,name)&&f.categories.some(c=>!categories.has(c)));
}
/** Projects a `context` valid under a newer version to an older one (§15): members the older data schema does not name
 * are dropped. The caller has verified additivity; the raw invite is delivered unchanged beside it. */
export function projectContext(context,targetBody){
 if(context===null)return null;
 return Object.fromEntries(Object.entries(context).filter(([k])=>Object.hasOwn(targetBody.data.properties,k)));
}

// ---- approval records (§20.1.4) ----------------------------------------------------------------------------------
export const MEMORY_PREFIX='intent-memory/';
/** The intents memory key of `line` for `owner` (packages/intents/router.mjs uses the same key for defaults). */
export const memoryKey=(owner,line)=>MEMORY_PREFIX+owner+'/'+encodeURIComponent(line);
/** The handler key of an actor: its client_id, or for a provider feature the spec URL of its extension. */
export const handlerOf=({clientId,feature=null})=>feature?{handler:feature,feature:true}:{handler:clientId,feature:false};
/** Whether an app handler (`client_id`) is excluded for the memory's kind line (intents §7.4: an exclusion names the
 * handler's registrable site, as the intents router compares it). §20.1.4: an excluded handler cannot be approved,
 * and (fail closed) an earlier approval of it admits nothing while the exclusion stands. */
export function handlerExcluded(memory,clientId){
 if(!plain(memory)||!Array.isArray(memory.excluded)||!memory.excluded.length)return false;
 let host;try{host=new URL(clientId).hostname;}catch{return true;}
 const site=getDomain(host,{allowPrivateDomains:true})??host;return memory.excluded.some(x=>x?.site===site);
}
const approvalValid=a=>plain(a)&&typeof a.handler==='string'&&typeof a.feature==='boolean'&&Number.isSafeInteger(a.version)&&a.version>=1&&typeof a.digest==='string'&&Number.isSafeInteger(a.at)&&typeof a.autoConnect==='boolean';
/** The approval of `handler` in a memory record, or null (malformed records approve nothing: fail closed). */
export function approvalIn(memory,{handler,feature}){
 if(!plain(memory)||!Array.isArray(memory.approvals))return null;
 return memory.approvals.find(a=>approvalValid(a)&&a.handler===handler&&a.feature===feature)??null;
}
/** A copy of `memory` with `approval` set for its handler (replacing any earlier one). */
export function withApproval(memory,line,approval){
 const m=plain(memory)?structuredClone(memory):{};m.kind??=line;
 m.approvals=[...(Array.isArray(m.approvals)?m.approvals.filter(a=>approvalValid(a)&&!(a.handler===approval.handler&&a.feature===approval.feature)):[]),{handler:approval.handler,feature:approval.feature,version:approval.version,digest:approval.digest,at:approval.at,autoConnect:approval.autoConnect===true}];
 return m;
}
/** A copy of `memory` without `handler`'s approval, and whether one was removed. */
export function withoutApproval(memory,{handler,feature}){
 if(!plain(memory)||!Array.isArray(memory.approvals))return {memory,removed:false};
 const kept=memory.approvals.filter(a=>!(approvalValid(a)&&a.handler===handler&&a.feature===feature));
 if(kept.length===memory.approvals.length)return {memory,removed:false};
 const m=structuredClone(memory);if(kept.length)m.approvals=kept;else delete m.approvals;return {memory:m,removed:true};
}
/** Every approval of one owner, as [{line, approval}] (owner listings, narrowing on connection end). */
export async function listApprovals(tx,owner){
 const out=[];for(const m of (await tx.list({prefix:MEMORY_PREFIX+owner+'/',limit:1024})).values())if(plain(m)&&typeof m.kind==='string'&&Array.isArray(m.approvals))for(const a of m.approvals)if(approvalValid(a))out.push({line:m.kind,approval:structuredClone(a)});
 return out;
}
