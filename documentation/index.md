# A place to start

Waypo.link gives supporting apps a shared sign-in and optional app storage, notifications, and direct device connection setup. **Waypo** is the open-source project behind the separately operated **Waypo.link** service.

> Development preview: public launch checks are still in progress. These guides describe the intended initial free offering and locally implemented capabilities, not a production-readiness guarantee. Technical extension documents remain provisional.

## Use your account

[Get started](get-started.md) explains signing in and connecting an app. [Manage your account](using-your-account.md) covers app permissions, storage, recovery, and offline use.

The initial hosted plan is free, with **500 MB shared across connected apps**. Signaling is free under abuse safeguards. There is no billing at initial launch.

## Build an app

Start with the [developer introduction](developers/get-started.md), then use the detailed [application integration guide](implementation/app-integration.md). Sign-in uses OpenID Connect; notifications, sync, signaling, account selection, and action approval are [independent optional extensions](design/oidc-extensions.md).

## Run your own provider

Read the [self-hosting overview](self-hosting.md) before the [installation guide](implementation/self-hosting.md). You can operate a private provider without public registration, a Waypo.link account, Cloudflare, or a billing vendor.

## Find the technical detail

- [Architecture and boundaries](design/architecture.md)
- [Synchronized state semantics](design/sync-semantics.md)
- [Offline accounts](design/offline-accounts.md)
- [Notifications and protected actions](design/notifications.md)
- [Implementation and verification status](implementation/plan.md)
- [Release gates](release-gates.md)
- [Requirements](requirements.md)

The permanent hosted issuer is `https://waypo.link/api/auth`. The `login.waypo.link`, `account.waypo.link`, and `notify.waypo.link` domains send email; they are not separate sign-in websites. An app must verify the exact provider issuer, never infer trust from a logo.

Every page has a downloadable Markdown copy and a source link. The [hosted site repository](https://github.com/3sln/waypo.link) and [open-source provider](https://github.com/3sln/waypo) are separate projects.
