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
import {mailTransport} from './email.mjs';
import {createPushTransport} from '../../packages/messaging/web-push.mjs';

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
 return {ACCOUNT_DELETION_PORTS:{
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
/** The cron trigger and this object's own alarm drive one bounded sweep at a time. This object also holds the
 * deletion-due index, swept on every run independent of LIFECYCLE_ENABLED (DX-3 §2.2). */
export class LifecycleScheduler extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.due=deletionDueIndex(ctx.storage);this.sweep=new LifecycleSweep({metadata:ctx.storage,repository:repositoryOf(env),accounts:{get:id=>env.ACCOUNTS.get(env.ACCOUNTS.idFromName(id))},config:{...env,ACCOUNT_DELETION_DUE:this.due}});}
 duePut(owner,at){return this.due.put(owner,at);}
 dueDelete(owner,at){return this.due.delete(owner,at);}
 run(input){return this.sweep.run(input);}
 status(){return this.sweep.status();}
 alarm(){return this.sweep.run({trigger:'alarm'});}
}

