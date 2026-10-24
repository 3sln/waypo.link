// ORG-10b relation invitations (spec docs/spec/organizations.md §9.4, rev 4.5; design §8b.2, §8b.7, RL-11). A link of type
// relation-invitation/v1 signed with the inviting entity's identity key through the shared link envelope
// (packages/links/envelope.mjs). Its type-specific meta members are exactly instance, relation, slot, invitee, accept and
// the inviter's fresh participation statement (spec §9.3: every relation invitation carries it). It is single use,
// bound to its invitee, `exp − iat` ≤ 30 days, and a withdrawn invitation is refused exactly as an invalid one.
//
// Like the organization invitation type (packages/orgs/invitations.mjs), the type is a provider link type with no app
// slot binding, so packages/links/types.mjs needs no registration row (reconciled with §8b.10's "type-registration hunk").
import {signLinkJWS,parseLinkMeta,verifyLinkSignature,LINK_META_TYP} from '../links/envelope.mjs';
import {digest} from '../core/records.mjs';
import {plain} from '../core/strict-json.mjs';

export const RELATION_INVITATION_TYPE='https://spec.bindle.example/links/relation-invitation/v1';
const DAY=86400000;
export const RELATION_INVITATION_MAX_MS=30*DAY,RELATION_INVITATION_DEFAULT_MS=7*DAY;
/** RL-11 limits (3sln.me provider policy). Provisional (coordinator), not signed off by the user; starting values. */
export const RELATION_LIMITS=Object.freeze({
 invitationsPerDay:300,     // relation invitations an organization issues per UTC day
 invitationsPerPair:3,      // per (inviter, invitee) in any 30 days
 pairWindowMs:30*DAY,
 pendingPerPair:1,          // at most one open invitation per (inviter, invitee)
 inbound:256,               // pending inbound items (invitations, later introductions) per organization
 instances:256,             // live participations per organization, until measured
 incomingEdges:1024,        // live incoming edges (acceptance halves) per organization, until measured
 muted:1024,                // muted organizations per organization
 introductionsPerDay:10,    // per (proposer, receiver); enforced by ORG-10e
});
const META=['bindle','v','type','iss','aud','jti','iat','exp','instance','relation','slot','invitee','accept','statement'];
const exact=(v,names)=>plain(v)&&names.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>names.includes(k));
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const identityURI=p=>`${p.iss}/identity/${p.sub}`;
/** The inviting entity named by an invitation's `iss` and `aud` (`<iss>/identity/<uuid>`), or null. */
export function inviterOf(claims){
 const prefix=`${claims?.iss}/identity/`;if(typeof claims?.aud!=='string'||!claims.aud.startsWith(prefix))return null;
 const sub=claims.aud.slice(prefix.length);return UUID.test(sub)?{iss:claims.iss,sub}:null;
}
/** The `invitation` member of the invitee's statement: the digest of the invitation meta (spec §9.4). */
export const invitationDigest=meta=>digest(globalThis.crypto,meta);

export async function signRelationInvitation({issuer,org,signer,jti,iat,exp,instance,relation,slot,invitee,accept,statement}){
 const claims={bindle:'link-meta',v:1,type:RELATION_INVITATION_TYPE,iss:issuer,aud:identityURI({iss:issuer,sub:org}),jti,iat,exp,instance,relation:{artefact:relation.artefact,version:relation.version,digest:relation.digest},slot,invitee:{iss:invitee.iss,sub:invitee.sub},accept,statement};
 return signLinkJWS({header:{alg:'ES256',kid:signer.kid,typ:LINK_META_TYP},claims,privateKey:signer.privateKey});
}

/**
 * Parses and verifies a relation invitation's metadata: the envelope profile, the exact member set, the inviter's
 * signature under its active keys (`keys(principal)`, cache-only), expiry and the 30-day bound. Returns
 * {claims, inviter} or null; every failure is the same null.
 */
export async function parseRelationInvitation(meta,{keys,now,expect}){
 let parsed;try{parsed=parseLinkMeta(meta);}catch{return null;}
 const c=parsed.claims;if(!exact(c,META)||c.type!==RELATION_INVITATION_TYPE)return null;
 const inviter=inviterOf(c);if(!inviter)return null;
 if(typeof c.instance!=='string'||c.instance.length>512||typeof c.slot!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(c.slot)||!exact(c.relation,['artefact','version','digest'])||!exact(c.invitee,['iss','sub'])||typeof c.invitee.sub!=='string'||!UUID.test(c.invitee.sub)||typeof c.accept!=='string'||typeof c.statement!=='string')return null;
 // The jti is a 64-hex identifier (review L17), and `expect(inviter)` binds the claimed inviter BEFORE any key lookup, so
 // an offer or link can never make the receiver resolve an arbitrary or foreign principal (review M6).
 if(typeof c.jti!=='string'||!/^[a-f0-9]{64}$/.test(c.jti)||typeof expect==='function'&&!expect(inviter))return null;
 if(c.exp*1000<=now||c.iat*1000>now+30000||(c.exp-c.iat)*1000>RELATION_INVITATION_MAX_MS)return null;
 let k;try{k=await keys(inviter);}catch{k=[];}
 const key=(Array.isArray(k)?k:[]).find(x=>x?.kid===parsed.header.kid);
 if(!key||!await verifyLinkSignature(globalThis.crypto,parsed,{alg:'ES256',publicJwk:key.publicJwk}))return null;
 return {claims:structuredClone(c),inviter};
}

/** RL-11 issuance check over the organization's counters. Pure: returns null when allowed, or the refusal code. */
export function invitationAllowed({day,pair},now){
 const today=Math.floor(now/DAY);
 if(day?.date===today&&day.count>=RELATION_LIMITS.invitationsPerDay)return 'relation_invitation_limit';
 const recent=(pair?.sent??[]).filter(at=>at>now-RELATION_LIMITS.pairWindowMs);
 if(recent.length>=RELATION_LIMITS.invitationsPerPair)return 'relation_invitation_limit';
 if(pair?.pending)return 'relation_invitation_pending';
 return null;
}
