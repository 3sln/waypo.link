// ORG-10f account slice: organization relations (docs/architecture/organizations-design.md §8b.10; engine operations in
// packages/app/domains/relations.mjs, rules in packages/orgs/relation-*.mjs). Provisional (coordinator), not signed off
// by the user; behind ORG_RELATIONS_ENABLED and ORG_FOREIGN_RELATIONS_ENABLED (both default off, RL-1). `methods` are
// installed on AccountController.prototype (`this` is the controller); `rpc` lists what `invoke` accepts.
//
// Organization placement (an organization's account single writer):
//   relationsDispatch(org, {operation, actor, input})  owner-route operations; the actor is resolved here by the ORG-0
//                                                      seam (packages/orgs/authority.mjs), never taken from the caller
//   relationsPeer(org, {operation, input})             same-host transport target (RL-15): relations.offer, retract,
//                                                      redeem and ingest from another organization's writer on this
//                                                      host. Offers, retractions and redemptions carry `from`, the
//                                                      sending writer's own binding set by sameHostRelationTransport
//                                                      (server code only; never a request body); events carry none
//                                                      and are verified by signature. Gate 'none': it never waits on
//                                                      this writer's account gate, so two writers calling each other
//                                                      cannot deadlock; each step is its own storage transaction.
//   relationsPublicKeys(subject)                       local read for peers (gate none): kind, handle, active identity
//                                                      signing keys, certification keys and `aep`
//   relationsCertify(org, input)                       the federation shard's relay projection (preferences/v2):
//                                                      relations.certify with the shard's grant records and this
//                                                      writer's connection check as evidence
//   relationsRPC(org, {authorization, dpop, envelope, htu})  the grantor's RPC adapter: relations.authorize (direct
//                                                      `BindleEntity` form or a bound relation token), then the storage
//                                                      dispatch under the composed scope as `assignedScope`
//   relationsToken(org, {assertion, clientId, dpop, htu})    the token endpoint's exchange (spec §7.1 token form)
//   relationsEvent(org, jws)                           the HTTP events endpoint (inbound revocation never flag-gated)
//   relationsJoin(org, {invitation, statement})        the HTTP join endpoint (foreign redemptions, ORG-11; gated);
//                                                      no `from`: the statement's verified signer is the evidence
//   relationsAlarm()                                   account alarm hook: relations.tick and the counterpart key refresh
//   relationsPurgeGate(org)                            the deletion hand-off gate: the pre-purge leave step, then true
//                                                      only once relations.purge-ready (certification keys stay
//                                                      published until then, production gate 5)
//
// Ports (all built here; nothing on the request path fetches another provider):
//   signer / certification   the organization's identity signing key and certification key, loaded OUTSIDE any
//                            storage transaction by `prime` and handed to the service from memory (the Node store
//                            serializes transactions, so a key read inside one would wait on itself)
//   counterparts.resolve     local principals only: the peer's relationsPublicKeys, memoized for 60 s and primed for
//                            the principals a call names (the sender binding, the invitee, the event's claimed sender)
//   certificationKey         CACHE-ONLY: rel/keycache/<principal> rows written by the background refresh, loaded into
//                            memory by `prime` (spec §9.9 step 3 never fetches)
//   resources / pool         the organization's own object-storage resources (resource/<uuid>), as federation ids
//                            <origin>/entities/<org>/resources/<uuid>; imports are never in the pool (spec §9.7)
//   documents / catalogue    the RL-14 catalogue (packages/orgs/relation-catalogue.mjs)
//   transport                sameHostRelationTransport over relationsPeer; foreign counterparts are refused (ORG-11)
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleBlocked} from '../lifecycle-runner.mjs';
import {accountActor} from '../../orgs/authority.mjs';
import {ORG_RECORD} from '../../orgs/organizations.mjs';
import {loadOrganization} from '../../orgs/roster.mjs';
import {principalKey} from '../../orgs/grants.mjs';
import {organizationsProvider,ObserveMemberAuthority} from '../../app/domains/orgs.mjs';
import {RelationService,relationsProvider,sameHostRelationTransport,RELATION_OWNER_OPERATIONS,RedeemRelation,OfferRelation,RetractRelationOffer,IngestRelationEvent,RelationTick,RelationOutboxDrain,RelationLifecycleEvent,RelationPurgeReady,ObserveRelationCounterpart,CertifyRelationAccess,AuthorizeRelationAccess,ORG_RELATIONS_FLAG,ORG_FOREIGN_RELATIONS_FLAG} from '../../app/domains/relations.mjs';
import {relationDocuments} from '../../orgs/relation-documents.mjs';
import {inviterOf} from '../../orgs/relation-invitations.mjs';
import {relationCatalogue,OBJECT_STORAGE} from '../../orgs/relation-catalogue.mjs';
import {dueMemberKeyRefreshes,removeMemberKeyRefresh,rescheduleMemberKeyRefresh} from '../../orgs/key-refresh.mjs';
import {certificationSigner,certificationKeyList} from '../../identity/member-certificates.mjs';
import {jwkThumbprint} from '../../identity/delegation.mjs';
import {storageScopeOptions} from '../../storage/scoping.mjs';
import {digest} from '../../core/records.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {orgsEngine,orgsClock} from './orgs.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEMO_MS=60000,KEY_CACHE_MS=3600000,KEYCACHE='rel/keycache/',PEER_OPERATIONS=Object.freeze({'relations.offer':OfferRelation,'relations.retract':RetractRelationOffer,'relations.redeem':RedeemRelation,'relations.ingest':IngestRelationEvent});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const decode=segment=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(segment.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-segment.length%4)%4)),c=>c.charCodeAt(0))));}catch{return null;}};
/** The UNVERIFIED payload of a compact JWS, as a routing/priming hint only (never authority). */
export const jwsHint=value=>{const parts=typeof value==='string'&&value.length<=32768?value.split('.'):[];return parts.length===3?decode(parts[1]):null;};
const pub=k=>({kty:'EC',crv:'P-256',x:k.x,y:k.y});
/** The federation id of an import mirror (the federation store keys resources by URL). */
export const importResourceId=(origin,org,imp)=>`${origin}/entities/${org}/relations/imports/${imp}`;

// ---- per-controller memory (keys and party records loaded outside transactions) -------------------------------------
const memories=new WeakMap();
function memory(c){let m=memories.get(c);if(!m){m={signing:new Map(),certification:new Map(),parties:new Map(),keycache:new Map()};memories.set(c,m);}return m;}
const fresh=(entry,now)=>entry&&now-entry.at<MEMO_MS;

/** A local principal's public record (kind, handle, keys, aep): this writer for its own owner, else the peer writer. */
async function fetchParty(c,sub){
 if(!UUID.test(sub??''))return null;
 if(await c.metadata.get('owner')===sub)return c.relationsPublicKeys(sub);
 const stub=c.config.CONVERSATION_ACCOUNT?.(sub);if(!stub)return null;
 try{const result=await stub.invoke({method:'relationsPublicKeys',args:[sub]});return result?.$fault?null:result??null;}catch{return null;}
}
async function resolveParty(c,p){
 if(p?.iss!==c.config.APP_ORIGIN||!UUID.test(p?.sub??''))return null;const m=memory(c),now=Date.now(),hit=m.parties.get(p.sub);if(fresh(hit,now))return hit.value;
 const value=await fetchParty(c,p.sub);m.parties.set(p.sub,{value,at:now});if(m.parties.size>2048)m.parties.delete(m.parties.keys().next().value);return value;
}
/** Loads, outside any storage transaction, everything a relation step may need from memory: this organization's signing
 * and certification keys, the named parties' public records, and the key-cache rows of claimed senders. */
async function prime(c,owner,{parties=[],senders=[]}={}){
 // The organization identity's authority epoch comes from identity evidence, never a request. Keep the engine's
 // issuance/event epoch in step with recovery completion before it signs anything (ordinary key rotation is not a reset).
 const identity=await c.config.IDENTITY_ACCOUNT?.(owner);
 if(Number.isSafeInteger(identity?.aep))await c.metadata.transaction(async tx=>{const r=await tx.get(ORG_RECORD);if(r?.kind==='organization'&&identity.aep>(r.aep??0))await tx.put(ORG_RECORD,{...r,aep:identity.aep});});
 const m=memory(c),now=Date.now();
 if(!fresh(m.signing.get(owner),now))try{const k=await c.signingKey(owner);m.signing.set(owner,{value:k?{kid:k.kid,privateKey:k.privateKey}:null,at:now});}catch{m.signing.set(owner,{value:null,at:now});}
 if(!fresh(m.certification.get(owner),now))try{const k=await certificationSigner({metadata:c.metadata,seal:v=>encryptSecret(v,c.config.KEY_ENCRYPTION_KEY),open:v=>decryptSecret(v,c.config.KEY_ENCRYPTION_KEY)})(owner);m.certification.set(owner,{value:k?{kid:k.kid,privateKey:k.privateKey}:null,at:now});}catch{m.certification.set(owner,{value:null,at:now});}
 for(const p of [{iss:c.config.APP_ORIGIN,sub:owner},...parties])if(plain(p))await resolveParty(c,p);
 for(const p of senders)if(plain(p)&&typeof p.iss==='string'&&typeof p.sub==='string'){const pk=principalKey({iss:p.iss,sub:p.sub});try{const row=await c.metadata.get(KEYCACHE+pk);if(row)m.keycache.set(pk,row);else m.keycache.delete(pk);}catch{/* cache miss */}}
}

/** The organization's own grantable pool: connected object-storage resources of this account, as federation ids. */
function storageResource(c,owner,r){
 if(!r||r.owner!==owner||r.kind==='app-connection'||r.status!=='connected'||!Array.isArray(r.contracts)||!r.contracts.includes(OBJECT_STORAGE)||!UUID.test(r.id??''))return null;
 const cap=r.capabilities??{},methods=['capabilities',...cap.read?['get']:[],...cap.write&&['hosted','google-drive'].includes(r.provider)?['delete','put']:[]];
 return {id:`${c.config.APP_ORIGIN}/entities/${owner}/resources/${r.id}`,label:typeof r.name==='string'?r.name:'Storage',contracts:{[OBJECT_STORAGE]:methods},scoping:{fields:storageScopeOptions(cap).fields}};
}

const engines=new WeakMap();
/** The organization's relations engine over its organization service (one per controller). */
export function relationsEngine(c){
 let entry=engines.get(c);if(entry)return entry;
 const orgs=orgsEngine(c),config=c.config,issuer=config.APP_ORIGIN,clock={now:()=>orgsClock(c)()},m=memory(c);
 const catalogue=()=>relationCatalogue();
 const documents=relationDocuments({fetch:async id=>(await catalogue()).fetch(id),fragment:async p=>(await catalogue()).fragment(p)});
 const prefixOf=owner=>`${issuer}/entities/${owner}/resources/`;
 const transport=sameHostRelationTransport({issuer,dispatch:async(sub,operation,input)=>{
  const stub=config.CONVERSATION_ACCOUNT?.(sub);if(!stub)throw Object.assign(new Error('Unavailable.'),{code:'temporarily_unavailable',status:503});
  const result=await stub.invoke({method:'relationsPeer',args:[sub,{operation,input}]});
  if(result?.$fault)throw Object.assign(new Error(result.$fault.message),{code:result.$fault.code,status:result.$fault.status});return result;}});
 const service=new RelationService({organizations:orgs.service,documents,transport,issuer,clock,random:cryptoRandom,
  catalogue:async()=>(await catalogue()).entries,
  signer:async owner=>m.signing.get(owner)?.value??null,
  certification:async owner=>m.certification.get(owner)?.value??null,
  counterparts:{
   resolve:async p=>{const value=await resolveParty(c,p);return value?{kind:value.kind,handle:value.handle??null,keys:Array.isArray(value.keys)?value.keys:[],aep:Number.isSafeInteger(value.aep)?value.aep:0}:null;},
   certificationKey:async({iss,sub,kid})=>{const row=m.keycache.get(principalKey({iss,sub}));if(!plain(row)||!(row.until>Date.now())||!Array.isArray(row.keys))return null;const k=row.keys.find(x=>x?.kid===kid&&x.state==='active');return k?{publicJwk:pub(k.publicJwk),...typeof row.identity==='string'?{identity:row.identity}:{}}:null;}},
  resources:async(tx,id)=>{const owner=await tx.get('owner');if(typeof id!=='string'||!id.startsWith(prefixOf(owner)))return null;const uuid=id.slice(prefixOf(owner).length);if(!UUID.test(uuid))return null;const r=storageResource(c,owner,await tx.get('resource/'+uuid));return r?{id,contracts:r.contracts,scoping:r.scoping}:null;},
  pool:async tx=>{const owner=await tx.get('owner'),out=[];for(const r of (await tx.list({prefix:'resource/',limit:201})).values()){const s=storageResource(c,owner,r);if(s)out.push(s);}return out;},
  connections:{check:async()=>false},// the runtime passes the connection check as certify evidence (relationsCertify)
  federationSubject:owner=>`${issuer}/entities/${owner}`,
  allowLoopback:config.LOCAL_DEVELOPMENT==='true',federationEvidence:true});
 entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,organizations:organizationsProvider(orgs.service),relations:relationsProvider(service)}})};
 engines.set(c,entry);return entry;
}
const run=(c,operation)=>operation instanceof AppQuery?read(relationsEngine(c).engine,operation):perform(relationsEngine(c).engine,operation);
const system=owner=>({kind:'system',owner});
const isOrganization=async c=>(await c.metadata.get(ORG_RECORD))?.kind==='organization';
const relationsFlag=(c,owner,name=ORG_RELATIONS_FLAG)=>{try{return flagsFor(c.config,{subject:{kind:'account',owner}}).enabled(name)===true;}catch{return false;}};
const uniformToken=token=>token?new StorageError('invalid_grant','invalid_grant',400):new StorageError('invalid_token','invalid_token',401);

/** Delivers queued relation events and offers now (bounded), then schedules the alarm for whatever remains. */
async function flush(c,owner){
 try{await run(c,new RelationOutboxDrain({actor:system(owner),input:{limit:32}}));
  await c.scheduleAlarm(Date.now()+1000);}
 catch{try{await c.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}}
}

/** Refreshes the certification-key cache of relation counterparts and of claimed senders queued by the request path
 * (spec §9.9 step 3, §9.5: verification uses only keys already held). Background only; never the request path. */
async function refreshKeys(c,owner){
 const now=Date.now(),issuer=c.config.APP_ORIGIN,todo=new Map();let next=null;
 const due=await c.metadata.transaction(tx=>dueMemberKeyRefreshes(tx,now,64));
 for(const [key,row] of due)if((row.issuer??issuer)===issuer&&UUID.test(row.subject??''))todo.set(principalKey({iss:issuer,sub:row.subject}),{p:{iss:issuer,sub:row.subject},key});
 // Recognized counterparts whose cached keys are missing or half-way stale (a bounded scan of this view).
 for(const cp of (await c.metadata.list({prefix:'rel/cp/',limit:1024})).values()){if(cp?.state==='ended'||cp?.principal?.iss!==issuer)continue;const pk=principalKey(cp.principal);if(todo.has(pk))continue;
  const row=await c.metadata.get(KEYCACHE+pk);if(!row||row.until-now<KEY_CACHE_MS/2)todo.set(pk,{p:{iss:cp.principal.iss,sub:cp.principal.sub}});else next=Math.min(next??Infinity,row.until-KEY_CACHE_MS/2);}
 let done=0;
 for(const [pk,{p,key}] of [...todo].slice(0,128)){
  const found=await fetchParty(c,p.sub);
  if(found?.kind!=='organization'){
   next=Math.min(next??Infinity,now+60000);
   if(key)await c.metadata.transaction(tx=>rescheduleMemberKeyRefresh(tx,key,{dueAt:now+60000,attempts:1}));
   continue;
  }// persons and unknown subjects stay for the member-key runner
  const row={identity:typeof found.identity==='string'?found.identity:`${issuer}/identity/${p.sub}`,keys:(Array.isArray(found.certification)?found.certification:[]).slice(0,16).map(k=>({kid:k.kid,state:k.state,publicJwk:pub(k.publicJwk)})),until:now+KEY_CACHE_MS};
  await c.metadata.transaction(async tx=>{await tx.put(KEYCACHE+pk,row);if(key)await removeMemberKeyRefresh(tx,key);});memory(c).keycache.set(pk,row);
  await run(c,new ObserveRelationCounterpart({actor:system(owner),input:{counterpart:p,aep:found.aep??0}}));done++;
  next=Math.min(next??Infinity,row.until-KEY_CACHE_MS/2);
 }
 return {done,wakeAt:Number.isFinite(next)?Math.max(now+1000,next):null};
}

/** Bounded untrusted inbox: a cold-cache event is retried by the alarm after background refresh. This is not a
 * verified-event/jti record and confers no authority. The engine still verifies its signature and all live fences. */
const eventKeyHeld=(c,event)=>{
 const hint=jwsHint(event),header=decode(typeof event==='string'?event.split('.')[0]:'');
 if(typeof hint?.iss!=='string'||typeof hint?.sub!=='string')return false;
 const row=memory(c).keycache.get(principalKey({iss:hint.iss,sub:hint.sub}));
 return row?.until>Date.now()&&row.keys?.some(k=>k.kid===header?.kid&&k.state==='active');
};
async function retryInbox(c,owner){
 let pending=false;
 for(const [key,row] of await c.metadata.list({prefix:'rel/inbox/',limit:64})){
  let done=false;
  try{const hint=jwsHint(row.event);await prime(c,owner,{senders:hint?[{iss:hint.iss,sub:hint.sub}]:[]});
   if(eventKeyHeld(c,row.event)){
    await run(c,new IngestRelationEvent({actor:system(owner),input:{event:row.event}}));done=true;
   }
  }catch{/* a transient fault retries this row without starving the rest */}
  if(done||Date.now()-(row.at??0)>300000||(row.attempts??0)>=5)await c.metadata.delete(key);
  else {await c.metadata.put(key,{...row,attempts:(row.attempts??0)+1});pending=true;}
 }
 if(pending)await c.scheduleAlarm(Date.now()+60000);
}

async function alarmStep(c,owner){
 const keys=await refreshKeys(c,owner);
 await retryInbox(c,owner);
 const tick=await run(c,new RelationTick({actor:system(owner)}));
 return {keys,tick};
}

export const methods={
 /** Ensures the relations service (and its organization commit hook) exists for this controller's organization. */
 relationsEnsure(){relationsEngine(this);},
 async relationsDispatch(owner,{operation,actor,input}={}){
  const Operation=RELATION_OWNER_OPERATIONS.find(O=>O.operation===operation);if(!Operation)throw new StorageError('not_found','Not found.',404);
  const blocked=await lifecycleBlocked(this,'relationsDispatch',{lifecycle:Operation.lifecycle??'active'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  if(!await isOrganization(this))throw new StorageError('not_found','Not found.',404);
  if(actor?.entity?.kind==='organization'&&actor?.principal)await perform(orgsEngine(this).engine,new ObserveMemberAuthority({actor:system(owner),input:{principal:{iss:actor.principal.iss??this.config.APP_ORIGIN??null,sub:actor.principal.sub},aep:actor.aep??0}}));
  const resolved=await accountActor({owner,requested:actor,Operation,issuer:this.config.APP_ORIGIN??null,organization:principal=>loadOrganization(this.metadata,[principal])});
  await this.warm(owner);
  // Principals the step will resolve: an invitee, a candidate, a counterpart, or the inviter of a presented invitation.
  const parties=[input?.invitee,input?.candidate,input?.counterpart,input?.organization].filter(plain);const inviter=typeof input?.invitation==='string'?inviterOf(jwsHint(input.invitation)):null;if(inviter)parties.push(inviter);
  await prime(this,owner,{parties});
  const result=await run(this,new Operation({actor:resolved,...input===undefined?{}:{input:structuredClone(input)}}));
  if(!(Operation.prototype instanceof AppQuery))await flush(this,owner);
  return result;
 },
 async relationsPeer(owner,{operation,input}={}){
  const Operation=typeof operation==='string'&&Object.hasOwn(PEER_OPERATIONS,operation)?PEER_OPERATIONS[operation]:null;
  if(!Operation||!plain(input)||await this.metadata.get('owner')!==owner||!await isOrganization(this))throw new StorageError(operation==='relations.redeem'?'invitation_invalid':'not_found',operation==='relations.redeem'?'This invitation is invalid.':'Not found.',operation==='relations.redeem'?400:404);
  const hint=operation==='relations.ingest'?jwsHint(input.event):null;
  await prime(this,owner,{parties:plain(input.from)?[input.from]:[],senders:typeof hint?.iss==='string'&&typeof hint?.sub==='string'?[{iss:hint.iss,sub:hint.sub}]:[]});
  const result=await run(this,new Operation({actor:system(owner),input:structuredClone(input)}));
  if(operation==='relations.ingest'&&hint){
   if(!eventKeyHeld(this,input.event)){
    const key='rel/inbox/'+await digest(globalThis.crypto,input.event);
    await this.metadata.transaction(async tx=>{if((await tx.list({prefix:'rel/inbox/',limit:64})).size<64)await tx.put(key,{event:input.event,at:Date.now(),attempts:0});});
    await this.scheduleAlarm(Date.now()+1000);
   }
  }
  // Anything this step queued (edge states after a redemption, ends after an ingest) leaves on the next alarm, never
  // while the caller waits on this answer.
  try{if((await this.metadata.list({prefix:'rel/outbox/',limit:1})).size)await this.scheduleAlarm(Date.now()+1000);}catch{/* the alarm retries */}
  return result;
 },
 async relationsPublicKeys(subject){
  if(!UUID.test(subject??'')||await this.metadata.get('owner')!==subject||typeof this.config.IDENTITY_ACCOUNT!=='function')return null;
  const a=await this.config.IDENTITY_ACCOUNT(subject);if(a?.status!=='active')return null;
  const kind=a.kind==='organization'?'organization':'person',record=kind==='organization'?await this.metadata.get(ORG_RECORD):null;
  const keys=(await this.identityKeyHistory(subject,{purpose:'signing'})).filter(k=>k.state==='active'&&k.publicJwk?.x).map(k=>({kid:k.kid,publicJwk:pub(k.publicJwk)}));
  const certification=kind==='organization'?(await certificationKeyList(this.metadata,subject)).filter(k=>['active','retired'].includes(k.state)):[];
  return {kind,handle:typeof a.handle==='string'?a.handle:null,name:typeof record?.name==='string'?record.name:null,identity:a.identityUri??`${this.config.APP_ORIGIN}/identity/${subject}`,keys,certification,aep:Math.max(Number.isSafeInteger(record?.aep)?record.aep:0,Number.isSafeInteger(a.aep)?a.aep:0)};
 },
 async relationsCertify(owner,input={}){
  const refuse=()=>{throw new StorageError('relation_certificate_unavailable','This resource is unavailable.',403);};
  if(!plain(input)||await this.metadata.get('owner')!==owner||!await isOrganization(this))refuse();
  const prefix=importResourceId(this.config.APP_ORIGIN,owner,''),field=input.field;
  if(typeof input.resource!=='string'||!input.resource.startsWith(prefix)||typeof field!=='string'||typeof input.clientId!=='string'||typeof input.clientOrigin!=='string'||!plain(input.delegate)||typeof input.jkt!=='string')refuse();
  if(await jwkThumbprint(input.delegate).catch(()=>null)!==input.jkt)refuse();
  const imp=input.resource.slice(prefix.length);if(!/^imp_[A-Za-z0-9_-]{32}$/.test(imp))refuse();
  // The application hop's evidence: the federation shard's grant records (ids rewritten to the import id) and this
  // writer's own connection check, made here outside any storage transaction.
  const grants={};for(const g of (Array.isArray(input.grantRecords)?input.grantRecords:[]).slice(0,16))if(plain(g)&&typeof g.id==='string'){
   const resources=plain(g.resources)?Object.fromEntries(Object.entries(g.resources).map(([f,ids])=>[f,Array.isArray(ids)?ids.map(id=>id===input.resource?imp:id):ids])):g.resources;
   const resourceGenerations=plain(g.resourceGenerations)?Object.fromEntries(Object.entries(g.resourceGenerations).map(([id,v])=>[id===input.resource?imp:id,v])):g.resourceGenerations;
   grants[g.id]={...structuredClone(g),resources,resourceGenerations};}
  const connection=plain(input.connection)&&typeof input.connection.id==='string'&&Number.isSafeInteger(input.connection.generation)?{id:input.connection.id,generation:input.connection.generation}:null;
  let connectionLive=false;if(connection)try{await this.apps.check(owner,connection.id,connection.generation,input.clientId);connectionLive=true;}catch{connectionLive=false;}
  const m=input.member;await prime(this,owner);
  const out=await run(this,new CertifyRelationAccess({actor:system(owner),input:{client:{client_id:input.clientId,origin:input.clientOrigin},grants:Object.keys(grants),field,resource:imp,delegate:input.delegate,
   ...plain(m)?{member:{principal:m.principal,membership_id:m.membership_id??m.membership?.id,generation:m.generation??m.membership?.generation}}:{},...connection?{connection}:{},evidence:{grants,connectionLive}}}));
  return out;
 },
 async relationsRPC(owner,{authorization,dpop,envelope,htu}={}){
  if(!await isOrganization(this)||await this.metadata.get('owner')!==owner)throw uniformToken(false);
  const direct=typeof authorization==='string'&&authorization.startsWith('BindleEntity ')?authorization.slice(13).trim():null,bound=typeof authorization==='string'&&authorization.startsWith('DPoP rel1.')?authorization.slice(5).trim():null;
  if(!direct&&!bound)throw uniformToken(false);
  const env=plain(envelope)?envelope:{};
  if(direct){const hint=jwsHint(direct);await prime(this,owner,{senders:typeof hint?.iss==='string'&&typeof hint?.sub==='string'?[{iss:hint.iss,sub:hint.sub}]:[]});}
  // relations.authorize answers its ONE failure, which passes through unchanged (production gate 6).
  const {context}=await run(this,new AuthorizeRelationAccess({actor:system(owner),input:{form:direct?'direct':'bound',...direct?{certificate:direct}:{token:bound},proof:dpop,htm:'POST',htu,envelope:{resource:env.resource,contract:env.contract,method:env.method,args:env.args,tx:env.tx}}}));
  if(Object.keys(env).some(k=>!['version','tx','resource','contract','method','args'].includes(k))||env.version!=='0'||typeof env.tx!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.tx)||!plain(env.args))throw new StorageError('invalid_request','Invalid request.',400);
  // The storage dispatch runs under the composed scope (edge ∩ certificate) as the call's assigned scope (review L3),
  // so the adapter refuses, for example, a `get` of an object larger than maxObjectBytes. The journal key carries
  // (grantor, acting entity, client_id, tx) (spec §9.5).
  const result=await this.federationRPC({subject:`${this.config.APP_ORIGIN}/entities/${owner}`,resource:env.resource,contract:env.contract,method:env.method,args:structuredClone(env.args),tx:env.tx,clientId:`relation:${context.journal.grantee} ${context.journal.client_id}`,scope:structuredClone(context.assignedScope??{}),authority:'relation'});
  return {version:'0',tx:env.tx,result};
 },
 async relationsToken(owner,{assertion,clientId,dpop,htu}={}){
  if(!await isOrganization(this)||await this.metadata.get('owner')!==owner)throw uniformToken(true);
  const hint=jwsHint(assertion);if(typeof clientId!=='string'||hint?.client?.client_id!==clientId)throw uniformToken(true);
  await prime(this,owner,{senders:typeof hint?.iss==='string'&&typeof hint?.sub==='string'?[{iss:hint.iss,sub:hint.sub}]:[]});
  const out=await run(this,new AuthorizeRelationAccess({actor:system(owner),input:{form:'token',certificate:assertion,proof:dpop,htm:'POST',htu}}));
  return {...out.token,bindle_entity:{instance:out.context.instance,resource:out.context.resource}};
 },
 async relationsEvent(owner,jws){
  if(!await isOrganization(this))throw new StorageError('not_found','Not found.',404);
  return this.relationsPeer(owner,{operation:'relations.ingest',input:{event:jws}});
 },
 async relationsJoin(owner,body){
  if(!await isOrganization(this)||!relationsFlag(this,owner,ORG_FOREIGN_RELATIONS_FLAG))throw new StorageError('not_found','Not found.',404);
  // Production gate 1: the sender is never taken from the body. A body naming anything but {invitation, statement}
  // (a `from` above all) is the uniform refusal; the statement's verified signer is the evidence.
  if(!plain(body)||Object.keys(body).some(k=>!['invitation','statement'].includes(k)))throw new StorageError('invitation_invalid','This invitation is invalid.',400);
  return this.relationsPeer(owner,{operation:'relations.redeem',input:{invitation:body.invitation,statement:body.statement}});
 },
 async relationsAlarm(){
  let owner;try{owner=await this.metadata.get('owner');if(!owner||!await isOrganization(this))return;
   // Nothing to do for an organization that never related (and reads nothing more).
   if(!await this.metadata.get('rel/state')&&!(await this.metadata.list({prefix:'rel/',limit:1})).size)return;
   await prime(this,owner);
   const {tick,keys}=await alarmStep(this,owner);
   const wake=[tick?.wakeAt,keys?.wakeAt].filter(Number.isSafeInteger);if(wake.length)await this.scheduleAlarm(Math.min(...wake));}
  catch{try{if(owner)await this.scheduleAlarm(Date.now()+300000);}catch{/* the next alarm retries */}}
 },
 async relationsPurgeGate(owner){
  if(await this.metadata.get('owner')!==owner||!await isOrganization(this))return true;
  if(!await this.metadata.get('rel/state'))return true;
  await prime(this,owner);
  await run(this,new RelationLifecycleEvent({actor:system(owner),input:{event:'deletion-effect'}}));
  await flush(this,owner);
  const ready=await run(this,new RelationPurgeReady({actor:system(owner)}));
  return ready?.ready===true;
 },
 /** The federation shard's resource sync (internal): this organization's import mirrors as federation descriptors. */
 async relationImportDescriptors(owner){
  if(await this.metadata.get('owner')!==owner||!await isOrganization(this))return [];const out=[];
  for(const r of (await this.metadata.list({prefix:'federation/resource/imp_',limit:512})).values())if(r?.provider==='relation'&&/^imp_[A-Za-z0-9_-]{32}$/.test(r.id??'')&&plain(r.contracts))
   out.push({id:importResourceId(this.config.APP_ORIGIN,owner,r.id),label:typeof r.label==='string'?r.label:'Imported resource',provider:'relation',contracts:structuredClone(r.contracts),grantor:{iss:r.grantor?.iss,sub:r.grantor?.sub},instance:r.instance,entry:r.entry,resource:r.resource,available:r.available===true,held:r.held===true,...Number.isSafeInteger(r.generation)?{generation:r.generation}:{}});
  return out;
 },
 /** Tests and operators (internal, never routed): one alarm step for this organization's relations. */
 async relationsFlush(owner){await prime(this,owner);return alarmStep(this,owner);},
};
export const rpc={relationsDispatch:{lifecycle:'suspended'},relationsPeer:{lifecycle:'suspended',gate:'none'},relationsPublicKeys:{gate:'none'},relationsCertify:{},relationsRPC:{activity:'resource-use'},relationsToken:{},relationsEvent:{lifecycle:'suspended',gate:'none'},relationsJoin:{gate:'none'},relationsFlush:{lifecycle:'suspended'},relationImportDescriptors:{}};
