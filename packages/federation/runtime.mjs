import {DeleteRemovalSettings} from '../storage/producer-summary.mjs';
import {createAppEngine,perform} from '../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../app/providers.mjs';
import {revokeRemovalFederation} from '../runtime/app-removal-federation.mjs';
import {lifecycleUnknown} from '../runtime/public-unknown.mjs';
import {siteGlobal,capability} from '../flags/read.mjs';
import {eventDoorbellGrant} from './event-readers.mjs';
import {appSessionInventory} from './session-inventory.mjs';
import {incrementalPort} from './incremental-ports.mjs';
import {FederationService} from './service.mjs';
import {fail} from './schema.mjs';
import {canonical,digest} from '../messaging/store.mjs';
import {AppQuery} from '../app/engine.mjs';
import {validateExtensions} from './extensions.mjs';
import {providerLegalMetadata} from './legal.mjs';
import {issueMemberAccess} from './member-access.mjs';
const declarationObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const declarationBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const declarationFlag=(config,name)=>typeof name==='string'&&Object.hasOwn(config,name)&&(config[name]===true||config[name]==='true');
/** Trusted composition data, never request input. Each row requires explicit flags AND a mounted predicate;
 * neither a populated key nor an injected service is a mount. Order is wire order; duplicate map keys fail closed.
 * The provider and Query share this synchronous projection so existing local manifest() adapters stay synchronous. */
export function createManifestDeclarationProvider({registry=[],context={}}={}){return Object.freeze({declarations(config={}){
 const result={},ctx={...context,config};
 for(const row of registry){
  const flags=Array.isArray(row.flag)?row.flag:[row.flag];
  if(!flags.length||!flags.every(name=>declarationFlag(config,name))||typeof row.mounted!=='function'||row.mounted(ctx)!==true)continue;
  const declaration=row.declare(ctx);if(!declarationObject(declaration))throw new TypeError('Invalid manifest declaration.');
  for(const [name,value] of Object.entries(declaration)){
   if(['features','profiles'].includes(name)){
    if(!declarationObject(value))throw new TypeError('Invalid manifest declaration container.');
    const map=result[name]??={};for(const [key,members] of Object.entries(value)){
     const validKey=name==='features'?/^[a-z][a-z0-9-]{0,31}\.v[1-9][0-9]{0,2}$/.test(key):validProfile(key);
     if(!validKey||!declarationObject(members)||declarationBytes(members)>(name==='features'?4096:8192)||Object.hasOwn(map,key))throw new TypeError('Invalid or duplicate manifest declaration.');
     Object.defineProperty(map,key,{value:structuredClone(members),enumerable:true,configurable:true,writable:true});
    }
    if(Object.keys(map).length>(name==='features'?32:8))throw new TypeError('Too many manifest declarations.');
   }else if(name==='extensions'){
    if(!Array.isArray(value))throw new TypeError('Invalid extension declarations.');(result.extensions??=[]).push(...structuredClone(value));
   }else if(['grant_types_supported','token_endpoint_auth_methods_supported'].includes(name)){
    if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!item||item.length>256))throw new TypeError('Invalid OAuth declaration.');result[name]=[...new Set([...(result[name]??[]),...value])];
   }else if(name==='device_authorization_endpoint'){
    const url=new URL(value);if(url.origin!==new URL(ctx.issuer).origin||url.username||url.password||url.hash||Object.hasOwn(result,name))throw new TypeError('Invalid device authorization endpoint.');result[name]=value;
   }else throw new TypeError('Unsupported manifest declaration member.');
  }
 }
 if(result.extensions){
  const entries=declarationFlag(config,'EXTENSIONS_ENABLED')&&Object.hasOwn(result.features??{},'extensions.v1')?validateExtensions(result.extensions).filter(value=>value.status!=='invalid').map(value=>value.entry):[];
  if(entries.length)result.extensions=entries;else delete result.extensions;
 }
 for(const name of ['features','profiles'])if(result[name]&&!Object.keys(result[name]).length)delete result[name];
 if(declarationBytes(result)>65536)throw new TypeError('Manifest declarations exceed 64 KiB.');return result;
}});}
function validProfile(value){try{const url=new URL(value);return value.length<=256&&url.protocol==='https:'&&!url.username&&!url.password&&!value.includes('?')&&!value.includes('#');}catch{return false;}}
/** Unrouted engine Query; mounts and registry belong to its federation provider, never its payload. */
export class ManifestDeclarations extends AppQuery {static operation='federation.manifest-declarations';static deps=['config','federation'];fetch({config,federation}){return federation.declarations(config);}}
export function withManifestDeclarations(manifest,declarations={}){
 const result={...manifest};for(const [name,value] of Object.entries(declarations)){
  if(['features','profiles'].includes(name)){const prior=result[name]??{};if(Object.keys(value).some(key=>Object.hasOwn(prior,key)))throw new TypeError('Duplicate manifest declaration.');result[name]={...prior,...value};}
  else if(['grant_types_supported','token_endpoint_auth_methods_supported'].includes(name))result[name]=[...new Set([...(result[name]??[]),...value])];
  else if(name==='extensions')result[name]=[...(result[name]??[]),...value];else result[name]=value;
 }
 if(declarationBytes(result)>65536)throw new TypeError('Manifest exceeds 64 KiB.');return result;
}
const readMethods=new Set(['get','list','read','describe','capabilities','presign']);
const faultResult=(code,message,error={})=>({__federationError:{code,message,...Number.isSafeInteger(error.retryAfter)&&error.retryAfter>0&&error.retryAfter<=2678400?{retryAfter:error.retryAfter}:{}}});
/** Portable composition boundary. Both hosted and self-hosted runtimes inject
 * metadata, live owner authentication and actual contract adapters here. */
export class FederationController {
  constructor({flagConfig,schemaHostProvider,metadata,auth,issuer,clients=[],pinContract,contractVersion,schemaFetcher,schemaHosts=[],dispatcher,crypto=globalThis.crypto,clock=()=>Date.now(),allowInsecureLocalhost=false,enabled=true,routingKey,validateSubject,resourceProvider,connections,refreshEnabled=false,objectURLs,dpop,embedView,embedOrigin,clientMetadata=false,manifestDeclarations,appSessions,incrementalIdentity,eventBusReader,boundChanged,appSessionLineage,deriveAppSession,incremental,brokering,integrations=false,clientAuth,termsAllowed}){
    if(!metadata?.transaction||!auth?.owner)throw new TypeError('Transactional metadata and authenticated owner resource required');
    Object.assign(this,{metadata,auth,issuer,clients,dispatcher,clock,enabled,allowInsecureLocalhost,clientMetadata:clientMetadata===true,manifestDeclarations});
    this.clientAuth=clientAuth;this.service=new FederationService({organizations:arguments[0].organizations,relationImports:arguments[0].relationImports,boundArtefacts:arguments[0].boundArtefacts,pinContract,contractVersion,integrations,store:metadata,issuer,clients,crypto,clock,schemaFetcher,schemaHosts,allowInsecureLocalhost,routingKey,validateSubject,resourceProvider,connections,refreshEnabled,objectURLs,dpop,embedView,embedOrigin,appSessions,brokering,clientMetadata:clientMetadata===true,authenticateOwner:(authority)=>auth.owner(authority.context,{mutation:authority.mutation}),termsAllowed,dispatchCapability:ctx=>this.dispatch(ctx,crypto)});
    this.service.incrementalIdentity=incrementalIdentity;this.service.eventBusReader=eventBusReader;this.service.boundChanged=boundChanged;this.service.appSessionLineage=appSessionLineage;this.service.deriveAppSession=deriveAppSession;this.service.incremental=incremental;
    // Persisted metadata-client snapshots load once per instance before any operation that may consult a client.
    if(this.clientMetadata||flagConfig)for(const method of ['beginAuthorization','inspect','approve','entryIdentity','beginEntryAuthorization','revokeToken','redeemClaim','embedSession','embedState','embedForget','embedAvatar','embedEvents','embedEventsTick','embedEnd','configure','preferences','grants','revoke','narrowBoundOptions','exchange','refresh','tokenClient','rpc','inspectObjectURL','objectURL']){const call=this[method].bind(this);this[method]=async(...args)=>{this.requireReady();await this.service.ensureClients();return call(...args);};}
    if(schemaHostProvider)Object.defineProperty(this.service,'schemaHosts',{get:schemaHostProvider});
    if(flagConfig){
     Object.defineProperty(this.service,'incremental',{get:()=>siteGlobal(flagConfig,'INCREMENTAL_AUTH_ENABLED')?incremental:undefined});
     for(const [target,key,name]of [[this,'enabled','FEDERATION_ENABLED'],[this,'clientMetadata','CLIENT_METADATA_ENABLED'],[this.service,'clientMetadata','CLIENT_METADATA_ENABLED'],[this.service,'integrations','INTEGRATIONS_ENABLED'],[this.service,'boundOptions','EXTENSIONS_ENABLED']])Object.defineProperty(target,key,{get:()=>siteGlobal(flagConfig,name)});
     Object.defineProperty(this.service,'brokering',{get:()=>capability(flagConfig,'BROKERED_INTROSPECTION_MOUNTED')?brokering:null});
    }
  }
  removalRevoke(input){return revokeRemovalFederation(this.service,input);}
  // AU-S4: durable assertion replay fence shared across restarts and Worker isolates. Revocation stays callable
  // when a feature is disabled; only a verified assertion reaches this internal port.
  async removalNonce({clientId,jti,until}={}){const now=this.clock();if(typeof clientId!=='string'||!clientId||clientId.length>2048||typeof jti!=='string'||!/^[\x21-\x7e]{16,128}$/.test(jti)||!Number.isSafeInteger(until)||until<=now||until>now+120000)return false;return this.metadata.transaction(async tx=>{const prefix='federation/removal-nonce/',name=prefix+encodeURIComponent(clientId)+'/'+encodeURIComponent(jti),rows=await tx.list(prefix);let live=0;for(const row of rows)if(row.value.until<=now)await tx.delete(row.key);else live++;if((await tx.get(name))?.until>now||live>=256)return false;await tx.set(name,{until});return true;});}

  integrationClientAuth(clientId){this.requireReady();return this.clientAuth?.(clientId)??null;}
  integrationSnapshot(input){this.requireReady();return this.service.integrationSnapshot(input);}
  brokeredGrantLive(input){this.requireReady();return this.service.brokeredGrantLive(input);}
  brokeredAssertionReplay(input){this.requireReady();return this.service.brokeredAssertionReplay(input);}
  eventDoorbellGrant(input){this.requireReady();return eventDoorbellGrant(this.service,input);}
  appSessions(context,input){this.requireReady();return appSessionInventory(this.service,this.authority(context,input!==undefined),input);}
  incrementalPort(method,input){this.requireReady();return incrementalPort(this.service,method,input);}
  ready(){return this.enabled&&(this.clients.length>0||this.clientMetadata)&&typeof this.service.schemaFetcher==='function'&&(typeof this.dispatcher==='function'||typeof this.dispatcher?.execute==='function');}
  requireReady(){if(!this.ready())fail('temporarily_unavailable','Federation is not configured and release enabled.');}
  manifest(){this.requireReady();return withManifestDeclarations({version:'0',issuer:this.issuer,...providerLegalMetadata(this.issuer),grant_types_supported:['authorization_code',...this.service.refreshEnabled?['refresh_token']:[]],authorization_request_endpoint:`${this.issuer}/api/oauth/requests`,preferences_contract:'https://3sln.me/artefacts/contracts/preferences/v1',authorization_endpoint:`${this.issuer}/oauth/authorize`,token_endpoint:`${this.issuer}/oauth/token`,rpc_endpoint:`${this.issuer}/bindle/rpc`,jwks_uri:`${this.issuer}/oauth/jwks`,login_presentation:['redirect'],revocation_endpoint:`${this.issuer}/oauth/revoke`,...this.service.dpopNonces?{dpop_signing_alg_values_supported:['ES256']}:{},contracts:[]},this.manifestDeclarations?.()??{});}
  // New grants and preference/resource content require current terms. Reads, token use, denial and revocation
  // retain their ordinary authentication; the identity provider rechecks this trusted context at each owner read.
  authority(context,mutation,requireCurrentTerms=false){return {context:requireCurrentTerms?{...context,requireCurrentTerms:true}:context,mutation};}
  beginAuthorization(input,options){this.requireReady();return this.service.beginAuthorization(input,options);}
  inspect(context,id){this.requireReady();return this.service.inspect(id,context?.sessionToken?this.authority(context,false):undefined);}
  approve(context,input,options){this.requireReady();return this.service.approve(this.authority(context,true,input?.denied!==true),input,options);}
  entryIdentity(context){this.requireReady();return this.service.entryIdentity(this.authority(context,true));}
  beginEntryAuthorization(context,input,options){this.requireReady();return this.service.beginEntryAuthorization(this.authority(context,true),input,options);}
  revokeToken(input){this.requireReady();return this.service.revokeToken(input);}
  redeemClaim(input){this.requireReady();return this.service.redeemClaim(input);}
  embedSession(input){this.requireReady();return this.service.embedSession(input);}
  embedState(input){this.requireReady();return this.service.embedState(input);}
  embedForget(input){this.requireReady();return this.service.embedForget(input);}
  embedAvatar(input){this.requireReady();return this.service.embedAvatar(input);}
  embedEvents(input){this.requireReady();return this.service.embedEvents(input);}
  embedEventsTick(input){this.requireReady();return this.service.embedEventsTick(input);}
  embedEnd(input){this.requireReady();return this.service.embedEnd(input);}
  async dpopNonce(purpose){this.requireReady();if(!['token','embed'].includes(purpose)||!this.service.dpopNonces)fail('temporarily_unavailable');return this.service.dpopNonces.issue(purpose);}
  async configure(context,input){this.requireReady();if(input?.removeSettings===true){const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,federation:this.service}});try{return await perform(engine,new DeleteRemovalSettings({authority:this.authority(context,true),input}));}finally{await engine.dispose();}}const out=await this.service.configure(this.authority(context,true,true),input);await this.service.drainBrokeredEvents();return out;}
  registerResource(context,input){this.requireReady();return this.service.registerResource(this.authority(context,true,true),input);}
  async cleanup(input){const events=await this.service.drainBrokeredEvents(),out=await this.service.cleanup(input);return events.pending?{...out,remaining:true,nextAlarmAt:this.clock()+60000}:out;}
  /** DX-3 E3 (account-deletion-export.md §2.3): this store is one owner's federation shard, so erasing the subject
   * deletes every `federation/` row in it: grants, token families, preferences, brokered JTIs, requests, resources
   * and persisted client snapshots. Access already ended at the identity tombstone; this removes the records. */
  /** DX-1 export (grants contributor): this owner shard's grant rows, read without composing authority. */
  async exportGrants(){return [...(await this.metadata.list({prefix:'federation/grant/',limit:1000})).values()];}
  async eraseSubject(){let deleted=0;for(;;){const rows=await this.metadata.list({prefix:'federation/',limit:256});if(!rows.size)return {deleted};await this.metadata.delete([...rows.keys()]);deleted+=rows.size;}}
  preferences(context){this.requireReady();return this.service.preferences(this.authority(context,false));}
  grants(context){this.requireReady();return this.service.grants(this.authority(context,false));}
  async revoke(context,id){this.requireReady();const out=await this.service.revoke(this.authority(context,true),id);await this.service.drainBrokeredEvents();return out;}
  /** RTC-g follow-up: AMD-X1 item 3 owner narrowing of one app's bound options (a mutation: session and CSRF checked by
   * the owner authentication); FederationService.boundSync then tells the occupant hook what remains. */
  narrowBoundOptions(context,input){this.requireReady();return this.service.narrowBoundOptions(this.authority(context,true),input);}
  exchange(input){this.requireReady();return this.service.exchange(input);}
  inspectObjectURL(input){this.requireReady();return this.service.inspectObjectURL(input);}
  objectURL(input){this.requireReady();return this.service.objectURL(input);}
  refresh(input){this.requireReady();return this.service.refresh(input);}
  /** ORG-4: the DPoP-bound member-context access token carrying ORG-3's `token.member` (packages/federation/member-access.mjs). */
  async memberAccess(input){this.requireReady();await this.service.ensureClients();return issueMemberAccess(this.service,input);}
  async tokenClient(bearer){this.requireReady();return this.metadata.transaction(async tx=>(await this.service.token(tx,bearer)).token.clientId);}
  async rpc(token,envelope,transport={}){this.requireReady();const response=await this.service.rpc(token,envelope,{requestOrigin:transport.requestOrigin,busWaits:transport.busWaits===true,...transport.busResume!==undefined?{busResume:transport.busResume}:{}});if(response.result?.__federationError){const {result,...rest}=response;return {...rest,error:result.__federationError};}return response;}
  async dispatch(ctx,crypto){
    // RTC-e: an adapter may classify a contract's own read methods (`readOnly(ctx)`) and keep a write's result out of
    // the journal (`retainResult(ctx) === false`: a retry then answers `indeterminate` instead of a stored result).
    const adapter=this.dispatcher,writing=!readMethods.has(ctx.method)&&adapter?.readOnly?.(ctx)!==true,retain=adapter?.retainResult?.(ctx)!==false;if(writing)await ctx.reauthorize?.();
    const transact=operation=>ctx.transaction?operation(ctx.transaction):this.metadata.transaction(operation);
    const execute=async()=>{await ctx.reauthorize?.();const call=transaction=>{const {reauthorize,...safe}=ctx;const input=transaction?{...safe,transaction}:safe;return typeof adapter==='function'?adapter(input):adapter.execute(input);};return adapter?.transactional===true?transact(call):call();};
    // A remote adapter must itself reserve/deduplicate durably before upstream
    // side effects. This transaction cannot make external requests atomic.
    if(writing&&adapter?.transactional!==true&&adapter?.durableJournal!==true)fail('temporarily_unavailable','This adapter has no verified durable mutation journal.');
    // Reads have no effects to replay. Re-authorize through the service and
    // fetch fresh data without creating fleet-wide per-transaction records.
    if(!writing){try{return await execute();}catch(error){if(['invalid_args','invalid_actions','unsupported_contract','unsupported_method','not_found','forbidden','conflict','quota_exceeded','account_quota_exceeded','rate_limited','storage_write_unavailable','tx_conflict','app_notifications_unavailable','message_receipt_limited','message_receipt_unavailable','message_receipt_disabled','message_receipt_too_large','operation_expired','body_too_large'].includes(error.code))return faultResult(error.code,'The requested operation could not be completed.',error);throw error;}}
    const journalKey=`federation/journal/${encodeURIComponent(ctx.subject)}/${encodeURIComponent(ctx.clientId)}/${ctx.tx}`;
    const fingerprint=await digest(crypto,canonical({resource:ctx.resource,addressedResource:ctx.addressedResource??ctx.resource,contract:ctx.contract,method:ctx.method,args:ctx.args,scope:ctx.scope??{},epoch:ctx.epoch??null,resourceGeneration:ctx.resourceGeneration??null,connectionGeneration:ctx.connection?.generation??null}));
    const prior=await transact(async tx=>{const previous=await tx.get(journalKey);if(previous&&previous.expiresAt>this.clock()){if(previous.fingerprint!==fingerprint)fail('tx_conflict','Transaction identifier was reused with different arguments.');return previous;}const rows=await tx.list('federation/journal/');let live=0;for(const row of rows){if(row.value.expiresAt<=this.clock())await tx.delete(row.key);else live++;}if(live>=256)fail('rate_limited','This account has reached its outstanding transaction limit.');await tx.set(journalKey,{fingerprint,status:'reserved',expiresAt:this.clock()+86400000});return null;});
    if(prior){if(prior.status==='complete'){await ctx.reauthorize?.();if(prior.retained===false)return faultResult('indeterminate','The previous operation completed; its result is not retained. Reconcile through a fresh read.');return prior.result;}return faultResult('indeterminate','The previous operation outcome is unknown. Reconcile through a fresh read.');}
    const save=record=>transact(tx=>tx.set(journalKey,record));
    let result;try{result=await execute();}
    catch(error){if(['invalid_args','invalid_actions','unsupported_contract','unsupported_method','not_found','forbidden','conflict','quota_exceeded','account_quota_exceeded','rate_limited','storage_write_unavailable','tx_conflict','app_notifications_unavailable','message_receipt_limited','message_receipt_unavailable','message_receipt_disabled','message_receipt_too_large','operation_expired','body_too_large'].includes(error.code)){result=faultResult(error.code,'The requested operation could not be completed.',error);await save({fingerprint,status:'complete',result,expiresAt:this.clock()+86400000});return result;}if(lifecycleUnknown(error))throw error;if(writing){result=faultResult('indeterminate','The operation outcome is unknown. Reconcile through a fresh read.');await save({fingerprint,status:'indeterminate',expiresAt:this.clock()+86400000});return result;}throw error;}
    await save(retain?{fingerprint,status:'complete',result,expiresAt:this.clock()+86400000}:{fingerprint,status:'complete',retained:false,expiresAt:this.clock()+86400000});return result;
  }
  /** RTC-e: AMD-X1 item 4 for the built-in RTC occupant (FederationService.checkBound; verified token evidence only). */
  checkBound(input){this.requireReady();return this.service.checkBound(input);}
}

/** Adapt native durable/SQLite get/put/list(Map) metadata into the domain store. */
export function federationMetadata(storage){return {transaction:operation=>storage.transaction(async native=>operation({get:key=>native.get(key),set:(key,value)=>native.put(key,value),delete:key=>native.delete(key),list:async prefix=>[...await native.list({prefix})].map(([key,value])=>({key,value}))}))};}

/** Preserve typed faults across runtimes whose RPC serialization drops Error properties. */
export function federationRemote(stub){const facade={};for(const method of ['memberAccess','ready','manifest','beginAuthorization','inspect','approve','configure','registerResource','revoke','exchange','rpc','tokenClient','grants','preferences','refresh','cleanup','inspectObjectURL','objectURL','entryIdentity','beginEntryAuthorization','revokeToken','redeemClaim','embedSession','embedState','embedForget','embedAvatar','embedEvents','embedEventsTick','embedEnd','dpopNonce','incrementalPort','appSessions','eventDoorbellGrant','integrationSnapshot','brokeredGrantLive','brokeredAssertionReplay','integrationClientAuth','removalRevoke','removalNonce','checkBound','narrowBoundOptions'])facade[method]=async(...args)=>{const envelope=await stub.invoke(method,args);if(!envelope.ok)throw Object.assign(new Error(envelope.error.message),envelope.error);return envelope.result;};return facade;}
