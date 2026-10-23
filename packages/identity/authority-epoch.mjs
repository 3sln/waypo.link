// Same-host authority epoch, `aep` (organizations spec §2, §5.2a; design §12c.2, ORG-0/ORG-1 note 1). Provisional
// (coordinator), not signed off by the user.
//
// Record field `account.aep`: a non-negative safe integer on the identity record, absent = 0. It is the value 3sln.me
// as a home provider writes into member certificates (`aep`, packages/identity/member-certificates.mjs) and the value
// organizations compare against the highest epoch they recorded for a membership (ORG-2 `observeAuthority`).
//
// It is deliberately narrower than `account.security.epoch` (DX-6), which also rises on routine credential changes
// (adding a passkey, setting a password, changing email). Every `aep` increase is an authority reset at every
// organization the person belongs to, which holds their governance powers there, so it rises ONLY on:
//   recovery      a recovery-file recovery completes (IdentityService#confirmRecovery): whoever completes it
//                 inherits the identity (review R1-H3);
//   transfer-in   the destination of an identity move activates with `aep` above the attested one (identity
//                 portability §7; packages/identity/transfer-in.mjs `activate`);
//   elevated-abort an elevated abort invalidates the recovery credential in the identity CAS.
//   credential-reset reserved for an explicit credential-reset path; ordinary addition/removal is not a reset.
//   key-reset     reserved: a signing-key reset without continuity. Same-host identities have no routed path that
//                 revokes the current signing key today; verifiers detect a foreign key reset through the ORG-7
//                 directory pin (`authorityEpoch` of a resolved key) and treat it as a reset independently.
// It never decreases (review R2-M1). A home provider that cannot read it MUST NOT issue member certificates (spec
// §5.2a), so a malformed value fails closed (throws `identity_authority_epoch_unavailable`).
//
// The same field name, `aep`, is what ORG-2 records per membership (packages/orgs/memberships.mjs) and what the ORG-0
// actor carries (packages/orgs/authority.mjs `actor.aep`).
export const AUTHORITY_EPOCH_FIELD = 'aep';
export const AUTHORITY_RESET_REASONS = Object.freeze(['recovery', 'credential-reset', 'elevated-abort', 'transfer-in', 'key-reset']);
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const unavailable = () => { throw Object.assign(new Error('The authority epoch is unavailable.'), { code: 'identity_authority_epoch_unavailable', status: 503 }); };

/** The identity record's authority epoch: 0 when absent, the value when valid; malformed throws (fail closed). */
export function authorityEpoch(account) {
  const value = account?.[AUTHORITY_EPOCH_FIELD];
  if (value === undefined) return 0;
  if (!nonNegative(value) || !Number.isSafeInteger(value + 1)) unavailable();
  return value;
}
/** Raises the epoch on the record about to be written (in the same compare-and-swap as the reset it records). `floor`
 * (optional) is a lower bound the new value must reach, such as the attested `aep + 1` of a move. */
export function raiseAuthorityEpoch(account, { reason, floor = 0 } = {}) {
  if (!AUTHORITY_RESET_REASONS.includes(reason) || !nonNegative(floor)) throw new TypeError('Unsupported authority reset.');
  const next = Math.max(authorityEpoch(account) + 1, floor);
  if (!Number.isSafeInteger(next)) unavailable();
  account[AUTHORITY_EPOCH_FIELD] = next;
  return next;
}
/** Trusted read-only port over any identity repository with get(id): the epoch of an active identity, or null. */
export function identityAuthorityEpochPort(repository) {
  return async owner => { const account = await repository.get(owner); return account?.id === owner && account.status === 'active' ? authorityEpoch(account) : null; };
}

/** Trusted same-host step-up evidence for dangerous organization elevation decisions. Never accepts wire input. */
export function organizationVerification(account,session){
 const used=session?.stepUpCredential,enrolledAt=used?.kind==='passkey'?account.credentials?.find(c=>c.id===used.id)?.createdAt:used?.kind==='password'&&account.passwordHash?account.passwordSetAt:undefined;
 const securityChangedAt=account.security===undefined?0:account.security?.changedAt;
 return Number.isSafeInteger(enrolledAt)&&enrolledAt>=0&&Number.isSafeInteger(securityChangedAt)&&securityChangedAt>=0&&Number.isSafeInteger(session?.stepUpAt)?{enrolledAt,securityChangedAt,stepUpAt:session.stepUpAt}:null;
}
