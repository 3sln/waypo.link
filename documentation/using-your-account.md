# Manage your account

Open [your account](/login) to sign in or return to the account interface. Optional features and controls depend on the provider and the app you are using.

## Connected apps and permissions

Review an app's requested permissions before connecting it. Use provider-supported revocation controls when available, and sign out of apps you no longer use. Revocation prevents future authorized service access; it cannot erase information an app has already downloaded. Each app's synchronized storage is isolated from other apps unless a separate supported sharing mechanism explicitly authorizes access.

## Storage

At initial hosted launch, your free allowance is **500 MB shared across app documents and attachments**. It is an account allowance, not 500 MB for every app. Large files belong in attachments rather than inside synchronized documents.

If storage is full, existing data remains readable, but writes may be rejected. Remove unneeded data through the app or use its export tools. The account interface can surface storage pressure; there is no paid upgrade at initial launch. Deleting an app's data and disconnecting an app are different actions: check the confirmation before proceeding.

## Notifications and devices

Apps can send messages only with the relevant authorization. Review notification and device preferences, especially before enabling lock-screen previews. A message may stay in Waypo activity or link to the sending app. Sensitive actions can require fresh passkey approval.

Connection setup does not relay the actual file or media stream. Your app and network determine whether a direct connection succeeds. A device being listed or signed in does not itself authorize remote control.

## Offline use

An app that already has local data can continue using a saved account identity offline. The account chooser can select previously saved accounts when its offline shell has been installed. A saved identity is not proof that remote permissions are still valid. Sync, notification delivery, new authentication, and connection setup need network access; apps must revalidate authority when they reconnect.

## Recovery and account notices

Keep your contact channel working and store any recovery file somewhere safe outside the device you are recovering. Follow the provider's recovery instructions. Security-question answers are not strong cryptographic secrets; do not treat a recovery file as harmless merely because it is encrypted.

Free accounts are subject to inactivity checks, notices, and grace periods. Respond to legitimate account notices through the provider rather than sharing sign-in links or credentials with someone claiming to be support. The [lifecycle reference](implementation/account-lifecycle.md) explains the implemented policy mechanisms and verification limits.
