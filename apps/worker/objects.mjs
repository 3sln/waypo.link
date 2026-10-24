import {remoteArtefacts,ARTEFACT_STORE} from '../../packages/runtime/artefact-pins.mjs';
import {siteGlobal} from '../../packages/flags/read.mjs';
import {workerFlags,flagWriter,disabledFlagStats} from '../../packages/runtime/flags.mjs';
import {createWorkerFlagStats} from './flag-stats.mjs';
export {FlagStatsObject} from './flag-stats.mjs';
import {workerIntegrationPorts} from './integration-ports.mjs';
import {workerActivePopulation} from './active-population.mjs';
import {configuredFormOrigins} from '../../packages/apps/form-fetch-policy.mjs';
import {createWorkerFormFetch} from './form-fetch.mjs';
import {workerDirectoryEgress} from './directory-fetch.mjs';
import {workerCatalogPort} from './plan-catalog.mjs';
import {ShardedIdentityRepository} from '../../packages/runtime/identity-shards.mjs';
import {federationEpoch} from '../../packages/runtime/federation.mjs';
import {LeasedSemanticSpend} from '../../packages/runtime/semantic-leases.mjs';
import {semanticShard,SEMANTIC_LAYOUT} from '../../packages/runtime/semantic-routing.mjs';
import { DurableObject } from 'cloudflare:workers';
import {AdminStorage} from '../../packages/identity/admin-store.mjs';
export { SemanticBudgetObject } from './semantic-budget.mjs';
import { IdentityRepository, FixedWindowGuard, AccountController } from '../../packages/runtime/accounts.mjs';
import {workerLifecycleConfig,workerDeletionConfig,workerTransferOutConfig} from './lifecycle.mjs';
import {organizationOwnerChannels} from '../../packages/identity/owner-channels.mjs';
import {mailTransport} from './email.mjs';
import {createPushTransport} from '../../packages/messaging/web-push.mjs';

// The Cloudflare adapter supplies persistence, serialization, alarms and buckets.
// Every policy method is the same portable controller used by the Node adapter.
export class IdentityDirectory extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.controller=new IdentityRepository({metadata:ctx.storage,config:env});}
}
export class AbuseGuard extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.controller=new FixedWindowGuard({metadata:ctx.storage,config:{...env,ACTIVE_POPULATION_CENSUS:()=>workerActivePopulation(env).censusStep()}});}
}
const accountArtefacts=config=>config.FEDERATION?remoteArtefacts(config,(method,input)=>config.FEDERATION.get(config.FEDERATION.idFromName(ARTEFACT_STORE)).artefacts(method,input)):undefined;
export class AccountObject extends DurableObject {
  constructor(ctx,env){super(ctx,env);let formTransport;try{const origins=configuredFormOrigins(env);if(origins.length)formTransport=createWorkerFormFetch({allowedOrigins:origins,publicRouting:true});}catch(error){if(error.code!=='form_transport_unavailable')throw error;/* Optional egress must not prevent account access. */}this.controller=new AccountController({metadata:ctx.storage,gate:{run:callback=>ctx.blockConcurrencyWhile(callback)},blobs:env.BLOBS,archives:env.ARCHIVES,config:{...env,...workerIntegrationPorts(env,{describe:query=>this.controller.integrationsMessagingDescribe(query)}),...workerLifecycleConfig(env),...workerDeletionConfig(env),...workerTransferOutConfig(env),ARTEFACTS:accountArtefacts(env),EVENT_BUS_WAITS_MOUNTED:!!env.EVENT_BUS_WAITS,FORM_POSTBACK_TRANSPORT:formTransport,DIRECTORY_EGRESS:workerDirectoryEgress(),DEVELOPER_CONTACT_POPULATION:workerActivePopulation(env),BILLING_CATALOG:workerCatalogPort(env),FEDERATION_IDENTITY_CHECK:async(owner,epoch)=>{const repository=new ShardedIdentityRepository({shard:name=>env.IDENTITIES.get(env.IDENTITIES.idFromName(name)),layout:env.IDENTITY_LAYOUT});const account=await repository.get(owner);return account?.status==='active'&&await federationEpoch(account)===epoch;},CONVERSATION_ACCOUNT:owner=>env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner)),ORGANIZATION_OWNER_CHANNELS:organizationOwnerChannels({config:env,identity:sub=>new ShardedIdentityRepository({shard:name=>env.IDENTITIES.get(env.IDENTITIES.idFromName(name)),layout:env.IDENTITY_LAYOUT}).get(sub),account:owner=>env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner)),mailer:mailTransport(env)}),ORGANIZATION_OWNER_PUSH:createPushTransport(env),IDENTITY_ACCOUNT:async owner=>{const account=await new ShardedIdentityRepository({shard:name=>env.IDENTITIES.get(env.IDENTITIES.idFromName(name)),layout:env.IDENTITY_LAYOUT}).get(owner);return account?{status:account.status,handle:account.handle,kind:account.kind==='organization'?'organization':'person',aep:account.aep,identityUri:account.identityUri??null}:null;},WORK_AUTHORITY:{consume:(key,limits)=>env.ABUSE.get(env.ABUSE.idFromName(key)).consume(limits)},SEMANTIC_SPEND:env.SEMANTIC_BUDGET?new LeasedSemanticSpend({metadata:ctx.storage,authorityFor:async owner=>{const partition=await semanticShard(owner,SEMANTIC_LAYOUT.budgetShards);return {partition,authority:env.SEMANTIC_BUDGET.get(env.SEMANTIC_BUDGET.idFromName(`semantic-spend-v1-${partition}`))};}}):undefined},sql:ctx.storage.sql,sqlTransaction:operation=>ctx.storage.transactionSync(operation)});this.controller=flagWriter(this.controller,workerFlags(env),{flagStats:env.FLAG_STATS?createWorkerFlagStats(env.FLAG_STATS):disabledFlagStats,configure:flags=>({...workerIntegrationPorts({...env,flags},{provision:true,describe:query=>this.controller.integrationsMessagingDescribe(query)}),ARTEFACTS:accountArtefacts({...env,flags}),EVENT_BUS_WAITS_MOUNTED:flags.for({}).global('EVENT_BUSES_ENABLED')&&!!env.EVENT_BUS_WAITS})});}
}
for(const [Adapter,Controller]of [[IdentityDirectory,IdentityRepository],[AbuseGuard,FixedWindowGuard],[AccountObject,AccountController]]){
  for(const method of Object.getOwnPropertyNames(Controller.prototype))if(method!=='constructor')Object.defineProperty(Adapter.prototype,method,{value:function(...args){return this.controller[method](...args);},writable:true,configurable:true});
}
// Host administration (docs/architecture/boot-and-admin.md): one linearizable admin store, addressed as 'admin-v1'.
export class AdminAuthority extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.storage=new AdminStorage(ctx.storage);}
  invoke(method,args){return this.storage.invoke(method,args);}
}
