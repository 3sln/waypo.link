# Trouble signing in?

A provider can limit how many browsers stay signed in. If you cannot sign in, open the provider's [sign-in page](/login) and expand **Trouble signing in?**. When enabled, browser recovery lets you review an old browser and sign it out. It does not sign you in automatically.

**Connected apps stay connected.** Signing an old browser out of the provider does not revoke its app sessions or erase downloaded data. If a device was lost or stolen, review connected apps after signing in as well.

## With a passkey

Choose **Verify identity and list browsers**, use your passkey, and review the browser label and dates. Select the exact browser, review the consequences, then confirm with your passkey again. Sign in separately afterward.

## With a verified email

Choose **Use email to review signed-in browsers**. This requires an email address already verified on the account; it cannot create an account or change its email address.

1. Enter your email and complete the verification check before requesting a browser-review email.
2. Open the link **in the browser where you started**. If your email app opens a different browser, copy the private link into the original browser. Do not share it.
3. Select **Verify email and show browsers**. Opening the email alone does not verify it or change access.
4. Review the browser labels and dates, then choose the exact browser to sign out. Labels are hints, not a guarantee of a device's physical identity.
5. Complete the check and request a second email for that specific browser.
6. Open the second link in the same browser. Review the exact browser again, then select **Confirm and sign this browser out**. No action happens merely because the link was opened.
7. Return to sign in normally. The provider may need a moment to finish reclaiming the old browser's session capacity.

The email steps do not add a passkey, grant administrator access, or give a connected app new permissions. Other signed-in provider browsers are unaffected.

## If it cannot continue

An expired link, cleared browser cookies, or an account-security change can end a recovery. Start a new attempt rather than reusing an old link. If the provider is temporarily busy or limits requests, wait before trying again; the interface does not silently resend emails or repeat confirmations.

Keep the original browser open. A new tab in that browser can review the selected browser, but another browser does not inherit the private recovery cookies. An unresolved confirmation can be checked without automatically repeating the sign-out.

These controls require a network connection. Apps with saved identities and local data may still work offline, but recovery cannot refresh remote permissions offline. Administrator identities, accounts being closed, and other protected cases may require the provider's separate recovery process.

Browser recovery is optional and remains subject to release and deployment checks. If the controls are absent, ask your provider which recovery methods it supports. Operators can read the [implementation and configuration guide](implementation/browser-recovery.md).
