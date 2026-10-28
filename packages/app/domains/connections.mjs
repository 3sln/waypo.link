// Connections domain, EXT-X4 (docs/spec/integrations.md §1, §3, §7) and extensions revision 3.2 (§3–§6: provider-
// consumable field values, provider-feature grants, candidates and announcements; draft, unsigned). Engine-first: AppConnections (packages/apps/connections.mjs) is the
// provider resource over the account store; the Actions/Queries below are the operations. INTEGRATIONS_ENABLED
// gates new authority; owner reads, reverse paths and cleanup remain available during rollout changes.
//
// Actors (built by trusted adapters only, never from a request body; packages/runtime/account/connections.mjs):
//   {kind:'owner', owner, authTime?}  list, fields, candidates, built-in connect, suspend, resume, disconnect, approve a
//                                     staged manifest, assign, unassign, reorder, configure an entry, features, enable
//                                     and disable a feature, notices and announcement settings. `authTime` (ms) is the
//                                     owner's last authentication, needed for every add, replace, reorder or fill of a
//                                     field an enabled provider feature consumes, and for enabling (extensions §3.4).
//   {kind:'system', owner}            connect from an approved manifest snapshot (federation consent), setup complete,
//                                     health, X3 revalidation results, ingress from `describe` (C1b), account severance
//                                     (suspension, recovery, deletion), the value and feature-resources ports, feature
//                                     sync, the outbox and cascades.
// EXTENSIONS_ENABLED gates the new authority of revision 3.2 (assign, enable a feature, candidates); removal, disabling
// and reads stay available. A provider feature is live only while its extension is declared (which itself needs
// EXTENSIONS_ENABLED), so turning the flag off suspends every feature grant at once.
// Lifecycle: configuring | active | degraded | manifest-invalid | suspended | disconnected. Every change that removes
// authority (suspend, manifest-invalid, disconnect) increments the generation in the same commit that enqueues its
// events; resuming or approving increments it again, so nothing minted for an earlier generation is ever current.
import { Provider } from '../../../vendor/ngin/index.js';
import { AppAction, AppQuery } from '../engine.mjs';
import { AppFault } from '../faults.mjs';
import { UUID } from '../../core/primitives.mjs';
import {createFlags} from '../../flags/evaluate.mjs';

const unauthorized = () => { throw new AppFault('unauthorized', 'Sign in to continue.', 401); };
const forbidden = () => { throw new AppFault('forbidden', 'This operation is not available to this caller.', 403); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const input = (value, names) => { if (value === undefined) return {}; if (!plain(value) || Object.keys(value).some(name => !names.includes(name))) throw new AppFault('invalid_request', 'Unsupported connections request.', 400); return value; };
/** New grants/exposure only; ctx carries the verified owner subject and client. */
export const integrationsEnabled = (config={},ctx={}) => flagEnabled(config,ctx,'INTEGRATIONS_ENABLED');
const flagEnabled = (config={},ctx={},name) => (config?.flags??config?.FLAGS??createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env:config??{}})).for(ctx).enabled(name);

/** The `connections` provider class for createAppEngine. `connections`: an AppConnections over the account store.
 * `enabled`: INTEGRATIONS_ENABLED, from configuration. `account(owner)` -> {status} | null: the identity directory
 * status (IDENTITY_ACCOUNT); a non-active account is severed when the occupancy port observes it.
 * `config`/`flags`: pinned port, consulted per lease (never captured in the cached engine). With these inputs,
 * only new authority is gated; reads, disconnect, vacate, severance and outbox work remain available. */
export function connectionsProvider({ connections, enabled = false, account, config, flags } = {}) {
  return class extends ConnectionsProvider { static deps = []; constructor() { super(); Object.assign(this, { connections, enabled: enabled === true, account, config, flags }); } };
}
export class ConnectionsProvider extends Provider {
  async obtain({ actor } = {}) {
    if ((!this.config&&!this.flags&&!this.enabled) || !this.connections) throw new AppFault('not_found', 'Not found.', 404);
    if (!UUID.test(actor?.owner ?? '') || !['owner', 'system'].includes(actor?.kind)) unauthorized();
    // The account store's bound owner must be the actor's, whoever dispatched.
    const bound = await this.connections.metadata.get('owner'); if (bound !== undefined && bound !== actor.owner) throw new AppFault('forbidden', 'Account owner mismatch.', 403);
    const config=this.config??{},flags=config.flags??config.FLAGS??this.flags,admit=clientId=>{if((this.config||this.flags)&&!integrationsEnabled({...config,flags},{subject:{kind:'account',owner:actor.owner},...clientId||actor.clientId?{client:{clientId:clientId??actor.clientId}}:{}}))throw new AppFault('not_found','Not found.',404);};
    const extensions=()=>{if((this.config||this.flags)&&!flagEnabled({...config,flags},{subject:{kind:'account',owner:actor.owner}},'EXTENSIONS_ENABLED'))throw new AppFault('not_found','Not found.',404);};
    return Object.freeze(scope(this.connections, actor, this.account, admit, extensions));
  }
  release() {}
}
// The owner-scoped handle: methods take no owner argument, so an operation never holds an ID it could swap.
function scope(service, actor, account, admit, extensions) {
  const owner = actor.owner, system = actor.kind === 'system', ownerOnly = () => { if (system) forbidden(); }, systemOnly = () => { if (!system) forbidden(); };
  const live = async found => {
    if (found.sever) return { ...found, reason: 'suspended' };
    const list = found.entries ?? found.resources ?? [];
    if (!list.length) return found;
    if (typeof account !== 'function') return { ...found, entries: [], resources: [] };
    const status = (await account(owner))?.status; // A failing directory throws: the port reports an error, never a resource.
    if (status === 'active') return found;
    return { ...found, entries: [], resources: [], sever: Boolean(status), reason: status === 'deleted' ? 'deleted' : status === 'suspended' ? 'suspended' : 'system' };
  };
  return {
    // One owner read for the console: connections, provider-consumable fields, provider features and owner-only notices.
    list: async () => ({ connections: await service.list(owner), fields: await service.fields(owner), features: await service.features(owner), ...system ? {} : { notices: (await service.notices(owner)).notices } }),
    fields: () => service.fields(owner),
    candidates: value => { ownerOnly(); admit(); extensions(); return service.candidates(owner, input(value, ['fragment'])); },
    connect: value => { systemOnly(); const v = input(value, ['client', 'snapshot', 'expectedGeneration']); admit(v.client?.id); return service.connect(owner, v); },
    connectBuiltIn: value => { ownerOnly(); admit(); return service.connectBuiltIn(owner, input(value, ['integration'])); },
    transition: (op, value) => {
      const v = input(value, ['connection', 'expectedGeneration', 'configured', 'degraded', 'stagedRevision']);
      if (['suspend', 'resume', 'approve'].includes(op)) ownerOnly(); else systemOnly();
      if (['resume','approve'].includes(op)) admit();
      // W5-S3: approving a staged change (possibly a replaced key set) needs a recent owner verification.
      const { connection, ...rest } = v; return service.transition(owner, connection, op, rest, op === 'approve' ? { authTime: actor.authTime } : {});
    },
    disconnect: value => { const v = input(value, ['connection', 'expectedGeneration']); return service.disconnect(owner, typeof v.connection === 'string' ? v.connection : '', { reason: system ? 'system' : 'uninstalled', expectedGeneration: v.expectedGeneration }); },
    revalidated: value => { systemOnly(); const v = input(value, ['connection', 'expectedGeneration', 'result']); return service.revalidated(owner, v.connection, v); },
    severAll: value => { systemOnly(); return service.severAll(owner, input(value, ['reason'])); },
    assign: value => { ownerOnly(); admit(); extensions(); return service.assign(owner, value, { authTime: actor.authTime }); },
    unassign: value => { ownerOnly(); return service.unassign(owner, value); },
    reorder: value => { ownerOnly(); return service.reorder(owner, value, { authTime: actor.authTime }); },
    configureSeat: value => { ownerOnly(); admit(); return service.configureSeat(owner, value); },
    setIngress: value => { systemOnly(); return service.setIngress(owner, value); },
    // The value port: available entries plus the account fence, which also consults the identity directory.
    value: async value => { systemOnly(); const v = input(value, ['fragment']); return live(await service.value(owner, v.fragment)); },
    features: () => service.features(owner),
    enableFeature: value => { ownerOnly(); admit(); extensions(); return service.enableFeature(owner, input(value, ['feature', 'assign', 'expectedRevision']), { authTime: actor.authTime }); },
    disableFeature: value => { ownerOnly(); return service.disableFeature(owner, input(value, ['feature'])); },
    featureSync: () => { systemOnly(); return service.featureSync(owner); },
    // The provider feature's projection (extensions §3.1), fenced like the value port.
    featureResources: async value => { systemOnly(); return live(await service.featureResources(owner, input(value, ['feature']))); },
    fieldOperation: value => { systemOnly(); return service.fieldOperation(owner, input(value, ['feature'])); },
    notices: () => { ownerOnly(); return service.notices(owner); },
    dismissNotice: value => { ownerOnly(); return service.dismissNotice(owner, input(value, ['id'])); },
    announcements: value => { ownerOnly(); return service.announcements(owner, input(value, ['fragment', 'enabled'])); },
    outbox: value => { systemOnly(); return service.outbox(owner, input(value, ['after', 'limit'])); },
    ack: value => { systemOnly(); return service.ack(owner, input(value, ['through'])); },
    cascades: () => { systemOnly(); return service.cascades(owner); },
    cascadeDone: value => { systemOnly(); return service.cascadeDone(owner, input(value, ['key']).key); },
  };
}

const CHANGED = 'connections-changed';
export class ConnectionList extends AppQuery { static operation = 'connections.list'; static deps = ['connections']; static refreshOn = [CHANGED]; fetch({ connections }) { return connections.list(); } }
export class FieldList extends AppQuery { static operation = 'connections.fields'; static deps = ['connections']; static refreshOn = [CHANGED]; fetch({ connections }) { return connections.fields(); } }
/** Owner. `input`: {fragment}: extensions §5.1 candidates, neutral order, none preselected. */
export class FieldCandidates extends AppQuery { static operation = 'connections.candidates'; static deps = ['connections']; static refreshOn = [CHANGED]; fetch({ connections }) { return connections.candidates(this.input); } }
/** System. `input`: {client:{id, name, origin?}, snapshot, expectedGeneration?}: the snapshot X3's integrationSnapshot pinned at approval. */
export class ConnectIntegration extends AppAction { static operation = 'connections.connect'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.connect(this.input); } }
/** Owner. `input`: {integration}: a provider-authored built-in integration id. */
export class ConnectBuiltIn extends AppAction { static operation = 'connections.connect-built-in'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.connectBuiltIn(this.input); } }
/** Owner. `input`: {connection, expectedGeneration?}. */
export class SuspendConnection extends AppAction { static operation = 'connections.suspend'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.transition('suspend', this.input); } }
/** Owner. `input`: {connection, expectedGeneration} (required: a resume is never applied to an unseen generation). */
export class ResumeConnection extends AppAction { static operation = 'connections.resume'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.transition('resume', this.input); } }
/** Owner. `input`: {connection, expectedGeneration}: approve the staged manifest change. */
export class ApproveConnectionChange extends AppAction { static operation = 'connections.approve'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.transition('approve', this.input); } }
/** System. `input`: {connection, expectedGeneration, configured}: every required setup fragment and slot is approved, or no longer is. */
export class ConnectionConfigured extends AppAction { static operation = 'connections.configured'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.transition('configured', this.input); } }
/** System. `input`: {connection, expectedGeneration, degraded}: X6 delivery or X7 discovery health. */
export class ConnectionHealth extends AppAction { static operation = 'connections.health'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.transition('health', this.input); } }
/** Owner or system. `input`: {connection, expectedGeneration?}. */
export class DisconnectConnection extends AppAction { static operation = 'connections.disconnect'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.disconnect(this.input); } }
/** System. `input`: {connection, expectedGeneration, result}: a classifyIntegrationChange result for the pinned snapshot. */
export class ConnectionRevalidated extends AppAction { static operation = 'connections.revalidated'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.revalidated(this.input); } }
/** System. `input`: {reason: 'suspended'|'deleted'|'system'}: account suspension, recovery or deletion. */
export class SeverAccountConnections extends AppAction { static operation = 'connections.sever-account'; static deps = ['connections']; static changes = CHANGED; static lifecycle = 'purging'; run({ connections }) { return connections.severAll(this.input); } }
/** Owner. `input`: {fragment, connection, resource?, position?, replace?, purposes?, approve?, expectedRevision?}. */
export class AssignField extends AppAction { static operation = 'connections.assign'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.assign(this.input); } }
/** Owner. `input`: {fragment, seat, expectedRevision?}. */
export class UnassignField extends AppAction { static operation = 'connections.unassign'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.unassign(this.input); } }
/** Owner. `input`: {fragment, seats, expectedRevision?}. */
export class ReorderField extends AppAction { static operation = 'connections.reorder'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.reorder(this.input); } }
/** Owner. `input`: {fragment, seat, purposes}. */
export class ConfigureSeat extends AppAction { static operation = 'connections.configure-seat'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.configureSeat(this.input); } }
/** System. `input`: {fragment, seat, generation, ingress}. */
export class SetSeatIngress extends AppAction { static operation = 'connections.set-ingress'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.setIngress(this.input); } }
/** System, the value port. `input`: {fragment}. Returns {fragment, selection, entries, sever, reason?}. */
export class FieldValue extends AppQuery { static operation = 'connections.value'; static deps = ['connections']; static lifecycle = 'purging'; static gate = 'none'; fetch({ connections }) { return connections.value(this.input); } }
export class FeatureList extends AppQuery { static operation = 'connections.features'; static deps = ['connections']; static refreshOn = [CHANGED]; fetch({ connections }) { return connections.features(); } }
/** Owner, recent authentication. `input`: {feature, assign?:{connection, resource?}, expectedRevision?}. */
export class EnableFeature extends AppAction { static operation = 'connections.enable-feature'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.enableFeature(this.input); } }
/** Owner. `input`: {feature}. */
export class DisableFeature extends AppAction { static operation = 'connections.disable-feature'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.disableFeature(this.input); } }
/** System. Declaration loss/return, blocking and the 30-day bound. */
export class FeatureSync extends AppAction { static operation = 'connections.feature-sync'; static deps = ['connections']; static changes = CHANGED; static lifecycle = 'purging'; run({ connections }) { return connections.featureSync(); } }
/** System, a provider feature's projection. `input`: {feature}. Returns {feature, live, grant?, resources, sever}. */
export class FeatureResources extends AppQuery { static operation = 'connections.feature-resources'; static deps = ['connections']; static lifecycle = 'purging'; static gate = 'none'; fetch({ connections }) { return connections.featureResources(this.input); } }
/** System. `input`: {feature}: a createFieldOperation state over the feature's approved resources. */
export class FieldOperation extends AppQuery { static operation = 'connections.field-operation'; static deps = ['connections']; fetch({ connections }) { return connections.fieldOperation(this.input); } }
export class NoticeList extends AppQuery { static operation = 'connections.notices'; static deps = ['connections']; static refreshOn = [CHANGED]; fetch({ connections }) { return connections.notices(); } }
export class DismissNotice extends AppAction { static operation = 'connections.dismiss-notice'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.dismissNotice(this.input); } }
/** Owner. `input`: {fragment, enabled}. */
export class SetAnnouncements extends AppAction { static operation = 'connections.announcements'; static deps = ['connections']; static changes = CHANGED; run({ connections }) { return connections.announcements(this.input); } }
/** System (X6). `input`: {after?, limit?}. */
export class ConnectionOutbox extends AppQuery { static operation = 'connections.outbox'; static deps = ['connections']; fetch({ connections }) { return connections.outbox(this.input); } }
/** System (X6). `input`: {through}. */
export class AckConnectionOutbox extends AppAction { static operation = 'connections.ack'; static deps = ['connections']; run({ connections }) { return connections.ack(this.input); } }
export class ConnectionCascades extends AppQuery { static operation = 'connections.cascades'; static deps = ['connections']; fetch({ connections }) { return connections.cascades(); } }
export class ConnectionCascadeDone extends AppAction { static operation = 'connections.cascade-done'; static deps = ['connections']; run({ connections }) { return connections.cascadeDone(this.input); } }

export const CONNECTION_OPERATIONS = Object.freeze([ConnectionList, FieldList, FieldCandidates, ConnectIntegration, ConnectBuiltIn, SuspendConnection, ResumeConnection, ApproveConnectionChange, ConnectionConfigured, ConnectionHealth, DisconnectConnection, ConnectionRevalidated, SeverAccountConnections, AssignField, UnassignField, ReorderField, ConfigureSeat, SetSeatIngress, FieldValue, FeatureList, EnableFeature, DisableFeature, FeatureSync, FeatureResources, FieldOperation, NoticeList, DismissNotice, SetAnnouncements, ConnectionOutbox, AckConnectionOutbox, ConnectionCascades, ConnectionCascadeDone]);
export const CONNECTION_OWNER_OPERATIONS = Object.freeze(['connections.list', 'connections.fields', 'connections.candidates', 'connections.connect-built-in', 'connections.suspend', 'connections.resume', 'connections.approve', 'connections.disconnect', 'connections.assign', 'connections.unassign', 'connections.reorder', 'connections.configure-seat', 'connections.features', 'connections.enable-feature', 'connections.disable-feature', 'connections.notices', 'connections.dismiss-notice', 'connections.announcements']);
