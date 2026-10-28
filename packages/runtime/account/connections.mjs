import {ownerFlags,existingFeature,flagsFor,siteGlobal} from './flags.mjs';
// AccountController slice EXT-X4, connections (docs/architecture/extensibility-design.md §10 X4; docs/spec/integrations.md
// §3, §7) with extensions revision 3.2 field values and provider-feature grants (extensions §3–§6). `methods` are installed on AccountController.prototype (`this` is the
// controller); `rpc` lists what `invoke` accepts (packages/runtime/account/index.mjs).
//
// Everything new answers `not_found` unless INTEGRATIONS_ENABLED is on. Entry points:
//   connectionsOwner(owner, {operation, id, input}, {authTime})  owner operations (CONNECTION_OWNER_OPERATIONS); the
//       trusted route adapter passes the session's authentication time, never the request body.
//   connectionsSystem(owner, {operation, input})  internal (no `rpc`): federation consent, X3 revalidation, X6/X7, C1b.
//   linkSlotOccupant / delegationSlotOccupant({owner, fragment})  the value ports packages/runtime/account/links.mjs
//       (LINK_SLOT_OCCUPANT) and identity.mjs (DELEGATION_SLOT_OCCUPANT) fall back to when the flag is on and no port is
//       configured explicitly (legacy port names kept). Extensions rev 3.2: the resource comes from the projection of the
//       provider feature that consumes the field (messaging-address for messaging-ingress), so nothing is returned
//       unless the owner enabled that feature, it is declared and unsuspended, and approved this resource. Exclusive
//       fields only; anything else is null (fail closed).
//   connectionsSeverAccount(owner, {reason})  internal hook for suspension, recovery and deletion (review KD-4).
//   connectionsDrain(owner)  internal: applies durable cascade rows (key-delegation revocation and reconciliation).
//   connectionsFeatureSweep(owner)  internal, the account alarm (review M1): re-evaluates provider-feature declarations
//       every FEATURE_SWEEP_MS while a feature grant is active or suspended, so suspension, the 30-day revocation and
//       the owner's notice happen with nobody reading. Enabling a feature arms the alarm.
//
// KD-4 wiring: every disconnect, suspend, manifest invalidation, vacate or replacement of a messaging-ingress occupant
// writes a cascade row in its own commit; the row is drained right after (and retried by every later connections call).
// Account suspension is severed three ways: this hook (for the lifecycle and admin paths that can call it), the
// identity-directory status seen by the occupancy port, and the lifecycle capability epoch recorded in each connection,
// which detects a suspension that ended before anyone looked. Until a cascade drains, the ports already answer null,
// so the delegation status endpoint persists the revocation on first observation (KD-1).
import {createAppEngine,perform,read,operations,AppQuery} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {AppConnections,recognizedFields} from '../../apps/connections.mjs';
import {connectionsProvider,CONNECTION_OPERATIONS,CONNECTION_OWNER_OPERATIONS,FeatureResources,SeverAccountConnections,ConnectionCascades,ConnectionCascadeDone} from '../../app/domains/connections.mjs';
import {FEATURE_DEFINITIONS,FEATURE_SWEEP_MS,providerFeatureDeclarations,blockedExtensions} from '../../app/domains/provider-features.mjs';
import {surfaceConfig} from './flags.mjs';
import {brokeringMounts} from '../integration-ports.mjs';
import {messagingAddressMounted} from '../../app/domains/provider-features.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {GOOGLE_DRIVE_INTEGRATION} from '../../storage/google-drive-integration.mjs'; // EXT-X10 registry entry

export const CONNECTION_ENGINE_OPERATIONS=operations(...CONNECTION_OPERATIONS);
// Provider-authored built-in integrations by id -> {name, manifest}; append-only. Extensions rev 3.2 (CR-X3-25): the
// classifier is a built-in resource, no longer a built-in integration connection.
export const BUILT_IN_INTEGRATIONS=Object.freeze({
 'google-drive':GOOGLE_DRIVE_INTEGRATION, // EXT-X10: upstream connector remains unchanged
});
/** The adapter mount evidence behind the provider-feature rows, exactly as the authority manifest receives it: the
 * adapters pass `messagingAddress: messagingAddressMounted(config)` and federation.mjs adds brokeringMounts(config). */
export const providerFeatureMounts=config=>({...brokeringMounts(config),messagingAddress:messagingAddressMounted(config)});
const engines=new WeakMap();
function connectionsEngine(c){
 let engine=engines.get(c);
 if(!engine){
  const connections=new AppConnections({subjectDeleted:async(tx,r,now)=>{for(const [path,pending]of await tx.list({prefix:'app-removal/record/'}))if(pending.entity===r.owner&&pending.client_id===r.clientId&&['pending','in-progress'].includes(pending.state)){await tx.put(path,{...pending,state:'forced',outcome:'forced',committed_at:now,access_ends_by:now+360000});await tx.delete('app-removal/open/'+encodeURIComponent(pending.client_id));}if(!siteGlobal(c.config,'SUBJECT_DELETED_EVENTS_ENABLED')||!r.integration?.snapshot?.manifest?.events_endpoint)return false;const {enqueueIntegrationEvent}=await import('../integration-events.mjs');await enqueueIntegrationEvent(tx,{type:'subject-deleted',connection:r.id,generation:r.generation,notBefore:now+360000},{now});return true;},metadata:c.metadata,origin:c.config.APP_ORIGIN,builtins:c.config.BUILT_IN_INTEGRATIONS??BUILT_IN_INTEGRATIONS,fields:c.config.CONNECTION_FIELDS??recognizedFields(),
   // The provider's own feature declarations, evaluated live by the very manifest rows and mounts the authority manifest
   // uses (or a test/operator port), so losing a declaration suspends the feature's grants on the next read (review M2).
   declarations:async()=>typeof c.config.PROVIDER_FEATURE_DECLARATIONS==='function'?c.config.PROVIDER_FEATURE_DECLARATIONS():{manifest:providerFeatureDeclarations(surfaceConfig(c.config),providerFeatureMounts(c.config)),blocked:blockedExtensions(c.config)}});
  Object.defineProperty(connections,'fieldPins',{get:()=>c.config.CONNECTION_FIELDS??recognizedFields()});
  engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,connections:connectionsProvider({connections,enabled:true,config:c.config,flags:{for:ctx=>ownerFlags(c.config,ctx?.subject?.owner??ctx?.owner,ctx?.client?.clientId??ctx?.clientId)},account:typeof c.config.IDENTITY_ACCOUNT==='function'?owner=>c.config.IDENTITY_ACCOUNT(owner):undefined})}});
  engines.set(c,engine);
 }
 return engine;
}
const run=async(c,Operation,params)=>{if(['connections.connect','connections.connect-built-in','connections.resume','connections.approve','connections.assign','connections.configure-seat'].includes(Operation.operation)){const row=typeof params.input?.connection==='string'?await c.metadata.get('resource/'+params.input.connection):null,clientId=params.input?.client?.id??(row?.owner===params.actor?.owner?row.clientId:undefined);if(!ownerFlags(c.config,params.actor?.owner,clientId).enabled('INTEGRATIONS_ENABLED'))throw new StorageError('not_found','Not found.',404);}const operation=new Operation(params);return operation instanceof AppQuery?read(connectionsEngine(c),operation):perform(connectionsEngine(c),operation);};
const shape=value=>{if(value!==undefined&&(value===null||typeof value!=='object'||Array.isArray(value)))throw new StorageError('invalid_request','Unsupported connections request.');return value===undefined?undefined:structuredClone(value);};
const UUID=/^[a-f0-9-]{36}$/;
async function bound(c,owner){return typeof owner==='string'&&UUID.test(owner)&&await c.metadata.get('owner')===owner;}

// The one port core. `null` unless the provider feature consuming the field is live and exactly one approved resource
// is available; a severed account answers null after the severance commits; a failing identity directory rejects
// (delegation then answers 503, links fail closed). Re-entrancy guard (X4-R1): a port read made by a drain (reconcile ->
// value) never severs or drains again.
const draining=new WeakMap();const busy=(c,owner)=>draining.get(c)?.has(owner)===true;
async function exclusiveOccupant(c,{owner,fragment}={}){
 if(!await bound(c,owner)||typeof fragment!=='string')return null;
 const feature=Object.entries(FEATURE_DEFINITIONS).find(([,def])=>def.fragment===fragment)?.[0];if(!feature)return null;
 let found;try{found=await run(c,FeatureResources,{actor:{kind:'system',owner},input:{feature}});}catch(error){if(['unsupported_field','not_found'].includes(error?.code))return null;throw error;}
 if(found.sever){if(!busy(c,owner))await c.connectionsSeverAccount(owner,{reason:found.reason});return null;}
 return found.live&&found.selection==='exclusive'&&found.resources.length===1?found.resources[0]:null;
}

export const methods={
  async connectionClientAuth(owner,clientId){if(!await bound(this,owner))return null;const binding=await this.apps.binding(owner,clientId);return binding?.id?this.brokeredIntegrationAuth(owner,{connection:binding.id}):null;},
  async connectionsSetupComplete(owner,input){return this.connectionsSystem(owner,{operation:'connections.configured',input});},
  async connectionsOwner(owner,{operation,id,input}={},{authTime}={}){
   const Operation=typeof operation==='string'&&CONNECTION_OWNER_OPERATIONS.includes(operation)?CONNECTION_ENGINE_OPERATIONS[operation]:null;
   if(!existingFeature(this.config,'INTEGRATIONS_ENABLED',owner)||!Operation)throw new StorageError('not_found','Not found.',404);
   await this.warm(owner);await this.connectionsDrain(owner);
   const result=await run(this,Operation,{actor:{kind:'owner',owner,...Number.isSafeInteger(authTime)?{authTime}:{}},...id===undefined?{}:{id},...input===undefined?{}:{input:shape(input)}});
   await this.connectionsDrain(owner);if(!(Operation.prototype instanceof AppQuery))await this.integrationEventsKick(owner);
   if(operation==='connections.enable-feature'&&typeof this.scheduleAlarm==='function')try{await this.scheduleAlarm(Date.now()+FEATURE_SWEEP_MS);}catch{/* the weekly alarm sweeps */}
   return result;
  },
  // Review M1: the scheduled feature sweep. Re-arms itself while anything is watched; a failure re-arms within an hour.
  async connectionsFeatureSweep(owner){
   if(!flagsFor(this.config).background('INTEGRATIONS_ENABLED')||!await bound(this,owner)||(await this.metadata.list({prefix:'connections/feature/',limit:1})).size===0)return {changes:[],next:null};
   let result;try{result=await this.connectionsSystem(owner,{operation:'connections.feature-sync'});}catch(error){if(typeof this.scheduleAlarm==='function')await this.scheduleAlarm(Date.now()+3600000);throw error;}
   if(Number.isSafeInteger(result?.next)&&typeof this.scheduleAlarm==='function')await this.scheduleAlarm(result.next);
   return result;
  },
  async connectionsSystem(owner,{operation,input}={}){
   const Operation=typeof operation==='string'&&Object.hasOwn(CONNECTION_ENGINE_OPERATIONS,operation)?CONNECTION_ENGINE_OPERATIONS[operation]:null;
   if(!Operation)throw new StorageError('not_found','Not found.',404);
   await this.warm(owner);
   const result=await run(this,Operation,{actor:{kind:'system',owner},...input===undefined?{}:{input:shape(input)}});
   if(!['connections.cascades','connections.cascade-done','connections.outbox','connections.value','connections.feature-resources'].includes(operation))await this.connectionsDrain(owner);
   if(!(Operation.prototype instanceof AppQuery))await this.integrationEventsKick(owner);return result;
  },
  // LINK_SLOT_OCCUPANT ({owner, fragment}) -> {clientId, generation, cnx} | null (packages/links/engine.mjs).
  async linkSlotOccupant(query){const o=await exclusiveOccupant(this,query);return o&&{clientId:o.clientId,connection:o.connection,generation:o.generation,cnx:o.cnx};},
  // DELEGATION_SLOT_OCCUPANT ({owner, fragment}) -> {clientId, origin, ingress, cnx, purposes} | null (packages/identity/delegation.mjs).
  // `cnx` names the entry incarnation: a new entry, generation (suspend/resume, reconnect) or value change changes it (KD-1).
  async delegationSlotOccupant(query){const o=await exclusiveOccupant(this,query);return o&&{clientId:o.clientId,origin:o.origin,ingress:o.ingress,cnx:o.cnx,purposes:o.purposes};},
  // Suspension, recovery and deletion hook (KD-4). Idempotent; severs every connection and revokes every delegation.
  // `recovery` (a recovery file started a recovery, or a reissue was cancelled; recovery-identity spec: recovery does not
  // preserve app authorizations) ends connections permanently like `system`, and also revokes every key delegation,
  // including any not attached to a connection.
  async connectionsSeverAccount(owner,{reason='suspended'}={}){
   if(!await bound(this,owner))return {severed:0};
   const recovery=reason==='recovery';
   if(reason==='lifecycle-frozen'||reason==='admin-suspended')reason='suspended';else if(reason==='lifecycle-tombstone')reason='deleted';else if(recovery)reason='system';
   // Connections first (their durable cascade rows then revoke attached delegations), then every remaining delegation
   // (review 2026-10-23). A failure throws to the identity port, whose durable `pendingSever` row retries the whole hook.
   const result=await run(this,SeverAccountConnections,{actor:{kind:'system',owner},input:{reason}});
   if(recovery)await this.revokeDelegationsFor(owner,{reason:'system'});
   // Review M5: signaling endpoints, sessions, offers, pairings and session handler approvals end with the account severance itself, not
   // only through the cascade drain (which waits for INTEGRATIONS_ENABLED). Narrowing and idempotent; a failure throws
   // so the identity port's durable retry runs the whole hook again.
   if(typeof this.signalingAppRevoked==='function')await this.signalingAppRevoked(owner,{all:true});
   await this.connectionsDrain(owner);await this.integrationEventsKick(owner);return result;
  },
  // Applies pending cascade rows in order; stops at the first failure, which stays durable for the next call.
  async connectionsDrain(owner){
   if(!flagsFor(this.config).background('INTEGRATIONS_ENABLED')||!await bound(this,owner)||busy(this,owner)||(await this.metadata.list({prefix:'connections/cascade/',limit:1})).size===0)return {drained:0,pending:0};
   if(!draining.has(this))draining.set(this,new Set());const set=draining.get(this);set.add(owner);
   try{
   const rows=await run(this,ConnectionCascades,{actor:{kind:'system',owner}});let drained=0;
   for(const row of rows){
    try{
     if(row.kind==='delegations')await this.revokeDelegationsFor(owner,row.all?{reason:row.reason}:{clientId:row.clientId,reason:row.reason});
     // Signaling Appendix C.2 lifecycle hook: the same cascade clears the app's session handler approvals and runs §14.2
     // (signaling.lifecycle `app-revoked`; narrowing, never gated). A failure keeps this row pending for the next drain
     // (never swallowed). Connection end itself reaches signaling without this drain (AppConnections `ended`, and the
     // signaling tick's generation sweep), so INTEGRATIONS_ENABLED never decides whether it runs (H-1).
     if(row.kind==='delegations'&&typeof this.signalingAppRevoked==='function')await this.signalingAppRevoked(owner,row.all?{all:true}:{clientId:row.clientId});
     if(row.kind==='reconcile')await this.reconcileDelegations(owner);
    }catch(error){if(error?.code!=='not_found')return {drained,pending:rows.length-drained};}// not_found: delegation disabled, nothing certified.
    await run(this,ConnectionCascadeDone,{actor:{kind:'system',owner},input:{key:row.key}});drained++;
   }
   return {drained,pending:0};
   }finally{set.delete(owner);}
  },
};

export const rpc={
 connectionClientAuth:{gate:'none'},connectionsOwner:{warm:true},connectionsSetupComplete:{warm:true},connectionsSeverAccount:{lifecycle:'purging'},
};
