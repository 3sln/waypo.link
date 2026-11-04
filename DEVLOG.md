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
