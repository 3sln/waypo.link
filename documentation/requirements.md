# Waypo requirements

> **Status:** Development documentation. Production release remains disabled.

Waypo is an independently self-hostable identity project. These requirements define intended scope; they do not establish implementation, production readiness or certification.

## Confirmed product direction

- An open-source, independently self-hostable standards-based OIDC provider and broker, with a provider-neutral SDK and secure user interface components. Use established authentication protocols rather than a new core identity standard.
- Local passkey and email authentication, recovery, contact and device/session management; localhost/native/CLI and cross-device authorization paths. Google/Apple are optional operator-configured upstream methods. Never merge accounts merely because emails match.
- Supported public client-metadata integration should not require each app/provider operator to register clients manually. Account admission remains independent: private self-hosts can keep signup closed while their existing users authorize apps.
- Secure login/user-menu components must keep provider credentials, recovery answers and unrelated provider state outside the embedding app's authority. Provider selection and documented fallback flows remain available.
- Owner-selected component default: offer **Continue with Waypo.link**, leading to its provider-owned login/account-creation flow. This is a patron/hosted-service default, not a protocol requirement. Keep another-provider selection visible and accessible; app developers and self-hosters can replace the default issuer/label through configuration without patching the SDK. An app's known provider/account context takes precedence over a first-use default. Do not contact the default provider merely to render the signed-out button, and do not imply a Waypo.link account is required to use Waypo.
- Optional user-routed notifications, signaling and synchronized app-private user storage. No spaces, memberships, fragment assignments, supplier gateway, integration marketplace or standalone product apps in this product. Keep useful sample/e2e clients.
- Separate user and administration applications, each with its own PWA manifest. The hosted administration origin remains deployment configuration; self-hosters configure a subdomain or subpath. Ordinary verified identities receive granular administrative grants; there is no special owner identity type. Multiple protected policy authorities are supported from inception.
- Bootstrap establishes only a temporary narrowly scoped login. First administrator enrollment is a separate explicit operation. Durable automation uses installation-owned service principals independent of its creator's employment; personal credentials remain user-bound.
- Optional support includes feedback/media/context, private user tickets and replies, staff evidence and scoped enforcement. Self-hosters can disable the module without disabling login, recovery, mandatory notices, export or deletion.
- Use the 3sln frontend stack and portable ngin engines with injected capabilities. Engine tests are merge gates; actual browser/e2e, durable adapter, standards and security evidence are release/deploy gates. A permissive in-memory demo is insufficient.
- End-to-end environments must exercise independent sample apps against multiple providers in a realistic network, for Docker and Cloudflare Workers via GitHub Actions. Headless browser probes validate behavior and UI. Screenshots are opt-in (`--snapshots` or equivalent), off in normal CI, including automatic failure capture. Completion evidence runs enable named screenshots and a report mapping them to flows/outcomes for visual critique; generated artifacts are not source commits.
- E2E evidence must show multiple apps participating across multiple providers/devices, not just independent login smoke tests. Include real authorized cross-provider interactions, same-app cross-device sync, coordinated app flows and cross-app isolation/revocation checks. Report participant app/provider/user/device for snapshots; switching an issuer alone is not federation evidence.

## Open-source deployment boundary

No 3sln account, Cloudflare account, Polar service, commercial plan or hosted approval endpoint is required to self-host. Portable engines own state transitions and authorization; Worker and durable Node adapters own deployment-specific persistence and execution. Operator policy supplies admission, quotas, contact and retention. Plain standards clients can use ordinary OIDC even where optional Waypo capabilities are absent.

New installations default to closed account admission. Every account-materialization path, including upstream login, invitation and import, enforces it. Existing accounts retain login/recovery and app-consent access. A deployment with no configured email must not claim email delivery; private operators may choose an explicit operator-assisted recovery/contact policy with disclosed limitations.

## Hosted Waypo.link policy, separate from OSS

Owner-selected commercial baseline is **$10/year including 10 GB account-wide**, shared across app documents and attachments. Basic identity remains independent of optional paid services. Use Polar native trials with payment details and disclosed automatic conversion. Trial duration/capacity, included sync activity, storage overage prices and collection cadence remain unselected. Signaling is included under operational abuse guards rather than normal per-message charges; TURN needs separate funding. No full-profitability claim follows from storage-only arithmetic.

Carry forward mandatory verified contact before public hosted activation, human check-ins and finite notice/grace/archive/deletion, including forgotten paid subscriptions. First-year human inactivity at two months triggers notice and an ordinary additional month for an authenticated Turnstile-confirmed response. Machine activity is not a human check-in. Paid/additional grace, funded archive limits and exact timing are provisional engineering settings in the lifecycle engine and separate hosted preset; they still need owner review. There is no lifelong retention from an ever-paid flag. A self-hosted anti-abuse adapter need not be Turnstile.

Hosted geographic eligibility and representative obligations remain a launch review, not an approved country list or legal exemption. The owner selected signup-only eligibility, no waitlist, normal access during travel and no location/relocation tracking. Treat country as an ephemeral admission input; retain neither its raw value nor a hash in identity, audit or application telemetry. Payment-provider acceptance does not establish our legal eligibility.

## Engineering choices still provisional

The reference implementation selects pinned Better Auth OIDC/WebAuthn components, Yjs structural documents, portable ngin engines and Dodo UI. Their versions, compatibility patch and evidence are recorded in implementation documentation and package manifests. General service discovery has a tested reference profile; independent public-provider conformance is separate. Bootstrap/quorum timings and permission defaults are implemented engineering choices pending owner review, rather than unselected components or owner-approved protocol constants. Trial/overage policy and production erasure guarantees still require explicit decisions and evidence. Existing standards encodings apply at their endpoints: JSON/JWT/JWS/form, not a proprietary general RPC. Notification/discovery/signaling contracts start bounded JSON. CRDT data uses its selected engine's versioned binary format; attachments are raw bytes. WebAuthn CBOR/COSE parsing belongs to the maintained authenticator library.

## Required implementation order and evidence

1. Select maintained provider components against Workers/Node, licensing, key/session lifecycle, public client metadata and conformance needs. Establish real import boundaries and ngin engines before copying historical controllers.
2. Build a durable discovery → authenticator setup/login → code+PKCE → verified token/UserInfo → logout/revocation slice, used by an unfamiliar sample app. Admission/contact/recovery cannot become permanent bypasses for a demo.
3. Exercise hostile issuer/client/subject/callback binding, code replay, session revocation, closed enrollment and restart/crash behavior in engine/adapter tests. Engine tests gate every merge for implemented paths.
4. Before release/deploy, verify real browser/virtual-authenticator login, actual callback exchange, self-host setup, persistence/restart, private component boundaries, recovery/contact and supported cross-device flows. Verify each optional module separately before advertising it. Configured keys and screenshots are not delivery/conformance evidence.

See [architecture](design/architecture.md), [administration](design/administration.md), [state lifecycle](design/state-lifecycle.md) and [support](design/support.md). These documents state requirements and candidate mechanisms, not completed capabilities. Further mechanism changes need a dated decision/evidence record; owner-selected requirements must be identified explicitly when reconsidered.
