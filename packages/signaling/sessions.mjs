// Signaling session state machine, first claim, per-leg ordering and replay window, glare ranks and reference-host
// bounds (docs/spec/extensions/signaling.md §7.3, §8, §13.1). Pure value operations, no I/O and no storage: the service
// (./service.mjs) keeps the records in the entity's account writer and calls these inside its transactions.
// Provisional (coordinator), not signed off by the user; behind SIGNALING_ENABLED (default off). Appendix C.1
// sessions.mjs: kept, `ringing` renamed `pending`; replay state stores payload hashes only.
//
// Each provider keeps its own record of a session (§8.1): the initiator's provider an `out` record, the recipient's
// provider an `in` record. For an own-entity session both live in the one writer. States:
//
//   pending ──accept──────────────▶ connected ──end/cancel/control/expire──▶ ended
//      └──decline/cancel/timeout/control/expire/fail──────────────────────▶ ended
//
// `ended` is terminal: nothing leaves it, and a message for an ended session is ignored (§7.3).
//
// Ordering and replay (§7.3): per (session, leg) the receiver keeps the next expected `seq`, a buffer of at most 32
// messages ahead of a gap (at most 10 s), and the SHA-256 of the PAYLOAD BYTES (the received second JWS segment) of
// recently accepted `seq` values. A reused `seq` is a duplicate only when its payload bytes are identical, whatever its
// signature (ECDSA signatures are randomized, so a second signature over the same bytes is the same content); a
// re-serialized payload with equal JSON but different bytes is different content and ends the leg (`failed`).
// Signatures are never compared. The buffer holds compact messages only until they are in order (at most 10 s).
import {base64url,textEncoder,fromBase64url} from '../core/records.mjs';

export const SESSION_STATES=Object.freeze(['pending','connected','ended']);
export const END_REASONS=Object.freeze(['cancelled','declined','closed','timeout','expired','revoked','failed','blocked','moved']);
export const ORDER_LIMITS=Object.freeze({buffer:32,gapMs:10000,window:128,keepAfterEndMs:300000});
/** §1.2, §8.1: a session lives at most 24 h from its invite; `answer_by` is at most 120 s after it; records are kept at
 * most 24 h after the end (§12.4). */
export const SESSION_MAX_MS=86400000,ANSWER_MAX_MS=120000,RECORD_KEEP_MS=86400000;

export class SessionStateFault extends Error {constructor(code='signaling_illegal_transition',message=code){super(message);this.name='SessionStateFault';this.code=code;}}
const illegal=(from,event)=>{throw new SessionStateFault('signaling_illegal_transition',`${event} is not allowed in state ${from}`);};

// The transition table: event -> {from: [states], to}. Anything else is illegal. `claim` is the recipient side's first
// claim (accept connects, decline ends); `answer` is the initiator side receiving the recipient's seq 0 accept or decline.
const TABLE=Object.freeze({
 'claim-accept':{from:['pending'],to:'connected'},
 'claim-decline':{from:['pending'],to:'ended',reason:'declined'},
 'answer-accept':{from:['pending'],to:'connected'},
 'answer-decline':{from:['pending'],to:'ended',reason:'declined'},
 cancel:{from:['pending','connected'],to:'ended'},
 end:{from:['connected'],to:'ended',reason:'closed'},
 timeout:{from:['pending'],to:'ended',reason:'timeout'},
 expire:{from:['pending','connected'],to:'ended',reason:'expired'},
 control:{from:['pending','connected'],to:'ended'},
 revoke:{from:['pending','connected'],to:'ended',reason:'revoked'},
 fail:{from:['pending','connected'],to:'ended',reason:'failed'},
 block:{from:['pending'],to:'ended',reason:'blocked'},
});
export const SESSION_EVENTS=Object.freeze(Object.keys(TABLE));
/** Whether `event` may be applied in `state`. */
export const canTransition=(state,event)=>Object.hasOwn(TABLE,event)&&TABLE[event].from.includes(state);
/**
 * Applies one transition to a session record (mutating and returning it). Throws SessionStateFault for an illegal one.
 * `reason` overrides the table's reason (for `cancel` and `control`). A `cancel` of a connected session is processed as
 * `end` with `closed` (§8.4 "A cancel that crosses a claim"); before the claim it is `cancelled`.
 */
export function transition(record,event,{now,reason}={}){
 if(!record||!SESSION_STATES.includes(record.state))throw new SessionStateFault('signaling_invalid_record');
 if(!canTransition(record.state,event))illegal(record.state,event);
 const row=TABLE[event],from=record.state;record.state=row.to;
 if(row.to==='connected')record.connectedAt=now;
 if(row.to==='ended'){record.endedAt=now;record.endReason=reason??row.reason??(event==='cancel'?(from==='connected'?'closed':'cancelled'):'failed');}
 return record;
}
export const isLive=record=>record?.state==='pending'||record?.state==='connected';
/** A session's deadlines: pending ends at `answerBy`, every session at `endsAt` (24 h after the invite, §8.1). */
export function dueEvent(record,now){
 if(!isLive(record))return null;
 if(now>=record.endsAt)return 'expire';
 if(record.state==='pending'&&now>=record.answerBy)return 'timeout';
 return null;
}
/** Whether an ended record may be deleted: replay state is kept until end + 300 s, the record itself 24 h (§7.3, §12.4). */
export const recordExpired=(record,now)=>record?.state==='ended'&&now>=record.endedAt+RECORD_KEEP_MS;

// ---- first claim (§8.2) -------------------------------------------------------------------------------------------
/**
 * Whether a recorded claim can still be used (review L2): an accepted session that is still live, or a decline whose
 * message was not sent yet; a certificate is never minted again for a dead session.
 */
export const claimUsable=record=>record?.claim?.outcome==='accept'?isLive(record):record?.claim?.outcome==='decline'&&record.state==='ended'&&record.endReason==='declined'&&!record.declineSent;
/**
 * Decides one claim on an `in` record (mutating it): the first claim by an endpoint the invite was delivered to wins.
 * Returns {won:true, repeat} for the winner (repeat when the same endpoint claims again with the same leg key) or
 * {won:false, code}: `not_delivered` (the endpoint never got the invite) or `claimed` (another claim won, or the
 * session is no longer pending).
 */
export function decideClaim(record,{endpoint,jkt,outcome,now}){
 if(!record.delivered?.includes(endpoint))return {won:false,code:'not_delivered'};
 if(record.claim){const same=record.claim.endpoint===endpoint&&record.claim.jkt===jkt&&record.claim.outcome===outcome;return same&&claimUsable(record)?{won:true,repeat:true}:{won:false,code:'claimed'};}
 if(record.state!=='pending'||now>=record.answerBy||now>=record.endsAt)return {won:false,code:'claimed'};
 record.claim={endpoint,jkt,outcome,at:now};
 transition(record,outcome==='accept'?'claim-accept':'claim-decline',{now});
 return {won:true,repeat:false};
}

// ---- ordering and replay (§7.3) -----------------------------------------------------------------------------------
/** The payload segment of a compact JWS: the bytes "same content" compares. */
export const payloadSegment=compact=>typeof compact==='string'?compact.split('.')[1]??'':'';
/** base64url SHA-256 of the payload segment's bytes. */
export async function payloadDigest(compact,crypto=globalThis.crypto){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(payloadSegment(compact)))));}
export const newLeg=()=>({next:0,digests:{},buffer:{},gapSince:null,dataBytes:0});
/**
 * Offers one verified message (`seq`, its payload digest and compact form) to a leg's ordering state (mutating it).
 * Returns {action, ready}:
 *   'deliver'    seq was the next one; `ready` lists it and any buffered successors now in order ({seq, compact})
 *   'duplicate'  the same payload bytes for an already accepted or buffered seq: ignored
 *   'buffer'     ahead of a gap: kept (at most 32, at most 10 s; `gapExpired` decides the timeout)
 *   'fail'       a reused seq with different payload bytes, or a buffer overflow: the leg ends `failed`
 * A seq older than the digest window cannot be compared and is ignored as a duplicate (provisional reading, RTC-d).
 */
export function offerSeq(leg,{seq,digest,compact,now}){
 if(seq<leg.next){const seen=leg.digests[seq];return {action:seen===undefined||seen===digest?'duplicate':'fail',ready:[]};}
 if(seq>leg.next){
  const held=leg.buffer[seq];if(held)return {action:held.digest===digest?'duplicate':'fail',ready:[]};
  if(Object.keys(leg.buffer).length>=ORDER_LIMITS.buffer)return {action:'fail',ready:[]};
  leg.buffer[seq]={digest,compact,at:now};leg.gapSince??=now;return {action:'buffer',ready:[]};
 }
 const ready=[{seq,compact}];accept(leg,seq,digest);
 while(leg.buffer[leg.next]){const b=leg.buffer[leg.next];delete leg.buffer[leg.next];ready.push({seq:leg.next,compact:b.compact});accept(leg,leg.next,b.digest);}
 leg.gapSince=Object.keys(leg.buffer).length?leg.gapSince??now:null;
 return {action:'deliver',ready};
}
function accept(leg,seq,digest){
 leg.digests[seq]=digest;leg.next=seq+1;
 const old=seq-ORDER_LIMITS.window;if(old>=0)for(const k of Object.keys(leg.digests))if(Number(k)<=old)delete leg.digests[k];
}
/** True when a leg has waited on a gap longer than 10 s (the leg then ends `failed`, §7.3). */
export const gapExpired=(leg,now)=>leg?.gapSince!==null&&leg?.gapSince!==undefined&&now-leg.gapSince>ORDER_LIMITS.gapMs;

// ---- glare (§8.3; endpoint rule, SG-35) ---------------------------------------------------------------------------
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const compareBytes=(x,y)=>{for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return x.length===y.length?0:x.length<y.length?-1:1;};
/**
 * §8.3: the ranks of two crossing sessions from their initiator leg key thumbprints `a` and `b` (base64url `cnf.jkt` of
 * each session's verified initiator leg certificate): rank(a) = SHA-256("bindle-signaling-glare" ‖ a ‖ b), rank(b) =
 * SHA-256("bindle-signaling-glare" ‖ b ‖ a). Returns 'a' when the session whose initiator leg is `a` survives, 'b' when
 * the other does, and 'both-cancel' on equal ranks. Endpoints apply this; providers enforce nothing (no sid is used,
 * so the peer provider's sid choice cannot steer it).
 */
export async function glareSurvivor(a,b,crypto=globalThis.crypto){
 const label=textEncoder.encode('bindle-signaling-glare'),x=fromBase64url(a),y=fromBase64url(b);
 const ra=new Uint8Array(await crypto.subtle.digest('SHA-256',concat(label,x,y))),rb=new Uint8Array(await crypto.subtle.digest('SHA-256',concat(label,y,x)));
 const c=compareBytes(ra,rb);return c<0?'a':c>0?'b':'both-cancel';
}

// ---- bounds -----------------------------------------------------------------------------------------------------------
/**
 * Reference-host bounds (provider policy, provisional; §13.1, Appendix B RTC-11). `recipientPending` is the pending
 * capacity before the reserve; the reserve is split into a `self` share and a cross-entity share (`reserveSelf`,
 * `reserveCross`, §13.1 "Pending reserve"). Pairings together and open offers together each get at most half of pending
 * and connected capacity (`subBudgetShare`). `dataBytes` is the aggregate `data` budget per entity per `dataWindowMs`:
 * 256 KiB per hour, the same on every plan, as an abuse guard (owner-approved 2026-10-28; DEVLOG "Owner approvals and
 * directions (in session)"). Pairings take at most half of it. Its cost-model row stays a production gate (§3.5), and
 * organization and service-entity budgets are to be tiered by an organization plan (release gates, "Signaling").
 */
export const BOUNDS=Object.freeze({
 endpoints:32,endpointsPerApp:8,endpointIdleMs:30*86400000,initiatorOpen:8,recipientPending:4,reserveSelf:2,reserveCross:2,recipientConnected:8,subBudgetShare:0.5,
 queueEvents:256,queueBytes:524288,sensitiveMs:60000,blocks:1000,issuerBlocks:256,outbox:1024,delegateMs:86400000,fanout:16,listenWaitMs:25000,listenPage:64,
 outboxPeer:64,outboxControlReserve:128,outboxPeerControlReserve:16,controlReplies:4,inbox:256,inboxBytes:4194304,
 offersPerEntity:64,offersPerApp:32,offerUsesPerson:16,offerUsesService:10000,offerMinSeconds:10,offerPersonSeconds:900,offerServiceOpenSeconds:7776000,offerServiceBoundSeconds:604800,offerPrincipals:16,
 pairings:256,pairingPendingMs:7*86400000,pairingDefaultMs:90*86400000,pairingMaxMs:366*86400000,pairingLabel:64,ownPairingLive:2,
 onlineMs:60000,dataBytes:262144,dataWindowMs:3600000,
});
