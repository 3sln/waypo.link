// Active-account recovery-file reissue, account half (docs/3sln/accounts/recovery-identity.md "Active-account reissue",
// provisional; identity portability P14, P17, design §6.1a). Engine-first: `RecoveryReissueService` is the
// account-placement provider resource, dispatched in the account single writer by packages/runtime/account/identity.mjs
// (`recoveryReissuePrepare`, `recoveryReissueCommit`), and the `recovery.reissue-*` Actions below are its operations.
// The identity half (who may reissue, the staged credential, the identity commit and the notices) is
// IdentityService#reissueRecoveryBegin / #reissueRecoveryConfirm; the bridge is the recovery-file port
// (packages/runtime/identity-backup.mjs `reissue`, `reissueCommit`).
//
// Recovery file v3 (option C, owner approval 2026-10-28) is an opaque credential: it holds no keys, so neither gate
// rotates or binds a key any more (P15 and the recovery kid binding are withdrawn).
//
// Ordering. Both operations run inside the account single writer, so each is linearized against transfer-out steps and
// commits and deletion scheduling and execution. The identity CAS that follows is a trailing effect: an operation that
// passed this gate is ordered before anything the writer runs after it.
//   prepare  refuses (account deleted, deletion scheduled or executing, identity moved or still arriving, transfer
//            committed or contested, support lock, P17 contest window). It reports whether a transfer-out is pending,
//            so the UI can warn.
//   commit   the same refusals, then cancels a pending or held transfer-out (`TransferOutService#recoveryReissue`).
//
// Forced paths are armed on the identity record (not here): an elevated-proof abort (transfer-out.mjs
// `invalidateRecovery(owner, {reason:'elevated-abort'})`) and PORT-4 activation (`transferInRecoveryPort` below).
import { AppAction } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { isUUID } from '../core/primitives.mjs';
import { custodyFence } from './keys.mjs';
import { RECOVERY_REISSUE_REASONS } from './service.mjs';

// Deletion records this engine reads but never writes (packages/runtime/account-deletion.mjs, lifecycle-storage.mjs).
const DELETION_REQUEST = 'deletion/request-v1', DELETION_FENCE = 'deletion/fence-v1', PURGE = 'lifecycle/purge-v1', TOMBSTONE = 'lifecycle/tombstone-v1';
const fail = (code, message, status = 400) => { throw new AppFault(code, message, status); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The requesting session as the P17 contest window compares it ({credentialId, sessionId}); built by trusted code. */
function actorOf(actor) {
  if (actor?.kind !== 'owner' || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401);
  return { kind: 'owner', owner: actor.owner, credentialId: typeof actor.credentialId === 'string' ? actor.credentialId : null, stepUpCredentialId: typeof actor.stepUpCredentialId === 'string' ? actor.stepUpCredentialId : null, sessionId: typeof actor.sessionId === 'string' ? actor.sessionId : null };
}
export class RecoveryReissueService {
  /** `metadata`: the account store (get). `transfer()`: this account's TransferOutService. */
  constructor({ metadata, transfer }) {
    if (typeof metadata?.get !== 'function' || typeof transfer !== 'function') throw new TypeError('Recovery reissue dependencies are required.');
    Object.assign(this, { metadata, transfer });
  }
  /** Refusals that do not depend on transfer-out: owner binding, deletion and custody. */
  async refuse(owner) {
    const stored = await this.metadata.get('owner');
    if (stored !== owner) fail(stored === undefined ? 'account_unavailable' : 'forbidden', stored === undefined ? 'Account unavailable.' : 'Account owner mismatch.', stored === undefined ? 409 : 403);
    if (await this.metadata.get(TOMBSTONE) !== undefined) fail('account_deleted', 'This account was deleted.', 410);
    const request = await this.metadata.get(DELETION_REQUEST);
    if (['scheduled', 'executing'].includes(request?.state) || await this.metadata.get(DELETION_FENCE) !== undefined || await this.metadata.get(PURGE) !== undefined) fail('deletion_scheduled', 'Cancel the scheduled account deletion before replacing your recovery file.', 409);
    const fence = await custodyFence(this.metadata);
    if (fence) fail(fence, fence === 'identity_moved' ? 'This identity moved to another provider.' : 'This identity is still arriving from another provider.', 409);
  }
  async prepare(actor) {
    const who = actorOf(actor);
    await this.refuse(who.owner);
    const { transferPending } = await this.transfer().recoveryReissue(who, { commit: false });
    return { transferPending: transferPending === true };
  }
  async commit(actor) {
    const who = actorOf(actor);
    await this.refuse(who.owner);
    const { transferCancelled } = await this.transfer().recoveryReissue(who, { commit: true });
    return { committed: true, transferCancelled: transferCancelled === true };
  }
}

// ---- engine operations ----------------------------------------------------------------------------------------
// Internal only: reached through the recovery-file port's account RPCs, never from an HTTP body. Terms-exempt: the
// owner must always be able to secure the account.
// Provided under the catalogued `lifecycle` name, as transfer-out and transfer-in are (packages/app/providers.mjs).
class ReissueAction extends AppAction { static deps = ['lifecycle']; static changes = 'recovery-reissue-changed'; static termsGate = 'exempt'; }
export class PrepareRecoveryReissue extends ReissueAction { static operation = 'recovery.reissue-prepare'; run({ lifecycle }) { return lifecycle.prepare(this.actor); } }
export class CommitRecoveryReissue extends ReissueAction { static operation = 'recovery.reissue-commit'; run({ lifecycle }) { return lifecycle.commit(this.actor); } }
export const RECOVERY_REISSUE_OPERATIONS = Object.freeze([PrepareRecoveryReissue, CommitRecoveryReissue]);

// ---- PORT-4 recovery port over the identity repository --------------------------------------------------------

/** `TRANSFER_IN_PORTS.recovery` (packages/identity/transfer-in.mjs activation stage 4). A recovery file is encrypted in
 * the owner's browser, so the destination cannot issue it server-side: `issue(owner)` arms the forced reissue on the
 * now-active identity and resolves {ok:false, armed:true}, so activation still reports `recoveryRequired` until the
 * owner downloads. A failed write throws, so the stage retries. */
export function transferInRecoveryPort(repository, { clock = () => Date.now(), crypto: webCrypto = globalThis.crypto } = {}) {
  if (typeof repository?.get !== 'function' || typeof repository.compareAndSwap !== 'function') throw new TypeError('An identity repository is required.');
  const reason = 'transfer-in'; if (!RECOVERY_REISSUE_REASONS.includes(reason)) throw new TypeError('Unknown reissue reason');
  return Object.freeze({
    async issue(owner) {
      if (!isUUID(owner)) throw new TypeError('Invalid account identifier');
      for (let attempt = 0; attempt < 4; attempt++) {
        const account = await repository.get(owner);
        if (!account || account.id !== owner || account.status !== 'active') throw Object.assign(new Error('Identity not active.'), { code: 'identity_unavailable' });
        if (account.recoveryReissue?.reason === reason || typeof account.recoveryHash === 'string' && account.recoveryHash) return { ok: false, armed: account.recoveryReissue?.reason === reason };
        const next = structuredClone(account); next.recoveryReissue = { reason, at: clock() };
        next.audit = [...(next.audit || []).slice(-99), { id: webCrypto.randomUUID(), type: 'recovery-reissue-required', at: clock() }]; next.revision = account.revision + 1;
        if (await repository.compareAndSwap(owner, account.revision, next)) return { ok: false, armed: true };
      }
      throw Object.assign(new Error('Identity changed.'), { code: 'conflict' });
    },
  });
}
