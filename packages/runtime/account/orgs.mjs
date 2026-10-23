// AccountController slice ORG-1, organizations (docs/architecture/organizations-design.md §13.2; engine operations in
// packages/app/domains/orgs.mjs, rules in packages/orgs/organizations.mjs). `methods` are installed on
// AccountController.prototype (`this` is the controller); `rpc` lists what `invoke` accepts.
//
//   orgsDispatch(owner, {operation, actor, input})  owner-route operations; the actor is resolved here by the ORG-0
//                                                   seam (packages/orgs/authority.mjs) inside the gate. An organization
//                                                   entity is checked against this writer's record BEFORE warm, so an
//                                                   unknown UUID never binds a new account.
//   orgsInitialize(owner, input)                    system: the creation sequence's organization step
//   orgsConfirm(owner, input)                       system: the creation sequence's final step (creator's account)
//   orgsAlarm()                                     account alarm hook: steps a scheduled deletion
//   orgsActingAuthority(org, {actor, power, widen})  ORG-5: the organization-context power check, run in THIS writer
//                                                   (orgs.acting-authority); the federation shard calls it before it
//                                                   reads or writes the organization's preferences
//   orgsConnections(org, {operation, actor, input})  ORG-5: the organization's app connections, acting as the
//                                                   organization. The admin power is resolved here, in the same gate
//                                                   turn as the connections operation; only list, suspend, resume,
//                                                   disconnect and approve exist for organizations (no built-ins, slots)
// Ports from config: ORGANIZATION_PLANS ({check}) or the organization entitlement port (ORGANIZATIONS_PAID_ALLOWLIST as
// the operator override, then verified sandbox Polar state; packages/orgs/ownership.mjs), and ORGANIZATION_PURGE
// ((org) -> {handedOff}) for the deletion executor hand-off (absent: a due deletion holds).
//
// Organization billing and ownership transfer (ORG-D18, ORG-D21; packages/orgs/ownership.mjs, SANDBOX ONLY):
//   orgsBillingWebhook(org, verified)   a signature-verified Polar event for this organization (from billingWebhookVerified)
//   orgsBillingSync(org)                reconcile now (creation adapter, best effort)
//   orgsOwnershipIndexApply(person, i)  system, person placement: owner/member/offer discovery hints after a change
// The account alarm reconciles, applies the time rules and drains the ownership outbox (revoke, refund, recovery
// rotation, peer index). ORGANIZATION_BILLING_CLIENT may inject a Polar client object (tests; never a string setting).
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleBlocked} from '../lifecycle-runner.mjs';
import {accountActor} from '../../orgs/authority.mjs';
import {ORG_RECORD} from '../../orgs/organizations.mjs';
import {OwnershipService,organizationEntitlementPort} from '../../orgs/ownership.mjs';
import {OrganizationBilling} from '../../billing/organizations.mjs';
import {organizationsProvider,ORG_OPERATIONS,InitializeOrganization,ConfirmOrganization,OrganizationTick,MembershipSweep,MembershipOutboxDrain,ObserveMemberAuthority,MemberSnapshot,membershipEnginePort,OWNERSHIP_OPERATIONS,OrganizationBillingSync,OrganizationBillingWebhook,OwnershipTick,OwnershipDrain,OwnershipIndex} from '../../app/domains/orgs.mjs';
import {StorageError} from '../../storage/policy.mjs';

const engines=new WeakMap(),clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
export function orgsEngine(c){
 let entry=engines.get(c);
 if(!entry){
  const clock={now:()=>clockOf(c)()},injected=c.config.ORGANIZATION_BILLING_CLIENT,billing=new OrganizationBilling({config:c.config,client:injected&&typeof injected==='object'?injected:undefined,now:clock.now});
  const plans=typeof c.config.ORGANIZATION_PLANS?.check==='function'?c.config.ORGANIZATION_PLANS:organizationEntitlementPort({allowlist:c.config.ORGANIZATIONS_PAID_ALLOWLIST,billing});
  const service=new OwnershipService({metadata:c.metadata,clock,random:cryptoRandom,flags:{for:ctx=>flagsFor(c.config,ctx)},plans,issuer:c.config.APP_ORIGIN??null,invitationSigner:owner=>c.signingKey(owner),memberEvents:c.config.ORGANIZATION_MEMBER_EVENTS,
   billing,accounts:{get:sub=>typeof c.config.IDENTITY_ACCOUNT==='function'?c.config.IDENTITY_ACCOUNT(sub):null},
   effects:{
    // Invalidates the previous owner's recovery file at an ownership change: an ordinary signing rotation (not the
    // issuance rotation, which keeps the outgoing kid bound for P15 races) clears the recovery binding, so the old file
    // no longer restores (identity keys header; recoveryKeysMatch). The new file comes from the new owner's reissue.
    // Copies of past private keys in the old file cannot be recalled; the encryption key is not rotated (residual).
    rotateRecovery:async org=>{const current=(await c.identityKeyHistory(org,{purpose:'signing'})).find(k=>k.current);if(!current)return {rotated:false};await c.rotateIdentityKey(org,{purpose:'signing',expectedKid:current.kid});return {rotated:true};},
    index:async(person,input)=>{const stub=c.config.CONVERSATION_ACCOUNT?.(person);if(!stub)return false;const result=await stub.invoke({method:'orgsOwnershipIndexApply',args:[person,input]});return !result?.$fault&&result?.indexed===true;}
   },
   ...typeof c.config.ORGANIZATION_PURGE==='function'?{purge:org=>c.config.ORGANIZATION_PURGE(org)}:{}});
  entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,organizations:organizationsProvider(service)}})};engines.set(c,entry);
 }
 return entry;
}
export function orgsMembershipPort(c,owner){return membershipEnginePort({engine:orgsEngine(c).engine,owner,perform,read});}
const run=(c,operation)=>operation instanceof AppQuery?read(orgsEngine(c).engine,operation):perform(orgsEngine(c).engine,operation);
export const methods={
 async orgsDispatch(owner,{operation,actor,input}={}){
  const Operation=ORG_OPERATIONS.find(O=>O.operation===operation);if(!Operation)throw new StorageError('not_found','Not found.',404);
  const blocked=await lifecycleBlocked(this,'orgsDispatch',{lifecycle:Operation.lifecycle??'active'},owner);if(blocked)throw new StorageError(blocked.code,blocked.message,blocked.status);
  if(actor?.entity?.kind==='organization'&&actor?.principal)await run(this,new ObserveMemberAuthority({actor:{kind:'system',owner},input:{principal:{iss:actor.principal.iss??this.config.APP_ORIGIN??null,sub:actor.principal.sub},aep:actor.aep??0}}));
  const resolved=await accountActor({owner,requested:actor,Operation,issuer:this.config.APP_ORIGIN??null,organization:()=>this.metadata.get(ORG_RECORD)});
  await this.warm(owner);
  const result=await run(this,new Operation({actor:resolved,...input===undefined?{}:{input:structuredClone(input)}}));
  if(Operation.entities?.includes('organization')){const sweep=await run(this,new MembershipSweep({actor:{kind:'system',owner}}));if(Number.isSafeInteger(sweep?.wakeAt))await this.scheduleAlarm(sweep.wakeAt);if(OWNERSHIP_OPERATIONS.includes(Operation))await ownershipFollowUp(this,owner);}
  return result;
 },
 async orgsSigningProvenance(owner){await this.warm(owner);const key=(await this.identityKeyHistory(owner,{purpose:'signing'})).find(k=>k.current);if(!key)throw new StorageError('identity_keys_unavailable','Identity key unavailable.',503);return {kid:key.kid,publicKey:key.publicJwk,certificationKid:null,authentication:'same-host-session'};},
 async orgsMemberSnapshot(owner,input){await this.warm(owner);return run(this,new MemberSnapshot({actor:{kind:'system',owner},input:structuredClone(input)}));},
 async orgsInitialize(owner,input){await this.warm(owner);const view=await run(this,new InitializeOrganization({actor:{kind:'system',owner},input:structuredClone(input)}));return view;},
 async orgsConfirm(owner,input){await this.warm(owner);return run(this,new ConfirmOrganization({actor:{kind:'system',owner},input:structuredClone(input)}));},
 async orgsAlarm(){
  try{const owner=await this.metadata.get('owner');if(!owner||(await this.metadata.get(ORG_RECORD))?.kind!=='organization')return;
   await run(this,new MembershipOutboxDrain({actor:{kind:'system',owner}}));const sweep=await run(this,new MembershipSweep({actor:{kind:'system',owner}})),result=await run(this,new OrganizationTick({actor:{kind:'system',owner}}));const wake=[sweep?.wakeAt,result?.wakeAt].filter(Number.isSafeInteger);if(wake.length)await this.scheduleAlarm(Math.min(...wake));}
  catch{/* The next alarm retries; a failed step never advances the deletion. */}
  try{const owner=await this.metadata.get('owner');if(owner&&(await this.metadata.get(ORG_RECORD))?.kind==='organization')await ownershipFollowUp(this,owner,{sync:true});}
  catch{/* Billing reconciliation and ownership effects retry on the next alarm. */}
 },
 async orgsBillingWebhook(owner,verified){
  if((await this.metadata.get(ORG_RECORD))?.kind!=='organization')return {accepted:true,ignored:true};await this.warm(owner);
  const result=await run(this,new OrganizationBillingWebhook({actor:{kind:'system',owner},input:structuredClone(verified)}));
  try{await ownershipFollowUp(this,owner);}catch{/* effects retry on the alarm */}
  return {accepted:true,...result};
 },
 async orgsBillingSync(owner){if((await this.metadata.get(ORG_RECORD))?.kind!=='organization')return {synced:false};await this.warm(owner);await ownershipFollowUp(this,owner,{sync:true});return {synced:true};},
 async orgsOwnershipIndexApply(owner,input){await this.warm(owner);return run(this,new OwnershipIndex({actor:{kind:'system',owner},input:structuredClone(input)}));},
};
// ORG-5 organization context for the existing connections operations. Reducing operations (list, suspend, disconnect)
// stay available during a ramp-down or pending deletion; resume and approve can add authority (`widen`).
export const ORG_CONNECTION_OPERATIONS=Object.freeze({list:'connections.list',suspend:'connections.suspend',resume:'connections.resume',disconnect:'connections.disconnect',approve:'connections.approve'});
const WIDENING=new Set(['resume','approve']);
Object.assign(methods,{
 async orgsActingAuthority(owner,{actor,power='admin',widen=false}={}){return this.orgsDispatch(owner,{operation:'orgs.acting-authority',actor,input:{power,widen:widen===true}});},
 async orgsConnections(owner,{operation,actor,input}={}){
  const target=typeof operation==='string'&&Object.hasOwn(ORG_CONNECTION_OPERATIONS,operation)?ORG_CONNECTION_OPERATIONS[operation]:null;if(!target)throw new StorageError('not_found','Not found.',404);
  if(input!==undefined&&(input===null||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['connection','expectedGeneration','stagedRevision'].includes(k))))throw new StorageError('invalid_request','Unsupported connections request.',400);
  const authority=await this.orgsActingAuthority(owner,{actor,power:'admin',widen:WIDENING.has(operation)});
  const result=await this.connectionsOwner(owner,{operation:target,...input===undefined?{}:{input}},{authTime:authority.authTime??undefined});
  return operation==='list'?{connections:result.connections??[]}:result;
 },
});
/** Reconcile (when asked and organization billing is configured), apply the time rules, drain due ownership effects,
 * and schedule the next alarm. A provider failure falls back to the time rules alone. */
async function ownershipFollowUp(c,owner,{sync=false}={}){
 const actor={kind:'system',owner};let step;
 if(sync&&orgsEngine(c).service.billingConfigured()){try{step=await run(c,new OrganizationBillingSync({actor}));}catch{step=null;}}
 step??=await run(c,new OwnershipTick({actor}));
 const drained=await run(c,new OwnershipDrain({actor})),again=drained?.done?await run(c,new OwnershipTick({actor})):null;
 const wake=[step?.wakeAt,drained?.wakeAt,again?.wakeAt].filter(Number.isSafeInteger);if(wake.length)await c.scheduleAlarm(Math.min(...wake));
 return step;
}
export const rpc={orgsBillingWebhook:{lifecycle:'purging'},orgsBillingSync:{lifecycle:'suspended'},orgsOwnershipIndexApply:{lifecycle:'purging'},orgsActingAuthority:{lifecycle:'suspended'},orgsConnections:{},orgsSigningProvenance:{},orgsMemberSnapshot:{},orgsDispatch:{lifecycle:'suspended'},orgsInitialize:{lifecycle:'suspended'},orgsConfirm:{}};
