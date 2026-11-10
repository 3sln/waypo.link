# Browser-access recovery

This is an optional **provider implementation feature**, not a new OIDC login flow or app permission. Apps keep using ordinary provider discovery and sign-in. A successful recovery removes one provider browser session; ordinary login and application-grant management remain separate.

The [account guide](../browser-recovery.md) explains the user experience. Local Node and Worker profiles exercise real email signup, retained sessions, maintained verification, explicit confirmation, bounded garbage collection, and subsequent login. External email acceptance and human-verification vendors are synthetic test resources; this is not evidence of live delivery or public deployment readiness.

## Configure deliberately

Keep the complete finite Native credential, session-security, account-admission, and storage-headroom configuration described in the [installation guide](self-hosting.md). Browser recovery additionally needs a finite `lostSessionRecovery` policy. Email recovery requires the separate boolean `lostSessionRecoveryEmail: true`; it is off by default.

For example, this is an additional **functional-test policy fragment**, not a production capacity recommendation:

```json
{
  "lostSessionRecovery": {
    "revision": "reviewed-local-policy-v1",
    "slots": 4,
    "attemptsPerWindow": 16,
    "workPerWindow": 256,
    "windowMs": 600000,
    "stateBytes": 16384,
    "reservedBytes": 327680
  },
  "lostSessionRecoveryEmail": true
}
```

Email recovery also requires working delivery, `emailHuman.required: true`, production-mode purpose-bound human-verification configuration, a distinct HTTPS challenge origin, and the actual administration/account-policy preflight. The implementation refuses incomplete prerequisites. Keep ordinary signup and operator administration restrictions in place.

Self-hosted Node uses configured email delivery; Worker deployments use their configured transport. The Waypo.link composition additionally requires the exact issuer-bound private budgeted transport explicitly registered for `identity-session-recovery`. An older issuer-only transport brand is insufficient. The new purpose shares authentication email ceilings and recipient safeguards, uses the login sender domain, and validates the main-origin link and exact-browser message before spending or dispatching. See [hosted email](hosted-email.md).

## Security boundary

The first maintained passkey or email proof can produce a bounded list of owned browsers without issuing a provider login session. Selecting one browser fixes the review. A fresh second proof is bound to that exact selection, operation, browser cookie and deadline. The final private capability permits one sign-out effect; JavaScript and the read-only review endpoint never receive that capability.

A verified email account whose assurance is initially unknown can enter only an inventory-free verified-owner stage. Actual administration and policy checks run outside the maintained Native lease. Native reentry compares the same contact/key snapshot and assurance epoch before a narrow ordinary-classification transition and list publication. Governed assurance is never downgraded by this path.

The email link carries its token in a fragment. The provider page removes it from history, retains it only in memory, and requires a user gesture before proof submission. Opening a page or an email preview cannot commit a sign-out. A same-origin, cookie-bound, metered read-only POST exposes only generic pending state before discovery, or the already authorized public review afterward. It never recovers a lost private capability.

Native/account fences, contact changes, key changes, selected-session expiry, operation expiry and proof expiry can invalidate a recovery. Metadata eligibility is an initial preflight, not a promise that every later soft-policy change advances a Native security epoch. The final effect only reduces provider browser authority.

## Limits and failure behavior

Anonymous slots, challenges, work admissions, owner inventory, message size and reserved bytes are finite. Admission and expensive-work charges are not refunded by failed or abandoned attempts. Outside-Native checks use actual caller ownership; a sibling request holding the shared physical database is not treated as this request's lease. Inside checks still require caller ownership, the current adapter, and a physical transaction.

Recovery does not promise availability at absolute database exhaustion. Do not replace finite reservations with unbounded exceptions. Normal writes remain guarded, and expired captured challenges are collected without losing their purpose fence prematurely.

A temporary failure before proof publication may require a new flow. The interface waits when instructed and does not automatically resend a current email operation. A lost response after an explicit sign-out can be checked through its bounded receipt. Ordinary email approval stays opaque: its failure does not disclose whether an account exists or whether a particular quota was reached.

## Before exposure

Keep the opt-in disabled until the complete deployment composition is qualified. Run the engine merge gate, then the relevant Node/Worker and browser profiles with the actual configured ports. Screenshots are optional review artifacts, disabled during ordinary CI. Preserve source/dependency manifests and distinguish synthetic external resources from vendor conformance.

Review [release gates](../release-gates.md), backups and account retention before enabling public registration. This feature neither enables billing nor changes the initial free offering.
