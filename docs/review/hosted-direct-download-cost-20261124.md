# Hosted R2 direct-read budget boundary

Checked 24 November 2026. R2's free egress does not make object requests free:
`GetObject` is a billable Class B operation after the shared allowance. See
[Cloudflare's pricing](https://developers.cloudflare.com/r2/pricing/).
Cloudflare also documents that one presigned URL remains reusable until expiry
and uses its S3 endpoint rather than a custom domain. See
[presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Inference: a short expiry, one-byte object and low URL-mint rate still do not
bound how often a recipient can replay an issued URL against R2. Mint admission
therefore cannot establish a hard delivery-operation budget. No replay attack,
vendor charge or request-throughput ceiling was measured in this review.

Decision for the hosted Worker: reject raw direct-GET configuration before
provider, email or vendor initialization. Continue using budgeted proxied reads
until an enforceable delivery-cost boundary is implemented. Billing activation
does not bypass this guard. Existing defaults were already disabled; this closes
the configuration path rather than claiming a current production exposure.

The open-source/reference delivery policy remains configurable and explicitly
reports that direct URLs have no delivery-request or byte cap. Node's local
download handler is separate; its policy was not changed. Apps continue to use
the ordinary blob read/stream interface; hosted discovery must not advertise
raw R2 download URLs.

The three configuration cases passed3/3 in1.862s and are registered in the
primary hosted suite. The first incomplete fixture omitted the already-required
physical storage profile and failed before reaching this guard; the corrected
fixture uses the existing maintained capacity profile. No production validator
was relaxed. The complete coherent hosted primary gate remains pending.
