# 3sln.me Waypo composition

This isolated package composes Waypo's public Node/Worker, policy and SQLite
ports. It imports no historical Bindle app graph and changes no legacy app,
migration, environment file or package. Production release remains disabled.

The 3sln.me personal plan is $10 yearly with 10 decimal GB of account-wide
storage. Prices and configured Polar products live here, never in the OSS policy
engine. Basic identity and independently self-hosted Waypo need neither this
package nor a Polar account. Trial capacity is a provisional 30-day/1-GB candidate
and defaults off. Overages remain disabled; see the two unresolved cap/renewal
alternatives in `RESEARCH.md`.

`worker.mjs` exports the branded `HostedInstallation` Durable Object and normal
Worker entry. `wrangler.jsonc` has no public routes/workers.dev/previews, and its
preview flag is false. It binds native SQLite, private R2 and Waypo's generated
public assets. Configure the provider JSON and a separate `HOSTED_BILLING_CONFIG`
with exact environment, organization/product IDs and optional fixed base-price
ID. Supply `WAYPO_AUTH_SECRET`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` and
object encryption keys through private operator configuration, never committed
vars. The sample's IDs/domains/bucket are placeholders, not provisioned resources.
Build Waypo assets with its existing Worker asset tool before Wrangler dry-run.
The maintained SDK and the complete branded Worker compile together; compilation
is not a deployed production service.

`node.mjs` exports `create3slnNodeApplication` and `start3slnNode`, and accepts a
private `{provider,billing}` JSON file when executed directly. Provision the
provider metadata using Waypo's public SQLite adapter first. Run behind the
operator's configured TLS ingress. The optional commercial flags
`enableActions`, `enableCancellation`, `enableTrial`, and `executeRetention` must
be explicit booleans; actions/trials/destructive retention default off. Keep
cancellation enabled when disabling new checkouts on an existing live service.
New hosted signup still requires actual trusted country/admission/contact ports;
this package does not invent an approved global market list.

The generic provider extension exposes a same-origin billing link/page and
owner-bound status, checkout, portal, refresh and cancellation routes. Actual
native session/fence checks derive the subject; request bodies cannot select
another account. Mutations require the exact Origin and empty JSON body. The
raw signed webhook is the only anonymous billing endpoint. It validates the
maintained SDK signature, then reconciles canonical customer/subscription/order
state for the configured organization/product. Redirects never grant entitlement.
SDK network calls occur outside metadata transactions. Same-transaction receipts,
version/epoch checks and policy projection protect retries and concurrency.

A configured fixed annual base-price ID enables paid tenure from canonical paid,
unrefunded order line periods. At most 64 verified periods are retained; at most
72 completed monthly anniversary labels enter the policy engine. Durable bounded
jobs mature those months without waiting for a yearly webhook or user visit.
Usage events from actual service commits accumulate exact byte-milliseconds and
excess byte-milliseconds in bounded integer counters, with six prior-term summaries;
no per-edit event array, payment-card data, email or country is collected here.
These counters are not invoices and do not enable overages. The Worker stores the
`provider-extension` wakeup atomically with its index; Node polls the same durable
index on startup and each second.

`npm test` runs the engine merge gate: commercial policy, paid tenure, bounded
usage accounting, SDK/webhook reconciliation and overage candidates with injected
resources. `npm run test:e2e` separately runs actual Node TLS/native-session/email
proof and browser billing checks, cancellation, and native Miniflare/workerd SQLite
state/session persistence across restart. `npm run test:all` runs both. These use
the adjacent Waypo checkout's development tools. Set `E2E_SNAPSHOTS=true` only for
requested E2E desktop/mobile billing evidence; captures and test state are ignored.
No external checkout or charge is made. Real Polar annual sandbox settlement,
production configuration, all lifecycle/browser gates and launch capacity remain
separate release requirements.

The isolated `Hosted Waypo engine gate` workflow checks out this repository as
`service` beside the exact Waypo commit in `waypo-ref.txt`, installs both pinned
dependency sets and runs only the engine gate on changes. Browser/native checks
and snapshots require explicit manual inputs. The private pinned Waypo composite
action supplies its exact source with a per-file SHA-256 manifest; its action ref
must match `waypo-ref.txt`. GitHub's organization-private action sharing supplies
an automatically scoped read token, so no stored cross-repository personal token,
billing credential or Cloudflare credential is needed. See the
[GitHub sharing contract](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization).
The Waypo repository must allow private action use within the organization;
review that setting if collaborator/access policy changes. This workflow does
not establish a remote pass until it has actually run. Historical root workflows
do not validate this new package. Production deployment remains disabled.
