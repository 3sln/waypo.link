// ORG-0, the power resolver seam (docs/architecture/organizations-design.md §13.2, ORG-D2, ORG-D6).
//
// Owner routes no longer imply "the signed-in person owns this account". They pass an actor:
//
//   {kind:'owner', owner, principal:{iss, sub}, entity:{kind, id}, powers, authTime, epoch}
//
//   principal  who is acting: the authenticated person, keyed by (iss, sub). `iss` is null for a same-host session
//              whose issuer is implied (this provider's origin).
//   entity     whom the request acts for: the person itself, or an organization (ORG-D1 "entity").
//   powers     what the principal may do for the entity. Never taken from a caller: the account single writer
//              resolves them here, inside its gate, from its own state.
//   authTime   the principal's last interactive authentication (ms) or null; operations that need a fresh
//              authentication compare it with their own clock.
//   epoch      the principal's security epoch at its home (`account.security.epoch` for a same-host person, the
//              certificate `aep` for later cross-provider members). A writer refuses a lower epoch than it has seen.
//   kind/owner kept for every existing operation: `owner` is always the entity id, so `ownerOf(actor)`, owner-scoped
//              providers and the account-store binding check are unchanged.
//
// A person acting as themselves resolves to powers ['owner'] (the whole owner interface of their own account), which
// is exactly what the implicit owner meant before. Organization entities resolve powers from the organization record
// (phase A: the owner of record and the initial admin; ORG-2 replaces the initial admin with membership grants).
import {principalKey,memberPowers} from './grants.mjs';
import {AppFault} from '../app/faults.mjs';

const UUID=/^[a-f0-9-]{36}$/;
const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const ENTITY_KINDS=Object.freeze(['person','organization']);
/** Powers this slice knows. 'owner': the person's own owner interface. The organization powers are 3sln.me policy
 * (design §12b.1, §12c): 'owner-of-record' (billing owner: elevation, transfer, deletion) and 'admin' (the v1 GM grant). */
export const POWERS=Object.freeze(['owner','owner-of-record','admin']);
const nonNegative=value=>Number.isSafeInteger(value)&&value>=0;
const issuerOf=value=>value===null||value===undefined?null:typeof value==='string'&&/^https?:\/\/[^/\s]+$/.test(value)?value:fail('forbidden','Unsupported actor.',403);

function freezeActor({owner,principal,entity,powers,authTime,epoch,aep=0,verification,addedUnder}){
 return Object.freeze({kind:'owner',owner,principal:Object.freeze({iss:principal.iss,sub:principal.sub}),entity:Object.freeze({kind:entity.kind,id:entity.id}),powers:Object.freeze([...new Set(powers)].sort()),authTime,epoch,aep,...verification?{verification:Object.freeze({...verification})}:{},...addedUnder?{addedUnder:structuredClone(addedUnder)}:{}});
}
/** The actor of a person acting as themselves: the former implicit owner. */
export function personActor({owner,iss=null,authTime=null,epoch=0,aep=0,verification}={}){
 if(typeof owner!=='string'||!UUID.test(owner))fail('unauthorized','Sign in to continue.',401);
 return freezeActor({owner,principal:{iss:issuerOf(iss),sub:owner},entity:{kind:'person',id:owner},powers:['owner'],authTime:nonNegative(authTime)?authTime:null,epoch:nonNegative(epoch)?epoch:0,aep:nonNegative(aep)?aep:0,verification});
}
/** A request by `actor`'s principal to act for another entity. Carries no powers: the entity's writer resolves them. */
export function actingAs(actor,entity){
 if(!plain(actor?.principal)||!UUID.test(actor.principal.sub??''))fail('unauthorized','Sign in to continue.',401);
 if(!plain(entity)||!ENTITY_KINDS.includes(entity.kind)||typeof entity.id!=='string'||!UUID.test(entity.id))fail('invalid_request','Unsupported entity.',400);
 return {principal:{iss:actor.principal.iss??null,sub:actor.principal.sub},entity:{kind:entity.kind,id:entity.id},authTime:actor.authTime??null,epoch:actor.epoch??0,aep:actor.aep??0,...actor.verification?{verification:actor.verification}:{},...actor.addedUnder?{addedUnder:actor.addedUnder}:{}};
}
/** The acting entity of an actor; a legacy {kind:'owner', owner} actor is the person `owner`. */
export function entityOf(actor){return plain(actor?.entity)?actor.entity:{kind:'person',id:actor?.owner};}
export function hasPower(actor,power){return Array.isArray(actor?.powers)?actor.powers.includes(power):power==='owner'&&actor?.kind==='owner'&&entityOf(actor).kind==='person';}
/** Refuses unless the actor holds one of `powers`. A missing power looks like an unknown entity (uniform 404). */
export function requirePower(actor,...powers){if(!powers.some(power=>hasPower(actor,power)))fail('not_found','Not found.',404);return actor;}
/** Fresh-authentication check against the operation's own clock (default 15 minutes, as IdentityService#recent). */
export function requireFresh(actor,now,windowMs=900000){if(!nonNegative(actor?.authTime)||actor.authTime>now||actor.authTime+windowMs<=now)fail('reauthentication_required','Confirm your password or passkey before continuing.',401);return actor;}

/**
 * Powers of `principal` in an organization record (phase A, design §12b.1, §12a): the owner of record holds
 * 'owner-of-record'; the initial admin (the creator, until ORG-2 memberships exist) holds 'admin'. `membership`
 * (ORG-2 hook) may return {powers:[...]} for the principal; it replaces the initial-admin fallback once present.
 * Ownership itself never implies 'admin' (§12b.1 item 5). A record that is not an organization grants nothing.
 */
export function organizationPowers(record,principal,{membership,now=Date.now()}={}){
 if(record?.kind!=='organization'||!plain(principal))return [];
 const same=party=>plain(party)&&party.sub===principal.sub&&(party.iss??null)===(principal.iss??null);
 const stored=record.memberships?.[principalKey(principal)],powers=[];if(same(record.ownerOfRecord)&&(!record.memberships||stored?.state==='live'&&(stored.expires_at===undefined||stored.expires_at>now/1000)&&!stored.hold))powers.push('owner-of-record');
 if(record.memberships){powers.push(...memberPowers(stored,now));return powers;}
 const member=typeof membership==='function'?membership(principal):undefined;
 if(member!==undefined&&member!==null){for(const power of Array.isArray(member.powers)?member.powers:[])if(power==='admin')powers.push('admin');}
 else if(same(record.initialAdmin))powers.push('admin');
 return powers;
}

/**
 * The actor an account single writer accepts for one operation, resolved inside the writer's gate.
 * `requested` is what a trusted adapter passed (or undefined for the legacy implicit owner). `Operation.entities`
 * lists the entity kinds the operation supports (default ['person']). `organization()` reads this writer's
 * organization record (only called for an organization entity). `issuer` is this provider's origin: a same-host
 * principal may name it or leave `iss` null.
 */
export async function accountActor({owner,requested,Operation,issuer,organization,membership}={}){
 if(requested===undefined||requested===null)return personActor({owner});
 if(!plain(requested)||!plain(requested.principal)||!plain(requested.entity))fail('forbidden','Unsupported actor.',403);
 // A same-host principal may leave `iss` null; it is normalized to this provider's origin.
 const {principal,entity}=requested,iss=issuerOf(principal.iss)??issuerOf(issuer);
 if(typeof principal.sub!=='string'||!UUID.test(principal.sub)||entity.id!==owner||!ENTITY_KINDS.includes(entity.kind))fail('forbidden','Account owner mismatch.',403);
 // Phase A: only same-host principals act through owner routes. Foreign members arrive with ORG-4 certificates.
 if(iss!==null&&iss!==issuer)fail('forbidden','Unsupported actor.',403);
 const authTime=nonNegative(requested.authTime)?requested.authTime:null,epoch=nonNegative(requested.epoch)?requested.epoch:0;
 const supported=Array.isArray(Operation?.entities)?Operation.entities:['person'];
 if(entity.kind==='person'){
  if(principal.sub!==owner)fail('forbidden','Account owner mismatch.',403);
  if(!supported.includes('person'))fail('not_found','Not found.',404);
  return personActor({owner,iss,authTime,epoch,aep:requested.aep,verification:requested.verification});
 }
 if(!supported.includes('organization'))fail('not_found','Not found.',404);
 const record=typeof organization==='function'?await organization():undefined;
 if(record?.kind!=='organization'||record.id!==owner)fail('not_found','Not found.',404);
 const powers=organizationPowers(record,{iss,sub:principal.sub},{membership});
 if(!powers.length&&!Operation?.membershipEntry)fail('not_found','Not found.',404);
 return freezeActor({owner,principal:{iss,sub:principal.sub},entity:{kind:'organization',id:owner},powers,authTime,epoch,aep:nonNegative(requested.aep)?requested.aep:0,verification:requested.verification,addedUnder:requested.addedUnder});
}
