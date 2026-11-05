# Get started with Waypo.link

Waypo.link is an account you can use in apps that support it. You choose which apps to connect and what optional services they can use.

> Development preview: availability may be limited while public launch checks are completed. The initial plan is free, with 500 MB of account-wide storage and abuse-guarded signaling. No payment is required for this initial offering.

## Create or open your account

Open [your account](/login). Follow the available email-link or passkey sign-in flow. Account creation requires a usable contact channel; which enrollment methods are available depends on provider configuration. Keep access to your verified email and add a passkey when offered.

A passkey uses your device or password manager to approve sign-in. An email link is a sign-in credential: open it yourself and do not forward it. Waypo does not ask you to choose a reusable account password.

## Connect an app

In a supporting app, choose **Continue with Waypo.link**, or choose a provider and enter `https://waypo.link/api/auth` if the app asks for an issuer. The app sends you to the provider to sign in and review requested access. Check the app identity and requested permissions before approving.

Signing in does not automatically give an app every optional capability. An app may separately request notifications, synchronized app data, or connection setup. Decline access you do not want to grant; the app decides how it behaves without it.

## Return on another device

Sign in to the same provider account on the second device. Apps that use synchronized storage can then retrieve their saved state. Some apps also offer their own device pairing or transfer experience. Waypo supplies authentication and connection primitives; it does not make every app support transfers or remote control.

Continue with [account management](using-your-account.md) for storage, recovery, and disconnected use.
