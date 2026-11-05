# Waypo.link implementation ledger

The retired Bindle ledger is preserved in repository history and the private local migration archive. Entries here describe the active Waypo.link composition.

## 2026-11-03 — Waypo.link active project reconciliation

Renamed the hosted repository and directory to waypo.link; retained issuer on the main domain, with login/account/notify subdomains used for outbound email only. Retired the old Bindle app graph, root dependencies/configuration and workflows from the active project. All actual files, dirty tracked patches and status were preserved in an adjacent private migration archive dated 2026-11-03 (not committed). New hosted composition, public documentation/site and generated review artifacts remain in place. Root commands now delegate to the isolated hosted and site packages. No production deployment or billing activation is implied.


## 2026-11-03 — Public docs mounted in hosted runtimes

Public documentation is mounted before Worker environment/auth parsing and before Node request auth handling. Real Worker empty-env docs and real locked Node listener routes passed two focused checks; private fallback responses receive noindex. Hosted engine15 and existing real Node/Worker billing flows2 passed after mounting, including retained cookies and Worker restart. Root reviewed wrappers and included the documentation mount checks in the opt-in hosted E2E command. Node startup still requires valid provider/billing adapter configuration; empty-environment startup is not claimed for Node. No production deployment performed.


## 2026-11-03 — Native Email Sending adapter and private bridge

Hosted composition now installs a private in-process transport from an explicitly configured native EMAIL.send binding, using the public core configuration validator and exact configured user/admin origins. Purpose senders use login/account/notify domains; no public mail endpoint exists and default preview config has no send binding. Core Worker propagates an explicitly marked bounded status profile, preserves legacy successful unmarked JSON transports, and forwards actual delivery readiness separately from configuration placeholders. Suppressed recipients are permanent rejection; account/config/transport outages do not falsely invalidate user contact.

Validation: hosted primary26, leaf/bridge11, actual workerd fixture1 passed. The native provider, SQLite, structured sender mapping, lifecycle statuses, generic login failure and legacy transport were exercised against a mock Email Sending binding. No live email, Cloudflare resource change or mailbox-delivery claim. Public documentation describes the contract and opt-in configuration.


## 2026-11-03 — Guarded email and configured protected actions

The reconciled hosted composition pins core child `2c842d48683beaa1879f41eefb58dd32d485c154`, which passed clean core CI and was merged in `ed854b3`. Core evidence includes 593 primary checks, Node/Worker guarded-email browser gates and the device-return regression. Configured protected actions use fresh action-bound passkeys and foreground app submission; the provider does not proxy application POST effects. Hosted native mail requires guarded initiation plus the private shared durable send budget.

The exact isolated hosted/core pair passed primary31, full runtime6 and documentation25-page checks. External mail and Siteverify ports in relevant fixtures are explicitly fake; signed credential verification and native persistence remain real. These results do not prove live delivery, human detection, commercial readiness or production activation. Final private paired CI remains required before merging this hosted reconciliation. No cloud deployment or live send was performed.


## 2026-11-04 — Hosted billing disclosure candidate (review pending)

Isolated hosted-only candidate retains core pin `2c842d48683beaa1879f41eefb58dd32d485c154`. Billing status separates verified trial expiry, funded time, current period end and scheduled/canceled/unknown renewal. Configured trial availability is not vendor eligibility; checkout determines payment requirements and conversion terms. The $10/year, 10 decimal GB label is explicitly the configured plan and asks the owner to confirm native checkout terms. No next-charge amount/date, card-free trial or successful conversion is inferred.

Storage-full and unfunded guidance retains identity/export paths and directs document deletion to the owning app. No extra-capacity button or metered pricing was added. Session binding is checked around loads/actions; hidden pages clear details, and focus/BFCache returns revalidate. Adapter status rechecks the owner after awaited capacity reads.

Validation: hosted primary 34 checks, including canonical trial expiry/checkout-not-funded/cancellation and owner-race engines plus a simulated DOM execution fixture for trial/full/offer/session-switch behavior. No browser, live Polar, mail or cloud calls; real browser and exact-pair runtime checks remain review-gated. Core consent/commercial-presentation seam remains separate. Decisions and production activation remain unsigned/disabled.


## 2026-11-04 — Terminal billing status correction (review pending)

Preserved the initial frozen five-file candidate and terminal-trial reproduction outside the repository. A `subscription.canceled` event can retain `active`/`trialing` plus `cancel_at_period_end`; terminal native `canceled`/`unpaid` statuses instead normalize to `revoked` with zero paid/trial entitlement. The former future-funded `canceled` fixture described the wrong native status contract and now uses `active` plus the cancellation flag. Past-due snapshots retain only prior admitted funding. Paid tenure, grace, archive and export policies are unchanged. Any old stored terminal projection must be canonically reconciled before activation; this change does not silently migrate existing stored funding.

The pinned SDK's generated customer-state declaration aliases status unexpectedly, but its actual runtime returns parsed response JSON without enum validation. A real `createPolar` intercepted-fetch test accepts complete official-shaped `active` and `trialing` customer state, then exercises the adapter's default SDK path and rejects mismatched owner/organization bindings. No SDK upgrade or live call was needed.

Validation: primary37 includes actual pinned portable policy accountCapacity for fresh terminal trial/no invoice, prior-funded terminal, no-active snapshot, fresh/preserved past-due funding, reordered reconciliation and repeated callback; simulated DOM coverage remains included. Dependencies were independently installed into isolated core/hosted directories, and the pinned auth patch check passed. Browser/Worker validation awaits coordinated review of the new source freeze. Official references: https://polar.sh/docs/api-reference/2026-10/subscription_canceled, https://polar.sh/docs/api-reference/2026-10/subscription_revoked and https://raw.githubusercontent.com/polarsource/polar/main/server/polar/models/subscription.py.


## 2026-11-04 — Hosted trial UX local runtime evidence (review pending)

Renewal is scheduled only for canonical active/trialing rows; terminal, past-due and absent/unknown rows never advertise automatic renewal. Real headless browser checks use native owner cookies and Node SQLite, with vendor HTTP confined to a loopback fixture; Worker checks use intercepted vendor bindings and actual DO SQLite/restart. Explicit enabled trial fixtures verify one decimal GB, period-end cancellation retains only valid current capacity, terminal/no-active state has zero capacity, and full ten-GB presentation offers no fake capacity expansion. Trusted test usage sets ten-GB logical usage without creating physical ten-GB objects. Browser checks also clear private details after owner/session replacement and logout.

Primary37 and complete runtime6 checks pass locally. Seven opt-in screenshots cover desktop/mobile paid status and mobile trial, revoked, full, owner-switch-cleared and logout-cleared views. Source hashes and pinned core/SDK dependencies are checked before/after validation; initial34 and terminal37 review sources remain preserved outside the repository. No live billing, mail delivery or activation evidence is claimed.

A separate read-only checkout reproduction found that reserving an offered trial before a vendor failure leaves later checkout calls eligible for paid fallback. The current UI clears the failed page; a stale second tab can still advertise the old trial. Intent-bound checkout authorization is a separate pending proposal; it has not been implemented or approved by this ledger.


## 2026-11-04 — Explicit checkout offer intent (review pending)

The owner authorized the narrowly bounded stale-trial correction. Checkout now requires literal `trial` or `annual` intent. Trial intent checks configured enablement, canonical subscription binding and uncertain reservation state in the existing transaction; unavailable trial intent returns HTTP409 before SDK checkout and never becomes paid checkout. Annual intent explicitly sends `allow_trial:false`. A failed/uncertain trial reservation remains consumed; no new entitlement follows from checkout redirects.

The UI captures the rendered intent before awaits. On409 it clears the old offer/details/actions and asks the owner to refresh verified billing status. Refreshing only loads the current offer; a separate explicit click is required to request annual checkout. Engine coverage includes stale two-choice/vendor-failure, disabled/canonical-bound trial, malformed intent, annual/trial selection and an owner switch while SDK work is pending. Actual Node browser coverage consumes a trial reservation through a failed intercepted vendor response, then verifies stale CTA409, no extra vendor call, cleared details, explicit refresh and explicit annual choice. Worker HTTP exercises trial409, missing-intent400 and explicit annual selection.

Initial34, terminal37 and pre-intent37/runtime6 source snapshots and screenshots remain preserved outside the repository. New source freeze is independently validated with physical pinned dependencies. No prices, core pin, overage policy, billing activation or production configuration changed.


Final visual review additionally found that clearing data left account-specific disabled button labels behind. Clear now resets renewal and checkout labels to generic defaults; DOM/browser assertions cover hidden, owner-switch and logout label clearing. The eight prior PNGs and source freeze remain preserved outside the repository.


## 2026-11-04 — Readable decimal storage presentation (review pending)

Billing status now formats usage, allowance and remaining space in decimal B/KB/MB/GB/TB (for example, `0 B of 10 GB` and `10 GB remaining`). The plan retains the explicit `10 GB (10,000,000,000 bytes)` basis. DOM/browser checks verify trial one-GB, paid ten-GB and full ten-GB labels. This is display-only; entitlement, meter policy and the core pin are unchanged. The prior PR4 source,41/6 evidence and eight PNGs remain preserved outside the repository.

## 2026-11-04 — Hosted wordmark typography

The owner requested a different Waypo.link branding font. The service wordmark and social artwork now use Manrope, replacing the hand-drawn stroked lettering while preserving the green/coral symbol. The wordmark uses Semibold600; social headings/caption use700/500. SVG glyphs are outlined, so consumers make no font requests and see consistent lettering. The unmodified OFL font, FONTLOG, exact upstream revision/file hashes and regeneration instructions live under brand/typography. Service-owned wordmark/social assets take precedence in hosted branding generation; unchanged icon-only assets and the reference-package pin remain unchanged. Open-source Waypo branding is separate.

Actual static documentation previews pass at1440px desktop and390px mobile before and after, with no horizontal overflow, browser errors or external requests; the hosted wordmark endpoint serves200. The coordinator reviewed both after images. Public-doc checks cover25 pages; full hosted npm test passes41/41 and the focused branding checks pass2/2. Generated documentation changes are limited to four typography artwork routes; the hosted bundle changes only wordmark/social bytes, preserving12 icon-only hashes and all public route names. This is local typography evidence, not production publication or full identity/browser qualification. Evidence is .artifacts/typography.

## 2026-11-04 — Independent OIDC extension documentation

The owner directed removal of the former aggregate service-discovery specification. Public documentation now separates notifications, synchronization, signaling, account selection and action approval into independent optional OIDC metadata extensions. The extension guide is navigation, not a replacement umbrella protocol. The former service-discovery page and its Markdown route are removed, and active aggregate/property/provider-specific well-known discovery references are reconciled. Approval key discovery uses its own advertised purpose JWKS URI inside ordinary OIDC metadata; identity keys cannot be substituted. Destination-hosted notification delegation remains an unselected future consent-proof candidate, not a provider feature declaration or an advertised adapter. Web Push is the implemented transport; LDN remains a separate candidate.

The public room implementation reference is mirrored as Markdown so the signaling extension has a readable local contract link. New pages carry migration-preview scope: the hosted reference-package pin and permanent issuer remain unchanged, production release stays disabled, and new documents do not claim deployed interoperability. Public metadata/application guides retain hosted-only scope/approval corrections. Manrope assets and the economics report are untouched. Final build/check/source guards are recorded separately below; the local guide browser preview covers only static documentation, not an identity/provider flow.

Final documentation checks pass31 pages/79 routes, including all local links, static metadata and HEAD/route boundaries. A source guard confirms49 public documentation/style/asset/generated-route inputs remain byte-identical across docs checks and full hosted npm test41/41. Rendered and Markdown inventories contain no retired aggregate/service-discovery or custom provider approval-discovery contract, and the approval extension includes its required distinct purpose JWKS URI. Actual static guide renders pass at1440px desktop and390px mobile with no overflow, browser errors or external requests; retired guide/Markdown URLs return404. Evidence: .artifacts/oidc-extension-docs. No core pin, billing implementation, branding assets, research report or production deployment changed.

## Initial no-billing hosted composition — 2026-11-05

Owner direction changes initial launch to free identity, configurable approximately half-GB account-wide storage (500,000,000-byte target), and free signaling under abuse protections. Paid/trial/overage work is deferred. The explicit `HOSTED_FREE_CONFIG` path is mutually exclusive with billing configuration; Node accepts the same explicit mode object. It needs no Polar credentials/customer/vendor work and exposes no checkout/billing/webhook surface. It uses the portable strict `freeServices` policy seam and no commercial presentation hook, so core usage/full/export guidance has no funding or purchase copy. The committed preview remains disabled/closed, country list empty and erasure off. The old reviewed core pin remains unchanged: exact current-pair qualification is still a deployment gate, not implied by the adjacent source tests.

Local hosted primary passes44/44 preserving deferred paid tests. Full local hosted integration passes8/8, including the new actual durable Node free account/native email-cookie flow, headless desktop/mobile full-storage UI, and native Worker free policy/session persistence through restart without Polar configuration. The first Worker free test observed503 for an unknown retired static billing URL without ASSETS; explicit free-mode404 refusal now avoids falling through to missing assets and the corrected test passes. Local usage-full setup records500MB through the trusted usage port; it does not claim a500MB physical upload. Two opt-in PNGs were inspected, with no overflow, plan-status text or checkout controls. Global free-account admission/economic circuit breakers, real delivery, current public Worker bootstrap/recovery, PR15 controls, streaming attachments and the remaining release gates are not completed by this slice.

## 2026-11-05 — Public landing and practical documentation

Added a minimal public root landing using the approved service brand, a direct `/login` account CTA, and user/developer/self-hoster documentation paths. The user PWA starts at `/login`; `/account-select` and other provider UI/auth routes remain outside the static public handler. Initial-launch copy specifies free 500 MB account-wide and abuse-guarded signaling, with no billing, and marks availability as development preview. Historical paid/trial lifecycle machinery is explicitly inactive for this launch.

Local evidence: generated 35 documentation pages plus the landing (89 static routes); static links, HEAD, query independence and provider-route boundaries pass. Hosted engine suite passes 44/44. Bounded Chromium probes at 1440px/390px covered landing and getting-started documentation; the approved social card was inspected at 1200×630. No horizontal overflow, browser errors or external requests. Opt-in screenshots and JSON evidence are in `.artifacts/landing-20261105/` and are not public build inputs. Signed-in `/login` and 500 MB account UI were separately verified by the free-mode release agent on actual local Node/Worker fixtures; these static probes do not claim credential or production validation. No deployment or GitHub Actions run was requested.
