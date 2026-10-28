import {producerIndexedMetadata} from '../../packages/storage/producer-index.mjs';
import {intentIndexedMetadata} from '../../packages/intents/index.mjs';
import {configuredArtefacts} from '../../packages/runtime/artefact-pins.mjs';
import {siteGlobal,capability,flagsFor} from '../../packages/flags/read.mjs';
import {FlagsRuntime,flagWriter} from '../../packages/runtime/flags.mjs';
import {createNodeFlagStats} from './flag-stats.mjs';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {createNodeEventEgress} from '../../packages/runtime/integration-events.mjs';
import {createNodeIntegrationEgress} from '../../packages/federation/node-integration-egress.mjs';
import {integrationSnapshot} from '../../packages/federation/integrations.mjs';
import {preferencesSnapshotPort,handleBrokeredIntrospection} from '../../packages/federation/introspection.mjs';
import {integrationPorts} from '../../packages/runtime/integration-ports.mjs';
import {federationIncremental,INCREMENTAL_STORE} from '../../packages/runtime/incremental-authorization.mjs';
import {memoryBusWaits} from '../../packages/events/waiter.mjs';
import {brokeringKeys,brokeringEnabled,mintAccessToken} from '../../packages/federation/signing.mjs';
import {activePopulationPort} from '../../packages/runtime/active-population.mjs';
import {configuredFormOrigins} from '../../packages/apps/form-fetch-policy.mjs';
import {createNodeFormFetch} from '../../packages/apps/node-form-fetch.mjs';
import {PlanCatalogRegistry,cachedCatalogPort} from '../../packages/billing/registry.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, unlink, stat, open } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createNodeAssets } from './assets.mjs';
import {nodeSqlPort} from '../../packages/search/index.mjs';
import { IdentityRepository, FixedWindowGuard, AccountController } from '../../packages/runtime/accounts.mjs';
import {organizationOwnerChannels} from '../../packages/identity/owner-channels.mjs';
import {organizationAdminPorts} from '../../packages/runtime/admin-org-cases.mjs';
import {McpShardController,mcpAuthorities} from '../../packages/mcp/runtime.mjs';
import {MCP_SHARDS} from '../../packages/mcp/service.mjs';
import {FederationController,federationMetadata} from '../../packages/federation/runtime.mjs';
import {messagingAddressMounted,federationAuthority,federationControllerOptions,federationEntries,federationEntriesCleanup,FEDERATION_LAYOUT,federationEpoch,federationClientDirectory,clientMetadataEnabled} from '../../packages/runtime/federation.mjs';
import {createNodeClientMetadataFetch} from '../../packages/federation/node-client-metadata-fetch.mjs';
import {nodeDirectoryEgress} from '../../packages/federation/node-directory-fetch.mjs';
import {adminClientBlocked} from '../../packages/identity/admin.mjs';
import {metadataClientHost,clientSite} from '../../packages/federation/client-metadata.mjs';
import {digest} from '../../packages/core/records.mjs';
import {ENTRY_SHARDS,entryShard,remoteShard} from '../../packages/federation/authorization-entries.mjs';
import {AdminStorage,narrowAdminStore} from '../../packages/identity/admin-store.mjs';
import {MemoryLinkedLimits} from '../../packages/identity/linked-approval.mjs';
import {deviceGrantMountable} from '../../packages/runtime/device-grant.mjs';
import {attachAppSessions} from '../../packages/federation/device-authorization.mjs';
import {lifecycleIdentityPort,lifecycleAdminHoldPort,deletionHoldPort,deletionAdminAuthorityPort} from '../../packages/identity/lifecycle-tombstone.mjs';
import {identitySecurityPort} from '../../packages/identity/service.mjs';
import {deletionDueIndex,sweepDeletionDue,deletionDueSweepRun} from '../../packages/runtime/account-deletion.mjs';
import {createDeletionNotices} from '../../packages/runtime/deletion-notices.mjs';
import {transferIdentityPort,createTransferNotices,attestorFromJwk,transferDueIndex,sweepTransferDue} from '../../packages/identity/transfer-out.mjs';
import {redirectRecordsPort,createRedirectReminders} from '../../packages/identity/redirect-records.mjs';
import {portabilityClient} from '../../packages/identity/successors.mjs';
import {redirectCapability} from '../../packages/runtime/redirect-extension.mjs';
import {transferInIdentityPort} from '../../packages/identity/transfer-in.mjs';
import {transferInRecoveryPort} from '../../packages/identity/recovery-reissue.mjs';
import {createNodePortabilityFetch} from '../../packages/identity/node-portability-fetch.mjs';
import {createExportAdapterPorts} from '../../packages/runtime/account/exports.mjs';
import {exportNoticePort,exportGrantsPort} from '../../packages/runtime/export-ports.mjs';
import {lifecycleMode} from '../../packages/runtime/lifecycle-runner.mjs';
import {LifecycleSweep} from '../../packages/runtime/lifecycle-scheduler.mjs';
import {createPushTransport} from '../../packages/activity/web-push.mjs';

export class SerialGate {
 constructor(){this.tail=Promise.resolve();}
 async run(operation){const previous=this.tail;let release;this.tail=new Promise(r=>release=r);await previous;try{return await operation();}finally{release();}}
}
export class SqliteMetadata {
 constructor(file){this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');this.gate=new SerialGate();this.timer=null;this.closed=false;this.sql=nodeSqlPort(this.db);return producerIndexedMetadata(intentIndexedMetadata(this));}
 raw(){const self=this;return {
  get:async key=>{const row=self.db.prepare('SELECT value FROM records WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;},
  put:async(key,value)=>{if(typeof key==='object'){for(const [k,v]of Object.entries(key))await self.raw().put(k,v);return;}self.db.prepare('INSERT INTO records(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));},
  delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])self.db.prepare('DELETE FROM records WHERE key=?').run(key);},
  list:async({prefix='',startAfter='',limit=100000}={})=>new Map(self.db.prepare('SELECT key,value FROM records WHERE key>=max(?,?) AND key<? AND key<>? ORDER BY key LIMIT ?').all(prefix,startAfter,prefix+'\uffff',startAfter,limit).map(row=>[row.key,JSON.parse(row.value)])),
  getAlarm:async()=>self.raw().get('@alarm'),
  setAlarm:async time=>{await self.raw().put('@alarm',time);self.arm(time);}
 };}
 get(key){return this.gate.run(()=>this.raw().get(key));}
 put(key,value){return this.gate.run(()=>this.raw().put(key,value));}
 delete(key){return this.gate.run(()=>this.raw().delete(key));}
 list(options){return this.gate.run(()=>this.raw().list(options));}
 deleteAll(){return this.gate.run(()=>this.db.exec('DELETE FROM records'));}
 /** Lifecycle purge: clears every table in this account file (FTS through its virtual table, never shadow tables) and compacts it. */
 purgeAll({keep=[]}={}){return this.gate.run(()=>{const tables=this.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(),virtual=tables.filter(t=>/^CREATE VIRTUAL TABLE/i.test(t.sql||'')).map(t=>t.name);this.db.exec('BEGIN IMMEDIATE');try{for(const {name}of tables)if(name==='records'){const statement=this.db.prepare(`DELETE FROM records WHERE key NOT IN (${keep.map(()=>'?').join(',')||"''"})`);statement.run(...keep);}else if(!virtual.some(v=>name.startsWith(v+'_')))this.db.exec(`DELETE FROM "${name.replaceAll('"','""')}"`);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}this.db.exec('VACUUM');});}
 async transaction(operation){return this.gate.run(async()=>{this.db.exec('BEGIN IMMEDIATE');try{const value=await operation(this.raw());this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}});}
 async setAlarm(time){await this.put('@alarm',time);this.arm(time);}
 getAlarm(){return this.get('@alarm');}
 arm(time){clearTimeout(this.timer);if(this.closed||!this.onAlarm)return;this.timer=setTimeout(async()=>{if(this.closed)return;if(Date.now()<time){this.arm(time);return;}try{const claimed=await this.transaction(async tx=>{if(this.closed||await tx.get('@alarm')!==time)return false;await tx.delete('@alarm');return true;});if(!claimed||this.closed)return;await this.onAlarm();}catch(error){if(this.closed)return;try{const next=await this.getAlarm();if(this.closed)return;if(!next)await this.setAlarm(Date.now()+60000);else this.arm(next);}catch(retryError){if(!this.closed)throw retryError;}}},Math.min(2147483647,Math.max(1,time-Date.now())));this.timer.unref();}
 close(){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.timer=null;this.db.close();}
}
export class FileBucket {
 constructor(directory){this.directory=directory;}
 path(key){return join(this.directory,createHash('sha256').update(key).digest('hex'));}
 async put(key,content){await mkdir(this.directory,{recursive:true,mode:0o700});const destination=this.path(key),temporary=destination+'.'+randomUUID();const bytes=typeof content==='string'?content:new Uint8Array(content);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await rename(temporary,destination);}catch(error){try{await unlink(temporary);}catch{}throw error;}const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}return {key};}
 // DX-2 (R1-M9): an optional single range, and a lazily opened streaming body. Without a range the object reads
 // exactly as before.
 async get(key,{range}={}){
  const path=this.path(key);try{
   const size=(await stat(path)).size;
   if(range!==undefined&&(!Number.isSafeInteger(range?.offset)||range.offset<0||!Number.isSafeInteger(range.length)||range.length<0))throw new RangeError('Invalid object range');
   const offset=range?.offset??0,length=range?Math.max(0,Math.min(range.length,size-offset)):size;let body;
   const bytes=async()=>{const b=await readFile(path);return range?b.subarray(offset,offset+length):b;};
   return {size,
    get body(){return body??=(length?Readable.toWeb(createReadStream(path,{start:offset,end:offset+length-1})):new Blob([]).stream());},
    arrayBuffer:async()=>{const b=await bytes();return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
    text:async()=>(await bytes()).toString('utf8'),
    json:async()=>JSON.parse((await bytes()).toString('utf8'))};
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async delete(keys){let deleted=false;for(const key of Array.isArray(keys)?keys:[keys])try{await unlink(this.path(key));deleted=true;}catch(error){if(error.code!=='ENOENT')throw error;}if(deleted){const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}}
}
export async function nodeResources({directory,config,formTransport,mailer}){
 if(formTransport===undefined)try{const origins=configuredFormOrigins(config);if(origins.length)formTransport=createNodeFormFetch({allowedOrigins:origins});}catch(error){if(error.code!=='form_transport_unavailable')throw error;/* Invalid optional egress configuration disables only postbacks. */}
 if(formTransport!==undefined&&typeof formTransport?.send!=='function')throw new TypeError('Invalid form transport port.');
 await mkdir(directory,{recursive:true,mode:0o700});await mkdir(join(directory,'accounts'),{recursive:true,mode:0o700});await mkdir(join(directory,'abuse'),{recursive:true,mode:0o700});
 const catalogDb=new SqliteMetadata(join(directory,'plan-catalog.sqlite')),catalogRegistry=new PlanCatalogRegistry({metadata:catalogDb,config}),catalog=cachedCatalogPort(catalogRegistry);
 const identities=new SqliteMetadata(join(directory,'identities.sqlite'));const repository=new IdentityRepository({metadata:identities,config});identities.onAlarm=()=>repository.alarm();{const alarm=await identities.getAlarm();if(alarm)identities.arm(alarm);}
 const deviceDb=new SqliteMetadata(join(directory,'devices.sqlite'));const deviceRepo=new IdentityRepository({metadata:deviceDb});deviceDb.onAlarm=()=>deviceRepo.alarm();{const alarm=await deviceDb.getAlarm();if(alarm)deviceDb.arm(alarm);}
 const deviceRequests={create:r=>deviceRepo.createDevice(r),get:id=>deviceRepo.getDevice(id),findByUserCode:code=>deviceRepo.findDeviceByCode(code),compareAndSwap:(id,revision,r)=>deviceRepo.compareAndSwapDevice(id,revision,r)};
 // Linked approval: `deviceRequests` is also the `linkedApprovals` repository; budgets use the durable abuse windows, poll intervals a non-durable limiter.
 const linkedPollLimits=new MemoryLinkedLimits();let linkedLimits;
 // ORG-7 egress for foreign member-certificate issuers (gated in packages/runtime/account/foreign-directory.mjs). Injected
 // DIRECTORY_DNS_LOOKUP/DIRECTORY_HTTPS_REQUEST replace only DNS and the socket; the screening policy stays.
 const directoryEgress=nodeDirectoryEgress({...typeof config.DIRECTORY_DNS_LOOKUP==='function'?{lookup:config.DIRECTORY_DNS_LOOKUP}:{},...typeof config.DIRECTORY_HTTPS_REQUEST==='function'?{request:config.DIRECTORY_HTTPS_REQUEST}:{}});
 const blobs=new FileBucket(join(directory,'blobs')),archives=new FileBucket(join(directory,'archives'));const accountMap=new Map(),guardMap=new Map();
 // Lifecycle ports exist only when LIFECYCLE_ENABLED. FileBucket has no storage classes, so cold tiering reports unsupported.
 let adminStore;const flagsRuntime=new FlagsRuntime({env:config,platform:'node',store:{flagsSnapshot:()=>adminStore.flagsSnapshot()}}),flagStats=createNodeFlagStats(join(directory,'flag-stats.sqlite'));const lifecycleConfig=lifecycleMode(config)==='off'?{}:{LIFECYCLE_IDENTITY:lifecycleIdentityPort(repository),LIFECYCLE_ADMIN_HOLD:owner=>lifecycleAdminHoldPort({store:adminStore,repository})(owner),LIFECYCLE_MAIL:mailer??null,LIFECYCLE_PUSH:createPushTransport(config),LIFECYCLE_COLD_STORAGE_SUPPORTED:false};
 const adminDb=new SqliteMetadata(join(directory,'admin.sqlite'));adminStore=new AdminStorage(adminDb);const commit=adminStore.commit.bind(adminStore);adminStore.commit=async input=>{const result=await commit(input);if(result.committed&&Object.hasOwn(input.writes??{},'flags-head')){flagsRuntime.invalidate();try{await flagsRuntime.publish(await adminStore.flagsSnapshot());}catch{/* Commit succeeded; the next pin retries the invalidated cache. */}}return result;};await flagsRuntime.pin();config.FLAGS_RUNTIME=flagsRuntime;
 const artefactDb=new SqliteMetadata(join(directory,'artefacts.sqlite'));config.ARTEFACTS=configuredArtefacts({config,store:artefactDb});
 let population;const guardFor=async name=>{const file=createHash('sha256').update(name).digest('hex');if(!guardMap.has(file)){const metadata=new SqliteMetadata(join(directory,'abuse',file+'.sqlite'));const guard=new FixedWindowGuard({metadata,config:{...config,...name==='active-user-v1/census'?{ACTIVE_POPULATION_CENSUS:()=>population.censusStep()}:{} }});metadata.onAlarm=()=>guard.alarm();guardMap.set(file,{metadata,guard});const alarm=await metadata.getAlarm();if(alarm)metadata.arm(alarm);}return guardMap.get(file).guard;};const abuse={waitlist:async(method,input)=>(await guardFor('signup:waitlist:v1')).waitlistAction(method,input),consume:async(name,limits)=>(await guardFor(name)).consume(limits),consumeSignup:async(name,limits)=>(await guardFor(name)).consumeSignup(limits),signupStatus:async(name,limits)=>(await guardFor(name)).signupStatus(limits)};
 // Restore the one bounded waitlist expiry alarm even before its next visitor.
 await guardFor('signup:waitlist:v1');
 const eventWaits=memoryBusWaits(),eventConfig=eventWaits?{EVENT_BUS_WAITER:eventWaits,EVENT_BUS_WAITS_MOUNTED:true}:{};
 // PORT-4/PORT-6 transfer-in ports, as the Worker's workerTransferOutConfig: the identity and recovery ports and the
 // DNS-pinned public-IPv4 portability egress (packages/identity/node-portability-fetch.mjs). Injected
 // PORTABILITY_DNS_LOOKUP/PORTABILITY_HTTPS_REQUEST replace only DNS and the socket; the screening policy stays. New
 // transfer-ins still need IDENTITY_TRANSFER_IN_ENABLED.
 const transferInPorts={identity:transferInIdentityPort(repository),recovery:transferInRecoveryPort(repository),fetch:createNodePortabilityFetch({...typeof config.PORTABILITY_DNS_LOOKUP==='function'?{lookup:config.PORTABILITY_DNS_LOOKUP}:{},...typeof config.PORTABILITY_HTTPS_REQUEST==='function'?{request:config.PORTABILITY_HTTPS_REQUEST}:{}})};
 let integrationConfig={};const deletionPorts={},transferPorts={},deletionConfig={ACCOUNT_DELETION_PORTS:deletionPorts,TRANSFER_OUT_PORTS:transferPorts,TRANSFER_IN_PORTS:transferInPorts,
  // DX-1/DX-2 export ports. Grants read only shard files that already exist (MCP fan-out never creates stores).
  exportPorts:createExportAdapterPorts({repository,notice:exportNoticePort({repository,mailer}),contributorPorts:{grants:exportGrantsPort({
   devices:async owner=>{if(!existsSync(join(directory,'federation',`${FEDERATION_LAYOUT}-${owner}.sqlite`)))return [];federationShard(owner);return [...(await federationMap.get(owner).metadata.list({prefix:'federation/family/'})).values()].filter(row=>row.subject===`${config.APP_ORIGIN}/entities/${owner}`);},
   federation:async owner=>{if(!existsSync(join(directory,'federation',`${FEDERATION_LAYOUT}-${owner}.sqlite`)))return [];federationShard(owner);return [...(await federationMap.get(owner).metadata.list({prefix:'federation/grant/',limit:1000})).values()];},
   mcp:async owner=>{const rows=[];for(let n=0;n<MCP_SHARDS;n++){const shard=String(n).padStart(2,'0');if(!existsSync(join(directory,'mcp',`mcp-auth-v1-64-${shard}.sqlite`)))continue;const result=await mcpShard(shard).invoke('grants',[owner]);if(!result.ok)throw Object.assign(new Error(result.error.message),result.error);rows.push(...result.result);}return rows;}})}})};// filled once the shards exist (below)
 const accounts={get:id=>{
   if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid account identifier');
   if(!accountMap.has(id)){const metadata=new SqliteMetadata(join(directory,'accounts',id+'.sqlite'));const controller=flagWriter(new AccountController({metadata,gate:new SerialGate(),blobs,archives,config:{...config,...integrationConfig,...lifecycleConfig,...deletionConfig,...eventConfig,APP_REMOVAL_MAIL:mailer??null,APP_REMOVAL_IDENTITY:lifecycleIdentityPort(repository),FORM_POSTBACK_TRANSPORT:formTransport,DIRECTORY_EGRESS:directoryEgress,DEVELOPER_CONTACT_POPULATION:population,BILLING_CATALOG:catalog,FEDERATION_IDENTITY_CHECK:async(owner,epoch)=>{const account=await repository.get(owner);return account?.status==='active'&&await federationEpoch(account)===epoch;},WORK_AUTHORITY:abuse,CONVERSATION_ACCOUNT:owner=>accounts.get(owner),ORGANIZATION_OWNER_CHANNELS:organizationOwnerChannels({config,identity:sub=>repository.get(sub),account:owner=>accounts.get(owner),mailer}),...organizationAdminPorts({narrow:narrowAdminStore((method,args)=>adminStore.invoke(method,args),async()=>id),config}),ORGANIZATION_OWNER_PUSH:createPushTransport(config),IDENTITY_ACCOUNT:async owner=>{const account=await repository.get(owner);return account?{status:account.status,handle:account.handle,kind:account.kind==='organization'?'organization':'person',aep:account.aep,identityUri:account.identityUri??null}:null;}},sql:metadata.sql}),flagsRuntime,{flagStats});metadata.onAlarm=()=>controller.alarm();metadata.getAlarm().then(time=>{if(time)metadata.arm(time);});accountMap.set(id,{metadata,controller});}return accountMap.get(id).controller;
 }};

 population=activePopulationPort({repository,accounts,threshold:Number(config.DEVELOPER_CONTACT_ACTIVE_THRESHOLD??1500),authority:async(name,method,input)=>(await guardFor(name)).populationAction(method,input)});await (await guardFor('active-user-v1/census')).populationAction('baseline');
 const assets=createNodeAssets('.output/public');
 await mkdir(join(directory,'mcp'),{recursive:true,mode:0o700});const mcpMap=new Map();
 const mcpShard=shard=>{if(!mcpMap.has(shard)){const metadata=new SqliteMetadata(join(directory,'mcp',`mcp-auth-v1-64-${shard}.sqlite`));const controller=new McpShardController({metadata,config,shard,accounts,repository});metadata.onAlarm=()=>controller.cleanup();metadata.getAlarm().then(time=>{if(time)metadata.arm(time);});mcpMap.set(shard,{metadata,controller});}return mcpMap.get(shard).controller;},mcp=mcpAuthorities(mcpShard);
 await mkdir(join(directory,'federation'),{recursive:true,mode:0o700});const federationMap=new Map();
 // client-id-metadata.v1 (CLIENT_METADATA_ENABLED): DNS-pinned public egress, process-wide plus durable ABUSE budgets,
 // and the administrator block list (read lazily; an unreadable store fails closed). An injected CLIENT_METADATA_FETCH
 // must give equivalent guarantees.
 const clientDirectory=federationClientDirectory(config,{fetch:typeof config.CLIENT_METADATA_FETCH==='function'?config.CLIENT_METADATA_FETCH:createNodeClientMetadataFetch(),limiter:abuse,blocked:host=>adminClientBlocked(adminStore,host)});
 // Device grant (LA3): server.mjs supplies the linked port and the drain once the identity engine exists; every owner
 // service built here gets the host app-session policy and lineage port, and its alarm drains the lineage outbox.
 const device={linked:null,drain:null},deviceMounted=capability(config,'FEDERATION_REFRESH_ENABLED')&&!!(config.DPOP_NONCE_KEY||config.KEY_ENCRYPTION_KEY);

 const brokeringDb=new SqliteMetadata(join(directory,'federation','brokering-v1.sqlite')),brokering=brokeringDb?{enabled:true,...brokeringKeys({issuer:config.APP_ORIGIN,secret:config.KEY_ENCRYPTION_KEY,metadata:federationMetadata(brokeringDb)})}:undefined;
 integrationConfig=integrationPorts(config,brokering?{provision:true,introspection:true,snapshot:preferencesSnapshotPort(owner=>federationShard(owner)),signer:brokering,mint:claims=>mintAccessToken(brokering,claims),eventEgress:createNodeEventEgress({lookup,request:httpsRequest,issuer:config.APP_ORIGIN}),egress:createNodeIntegrationEgress({issuer:config.APP_ORIGIN,reserved:[config.EMBED_ORIGIN].filter(Boolean).map(v=>new URL(v).hostname)}),doorbellGrant:query=>federationShard(query.owner).eventDoorbellGrant(query),describe:query=>accounts.get(query.owner).integrationsMessagingDescribe(query)}:{});
 for(const name of Object.keys(integrationConfig))if(config[name]!==undefined)integrationConfig[name]=config[name];
 if(integrationConfig.BROKERED_INTROSPECTION_MOUNTED)integrationConfig.BROKERED_INTROSPECTION=request=>handleBrokeredIntrospection(request,{issuer:config.APP_ORIGIN,enabled:true,artefactVersions:siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED'),verifyToken:(token,options)=>brokering.verify(token,options),clientKeys:({clientId,jwksUri})=>clientDirectory.resolveKeys({id:clientId,jwksUri,authMethod:'private_key_jwt'}),account:owner=>new Proxy({},{get:(_,method)=>input=>accounts.get(owner)[method](owner,input)}),federation:owner=>federationShard(owner)});
 integrationConfig.APP_REMOVAL_REVOKE_EXTERNAL=row=>federationShard(row.owner).removalRevoke(row);
 // Signaling foreign-delivery egress: the reviewed Node integration egress (public IPv4 only, DNS pinned into TLS, no
 // redirects, bounded). Inert unless the signaling flags are on; it dials only origins on the SIGNALING_FOREIGN_ISSUERS
 // allowlist (packages/signaling/federation.mjs signalingEgress). Kind approval is local (no bound check, Appendix C.2).
 integrationConfig.SIGNALING_EGRESS=config.SIGNALING_EGRESS??createNodeIntegrationEgress({issuer:config.APP_ORIGIN,reserved:[config.EMBED_ORIGIN].filter(Boolean).map(o=>{try{return new URL(o).hostname;}catch{return null;}}).filter(Boolean),...typeof config.DIRECTORY_DNS_LOOKUP==='function'?{lookup:config.DIRECTORY_DNS_LOOKUP}:{},...typeof config.DIRECTORY_HTTPS_REQUEST==='function'?{request:config.DIRECTORY_HTTPS_REQUEST}:{}});
 integrationConfig.INTEGRATION_CLIENT_SNAPSHOT=async client=>integrationSnapshot(client,await clientDirectory.resolveKeys(client));
 for(const {controller}of accountMap.values())Object.assign(controller.config,integrationConfig);
 const federationShard=owner=>{if(!federationMap.has(owner)){const metadata=new SqliteMetadata(join(directory,'federation',`${FEDERATION_LAYOUT}-${owner}.sqlite`));const implementation=new FederationController({...federationControllerOptions({config:{...config,...integrationConfig,...eventConfig},repository,accounts,owner,incremental:{loginDelta:input=>incremental.loginDelta(input),loginOutcome:input=>incremental.loginOutcome(input)},manifestMounts:{messagingAddress:messagingAddressMounted({...config,...integrationConfig})}}),metadata:federationMetadata(metadata)});if(deviceMounted&&device.linked)attachAppSessions(implementation.service,{linked:device.linked,config});metadata.onAlarm=async()=>{const result=await implementation.cleanup();if(result.remaining)await metadata.setAlarm(result.nextAlarmAt);if(device.drain){let pending=false;try{await device.drain({owner});pending=(await device.linked.outbox({owner})).length>0;}catch{pending=true;}if(pending&&!await metadata.getAlarm())await metadata.setAlarm(Date.now()+600000);}};metadata.getAlarm().then(time=>{if(time)metadata.arm(time);});const controller=new Proxy(implementation,{get:(target,method)=>typeof target[method]==='function'?async(...args)=>{const call=async()=>{const result=await target[method](...args);if(!['ready','manifest','cleanup'].includes(method)&&!await metadata.getAlarm())await metadata.setAlarm(Date.now()+600000);return result;};return flagsRuntime.scope.getStore()?call():flagsRuntime.run(await flagsRuntime.pin({alarm:method==='cleanup'}),call);}:target[method]});federationMap.set(owner,{metadata,controller});}return federationMap.get(owner).controller;};
 // DX-3 account deletion ports, independent of LIFECYCLE_ENABLED (new requests still need ACCOUNT_DELETION_ENABLED).
 // Erasure only opens shard files that already exist, so deleting an account never creates federation or MCP stores.
 // Node has no email bridge. R1-M12 is undecided: operatorApps is null, which keeps the inactivity purge unchanged;
 // the deletion flag stays off until it is decided. The notices port (DX-5) is not wired: requests hold before commit.
 const deletionDue=deletionDueIndex(identities);
 Object.assign(deletionPorts,{identity:lifecycleIdentityPort(repository),security:identitySecurityPort(repository),hold:owner=>deletionHoldPort({store:adminStore,repository})(owner),adminAuthority:owner=>deletionAdminAuthorityPort({store:adminStore,repository})(owner),due:deletionDue,
  erasure:{federation:{eraseSubject:async owner=>existsSync(join(directory,'federation',`${FEDERATION_LAYOUT}-${owner}.sqlite`))?federationShard(owner).eraseSubject():{deleted:0,absent:true}},
   mcp:{eraseSubject:async owner=>{let deleted=0;for(let n=0;n<MCP_SHARDS;n++){const shard=String(n).padStart(2,'0');if(!existsSync(join(directory,'mcp',`mcp-auth-v1-64-${shard}.sqlite`)))continue;const result=await mcpShard(shard).invoke('eraseSubject',[owner]);if(!result.ok)throw Object.assign(new Error(result.error.message),result.error);deleted+=result.result.deleted;}return {deleted};}},
   emailBridge:null,operatorApps:null}});
 // DX-5 notices over the injected mailer (sendDeletionNotice) and Web Push. An unusable origin leaves it unwired.
 try{deletionPorts.notices=createDeletionNotices({origin:config.APP_ORIGIN,flags:{for:ctx=>flagsFor(config,ctx)},mail:mailer??null,push:createPushTransport(config)});}catch{/* requests hold before commit */}
 // PORT-2 identity transfer-out ports (packages/identity/transfer-out.mjs): notices over the injected mailer
 // (sendTransferNotice) and Web Push, the attestation key set (IDENTITY_ATTESTATION_KEYS, or the legacy single
 // IDENTITY_ATTESTATION_KEY; commits hold without it) and a
 // transfer-due index in the identity directory, swept with the deletion index. New transfers need the flag.
 const transferDue=transferDueIndex(identities);
 Object.assign(transferPorts,{identity:transferIdentityPort(repository),attestor:attestorFromJwk(config.IDENTITY_ATTESTATION_KEYS??config.IDENTITY_ATTESTATION_KEY),issuer:config.APP_ORIGIN,due:transferDue});
 try{transferPorts.notices=createTransferNotices({origin:config.APP_ORIGIN,mail:mailer??null,push:createPushTransport(config)});}catch{/* commits hold until a notice is accepted */}
 const federation=federationAuthority({config:{...config,...integrationConfig,...eventConfig},repository,directory:clientDirectory,manifestMounts:{deviceAuthorization:deviceMounted,messagingAddress:messagingAddressMounted({...config,...integrationConfig}),signalingResource:true,signaling:typeof integrationConfig.SIGNALING_EGRESS?.send==='function'},shard:federationShard});
 // The pre-owner authorization-entry store, sharded by entry ID like the MCP stores (one SQLite file per shard, each
 // pruned by its own alarm); null unless FEDERATION_ENTRY_ENABLED. packages/runtime/http.mjs mounts the provider
 // session-ending hook, so end-session is offered.
 const incrementalDb=capability(config,'FEDERATION_ENTRY_ENABLED')?new SqliteMetadata(join(directory,'federation',INCREMENTAL_STORE+'.sqlite')):null,incremental=incrementalDb?federationIncremental({config,provision:true,store:federationMetadata(incrementalDb),shard:federationShard}):null;
 if(incrementalDb&&incremental){incrementalDb.onAlarm=async()=>{await incremental.cleanup();await incrementalDb.setAlarm(Date.now()+600000);};await incrementalDb.setAlarm(Date.now()+600000);}
 const entryShards=new Map();let federationEntryStore=null;
 if(capability(config,'FEDERATION_ENTRY_ENABLED')){
  const shardOf=shard=>{if(!entryShards.has(shard)){const db=new SqliteMetadata(join(directory,'federation',`authorization-entries-v2-${ENTRY_SHARDS}-${shard}.sqlite`));db.onAlarm=async()=>{const next=await federationEntriesCleanup(entries,Date.now(),shard);if(next)await db.setAlarm(next);};db.getAlarm().then(time=>{if(time)db.arm(time);});entryShards.set(shard,{db,store:federationMetadata(db)});}return entryShards.get(shard);};
  const entries=federationEntries({config,store:shard=>shardOf(shard).store,authority:federation,endSession:true,directory:clientDirectory,incremental});
  // Creation writes the caller's budget shard and the entry's shard; both arm their cleanup alarm.
  const arm=async shard=>{const {db}=shardOf(shard);if(!await db.getAlarm())await db.setAlarm(Date.now()+600000);};
  const create=entries.create.bind(entries);entries.create=async(input,context={})=>{const result=await create(input,context);await arm(entryShard(result.entryId));await arm(await remoteShard(crypto,context.remote));if(entries.metadataClient(input?.clientId))await arm(entryShard(await digest(crypto,`entry-client-host\0${clientSite(metadataClientHost(input.clientId))}`)));return result;};
  federationEntryStore=entries;
 }

 // Lifecycle scheduler: a six-hourly sweep (the Worker cron cadence) plus its own continuation alarm.
 // Opening each swept account re-arms its persisted alarm, so abandoned accounts wake after a restart.
 let lifecycleDb=null,lifecycleTimers=[];
 if(lifecycleMode(config)!=='off'){
  lifecycleDb=new SqliteMetadata(join(directory,'lifecycle.sqlite'));const sweep=new LifecycleSweep({metadata:lifecycleDb,repository,accounts,config:{...config,ACCOUNT_DELETION_DUE:deletionDue}});const run=trigger=>sweep.run({trigger}).catch(()=>{});
  lifecycleDb.onAlarm=()=>run('alarm');{const alarm=await lifecycleDb.getAlarm();if(alarm)lifecycleDb.arm(alarm);}
  lifecycleTimers=[setTimeout(()=>run('startup'),60000),setInterval(()=>run('cron'),6*3600000)];for(const timer of lifecycleTimers)timer.unref();
 }else{
  // DX-3: with the lifecycle off, due account deletions are still swept (the per-account alarm is primary). Wargame 4:
  // the sweep always starts and each run follows the live flag (background semantics: only the env kill stops it), so a
  // console enable after boot is honoured.
  const run=deletionDueSweepRun({flags:()=>flagsRuntime.pin(),index:deletionDue,accounts});lifecycleTimers=[setTimeout(run,60000),setInterval(run,6*3600000)];for(const timer of lifecycleTimers)timer.unref();
 }
 // PORT-2 scheduler backstop: steps due transfers and ends moved records after their windows (the account alarm is primary).
 // Opted-in redirect expiry reminders over the injected mailer (sendRedirectReminder); acceptance only, never delivery.
 {let reminders=null;try{reminders=createRedirectReminders({records:redirectRecordsPort(repository),mail:mailer??null,origin:config.APP_ORIGIN,capability:account=>redirectCapability(config,account),client:typeof transferInPorts?.fetch==='function'?portabilityClient({fetch:transferInPorts.fetch}):null});}catch{/* reminder rows wait */}
 const run=()=>sweepTransferDue({index:transferDue,identity:transferPorts.identity,accounts,reminders}).catch(()=>{});const timers=[setTimeout(run,60000),setInterval(run,6*3600000)];for(const timer of timers)timer.unref();lifecycleTimers.push(...timers);}
 linkedLimits={consume:(key,window)=>abuse.consume('linked-v1:'+key,window)};
 // DX-2: the edge export stream reads parts and payloads directly from the buckets, as the Worker's bindings do.
 Object.assign(integrationConfig,{BLOBS:blobs,ARCHIVES:archives});
 const attachDeviceGrant=({linked,drain})=>{if(!deviceMounted)return;device.linked=linked;device.drain=drain;for(const {controller}of federationMap.values())attachAppSessions(controller.service,{linked,config});};
 return {transferInPorts,redirectExtensionDue:transferDue,flagsRuntime,flagStats,integrationConfig,incremental,eventWaits,repository,deviceRequests,linkedLimits,linkedPollLimits,accounts,abuse,population,assets,mcp,federation,federationShard,attachDeviceGrant,brokering,federationEntries:federationEntryStore,adminStore,catalog,close(){const statsClosed=flagStats.close();artefactDb.close();incrementalDb?.close();brokeringDb?.close();for(const timer of lifecycleTimers)clearTimeout(timer);lifecycleDb?.close();catalogDb.close();adminDb.close();for(const {db}of entryShards.values())db.close();identities.close();deviceDb.close();for(const {metadata}of accountMap.values())metadata.close();for(const {metadata}of guardMap.values())metadata.close();for(const {metadata}of mcpMap.values())metadata.close();for(const {metadata}of federationMap.values())metadata.close();return statsClosed;}};
}
