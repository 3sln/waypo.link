// Account deletion domain, DX-3 (docs/architecture/account-deletion-export.md §2, §6). Engine-first: the
// DeletionService (packages/runtime/account-deletion.mjs) is the provider resource; these Actions and Queries are
// the operations. The service is provided under the catalogued `lifecycle` name ("Account lifecycle runner and
// retention protection"): deletion shares the lifecycle purge executor and its account-local records.
//
// Actors (built by trusted adapters only, never from a request body; packages/runtime/account/deletion.mjs):
//   {kind:'owner', owner, stepUpAt?, sessionId?}  request (fresh step-up evidence), status, cancel
//   {kind:'cancel-link', owner}                   cancel with the emailed or pushed cancel-only token
//   {kind:'system', owner, reason}                step (alarm, sweep), admin scheduling (DX-7), admin cancel
//
// Lifecycle levels (R1-L8): request and status 'suspended'; cancels and the step 'purging'. Every operation
// declares termsGate 'exempt': deleting must never require accepting new terms (§2.1). The `termsGate` static is
// consumed by the future terms re-acceptance slice; `operations()` ignores statics it does not know.
import { AppAction, AppQuery } from '../engine.mjs';

const CHANGED = 'account-deletion-changed';
class DeletionAction extends AppAction { static deps = ['lifecycle']; static changes = CHANGED; static termsGate = 'exempt'; }
/** Owner. `input`: {confirmHandle, acknowledgements:{messages, storage, names, plan?}, operationId}. */
export class RequestAccountDeletion extends DeletionAction { static operation = 'deletion.request'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.request(this.actor, this.input); } }
/** Owner or system. */
export class AccountDeletionStatus extends AppQuery { static operation = 'deletion.status'; static deps = ['lifecycle']; static refreshOn = [CHANGED]; static lifecycle = 'suspended'; static termsGate = 'exempt'; fetch({ lifecycle }) { return lifecycle.status(this.actor); } }
/** Owner (any session, no step-up) or system (an administrator reverses a closure). */
export class CancelAccountDeletion extends DeletionAction { static operation = 'deletion.cancel'; static lifecycle = 'purging'; run({ lifecycle }) { return lifecycle.cancel(this.actor); } }
/** Cancel link. `input`: {token}. */
export class CancelAccountDeletionByToken extends DeletionAction { static operation = 'deletion.cancel-token'; static lifecycle = 'purging'; run({ lifecycle }) { return lifecycle.cancelToken(this.actor, this.input); } }
/** System: one bounded step of the commit or the executor. Returns {action, busy?, wakeAt?}. */
export class StepAccountDeletion extends DeletionAction { static operation = 'deletion.step'; static lifecycle = 'purging'; run({ lifecycle }) { return lifecycle.step(this.actor); } }
/** System (DX-7). `input`: {basis:'admin-email'|'admin-underage'|'admin-closure', operationId, adminAuditSeq, exportUntil?}. */
export class ScheduleAdminDeletion extends DeletionAction { static operation = 'deletion.schedule-admin'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.scheduleAdmin(this.actor, this.input); } }

export const ACCOUNT_DELETION_OPERATIONS = Object.freeze([RequestAccountDeletion, AccountDeletionStatus, CancelAccountDeletion, CancelAccountDeletionByToken, StepAccountDeletion, ScheduleAdminDeletion]);
export const ACCOUNT_DELETION_OWNER_OPERATIONS = Object.freeze(['deletion.request', 'deletion.status', 'deletion.cancel']);
