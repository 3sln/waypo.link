# Legal documents

Status: drafts, 2026-10-21. Not in effect. Not legal advice; counsel review required before publication. Legal/product reviewer: ___ Date: ___ Outcome: ___

- [privacy.md](privacy.md) — Privacy Policy for the hosted 3sln.me service.
- [terms.md](terms.md) — Terms of Service for the hosted 3sln.me service.

Both cover only the operator-hosted service. Self-hosters and other Bindle providers need their own documents; the open-source license is separate.

The drafts describe the as-built system as of commit f6d3820 plus features behind default-off flags, written as "if you use" / "when available". Any change to data handling (new processor, retention, flag switched on with new data flows) must update these documents and bump `TERMS_VERSION`.

## Placeholders to fill

Operator filled 2026-10-22: Stubbs Software Solutions LLC, doing business as 3sln, 41 West Highway 14 #1645, Spearfish, SD 57783, United States. Governing law: South Dakota (user, 2026-10-22); venue: South Dakota state or federal courts; refunds: discretionary, on request (user, 2026-10-22). Remaining: `[EU REPRESENTATIVE]`, `[UK REPRESENTATIVE]` (GDPR Art. 27 / UK GDPR Art. 27 representatives are required if the company has no EU/UK establishment and offers the service there).

## Commitments the drafts make that the system does not meet yet

Publication is blocked until each is built, handled manually with a documented procedure, or removed from the text.

| Commitment | Where | Current state |
|---|---|---|
| Account deletion on request | Privacy §8–9, Terms §10 | Implemented behind `ACCOUNT_DELETION_ENABLED` (off): self-serve with 14/30-day grace and admin-assisted. Enabling is blocked on R1-M12 (BindleBox data on deletion) and the Polar sandbox check. |
| Data export on request; export before closure and over-quota removal | Privacy §9, Terms §7, §10 | Implemented behind `ACCOUNT_EXPORT_ENABLED` (off), including closure-window export sessions. The over-quota hook (DX-9) is pending. Device grants and S3/WebDAV mappings are not exported yet. |
| Removing a confirmed email (erasure) | Privacy §9 | Implemented behind `EMAIL_REMOVAL_ENABLED` (off). A waiver is required when no other notice channel remains. |
| Age confirmation by country, region blocking | Privacy §3, §10; Terms §2 | Implemented locally with trusted-location age attestation and separate, reversible EU/EEA/UK launch blocks for representative obligations; blocked locations receive USD-only billing selection. Production verification and counsel approval remain pending. Research: [age research](../release/age-requirements.md), [representative spike](../release/eu-uk-representative-spike.md). |
| Re-acceptance of new terms at next sign-in | Terms §12 | `termsVersion` is recorded at signup only; no re-acceptance flow. |
| Policies linked from signup, landing and console footers, OAuth/client metadata | — | Only an in-app summary dialog at signup (`apps/web/src/ui/release-dialogs.mjs`). No `/privacy` or `/terms` pages, no `policy_uri`/`tos_uri`. |
| 30-day notice before removing over-quota data | Terms §7 | Design only (D092); live behaviour never removes data. Consistent, but must stay true. |
| Inactive-account notices before deletion | Privacy §8, Terms §9 | Lifecycle executor flag-off; notices require provider-accepted attempts when enabled. |
| contact@3sln.com receives privacy/legal/security mail | All | Operator mailbox; confirm it's monitored. Consider dedicated aliases later. |
| Feature rollout assignment from account ID/region, aggregate-only experiments | Privacy §3, Terms §8 | Depends on [feature flags design](../architecture/feature-flags.md); experiment recording must stay aggregate. |

## Facts to verify before publication

- Cloudflare Workers AI does not train on customer content (cite current Cloudflare terms).
- Polar's role (merchant of record or payment processor) and its privacy policy link.
- Cloudflare DPA and Polar DPA executed; transfer mechanism (SCCs/DPF) per provider.
- Cloudflare platform log retention for request logs (Workers Observability is off; edge logs unknown).
- Dashboard-only variables/secrets (`keep_vars: true`) do not enable data flows the drafts omit (Google Drive, admin mount, multi-account vault).
- UK Online Safety Act children's access and risk assessments completed; Australian eSafety self-assessment recorded.
- Refund rules for EU/UK consumers (14-day withdrawal right for digital services unless waived at checkout).
