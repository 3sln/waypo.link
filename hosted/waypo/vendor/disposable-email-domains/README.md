# Hosted new-account email policy data

This CC0-1.0 community dataset is used only by Waypo.link composition. The portable Waypo provider does not ship it or restrict disposable domains. Source commit, raw SHA-256, retrieval time and active Mail.tm aliases are recorded in `domains.mjs`; the upstream license is reproduced alongside it.

Sources: [upstream list and maintenance policy](https://github.com/disposable-email-domains/disposable-email-domains), [Mail.tm domains API](https://docs.mail.tm/api/domains). A read-only API lookup at implementation time returned `fldubai.com` as active/public. `mail.tm` is blocked explicitly as requested. Coverage is never complete: providers rotate aliases, community data can become stale, and custom domains exist.

A maintained local bundle avoids sending addresses or domains to outside services and keeps signup independent of network lookups. After reviewing a source commit, run from `hosted/waypo`:

```
node scripts/update-disposable-email-domains.mjs --commit=<40-character-reviewed-commit>
node scripts/update-disposable-email-domains.mjs --commit=<40-character-reviewed-commit> --write
```

Review the diff and license, run the signup-policy and actual adapter tests, then deploy normally. The updater has finite source/response/page bounds; it never runs in the server or at signup. `HOSTED_FREE_CONFIG.emailSignupPolicy` (or billing settings) accepts `{revision, allowDomains, denyDomains}` with at most 256 domains in each list. Rules match a domain and its subdomains, most-specific explicit override first; conflicting identical rules are rejected. Explicit rules precede the privacy-alias safeguard and bundled deny rules. Revision is operator-maintained; settings changes take effect when the configured installation is reloaded.

Stable privacy forwarding services are allowed by default, including Apple Hide My Email, Mozilla Relay, Duck, Addy and SimpleLogin. References: [Apple](https://support.apple.com/en-gb/105078), [Mozilla](https://relay.firefox.com/faq/), [Duck](https://duckduckgo.com/duckduckgo-help-pages/email-protection/duck-addresses/how-do-i-get-an-address), [Addy](https://addy.io/help/what-are-the-different-kinds-of-aliases/), [SimpleLogin](https://simplelogin.io/docs/directory/new/). Operators can correct false positives through allow overrides without modifying users.

The restriction applies only when Native actually creates a new email identity, after ownership proof, including invited accounts. Existing accounts can still sign in or refresh; there is no retroactive deletion. Trusted, server-validated passkey-only enrollment does not invent an email requirement. Private operator bootstrap credentials do not themselves create an email identity. No browser `existing` flag or claimed synthetic address bypasses this check. Denials use a fixed message and do not log an address.
