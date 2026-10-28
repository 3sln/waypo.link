# BB-B9 web client

Provisional local implementation, integrated 2026-10-21. Reviewer ___ Date ___ Outcome ___.

The Node and Worker shells mount the dodo/ngin client behind the existing default-off
`PARLAY_ENABLED` flag. `npm run build:assets` emits the standalone browser bundle and
styles under `.output/parlay-public`. The owner API derives its actor from the shell's
live bearer verifier. Tokens remain in memory; drafts are scoped to the owner on this device.
The standalone page accepts an existing ordinary app credential. An SDK host can provide a
`token` function through the same-document `parlay-session` event.

Actions own client decisions, the dodo view renders snapshots, and providers own browser,
mailbox and optional incremental-authorization I/O. The UI supports en/es, light/dark and
320/390/1440 px. Features include drafts, original-recipient delivery counts, Retry missing,
finite SSE recovery/reset, Requests and Rejected rescue, contacts, saved Views, archive and
app-switch confirmations. Connectivity never sends a draft automatically. Lost send replies
retain the exact operation ID and text until the owner resolves them.

Conversation history transfers at most 40 entries per page (server maximum 100), with explicit
older/newer offsets and totals. The client retains only the selected page. Per-entry revision
history is capped at 20 and reports truncation. Server causal ordering still reads conversation
metadata before slicing; this work bounds browser transfer, not server sorting memory.

New conversations select members of the owner's Contacts list (`conversations.create` with the member's
principal). The engine uses the binding that member's accepted two-party conversation verified; a member
without one cannot be messaged yet. Contact links (adding a contact link, link-based contacts and the
`send-message`/`add-contact` intent kinds) were removed in contacts spike phase 4. Rejected body reads are explicit owner
queries; encrypted staged parts and signed body digests are checked before a maximum 64 KiB
text projection is returned. Quarantined items cannot be read. Peer content remains literal text.

Archive controls are enabled only when storage/key-holder ports are composed. Export provides
an exact `{generation,digest}` anchor; import requires it and explicit confirmation. Rejoin is
a separate confirmed action. The UI explains provider custody of encryption keys, checkpoint
timing and manual review of old unresolved sends. Production key-holder requirements and the
explicit disposable Node development holder are documented in `../worker/README.md`.

Run `npm run test:parlay:web` for client engine, transport and Chromium checks, including
bounded transfer of a 10,001-event history, drafts, partial delivery, Retry missing, SSE reset,
rescue and archive handoff across locales, sizes and themes. Integration regressions in
`tests/parlay/wave4-integration.test.mjs` additionally exercise actual shell mounting,
encrypted Rejected reads and the archive security gates.

Contacts spike phase 3 (provisional, unsigned; behind `PARLAY_ENABLED` and, for the handoff,
`INTENT_LINKS_ENABLED`). The intent handler accepts the Bindle Messaging `connect` kind
(`docs/artefacts/intents/connect-v1.json`, pinned by digest in `bl/intents.mjs`; messaging §4.1–§4.2).
Receipt validates the data and `expires_at` locally and fetches nothing. The first armed confirmation runs
only `invites.inspect`, which verifies the inviter's certificate, status and ingress. The question
"Allow <handle, else host> to message you?" then appears, with the labelled `no-reply` hint. Only a second,
re-armed confirmation runs `invites.redeem`. Failures render fixed text: used or no longer valid, could not
verify (both terminal), or could not check right now (retry after re-arming). Contacts adds "Invite a
person", which calls `invites.create` and shows the `web+bindle://intent?bintent=…` link once. The token
stays in memory only and is discarded by Done or navigation. Contacts also lists invitations (state, expiry,
"Used by" ledger entries with Block, and Revoke) and the members of the built-in Contacts list, each with
Remove and, when reachable, Start conversation.
`tests/parlay/connect-intent.test.mjs`, `tests/browser/intent-parlay-browser.mjs` and
`tests/parlay/browser/invites-browser.test.mjs` cover these flows.

These are local implementation and harness/browser checks. External identity, delivery,
object-storage and key-holder conformance remain unverified. Production release remains disabled.
DEVLOG.md was not edited for this integration pass.
