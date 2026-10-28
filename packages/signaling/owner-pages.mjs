// Signaling owner pages: the server half of the provider pages that alone may record a widening owner action
// (docs/spec/extensions/signaling.md rev 3.2 §20.1.4 session handler approval, §5.8 pairing creation and activation,
// §4.3 service designation; docs/3sln/release-gates.md "Signaling", "Owner pages"). Provisional (coordinator), NOT
// signed off by the owner; behind SIGNALING_ENABLED and SESSION_KINDS_ENABLED (default off). Engine-first: the
// disclosures a page must show are computed here, from the engine's own records, and the page only renders them.
//
// A page first asks for a **review** (`signaling.review` {action, input}). The engine validates the change exactly as
// the widening operation will, computes the disclosure, and stores a single-use review record (`sig/review/<id>`)
// holding a digest of (owner, action, canonical input), `armAt` (creation + PAGE_REVIEW.dwellMs: the server floor
// under the page's armed control) and `expiresAt`. The widening operation then carries the review id as adapter
// evidence (`actor.review`, never from the input) and, when the service runs with `ownerPages` (the runtime turns it
// on; engine rule tests run without it), refuses with `review_required` unless a live review of the same owner,
// action and canonical input exists, and with `decision_not_armed` before `armAt` (nothing is consumed then). A
// successful operation deletes the review in the same transaction, so a review authorizes one owner action.
//
// Under `ownerPages` the page policy also asks for fresh authentication (adapter evidence `actor.freshAuth`) when a
// cross-entity pairing is activated, renewed or re-confirmed, as at its creation (§5.8 "Cross-entity creation"; the
// extension to activation and renewal is a provisional 3sln.me choice). Narrowing (removal, revocation, relabelling,
// shortening an expiry, turning auto-connect off, removing the designation) never needs a review (§14.1).
//
// The page URLs are on this provider's own origin (§20.1.4 "never a URL that the app supplies"): `approval_required`
// answers carry approvalPageURL for the app and kind that were refused.
import {AppFault} from '../app/faults.mjs';
import {base64url,digest} from '../core/records.mjs';
import {intentRisk} from '../intents/router.mjs';
import {addsDisclosure} from '../intents/sessions.mjs';

/** Review timing: the armed-control floor, the review lifetime, and the most live reviews an owner holds. */
export const PAGE_REVIEW=Object.freeze({dwellMs:1000,ttlMs:600000,max:32});
/** The widening owner actions a review can authorize. */
export const REVIEW_ACTIONS=Object.freeze(['session-approve','session-auto-connect','pairing-create','pairing-activate','pairing-update','set-service']);
export const REVIEW_PREFIX='sig/review/';
export const reviewKey=id=>REVIEW_PREFIX+id;
export const REVIEW_ID=/^rv_[A-Za-z0-9_-]{22}$/;
/** The console path that hosts the signaling owner pages (apps/web, view `signaling`). */
export const PAGE_PATH='/console';

const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const stable=v=>Array.isArray(v)?v.map(stable):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const ref=k=>({artefact:k.artefact,version:k.version,digest:k.digest});
const side=s=>({client_id:s.client_id,client_session:s.client_session??null});

/** A provider page URL on `issuer` (never app-supplied): /console?view=signaling&page=<page>&… */
export function ownerPageURL(issuer,page,params={}){
 const url=new URL(PAGE_PATH,issuer);url.searchParams.set('view','signaling');url.searchParams.set('page',page);
 for(const [key,value] of Object.entries(params))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
 return url.href;
}
/** The approval page for one app and kind line, as `approval_required` carries it (§20.1.4). */
export const approvalPageURL=(issuer,clientId,line)=>ownerPageURL(issuer,'approve',{client:clientId,kind:line});
/** An `approval_required` fault carrying the provider page URL for that app and kind line. */
export function approvalRequired(issuer,app,line,message='This kind is not approved for this application.'){
 const error=new AppFault('approval_required',message,403);
 if(!app?.feature&&typeof app?.clientId==='string'&&typeof line==='string')error.url=approvalPageURL(issuer,app.clientId,line);
 return error;
}

/** The members of an action's input that a review covers (labels of updates, `activate` and auto-connect on an
 * approval are chosen on the same page and are not part of the digest). */
export function canonicalInput(action,input){
 switch(action){
  case 'session-approve':return {clientId:input.clientId,kind:ref(input.kind)};
  case 'session-auto-connect':return {clientId:input.clientId,kind:input.kind,autoConnect:true};
  case 'pairing-create':return {kind:ref(input.kind),local:side(input.local),peer:input.peer.principal?{principal:{iss:input.peer.principal.iss,sub:input.peer.principal.sub}}:{self:side(input.peer.self)},opens:input.opens,label:input.label,expiresAt:input.expiresAt??null,created_via:input.created_via??'settings'};
  case 'pairing-activate':return {id:input.id,revision:input.revision};
  case 'pairing-update':return {id:input.id,revision:input.revision,...input.expiresAt!==undefined?{expiresAt:input.expiresAt}:{},...input.kind!==undefined?{kind:ref(input.kind)}:{}};
  case 'set-service':return {designated:true,revision:input.revision};
  default:fail('invalid_args','Unsupported signaling request.',400);
 }
}
export const reviewDigest=(crypto,owner,action,input)=>digest(crypto,JSON.stringify(['signaling-owner-review',owner,action,stable(input)]));

/** Stores a review record for (owner, action, canonical input); prunes expired ones and keeps at most PAGE_REVIEW.max. */
export async function storeReview(svc,actor,action,input){
 return svc.ownerTx(actor,async(tx,fx,owner,now)=>{
  const live=[];
  for(const [key,row] of await tx.list({prefix:REVIEW_PREFIX,limit:PAGE_REVIEW.max*4}))if(!(row?.expiresAt>now))await tx.delete(key);else live.push([key,row]);
  live.sort((a,b)=>a[1].createdAt-b[1].createdAt);while(live.length>=PAGE_REVIEW.max)await tx.delete(live.shift()[0]);
  const id='rv_'+base64url(svc.random.bytes(16));
  const record={v:1,id,owner,action,digest:await reviewDigest(svc.crypto,owner,action,input),createdAt:now,armAt:now+PAGE_REVIEW.dwellMs,expiresAt:now+PAGE_REVIEW.ttlMs};
  await tx.put(reviewKey(id),record);return record;
 });
}
/**
 * Consumes the review that authorizes this widening action, inside the operation's own transaction. Only under
 * `svc.ownerPages`. Refuses with `review_required` (no matching live review) or `decision_not_armed` (too early; the
 * review stays). Deleting it here means a failed operation (rolled back) leaves the review usable.
 */
export async function takeReview(svc,tx,actor,action,input,now){
 if(svc.ownerPages!==true)return;
 const id=actor?.review;if(typeof id!=='string'||!REVIEW_ID.test(id))fail('review_required','Review this change on its page, then confirm.',409);
 const record=await tx.get(reviewKey(id));
 if(!record||record.owner!==actor.owner||record.action!==action||!(record.expiresAt>now)||record.digest!==await reviewDigest(svc.crypto,actor.owner,action,canonicalInput(action,input)))fail('review_required','Review this change on its page, then confirm.',409);
 if(now<record.armAt)fail('decision_not_armed','Wait until the button is ready, then confirm.',409);
 await tx.delete(reviewKey(id));
}

// ---- disclosures ------------------------------------------------------------------------------------------------------
/** What a page shows about a kind version (intents §7.1 items 1 and 2, §20.1.4): its title and summary attributed to the
 * host of its line (never the publisher), whether this provider reviewed it, the effect, the categories of the kind
 * and of its fields, `parties`, the profiles and the bases. Session kinds are app-published, so `reviewed` is false. */
export function kindView(body,k){
 const fields=Object.entries(body.disclosure.fields).map(([name,f])=>({name,title:structuredClone(f.title),categories:[...f.categories]}));
 let host=null;try{host=new URL(k.artefact).host;}catch{host=null;}
 return {artefact:k.artefact,version:k.version,digest:k.digest,host,title:structuredClone(body.title),summary:body.summary?structuredClone(body.summary):null,reviewed:false,effect:body.effect,
  categories:[...new Set([...body.disclosure.categories,...fields.flatMap(f=>f.categories)])],fields,parties:body.session.parties,profiles:Object.keys(body.session.profiles).sort(),bases:body.session.bases?[...body.session.bases]:null};
}
/** The intents risk tier of a kind for a handler (every data field counted as present; a kind described by the
 * handler's own site raises it, intents §7.1 item 1). */
export function kindRisk(body,clientId){return intentRisk(body,Object.fromEntries(Object.keys(body.data.properties).map(k=>[k,true])),clientId?[{id:clientId}]:[]);}
/** The effect wording inputs of a pairing (§5.8: "from the kind's profiles and sensitivity categories"). */
export function pairingEffect(body){return {direct:Object.hasOwn(body.session.profiles,'webrtc'),data:Object.hasOwn(body.session.profiles,'data'),categories:kindView(body,{artefact:body.id,version:0,digest:''}).categories};}
const originOf=v=>{try{return new URL(v).origin;}catch{return null;}};
export const appView=s=>({client_id:s.client_id,client_session:s.client_session??null,origin:originOf(s.client_id)});
/** A peer principal as a page may show it: the handle only when this provider holds a verified binding (keys.handle),
 * otherwise the full principal and its issuer's origin, never an app-supplied name (§5.8). */
export async function peerView(svc,principal){
 let handle=null;try{const h=await svc.keys.handle?.({iss:principal.iss,sub:principal.sub});handle=typeof h==='string'&&h?h:null;}catch{handle=null;}
 return {principal:{iss:principal.iss,sub:principal.sub},issuerOrigin:originOf(principal.iss),handle,sameProvider:principal.iss===svc.issuer};
}
/** Whether a newer held version of a pairing's kind is additive from its pinned version, and adds disclosure (§5.8
 * "Kind versions": re-confirmation). */
export async function newerKind(svc,pinned){
 let latest=null;for(let v=pinned.version+1;v<=pinned.version+64;v++){const next=await svc.versionBody(pinned.artefact,v);if(!next)break;latest=next;}
 if(!latest||!await svc.additive(pinned,latest.ref))return null;
 const old=await svc.heldKind(pinned);return {kind:kindView(latest.body,latest.ref),addsDisclosure:old?addsDisclosure(old,latest.body):true};
}
/** The newest held version of a kind line (versions 1 to 64), or null. */
export async function latestHeld(svc,line){let best=null;for(let v=1;v<=64;v++){const next=await svc.versionBody(line,v);if(next)best=next;else if(best)break;}return best;}
export {addsDisclosure};
