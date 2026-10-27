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
// rotation, peer index). A transfer or claim takes effect only in a step that reconciled within OWNERSHIP.FRESH_MS; the
// tick fallback below (Polar unreachable) never changes the owner, it reschedules. A subscription Polar cannot confirm
// is held and reported through the lifecycle log as an operator alert (kind 'organization-billing'). ORGANIZATION_BILLING_CLIENT may inject a Polar client object (tests; never a string setting).
import {createAppEngine,perform,read,AppQuery} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleBlocked,lifecycleLog} from '../lifecycle-runner.mjs';
import {accountActor} from '../../orgs/authority.mjs';
import {ORG_RECORD} from '../../orgs/organizations.mjs';
import {loadOrganization} from '../../orgs/roster.mjs';
import {organizationEntitlementPort} from '../../orgs/ownership.mjs';
import {BreakGlassService} from '../../orgs/break-glass.mjs';
import {OrganizationBilling} from '../../billing/organizations.mjs';
import {organizationsProvider,ORG_OPERATIONS,InitializeOrganization,ConfirmOrganization,OrganizationTick,MembershipSweep,MembershipOutboxDrain,ObserveMemberAuthority,MemberSnapshot,membershipEnginePort,OWNERSHIP_OPERATIONS,OrganizationBillingSync,OrganizationBillingWebhook,OwnershipTick,OwnershipDrain,OwnershipIndex,ResolveLapseClaim,BREAK_GLASS_OPERATIONS,BreakGlassLiveness,BreakGlassSecurityChange,BreakGlassAbortToken,ResolveBreakGlass,BreakGlassProposalCancel,BreakGlassFileRecovery,BreakGlassCase,BreakGlassLedger,BreakGlassHint,BreakGlassHints,BreakGlassSignal,BreakGlassSignals} from '../../app/domains/orgs.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {key} from '../../core/records.mjs';
import {OWNER_NOTICE_KIND_LIST} from '../../identity/owner-channels.mjs';
// The adapters build ORGANIZATION_OWNER_CHANNELS with organizationOwnerChannels (packages/identity/owner-channels.mjs).

const engines=new WeakMap(),clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
/** The organization writer's clock (LIFECYCLE_CLOCK when injected), shared with the ORG-4 membership port. */
export const orgsClock=c=>clockOf(c);
export function orgsEngine(c){
 let entry=engines.get(c);
 if(!entry){
  const clock={now:()=>clockOf(c)()},injected=c.config.ORGANIZATION_BILLING_CLIENT,billing=new OrganizationBilling({config:c.config,client:injected&&typeof injected==='object'?injected:undefined,now:clock.now});
  const plans=typeof c.config.ORGANIZATION_PLANS?.check==='function'?c.config.ORGANIZATION_PLANS:organizationEntitlementPort({allowlist:c.config.ORGANIZATIONS_PAID_ALLOWLIST,billing});
  // ORG-12a/12c break-glass (packages/orgs/break-glass.mjs). The owner-channels port is the identity stream's adapter
  // (ORG-12b: ORGANIZATION_OWNER_CHANNELS = {snapshot, domains, notify}); without it a claim cannot start (503), while
  // aborts, withdrawals and refunds keep working. The per-person ledger lives in each person's own account writer.
  const ownerChannels=['snapshot','domains','notify'].every(k=>typeof c.config.ORGANIZATION_OWNER_CHANNELS?.[k]==='function')?c.config.ORGANIZATION_OWNER_CHANNELS:null;
  const ledgerCall=async(person,input)=>{const stub=c.config.CONVERSATION_ACCOUNT?.(person);if(!stub)return {ok:false,reason:'break_glass_unavailable'};const result=await stub.invoke({method:'orgsBreakGlassLedgerApply',args:[person,input]});return result?.$fault?{ok:false,reason:'break_glass_unavailable'}:result;};
  const claimLedger={reserve:(person,input)=>ledgerCall(person,{op:'reserve',org:input.org,claim:input.claim,role:input.role,at:input.at}),update:(person,input)=>ledgerCall(person,{op:'update',org:input.org,claim:input.claim,event:input.event,at:input.at})};
  // ORG-12b: person-side hint rows (the owner's sign-in liveness hook, the interstitial, co-signature items). Only wired
  // with the owner-channels port, so an unconfigured host queues none.
  const claimHints=ownerChannels?{apply:async(person,input)=>{const stub=c.config.CONVERSATION_ACCOUNT?.(person);if(!stub)return {ok:false};const result=await stub.invoke({method:'orgsBreakGlassHintApply',args:[person,input]});return result?.$fault?{ok:false}:result;}}:null;
  // Review M3: operator decisions verify an assertion from the admin service; without the port they fail closed. ORG-12d:
  // the adapters compose the production verifier over the admin store (packages/runtime/admin-org-cases.mjs).
  const operators=typeof c.config.ORGANIZATION_OPERATOR_ASSERTIONS?.verify==='function'?c.config.ORGANIZATION_OPERATOR_ASSERTIONS:null;
  // ORG-12d: the admin service's support case queue (packages/identity/operator-assertions.mjs supportCaseIndex).
  const supportCases=typeof c.config.ORGANIZATION_SUPPORT_CASES?.apply==='function'?c.config.ORGANIZATION_SUPPORT_CASES:null;
  const service=new BreakGlassService({ownerChannels,claimLedger,claimHints,operators,supportCases,metadata:c.metadata,clock,random:cryptoRandom,flags:{for:ctx=>flagsFor(c.config,ctx)},plans,issuer:c.config.APP_ORIGIN??null,invitationSigner:owner=>c.signingKey(owner),memberEvents:c.config.ORGANIZATION_MEMBER_EVENTS,
   billing,alert:entry=>lifecycleLog(c.config,entry),accounts:{get:sub=>typeof c.config.IDENTITY_ACCOUNT==='function'?c.config.IDENTITY_ACCOUNT(sub):null},
   effects:{
    // Invalidates the previous owner's recovery file at an ownership change: an ordinary signing rotation (not the
    // issuance rotation, which keeps the outgoing kid bound for P15 races) clears the recovery binding, so the old file
    // no longer restores (identity keys header; recoveryKeysMatch). The new file comes from the new owner's reissue.
    // Copies of past private keys in the old file cannot be recalled; the encryption key is not rotated (residual).
    rotateRecovery:async org=>{const current=(await c.identityKeyHistory(org,{purpose:'signing'})).find(k=>k.current);if(!current)return {rotated:false};await c.rotateIdentityKey(org,{purpose:'signing',expectedKid:current.kid});return {rotated:true};},
    index:async(person,input)=>{const stub=c.config.CONVERSATION_ACCOUNT?.(person);if(!stub)return false;const result=await stub.invoke({method:'orgsOwnershipIndexApply',args:[person,input]});return !result?.$fault&&result?.indexed===true;}
   },
   // ORG-10f (design §8b.6 "deletion takes effect", production gate 5): the hand-off waits for the relations pre-purge
   // step (leave every instance, relation-edge-ended for each half) to report relations.purge-ready, so the identity and
   // its certification keys stay published until counterparts have been told or 72 h have passed.
   ...typeof c.config.ORGANIZATION_PURGE==='function'?{purge:async org=>{if(typeof c.relationsPurgeGate==='function'&&!await c.relationsPurgeGate(org))return {handedOff:false};return c.config.ORGANIZATION_PURGE(org);}}:{}});
  entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,organizations:organizationsProvider(service)}})};engines.set(c,entry);
  // ORG-10f: the relations service registers its organization commit hook (review M1) on this same service.
  try{c.relationsEnsure?.();}catch{/* relations stay unavailable; redemption refuses on its own */}
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
  const resolved=await accountActor({owner,requested:actor,Operation,issuer:this.config.APP_ORIGIN??null,organization:principal=>loadOrganization(this.metadata,[principal])});
  await this.warm(owner);
  const result=await run(this,new Operation({actor:resolved,...input===undefined?{}:{input:structuredClone(input)}}));
  if(Operation.entities?.includes('organization')){const sweep=await run(this,new MembershipSweep({actor:{kind:'system',owner}}));if(Number.isSafeInteger(sweep?.wakeAt))await this.scheduleAlarm(sweep.wakeAt);if(OWNERSHIP_OPERATIONS.includes(Operation)||BREAK_GLASS_OPERATIONS.includes(Operation))await ownershipFollowUp(this,owner);}
  return result;
 },
 async orgsSigningProvenance(owner){await this.warm(owner);const key=(await this.identityKeyHistory(owner,{purpose:'signing'})).find(k=>k.current);if(!key)throw new StorageError('identity_keys_unavailable','Identity key unavailable.',503);return {kid:key.kid,publicKey:key.publicJwk,certificationKid:null,authentication:'same-host-session'};},
 async orgsMemberSnapshot(owner,input){await this.warm(owner);return run(this,new MemberSnapshot({actor:{kind:'system',owner},input:structuredClone(input)}));},
 async orgsInitialize(owner,input){await this.warm(owner);const view=await run(this,new InitializeOrganization({actor:{kind:'system',owner},input:structuredClone(input)}));return view;},
 async orgsConfirm(owner,input){await this.warm(owner);return run(this,new ConfirmOrganization({actor:{kind:'system',owner},input:structuredClone(input)}));},
 async orgsAlarm(){
  // ORG-12b review M1: a person account retries undelivered owner-liveness signals.
  try{const owner=await this.metadata.get('owner');if(owner&&(await this.metadata.get(ORG_RECORD))?.kind!=='organization'){await deliverOwnerSignals(this,owner);return;}}catch{/* retried on the next alarm */}
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
 /** Operator tooling only (internal RPC, never an owner route): resolve an escalated lapse claim (review follow-up 6). */
 async orgsClaimResolve(owner,input){if((await this.metadata.get(ORG_RECORD))?.kind!=='organization')throw new StorageError('not_found','Not found.',404);await this.warm(owner);const result=await run(this,new ResolveLapseClaim({actor:{kind:'system',owner},input:structuredClone(input??{})}));try{await ownershipFollowUp(this,owner,{sync:true});}catch{/* effects retry on the alarm */}return result;},
 async orgsOwnershipIndexApply(owner,input){await this.warm(owner);return run(this,new OwnershipIndex({actor:{kind:'system',owner},input:structuredClone(input)}));},
 /** Internal RPC only (never an owner route): break-glass signals into the organization's writer. `liveness` and
  * `security-change` come from the identity sign-in hook (ORG-12b), `abort-token` from the public link route after it
  * parsed a token, `resolve` and `case` from the admin service after it authenticated an operator (ORG-12d), and
  * `file-recovery` from ORG-12f. */
 async orgsBreakGlassSignal(owner,{operation,input}={}){
  const Operation={liveness:BreakGlassLiveness,'security-change':BreakGlassSecurityChange,'abort-token':BreakGlassAbortToken,resolve:ResolveBreakGlass,'proposal-cancel':BreakGlassProposalCancel,'file-recovery':BreakGlassFileRecovery,case:BreakGlassCase}[operation];
  if(!Operation||(await this.metadata.get(ORG_RECORD))?.kind!=='organization')throw new StorageError('not_found','Not found.',404);await this.warm(owner);
  const result=await run(this,new Operation({actor:{kind:'system',owner},...input===undefined?{}:{input:structuredClone(input)}}));
  if(operation!=='case'){try{await ownershipFollowUp(this,owner);}catch{/* effects retry on the alarm */}}
  return result;
 },
 /** System, person placement: this person's break-glass claim ledger (per-person limits, §12d.8). */
 async orgsBreakGlassLedgerApply(owner,input){await this.warm(owner);return run(this,new BreakGlassLedger({actor:{kind:'system',owner},input:structuredClone(input)}));},
 /** ORG-12b, system, person placement: put or drop one break-glass hint row (from an organization's ownership outbox). */
 async orgsBreakGlassHintApply(owner,input){await this.warm(owner);return run(this,new BreakGlassHint({actor:{kind:'system',owner},input:structuredClone(input)}));},
 /** ORG-12b, system, person placement: this person's live hints (read only, no warm, no write). */
 async orgsBreakGlassHints(owner){return run(this,new BreakGlassHints({actor:{kind:'system',owner}}));},
 /**
  * ORG-12b, the identity sign-in hook's target (fire-and-forget from IdentityService): an interactive sign-in or step-up
  * by this person. For each organization where a hint says they are the owner of record of an open claim, the
  * organization receives `liveness` (T9) and decides for itself; nothing is returned to the identity service. With no
  * hint this is one read of this account's hint prefix and nothing is written anywhere.
  */
 async orgsBreakGlassOwnerSignal(owner,{kind,at}={}){
  if(!['sign-in','step-up'].includes(kind)||!Number.isSafeInteger(at))throw new StorageError('invalid_request','Unsupported signal.',400);
  const {hints}=await run(this,new BreakGlassHints({actor:{kind:'system',owner}})),orgs=[...new Set(hints.filter(h=>h.role==='owner').map(h=>h.org))].slice(0,16);
  if(!orgs.length)return {signalled:0};
  // Review M1: durable. The rows are written first and removed only once each organization accepted the signal; the alarm
  // retries the rest.
  await run(this,new BreakGlassSignal({actor:{kind:'system',owner},input:{op:'queue',orgs,kind,at}}));
  return deliverOwnerSignals(this,owner);
 },
 /**
  * ORG-12b, system, person placement: the owner's push subscriptions for the owner-channels port. `list` gives ids and
  * enrolment times only; `send` pushes one fixed-shape notice to one subscription (the service worker builds the text)
  * through ORGANIZATION_OWNER_PUSH, the push transport the adapter injects (no Node-only module in shared runtime code).
  */
 async orgsBreakGlassPush(owner,{op,subscription,notice}={}){
  const rows=[...(await this.metadata.list({prefix:key('push-subscription',owner)})).values()].filter(r=>r?.owner===owner&&typeof r.endpoint==='string'&&typeof r.id==='string').slice(0,10);
  if(op==='list')return rows.map(r=>({id:r.id,createdAt:Number.isSafeInteger(r.createdAt)?r.createdAt:0}));
  if(op!=='send'||typeof subscription!=='string')throw new StorageError('invalid_request','Unsupported push request.',400);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,path=String(notice?.path??'');
  if(!OWNER_NOTICE_KIND_LIST.includes(notice?.event)||!uuid.test(notice?.org??'')||!(new RegExp('^/org-claim/abort#org='+notice.org+'&token=bg1\\.[0-9a-f-]{36}\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}(?:&handle=[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$').test(path)||path==='/console?view=organizations&org='+notice.org))throw new StorageError('invalid_request','Unsupported push notice.',400);
  const row=rows.find(r=>r.id===subscription),push=this.config.ORGANIZATION_OWNER_PUSH;
  if(!row||typeof push?.send!=='function')return {accepted:false};
  try{await push.send({endpoint:row.endpoint,keys:row.keys},{type:'bindle-org-claim-notice',owner,event:notice.event,org:notice.org,path});return {accepted:true};}catch{return {accepted:false};}
 }
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
/** ORG-12b review M1: delivers this person's due owner-liveness signals to each organization, records each outcome, and
 * schedules the next retry. With no row it reads one prefix and writes nothing. */
async function deliverOwnerSignals(c,owner){
 const actor={kind:'system',owner},{due,wakeAt}=await run(c,new BreakGlassSignals({actor}));let signalled=0;
 for(const row of due){let ok=false;const stub=c.config.CONVERSATION_ACCOUNT?.(row.org);
  if(stub)try{const result=await stub.invoke({method:'orgsBreakGlassSignal',args:[row.org,{operation:'liveness',input:{principal:{iss:c.config.APP_ORIGIN??null,sub:owner},kind:row.kind,at:row.at}}]});ok=!result?.$fault||result.$fault.code==='not_found';}catch{ok=false;}
  if(ok)signalled++;await run(c,new BreakGlassSignal({actor,input:{op:'result',org:row.org,at:row.at,ok}}));}
 const after=await run(c,new BreakGlassSignals({actor})),next=Math.min(after.wakeAt,...after.due.map(()=>Date.now()+60000));
 if(Number.isFinite(next)&&typeof c.scheduleAlarm==='function')try{await c.scheduleAlarm(next);}catch{}
 return {signalled};
}
/** Reconcile (when asked and organization billing is configured), apply the time rules, drain due ownership effects,
 * and schedule the next alarm. A provider failure falls back to the time rules alone. */
async function ownershipFollowUp(c,owner,{sync=false}={}){
 const actor={kind:'system',owner};let step;
 // A refused reconcile falls back to the time rules, which never change the owner (H2). A capacity refusal needs an
 // operator, so it is reported (wargame F-05); provider outages are retried silently.
 if(sync&&orgsEngine(c).service.billingConfigured()){try{step=await run(c,new OrganizationBillingSync({actor}));}catch(error){step=null;if(error?.code==='billing_subscription_capacity'){try{lifecycleLog(c.config,{kind:'organization-billing',action:'operator-alert',reason:'subscription-capacity',org:owner});}catch{}}}}
 step??=await run(c,new OwnershipTick({actor}));
 const drained=await run(c,new OwnershipDrain({actor})),again=drained?.done?await run(c,new OwnershipTick({actor})):null;
 const wake=[step?.wakeAt,drained?.wakeAt,again?.wakeAt].filter(Number.isSafeInteger);if(wake.length)await c.scheduleAlarm(Math.min(...wake));
 return step;
}
export const rpc={orgsBreakGlassHintApply:{lifecycle:'purging'},orgsBreakGlassHints:{lifecycle:'purging',gate:'none'},orgsBreakGlassOwnerSignal:{lifecycle:'suspended',gate:'none'},orgsBreakGlassPush:{lifecycle:'suspended',gate:'none'},orgsBreakGlassSignal:{lifecycle:'suspended'},orgsBreakGlassLedgerApply:{lifecycle:'purging'},orgsClaimResolve:{lifecycle:'suspended'},orgsBillingWebhook:{lifecycle:'purging'},orgsBillingSync:{lifecycle:'suspended'},orgsOwnershipIndexApply:{lifecycle:'purging'},orgsActingAuthority:{lifecycle:'suspended'},orgsConnections:{},orgsSigningProvenance:{},orgsMemberSnapshot:{},orgsDispatch:{lifecycle:'suspended'},orgsInitialize:{lifecycle:'suspended'},orgsConfirm:{}};
