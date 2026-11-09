# Run your own Waypo provider

Waypo is the open-source provider behind Waypo.link. A private installation can serve your own accounts without opening registration to the public. Optional services and hosted-service billing are separate concerns.

> The reference implementation is under development. Complete the documented release gates before exposing a deployment to untrusted traffic. A successful local example is not a production-readiness guarantee.

## What you operate

You supply a stable HTTPS origin, provider configuration, durable database and private file storage, backups, and a way to deliver required account messages. Passkeys and OIDC callbacks are bound to deployment identity: choose the public origin deliberately before enrolling real users.

The Node adapter can keep app objects in a private directory on your own disk; no separate object-storage service is required. The Node adapter supports durable self-hosting. Cloudflare is another deployment option, not a prerequisite. Use Node 24 for the currently tested reference installation. Start with the exact commands and configuration in the [installation guide](implementation/self-hosting.md), and review the [durable adapter constraints](implementation/durable-adapters.md).

## Keep registration private

Disable public signup when you do not need it. Setup begins with the browser you intend to use. It shows a fingerprint that you approve through your private deployment configuration. Keep that same browser open: it must prove it still holds the matching private key. This opens a temporary setup session, not a permanent administrator account. The deployment approval lasts at most an hour; the setup session lasts at most fifteen minutes and can expire sooner. You then create or sign in to an ordinary account, verify its passkey, and explicitly accept administrative authority. The detailed guide includes a command that selects a fresh approval generation and expiry safely. Create the intended accounts or invitations and grant only the administrative permissions each operator needs. See [administration](implementation/administration.md) for bootstrap and grant details.

Keep the administrative app separate from the ordinary account experience. Protect deployment secrets and automation tokens independently of browser login. Plan how to revoke an operator and recover the installation before you need to do either.

## If setup expires or access is lost

If initial setup expires before you finish, issue a newer approval for the intended browser using the installation guide. Once setup is completed, its approval is permanently consumed: restarting or copying the old fingerprint cannot reopen it.

Recovery is a separate, deliberate operator process. Keep your databases, private files, and encryption keys. Do not reset the installation. If no usable account remains, first approve enrollment of a replacement ordinary account; then separately approve exactly which accounts may restore administrative authority. The same approved browser must continue proving possession, and the candidate must verify its passkey and explicitly accept. Ordinary enrollment alone grants no administrative access.

Use the [step-by-step installation and recovery reference](implementation/self-hosting.md) for exact commands, deadlines, and configuration shapes. Local Node and Worker browser tests cover browser-key possession and native-session handoff. Keep using the approved browser: its temporary cookie alone cannot complete setup. Signing out before the server accepts the authority handoff stops it; a handoff already accepted may finish after a later sign-out. Use **Restart authority verification** if you need to sign in and verify the passkey again. Production restoration and broader security checks remain open. This is not a completed security-audit claim.

## Keep a public installation affordable

If you open registration, set both a maximum number of retained accounts and a limit on how quickly new accounts can be attempted. The first prevents unlimited accumulation; the second slows bursts before account creation. Existing users can still sign in when new registration is paused or full. A paid-to-free transition does not create another account.

These controls do not cover every charge: requests, messages, storage, and background work need their own budgets and emergency shutdown plan. Start closed until those controls are configured. Operators can read the separate [account-capacity reference](implementation/account-admission.md) and [creation-rate reference](implementation/account-creation-rate.md). Rate controls require Node 22.16 or later; Node 24 is recommended.

## Decide which services to enable

Start with identity. Enable notifications, sync, signaling, and support only when you can operate them and understand their resource limits. Advertise only the independent extensions your deployment actually supports. Apps should tolerate absent optional capabilities.

Your admission policy, quotas, contact requirements, and retention policy are operator decisions. Waypo.link's initial free 500 MB plan is not a protocol requirement. No Waypo.link account or billing vendor is required to run your provider.

## Before real users depend on it

Exercise backup restoration, account recovery, permission revocation, storage pressure, and notification delivery in your actual environment. Monitor abuse and capacity without retaining unnecessary user data. Review [release gates](release-gates.md) and the [implementation map](implementation/plan.md) for unresolved limits and evidence boundaries.

## Documentation version

This overview includes source-development controls from Waypo `f916cac`. The hosted source pin selects this revision for locally qualified integration; this does not mean the service is deployed. Consult the implementation reference before assuming a control is available in an older checkout or hosted deployment.
