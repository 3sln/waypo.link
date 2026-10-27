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
export const isBlocked=async(tx,principal)=>Boolean(await tx.get(K.block(principal)));
/** Mute kinds: a principal, a purpose line or an application (client_id). */
export const MUTE_KINDS=Object.freeze(['principal','purpose','app']);
export const muteValue=(kind,value)=>kind==='principal'?principalKey(value):String(value);
export async function isMuted(tx,{principal,purpose,clientId}){
 return Boolean(await tx.get(K.mute('principal',principalKey(principal)))||await tx.get(K.mute('purpose',purpose))||clientId!==undefined&&await tx.get(K.mute('app',clientId)));
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
/** Deletes limit rows whose window has passed (bounded per call). Returns the number deleted. */
export async function pruneLimits(tx,now,budget=512){let n=0;for(const [key,row] of await tx.list({prefix:K.limitPrefix,limit:budget}))if(!(row?.resetAt>now)){await tx.delete(key);n++;}return n;}

// ---- bases (§4.2) --------------------------------------------------------------------------------------------------
/** The wire basis kind of an invite: `self` (own entity, null basis), `link` (a link digest) or `request` (none). */
export const basisKind=(body,{ownEntity})=>body.basis!==null?'link':ownEntity?'self':'request';
/** Whether an alerting invite is allowed (§4.4): the purpose alerts, the basis is self or link, and no mute applies. */
export const alertAllowed=({purposeBody,basis,muted,quarantined})=>purposeBody.alert===true&&(basis==='self'||basis==='link')&&!muted&&!quarantined;

// ---- fan-out eligibility (§7.2) ------------------------------------------------------------------------------------
/** Live, unexpired endpoints registered for `line`, most recently active first, excluding `exclude`. */
export async function candidateEndpoints(tx,{line,exclude,now}){
 const out=[];for(const ep of (await tx.list({prefix:K.endpointPrefix,limit:RTC_BOUNDS.endpoints+1})).values())if(ep&&ep.id!==exclude&&ep.expiresAt>now&&ep.purposes.includes(line))out.push(ep);
 return out.sort((a,b)=>b.lastSeen-a.lastSeen||(a.id<b.id?-1:1));
}
