# Reviewed terminal account decisions

> **Status:** Development documentation. Production release remains disabled.

A reviewed staff `archive` or `delete` effect installs a durable terminal intent separate from an inactivity episode. The immutable binding includes the case/proposal, original policy revision, decision time and configured response grace. It queues cancellation and verified-contact notices in the same metadata transaction. Temporary suspension does not queue cancellation.

Cancellation can run with automatic retention or physical execution disabled. It does not wait for notice delivery or acknowledgement. Transient failures retry with bounded backoff; they do not become a false successful cancellation after three attempts. Each attempt has a new lease identity, and a successful result for an older billing version cannot confirm cancellation of a newer projection. Ordinary authenticated activity, check-in and canonical billing updates cannot release the reviewed decision. An explicit reviewed appeal for that exact case can release it before irreversible native closing. It does not silently restart renewal. A pending external cancellation may still finish after appeal and requires reconciliation.

Physical archive/delete still requires current execution permission, original policy revision, live protected-role/dependency checks, no incident/contact outage, a genuine accepted or permanently rejected notice attempt and its response grace, and the end of funded access. This implementation uses the configured ordinary response grace as an engineering default for reviewed terminal decisions. It does not create a new commercial term. An account without any verified contact remains blocked from physical cleanup; no delivery attempt is invented. A global transport outage does not certify receipt. Human abandonment and staff appeal remain distinct recovery paths.

## Funded owner export

The provider-owned `/api/waypo/account-policy/catalog/*` routes authenticate the actual owner session independently from third-party app grants. Suspension continues to deny app reads/writes. Export does not issue an OAuth token or change consent, enforcement, catalog authority or funding.

`POST /catalog/download` checkpoints acknowledged document tails through the existing service engine, then atomically captures a catalog and pins its immutable object references. There are at most two one-hour leases. Reloading the same owner session reuses its original lease without extending it. New leases stop at the reviewed terminal response/funded deadline; an already accepted lease can finish until its fixed expiration. The service layer conservatively retains **all** account-retired objects while any pin exists. This temporarily increases retained storage and is not free storage or an entitlement change. Existing retired-object bounds can impose cleanup backpressure on active writers until leases are released or expire; exact-reference pinning is not implemented.

Metadata is stored in bounded pages of sixteen entries, at most 8,320 entries / 520 pages per lease for the current catalog ceilings. Public pages contain document/attachment metadata and opaque object IDs, never backing object keys. Object reads use one metadata page, check plaintext size/hash, and recheck the owner session and exact live pin after buffering bytes. Explicit release and expiry stop further reads; release during a buffered read prevents its response. Expired metadata pages are removed on the next begin or terminal resource purge, with at most two retained snapshots per account. Terminal cleanup checks service pins **before** native closing and defers to the pin deadline, then uses the existing bounded retired-object collector. No extra object copy is created by export; a document checkpoint can add an immutable object as usual.

Routes:

- `POST /catalog/download {}` returns `{leaseId, expiresAt, generation}`.
- `GET /catalog/page?leaseId=…&cursor=0` returns sixteen metadata entries and `nextCursor`.
- `GET /catalog/object?leaseId=…&entryId=…` downloads one private plaintext object.
- `POST /catalog/download/release {leaseId}` releases only the original owner's session lease.

These routes and the trusted service pin ports are implementation interfaces, not a new federation wire protocol. The real payment-provider cancellation integration and browser evidence must be reported separately from mocked maintenance-port engine tests.
