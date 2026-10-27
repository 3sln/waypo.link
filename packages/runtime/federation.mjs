import {authorityGrantEpoch} from './grant-epoch.mjs';
import {organizationAccountAuthority} from '../orgs/federation.mjs';
import {buildRemovalClaims,verifyRemovalAssertion} from '../federation/removal.mjs';
import {configuredContractVersion,pinConfiguredContract,reviewedSchemaFetcher} from './artefact-pins.mjs';
import {ownerFlags,capability,siteGlobal,siteEnabled,featureConfig,surfaceConfig} from './account/flags.mjs';
import {subjectTermsAllowed} from '../identity/age-policy.mjs';
import {bridgeConfig} from '../email-bridge/engine.mjs';
import {appSessionDerivation} from './app-session-lineage.mjs';
import {holdBusRPC,busWaitsPort} from '../events/waiter.mjs';
import {EVENT_BUS_CONTRACT} from '../federation/event-buses.mjs';
import {appSessionPolicy} from '../federation/app-sessions.mjs';
import {APP_NOTIFICATIONS,ACTIVITY_CONTRACT,ACTIVITY_METHODS} from '../federation/app-notifications.mjs';
import {RESOURCE_SCOPING,storageScopeOptions} from '../storage/scoping.mjs';
import {IdentityService} from '../identity/service.mjs';
import {normalizeHandle} from '../identity/handles.mjs';
import {digest,canonical} from '../messaging/store.mjs';
import {PROFILE,PREFERENCES} from '../federation/service.mjs';
import {objectURLAuthority} from '../storage/object-urls.mjs';
import {encryptSecret,decryptSecret} from './secrets.mjs';
import {dpopNonces} from '../federation/dpop.mjs';
import {ENTRY_INTENTS,ENTRY_SHARDS,AuthorizationEntries,entryManifest,entryShard,remoteShard} from '../federation/authorization-entries.mjs';
import {componentsProfile,componentsDeclaration} from '../federation/components-profile.mjs';
import {deviceManifest} from '../federation/device-authorization.mjs';
import {createManifestDeclarationProvider,ManifestDeclarations,withManifestDeclarations} from '../federation/runtime.mjs';
import {ClientDirectory,CLIENT_METADATA_FEATURE,clientSite} from '../federation/client-metadata.mjs';
import {UUID_V4 as UUID} from '../core/primitives.mjs';
import {MESSAGING_ADDRESS_DECLARATION,LINKS_CONTRACT} from '../links/types.mjs';
import {GOOGLE_DRIVE_SETUP_FRAGMENT} from '../storage/google-drive-integration.mjs';
import {ITEM_CLASSIFIER_MANIFEST} from '../apps/connections.mjs';
import {brokeringMounts} from './integration-ports.mjs';
import {verifyClientAssertion,memoryReplayCache,CLIENT_ASSERTION_TYPE} from '../federation/introspection.mjs';
import {pinnedKeys} from '../federation/integrations.mjs';
import {brokeredResourcesDeclaration} from '../federation/introspection.mjs';

export const messagingAddressMounted=config=>siteGlobal(config,'BINDLEBOX_ENABLED',true)&&siteGlobal(config,'INTEGRATIONS_ENABLED',true)&&typeof config.MESSAGING_DESCRIBE==='function';
export const BROKERING_STORE='bindle-brokering-v1';
export const FEDERATION_LAYOUT='bindle-federation-v1';
/** Append-only declaration registry (EXT-X2). Slices append rows; never edit builders or other slices' rows.
 * {flag: string|string[], mounted: context=>boolean, declare: context=>manifestMembers}. Every flag is opt-in.
 * Context: {config,issuer,target:'authority'|'entries'|'controller',mounts,directory?,entries?,components?}.
 * `mounts` is adapter-owned evidence of mounted routes, default {}; flags alone never imply a mount.
 * Example for LA3: flag:'DEVICE_AUTHORIZATION_ENABLED', mounted:c=>c.target==='authority'&&c.mounts.deviceAuthorization===true.
 * A row may return features/profiles/extensions, device_authorization_endpoint and additive OAuth grant/auth lists.
 * extensions additionally requires EXTENSIONS_ENABLED and a separately mounted extensions.v1 declaration.
 * Do not declare integrations/brokering merely because their keys or JWKS route exist: full protocol slices own those claims. */
export const MANIFEST_DECLARATIONS=Object.freeze([
 {flag:'APP_CLEAN_REMOVAL_ENABLED',mounted:c=>c.target==='authority'&&typeof c.config.INTEGRATION_EVENT_PORTS?.signer?.sign==='function',declare:c=>({features:{'app-removal.v1':{jwks_uri:c.issuer+'/oauth/brokering/jwks',return_uri:c.issuer+'/api/apps/removal/return',completion_endpoint:c.issuer+'/bindle/removal/complete'}}})},
 {flag:'SUBJECT_DELETED_EVENTS_ENABLED',mounted:c=>c.target==='authority'&&c.mounts.integrations===true,declare:()=>({features:{'subject-deleted.v1':{}}})},
 {flag:'ARTEFACT_VERSIONS_ENABLED',mounted:c=>c.config.ARTEFACTS?.enabled===true,declare:()=>({features:{'artefact-versions.v1':{}}})},
 {flag:['INTEGRATIONS_ENABLED','BROKERING_ENABLED'],mounted:c=>c.target==='authority'&&c.mounts.integrations===true&&c.mounts.brokeredResources===true,declare:()=>({features:{'integrations.v1':{}},token_endpoint_auth_methods_supported:['none','private_key_jwt']})},
 {flag:'CLIENT_METADATA_ENABLED',mounted:c=>c.target==='authority'&&c.directory?.enabled===true,declare:()=>({features:{[CLIENT_METADATA_FEATURE]:{}}})},
 {flag:'FEDERATION_ENTRY_ENABLED',mounted:c=>c.target==='entries'&&!!c.entries,declare:c=>entryManifest(c.issuer,{intents:c.entries.intents()})},
 {flag:'FEDERATION_ENTRY_ENABLED',mounted:c=>c.target==='entries'&&c.components===true&&!!c.entries?.embedOrigin&&c.entries.dpop===true,declare:c=>componentsDeclaration(componentsProfile(c.config),{incremental:c.entries?.incremental?.mounted===true})},
 // LA3: RFC 8628 members plus the feature, only where the adapter mounted the device endpoint, the device_code token
 // branch, DPoP RPC and cancellation (runtime/device-grant.mjs). DPoP algorithms and revocation_endpoint are already
 // base authority members whenever that mount is possible.
 {flag:'DEVICE_AUTHORIZATION_ENABLED',mounted:c=>c.target==='authority'&&c.mounts.deviceAuthorization===true,declare:c=>{const {device_authorization_endpoint,grant_types_supported,features}=deviceManifest(c.issuer);return {device_authorization_endpoint,grant_types_supported,features};}},
 // BB-C1b: the `messaging-address` provider consumer of messaging-ingress (bindlebox §2.1). Only where the adapter
 // mounted the descriptor handoff with an occupancy port AND a describe port (`mounts.messagingAddress`); the entry
 // is kept only beside a declared extensions.v1 (EXTENSIONS_ENABLED), never on flags alone.
 {flag:['BINDLEBOX_ENABLED','EXTENSIONS_ENABLED'],mounted:c=>c.target==='authority'&&c.mounts.messagingAddress===true,declare:()=>({extensions:[{...MESSAGING_ADDRESS_DECLARATION}]})},
 // IA-1: `grant-more`/`configure` need no row of their own (a second `authorization-entry.v1` would fail closed as a
 // duplicate). They ride the FEDERATION_ENTRY_ENABLED row through `entries.intents()`, which lists them only when the
 // adapter passed AuthorizationEntries a mounted INCREMENTAL_AUTHORIZATION port (INCREMENTAL_AUTH_ENABLED on).
 // EXT-X8: brokered-resources.v1 (integrations §12; it replaces the provisional top-level brokering_jwks_uri) only where
 // the adapter mounted integrations.v1 (`mounts.integrations`) AND preferences/v2 minting, severance draining and the
 // brokering JWKS route (`mounts.brokeredResources`); introspection_endpoint only with `mounts.brokeredIntrospection`.
 // ORG-10f: relations.v1 (spec organizations §14) only where an adapter mounted the cross-provider relation transport
 // (`mounts.relations`, ORG-11a). No adapter sets it yet: same-host relations need no manifest, and the join and events
 // endpoints stay behind ORG_FOREIGN_RELATIONS_ENABLED, so the feature is never claimed on flags alone.
 {flag:['ORG_RELATIONS_ENABLED','ORG_FOREIGN_RELATIONS_ENABLED'],mounted:c=>c.target==='authority'&&c.mounts.relations===true,declare:c=>({features:{'relations.v1':{accept_endpoint:c.issuer+'/relations/accept',join_endpoint:c.issuer+'/relations/join',events_endpoint:c.issuer+'/relations/events'}}})},
 {flag:['INTEGRATIONS_ENABLED','BROKERING_ENABLED'],mounted:c=>c.target==='authority'&&c.mounts.integrations===true&&c.mounts.brokeredResources===true,declare:c=>brokeredResourcesDeclaration(c.issuer,{introspection:c.mounts.brokeredIntrospection===true})},
]);
/** Synchronous adapter over the same provider Query used by the engine harness. Mounts never come from query input. */
export function federationDeclarations(config,context={}){return new ManifestDeclarations().fetch({config:surfaceConfig(config),federation:createManifestDeclarationProvider({registry:MANIFEST_DECLARATIONS,context:{...context,issuer:config.APP_ORIGIN,mounts:context.mounts??{}}})});}
export function federationEntryManifest(config,entries,{components=false,mounts={}}={}){return federationDeclarations(config,{target:'entries',entries,components,mounts});}
const routed=/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function federationConfig(value,fallback){if(value===undefined||value==='')return structuredClone(fallback);return typeof value==='string'?JSON.parse(value):structuredClone(value);}
/** X10's recognized immutable slot joins reviewed fragments only while its implementation is enabled. */
export function federationSchemas(config){
 const schemas=federationConfig(config.FEDERATION_SCHEMAS,{});
 if(siteGlobal(config,'INTEGRATIONS_ENABLED'))schemas[GOOGLE_DRIVE_SETUP_FRAGMENT.id]=structuredClone(GOOGLE_DRIVE_SETUP_FRAGMENT);
 if(!schemas||Array.isArray(schemas)||typeof schemas!=='object'||Object.keys(schemas).length>100)throw new TypeError('Invalid reviewed fragment registry.');
 if(siteGlobal(config,'INTEGRATIONS_ENABLED')&&siteGlobal(config,'EXTENSIONS_ENABLED'))schemas[ITEM_CLASSIFIER_MANIFEST.id]=structuredClone(ITEM_CLASSIFIER_MANIFEST);
 return schemas;
}
export function federationClients(config){const clients=federationConfig(config.FEDERATION_CLIENTS,[]);if(!Array.isArray(clients)||clients.length>100)throw new TypeError('At most 100 reviewed federation clients can be configured.');for(const client of clients){if(typeof client?.id!=='string'||client.id.length>200||typeof client.name!=='string'||!client.name.trim()||client.name.length>100)throw new TypeError('Reviewed clients require a URL ID of at most 200 characters and name of at most 100 characters.');}return clients;}
/** `client-id-metadata.v1` is opt-in (CLIENT_METADATA_ENABLED=true, default false) and is declared only where an
 * SSRF-safe egress port is injected as well (docs/spec/federation-implementation.md). */
export const clientMetadataEnabled=config=>siteGlobal(config,'CLIENT_METADATA_ENABLED');
/** Client resolution shared by an adapter's front: reviewed clients first, then metadata documents through `fetch`
 * (the adapter's SSRF-safe egress), `limiter` (`consume`, fleet-wide where available) and `blocked(host)` (admin). */
export function federationClientDirectory(config,{fetch,limiter,blocked,clock}={}){
 const reservedHosts=[config.APP_ORIGIN,config.EMBED_ORIGIN].flatMap(value=>{try{return value?[new URL(value).hostname]:[];}catch{return [];}});
 const directory=new ClientDirectory({clients:federationClients(config),enabled:clientMetadataEnabled(config),integrations:siteGlobal(config,'INTEGRATIONS_ENABLED'),artefactVersions:siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED'),fetch,limiter,blocked,reservedHosts,...clock?{clock}:{}});for(const [key,name]of [['enabled','CLIENT_METADATA_ENABLED'],['integrations','INTEGRATIONS_ENABLED'],['artefactVersions','ARTEFACT_VERSIONS_ENABLED']])Object.defineProperty(directory,key,{get:()=>siteGlobal(config,name)&&(key!=='enabled'||typeof fetch==='function')});return directory;}
export function federationAccount(accounts,owner){const native=accounts.get(owner);return new Proxy({}, {get:(_,method)=>async(...args)=>{const result=await native.invoke({method,args});if(result?.$fault)throw Object.assign(new Error(result.$fault.message),result.$fault);return result;}});}
/** The OAuth grant epoch: every app family and code is bound to it, and RPC/refresh compare it live. It changes with the
 * recovery credential (any recovery, reissue or reissue cancellation revokes every grant; the safe direction) and with
 * `federationGeneration`, a monotonic integer the identity record raises when grants must end without a credential
 * change (suspension, a cancelled reissue restoring an earlier credential). Records without the field keep their epoch. */
export async function federationEpoch(account){return authorityGrantEpoch(account);}
const unsupported=()=>{throw Object.assign(new Error('Credential operations use the identity service.'),{code:'unsupported_method'});};
/** DPoP nonce MAC key; DPoP stays unadvertised without one. */
export const federationDpopSecret=config=>config.DPOP_NONCE_KEY||config.KEY_ENCRYPTION_KEY||undefined;
/** Last credential verification of an owner session: its credential sign-in, or a later step-up (password or passkey).
 * Sessions minted without a credential (device approval, which any recent session can grant) count only from a step-up. */
export const sessionAuthTime=session=>Math.max((session?.source??'credential')==='credential'?session?.createdAt??0:0,Number.isSafeInteger(session?.stepUpAt)?session.stepUpAt:0)||undefined;

/** Domain capabilities are injected identically by Workers and Node. Owner
 * state has no fleet-wide lock; routing identifiers never grant authority. */
export function federationControllerOptions({config,repository,accounts,owner,manifestMounts={},incremental}){
 if(!UUID.test(owner))throw new TypeError('A stable UUID identity is required.');
 const issuer=config.APP_ORIGIN,subject=`${issuer}/entities/${owner}`,schemas=federationSchemas(config);
 if(!schemas||Array.isArray(schemas)||typeof schemas!=='object'||Object.keys(schemas).length>100)throw new TypeError('Invalid reviewed fragment registry.');
 const identity=new IdentityService({repository,crypto,turnstile:{verify:unsupported},rateLimiter:{check:unsupported},webauthn:{verifyRegistration:unsupported,verifyAuthentication:unsupported},passwordHasher:{hash:unsupported,verify:unsupported},config:{origin:issuer,rpID:config.RP_ID??new URL(issuer).hostname,termsVersion:config.TERMS_VERSION??'2026-10-11',allowInsecureLocalhost:config.LOCAL_DEVELOPMENT==='true'}});
 const account=federationAccount(accounts,owner);
 const validateSubject=async(candidate,epoch)=>{if(candidate!==subject)return false;const current=await repository.get(owner);return current?.status==='active'&&await federationEpoch(current)===epoch;};
 // ORG-5 organization context (provisional coordinator work): an admin edits the ORGANIZATION's preference fragments.
 // The person's own session is verified here (identity.authorized, CSRF on mutations); the admin power is resolved by
 // the organization's account writer (orgsActingAuthority), never taken from the caller. The authority returned is the
 // organization's own subject and federation epoch, so every existing preferences rule then applies unchanged.
 const organizationOwner=async(context,mutation)=>{
  const scope=context.organization;if(!scope||typeof scope!=='object'||Array.isArray(scope)||scope.id!==owner)fail('forbidden','Account owner mismatch.');
  const current=await repository.get(owner);if(!current||current.status!=='active'||current.kind!=='organization')fail('not_found','Not found.');
  const {organization:_scope,...personContext}=context,{account:person,session}=await identity.authorized(personContext,mutation),authTime=sessionAuthTime(session)??null;
  await account.orgsActingAuthority(owner,{actor:{principal:{iss:issuer,sub:person.id},entity:{kind:'organization',id:owner},authTime,epoch:Number.isSafeInteger(scope.epoch)&&scope.epoch>=0?scope.epoch:0,aep:Number.isSafeInteger(scope.aep)&&scope.aep>=0?scope.aep:0},power:'admin',widen:mutation===true});
  return {subject,epoch:await federationEpoch(current),authTime:authTime??undefined,sessionId:await identity.sessionID(session),approvalChain:[session.id]};
 };
 return {organizations:organizationAccountAuthority({account,owner,enabled:()=>ownerFlags(config,owner).enabled('ORGANIZATIONS_ENABLED')}),contractVersion:input=>configuredContractVersion(config,input),pinContract:target=>pinConfiguredContract(config,target),flagConfig:config,schemaHostProvider:()=>Object.keys(federationSchemas(config)).map(url=>new URL(url).host),issuer,clients:federationClients(config),routingKey:owner,crypto,manifestDeclarations:()=>federationDeclarations(config,{target:'controller',mounts:manifestMounts}),objectURLs:{...objectURLAuthority({issuer,secret:config.KEY_ENCRYPTION_KEY}),seal:value=>encryptSecret(value,config.KEY_ENCRYPTION_KEY),open:record=>decryptSecret(record,config.KEY_ENCRYPTION_KEY)},enabled:siteGlobal(config,'FEDERATION_ENABLED'),appSessions:appSessionPolicy(config),refreshEnabled:capability(config,'FEDERATION_REFRESH_ENABLED'),allowInsecureLocalhost:config.LOCAL_DEVELOPMENT==='true',dpop:federationDpopSecret(config)?{secret:federationDpopSecret(config)}:undefined,embedOrigin:componentsProfile(config)?.embedOrigin,clientMetadata:clientMetadataEnabled(config),
  incremental,integrations:siteGlobal(config,'INTEGRATIONS_ENABLED'),clientAuth:clientId=>account.connectionClientAuth(owner,clientId),
  // ORG-10f (spec organizations §10): imported resources are projected in relay form with an entity certificate issued
  // by the organization's own writer after its own hops (relations.certify); the shard passes its grant records and the
  // writer checks the connection. Any refusal reports the member `unavailable`.
  relationImports:{certify:input=>account.relationsCertify(owner,input)},
  brokering:{enabled:true,mint:input=>account.brokeredMint(owner,input),seq:input=>account.brokeredSeq(owner,input),event:input=>account.brokeredFederationEvent(owner,input)},
  deriveAppSession:appSessionDerivation({repository,owner}),
  appSessionLineage:async candidate=>candidate===subject?(await repository.get(owner))?.linkedLineage??[]:[],
  incrementalIdentity:async candidate=>{if(candidate!==subject)return null;const current=await repository.get(owner);return current?.status==='active'?{epoch:await federationEpoch(current)}:null;},
  eventBusReader:input=>account.eventBusReader(owner,input),
  embedView:async candidate=>{if(candidate!==subject)fail('unauthorized','The embedded session is unavailable.');const current=await repository.get(owner),profile=await account.beamProfile(owner);if(!current||current.status!=='active')fail('unauthorized','The embedded session is unavailable.');return {handle:current.handle,name:profile.displayName||undefined,avatar:profile.avatar||null};},
  schemaHosts:Object.keys(schemas).map(url=>new URL(url).host),schemaFetcher:reviewedSchemaFetcher(config),
  termsAllowed:candidate=>{if(candidate!==subject)fail('unauthorized');return subjectTermsAllowed(repository,identity.config.termsVersion,owner);},
  auth:{owner:async(context,{mutation})=>{if(context?.organization!==undefined)return organizationOwner(context,mutation);const {account:current,session}=await identity.authorized(context,mutation);if(current.id!==owner)fail('forbidden','Sign in to the identity requested by this application.');return {subject,epoch:await federationEpoch(current),authTime:sessionAuthTime(session),sessionId:await identity.sessionID(session),approvalChain:(()=>{const chain=[session.id];for(let parent=session.parentSessionId;parent&&!chain.includes(parent)&&chain.length<16;parent=current.sessions.find(s=>s.id===parent)?.parentSessionId)chain.push(parent);return chain;})()};}},validateSubject,
  resourceProvider:async()=>{
   const resources=await account.resources(owner),contract='https://3sln.me/artefacts/contracts/object-storage/v1';
   const descriptors=resources.filter(r=>r.owner===owner&&r.status==='connected'&&r.contracts?.includes(contract)).map(r=>{const capabilities=r.capabilities??{},methods=['capabilities',...capabilities.read?['get']:[],...capabilities.write&&['hosted','google-drive'].includes(r.provider)?['put','delete']:[],...capabilities.read||capabilities.write?['presign']:[]];return {id:`${subject}/resources/${r.id}`,label:r.name,provider:r.provider,contracts:{[contract]:methods,[RESOURCE_SCOPING]:['describe']},generation:String(r.generation??r.id),nativePresigned:capabilities.presigned??{read:false,write:false},scoping:storageScopeOptions(capabilities),limits:{maxRequestBytes:1500000,maxResultBytes:1500000,maxObjectBytes:capabilities.maxObjectBytes??1048576,txRetentionSeconds:86400}};});
   const current=await repository.get(owner),profile=await account.beamProfile(owner);
   if(!current||current.status!=='active')fail('unauthorized','Application authorization is no longer active.');
   if(siteEnabled(config,'ACTIVITY_V2_ENABLED',{subject:{kind:'account',owner}},true))descriptors.push({id:`${subject}/activity`,label:'Activity from this app',provider:'bindle',contracts:{[ACTIVITY_CONTRACT]:ACTIVITY_METHODS},generation:owner,limits:{maxRequestBytes:16384,maxResultBytes:1024,txRetentionSeconds:86400}});
   if(capability(config,'BROKERED_INTROSPECTION_MOUNTED'))descriptors.push(...await account.brokeredDescriptors(owner));
   if(siteEnabled(config,'EVENT_BUSES_ENABLED',{subject:{kind:'account',owner}},true))descriptors.push(...await account.eventBusDescriptors(owner));
   if(ownerFlags(config,owner).enabled('INTEGRATIONS_ENABLED')&&ownerFlags(config,owner).enabled('EXTENSIONS_ENABLED'))descriptors.push(...await account.classifierDescriptors(owner));
   if(siteEnabled(config,'BINDLEBOX_ENABLED',{subject:{kind:'account',owner}},true))descriptors.push({id:`${subject}/links`,label:'Contact links',provider:'bindle',contracts:{[LINKS_CONTRACT]:['issue','revoke','rotate','evaluate','list','changes',...bridgeConfig(featureConfig(config,{subject:{kind:'account',owner}})).enabled?['consumerKey','accepted']:[]]},generation:owner});
   // ORG-10f: an organization's imported resources (relation import mirrors kept by its writer), so its admins can
   // assign them to fragments and approve them for applications; never dispatched here (provider 'relation').
   if(ownerFlags(config,owner).enabled('ORGANIZATIONS_ENABLED')&&current.kind==='organization')descriptors.push(...await account.relationImportDescriptors(owner));
   descriptors.push({id:`${subject}/app-messages`,label:'Messages from this app',provider:'bindle',contracts:{[APP_NOTIFICATIONS]:['createOwn']},generation:owner,limits:{maxRequestBytes:16384,maxResultBytes:1024,txRetentionSeconds:86400}});descriptors.push({id:`${subject}/profile`,label:'Identity profile',provider:'identity',alias:'@profile',contracts:{[PROFILE]:['read']},generation:owner,preview:{entity:subject,handle:current.handle,name:profile.displayName||current.handle,avatar:profile.avatar||null}});return descriptors;
  },
  dispatcher:{durableJournal:true,execute:async context=>{if(!await validateSubject(context.subject,context.epoch))fail('unauthorized','Application authorization is no longer active.');if(context.connection)await account.appConnectionCheck(owner,context.connection.id,context.connection.generation,context.clientId);if(context.resource===`${subject}/profile`&&context.contract===PROFILE&&context.method==='read'){if(Object.keys(context.args).length)fail('invalid_args','Profile read takes no arguments.');const current=await repository.get(owner),profile=await account.beamProfile(owner);return {entity:subject,handle:current.handle,name:profile.displayName||current.handle,avatar:profile.avatar||null};}return account.federationRPC({...context,authority:'bindle'});}},
  connections:{notificationCheck:(connection,clientId)=>account.appNotificationCheck(owner,connection,clientId),binding:clientId=>account.appConnectionBinding(owner,clientId),connect:async(client,expected,permissions)=>account.appBindleConnect(owner,client,expected?.generation,{...permissions,...client.integration?.status==='valid'&&typeof config.INTEGRATION_CLIENT_SNAPSHOT==='function'?{integration:{kind:'external',snapshot:await config.INTEGRATION_CLIENT_SNAPSHOT(client)}}:{},expectedNotificationGeneration:expected?.notificationGeneration}),check:(connection,clientId)=>account.appConnectionCheck(owner,connection.id,connection.generation,clientId)}
 };
}

/** Pre-owner entry store for adapters. `store` is one transactional store or `shard=>store` (sharded by entry ID); a
 * host serving one shard passes `shard`. `endSession` is true only where the adapter mounts the provider
 * session-ending hook (packages/runtime/http.mjs), which is what lets the store accept and advertise end-session. */
export function federationEntries({config,store,shard,authority,endSession=false,clock,directory,manifestMounts={},incremental}){
 if(!capability(config,'FEDERATION_ENTRY_ENABLED'))return null;
 const schemas=federationSchemas(config);
 const entries=new AuthorizationEntries({artefactVersions:siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED'),store,shard,issuer:config.APP_ORIGIN,clients:federationClients(config),authority,...directory?{directory}:{},clientMetadata:clientMetadataEnabled(config),embedOrigin:componentsProfile(config)?.embedOrigin,dpop:!!federationDpopSecret(config),...clock?{clock}:{},pinSchema:async url=>{if(siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED')){const target=typeof url==='string'?{fragment:url}:url,pin=await config.ARTEFACTS.pin({artefact:target.fragment,kind:'fragment',...target.version!==undefined?{version:target.version}:{},...target.digest!==undefined?{digest:target.digest}:{}});return {digest:pin.reference.digest,...pin.reference.version?{version:pin.reference.version}:{}};}const schemas=federationSchemas(config);if(!Object.hasOwn(schemas,url))fail('untrusted_schema_host','This fragment has not been registered with this provider.');return {digest:await digest(crypto,canonical(schemas[url]))};},endSession:endSession===true,incremental});
 for(const [key,name]of [['integrations','INTEGRATIONS_ENABLED'],['clientMetadata','CLIENT_METADATA_ENABLED'],['artefactVersions','ARTEFACT_VERSIONS_ENABLED']])Object.defineProperty(entries,key,{get:()=>siteGlobal(config,name)});entries.manifest=options=>federationEntryManifest(config,entries,{...options,mounts:manifestMounts});return entries;
}

export const ENTRY_METHODS=['admit','admitHost','create','view','documentPolicy','challenge','verify','declarePlain','select','decide','endTarget','finishSession'];
/** Worker facade over the entry store, sharded by entry ID across ENTRY_SHARDS Durable Object instances (review M5).
 * Static members are computed locally so route matching and the manifest need no round trip. `invoke(shard,method,
 * args)` returns `{ok,result}` or `{ok:false,error}`. Creation first charges the caller's budgets on the caller's shard,
 * then creates on a random shard; every later call goes to the shard named by the entry ID, so retries always reach
 * the same records. `endSession` mirrors the adapter's session-ending hook. */
export function federationEntriesRemote({config,invoke,endSession=false,directory,manifestMounts={},incremental}){
 if(!capability(config,'FEDERATION_ENTRY_ENABLED'))return null;
 const facade={incremental,issuer:config.APP_ORIGIN,clients:new Map(federationClients(config).map(client=>[client.id,client])),directory,clientMetadata:!!directory?.enabled,embedOrigin:componentsProfile(config)?.embedOrigin,dpop:!!federationDpopSecret(config),intents:()=>[...ENTRY_INTENTS.filter(intent=>intent!=='end-session'||endSession===true),...incremental?.mounted===true?['grant-more','configure']:[]],manifest:options=>federationEntryManifest(config,facade,{...options,mounts:manifestMounts})};
 const call=async(shard,method,args)=>{const envelope=await invoke(shard,method,args);if(!envelope.ok)throw Object.assign(new Error(envelope.error.message),envelope.error);return envelope.result;};
 facade.admit=async input=>call(await remoteShard(crypto,input?.remote),'admit',[input]);
 facade.create=async(input,context={})=>{
  const metadata=!!directory?.isMetadataId(input?.clientId),{origin,remote}=context??{};let client;
  if(typeof remote==='string'&&remote)await facade.admit({clientId:input?.clientId,remote});else if(metadata)fail('temporarily_unavailable','Application sign-in is not available.');
  // Metadata clients: the caller's and the client host's budgets are charged before the front resolves the document;
  // the shard receives only the validated snapshot.
  if(metadata){const hostShard=entryShard(await digest(crypto,`entry-client-host\0${clientSite(new URL(input.clientId).hostname)}`));await call(hostShard,'admitHost',[{clientId:input.clientId}]);try{client=await directory.resolve(input.clientId);}catch(error){if(error?.code==='rate_limited')throw error;fail('invalid_request','The authorization entry could not be created.');}}
  return call(String(crypto.getRandomValues(new Uint8Array(1))[0]%ENTRY_SHARDS).padStart(2,'0'),'create',[input,{origin,remote,admitted:true,...client?{client}:{}}]);};
 facade.documentPolicy=async(entryId,mode)=>{let shard;try{shard=entryShard(entryId);}catch{return 'same-origin';}return call(shard,'documentPolicy',[entryId,mode]);};
 for(const method of ENTRY_METHODS)facade[method]??=async(entryId,...args)=>call(entryShard(entryId),method,[entryId,...args]);
 return facade;
}
/** Alarm step shared by adapters: prune expired rows, then say when to run again (or null when nothing is left). */
export async function federationEntriesCleanup(entries,now=Date.now(),shard){const result=await entries.cleanup(shard===undefined?{}:{shard});return result.remaining?now+60000:result.pending?now+600000:null;}

/** Requests are targeted by the discovered handle; every later opaque locator
 * carries its account shard prefix. Prefixes are validated before instantiation. */
// W5-S4: Worker adapters rebuild the authority per request, so the token-endpoint assertion jti cache lives per isolate
// (not per call). Per-isolate only: a durable cross-isolate store remains required before production.
const systemNow=()=>Date.now(),isolateAssertionReplay=memoryReplayCache({clock:systemNow});
export function federationAuthority({config,repository,shard,clock=systemNow,directory,manifestMounts={}}){
 const issuer=config.APP_ORIGIN,clients=federationClients(config),objectURLs=objectURLAuthority({issuer,secret:config.KEY_ENCRYPTION_KEY}),nonces=federationDpopSecret(config)?dpopNonces({secret:federationDpopSecret(config),clock}):null;
 const routedOrDenied=async id=>{try{return await controllerFor(id);}catch{fail('unauthorized','The embedded session is unavailable.');}};
 const objectController=async(url,operation)=>{const claims=await objectURLs.verify(url,operation);const current=await repository.get(claims.owner);if(!current||current.status!=='active')fail('unauthorized','This object URL is no longer active.');return {claims,controller:shard(claims.owner)};};
 const organizationShard=async org=>{const current=typeof org==='string'&&UUID.test(org)?await repository.get(org):null;if(!current||current.status!=='active'||current.kind!=='organization')fail('not_found','Not found.');return current;};
 const controllerFor=async id=>{const match=typeof id==='string'&&routed.exec(id);if(!match)fail('invalid_request','Invalid provider authorization identifier.');const current=await repository.get(match[1]);if(!current||current.status!=='active')fail('unauthorized','Application authorization is unavailable.');return shard(match[1]);};
 const assertionReplay=clock===systemNow?isolateAssertionReplay:memoryReplayCache({clock});
 // W5-S1: the connection's pinned auth method governs, never the live metadata alone (§2.3: an auth-method change is
 // staged for review), so a taken-over domain cannot downgrade a pinned private_key_jwt client to none. §3.3: a
 // `configuring` connection still exchanges and refreshes.
 const authenticateClient=async(input,controller)=>{const client=await directory?.resolve(input.clientId),pin=directory?.integrations===true&&metadataClient(input.clientId)?await controller.integrationClientAuth(input.clientId):null;if(pin||client?.authMethod==='private_key_jwt'){if(!pin||client?.authMethod!=='private_key_jwt'||client.jwksUri!==pin.jwksUri||!pin.tokenAuth||input.clientAssertionType!==CLIENT_ASSERTION_TYPE)fail('invalid_client','Client authentication required.');const keys=pinnedKeys(await directory.resolveKeys({id:pin.clientId,authMethod:'private_key_jwt',jwksUri:pin.jwksUri}),pin.thumbprints);await verifyClientAssertion(input.clientAssertion,{clientId:input.clientId,audience:issuer+'/oauth/token',keys,now:clock(),replay:assertionReplay});}else if(input.clientAssertion!==undefined||input.clientAssertionType!==undefined)fail('invalid_client','Unsupported client authentication.');const {clientAssertion,clientAssertionType,...safe}=input;return safe;};
 const metadataClient=id=>!!directory?.isMetadataId(id),allowed=async id=>{if(metadataClient(id))await directory.assertAllowed(id);};
 return {clients,directory,
  /** ORG-4: mints the member-context federation token in an ORGANIZATION's shard, at its current federation epoch. */
  async memberAccess(owner,input){const current=typeof owner==='string'&&/^[0-9a-f-]{36}$/.test(owner)?await repository.get(owner):null;if(!current||current.status!=='active'||current.kind!=='organization')fail('invalid_grant','invalid_grant');return shard(owner).memberAccess({...input,epoch:await federationEpoch(current)});},
  async removalSign(input){const signer=config.INTEGRATION_EVENT_PORTS?.signer;if(typeof signer?.sign!=='function')fail('removal_unavailable','Removal signing is unavailable.');return signer.sign('removal',buildRemovalClaims({...input,issuer},{clock}));},
  async removalVerifyAssertion({owner,clientId,removal,assertion}){if(!UUID.test(owner??''))fail('invalid_client','Client authentication required.');const current=await repository.get(owner);if(!current||current.status!=='active')fail('invalid_client','Client authentication required.');const pin=await shard(owner).integrationClientAuth(clientId);if(!pin?.tokenAuth||pin.clientId!==clientId||!directory)fail('invalid_client','Client authentication required.');const keys=pinnedKeys(await directory.resolveKeys({id:pin.clientId,authMethod:'private_key_jwt',jwksUri:pin.jwksUri}),pin.thumbprints);const claims=await verifyRemovalAssertion(assertion,{removal,clientId,audience:issuer+'/bindle/removal/complete',keys,now:clock(),replay:(clientId,jti,until)=>shard(owner).removalNonce({clientId,jti,until})});return {claims,clientId,owner};},
  ready:()=>siteGlobal(config,'FEDERATION_ENABLED')&&(clients.length>0||!!directory?.enabled),
  manifest:()=>withManifestDeclarations({version:'0',issuer,authorization_endpoint:`${issuer}/oauth/authorize`,authorization_request_endpoint:`${issuer}/api/oauth/requests`,token_endpoint:`${issuer}/oauth/token`,rpc_endpoint:`${issuer}/bindle/rpc`,jwks_uri:`${issuer}/oauth/jwks`,preferences_contract:PREFERENCES,grant_types_supported:!capability(config,'FEDERATION_REFRESH_ENABLED')?['authorization_code']:['authorization_code','refresh_token'],login_presentation:['redirect'],revocation_endpoint:`${issuer}/oauth/revoke`,...nonces?{dpop_signing_alg_values_supported:['ES256']}:{},contracts:[]},federationDeclarations(config,{target:'authority',directory,mounts:{...manifestMounts,...brokeringMounts(config)}})),
  async beginAuthorization(input,{caller}={}){if(!input||typeof input.identity!=='string'||input.identity.length>320)fail('invalid_request','The discovered identity handle is required.');const parts=input.identity.split('@'),host=new URL(issuer).host;if(parts.length!==2||parts[1].toLowerCase()!==host)fail('invalid_request','The identity must belong to this provider.');let handle;try{handle=normalizeHandle(parts[0]);}catch{fail('invalid_request','Invalid identity handle.');}const current=await repository.findByHandle(handle);if(!current||current.status!=='active')fail('invalid_request','This identity cannot authorize an application.');const {identity,...request}=input;
   // Resolved here, never taken from the caller: the owner shard receives a validated snapshot as a separate argument.
   if(metadataClient(request.clientId))return shard(current.id).beginAuthorization(request,{client:await directory.resolve(request.clientId),caller});
   return shard(current.id).beginAuthorization(request,{caller});},
  inspect:async(context,id)=>(await controllerFor(id)).inspect(context,id),
  async configure(context,input){const owner=typeof context?.sessionToken==='string'?context.sessionToken.split('.')[0]:'';if(!UUID.test(owner))fail('unauthorized','Sign in to continue.');const current=await repository.get(owner);if(!current||current.status!=='active')fail('unauthorized','Sign in to continue.');return shard(owner).configure(context,input);},
  async appSessions(context,input){const owner=context?.sessionToken?.split('.')[0];if(!UUID.test(owner??'')||(await repository.get(owner))?.status!=='active')fail('unauthorized');return shard(owner).appSessions(context,input);},
  async grants(context){const owner=typeof context?.sessionToken==='string'?context.sessionToken.split('.')[0]:'';if(!UUID.test(owner))fail('unauthorized','Sign in to continue.');const current=await repository.get(owner);if(!current||current.status!=='active')fail('unauthorized','Sign in to continue.');return shard(owner).grants(context);},
  /** ORG-5: the organization's preferences, read or configured by one of its admins (the shard checks the power). */
  async organizationPreferences(context,org){await organizationShard(org);return shard(org).preferences({...context,organization:{epoch:context?.organization?.epoch,aep:context?.organization?.aep,id:org}});},
  async organizationConfigure(context,org,input){await organizationShard(org);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['fragment','values','expectedRevision'].includes(k)))fail('invalid_request','Unsupported preferences request.');return shard(org).configure({...context,organization:{epoch:context?.organization?.epoch,aep:context?.organization?.aep,id:org}},input);},
  async preferences(context){const owner=typeof context?.sessionToken==='string'?context.sessionToken.split('.')[0]:'';if(!UUID.test(owner))fail('unauthorized','Sign in to continue.');const current=await repository.get(owner);if(!current||current.status!=='active')fail('unauthorized','Sign in to continue.');return shard(owner).preferences(context);},
  revoke:async(context,id)=>(await controllerFor(id)).revoke(context,id),exchange:async input=>{await allowed(input?.clientId);const controller=await controllerFor(input.code);return controller.exchange(await authenticateClient(input,controller));},tokenClient:async token=>(await controllerFor(token)).tokenClient(token),rpc:async(token,envelope,transport)=>{const controller=await controllerFor(token),waits=busWaitsPort(config.EVENT_BUS_WAITS)??config.EVENT_BUS_WAITER;if(!waits||envelope?.contract!==EVENT_BUS_CONTRACT||envelope.method!=='read')return controller.rpc(token,envelope,transport);const clientId=await controller.tokenClient(token);if(!siteEnabled(config,'EVENT_BUSES_ENABLED',{subject:{kind:'account',owner:token.split('.')[0]},client:{clientId}},true))return controller.rpc(token,envelope,transport);return holdBusRPC({owner:token.split('.')[0],waits,rpc:lease=>controller.rpc(token,envelope,{...transport,busWaits:true,...lease?{busResume:lease}:{}}),recheck:()=>controller.tokenClient(token)});},
  refresh:async input=>{await allowed(input?.clientId);const controller=await controllerFor(input.refreshToken);return controller.refresh(await authenticateClient(input,controller));},
  approve:async(context,input,options)=>(await controllerFor(input.requestId)).approve(context,input,options),
  async entryIdentity(context,owner){if(!UUID.test(owner))fail('unauthorized','Sign in to continue.');const current=await repository.get(owner);if(!current||current.status!=='active')fail('unauthorized','Sign in to continue.');return shard(owner).entryIdentity(context);},
  beginEntryAuthorization:async(context,input,options)=>(await controllerFor(input.requestId)).beginEntryAuthorization(context,input,options),
  // RFC 7009: malformed, unroutable or inactive-account tokens are a silent success.
  async revokeToken(input){if(!clients.some(c=>c.id===input?.clientId)&&!metadataClient(input?.clientId))fail('invalid_client','Unregistered application.');let controller;try{controller=await controllerFor(input.token);}catch{return {};}try{return await controller.revokeToken(input);}catch(error){if(error.code==='invalid_client')throw error;return {};}},
  redeemClaim:async input=>(await routedOrDenied(input.claim)).redeemClaim(input),embedSession:async input=>(await routedOrDenied(input.credential)).embedSession(input),embedState:async input=>(await routedOrDenied(input.session)).embedState(input),embedForget:async input=>(await routedOrDenied(input.credential)).embedForget(input),
  embedAvatar:async input=>(await routedOrDenied(input.session)).embedAvatar(input),embedEvents:async input=>(await routedOrDenied(input.session)).embedEvents(input),embedEventsTick:async input=>(await routedOrDenied(input.session)).embedEventsTick(input),
  // Ending is state-reducing and answers identically for unknown, unroutable or inactive sessions.
  async embedEnd(input){let controller;try{controller=await controllerFor(input?.session);}catch{return {};}try{return await controller.embedEnd(input);}catch{return {};}},
  async dpopNonce(purpose){if(!nonces||!['token','embed'].includes(purpose))fail('temporarily_unavailable','DPoP is not configured.');return nonces.issue(purpose);},
  async inspectObjectURL(url,operation){const {claims,controller}=await objectController(url,operation);return controller.inspectObjectURL(claims);},
  async objectURL(url,operation,args){const {claims,controller}=await objectController(url,operation);return controller.objectURL({...claims,args});}
 };
}
