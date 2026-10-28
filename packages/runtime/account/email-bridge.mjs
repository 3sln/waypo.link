import {ownerFlags,featureConfig} from './flags.mjs';
// BRIDGE internal account RPCs. Entitlement and the bridge's grant are checked again at delivery, under the account gate.
// Extensions rev 3.2 (§4.2, §11.1, CR-X3-32): the bridge is the provider feature of its own 3sln.me extension. It delivers
// only while the owner has enabled it, it is declared and unsuspended, and the intake field's value is a resource the
// owner approved for it (the feature's projection); the brokered record must still be live.
import {bridgeConfig} from '../../email-bridge/engine.mjs';
import {INTAKE_CONTRACT,EMAIL_BRIDGE_CONTRACT,EMAIL_BRIDGE_METHODS} from '../../email-bridge/wire.mjs';
import {bridgeKey} from '../../email-bridge/keys.mjs';
import {ownerOperation} from '../../email-bridge/owner.mjs';
import {PROVIDER_EXT} from '../../core/extensions.mjs';
import {StorageError} from '../../storage/policy.mjs';
const down=()=>{throw new StorageError('recipient_unavailable','The recipient is unavailable.',503);};
export const methods={
 async emailBridgeEntitled(owner){
  if(!bridgeConfig(featureConfig(this.config,{subject:{kind:'account',owner}})).enabled||await this.metadata.get('owner')!==owner)return false;
  const account=await this.config.IDENTITY_ACCOUNT?.(owner);if(account?.status!=='active')return false;
  const e=await this.billing.entitlement(owner);return ['paid','plus','ultra'].includes(e.plan)&&e.provisional!==true&&e.validUntil>Date.now();
 },
 async integrationsIntakeSeat(owner){
  if(!await this.emailBridgeEntitled(owner)||!ownerFlags(this.config,owner).enabled('INTEGRATIONS_ENABLED')||!ownerFlags(this.config,owner).enabled('BROKERING_ENABLED'))return null;
  const found=await this.connectionsSystem(owner,{operation:'connections.feature-resources',input:{feature:PROVIDER_EXT.emailBridge}});
  if(found.sever||!found.live||found.selection!=='exclusive'||found.resources.length!==1)return null;
  const s=found.resources[0],{records}=await this.integrationsSystem(owner,{operation:'integrations.records'}),r=records.find(r=>r.id===s.resource&&r.connection===s.connection&&r.clientId===s.clientId&&r.available&&r.contracts.includes(INTAKE_CONTRACT));
  return r?{id:`${s.cnx}/${r.id}`,seat:s.seat,cnx:s.cnx,connection:s.connection,clientId:s.clientId,generation:s.generation,record:r.id,resource:r.resource,grant:s.grant}:null;
 },
 async integrationsIntakeDeliver(owner,{seat,body}={}){
  const live=await this.integrationsIntakeSeat(owner);if(!live||!seat||Object.keys(live).some(k=>live[k]!==seat[k]))down();
  return this.integrationsSystem(owner,{operation:'integrations.intake-deliver',input:{seat:live,body}});
 },
};
export const rpc={emailBridgeEntitled:{},integrationsIntakeSeat:{},integrationsIntakeDeliver:{}};

const denied=()=>{throw new StorageError('forbidden','Email bridge access denied.',403);};
/** The email-bridge resource method (account/storage.mjs RESOURCE_METHOD_HANDLERS, contract EMAIL_BRIDGE_CONTRACT). The
 * caller is the verified federation RPC context of an app holding an ordinary grant on `${subject}/email-bridge`; the
 * checks are those the links contract applied to the same two methods before contacts phase 4 removed it: live epoch,
 * active app connection and generation, an active owner identity, and, for `accepted`, the live intake seat. */
export async function emailBridgeResourceMethod(c,owner,context){
 if(!bridgeConfig(featureConfig(c.config,{subject:{kind:'account',owner},client:{clientId:context?.clientId}})).enabled)throw new StorageError('not_found','Not found.',404);
 if(typeof context?.method!=='string'||!EMAIL_BRIDGE_METHODS.includes(context.method))throw new StorageError('unsupported_method','Unsupported email bridge method.',400);
 const args=context.args;if(args===null||typeof args!=='object'||Array.isArray(args))throw new StorageError('invalid_args','Unsupported email bridge request.',400);
 if(context.authority!=='bindle'||context.resource!==`${c.config.APP_ORIGIN}/entities/${owner}/email-bridge`||context.resourceGeneration!==owner||context.contract!==EMAIL_BRIDGE_CONTRACT)denied();
 if(typeof context.clientId!=='string'||!context.connection||typeof context.connection.id!=='string'||!Number.isSafeInteger(context.connection.generation))denied();
 await c.warm(owner);
 if(!context.epoch||typeof c.config.FEDERATION_IDENTITY_CHECK!=='function'||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)throw new StorageError('unauthorized','Application authorization is no longer active.',401);
 await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);
 const account=typeof c.config.IDENTITY_ACCOUNT==='function'?await c.config.IDENTITY_ACCOUNT(owner):null;
 if(!account||account.status!=='active')denied();
 if(context.method==='consumerKey'){if(Object.keys(args).some(k=>!['consumer','keyId'].includes(k)))denied();const key=await bridgeKey(c.config);return key&&args.consumer===c.config.APP_ORIGIN&&args.keyId===key.keyId?{keyId:key.keyId,publicJwk:key.publicJwk}:null;}
 if(Object.keys(args).some(k=>k!=='jti')||typeof args.jti!=='string'||!args.jti||args.jti.length>128)denied();
 const seat=await c.integrationsIntakeSeat(owner);if(!seat||seat.clientId!==context.clientId||seat.connection!==context.connection.id||seat.generation!==context.connection.generation)denied();
 return ownerOperation(c.config,owner,'bridge.accepted',{jti:args.jti});
}
