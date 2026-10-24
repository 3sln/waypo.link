// ORG-4 account slice: member certificates (thin adapters over packages/identity/member-certificates.mjs and
// packages/orgs/certificates.mjs; docs/spec/organizations.md §5.2, §7). `this` is the AccountController.
//
// Home placement (a person's account):
//   memberCertificateConsent(owner, {client, input})   trusted adapter only: `client` is the OBSERVED client (R2-M3)
//   memberCertificateIssue(owner, {actor, input})      trusted adapter only: actor {kind:'owner'} or {kind:'app', client}
//   memberCertificateAcquire(owner, {client, input})   trusted adapter only: consent + first issuance, one transaction
//   memberCertificatesList / memberCertificatesRevoke  the member's own view and revocation (never flag-gated)
//   memberCertificateStatus(subject, jkt)              public status (gate none)
//   memberCertificateKeys(subject)                     local read for organizations on this host (gate none)
//   memberCertificateOrganization(owner, aud)          ORG-6a consent screen: who `aud` is (review M2); never consults
//                                                      membership (ORG-D9), and its answer goes only to the member
// Organization placement (an organization's account):
//   memberToken / memberDirect / memberAuthenticate    the wire forms; every failure is the uniform fault
//   memberContextEnd(org, input)                       ORG-2 hook: end tokens for a membership or principal
//   memberCertificateLifetime(org)                     the organization's lifetime, read by home issuers (gate none)
//   memberCertificateOrganizationName(org)             display name and handle of an active organization (gate none)
//   memberCertificateSettingsDispatch(org, request)    admin settings, actor resolved by ORG-0 `accountActor`
// Foreign issuers: the ORG-7 directory from ./foreign-directory.mjs (adapter-injected SSRF-screened egress) is the
// `foreign` port only while DIRECTORY_ENABLED and ORG_FOREIGN_MEMBERS_ENABLED are on; the engine is rebuilt when that
// gate changes. The allowlist ORG_FOREIGN_ISSUERS is empty by default, so foreign certificates still fail uniformly.
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {flagsFor} from './flags.mjs';
import {authorityEpoch} from '../../identity/authority-epoch.mjs';
import {MemberCertificateIssuer,memberCertificatesProvider,certificationSigner,certificationKeyList,memberCertificateLifetime,GrantMemberConsent,AcquireMemberConsentCertificate,IssueMemberCertificate,RevokeMemberConsent,RevokeMemberKey,MemberCertificateList,MemberCertificateStatus,MEMBER_CERTIFICATES_FLAG,MEMBER_CERTIFICATE_DEFAULT_SECONDS} from '../../identity/member-certificates.mjs';
import {MemberContextService,memberContextProvider,cachedIssuerKeys,directoryIssuerKeys,memberPrincipalKey,MemberToken,MemberTokenAdmit,MemberDirect,MemberAuthenticate,EndMemberTokens,MemberKeyRefresh,MemberKeysChanged,MEMBER_CONTEXT_OWNER_OPERATIONS,ORG_FOREIGN_MEMBERS_FLAG} from '../../orgs/certificates.mjs';
import {ORG_RECORD,ORG_EPOCH,ORGANIZATIONS_FLAG} from '../../orgs/organizations.mjs';
import {loadOrganization,ORG_KEYS} from '../../orgs/roster.mjs';
import {accountActor} from '../../orgs/authority.mjs';
import {orgsEngine,orgsClock} from './orgs.mjs';
import {billingStanding} from '../../orgs/ownership.mjs';
import {ORGANIZATION_PLANS} from '../../billing/organizations.mjs';
import {memberAccessCapacity} from '../../federation/member-access.mjs';
import {connectionState} from '../../apps/connections.mjs';
import {foreignDirectory,foreignDirectoryEnabled,foreignIssuers} from './foreign-directory.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identityURI=(config,id)=>`${config.APP_ORIGIN}/identity/${id}`;
/** The local organization a certificate audience names, or null (only `<APP_ORIGIN>/identity/<uuid>`). */
export function localAudience(config,aud){if(typeof aud!=='string'||!aud.startsWith(`${config.APP_ORIGIN}/identity/`))return null;const id=aud.slice(config.APP_ORIGIN.length+10);return UUID.test(id)?id:null;}
const identityOf=async(config,owner)=>typeof config.IDENTITY_ACCOUNT==='function'?config.IDENTITY_ACCOUNT(owner):null;
const peer=async(config,id,method,args)=>{const stub=config.CONVERSATION_ACCOUNT?.(id);if(!stub)return null;const result=await stub.invoke({method,args});return result?.$fault?null:result;};

const issuers=new WeakMap();
function issuerEngine(c){
 let engine=issuers.get(c);if(engine)return engine;const config=c.config;
 const issuer=new MemberCertificateIssuer({metadata:c.metadata,issuer:config.APP_ORIGIN,
  account:async owner=>{const a=await identityOf(config,owner);return a?{status:a.status}:null;},
  authorityEpoch:async owner=>{const a=await identityOf(config,owner);return a?.status==='active'?authorityEpoch(a):null;},
  identityURI:async owner=>(await identityOf(config,owner))?.identityUri??identityURI(config,owner),
  signer:certificationSigner({metadata:c.metadata,seal:value=>encryptSecret(value,config.KEY_ENCRYPTION_KEY),open:value=>decryptSecret(value,config.KEY_ENCRYPTION_KEY)}),
  orgLifetime:async aud=>{const org=localAudience(config,aud);return org?(await peer(config,org,'memberCertificateLifetime',[org]))?.certificateSeconds??null:null;},
  enabled:(owner,clientId)=>flagsFor(config,{subject:{kind:'account',owner},...clientId?{client:{clientId}}:{}}).enabled(MEMBER_CERTIFICATES_FLAG),
  lifetime:config.MEMBER_CERTIFICATE_SECONDS,allowLoopback:config.LOCAL_DEVELOPMENT==='true'});
 engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,memberCertificates:memberCertificatesProvider(issuer)}});issuers.set(c,engine);return engine;
}
/** ORG-2's membership record as the verifier's port (packages/orgs/memberships.mjs, read through its own service). */
export function membershipPort(c,org){
 return Object.freeze({
  // Item 5: the writer's clock (LIFECYCLE_CLOCK when injected), so the verifier and ORG-2 agree on expiry.
  async lookup(principal){const r=await c.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org)return null;const m=await c.metadata.get(ORG_KEYS.member+memberPrincipalKey(principal));return m?.state==='live'&&(m.expires_at===undefined||m.expires_at>orgsClock(c)()/1000)?{id:m.id,generation:m.generation,aep:Number.isSafeInteger(m.aep)?m.aep:0}:null;},
  /** Background key-refresh discovery only (never the request path): one page of live member principals. */
  async roster({after='',limit=1000}={}){
   const r=await c.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org)return {principals:[],next:null,total:0};
   const size=Math.min(8192,Math.max(1,Number.isSafeInteger(limit)?limit:1000)),rows=[...await c.metadata.list({prefix:ORG_KEYS.member,startAfter:typeof after==='string'&&after?ORG_KEYS.member+after:'',limit:size})],now=orgsClock(c)()/1000;
   return {principals:rows.map(([,m])=>m).filter(m=>m?.state==='live'&&(m.expires_at===undefined||m.expires_at>now)).map(m=>({iss:m.principal.iss??null,sub:m.principal.sub})),next:rows.length===size?rows.at(-1)[0].slice(ORG_KEYS.member.length):null,total:Number.isSafeInteger(r.roster?.live)?r.roster.live:rows.length};
  },
  observe:(principal,{aep,reset})=>orgsEngine(c).service.observeAuthority(principal,{aep,reset}),
  async context(principal,{client,generation}){
   // ORG-0's per-principal epoch rule applies to every organization actor: pass the epoch already seen, so a
   // certificate-authenticated context neither trips nor moves it.
   const seen=await c.metadata.get(ORG_EPOCH+encodeURIComponent((principal.iss??'')+' '+principal.sub));
   const actor={kind:'owner',owner:org,principal:{iss:principal.iss,sub:principal.sub},entity:{kind:'organization',id:org},powers:[],authTime:null,epoch:Number.isSafeInteger(seen)?seen:0,aep:0};
   return orgsEngine(c).service.context(actor,{client,generation});
  },
 });
}
async function clientConnected(c,org,clientId,origin){
 try{const {id}=await c.apps.binding(org,clientId),r=await c.metadata.get('resource/'+id);return r?.kind==='app-connection'&&r.owner===org&&r.clientId===clientId&&['active','degraded'].includes(connectionState(r))&&r.appOrigin===origin;}catch{return false;}
}
const contexts=new WeakMap();
function contextEngine(c,org){
 const config=c.config,gate=foreignDirectoryEnabled(config,org);let entry=contexts.get(c);if(entry?.org===org&&entry.gate===gate)return entry.engine;
 const issuer=config.APP_ORIGIN,directory=gate?foreignDirectory(config,{store:c.metadata,owner:org}):null;
 // Review follow-up 8 (item 5): the verifier, its key cache and the membership port share the writer's injected clock.
 const clock=()=>orgsClock(c)();
 const service=new MemberContextService({metadata:c.metadata,organization:{id:org,identity:identityURI(config,org)},issuer,members:membershipPort(c,org),clock,
  local:cachedIssuerKeys({metadata:c.metadata,issuer,clock,read:subject=>peer(config,subject,'memberCertificateKeys',[subject])}),foreign:directory?directoryIssuerKeys(directory):null,
  connections:{check:({clientId,origin})=>clientConnected(c,org,clientId,origin)},
  status:async({issuer:iss,subject,jkt})=>iss===issuer?(await peer(config,subject,'memberCertificateStatus',[subject,jkt]))?.status??null:null,
  flags:{organizations:()=>flagsFor(config,{subject:{kind:'account',owner:org}}).enabled(ORGANIZATIONS_FLAG),foreign:()=>flagsFor(config,{subject:{kind:'account',owner:org}}).enabled(ORG_FOREIGN_MEMBERS_FLAG)},
  foreignIssuers:directory?foreignIssuers(config):[],allowLoopback:config.LOCAL_DEVELOPMENT==='true'});
 const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,memberContext:memberContextProvider(service)}});
 contexts.set(c,{org,gate,engine,service});return engine;
}
/** Diagnostics and tests: the organization's member-context service (built as the wire forms build it). */
export function memberContextService(c,org){contextEngine(c,org);return contexts.get(c).service;}
/** F-06: the organization-wide live member-token bound, sized to the plan's member count (fallback: the live roster). */
async function memberCapacity(c,org){
 try{const r=await c.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org)return memberAccessCapacity(50);const plan=billingStanding(r,orgsClock(c)()).plan;
  return memberAccessCapacity(ORGANIZATION_PLANS[plan]?.members??Math.max(50,Number.isSafeInteger(r.roster?.live)?r.roster.live:0));}catch{return memberAccessCapacity(50);}
}
const uniform=token=>token?new StorageError('invalid_grant','invalid_grant',400):new StorageError('invalid_token','invalid_token',401);
/** A wire form at an organization: anything but a verified result is the uniform fault (no account-state signal). */
async function wire(c,org,Operation,input,token){
 let engine;try{const r=await c.metadata.get(ORG_RECORD);if(!UUID.test(org??'')||await c.metadata.get('owner')!==org||r?.kind!=='organization'||r.id!==org)throw uniform(token);engine=contextEngine(c,org);}catch{throw uniform(token);}
 try{return await perform(engine,new Operation({actor:{kind:'system',owner:org},input:structuredClone(input??{})}));}
 catch{throw uniform(token);}
 finally{// Warm due member keys after the answer is computed (never on the request path's result).
  void perform(engine,new MemberKeyRefresh({actor:{kind:'system',owner:org}})).catch(()=>{});}
}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** F-07: after a same-host issuance, acquisition or consent revocation for a local organization audience, hint that
 * organization to refresh this member's cached keys. Fire-and-forget: never awaited, never changes the answer. */
function keysChanged(c,owner,aud){const org=localAudience(c.config,aud);if(!org||org===owner)return;void peer(c.config,org,'memberKeysChanged',[org,owner]).catch(()=>{});}

export const methods={
 // ---- home placement ----
 async memberCertificateConsent(owner,{client,input}={}){await this.warm(owner);return perform(issuerEngine(this),new GrantMemberConsent({actor:{kind:'owner',owner,client:plain(client)?{client_id:client.client_id,origin:client.origin}:null},input:structuredClone(input??{})}));},
 async memberCertificateAcquire(owner,{client,input}={}){await this.warm(owner);const result=await perform(issuerEngine(this),new AcquireMemberConsentCertificate({actor:{kind:'owner',owner,client:plain(client)?{client_id:client.client_id,origin:client.origin}:null},input:structuredClone(input??{})}));keysChanged(this,owner,input?.aud);return result;},
 async memberCertificateIssue(owner,{actor,input}={}){await this.warm(owner);const resolved=actor?.kind==='app'&&plain(actor.client)?{kind:'app',owner,client:{client_id:actor.client.client_id,origin:actor.client.origin}}:{kind:'owner',owner};const result=await perform(issuerEngine(this),new IssueMemberCertificate({actor:resolved,input:structuredClone(input??{})}));keysChanged(this,owner,input?.aud);return result;},
 async memberCertificatesList(owner){await this.warm(owner);return read(issuerEngine(this),new MemberCertificateList({actor:{kind:'owner',owner}}));},
 async memberCertificatesRevoke(owner,input){await this.warm(owner);if(!plain(input))throw new StorageError('invalid_request','Unsupported member certificate request.');const value=structuredClone(input);const result=await perform(issuerEngine(this),value.jkt!==undefined?new RevokeMemberKey({actor:{kind:'owner',owner},input:value}):new RevokeMemberConsent({actor:{kind:'owner',owner},input:value}));keysChanged(this,owner,value.aud);return result;},
 async memberCertificateStatus(subject,jkt){if(await this.metadata.get('owner')!==subject)return {status:'revoked',final:false};return read(issuerEngine(this),new MemberCertificateStatus({actor:{kind:'public',owner:subject},input:{jkt}}));},
 async memberCertificateKeys(subject){
  if(!UUID.test(subject??'')||await this.metadata.get('owner')!==subject)return null;const a=await identityOf(this.config,subject);
  if(a?.status!=='active'||a.kind==='organization')return null;const signing=(await this.identityKeyHistory(subject,{purpose:'signing'})).find(k=>k.current);
  return {identity:a.identityUri??identityURI(this.config,subject),signing:signing?{kid:signing.kid,publicJwk:{kty:'EC',crv:'P-256',x:signing.publicJwk.x,y:signing.publicJwk.y}}:null,keys:await certificationKeyList(this.metadata,subject)};
 },
 /** Names the organization a consent screen is about: the local record on this host, or the ORG-7 directory document
  * for a foreign one (only while the gated directory exists). Anything unresolvable answers {verified:false}, and the
  * page warns. Membership is never read, so the answer does not depend on whether the member belongs (ORG-D9). */
 async memberCertificateOrganization(owner,aud){
  const unverified=source=>({name:null,handle:null,verified:false,source});
  const org=localAudience(this.config,aud);
  if(org){const r=await peer(this.config,org,'memberCertificateOrganizationName',[org]).catch(()=>null);return typeof r?.name==='string'?{name:r.name,handle:typeof r.handle==='string'?r.handle:null,verified:true,source:'local'}:unverified('local');}
  let issuer,subject;try{const u=new URL(aud);issuer=u.origin;subject=/^\/identity\/([0-9a-f-]{36})$/.exec(u.pathname)?.[1];}catch{return unverified('directory');}
  if(!subject||!UUID.test(subject))return unverified('directory');
  try{const directory=foreignDirectory(this.config,{store:this.metadata,owner});if(!directory)return unverified('directory');const d=await directory.refresh({issuer,subject});
   return d?.kind==='organization'&&d.iss===issuer&&d.sub===subject?{name:null,handle:typeof d.handle==='string'?d.handle:null,verified:true,source:'directory'}:unverified('directory');}
  catch{return unverified('directory');}
 },
 // ---- organization placement ----
 async memberCertificateOrganizationName(org){const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org||r.state!=='active'||typeof r.name!=='string')return null;return {name:r.name,handle:typeof r.handle==='string'?r.handle:null};},
 async memberCertificateLifetime(org){const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org)return null;const s=await this.metadata.get('org/cert/settings');return {certificateSeconds:memberCertificateLifetime(s?.certificateSeconds)??MEMBER_CERTIFICATE_DEFAULT_SECONDS};},
 async memberToken(org,input){return wire(this,org,MemberToken,input,true);},
 /** The runtime token form, step 1: verification and the member context; the route then mints the federation token
  * (ORG-3 `token.member`) in the organization's shard. Adds the live connection the token is bound to. */
 async memberTokenAdmit(org,input){
  const admitted=await wire(this,org,MemberTokenAdmit,input,true);
  try{const {id,generation}=await this.apps.binding(org,admitted.context.client.client_id);if(!id||!Number.isSafeInteger(generation)||generation<1)throw new Error('no connection');return {...admitted,connection:{id,generation},capacity:await memberCapacity(this,org)};}catch{throw uniform(true);}
 },
 /** F-07: a same-host home's hint that `subject`'s certification keys may have changed (gate none, like the key read).
  * Enqueues a refresh for a live member only and answers the same either way. */
 async memberKeysChanged(org,subject){
  try{const r=await this.metadata.get(ORG_RECORD);if(!UUID.test(org??'')||!UUID.test(subject??'')||await this.metadata.get('owner')!==org||r?.kind!=='organization'||r.id!==org)return {accepted:true};await perform(contextEngine(this,org),new MemberKeysChanged({actor:{kind:'system',owner:org},input:{subject}}));}catch{/* best effort */}
  return {accepted:true};
 },
 async memberDirect(org,input){return wire(this,org,MemberDirect,input,false);},
 async memberAuthenticate(org,input){return wire(this,org,MemberAuthenticate,input,false);},
 async memberContextEnd(org,input){await this.warm(org);return perform(contextEngine(this,org),new EndMemberTokens({actor:{kind:'system',owner:org},input:structuredClone(input??{})}));},
 async memberCertificateSettingsDispatch(org,{operation,actor,input}={}){
  const Operation=MEMBER_CONTEXT_OWNER_OPERATIONS.find(O=>O.operation===operation);if(!Operation)throw new StorageError('not_found','Not found.',404);
  const resolved=await accountActor({owner:org,requested:actor,Operation,issuer:this.config.APP_ORIGIN??null,organization:principal=>loadOrganization(this.metadata,[principal])});
  await this.warm(org);const engine=contextEngine(this,org),op=new Operation({actor:resolved,...input===undefined?{}:{input:structuredClone(input)}});
  return op instanceof AppQuery?read(engine,op):perform(engine,op);
 },
};
export const rpc={
 memberCertificateConsent:{warm:true},memberCertificateAcquire:{warm:true},memberCertificateIssue:{warm:true},memberCertificatesList:{lifecycle:'suspended'},memberCertificatesRevoke:{lifecycle:'suspended'},
 memberCertificateStatus:{gate:'none',lifecycle:'purging'},memberCertificateKeys:{gate:'none'},memberCertificateOrganization:{},memberCertificateLifetime:{gate:'none'},memberCertificateOrganizationName:{gate:'none'},
 memberKeysChanged:{gate:'none'},memberToken:{},memberTokenAdmit:{},memberDirect:{},memberAuthenticate:{},memberContextEnd:{lifecycle:'suspended'},memberCertificateSettingsDispatch:{},
};
