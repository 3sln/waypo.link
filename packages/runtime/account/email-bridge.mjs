import {ownerFlags,featureConfig} from './flags.mjs';
// BRIDGE internal account RPCs. Entitlement and the bridge's grant are checked again at delivery, under the account gate.
// Extensions rev 3.2 (§4.2, §11.1, CR-X3-32): the bridge is the provider feature of its own 3sln.me extension. It delivers
// only while the owner has enabled it, it is declared and unsuspended, and the intake field's value is a resource the
// owner approved for it (the feature's projection); the brokered record must still be live.
import {bridgeConfig} from '../../email-bridge/engine.mjs';
import {INTAKE_CONTRACT} from '../../email-bridge/wire.mjs';
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
