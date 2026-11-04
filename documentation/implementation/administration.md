# Administration engine and current evidence

> **Status:** Development documentation. Production release remains disabled.

2026-11-02. Production release remains disabled. The portable administration
engine has local engine evidence; real browser workflows, deployment recovery and
independent security review remain separate gates.

`packages/administration/index.mjs` uses the real vendored ngin Engine, Action,
Query and Provider APIs. Injected ports supply the shared transactional store,
canonical issuer/admin audience configuration, clock, cryptography and randomness.
Initial governance imports only the explicit verified handoff record named by
`BOOTSTRAP_KEYS.initialAuthority` while the installation marker is initialized.
Missing state fails closed. Ordinary identities receive grants; protected policy
authority membership is an attribute of those identities, not a special owner.

The candidate quorum is one founder, both of two authorities, then strict majority
with minimum two. This implements a provisional mechanism, not owner approval of
final numerical policy. Membership changes, delegation changes, protected grants
and protected offboarding require exact expiring revision-bound proposals approved
by distinct current authorities. Governance changes invalidate pending proposals
and operation proofs. There is no universal administrator or recovery bypass.

Every mutation creates an exact validated operation bound to actor, session digest,
governance revision and a two-minute absolute deadline. `ReadOperationQuery`
exposes review context only to its current actor and original session. A trusted
in-process verifier port records an actual user-verified authenticator assertion
for that operation. It is absent from engine actions and credential-accessible
APIs. Execution rechecks live authority and consumes proof atomically. HTTP
adapters must establish issuer, subject and the administration session themselves;
caller-supplied identity fields cannot establish this authority.

Delegated staff management checks capability/resource scope, explicit delegation
ceiling and subordinate relationship. Delegates cannot offboard themselves, peers
or policy authorities. Staff invitations bind an exact verified identity subject,
issuer, grants and deadline. Purpose-bound verified acceptance rechecks issuer
permissions and consumes a digest-only secret once. These invitations grant staff
access to existing identities. Separately, `account.invite` creates bounded, exact
email-bound enrollment invitations after a verified operation. A trusted consume
port checks current issuing authority inside the admission caller's existing store
transaction. This admits an ordinary new account without staff grants. The old
unbound direct invitation write remains disabled.

Services belong to the installation. Creator identity is immutable audit data;
creator departure does not invalidate service credentials. Authorized managers can
reassign maintainers. Personal credentials remain bound to current user grants
and enabled status. Opaque credentials have digest-only storage, at most thirty
days expiry and secret delivery only upon issuance/rotation. Effective authority
intersects fixed credential scopes, current principal grants and current deployment
`automationScopes`. The fixed action catalogue excludes credential minting,
policy editing, recovery, authenticator establishment and impersonation. Rotation
revokes the previous credential. Principal disablement fences credentials live.

Principals, invitations, operations, proposals, credentials, scopes and audit have
explicit bounds. Bounded reads prune expired/consumed invitation, operation,
proposal and credential records. Audit includes actor, operation, proof time,
exact-payload hash, target and proposal reference; no credential/session secret.
Serialized state stays below the shared store's 256 KiB limit.

`GuardIdentityMutationQuery` denies independent account/recovery/authenticator
mutations for protected identities. The protected `identity.change` proposal
supports exact self-service passkey addition/removal, contact change and recovery
policy change. After quorum it issues a two-minute one-use permit bound to the
target identity, original proposing session, change, exact target and governance
revision. The trusted verifier consumes it before the library persists a verified
credential or applies the exact mutation. Burning a permit on a later library
failure is fail-closed; it is not a successful mutation acknowledgement. Adapters
must enforce this at every independent plugin route. Remote account recovery has separate implementation and integration gates. Deployment deadlock recovery now has a portable, disabled-until-configured engine; its actual HTTP/UV workflow remains a separate gate.

`tests/engine/administration.test.mjs` covers explicit handoff import, issuer,
audience and session binding, fresh one-use proofs, distinct quorum, stale
revisions, proposal expiry, delegated offboarding, existing-session denial,
service creator continuity, fixed scopes, rotation/revocation, personal demotion,
resource boundaries, deployment restrictions, invitation binding/expiry/revocation,
issuer offboarding/delegation reduction, failed commit and concurrent execution.
The injected test store and trusted verification fixture are not claimed as real
WebAuthn or durable runtime evidence. HTTP/browser and durable tests are separate.

`tests/engine/administration-adapters.test.mjs` separately closes/reopens actual
Node SQLite and every administration engine between protected proposal creation,
approval, consumed-proof replay and credential revocation. Its handoff/verifier
fixtures are explicitly trusted test inputs, not fake authenticator evidence.

Deployment authority repair is an explicit out-of-band operator approval, never
a setup reset. It pins a P-256 browser-key fingerprint, increasing one-use
generation, maximum one-hour deadline, exact governance revision, exact new
authority subjects and reason. An existing authenticated candidate must possess
that browser key and then complete fresh actual UV in the same original session.
Every target must remain an actual eligible identity at commit; suspended or
terminal candidates are refused. Repair disables excluded former authorities,
clears stale proposals, invitations, personal credentials and purpose permits,
and writes a bounded audit entry in
the same transaction as consumed generation. Installation-owned services remain
independent. Missing governance or initialized markers fail closed; bootstrap
markers are never rewritten. The current slice requires an existing identity
with a working UV authenticator, and does not claim all-identities-lost enrollment.

All-identities-lost recovery uses two explicit operator stages. A distinct
`deployment-enrollment` approval pins the initialized installation/current
revision and a browser P-256 key. Real possession proof issues at most one
10-minute ordinary-enrollment lease, bound once to the exact native subject and
reservation. The native enrollment helper must still verify a fresh real UV
credential. That lease grants no administration or normal OAuth authority by
itself and never rewrites bootstrap state. A second operator approval then names
the actual enrolled subject and exact current revision for the separate UV-bound
authority repair. Engine/trusted-port tests and independent review pass; the
combined actual browser/native enrollment-to-repair workflow is an integration
gate, not established by those unit tests.

Both operator approval objects are immutable deployment material. Once a
generation is observed, a changed fingerprint, deadline, target set, reason or
serialization binding requires a new higher generation. Same-generation
reformatting/reordering is deliberately not a renewal mechanism. Issued leases
and signed proofs are scoped to their separate purposes, original audience and
one-use generations; there is no universal recovery credential.
