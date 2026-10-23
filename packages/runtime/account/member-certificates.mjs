// ORG-4 account slice: member certificates (thin adapters over packages/identity/member-certificates.mjs and
// packages/orgs/certificates.mjs; docs/spec/organizations.md §5.2, §7). `this` is the AccountController.
//
// Home placement (a person's account):
//   memberCertificateConsent(owner, {client, input})   trusted adapter only: `client` is the OBSERVED client (R2-M3)
//   memberCertificateIssue(owner, {actor, input})      trusted adapter only: actor {kind:'owner'} or {kind:'app', client}
//   memberCertificatesList / memberCertificatesRevoke  the member's own view and revocation (never flag-gated)
//   memberCertificateStatus(subject, jkt)              public status (gate none)
//   memberCertificateKeys(subject)                     local read for organizations on this host (gate none)
// Organization placement (an organization's account):
//   memberToken / memberDirect / memberAuthenticate    the wire forms; every failure is the uniform fault
//   memberContextEnd(org, input)                       ORG-2 hook: end tokens for a membership or principal
//   memberCertificateLifetime(org)                     the organization's lifetime, read by home issuers (gate none)
//   memberCertificateSettingsDispatch(org, request)    admin settings, actor resolved by ORG-0 `accountActor`
// Foreign issuers are not wired here yet: no ORG-7 directory instance exists in the runtime, so `foreign` is null and
// foreign certificates fail uniformly even with ORG_FOREIGN_MEMBERS_ENABLED (the allowlist is empty by default too).
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {flagsFor} from './flags.mjs';
import {authorityEpoch} from '../../identity/authority-epoch.mjs';
import {MemberCertificateIssuer,memberCertificatesProvider,certificationSigner,certificationKeyList,memberCertificateLifetime,GrantMemberConsent,IssueMemberCertificate,RevokeMemberConsent,RevokeMemberKey,MemberCertificateList,MemberCertificateStatus,MEMBER_CERTIFICATES_FLAG,MEMBER_CERTIFICATE_DEFAULT_SECONDS} from '../../identity/member-certificates.mjs';
import {MemberContextService,memberContextProvider,cachedIssuerKeys,memberPrincipalKey,MemberToken,MemberTokenAdmit,MemberDirect,MemberAuthenticate,EndMemberTokens,MemberKeyRefresh,MEMBER_CONTEXT_OWNER_OPERATIONS,ORG_FOREIGN_MEMBERS_FLAG} from '../../orgs/certificates.mjs';
import {ORG_RECORD,ORG_EPOCH,ORGANIZATIONS_FLAG} from '../../orgs/organizations.mjs';
import {accountActor} from '../../orgs/authority.mjs';
import {orgsEngine} from './orgs.mjs';
import {connectionState} from '../../apps/connections.mjs';

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
function membershipPort(c,org){
 return Object.freeze({
  async lookup(principal){const r=await c.metadata.get(ORG_RECORD),m=r?.kind==='organization'&&r.id===org?r.memberships?.[memberPrincipalKey(principal)]:null;return m?.state==='live'&&(m.expires_at===undefined||m.expires_at>Date.now()/1000)?{id:m.id,generation:m.generation,aep:Number.isSafeInteger(m.aep)?m.aep:0}:null;},
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
 let entry=contexts.get(c);if(entry?.org===org)return entry.engine;const config=c.config,issuer=config.APP_ORIGIN;
 const service=new MemberContextService({metadata:c.metadata,organization:{id:org,identity:identityURI(config,org)},issuer,members:membershipPort(c,org),
  local:cachedIssuerKeys({metadata:c.metadata,issuer,read:subject=>peer(config,subject,'memberCertificateKeys',[subject])}),foreign:null,
  connections:{check:({clientId,origin})=>clientConnected(c,org,clientId,origin)},
  status:async({issuer:iss,subject,jkt})=>iss===issuer?(await peer(config,subject,'memberCertificateStatus',[subject,jkt]))?.status??null:null,
  flags:{organizations:()=>flagsFor(config,{subject:{kind:'account',owner:org}}).enabled(ORGANIZATIONS_FLAG),foreign:()=>flagsFor(config,{subject:{kind:'account',owner:org}}).enabled(ORG_FOREIGN_MEMBERS_FLAG)},
  foreignIssuers:[],allowLoopback:config.LOCAL_DEVELOPMENT==='true'});
 const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,memberContext:memberContextProvider(service)}});
 contexts.set(c,{org,engine});return engine;
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

export const methods={
 // ---- home placement ----
 async memberCertificateConsent(owner,{client,input}={}){await this.warm(owner);return perform(issuerEngine(this),new GrantMemberConsent({actor:{kind:'owner',owner,client:plain(client)?{client_id:client.client_id,origin:client.origin}:null},input:structuredClone(input??{})}));},
 async memberCertificateIssue(owner,{actor,input}={}){await this.warm(owner);const resolved=actor?.kind==='app'&&plain(actor.client)?{kind:'app',owner,client:{client_id:actor.client.client_id,origin:actor.client.origin}}:{kind:'owner',owner};return perform(issuerEngine(this),new IssueMemberCertificate({actor:resolved,input:structuredClone(input??{})}));},
 async memberCertificatesList(owner){await this.warm(owner);return read(issuerEngine(this),new MemberCertificateList({actor:{kind:'owner',owner}}));},
 async memberCertificatesRevoke(owner,input){await this.warm(owner);if(!plain(input))throw new StorageError('invalid_request','Unsupported member certificate request.');const value=structuredClone(input);return perform(issuerEngine(this),value.jkt!==undefined?new RevokeMemberKey({actor:{kind:'owner',owner},input:value}):new RevokeMemberConsent({actor:{kind:'owner',owner},input:value}));},
 async memberCertificateStatus(subject,jkt){if(await this.metadata.get('owner')!==subject)return {status:'revoked',final:false};return read(issuerEngine(this),new MemberCertificateStatus({actor:{kind:'public',owner:subject},input:{jkt}}));},
 async memberCertificateKeys(subject){
  if(!UUID.test(subject??'')||await this.metadata.get('owner')!==subject)return null;const a=await identityOf(this.config,subject);
  if(a?.status!=='active'||a.kind==='organization')return null;const signing=(await this.identityKeyHistory(subject,{purpose:'signing'})).find(k=>k.current);
  return {identity:a.identityUri??identityURI(this.config,subject),signing:signing?{kid:signing.kid,publicJwk:{kty:'EC',crv:'P-256',x:signing.publicJwk.x,y:signing.publicJwk.y}}:null,keys:await certificationKeyList(this.metadata,subject)};
 },
 // ---- organization placement ----
 async memberCertificateLifetime(org){const r=await this.metadata.get(ORG_RECORD);if(r?.kind!=='organization'||r.id!==org)return null;const s=await this.metadata.get('org/cert/settings');return {certificateSeconds:memberCertificateLifetime(s?.certificateSeconds)??MEMBER_CERTIFICATE_DEFAULT_SECONDS};},
 async memberToken(org,input){return wire(this,org,MemberToken,input,true);},
 /** The runtime token form, step 1: verification and the member context; the route then mints the federation token
  * (ORG-3 `token.member`) in the organization's shard. Adds the live connection the token is bound to. */
 async memberTokenAdmit(org,input){
  const admitted=await wire(this,org,MemberTokenAdmit,input,true);
  try{const {id,generation}=await this.apps.binding(org,admitted.context.client.client_id);if(!id||!Number.isSafeInteger(generation)||generation<1)throw new Error('no connection');return {...admitted,connection:{id,generation}};}catch{throw uniform(true);}
 },
 async memberDirect(org,input){return wire(this,org,MemberDirect,input,false);},
 async memberAuthenticate(org,input){return wire(this,org,MemberAuthenticate,input,false);},
 async memberContextEnd(org,input){await this.warm(org);return perform(contextEngine(this,org),new EndMemberTokens({actor:{kind:'system',owner:org},input:structuredClone(input??{})}));},
 async memberCertificateSettingsDispatch(org,{operation,actor,input}={}){
  const Operation=MEMBER_CONTEXT_OWNER_OPERATIONS.find(O=>O.operation===operation);if(!Operation)throw new StorageError('not_found','Not found.',404);
  const resolved=await accountActor({owner:org,requested:actor,Operation,issuer:this.config.APP_ORIGIN??null,organization:()=>this.metadata.get(ORG_RECORD)});
  await this.warm(org);const engine=contextEngine(this,org),op=new Operation({actor:resolved,...input===undefined?{}:{input:structuredClone(input)}});
  return op instanceof AppQuery?read(engine,op):perform(engine,op);
 },
};
export const rpc={
 memberCertificateConsent:{warm:true},memberCertificateIssue:{warm:true},memberCertificatesList:{lifecycle:'suspended'},memberCertificatesRevoke:{lifecycle:'suspended'},
 memberCertificateStatus:{gate:'none',lifecycle:'purging'},memberCertificateKeys:{gate:'none'},memberCertificateLifetime:{gate:'none'},
 memberToken:{},memberTokenAdmit:{},memberDirect:{},memberAuthenticate:{},memberContextEnd:{lifecycle:'suspended'},memberCertificateSettingsDispatch:{},
};
