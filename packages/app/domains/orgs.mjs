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
/** Owner-route operations: the account slice resolves their actor with `accountActor`. */
export const ORG_OPERATIONS=Object.freeze([ReserveOrganization,OrganizationList,OrganizationGet,OrganizationAudit,RenameOrganization,LabelOrganization,ScheduleOrganizationDeletion,CancelOrganizationDeletion]);
export const ORG_SYSTEM_OPERATIONS=Object.freeze([InitializeOrganization,ConfirmOrganization,ForgetOrganization,OrganizationTick]);
