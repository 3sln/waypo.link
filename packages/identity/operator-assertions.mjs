// ORG-12d: production operator assertions for support decisions on organization ownership processes (design §12d.8,
// §12d.12 "verified operator identity"). Host administration, not Bindle protocol. Provisional (coordinator), not signed
// off by the user.
//
// Signing approach (provisional): ES256 (ECDSA P-256, SHA-256, IEEE P1363 signatures), the algorithm and JWK codec of the
// identity key registry (packages/identity/keys.mjs). The admin service holds the private key: it is generated in the
// admin store on first use and kept only sealed under KEY_ENCRYPTION_KEY with the same AES-GCM sealing the identity key
// registry uses (packages/runtime/secrets.mjs, injected as `seal`/`open`). The organization writer never sees it: it
// verifies with the public key published in the admin store (`operator-key/<kid>`).
//
// Admin store rows (packages/identity/admin-store.mjs):
//   operator-signer               {kid, sealed, createdAt}                       the current signing key (sealed private JWK,
//                                                                                AAD `operator-signer/<kid>`, review L6)
//   operator-key/<kid>            {kid, alg:'ES256', publicJwk, createdAt, retiredAt}
//   operator-assertion/<jti>      {jti, operator, kid, scope, scopeDigest, issuedAt, expiresAt, state:'issued'|'used', usedAt}
//   org-case/<org>                the LIVE support case (deleted when the case closes; review L3)
//   org-case-seq/<org>            {seq}: the highest case-index sequence applied, kept so a late effect never resurrects
// The assertion registry makes every assertion single use across the whole host (the organization writer also keeps a
// per-process nonce list), and lets the verifier refuse anything the admin service did not durably issue.
// Review L4 (rotate on retire): when the current signer's published key is retired or missing, the next issue rotates
// to a new key under compare-and-swap on `operator-signer`, audited as `operator-key.rotate`.
// Review L5 (least privilege): the verification and case-index functions below run INSIDE the admin store object
// (AdminStorage#verifyOperatorAssertion, #operatorRegistered, #applySupportCase); account objects receive only a client
// for those three methods (`organizationAdminPorts`), never the store.
//
// Wire form: `oa1.<payload>.<signature>`, base64url. payload = JSON {v:1, typ:'bindle-operator-assertion', iss, kid,
// jti, operator, capability, scope, iat, exp}; the signature covers 'bindle-operator-assertion-v1.' + payload.
// `scope` is the canonical scope string the engine computes: [org, kind, process, decision, sorted exclusions].
import {validateCatalog,effectiveAuthority,ADMIN_ROLE,OPERATOR_CAPABILITY} from './roles.mjs';

export const OPERATOR_ASSERTION_PREFIX='oa1';
export const OPERATOR_ASSERTION_TTL_MS=5*60000;
const DOMAIN='bindle-operator-assertion-v1.',P256={name:'ECDSA',namedCurve:'P-256'},SIGN={name:'ECDSA',hash:'SHA-256'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const unb64=text=>{if(typeof text!=='string'||!/^[A-Za-z0-9_-]+$/.test(text))throw new TypeError('base64url');return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),ch=>ch.charCodeAt(0));};
const enc=new TextEncoder(),dec=new TextDecoder();
const hex=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** The engine's canonical scope (OwnershipService#verifyOperator passes {org, kind, process, decision, exclude}). */
export const operatorScope=scope=>JSON.stringify([scope?.org??null,scope?.kind??null,scope?.process??null,scope?.decision??null,[...(scope?.exclude??[])].sort()]);
const publicOf=jwk=>({kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y});

/**
 * Whether `operator` currently holds the operator capability according to the durable registry: the administrator role
 * and `support.org-break-glass`, through an internal, non-delegable role (roles.mjs), with no administrator hold on the
 * principal row. Internal provenance and active status need the identity record; the admin service checks them at issue,
 * at most OPERATOR_ASSERTION_TTL_MS before the verifier runs (documented residual).
 */
export async function operatorRegistered(store,operator){
 if(typeof operator!=='string'||!UUID.test(operator))return false;
 const [row,catalogRow]=await Promise.all([store.get('principal/'+operator),store.get('catalog')]);
 if(!row||row.hold)return false;let catalog;try{const {revision:_r,...value}=catalogRow??{};catalog=validateCatalog(value);}catch{return false;}
 const authority=effectiveAuthority(catalog,{roles:Array.isArray(row.roles)?row.roles:[]},{internal:true,active:true});
 return authority.admin===true&&authority.capabilities.includes(OPERATOR_CAPABILITY);
}

/** Admin-service side. `store` is the admin store; `seal`/`open` the KEY_ENCRYPTION_KEY sealing; `issuer` APP_ORIGIN. */
export function operatorAssertionSigner({store,seal,open,issuer,clock=()=>Date.now(),random=()=>crypto.randomUUID(),ttlMs=OPERATOR_ASSERTION_TTL_MS}){
 let cached=null;
 async function create(audit,expectRow,attempt){
  if(typeof seal!=='function'||typeof open!=='function')throw Object.assign(new Error('Operator assertions need KEY_ENCRYPTION_KEY.'),{code:'operator_assertions_unavailable',status:503});
  const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']),privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey),kid=random(),now=clock(),rotate=Boolean(expectRow);
  const result=await store.commit({expect:{'operator-signer':expectRow?.revision??null,['operator-key/'+kid]:null},writes:{'operator-signer':{kid,sealed:await seal({kty:'EC',crv:'P-256',x:privateJwk.x,y:privateJwk.y,d:privateJwk.d},'operator-signer/'+kid),createdAt:now},['operator-key/'+kid]:{kid,alg:'ES256',publicJwk:publicOf(privateJwk),createdAt:now,retiredAt:null}},...audit?{audit:{...audit(now),action:rotate?'operator-key.rotate':'operator-key.create',target:kid,before:rotate?{kid:expectRow.kid}:null,after:{kid,alg:'ES256'}}}:{}});
  if(!result.committed&&attempt>=2)throw Object.assign(new Error('The operator signing key is unavailable.'),{code:'operator_assertions_unavailable',status:503});
  cached=null;return signer(audit,attempt+1); // re-read: ours, or the one another isolate wrote first
 }
 async function signer(audit,attempt=0){
  const row=await store.get('operator-signer');if(!row)return create(audit,null,attempt);
  // Review L4: a retired (or missing) published key is never used to sign; rotate to a new one instead.
  const published=await store.get('operator-key/'+row.kid);if(!published||published.retiredAt)return create(audit,row,attempt);
  if(cached?.kid!==row.kid){const jwk=await open(row.sealed,'operator-signer/'+row.kid);cached={kid:row.kid,key:await crypto.subtle.importKey('jwk',{...jwk,ext:false,key_ops:['sign']},P256,false,['sign'])};}return cached;
 }
 return {
  /** Returns {assertion, jti, expiresAt, record} where `record` is the registry row the caller commits atomically with
   * its own audit and rate windows (`operator-assertion/<jti>`). Nothing is valid until that row is committed. */
  async prepare({operator,scope},audit){
   const s=await signer(audit),now=clock(),jti=random(),canonical=operatorScope(scope),payload=b64(enc.encode(JSON.stringify({v:1,typ:'bindle-operator-assertion',iss:issuer??null,kid:s.kid,jti,operator,capability:OPERATOR_CAPABILITY,scope:canonical,iat:now,exp:now+ttlMs})));
   const signature=b64(new Uint8Array(await crypto.subtle.sign(SIGN,s.key,enc.encode(DOMAIN+payload))));
   return {assertion:OPERATOR_ASSERTION_PREFIX+'.'+payload+'.'+signature,jti,expiresAt:now+ttlMs,record:{jti,operator,kid:s.kid,scope:canonical,scopeDigest:await hex(canonical),issuedAt:now,expiresAt:now+ttlMs,state:'issued',usedAt:null}};
  }
 };
}

/**
 * Organization-writer side: the engine's `operators` port (OwnershipService#verifyOperator). Verifies the signature
 * against the published key, the issuer, the exact scope, the operator and the lifetime; then the durable registry: the
 * assertion was issued and not used (it is marked used here, once, under the store's revision check), and the operator
 * still holds the capability. Anything else answers {ok:false}; the engine then refuses (fail closed).
 */
export function operatorAssertionVerifier({store,issuer,clock=()=>Date.now()}){
 const keys=new Map();
 async function publicKey(kid){
  if(typeof kid!=='string'||!UUID.test(kid))return null;
  const row=await store.get('operator-key/'+kid);if(!row||row.alg!=='ES256'||row.retiredAt)return null;
  if(!keys.has(kid))keys.set(kid,await crypto.subtle.importKey('jwk',{...publicOf(row.publicJwk),ext:true,key_ops:['verify']},P256,false,['verify']));
  return keys.get(kid);
 }
 return {
  async verify({assertion,operator,scope,at=clock()}){
   try{
    if(typeof assertion!=='string'||assertion.length>4096)return {ok:false};
    const [prefix,payload,signature,...rest]=assertion.split('.');if(prefix!==OPERATOR_ASSERTION_PREFIX||!payload||!signature||rest.length)return {ok:false};
    const claims=JSON.parse(dec.decode(unb64(payload))),key=await publicKey(claims?.kid);if(!key)return {ok:false};
    if(!await crypto.subtle.verify(SIGN,key,unb64(signature),enc.encode(DOMAIN+payload)))return {ok:false};
    if(claims.v!==1||claims.typ!=='bindle-operator-assertion'||(claims.iss??null)!==(issuer??null)||claims.capability!==OPERATOR_CAPABILITY||claims.operator!==operator||claims.scope!==operatorScope(scope)||!UUID.test(claims.jti??''))return {ok:false};
    if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.exp<=at||claims.iat>at+60000||claims.exp-claims.iat>OPERATOR_ASSERTION_TTL_MS)return {ok:false};
    // The registry: issued by the admin service for exactly this operator and scope, and never used before.
    const key2='operator-assertion/'+claims.jti,row=await store.get(key2);
    if(!row||row.state!=='issued'||row.operator!==operator||row.scope!==claims.scope||row.kid!==claims.kid||row.expiresAt!==claims.exp)return {ok:false};
    const {revision,...value}=row,used=await store.commit({expect:{[key2]:revision},writes:{[key2]:{...value,state:'used',usedAt:at}}});
    if(!used.committed)return {ok:false};
    if(!await operatorRegistered(store,operator))return {ok:false};
    return {ok:true,operator,capability:OPERATOR_CAPABILITY,nonce:claims.jti,expiresAt:claims.exp};
   }catch{return {ok:false};}
  },
  /** M1: whether `operator` still holds the capability (the writer re-checks a proposer when a second operator approves). */
  registered(operator){return operatorRegistered(store,operator).catch(()=>false);}
 };
}

/** ORG-12d: the support case index (`org-case/<org>`), written by the organization writer's ownership outbox. Routing only:
 * the admin service confirms every case with the organization before showing or deciding anything. A row is replaced only
 * by a higher sequence, so a retried or reordered effect never resurrects a closed case; closed cases stay as tombstones. */
export function supportCaseIndex({store,clock=()=>Date.now()}){
 return {
  async apply(org,{kind=null,process=null,state=null,seq,handle=null}={}){
   if(typeof org!=='string'||!UUID.test(org)||!Number.isSafeInteger(seq)||seq<1)return {ok:false};
   if(state!==null&&(!['break-glass','lapse-claim'].includes(kind)||!UUID.test(process??'')||!['held','contest','escalated'].includes(state)))return {ok:false};
   for(let attempt=0;attempt<3;attempt++){
    // Review L3: only live cases sit under `org-case/` (the queue); a closed case's row is deleted, and its sequence
    // stays in `org-case-seq/<org>` so a late or retried effect never brings it back.
    const key='org-case/'+org,seqKey='org-case-seq/'+org,[old,mark]=await Promise.all([store.get(key),store.get(seqKey)]),last=Math.max(old?.seq??0,mark?.seq??0);
    if(last>=seq)return {ok:true,stale:true};
    const now=clock(),next=state?{org,kind,process,state,seq,handle:typeof handle==='string'&&handle.length<=64?handle:null,since:old?.state===state&&old.process===process?old.since:now,updatedAt:now}:null;
    const result=await store.commit({expect:{[key]:old?.revision??null,[seqKey]:mark?.revision??null},writes:{[key]:next,[seqKey]:{seq,updatedAt:now}}});if(result.committed)return {ok:true};
   }
   return {ok:false};
  }
 };
}
