# Optional support and evidence-backed casework

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

Owner requirements, 2026-11-02: abuse-guarded feedback with text/media/app context, user tickets and conversation, staff evidence/commentary and scoped enforcement; disableable for self-hosting. This is implementation functionality, not mandatory OIDC protocol. All mechanisms/limits below are provisional and unimplemented. See [administration](administration.md) and [state lifecycle](state-lifecycle.md).

Disabled support allocates no mandatory support store/jobs and denies intake/upload APIs as well as hiding UI. Login, recovery, mandatory notices/export/deletion remain independent. Existing tickets require a distinct read-only wind-down/export/deadline before retirement; disabling intake does not silently erase or eternally retain records.

User flow: provider menu → category/description → optional bounded image/video → editable preview of allowlisted app/version/platform context → submit → private ticket/conversation. No automatic page capture, secret-bearing URLs, tokens, storage or unrelated app data. Treat app-proposed context as untrusted. Explicit capture permission/file selection; no background recording. Notifications contain minimal hints, not private evidence.

Authenticated admission enforces durable per-user and deployment reservations, ticket/message/media/age/work budgets and bounded escalation through an operator-configured anti-abuse adapter. Support uploads have a separate capped allowance, not unlimited free storage or silent charges to ordinary storage. Suspicious users retain a small bounded text-only appeal/report path where policy allows.

Stage media privately, expire unfinished uploads, validate actual size/type, quarantine and isolate retrieval/downloads; never execute HTML/SVG or fetch arbitrary URLs. Previews/transcodes count toward budgets. Every media retrieval checks ticket/evidence authority. Cleanup covers staging, quarantine, derived copies and closed/deleted tickets.

Staff have distinct scoped powers for conversation, private notes, evidence, intake restriction, suspension, archive, deletion and appeals. User APIs/notifications must never return private staff notes/evidence accidentally. A support agent has no implied access to documents, credentials or other cases. Enforcement previews target/effects and records actor, reason, case, policy/grant revision and outcome. Corrections append rather than rewrite history.

Deletion requires high-risk authority, fresh verification and applicable lifecycle safeguards; account deletion does not accidentally delete separately justified evidence. Evidence still has finite reviewed retention and access audit. Enforce protected-policy-authority/quorum rules against indirect takeover by ban/recovery/deletion. Human suspension must not destroy installation-owned service principals or unrelated automation; compromise review is explicit.

Engine merge gates: disabled behavior, wind-down, ticket/user isolation, public/private note separation, upload budgets/cleanup, delegated roles, protected-authority bypass, appeals and concurrent idempotent actions. Release browser/e2e gates: reviewed-context submission/media, staff reply/user follow-up, private-note non-disclosure, restricted-user appeal and disabled UI/API. Actual adapter scanning/isolation/cleanup evidence precedes deployment claims.
