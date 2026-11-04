# Identity that leaves room to choose

**Waypo** is the open source identity project and configurable reference provider. **Waypo.link** is the separately operated hosted service. Hosting policy and billing are service concerns, not requirements for running Waypo yourself.

> **Development status:** Production release is disabled. These documents describe current local behavior and clearly marked design proposals, not a live commercial offering.

## Start building

- [Application integration](implementation/app-integration.md): issuer binding, browser sessions and optional services.
- [Independent optional OIDC extensions](design/oidc-extensions.md): separate notification, synchronization, signaling, account-selection and action-approval contracts.
- [Private self-hosting](implementation/self-hosting.md): evaluate the Node provider without a Waypo.link, Cloudflare or billing account.
- [Architecture](design/architecture.md): protocol, implementation and hosting boundaries.
- [Implementation map](implementation/plan.md) and [release gates](release-gates.md): what is verified and what remains open.
- [Requirements](requirements.md): the intended product and interoperability scope.
- [Synchronized state semantics](design/sync-semantics.md): the generic SDK, compatibility profiles and migration rules.
- [Offline accounts](design/offline-accounts.md): saved identity selection and safe reconnection.
- [Notifications and protected actions](design/notifications.md): privacy, rich messages, deadlines and interoperable approvals.
- [Hosted email](implementation/hosted-email.md): sender domains, private binding and delivery evidence limits.

## Hosted service identity

The permanent hosted web issuer is `https://waypo.link/api/auth`. Public documentation lives at `https://waypo.link/docs`. `login.waypo.link`, `account.waypo.link`, and `notify.waypo.link` are email sending domains for login links, security and account notices, and notifications respectively; they are not separate web origins.

Self-hosted providers configure their own issuer and branding. Applications must compare the exact trusted issuer; a shared logo or name is never proof of authority.

## Read the source

Every page has a source link and a downloadable Markdown copy. The public site sources live in the [Waypo.link repository](https://github.com/3sln/waypo.link). Protocol extensions remain provisional unless a page explicitly states otherwise.
