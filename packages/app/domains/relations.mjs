// ORG-10f relations engine domain (docs/architecture/organizations-design.md §8b.10 "Engine operations"). The rules live
// in packages/orgs/relation-*.mjs (ORG-10a–e), which define the ngin Actions and Queries next to their services, as
// packages/orgs/certificates.mjs does; this module re-exports them as the domain and classifies them for the adapters.
// Provisional (coordinator), not signed off by the user; behind ORG_RELATIONS_ENABLED (default off, RL-1).
//
//   RELATION_OWNER_OPERATIONS   wire-dispatchable, organization placement: the account slice
//                               (packages/runtime/account/relations.mjs) resolves the actor with the ORG-0 seam
//   RELATION_SYSTEM_OPERATIONS  never wire-dispatchable: adapters build a system actor from verified evidence
//                               (redeem, offer, retract, ingest, certify, authorize, drain, resync, sweep, tick, …)
//   RELATION_ROUTE_OPERATIONS   the console's `{operation}` names (POST /api/orgs/{org}/relations) → engine operations
//   RELATION_WIDENING           route operations that widen (flag, unheld admin, fresh step-up; RL-2). The route answers
//                               the uniform 404 for them while ORG_RELATIONS_ENABLED is off; the engine rechecks.
//   RELATION_FLAG_READS         lookups that only make sense for widening (catalogue, preview, …): gated like widening
//   RELATION_NARROWING          never gated by any relations flag (RL-3, §8b.10 flag table)
export {RelationService,relationsProvider,sameHostRelationTransport,RELATION_OPERATIONS,RELATION_SYSTEM_OPERATIONS,RELATION_NEVER_GATED,ORG_RELATIONS_FLAG,ORG_FOREIGN_RELATIONS_FLAG,
 RelationExport,RelationCatalogue,RelationResources,RelationInvitations,RelationOverview,RelationPreview,RelationList,RelationGet,RelationInbound,RelationInboundPreview,CreateRelation,InviteRelation,AcceptRelation,
 WithdrawRelationInvitation,DeclineRelationItem,LeaveRelation,MuteRelationOrganization,RedeemRelation,OfferRelation,RetractRelationOffer,RelationSweep} from '../../orgs/relation-instances.mjs';
export {SuspendRelationEdge,EndRelationEdge,NarrowRelationEdge,ResumeRelationEdge,IngestRelationEvent,RelationOutboxDrain,RelationResync,RelationEdgeCheck} from '../../orgs/relation-edges.mjs';
export {RelationImports,RelationImportAuthority} from '../../orgs/relation-imports.mjs';
export {IntroduceRelation,AdmitRelationCandidate,RelationIntroductions} from '../../orgs/relation-events.mjs';
export {ObserveRelationCounterpart,RelationLifecycleEvent,RelationTick,RelationPurgeReady,ConfirmRelationCounterpart,RebindRelationEdge,RelationHolds} from '../../orgs/relation-lifecycle.mjs';
export {CertifyRelationAccess,AuthorizeRelationAccess} from '../../orgs/relation-access.mjs';
export {UpgradeRelation} from '../../orgs/relation-upgrades.mjs';
import {RELATION_OPERATIONS} from '../../orgs/relation-instances.mjs';

/** Owner-route operations (organization placement; the actor is resolved by `accountActor`). */
export const RELATION_OWNER_OPERATIONS=RELATION_OPERATIONS;
/** The console's operation names (POST /api/orgs/{org}/relations {operation, ...input}). */
export const RELATION_ROUTE_OPERATIONS=Object.freeze({
 preview:'relations.preview','inbound-preview':'relations.inbound-preview',
 upgrade:'relations.upgrade',create:'relations.create',invite:'relations.invite',accept:'relations.accept',admit:'relations.admit',resume:'relations.resume',rebind:'relations.rebind','confirm-counterpart':'relations.confirm-counterpart',
 introduce:'relations.introduce',
 withdraw:'relations.withdraw',decline:'relations.decline',suspend:'relations.suspend',end:'relations.end',narrow:'relations.narrow',leave:'relations.leave',mute:'relations.mute',
});
export const RELATION_WIDENING=Object.freeze(new Set(['upgrade','create','invite','accept','admit','resume','rebind','confirm-counterpart']));
export const RELATION_FLAG_READS=Object.freeze(new Set(['preview','inbound-preview','introduce']));
export const RELATION_NARROWING=Object.freeze(new Set(['withdraw','decline','suspend','end','narrow','leave','mute']));
