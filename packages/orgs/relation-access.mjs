// ORG-10d relation access: entity-certificate issuance at the grantee and verification at the grantor (spec
// docs/spec/organizations.md §9.5, §10, §12 item 3; design §8b.3, §8b.10, RL-4, RL-16). Provisional (coordinator), not
// signed off by the user. The codec is packages/identity/entity-certificates.mjs.
//
// Grantee (relations.certify, system; the federation projection port or the proxy gateway calls it). Issues only after
// its own hop evaluation, every hop live at issuance:
//   import      available: the grantor's live grant half as last reported, my live acceptance, my live participation;
//   application an ACTIVE federation grant of exactly this client approving the import for `field`, whose connection is
//               live at the generation the grant recorded (the connection-generation fence), and whose recorded
//               resource generation equals the import mirror's (a rebound import needs a new approval);
//   member      (member context) the membership live at exactly the presented id and generation, holding a grant on
//               the import; methods = member grant ∩ application ceiling ∩ edge grant (effectiveAuthority). In
//               organization context (no member) methods = application ceiling ∩ edge grant.
// The certificate binds the edge (iss = this organization, aud = the grantor's CURRENT identity URI), the instance, the
// grantor's resource ID behind the import (one per certificate, so one entry of one edge), those methods, the edge's
// resource scope, this organization's `aep` and the holder key. Lifetime 300 s (RL-16). Every refusal is the same
// `relation_certificate_unavailable`.
//
// Grantor (relations.authorize, system; the RPC and token-endpoint adapters call it). Spec §5.2 steps 1–3 with the §9.5
// substitutions, then §9.5 authorization:
//   1. syntax, typ, purpose, aud = this organization, expiry (60 s skew), the effective-lifetime cap (iat + 300 s), and,
//      with no fetch, a live edge from this organization to the certificate's origin principal in `instance` (successor
//      index; the presented issuer must be the current one);
//   2. the signature under the acting entity's active certification key, cache-only; a missing key schedules one
//      background refresh for any claimed principal; step-1 failures and missing keys verify against a dummy key;
//   3. the DPoP proof by the certified key (`ath` = the certificate in the direct form), its jti recorded once;
//   then the write age rule (now − iat ≤ 60 s, iat ≤ now + 30 s), the `aep` floor (lower fails; higher is an authority
//   reset, persisted with its RL-4 hold before the refusal), the hold itself, and the envelope: resource = the
//   certificate's, contract and method within the certificate's `methods` and scope, and within the live edge grant in
//   that instance only (edgeDecision: hold, billing stage, pre-purge, pool re-intersection, required entries, scope).
// Every failure is ONE answer: `invalid_grant` (400) in the token form, `invalid_token` (401) in the direct form.
import {AppAction,AppQuery} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {plain} from '../core/strict-json.mjs';
import {digest} from '../core/records.mjs';
import {verifyProof,DPOP_TYP} from '../federation/dpop.mjs';
import {parseEntityCertificate,verifyEntitySignature,entityHolderKey,signEntityCertificate,pairwiseActor,ENTITY_CERTIFICATE_SECONDS,ENTITY_SKEW_SECONDS,ENTITY_WRITE_AGE_SECONDS,ENTITY_WRITE_FUTURE_SECONDS} from '../identity/entity-certificates.mjs';
import {principalKey,samePrincipal} from './grants.mjs';
import {validPrincipal} from './memberships.mjs';
import {edgeEntries} from './relation-documents.mjs';
import {outgoingLive,incomingLive,requiredSatisfied,relationScopeAllows,composeRelationScope} from './relation-edges.mjs';
import {importById,importAuthority,IMPORT_PREFIX,IMPORT_ID_PREFIX} from './relation-imports.mjs';
import {identityURI} from './relation-invitations.mjs';
import {holdRefuses} from './relation-lifecycle.mjs';
import {dummyVerify} from './relation-events.mjs';
import {K,party,ik,pad} from './relation-keys.mjs';

/** Methods that never change a resource; everything else is write-capable (spec §9.5; contracts method metadata). */
export const RELATION_READ_METHODS=Object.freeze(['capabilities','describe','get','head','list','read','status','subscribe','unsubscribe']);
export const defaultWriteCapable=(contract,method)=>!RELATION_READ_METHODS.includes(method);
const fail=(code,message,status)=>{throw new AppFault(code,message,status);};
const own=(o,k)=>o&&typeof o==='object'&&Object.hasOwn(o,k)?o[k]:undefined;
const resourceLive=(r,now)=>r.expires_at===undefined||r.expires_at>now/1000;
const PROOF_KEEP_MS=120000;
// Relation access tokens (the token form, ORG-10f): rel1.<grantor org>.<secret>; stored by hash with an expiry index.
const BOUND=/^rel1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,ACCESS=h=>'rel/access/'+h,ACCESS_AT=(at,h)=>'rel/access-at/'+pad(at)+'/'+h;
export const RELATION_ACCESS_TOKEN=BOUND;

/** Contract → methods intersection of two maps (sorted, unique). */
function intersect(a,b){const out={};for(const [c,ms] of Object.entries(a??{})){const other=own(b,c);if(!Array.isArray(ms)||!Array.isArray(other))continue;const kept=[...new Set(ms.filter(m=>typeof m==='string'&&other.includes(m)))].sort();if(kept.length)out[c]=kept;}return Object.fromEntries(Object.entries(out).sort(([x],[y])=>x.localeCompare(y)));}

export const relationAccessMethods={
 /** Whether a method is write-capable (the host's contract metadata port, or the read list above). */
 isWrite(contract,method){try{return this.writeCapable(contract,method)!==false;}catch{return true;}},
 /**
  * The grantor-side decision for one call by `grantee` (origin principal) in `instance`: the live edge in that instance
  * only, with RL-4 holds, the billing stage, the pre-purge step, the live pool, required entries and resource scope.
  */
 async edgeDecision(tx,{instance,grantee,resource,contract,method,args,unscoped=false},now){
  if(typeof instance!=='string'||!validPrincipal(grantee)||typeof resource!=='string'||typeof contract!=='string'||typeof method!=='string')return false;
  if(await this.closing(tx))return false;
  const write=this.isWrite(contract,method);
  if(holdRefuses(await this.activeHold(tx,grantee,now),{write,now}))return false;
  const stage=await this.stage(tx);if(stage==='export-only'||stage==='read-only'&&write)return false;
  const part=await tx.get(K.instance(instance)),cp=part?await tx.get(K.cp(instance,grantee)):null;if(!outgoingLive(part,cp,now))return false;
  // The grant is re-intersected with the live pool at check time (review M2).
  const pool=await this.resources(tx,resource);if(!pool||!Array.isArray(own(pool.contracts,contract))||!pool.contracts[contract].includes(method))return false;
  const granted=cp.grant.entries.some(e=>e.resources.some(r=>r.resource===resource&&resourceLive(r,now)&&Array.isArray(own(r.methods,contract))&&r.methods[contract].includes(method)&&(unscoped||relationScopeAllows(r.scope,{method,args,write}))));
  if(!granted)return false;
  // An edge is live only while every required entry is still granted (review L1).
  const doc=await this.docFor(tx,part.relation),live=await this.liveEntries(tx,doc,cp.as,cp.slot,cp.grant.entries,now);
  return requiredSatisfied(doc,cp.as,cp.slot,live);
 },
 /** relations.edge-check (system query): the grantor's decision without a certificate (diagnostics and the chaos suite). */
 edgeCheck(actor,input){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  return this.metadata.transaction(async tx=>{if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);
   if(!plain(input))return {allowed:false};
   return {allowed:await this.edgeDecision(tx,{instance:input.instance,grantee:input.grantee,resource:input.resource,contract:input.contract,method:input.method,args:input.args},this.clock.now())};});
 },

 // ---- imports as federation resources (connections can hold imports) ------------------------------------------
 /** The federation subject of this organization's resources (the same account store holds them). */
 subjectOf(owner){return this.federationSubject?.(owner)??`${this.issuer}/entities/${owner}`;},
 /** Writes (or removes) the `federation/resource/<imp_…>` mirrors of one import row, so an organization can assign an
  * import to its own fragments and approve it for an application like any resource (spec §10). Mirrors are marked
  * `imported` and `provider:'relation'`: they are never part of the organization's own pool (relation-instances
  * `ownResources`), never granted onward, and never dispatched locally (packages/federation/service.mjs). */
 async mirrorImport(tx,row,now,removed=[]){
  const owner=await tx.get('owner'),subject=this.subjectOf(owner);
  for(const id of removed)await tx.delete('federation/resource/'+id);
  for(const r of row.resources??[])await tx.put('federation/resource/'+r.id,{id:r.id,label:row.label??`Imported resource ${row.entry+1}`,contracts:structuredClone(r.methods),owner:subject,provider:'relation',imported:true,grantor:{...row.grantor},instance:row.instance,entry:row.entry,resource:r.resource,
   available:row.status==='available'&&resourceLive(r,now),held:Boolean(row.held),...Number.isSafeInteger(r.generation)&&r.generation>0?{generation:r.generation}:{},updatedAt:now});
 },
 async mirrorImports(tx,grantor,instance,now,removed=[]){
  for(const id of removed)await tx.delete('federation/resource/'+id);
  for(const row of (await tx.list({prefix:IMPORT_PREFIX+principalKey(grantor)+'/'+ik(instance)+'/',limit:65})).values())await this.mirrorImport(tx,row,now);
 },

 /** The application hop: an active grant of exactly this client approving the import for `field`, on a live connection
  * at the generation it recorded, at the import mirror's current generation. Returns {grant, ceiling} or null. */
 async applicationHop(tx,{grants,clientId,field,resource,connection,evidence}){
  // The runtime (ORG-10f) keeps federation grants in the organization's federation shard, a separate store: there the
  // trusted federation adapter passes the grant records and the connection check it made as `evidence` (system input,
  // never wire input), and only a service built with `federationEvidence` accepts it.
  if(evidence!==undefined&&(this.federationEvidence!==true||!plain(evidence)||!plain(evidence.grants)))return null;
  const mirror=await tx.get('federation/resource/'+resource);
  for(const id of (Array.isArray(grants)?grants:[]).slice(0,16)){if(typeof id!=='string')continue;
   const g=evidence?(Object.hasOwn(evidence.grants,id)&&plain(evidence.grants[id])?evidence.grants[id]:null):await tx.get('federation/grant/'+id);if(g?.active!==true||g.clientId!==clientId||!Array.isArray(own(g.resources,field))||!g.resources[field].includes(resource))continue;
   if((own(g.resourceGenerations,resource)??null)!==(mirror?.generation??null))continue;
   if(!plain(g.connection)||typeof g.connection.id!=='string'||!Number.isSafeInteger(g.connection.generation))continue;
   if(connection!==undefined&&(connection?.id!==g.connection.id||connection?.generation!==g.connection.generation))continue;
   let live=false;if(evidence)live=evidence.connectionLive===true;else try{live=await this.connections?.check?.(g.connection,g.clientId)===true;}catch{live=false;}if(!live)continue;
   return {grant:g,ceiling:own(g.methods,field)};
  }
  return null;
 },

 /** relations.certify (system). `input`: {client:{client_id, origin}, grants:[id], field, resource (imp_ id), delegate,
  * member?:{principal, membership_id, generation}, connection?:{id, generation}, lifetime?}. */
 certify(actor,input){return this.system(actor,async(r,now,tx)=>{
  const refuse=()=>fail('relation_certificate_unavailable','This resource is unavailable.',403);
  if(!plain(input)||Object.keys(input).some(k=>!['client','grants','field','resource','delegate','member','connection','lifetime','evidence'].includes(k))||!plain(input.client)||typeof input.client.client_id!=='string'||typeof input.client.origin!=='string'||typeof input.field!=='string'||typeof input.resource!=='string')refuse();
  if(await this.closing(tx))refuse();
  const found=await importById(tx,input.resource,now);if(!found?.available)refuse();
  const grantor=party(found.row.grantor),part=await tx.get(K.instance(found.row.instance)),cp=part?await tx.get(K.cp(part.instance,grantor)):null;if(!part||!cp||!incomingLive(part,cp))refuse();
  const app=await this.applicationHop(tx,{grants:input.grants,clientId:input.client.client_id,field:input.field,resource:input.resource,connection:input.connection,evidence:input.evidence});if(!app)refuse();
  let methods,member=null;
  if(input.member!==undefined){
   const m=input.member;if(!plain(m)||!validPrincipal(m.principal)||typeof m.membership_id!=='string'||!Number.isSafeInteger(m.generation))refuse();
   member=await tx.get('org/member/'+principalKey(m.principal));if(member?.state!=='live'||member.id!==m.membership_id||member.generation!==m.generation)refuse();
   methods=importAuthority({member,application:app.ceiling,found,now});
  }else methods=intersect(app.ceiling,found.resource.methods);
  // Review L6 (provisional policy): while the grantor is fully held under RL-4, only read methods are certified.
  if((await this.activeHold(tx,grantor,now))?.kind==='full')methods=Object.fromEntries(Object.entries(methods).map(([c,ms])=>[c,ms.filter(m=>!this.isWrite(c,m))]).filter(([,ms])=>ms.length));
  if(!Object.keys(methods).length)refuse();
  const doc=await this.docFor(tx,part.relation),entry=edgeEntries(doc,cp.slot,cp.as).find(e=>e.index===found.row.entry),current=await this.currentOf(tx,grantor),me=this.self(r.id);
  const actorClaim={...member?{member:entry?.actor_disclosure==='named'?party(member.principal):await pairwiseActor({org:me,counterpart:grantor,membershipId:member.id})}:{},client:input.client.client_id};
  const signer=await this.certification?.(r.id);if(!signer?.kid||!signer.privateKey)refuse();
  let out;try{out=await signEntityCertificate({issuer:this.issuer,org:r.id,identity:identityURI(me),aud:identityURI(current),instance:part.instance,client:input.client,actor:actorClaim,resource:found.resource.resource,methods,...found.resource.scope?{scope:found.resource.scope}:{},aep:r.aep??0,delegate:input.delegate,lifetime:input.lifetime,now},signer);}catch{refuse();}
  return {...out,methods,resource:found.resource.resource,grantor:identityURI(current),instance:part.instance,broker:{origin:current.iss,endpoint:this.brokerEndpoint?.(current)??`${current.iss}/bindle/rpc`,resource:found.resource.resource}};
 });},

 /** relations.authorize (system; the RPC and token-endpoint adapters, ORG-10f). `input`:
  *   {form:'direct', certificate, proof, htm, htu, envelope:{resource, contract, method, args?, tx?}}   the direct form
  *   {form:'token', certificate, proof, htm, htu}                                                     the token form's
  *     exchange at the token endpoint (no envelope): steps 1–3, the aep floor and a live edge still granting the
  *     certificate's resource; mints a DPoP-bound relation access token (no refresh token, expiry ≤ the certificate's)
  *   {form:'bound', token, proof, htm, htu, envelope}   a call with that token: the proof by the bound key (ath = the
  *     token), then the same authorization as the direct form against the certificate recorded at the exchange.
  * Returns {allowed:true, context} (plus `token` for the exchange) or throws the ONE uniform failure: `invalid_grant`
  * (400) for the exchange, `invalid_token` (401) otherwise. */
 async authorize(actor,input){
  if(actor?.kind!=='system')fail('forbidden','System only.',403);
  const form=['token','bound'].includes(input?.form)?input.form:'direct',refuse=()=>form==='token'?fail('invalid_grant','invalid_grant',400):fail('invalid_token','invalid_token',401);
  if(form==='bound')return this.authorizeBound(actor,input,refuse);
  // The token form without an envelope is the token endpoint's exchange; with an envelope it authorizes one call
  // from token-form evidence (as before the exchange existed).
  const exchange=form==='token'&&input?.envelope===undefined;
  const now=this.clock.now(),seconds=Math.floor(now/1000),me=this.self(actor.owner),env=plain(input?.envelope)?input.envelope:{};
  const parsed=parseEntityCertificate(input?.certificate,{allowLoopback:this.allowLoopback===true}),c=parsed?.payload??null;
  const write=exchange?false:typeof env.contract==='string'&&typeof env.method==='string'?this.isWrite(env.contract,env.method):true;
  // Step 1, offline part.
  let ok=Boolean(c)&&(exchange||plain(input?.envelope));
  if(c&&(c.aud!==identityURI(me)||seconds>c.exp+ENTITY_SKEW_SECONDS||c.iat>seconds+ENTITY_SKEW_SECONDS||seconds>c.iat+ENTITY_CERTIFICATE_SECONDS+ENTITY_SKEW_SECONDS))ok=false;
  if(c&&write&&(seconds-c.iat>ENTITY_WRITE_AGE_SECONDS||c.iat>seconds+ENTITY_WRITE_FUTURE_SECONDS))ok=false;
  const presented=c?{iss:c.iss,sub:c.sub}:null,key=presented?await this.cachedKey(presented,parsed.header.kid):null;
  const result=await this.system(actor,async(r,_,tx)=>{
   // Step 1, the edge (no fetch): the presented issuer is the origin principal's current one.
   const origin=presented?await this.originOf(tx,presented):null,current=origin?await this.currentOf(tx,origin):null;
   // Review R3-L1: a missing key schedules a refresh only for a counterpart recognized in the named instance.
   if(presented&&!key&&samePrincipal(current,presented)&&typeof c.instance==='string'){const known=await tx.get(K.cp(c.instance,origin));if(known&&known.state!=='ended')await this.scheduleRefresh(tx,r.id,presented,now);}
   let good=ok&&Boolean(origin)&&samePrincipal(current,presented);
   const part=good?await tx.get(K.instance(c.instance)):null,cp=part?await tx.get(K.cp(c.instance,origin)):null;if(!outgoingLive(part,cp,now))good=false;
   // Step 2 (cache-only key; dummy verification otherwise).
   const signed=good&&key&&c.identity===identityURI(presented)&&(key.identity===undefined||key.identity===c.identity)?await verifyEntitySignature(parsed,key.publicJwk):await dummyVerify();
   if(!signed)return {ok:false};
   // Step 3: the holder's DPoP proof and its jti, once.
   if(!await entityHolderKey(c))return {ok:false};
   let proof;try{proof=await verifyProof(globalThis.crypto,input.proof,{typ:DPOP_TYP,htm:input.htm,htu:input.htu,now,window:60,...form==='direct'?{ath:input.certificate}:{}});}catch{return {ok:false};}
   if(proof.jkt!==c.cnf.jkt||!await this.proofOnce(tx,proof,now))return {ok:false};
   // The aep floor (spec §9.5): lower fails; higher is an authority reset, held before refusing (RL-4).
   const floorRow=await tx.get(K.aep(origin)),floor=floorRow?.aep??0;
   if(c.aep<floor)return {ok:false};
   if(c.aep>floor){await tx.put(K.aep(origin),{aep:c.aep,at:now,...floorRow?{}:{baseline:true}});if(floorRow){await this.applyReset(tx,r,origin,{aep:c.aep,cause:'aep-increase'},now);return {ok:false};}}
   if(exchange){
    // The token form's exchange: some method of the certificate on its resource is still granted on the live edge in
    // this instance (scope and the write age rule apply at each call). The token is bound to the certificate's key.
    let any=false;for(const [contract,methods] of Object.entries(plain(c.methods)?c.methods:{}))for(const method of Array.isArray(methods)?methods:[]){if(any)break;try{any=await this.edgeDecision(tx,{instance:c.instance,grantee:origin,resource:c.resource,contract,method,unscoped:true},now);}catch{any=false;}}
    if(!any)return {ok:false};
    const token=`rel1.${r.id}.${await this.secret()}`,hash=await digest(globalThis.crypto,`bindle-relation-access\0${token}`),expiresAt=Math.min(c.exp*1000,now+ENTITY_CERTIFICATE_SECONDS*1000);
    if(expiresAt<=now)return {ok:false};
    await tx.put(ACCESS(hash),{v:1,certificate:{iss:c.iss,sub:c.sub,instance:c.instance,resource:c.resource,methods:structuredClone(c.methods),...c.scope?{scope:structuredClone(c.scope)}:{},aep:c.aep,actor:structuredClone(c.actor),client:{...c.client},iat:c.iat,exp:c.exp},origin:party(origin),presented:party(presented),jkt:c.cnf.jkt,expiresAt});
    await tx.put(ACCESS_AT(expiresAt,hash),true);
    return {ok:true,context:{grantee:party(origin),presented:party(presented),instance:c.instance,resource:c.resource,client:{...c.client}},token:{access_token:token,token_type:'DPoP',expires_in:Math.max(1,Math.floor((expiresAt-now)/1000))}};
   }
   return this.authorizeCall(tx,r,{c,origin,presented,env,write,now,me,cp});
  });
  if(!result.ok)refuse();
  return {allowed:true,context:result.context,...result.token?{token:result.token}:{}};
 },
 /** Records a DPoP proof's (jkt, jti) once; false for a replay. */
 async proofOnce(tx,proof,now){const h=await digest(globalThis.crypto,`bindle-entity-dpop\0${proof.jkt}\0${proof.jti}`);if(await tx.get(K.proof(h)))return false;
  const until=Math.max(proof.expiresAt,now+PROOF_KEEP_MS);await tx.put(K.proof(h),{expiresAt:until});await tx.put(K.proofAt(until,h),true);return true;},
 /** 32 random bytes, base64url (the bound token's secret). */
 async secret(){const bytes=globalThis.crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');},
 /** §9.5 authorization of one call (direct or bound form), after the certificate and proof checks: the hold, the write
  * age rule, the envelope within the certificate and its scope, and within the live edge grant in that instance only. */
 async authorizeCall(tx,r,{c,origin,presented,env,write,now,me}){
  const seconds=Math.floor(now/1000);
  if(write&&(seconds-c.iat>ENTITY_WRITE_AGE_SECONDS||c.iat>seconds+ENTITY_WRITE_FUTURE_SECONDS))return {ok:false};
  if(env.resource!==c.resource||typeof env.contract!=='string'||!Array.isArray(own(c.methods,env.contract))||!c.methods[env.contract].includes(env.method))return {ok:false};
  if(!relationScopeAllows(c.scope,{method:env.method,args:env.args,write}))return {ok:false};
  // Review L4: any throw inside the decision is the same uniform failure.
  let decided=false;try{decided=await this.edgeDecision(tx,{instance:c.instance,grantee:origin,resource:env.resource,contract:env.contract,method:env.method,args:env.args},now);}catch{decided=false;}
  if(!decided)return {ok:false};
  // Review L3: the scope the call runs under (edge ∩ certificate), which the dispatch passes to storage as `scope`.
  const cp=await tx.get(K.cp(c.instance,origin));
  // Use the very grant entry that can authorize this method and arguments. The same resource may occur in
  // different matrix entries with different methods/scopes; another occurrence's scope is not authority here.
  const scopes=(cp?.grant?.entries??[]).flatMap(e=>e.resources).filter(x=>x.resource===env.resource&&resourceLive(x,now)&&Array.isArray(own(x.methods,env.contract))&&x.methods[env.contract].includes(env.method)&&relationScopeAllows(x.scope,{method:env.method,args:env.args,write})).map(x=>composeRelationScope(x.scope,c.scope));
  const assignedScope=scopes.find(scope=>scope!==null);if(assignedScope===undefined)return {ok:false};
  return {ok:true,context:{assignedScope,grantee:party(origin),presented:party(presented),instance:c.instance,resource:c.resource,contract:env.contract,method:env.method,write,actor:structuredClone(c.actor),client:{...c.client},aep:c.aep,exp:c.exp,
   journal:{grantor:identityURI(me),grantee:identityURI(origin),client_id:c.client.client_id,tx:typeof env.tx==='string'?env.tx:null}}};
 },
 /** The bound form: a call presenting a relation access token minted by the exchange. */
 async authorizeBound(actor,input,refuse){
  const now=this.clock.now(),me=this.self(actor.owner),env=plain(input?.envelope)?input.envelope:null,token=typeof input?.token==='string'&&BOUND.test(input.token)?input.token:null;
  const write=env&&typeof env.contract==='string'&&typeof env.method==='string'?this.isWrite(env.contract,env.method):true;
  const result=await this.system(actor,async(r,_,tx)=>{
   if(!token||!env||token.split('.')[1]!==r.id)return {ok:false};
   const hash=await digest(globalThis.crypto,`bindle-relation-access\0${token}`),row=await tx.get(ACCESS(hash));
   if(!row||row.expiresAt<=now)return {ok:false};
   let proof;try{proof=await verifyProof(globalThis.crypto,input.proof,{typ:DPOP_TYP,htm:input.htm,htu:input.htu,now,window:60,ath:token});}catch{return {ok:false};}
   if(proof.jkt!==row.jkt||!await this.proofOnce(tx,proof,now))return {ok:false};
   // The presented issuer must still be the origin principal's current one, and the aep floor still holds.
   const origin=await this.originOf(tx,row.presented);if(!samePrincipal(origin,row.origin)||!samePrincipal(await this.currentOf(tx,origin),row.presented))return {ok:false};
   if(row.certificate.aep<((await tx.get(K.aep(origin)))?.aep??0))return {ok:false};
   return this.authorizeCall(tx,r,{c:row.certificate,origin,presented:row.presented,env,write,now,me});
  });
  if(!result.ok)refuse();
  return {allowed:true,context:result.context};
 },
 /** Drops expired entity-certificate replay rows (bounded; the sweep calls it). */
 async pruneProofs(tx,now,budget=1024){let n=0;for(const [key] of await tx.list({prefix:'rel/proof-at/',limit:budget})){const at=Number(key.split('/')[2]);if(at>now)break;await tx.delete(key);await tx.delete(K.proof(key.slice(key.lastIndexOf('/')+1)));n++;}
  for(const [key] of await tx.list({prefix:'rel/access-at/',limit:budget})){const at=Number(key.split('/')[2]);if(at>now)break;await tx.delete(key);await tx.delete(ACCESS(key.slice(key.lastIndexOf('/')+1)));n++;}return n;},

 /**
  * relations.import-authority: the acting member's effective methods on one import for one application connection.
  * The application ceiling is the active federation grant's, on a live connection at the generation it recorded (the
  * connection-generation fence, review L4), never a caller-supplied value; the membership generation must match.
  */
 importAuthority(actor,input){return this.metadata.transaction(async tx=>{
  const r=await this.orgs.organization(tx,actor),now=this.clock.now(),member=r.memberships?.[principalKey(actor.principal)];if(member?.state!=='live')fail('not_found','Not found.',404);
  if(!plain(input)||Object.keys(input).some(k=>!['resource','grant','field','generation'].includes(k))||typeof input.resource!=='string'||typeof input.grant!=='string'||typeof input.field!=='string')fail('invalid_request','Unsupported relation request.',400);
  if(input.generation!==member.generation)return {methods:{}};
  const app=await this.applicationHop(tx,{grants:[input.grant],clientId:(await tx.get('federation/grant/'+input.grant))?.clientId,field:input.field,resource:input.resource});
  const found=await importById(tx,input.resource,now);return {methods:app?importAuthority({member,application:app.ceiling,found,now}):{}};
 });},
};

/**
 * The FederationService `relationImports` port over relations.certify (packages/federation/service.mjs projection hunk).
 * `certify(input)` dispatches the system operation in the organization's writer; `clientOrigin(clientId)` is the
 * registered client's verified origin. The certificate's holder key must be the token's DPoP key (`jkt`); without the
 * key's public JWK no relay token is issued (the member is reported `unavailable`).
 */
export function federationRelationImports({certify,clientOrigin}){
 return Object.freeze({async certify(input){
  const origin=clientOrigin?.(input?.clientId);if(typeof origin!=='string'||typeof input?.jkt!=='string'||!plain(input.delegate))fail('relation_certificate_unavailable','This resource is unavailable.',403);
  const {jwkThumbprint}=await import('../identity/delegation.mjs');if(await jwkThumbprint(input.delegate)!==input.jkt)fail('relation_certificate_unavailable','This resource is unavailable.',403);
  const m=input.member;
  return certify({client:{client_id:input.clientId,origin},grants:input.grants,field:input.field,resource:input.resource,delegate:input.delegate,
   ...plain(m)?{member:{principal:m.principal,membership_id:m.membership_id??m.membership?.id,generation:m.generation??m.membership?.generation}}:{},...plain(input.connection)?{connection:{id:input.connection.id,generation:input.connection.generation}}:{}});
 }});
}

// ---- engine operations (system: adapters build the actor from verified evidence; never wire-dispatchable) ----------
export class CertifyRelationAccess extends AppAction{static operation='relations.certify';static deps=['relations'];run({relations}){return relations.certify(this.actor,this.input);}}
export class AuthorizeRelationAccess extends AppAction{static operation='relations.authorize';static deps=['relations'];run({relations}){return relations.authorize(this.actor,this.input);}}
export const RELATION_ACCESS_SYSTEM_OPERATIONS=Object.freeze([CertifyRelationAccess,AuthorizeRelationAccess]);
