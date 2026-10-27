// RTC-d: the session state machine, first claim and the per-leg ordering and replay window (docs/spec/rtc-signaling.md
// §6.4, §7; design docs/architecture/rtc-signaling.md §3.1, §3.4). Pure value operations, no I/O and no storage: the
// service (./service.mjs) keeps the records in the entity's account writer and calls these inside its transactions.
// Provisional (coordinator), not signed off by the user; behind RTC_SIGNALING_ENABLED (default off).
//
// Each provider keeps its own record of a session (§7.1): the caller's provider an `out` record, the callee's provider
// an `in` record. For an own-entity session both live in the one writer. States:
//
//   ringing ──accept──────────────▶ connected ──end/cancel/control/expire──▶ ended
//      └──decline/cancel/timeout/control/expire/fail──────────────────────▶ ended
//
// `ended` is terminal: nothing leaves it, and a message for an ended session is ignored (§6.4).
//
// Ordering and replay (§6.4; design §8.1 "Interfaces left for RTC-d onward"): per (session, leg) the receiver keeps the
// next expected `seq`, a buffer of at most 32 messages ahead of a gap (at most 10 s), and the SHA-256 of the PAYLOAD
// BYTES (the received second JWS segment) of recently accepted `seq` values. A reused `seq` is a duplicate only when its
// payload bytes are identical, whatever its signature (ECDSA signatures are randomized, so a second signature over the
// same bytes is the same content); a re-serialized payload with equal JSON but different bytes is different content
// and ends the leg (`failed`). Signatures are never compared.
import {base64url,textEncoder} from '../core/records.mjs';

export const SESSION_STATES=Object.freeze(['ringing','connected','ended']);
export const END_REASONS=Object.freeze(['cancelled','declined','hangup','timeout','expired','revoked','failed','blocked','moved']);
export const ORDER_LIMITS=Object.freeze({buffer:32,gapMs:10000,window:128,keepAfterEndMs:300000});
export const SESSION_MAX_MS=86400000,RING_MAX_MS=120000,RECORD_KEEP_MS=86400000;

export class RtcStateFault extends Error {constructor(code='rtc_illegal_transition',message=code){super(message);this.name='RtcStateFault';this.code=code;}}
const illegal=(from,event)=>{throw new RtcStateFault('rtc_illegal_transition',`${event} is not allowed in state ${from}`);};

// The transition table: event -> {from: [states], to}. Anything else is illegal. `claim` is the callee side's first
// claim (accept connects, decline ends); `answer` is the caller side receiving the callee's seq 0 accept or decline.
const TABLE=Object.freeze({
 'claim-accept':{from:['ringing'],to:'connected'},
 'claim-decline':{from:['ringing'],to:'ended',reason:'declined'},
 'answer-accept':{from:['ringing'],to:'connected'},
 'answer-decline':{from:['ringing'],to:'ended',reason:'declined'},
 cancel:{from:['ringing','connected'],to:'ended'},
 end:{from:['connected'],to:'ended',reason:'hangup'},
 timeout:{from:['ringing'],to:'ended',reason:'timeout'},
 expire:{from:['ringing','connected'],to:'ended',reason:'expired'},
 control:{from:['ringing','connected'],to:'ended'},
 revoke:{from:['ringing','connected'],to:'ended',reason:'revoked'},
 fail:{from:['ringing','connected'],to:'ended',reason:'failed'},
 block:{from:['ringing'],to:'ended',reason:'blocked'},
});
export const SESSION_EVENTS=Object.freeze(Object.keys(TABLE));
/** Whether `event` may be applied in `state`. */
export const canTransition=(state,event)=>Object.hasOwn(TABLE,event)&&TABLE[event].from.includes(state);
/**
 * Applies one transition to a session record (mutating and returning it). Throws RtcStateFault for an illegal one.
 * `reason` overrides the table's reason (for `cancel` and `control`). A `cancel` of a connected session is processed as
 * `end` with `hangup` (§7.4 crossing cancel and answer); before the claim it is `cancelled`.
 */
export function transition(record,event,{now,reason}={}){
 if(!record||!SESSION_STATES.includes(record.state))throw new RtcStateFault('rtc_invalid_record');
 if(!canTransition(record.state,event))illegal(record.state,event);
 const row=TABLE[event],from=record.state;record.state=row.to;
 if(row.to==='connected')record.connectedAt=now;
 if(row.to==='ended'){record.endedAt=now;record.endReason=reason??row.reason??(event==='cancel'?(from==='connected'?'hangup':'cancelled'):'failed');}
 return record;
}
export const isLive=record=>record?.state==='ringing'||record?.state==='connected';
/** A session's deadlines: ringing ends at `ringUntil`, every session at `endsAt` (24 h after the invite, §7.1). */
export function dueEvent(record,now){
 if(!isLive(record))return null;
 if(now>=record.endsAt)return 'expire';
 if(record.state==='ringing'&&now>=record.ringUntil)return 'timeout';
 return null;
}
/** Whether an ended record may be deleted: replay state is kept until end + 300 s, the record itself 24 h (§6.4, §12). */
export const recordExpired=(record,now)=>record?.state==='ended'&&now>=record.endedAt+RECORD_KEEP_MS;

// ---- first claim (§7.2) -------------------------------------------------------------------------------------------
/**
 * Decides one claim on an `in` record (mutating it): the first claim by an endpoint the invite was delivered to wins.
 * Returns {won:true, repeat} for the winner (repeat when the same endpoint claims again with the same leg key, so a
 * lost answer can be retried) or {won:false, code}. `code` is `not_delivered` (the endpoint never got the invite),
 * `claimed` (another claim won, or the session is no longer ringing). A repeat is allowed only while the claim can
 * still be used (review L2): an accepted session that is still live, or a decline whose message was not sent yet; a
 * certificate is never minted again for a dead session.
 */
export const claimUsable=record=>record?.claim?.outcome==='accept'?isLive(record):record?.claim?.outcome==='decline'&&record.state==='ended'&&record.endReason==='declined'&&!record.declineSent;
export function decideClaim(record,{endpoint,jkt,outcome,now}){
 if(!record.delivered?.includes(endpoint))return {won:false,code:'not_delivered'};
 if(record.claim){const same=record.claim.endpoint===endpoint&&record.claim.jkt===jkt&&record.claim.outcome===outcome;return same&&claimUsable(record)?{won:true,repeat:true}:{won:false,code:'claimed'};}
 if(record.state!=='ringing'||now>=record.ringUntil||now>=record.endsAt)return {won:false,code:'claimed'};
 record.claim={endpoint,jkt,outcome,at:now};
 transition(record,outcome==='accept'?'claim-accept':'claim-decline',{now});
 return {won:true,repeat:false};
}

// ---- ordering and replay (§6.4) -----------------------------------------------------------------------------------
/** The payload segment of a compact JWS: the bytes "same content" compares. */
export const payloadSegment=compact=>typeof compact==='string'?compact.split('.')[1]??'':'';
/** base64url SHA-256 of the payload segment's bytes. */
export async function payloadDigest(compact,crypto=globalThis.crypto){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(payloadSegment(compact)))));}
export const newLeg=()=>({next:0,digests:{},buffer:{},gapSince:null});
/**
 * Offers one verified message (`seq`, its payload digest and compact form) to a leg's ordering state (mutating it).
 * Returns {action, ready}:
 *   'deliver'    seq was the next one; `ready` lists it and any buffered successors now in order ({seq, compact})
 *   'duplicate'  the same payload bytes for an already accepted or buffered seq: ignored
 *   'buffer'     ahead of a gap: kept (at most 32, at most 10 s; `gapExpired` decides the timeout)
 *   'fail'       a reused seq with different payload bytes, or a buffer overflow: the leg ends `failed`
 * A seq older than the digest window cannot be compared and is ignored as a duplicate: it can never be processed
 * again (the window is ORDER_LIMITS.window seqs; provisional reading, DEVLOG RTC-d).
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
/** True when a leg has waited on a gap longer than 10 s (the leg then ends `failed`, §6.4). */
export const gapExpired=(leg,now)=>leg?.gapSince!==null&&leg?.gapSince!==undefined&&now-leg.gapSince>ORDER_LIMITS.gapMs;

// ---- bounds ---------------------------------------------------------------------------------------------------------
/** Design §3.4 / RTC-11 reference-host bounds (provider policy, provisional). */
export const RTC_BOUNDS=Object.freeze({
 endpoints:32,endpointIdleMs:30*86400000,callerOpen:8,calleeRinging:4,calleeConnected:8,
 queueEvents:256,queueBytes:524288,sensitiveMs:60000,missed:100,missedMs:30*86400000,blocks:1000,mutes:256,
 contactPurposes:16,tickets:256,outbox:1024,delegateMs:86400000,fanout:16,heldRequests:32,listenWaitMs:25000,listenPage:64,
 // Review M3: per-peer outbox rows, the share of both caps kept for control statements (message batches stop short of
 // it), and control replies (`failed` for a late or extra callee leg) per session. Review M2: the inbound queue.
 outboxPeer:64,outboxControlReserve:128,outboxPeerControlReserve:16,controlReplies:4,inbox:256,inboxBytes:4194304,
 // RTC wargame (provisional): live endpoints per application within `endpoints` (M3); ringing capacity kept above
 // `calleeRinging` for `self` and principal-bound ticket invites (M1, §13 SHOULD); missed rows per (caller, purpose,
 // kind) are folded into one (L2).
 endpointsPerApp:8,calleeRingingReserve:2,
});
