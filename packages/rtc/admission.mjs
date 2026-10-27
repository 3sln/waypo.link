// RTC-d: admission at the callee provider (docs/spec/rtc-signaling.md §4.2–§4.4, §12, §13; design §3.1, §3.4, RTC-11).
// Bases, owner policy, block and mute, fixed-window limits and fan-out eligibility, as functions over one account
// writer's transaction `tx` ({get, put, delete, list({prefix, limit, startAfter}) -> Map}). Provisional (coordinator),
// not signed off by the user; behind RTC_SIGNALING_ENABLED (default off).
//
// No presence oracle (§12): every admission outcome after the batch's shape check is silent. Nothing here returns an
// answer the caller or its provider can observe; the service answers the batch identically whatever is decided, and
// `open` succeeds alike. Limits are keyed by a SHA-256 of what they count, so a limit row reveals no more than the
// limit needs, and expires with its window.
import {digest} from '../core/records.mjs';
import {principalKey} from '../orgs/grants.mjs';
import {IP_POLICIES} from './messages.mjs';
import {RTC_BOUNDS} from './sessions.mjs';

export const POLICY_KEY='rtc/policy';
export const K=Object.freeze({
 policy:POLICY_KEY,
 endpoint:id=>`rtc/ep/${id}`,endpointPrefix:'rtc/ep/',
 queue:(id,seq)=>`rtc/epq/${id}/${String(seq).padStart(12,'0')}`,queuePrefix:id=>`rtc/epq/${id}/`,
 out:sid=>`rtc/out/${sid}`,outPrefix:'rtc/out/',
 in:(caller,sid)=>`rtc/in/${principalKey(caller)}/${sid}`,inPrefix:'rtc/in/',
 delivered:(endpoint,sid)=>`rtc/dlv/${endpoint}/${sid}`,deliveredPrefix:endpoint=>`rtc/dlv/${endpoint}/`,
 delegate:jkt=>`rtc/dlg/${jkt}`,delegatePrefix:'rtc/dlg/',
 ticket:jti=>`rtc/ticket/${jti}`,ticketPrefix:'rtc/ticket/',
 contact:parent=>`rtc/contact/${encodeURIComponent(parent)}`,contactPrefix:'rtc/contact/',
 block:p=>`rtc/block/${principalKey(p)}`,blockPrefix:'rtc/block/',
 // Wargame M6: an owner-level block of a whole caller provider (issuer origin). Not under blockPrefix.
 issuerBlock:iss=>`rtc/block-iss/${encodeURIComponent(iss)}`,issuerBlockPrefix:'rtc/block-iss/',
 mute:(kind,value)=>`rtc/mute/${kind}/${encodeURIComponent(value)}`,mutePrefix:'rtc/mute/',
 missed:(at,id)=>`rtc/missed/${String(at).padStart(16,'0')}/${id}`,missedPrefix:'rtc/missed/',
 limit:(name,hash)=>`rtc/limit/${name}/${hash}`,limitPrefix:'rtc/limit/',
 // Outbox rows are keyed per peer (review M3), so a drain pass pages past a held peer and one failing peer never
 // stalls the others; `rtc/outbox-seq` holds {seq, count}. The inbound queue (review M2) holds step-1-valid batches.
 outbox:(peer,seq)=>`rtc/outbox/${principalKey(peer)}/${String(seq).padStart(12,'0')}`,outboxPeerPrefix:peer=>`rtc/outbox/${principalKey(peer)}/`,outboxPrefix:'rtc/outbox/',outboxSeq:'rtc/outbox-seq',
 inbox:seq=>`rtc/inq/${String(seq).padStart(12,'0')}`,inboxPrefix:'rtc/inq/',inboxMeta:'rtc/inq-meta',
 aep:p=>`rtc/aep/${principalKey(p)}`,aepPrefix:'rtc/aep/',
});

// ---- owner policy (§4.2 `none`, §4.4 auto-accept, §10 IP policy) ----------------------------------------------------
/** Defaults: relay-only for other entities (RTC-6), direct (`all`) for own devices, no requests, no auto-accept. */
export const DEFAULT_POLICY=Object.freeze({v:1,other:'relay',self:'all',requests:Object.freeze([]),autoAccept:Object.freeze({})});
export async function readPolicy(tx){const p=await tx.get(POLICY_KEY);return p?.v===1?p:structuredClone(DEFAULT_POLICY);}
/** The sender's IP policy for one session: `other` cross-entity (relay or public; `all` never applies cross-entity),
 * `self` for own devices. */
export const ipPolicyFor=(policy,{crossEntity})=>crossEntity?(policy.other==='public'?'public':'relay'):(IP_POLICIES.includes(policy.self)?policy.self:'all');
/** Whether `next` widens `prior`: a more permissive IP policy, new request purposes, new auto-accept entries. */
export function policyWidens(prior,next){
 const rank={relay:0,public:1,all:2};if(rank[next.other]>rank[prior.other]||rank[next.self]>rank[prior.self])return true;
 if(next.requests.some(l=>!prior.requests.includes(l)))return true;
 return Object.entries(next.autoAccept).some(([client,lines])=>lines.some(l=>!(prior.autoAccept[client]??[]).includes(l)));
}

// ---- block and mute (§13) ------------------------------------------------------------------------------------------
// Wargame M6 (2026-10-27; provisional, unsigned): besides an origin principal, an owner can block or mute a whole
// caller provider (`issuer`, an origin: an allowlisted issuer can mint principals at will) and mute a calling app by its
// origin (`origin`; the caller leg certificate's client.origin, certified by the caller's provider). Own-entity rule:
// this host's own issuer can never be blocked or muted as a provider (the service refuses it: every own-device session
// is same-issuer, and this host's principals are real accounts, blocked one by one), and an invite from the owner's own
// entity is never blocked (by principal or provider) or muted by provider or app origin here, whatever is stored, so
// a block can never break own-device sessions. A blocked provider's invites are dropped at the same step, silently,
// exactly like a blocked principal's (§12 no presence oracle).
export const ISSUER_BLOCKS_MAX=256;
const samePrincipal=(a,b)=>Boolean(a&&b)&&a.iss===b.iss&&a.sub===b.sub;
/** Whether an invite from `principal` is dropped; `self` (the owner's own principal) is never blocked. */
export const isBlocked=async(tx,principal,{self}={})=>!samePrincipal(principal,self)&&Boolean(await tx.get(K.block(principal))||principal.iss!==self?.iss&&await tx.get(K.issuerBlock(principal.iss)));
/** A block target from owner input: exactly `{principal}` or `{issuer}`, or null. `validPrincipal` and `validOrigin`
 * are the service's validators; `issuer` is this host's own issuer, which is never a provider block target. */
export function blockTarget(input,{issuer,validPrincipal,validOrigin}){
 const keys=input!==null&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input):[];if(keys.length!==1)return null;
 if(keys[0]==='principal')return validPrincipal(input.principal)?{principal:{iss:input.principal.iss,sub:input.principal.sub}}:null;
 if(keys[0]==='issuer')return typeof input.issuer==='string'&&validOrigin(input.issuer)&&input.issuer!==issuer?{issuer:input.issuer}:null;
 return null;
}
export const blockKey=target=>target.issuer!==undefined?K.issuerBlock(target.issuer):K.block(target.principal);
/** Whether a stored session's caller falls under `target`. */
export const blockCovers=(target,caller)=>target.issuer!==undefined?caller?.iss===target.issuer:samePrincipal(caller,target.principal);
/** Stores `target` (idempotent). Returns false, storing nothing, when its table is full (principals: `principalMax`;
 * providers: ISSUER_BLOCKS_MAX). */
export async function putBlock(tx,target,now,{principalMax}){
 const key=blockKey(target);if(await tx.get(key))return true;
 const [prefix,max]=target.issuer!==undefined?[K.issuerBlockPrefix,ISSUER_BLOCKS_MAX]:[K.blockPrefix,principalMax];
 if((await tx.list({prefix,limit:max})).size>=max)return false;
 await tx.put(key,target.issuer!==undefined?{issuer:target.issuer,at:now}:{principal:target.principal,at:now});return true;
}
export async function issuerBlocks(tx){return [...(await tx.list({prefix:K.issuerBlockPrefix,limit:ISSUER_BLOCKS_MAX})).values()].map(r=>({issuer:r.issuer,at:r.at}));}
/** Mute kinds: a principal, a purpose line, an application (client_id), a caller provider (issuer origin) or a calling
 * app origin. */
export const MUTE_KINDS=Object.freeze(['principal','purpose','app','issuer','origin']);
/** The kinds whose value the caller's provider asserts (the leg certificate's client), scoped by provider (review R3). */
export const SCOPED_MUTE_KINDS=Object.freeze(['app','origin']);
export const muteValue=(kind,value)=>kind==='principal'?principalKey(value):String(value);
/**
 * Wargame review R3 (provisional): a caller leg certificate's `client.client_id` and `client.origin` are only what the
 * caller's provider asserts. A foreign provider could present a genuine app's origin or client_id, get the owner to mute
 * it, and so silence that app for every caller. So an `app` or `origin` mute is scoped to the provider that asserted it:
 * `scope` is the caller's issuer for a foreign caller (key kind `app@` / `origin@`, value [issuer, value]), and null for
 * this host, which certified its own callers' clients (the unscoped key). An unscoped row applies to same-host callers
 * only; stored rows from before this rule (RTC flags have never been on) therefore keep meaning this host.
 */
export const muteKey=(kind,value,scope=null)=>scope&&SCOPED_MUTE_KINDS.includes(kind)?K.mute(kind+'@',JSON.stringify([scope,String(value)])):K.mute(kind,muteValue(kind,value));
/** `origin` is the caller certificate's client.origin; `own` marks an invite from the owner's own entity, which provider
 * and app-origin mutes never silence (wargame M6); `issuer` is this host's issuer (review R3: app and origin mutes are
 * looked up in the caller's provider scope). */
export async function isMuted(tx,{principal,purpose,clientId,origin,own=false,issuer}){
 if(await tx.get(K.mute('principal',principalKey(principal)))||await tx.get(K.mute('purpose',purpose)))return true;
 const scope=principal.iss===issuer?null:principal.iss;
 if(typeof clientId==='string'&&await tx.get(muteKey('app',clientId,scope)))return true;
 if(own)return false;
 return Boolean(scope!==null&&await tx.get(K.mute('issuer',principal.iss))||typeof origin==='string'&&await tx.get(muteKey('origin',origin,scope)));
}

// ---- fixed-window limits (§13, RTC-11) -----------------------------------------------------------------------------
const MIN=60000,HOUR=3600000;
/** RTC-11 reference values: {max, windowMs} per limit name. */
export const LIMITS=Object.freeze({
 pair:{max:6,windowMs:10*MIN},caller:{max:30,windowMs:HOUR},issuerCallee:{max:20,windowMs:HOUR},issuerParent:{max:60,windowMs:HOUR},
 callee:{max:60,windowMs:HOUR},opens:{max:60,windowMs:HOUR},leg:{max:256,windowMs:MIN},
 // RTC-e verification follow-ups (provisional): caller-initiated directory fetches (`warm` at `open`) per owner, spent
 // before any directory budget and only when the foreign callee's keys are not already held.
 warms:{max:20,windowMs:HOUR},
 // RTC wargame M1 (provisional): own-device (`self` basis) invites have their own budget per entity, outside every
 // cross-entity window, so no other caller can spend it.
 self:{max:120,windowMs:HOUR},
 // RTC wargame review R2 (provisional): principal-bound ticket invites (callback tickets included) have their own
 // per-callee window, outside `callee` and the issuer windows, so bearer-link callers cannot exhaust it; and every
 // same-host bearer-link caller together spends at most `sameHost` of this callee's `callee` window, so foreign callers
 // keep headroom (20 of 60 per hour).
 preferred:{max:60,windowMs:HOUR},sameHost:{max:40,windowMs:HOUR},
 // Review I5 (provisional): `mint_ticket` per application per account. Above the per-app ticket quota (64), so an app
 // can still fill its quota in one burst (pairing), but cannot churn short-lived tickets without bound.
 mint:{max:120,windowMs:HOUR},
});
const limitHash=(name,parts,crypto)=>digest(crypto,JSON.stringify([name,...parts]));
/**
 * Counts one event against each named limit atomically: returns true and increments every counter only when all are
 * under their maximum; otherwise returns false and changes nothing. `items` is [{name, parts}].
 */
export async function takeLimits(tx,items,now,crypto=globalThis.crypto){
 const rows=[];
 for(const {name,parts} of items){const l=LIMITS[name],key=K.limit(name,await limitHash(name,parts,crypto)),row=await tx.get(key);const live=row&&row.resetAt>now?row:{count:0,resetAt:now+l.windowMs};if(live.count>=l.max)return false;rows.push([key,live]);}
 for(const [key,row] of rows)await tx.put(key,{count:row.count+1,resetAt:row.resetAt});
 return true;
}
/** Review I1: a read-only pre-check: false when any named limit is already at its maximum (nothing is written). A cheap
 * early drop before the costlier local checks; `takeLimits` still decides atomically. */
export async function limitsOpen(tx,items,now,crypto=globalThis.crypto){
 for(const {name,parts} of items){const l=LIMITS[name],row=await tx.get(K.limit(name,await limitHash(name,parts,crypto)));if(row&&row.resetAt>now&&row.count>=l.max)return false;}
 return true;
}
/** Deletes limit rows whose window has passed (bounded per call). Returns the number deleted. */
export async function pruneLimits(tx,now,budget=512){let n=0;for(const [key,row] of await tx.list({prefix:K.limitPrefix,limit:budget}))if(!(row?.resetAt>now)){await tx.delete(key);n++;}return n;}

// ---- bases (§4.2) --------------------------------------------------------------------------------------------------
/** The wire basis kind of an invite: `self` (own entity, null basis), `link` (a link digest) or `request` (none). */
export const basisKind=(body,{ownEntity})=>body.basis!==null?'link':ownEntity?'self':'request';
/** Whether an alerting invite is allowed (§4.4): the purpose alerts, the basis is self or link, and no mute applies. */
export const alertAllowed=({purposeBody,basis,muted,quarantined})=>purposeBody.alert===true&&(basis==='self'||basis==='link')&&!muted&&!quarantined;

/**
 * RTC wargame M1 and review R2 (provisional): the §13 windows one admitted invite counts against.
 * - A `self` invite counts only against the entity's own `self` budget.
 * - A `preferred` invite (a principal-bound ticket, callback tickets included: the owner named that caller) counts
 *   against the pair and caller windows, its ticket's parent window and its own per-callee `preferred` window, never
 *   against `callee` or the (issuer, callee) window, so bearer-link callers cannot use those up to drop it.
 * - Otherwise a same-host caller's (issuer, callee) and (issuer, parent) windows are per-principal shares (this host's
 *   principals are verified accounts), and all same-host callers together are capped by the per-callee `sameHost`
 *   window (40 of `callee`'s 60), so a few same-host accounts cannot exhaust `callee` for foreign callers. A foreign
 *   issuer's windows stay issuer-wide.
 */
export function inviteLimits({sender,issuer,own,parent,preferred=false}){
 if(own)return [{name:'self',parts:[]}];
 const same=sender.iss===issuer,share=same?[sender.iss,sender.sub]:[sender.iss];
 const items=[{name:'pair',parts:[sender.iss,sender.sub]},{name:'caller',parts:[sender.iss,sender.sub]}];
 if(preferred)items.push({name:'preferred',parts:[]});
 else{items.push({name:'issuerCallee',parts:share},{name:'callee',parts:[]});if(same)items.push({name:'sameHost',parts:[]});}
 if(parent)items.push({name:'issuerParent',parts:[...share,parent]});
 return items;
}

// ---- fan-out eligibility (§7.2) ------------------------------------------------------------------------------------
/** Live, unexpired endpoints registered for `line`, most recently active first, excluding `exclude`. */
export async function candidateEndpoints(tx,{line,exclude,now}){
 const out=[];for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints+1})).values())if(ep&&ep.id!==exclude&&ep.expiresAt>now&&ep.purposes.includes(line))out.push(ep);
 return out.sort((a,b)=>b.lastSeen-a.lastSeen||(a.id<b.id?-1:1));
}
/**
 * RTC wargame M3 (provisional): the fan-out order over eligible endpoints (already most recently active first): at most
 * RTC_BOUNDS.endpointsPerApp per application, round-robin across applications so one application's endpoints never
 * crowd out another's, the caller's own application (`prefer`, the caller certificate's client_id) first in each round,
 * then the others by their most recently active endpoint. At most `max`. Review I2: the caller passes `prefer` only for
 * a same-host caller (a foreign certificate's client_id is only what its provider asserts).
 */
export function fanoutOrder(endpoints,{prefer=null,max=RTC_BOUNDS.fanout}={}){
 const groups=new Map();for(const ep of endpoints){const g=groups.get(ep.clientId)??[];if(g.length<RTC_BOUNDS.endpointsPerApp)g.push(ep);groups.set(ep.clientId,g);}
 const order=[...groups.keys()].sort((a,b)=>(a===prefer?-1:b===prefer?1:0));
 const out=[];for(let i=0;out.length<max;i++){let any=false;for(const c of order){const ep=groups.get(c)[i];if(ep){any=true;if(out.length<max)out.push(ep);}}if(!any)break;}
 return out;
}
