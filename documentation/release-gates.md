# Release and deployment gates

> **Status:** Development documentation. Production release remains disabled.

Production release is disabled. The readiness command deliberately fails; engine tests passing do not authorize publication or deployment. No publish/deploy workflow or production credentials are included.

Required before an identity release:

- Real maintained WebAuthn/email verification; OIDC/OAuth library selection, issuer/client/redirect/PKCE/audience checks and independent conformance evidence. No simulated credentials in the production path.
- Durable Node and Worker adapters satisfying atomicity, replay prevention, restart safety, revocation and bounded work. Test-only stores do not satisfy this gate.
- Temporary bootstrap, separate explicit administrator enrollment, protected grant policies and recovery verified end to end. Public first-user takeover is prohibited.
- Separate admin/user PWA manifests, correct paths/origins, provider-owned UI, real browser passkey verification and storage/session behavior. No browser implementation is implied by core tests.
- Required recovery/contact and bounded inactivity/abuse policies, actual notification delivery evidence and race-safe deletion/export. Self-host deployment policy is explicit.
- Optional services ship only after scoped authorization, isolation, quotas, crash-safe persistence and garbage collection are proven. Attachment/media scanning, CRDT compaction and background access cannot be inferred from a configured key.
- Hosted launch separately requires selected regional eligibility/legal review, pricing/billing lifecycle verification, operational budgets and operator approval. Polar merchant-of-record service does not discharge all operator obligations.

Engine tests are the merge gate. Browser E2E runs before release/deploy, using real deployment adapters and virtual authenticators where appropriate. Focused DOM/browser checks accompany browser changes; standard conformance checks cover claims engines and E2E cannot establish. Record environment limitations and distinguish local evidence from production verification.

