import {DurableObject} from 'cloudflare:workers';
import {ShardedIdentityRepository} from '../../packages/runtime/identity-shards.mjs';
import {LifecycleSweep} from '../../packages/runtime/lifecycle-scheduler.mjs';
import {lifecycleMode} from '../../packages/runtime/lifecycle-runner.mjs';
import {remoteAdminStore} from '../../packages/identity/admin-store.mjs';
import {lifecycleIdentityPort,lifecycleAdminHoldPort,deletionHoldPort,deletionAdminAuthorityPort} from '../../packages/identity/lifecycle-tombstone.mjs';
import {identitySecurityPort} from '../../packages/identity/service.mjs';
import {deletionDueIndex} from '../../packages/runtime/account-deletion.mjs';
import {FEDERATION_LAYOUT} from '../../packages/runtime/federation.mjs';
import {mcpAuthorities} from '../../packages/mcp/runtime.mjs';
import {MCP_LAYOUT} from '../../packages/mcp/service.mjs';
import {eraseOwner} from '../../packages/email-bridge/owner.mjs';
import {createDeletionNotices} from '../../packages/runtime/deletion-notices.mjs';
import {createExportAdapterPorts} from '../../packages/runtime/account/exports.mjs';
import {exportNoticePort,exportGrantsPort} from '../../packages/runtime/export-ports.mjs';
import {flagsFor} from '../../packages/flags/read.mjs';
import {mailTransport} from './email.mjs';
import {createPushTransport} from '../../packages/messaging/web-push.mjs';
import {transferIdentityPort,createTransferNotices,attestorFromJwk,transferDueIndex,sweepTransferDue} from '../../packages/identity/transfer-out.mjs';
import {transferInIdentityPort} from '../../packages/identity/transfer-in.mjs';
import {createPortabilityFetch} from '../../packages/identity/successors.mjs';
import {createDohResolver} from '../../packages/federation/resource-discovery.mjs';

export const LIFECYCLE_SCHEDULER_NAME='lifecycle-sweep-v1';
const repositoryOf=env=>new ShardedIdentityRepository({shard:name=>env.IDENTITIES.get(env.IDENTITIES.idFromName(name)),layout:env.IDENTITY_LAYOUT,config:env});

/** Account-object lifecycle ports. Only built when LIFECYCLE_ENABLED, so a
 * disabled deployment constructs no transports for the executor. R2 bindings
 * support per-put storage classes; Node file buckets do not. */
export function workerLifecycleConfig(env){
 if(lifecycleMode(env)==='off')return {};
 const repository=repositoryOf(env),admin=env.ADMIN_AUTHORITY?remoteAdminStore((method,args)=>env.ADMIN_AUTHORITY.get(env.ADMIN_AUTHORITY.idFromName('admin-v1')).invoke(method,args)):null;
 return {LIFECYCLE_IDENTITY:lifecycleIdentityPort(repository),LIFECYCLE_ADMIN_HOLD:lifecycleAdminHoldPort({store:admin,repository}),LIFECYCLE_MAIL:mailTransport(env),LIFECYCLE_PUSH:createPushTransport(env),LIFECYCLE_COLD_STORAGE_SUPPORTED:true};
}
/** DX-3 account deletion ports (account-deletion-export.md §6). Built for every account object, independent of
 * LIFECYCLE_ENABLED; new requests still need ACCOUNT_DELETION_ENABLED. DX-1 exports and DX-4 billing closure are
 * composed per account (packages/runtime/account/deletion.mjs). The notices port (DX-5) is not wired yet, so a
 * request with a notice channel holds before commit. R1-M12 is undecided: operatorApps is null (no BindleBox
 * notification), which keeps the inactivity purge unchanged; the deletion flag stays off until it is decided. */
export function workerDeletionConfig(env){
 const repository=repositoryOf(env),admin=env.ADMIN_AUTHORITY?remoteAdminStore((method,args)=>env.ADMIN_AUTHORITY.get(env.ADMIN_AUTHORITY.idFromName('admin-v1')).invoke(method,args)):null;
 const scheduler=env.LIFECYCLE_SCHEDULER?()=>env.LIFECYCLE_SCHEDULER.get(env.LIFECYCLE_SCHEDULER.idFromName(LIFECYCLE_SCHEDULER_NAME)):null;
 const mcp=env.MCP_AUTH?mcpAuthorities(shard=>({invoke:(method,args)=>env.MCP_AUTH.get(env.MCP_AUTH.idFromName(`${MCP_LAYOUT}-${shard}`)).invoke(shard,method,args)})):null;
 // DX-5 notices over the existing accounts@ mail and Web Push transports. An unusable origin leaves the port unwired
 // (requests then hold before commit) rather than breaking the account object.
 let notices;try{notices=createDeletionNotices({origin:env.APP_ORIGIN,flags:{for:ctx=>flagsFor(env,ctx)},mail:mailTransport(env),push:createPushTransport(env)});}catch{notices=undefined;}
 // DX-1/DX-2 export ports: the owner audit/notice port (mail here; push is added inside the account object) and the
 // grants projection over the owner's federation shard and MCP shards. Keys and the external-storage mapping are
 // account-local (packages/runtime/account/exports.mjs).
 const exportPorts=createExportAdapterPorts({repository,notice:exportNoticePort({repository,mailer:mailTransport(env)}),contributorPorts:{grants:exportGrantsPort({
  devices:env.FEDERATION?owner=>env.FEDERATION.get(env.FEDERATION.idFromName(`${FEDERATION_LAYOUT}/${owner}`)).exportDeviceGrants(owner):null,
  federation:env.FEDERATION?owner=>env.FEDERATION.get(env.FEDERATION.idFromName(`${FEDERATION_LAYOUT}/${owner}`)).exportGrants(owner):null,
  mcp:mcp?owner=>mcp.grants(owner):null})}});
 return {exportPorts,ACCOUNT_DELETION_PORTS:{
  ...notices?{notices}:{},
  identity:lifecycleIdentityPort(repository),security:identitySecurityPort(repository),hold:deletionHoldPort({store:admin,repository}),adminAuthority:deletionAdminAuthorityPort({store:admin,repository}),
  erasure:{
   federation:env.FEDERATION?{eraseSubject:owner=>env.FEDERATION.get(env.FEDERATION.idFromName(`${FEDERATION_LAYOUT}/${owner}`)).eraseSubject(owner)}:null,
   mcp:mcp?{eraseSubject:owner=>mcp.eraseSubject(owner)}:null,
   emailBridge:env.EMAIL_BRIDGE?{erase:owner=>eraseOwner(env,owner)}:null,
   operatorApps:null,
  },
  ...scheduler?{due:{put:(owner,at)=>scheduler().duePut(owner,at),delete:(owner,at)=>scheduler().dueDelete(owner,at)}}:{},
 }};
}
/** PORT-2 identity transfer-out ports (identity-portability design §6, packages/identity/transfer-out.mjs). Built for
 * every account object; new transfers still need IDENTITY_TRANSFER_OUT_ENABLED. Notices use the existing accounts mail
 * (`sendTransferNotice`) and Web Push transports; acceptance is recorded, never delivery. Without
 * IDENTITY_ATTESTATION_KEYS (the PORT-4 chained set; the legacy IDENTITY_ATTESTATION_KEY {kid, jwk} still reads) commits hold.
 * PORT-4 transfer-in: the identity port and strictly-public egress with a DoH screen (as client-id-metadata.v1). The scheduler's transfer-due index is the backstop
 * for steps and for ending moved records after the purge. Keys and account effects are composed per account
 * (packages/runtime/account/transfer-out.mjs). */
export function workerTransferOutConfig(env){
 const repository=repositoryOf(env),scheduler=env.LIFECYCLE_SCHEDULER?()=>env.LIFECYCLE_SCHEDULER.get(env.LIFECYCLE_SCHEDULER.idFromName(LIFECYCLE_SCHEDULER_NAME)):null;
 let notices;try{notices=createTransferNotices({origin:env.APP_ORIGIN,mail:mailTransport(env),push:createPushTransport(env)});}catch{notices=undefined;}
 return {TRANSFER_OUT_PORTS:{identity:transferIdentityPort(repository),...notices?{notices}:{},attestor:attestorFromJwk(env.IDENTITY_ATTESTATION_KEYS??env.IDENTITY_ATTESTATION_KEY),issuer:env.APP_ORIGIN,
  ...scheduler?{due:{put:(owner,at,kind)=>scheduler().transferDuePut(owner,at,kind),delete:(owner,at,kind)=>scheduler().transferDueDelete(owner,at,kind)}}:{}},
  TRANSFER_IN_PORTS:{identity:transferInIdentityPort(repository),fetch:createPortabilityFetch({resolve:createDohResolver(),publicRouting:true})}};
}
/** The cron trigger and this object's own alarm drive one bounded sweep at a time. This object also holds the
 * deletion-due index, swept on every run independent of LIFECYCLE_ENABLED (DX-3 §2.2), and the PORT-2 transfer-due
 * index, swept after it. */
export class LifecycleScheduler extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.due=deletionDueIndex(ctx.storage);this.transferDue=transferDueIndex(ctx.storage);this.accounts={get:id=>env.ACCOUNTS.get(env.ACCOUNTS.idFromName(id))};this.transferIdentity=transferIdentityPort(repositoryOf(env));this.sweep=new LifecycleSweep({metadata:ctx.storage,repository:repositoryOf(env),accounts:this.accounts,config:{...env,ACCOUNT_DELETION_DUE:this.due}});}
 duePut(owner,at){return this.due.put(owner,at);}
 dueDelete(owner,at){return this.due.delete(owner,at);}
 transferDuePut(owner,at,kind){return this.transferDue.put(owner,at,kind);}
 transferDueDelete(owner,at,kind){return this.transferDue.delete(owner,at,kind);}
 async sweepTransfers(){try{return await sweepTransferDue({index:this.transferDue,identity:this.transferIdentity,accounts:this.accounts});}catch{return {done:0,failed:1};}}
 async run(input){const result=await this.sweep.run(input);await this.sweepTransfers();return result;}
 status(){return this.sweep.status();}
 async alarm(){const result=await this.sweep.run({trigger:'alarm'});await this.sweepTransfers();return result;}
}

