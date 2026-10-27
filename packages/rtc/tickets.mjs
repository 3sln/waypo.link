// RTC-a: the `rtc-ticket/v1` link type's meta payload codec and the canonical-link digest rules (docs/spec/rtc-signaling.md
// §4.2, §4.3). Pure functions, no I/O. Minting, use counting and revocation on the links service are RTC-d.
// Provisional (coordinator), not signed off by the user.
//
// A ticket is a bearer capability to reach one callee with at most `uses` invites for the listed purposes. It is a
// links §3 meta payload: the common members plus exactly sub, purposes, uses and principal. Lifetime is at most 30
// days. A callback ticket (minted by the caller's provider for the callee to ring back) is one-use, bound to the callee
// principal and lives at most 24 h. Only a link's digest ever enters a signed invite; the link travels beside it.
import {artefactURL} from '../core/artefacts.mjs';
import {originValid} from '../identity/delegation.mjs';
import {audienceURL} from '../links/envelope.mjs';
import {linkDigest} from './messages.mjs';

export const RTC_TICKET_TYPE='https://spec.bindle.example/links/rtc-ticket/v1';
export const TICKET_MAX_SECONDS=30*86400,CALLBACK_MAX_SECONDS=86400,TICKET_MAX_USES=1000,TICKET_MAX_PURPOSES=8;
const COMMON=['bindle','v','type','iss','aud','jti','iat','exp'],MEMBERS=[...COMMON,'sub','purposes','uses','principal'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,JTI=/^[A-Za-z0-9_-]{1,128}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exactly=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
const line=v=>{try{return artefactURL(v)===v;}catch{return false;}};
/** A nonempty, unique, ascending list of at most `max` purpose line URLs. */
export const purposeLinesValid=(v,max=TICKET_MAX_PURPOSES)=>Array.isArray(v)&&v.length>0&&v.length<=max&&v.every((p,i)=>line(p)&&(i===0||v[i-1]<p));
/** A principal {iss, sub}; a loopback `iss` only when `allowLoopback` (local development), like every other origin. */
export const principalValid=(v,allowLoopback=false)=>exactly(v,['iss','sub'])&&originValid(v.iss,allowLoopback)&&typeof v.sub==='string'&&UUID.test(v.sub);

/** Throws `rtc_ticket_invalid` unless `claims` is exactly an rtc-ticket meta payload (spec §4.3). */
export function validateTicketClaims(claims,{allowLoopback=false}={}){
 const bad=()=>{throw Object.assign(new Error('rtc_ticket_invalid'),{code:'rtc_ticket_invalid'});};
 if(!exactly(claims,MEMBERS)||claims.bindle!=='link-meta'||claims.v!==1||claims.type!==RTC_TICKET_TYPE)bad();
 if(!originValid(claims.iss,allowLoopback)||!audienceURL(claims.aud)||!claims.aud.startsWith(claims.iss+'/')||typeof claims.jti!=='string'||!JTI.test(claims.jti))bad();
 if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat<0||claims.exp<=claims.iat||claims.exp-claims.iat>TICKET_MAX_SECONDS)bad();
 if(typeof claims.sub!=='string'||!UUID.test(claims.sub)||!purposeLinesValid(claims.purposes)||!Number.isSafeInteger(claims.uses)||claims.uses<1||claims.uses>TICKET_MAX_USES)bad();
 if(!(claims.principal===null||principalValid(claims.principal,allowLoopback)))bad();
 return claims;
}
/** A callback ticket (§4.3 "Callback"): one use, `principal` the callee, at most 24 h. */
export function validateCallbackTicket(claims,{callee,allowLoopback=false}={}){
 validateTicketClaims(claims,{allowLoopback});
 if(claims.uses!==1||claims.exp-claims.iat>CALLBACK_MAX_SECONDS||!principalValid(callee,allowLoopback)||claims.principal?.iss!==callee.iss||claims.principal?.sub!==callee.sub)throw Object.assign(new Error('rtc_ticket_invalid'),{code:'rtc_ticket_invalid'});
 return claims;
}
/** Whether the ticket admits `purpose` for the VERIFIED caller principal (compare only after certificate checks). */
export const ticketAdmits=(claims,{purpose,principal})=>claims.purposes.includes(purpose)&&(claims.principal===null||claims.principal.iss===principal?.iss&&claims.principal.sub===principal?.sub);
/** Ticket lifetime for minting: `expiresIn` seconds, clamped to (0, 30 days]. */
export const ticketLifetime=expiresIn=>Number.isSafeInteger(expiresIn)&&expiresIn>0?Math.min(expiresIn,TICKET_MAX_SECONDS):null;

/**
 * The canonical form of a basis or callback link (spec §4.2): the origin and path plus exactly `bindle_meta` (or the
 * legacy `sig`), no `bindle_data`, no unrelated parameter, no fragment, and the origin equal to `origin` when given.
 * Returns the canonical string, or null.
 */
export function canonicalBasisLink(target,{origin}={}){
 if(typeof target!=='string'||target.length>8192)return null;let u;try{u=new URL(target);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||target.includes('#')||u.href!==target||origin!==undefined&&u.origin!==origin)return null;
 return /^\?(bindle_meta|sig)=[A-Za-z0-9_.-]+$/.test(u.search)?target:null;
}
/** True when `link` is canonical and its digest equals `digest` (spec §4.2 `link_digest`, §4.3 `callback_digest`). */
export async function linkMatchesDigest(link,digest,{origin,crypto=globalThis.crypto}={}){const canonical=canonicalBasisLink(link,{origin});return canonical!==null&&await linkDigest(canonical,crypto)===digest;}
export {linkDigest};
