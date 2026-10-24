// ORG-10b participation statements (spec docs/spec/organizations.md §9.3, rev 4.5; design §8b.4 gap 3, RL-7). A
// statement is a party's own signed claim that it participates in an instance in a slot. It confers nothing: redemption
// and every edge are checked at the parties' own providers. Because it is not revocable it is accepted only while fresh.
//
//   sign     only when presenting, only for a participation that is live or recorded as pending in the same commit
//            (callers enforce this; RelationService signs inside the commit that makes the participation live/pending)
//   verify   exact members, `typ`, the party's ACTIVE signing key only, iat ≤ now + 30 s, and freshness: within 300 s of
//            the invitation's `iat` when carried in an invitation (mode 'invitation'), within 300 s of verification when
//            returned at redemption or carried in an introduction (mode 'presented')
//
// Ports (RL-15, design §8b.10 "Interfaces agreed first"): `signer(org)` -> {kid, privateKey} for the entity's identity
// signing key; `keys(principal)` -> [{kid, publicJwk}] of that party's ACTIVE signing keys, cache-only on the request
// path (same host: the identity key registry; ORG-11: directory.v1 kept warm by background refresh). Same-host and
// foreign statements go through exactly these functions; only the ports' implementations differ.
import {strictJSON,plain,jcs} from '../core/strict-json.mjs';
import {base64url,fromBase64url,textEncoder} from '../core/records.mjs';

export const STATEMENT_TYP='bindle-relation-participation+jwt',STATEMENT_FRESH_S=300,STATEMENT_FUTURE_S=30,STATEMENT_MAX_BYTES=4096;
const ECDSA={name:'ECDSA',namedCurve:'P-256'},SIGN={name:'ECDSA',hash:'SHA-256'};
const COMPACT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const exact=(v,required,optional=[])=>plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const segment=value=>base64url(textEncoder.encode(jcs(value)));
const principal=p=>exact(p,['iss','sub'])&&typeof p.iss==='string'&&typeof p.sub==='string';
const samePrincipal=(a,b)=>a?.iss===b?.iss&&a?.sub===b?.sub;
const samePin=(a,b)=>a?.artefact===b?.artefact&&a?.version===b?.version&&a?.digest===b?.digest;

/** ES256 compact JWS over canonical (JCS) header and payload. */
export async function signCompact({typ,kid,privateKey,payload,crypto=globalThis.crypto}){
 const input=`${segment({alg:'ES256',kid,typ})}.${segment(payload)}`;
 const signature=await crypto.subtle.sign(SIGN,privateKey,textEncoder.encode(input));
 return `${input}.${base64url(new Uint8Array(signature))}`;
}
/** Parses a compact JWS with exactly {alg:'ES256', kid, typ}; returns null on anything malformed. Verifies nothing. */
export function parseCompact(value,{typ,maxBytes=STATEMENT_MAX_BYTES}={}){
 try{
  if(typeof value!=='string'||value.length>maxBytes||!COMPACT.test(value))return null;
  const [h,p,s]=value.split('.'),decode=x=>strictJSON(fromBase64url(x),{maxDepth:8});
  const header=decode(h),payload=decode(p),signature=fromBase64url(s);
  if(!exact(header,['alg','kid','typ'])||header.alg!=='ES256'||header.typ!==typ||typeof header.kid!=='string'||!header.kid||header.kid.length>256||signature.length!==64||!plain(payload))return null;
  return {header,payload,input:`${h}.${p}`,signature};
 }catch{return null;}
}
/** True when one of `keys` (by kid) verifies the exact received signing input. */
export async function verifyCompact(parsed,keys,{crypto=globalThis.crypto}={}){
 const key=(Array.isArray(keys)?keys:[]).find(k=>k?.kid===parsed?.header?.kid);if(!key?.publicJwk)return false;
 try{return await crypto.subtle.verify(SIGN,await crypto.subtle.importKey('jwk',key.publicJwk,ECDSA,false,['verify']),parsed.signature,textEncoder.encode(parsed.input));}catch{return false;}
}

/** The exact statement payload (spec §9.3). */
export function statementPayload({instance,relation,slot,party,invitation,iat,jti}){
 return {bindle:'relation-participation',v:1,instance,relation:{artefact:relation.artefact,version:relation.version,digest:relation.digest},slot,party:{iss:party.iss,sub:party.sub},...invitation!==undefined?{invitation}:{},iat,jti};
}
function payloadValid(p){
 return exact(p,['bindle','v','instance','relation','slot','party','iat','jti'],['invitation'])&&p.bindle==='relation-participation'&&p.v===1&&typeof p.instance==='string'&&p.instance.length<=512
  &&exact(p.relation,['artefact','version','digest'])&&typeof p.relation.artefact==='string'&&Number.isSafeInteger(p.relation.version)&&typeof p.relation.digest==='string'
  &&typeof p.slot==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(p.slot)&&principal(p.party)&&Number.isSafeInteger(p.iat)&&p.iat>=0&&typeof p.jti==='string'&&p.jti.length>0&&p.jti.length<=128
  &&(p.invitation===undefined||typeof p.invitation==='string'&&p.invitation.length<=128);
}

/**
 * Verifies a statement. `keys` are the claimed party's active signing keys (the caller resolves them for the EXPECTED
 * party only, so a statement never triggers a lookup of an arbitrary issuer). `expect` members that are present must
 * match exactly. Returns the payload or null; every failure is the same null (no oracle).
 */
export async function verifyStatement(jws,{keys,now,mode,invitationIat,expect={}}={}){
 const parsed=parseCompact(jws,{typ:STATEMENT_TYP});if(!parsed||!payloadValid(parsed.payload))return null;
 const p=parsed.payload,nowS=Math.floor(now/1000);
 if(p.iat>nowS+STATEMENT_FUTURE_S)return null;
 if(mode==='invitation'){if(!Number.isSafeInteger(invitationIat)||p.iat<invitationIat-STATEMENT_FRESH_S)return null;}
 else if(mode==='presented'){if(p.iat<nowS-STATEMENT_FRESH_S)return null;}
 else return null;
 if(expect.instance!==undefined&&p.instance!==expect.instance||expect.slot!==undefined&&p.slot!==expect.slot||expect.relation!==undefined&&!samePin(p.relation,expect.relation)||expect.party!==undefined&&!samePrincipal(p.party,expect.party)||Object.hasOwn(expect,'invitation')&&p.invitation!==expect.invitation)return null;
 if(!await verifyCompact(parsed,keys))return null;
 return structuredClone(p);
}

/** The Statements port over the signer and key ports. `sign` stamps iat from the injected clock and a random jti. */
export function participationStatements({signer,keys,clock,random}){
 return Object.freeze({
  async sign({org,party,instance,relation,slot,invitation}){
   const key=await signer(org);if(!key?.kid||!key?.privateKey)throw Object.assign(new Error('Identity signing key unavailable.'),{code:'relation_unavailable',status:503});
   return signCompact({typ:STATEMENT_TYP,kid:key.kid,privateKey:key.privateKey,payload:statementPayload({instance,relation,slot,party,invitation,iat:Math.floor(clock.now()/1000),jti:random.uuid()})});
  },
  async verify(jws,{party,...context}){let k;try{k=await keys(party);}catch{k=[];}return verifyStatement(jws,{keys:k,now:clock.now(),expect:{party,...context.expect??{}},mode:context.mode,invitationIat:context.invitationIat});},
 });
}
