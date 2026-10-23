// ORG-1 engine operations (docs/architecture/organizations-design.md §13: "every operation is an ngin Action or Query
// in a domain module, dispatched in the organization's account single writer"). The rules are in
// packages/orgs/organizations.mjs; actors are resolved by packages/orgs/authority.mjs before dispatch.
//
//   static entities  which acting entity kinds an operation accepts (ORG-0 seam; default ['person'])
//   system operations (initialize, confirm, forget, tick) are never wire-dispatchable: the account slice
//   (packages/runtime/account/orgs.mjs) performs them with a system actor built from trusted adapter evidence.
import {Provider} from '../../../vendor/ngin/index.js';
import {AppAction,AppQuery} from '../engine.mjs';
const CHANGED='organization-changed';
/** The `organizations` provider class over one OrganizationService (one per account single writer). */
export function organizationsProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
class OrgAction extends AppAction{static deps=['organizations'];static changes=CHANGED;}
class OrgQuery extends AppQuery{static deps=['organizations'];static refreshOn=[CHANGED];}
// Person placement.
export class ReserveOrganization extends OrgAction{static operation='orgs.reserve';static entities=['person'];run({organizations}){return organizations.reserve(this.actor,this.input);}}
export class OrganizationList extends OrgQuery{static operation='orgs.list';static entities=['person'];fetch({organizations}){return organizations.list(this.actor);}}
// Organization placement.
export class OrganizationGet extends OrgQuery{static operation='orgs.get';static entities=['organization'];static lifecycle='suspended';fetch({organizations}){return organizations.get(this.actor);}}
export class OrganizationAudit extends OrgQuery{static operation='orgs.audit';static entities=['organization'];static lifecycle='suspended';fetch({organizations}){return organizations.audits(this.actor,this.input);}}
export class RenameOrganization extends OrgAction{static operation='orgs.rename';static entities=['organization'];run({organizations}){return organizations.rename(this.actor,this.input);}}
export class LabelOrganization extends OrgAction{static operation='orgs.set-label';static entities=['organization'];run({organizations}){return organizations.setLabel(this.actor,this.input);}}
export class ScheduleOrganizationDeletion extends OrgAction{static operation='orgs.schedule-deletion';static entities=['organization'];run({organizations}){return organizations.scheduleDeletion(this.actor,this.input);}}
export class CancelOrganizationDeletion extends OrgAction{static operation='orgs.cancel-deletion';static entities=['organization'];static lifecycle='suspended';run({organizations}){return organizations.cancelDeletion(this.actor,this.input);}}
// System (never wire-dispatchable).
export class InitializeOrganization extends OrgAction{static operation='orgs.initialize';static lifecycle='suspended';run({organizations}){return organizations.initialize(this.actor,this.input);}}
export class ConfirmOrganization extends OrgAction{static operation='orgs.confirm';run({organizations}){return organizations.confirm(this.actor,this.input);}}
export class ForgetOrganization extends OrgAction{static operation='orgs.forget';static lifecycle='suspended';run({organizations}){return organizations.forget(this.actor,this.input);}}
export class OrganizationTick extends OrgAction{static operation='orgs.tick';static lifecycle='suspended';run({organizations}){return organizations.tick(this.actor);}}
// ORG-2/3: membershipEntry permits authenticated non-admins to reach private self/consent checks in the provider.
export class InviteMember extends OrgAction{static operation='orgs.invite';static entities=['organization'];run({organizations}){return organizations.invite(this.actor,this.input);}}
export class AcceptMembership extends OrgAction{static operation='orgs.accept';static entities=['organization'];static membershipEntry=true;run({organizations}){return organizations.accept(this.actor,this.input);}}
export class LeaveOrganization extends OrgAction{static operation='orgs.leave';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';run({organizations}){return organizations.leave(this.actor,this.input??{});}}
export class RemoveMember extends OrgAction{static operation='orgs.remove-member';static entities=['organization'];run({organizations}){return organizations.remove(this.actor,this.input);}}
export class SetMemberGrants extends OrgAction{static operation='orgs.member-grants';static entities=['organization'];run({organizations}){return organizations.grants(this.actor,this.input);}}
export class DecideMemberGrants extends OrgAction{static operation='orgs.decide-grants';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';run({organizations}){return organizations.decide(this.actor,this.input);}}
export class MembershipPolicy extends OrgAction{static operation='orgs.membership-policy';static entities=['organization'];run({organizations}){return organizations.policy(this.actor,this.input);}}
export class ReconfirmMember extends OrgAction{static operation='orgs.reconfirm';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';run({organizations}){return organizations.reconfirm(this.actor,this.input);}}
export class OrganizationMembers extends OrgQuery{static operation='orgs.members';static entities=['organization'];fetch({organizations}){return organizations.members(this.actor,this.input??{});}}
export class MemberContext extends OrgAction{static operation='orgs.member-context';static entities=['organization'];static membershipEntry=true;run({organizations}){return organizations.context(this.actor,this.input);}}
export class MemberAuthority extends OrgQuery{static operation='orgs.member-authority';static entities=['organization'];fetch({organizations}){return organizations.authority(this.actor,this.input);}}
export class MembershipSweep extends OrgAction{static operation='orgs.membership-sweep';static lifecycle='suspended';run({organizations}){return organizations.sweep(this.actor);}}
export class MuteMemberRequests extends OrgAction{static operation='orgs.mute-requests';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';run({organizations}){return organizations.mute(this.actor,this.input);}}
export class MembershipOutboxDrain extends OrgAction{static operation='orgs.member-outbox-drain';static lifecycle='suspended';run({organizations}){return organizations.drain(this.actor);}}
export class ObserveMemberAuthority extends OrgAction{static operation='orgs.observe-authority';static lifecycle='suspended';run({organizations}){return organizations.observe(this.actor,this.input);}}
export class MemberSnapshot extends OrgAction{static operation='orgs.member-snapshot';run({organizations}){return organizations.snapshot(this.actor,this.input);}}
export class MemberLookup extends OrgQuery{static operation='orgs.member-lookup';fetch({organizations}){return organizations.lookup(this.actor,this.input);}}
// ORG-5 discovery and organization-context adapters (provisional coordinator work, 2026-10-23).
// Person placement: discovery candidates and membership hints (packages/orgs/organizations.mjs). Hints are written
// only by the acceptance and leave adapters; discovery confirms each one with the organization (packages/orgs/discovery.mjs).
export class OrganizationCandidates extends OrgQuery{static operation='orgs.candidates';static entities=['person'];fetch({organizations}){return organizations.candidates(this.actor);}}
export class RememberMembership extends OrgAction{static operation='orgs.remember-membership';static entities=['person'];run({organizations}){return organizations.remember(this.actor,this.input);}}
export class ForgetMembership extends OrgAction{static operation='orgs.forget-membership';static entities=['person'];static lifecycle='suspended';run({organizations}){return organizations.forgetMembership(this.actor,this.input);}}
// Organization placement: the acting member's own view, their role-filtered pending requests, and the power check the
// connections and preferences adapters run in this writer before acting for the organization.
export class OrganizationMembership extends OrgQuery{static operation='orgs.membership';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';fetch({organizations}){return organizations.membership(this.actor,this.input??{});}}
export class OrganizationRequests extends OrgQuery{static operation='orgs.requests';static entities=['organization'];static membershipEntry=true;static lifecycle='suspended';fetch({organizations}){return organizations.requests(this.actor,this.input??{});}}
export class OrganizationActingAuthority extends OrgAction{static operation='orgs.acting-authority';static entities=['organization'];static lifecycle='suspended';run({organizations}){return organizations.actingAuthority(this.actor,this.input);}}
export const MEMBERSHIP_OPERATIONS=Object.freeze([MuteMemberRequests,InviteMember,AcceptMembership,LeaveOrganization,RemoveMember,SetMemberGrants,DecideMemberGrants,MembershipPolicy,ReconfirmMember,OrganizationMembers,MemberContext,MemberAuthority,OrganizationMembership,OrganizationRequests,OrganizationActingAuthority]);
/** Owner-route operations: the account slice resolves their actor with `accountActor`. */
export const ORG_OPERATIONS=Object.freeze([...MEMBERSHIP_OPERATIONS,ReserveOrganization,OrganizationList,OrganizationCandidates,RememberMembership,ForgetMembership,OrganizationGet,OrganizationAudit,RenameOrganization,LabelOrganization,ScheduleOrganizationDeletion,CancelOrganizationDeletion]);
export const ORG_SYSTEM_OPERATIONS=Object.freeze([MemberLookup,ObserveMemberAuthority,MemberSnapshot,MembershipOutboxDrain,MembershipSweep,InitializeOrganization,ConfirmOrganization,ForgetOrganization,OrganizationTick]);

/** Trusted in-writer ORG-4 membership port. It dispatches the same production operations as every other adapter. */
export function membershipEnginePort({engine,owner,perform,read}){
 const actor={kind:'system',owner};return {
  lookup:principal=>read(engine,new MemberLookup({actor,input:{principal}})),
  observe:(principal,evidence)=>perform(engine,new ObserveMemberAuthority({actor,input:{principal,...evidence}})),
  async context(principal,{client,generation}){const m=await read(engine,new MemberLookup({actor,input:{principal}}));const result=await perform(engine,new MemberSnapshot({actor,input:{principal,membership_id:m?.id,generation,client}}));return {membership_id:result.member.id,generation:result.member.generation};}
 };
}
