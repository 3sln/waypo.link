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
