# Run your own Waypo provider

Waypo is the open-source provider behind Waypo.link. A private installation can serve your own accounts without opening registration to the public. Optional services and hosted-service billing are separate concerns.

> The reference implementation is under development. Complete the documented release gates before exposing a deployment to untrusted traffic. A successful local example is not a production-readiness guarantee.

## What you operate

You supply a stable HTTPS origin, provider configuration, durable database and object storage, backups, and a way to deliver required account messages. Passkeys and OIDC callbacks are bound to deployment identity: choose the public origin deliberately before enrolling real users.

The Node adapter supports durable self-hosting. Cloudflare is another deployment option, not a prerequisite. Use Node 24 for the currently tested reference installation. Start with the exact commands and configuration in the [installation guide](implementation/self-hosting.md), and review the [durable adapter constraints](implementation/durable-adapters.md).

## Keep registration private

Disable public signup when you do not need it. Deployment-controlled, expiring bootstrap access establishes initial administration; it is not a permanent administrator credential. Create the intended accounts or invitations and grant only the administrative permissions each operator needs. See [administration](implementation/administration.md) for bootstrap and grant details.

Keep the administrative app separate from the ordinary account experience. Protect deployment secrets and automation tokens independently of browser login. Plan how to revoke an operator and recover the installation before you need to do either.

## Decide which services to enable

Start with identity. Enable notifications, sync, signaling, and support only when you can operate them and understand their resource limits. Advertise only the independent extensions your deployment actually supports. Apps should tolerate absent optional capabilities.

Your admission policy, quotas, contact requirements, and retention policy are operator decisions. Waypo.link's initial free 500 MB plan is not a protocol requirement. No Waypo.link account or billing vendor is required to run your provider.

## Before real users depend on it

Exercise backup restoration, account recovery, permission revocation, storage pressure, and notification delivery in your actual environment. Monitor abuse and capacity without retaining unnecessary user data. Review [release gates](release-gates.md) and the [implementation map](implementation/plan.md) for unresolved limits and evidence boundaries.
