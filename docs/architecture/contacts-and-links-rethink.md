# Contacts and links rethink — design spike

Status: **design spike, revision 2, 2026-10-27. Provisional (coordinator), not signed off by the owner.** It proposes. It edits no spec and no code. Every decision (CL-*) and change request (CR-*) is unsigned. Hosts are placeholders under `.example` and identifiers are placeholders under `https://spec.bindle.example/`. Nothing described here is implemented, deployed or production-verified. The coordinator logs this spike in DEVLOG.md. Sign-off: reviewer ___ / date ___ / outcome ___.

**Revision 2 changes.** It addresses every finding of the independent review of revision 1 (H1–H5, M1–M7, L1–L10; disposition in §12). It folds in the owner direction "invitation use cases, admission rules, lists, one-way links" (DEVLOG 2026-10-27) and two owner refinements: admission is an ordinary owner rule, and the relationship (two-way, receive only, request) lives on contact lists, not on links. It aligns with extensions revision 3.1. Accepted cuts from the review:
- the "allow anyway" handler option;
- mutual-request auto-accept;
- CL-10, which is deferred;
- requests (option C) as a prerequisite for developer contact. Developer contact uses principal-bound invitations minted on demand. Requests remain a possible later phase only.

**Owner direction (2026-10-27), quoted:** "Contact links and similar things should not be in the core Bindle spec; they should be part of the messaging extension, if they survive at all — vs some kind of contact invitation link that gets used up to add someone to our whitelist? I'm not sure; that whole system probably needs to be rethought. We want usefulness without unnecessary complexity; especially complexity surfaced to the user. User burden and complexity must justify itself."

**Further owner direction (2026-10-27; relayed, paraphrased):**
1. Core signaling is unaware of calls and contacts. The `link` basis goes unless a generic need exists.
2. Intent kinds are public, URL-identified, additively versioned artefacts. Core hard-codes none.
3. An invitation is an intent published by the Messaging extension. Redeeming it allowlists the inviter (and/or the reverse). Owner-defined auto-tagging lives in the messaging app.
4. *Use cases, rules, lists, one-way links:* cover both single-use person-to-person invitations and public links (for example on a website). Some links auto-admit, some need each joiner accepted, some admit by rules. Contact lists are needed. Both one-way links (newsletter or follow: receive only) and two-way links are needed.
5. *Refinement 1:* admission is not a link setting. It is an ordinary owner rule ("arrived via link X" → action), created alongside the link by the chosen template and editable like any rule. Deleting a link offers to remove its rules.
6. *Refinement 2:* direction is not a link setting either. A link is uses plus expiry (plus its id). Contact lists are first-class and each carries a relationship policy: `can message you`, `receive only` or `request`. Rules place arriving people into lists. The most permissive policy among a person's lists applies; a block overrides everything; exceptions are made by moving the person to another list. A policy change applies to everyone in the list immediately. If interop allows, the intent carries no protocol-level direction, only an optional display hint.

**Standing direction.** Core Bindle is identity, preferences, intents, resources and hub connectivity. Messaging and calling live in Parlay under the Bindle Messaging extension ([messaging.md](../spec/extensions/messaging.md)). The 3sln.me email auto-response stays. Slots are gone in extensions revision 3.1 (§4.9).

**Conflict resolved.** The messaging tear-out (DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset") left the contact profile and per-link sharing, developer contact, the contact parent, the links contract, conditional audiences, the messaging-address descriptor, the contact-link landing and the built-in contact intents in core. This spike removes all of them from core.

## 1. Inventory

"Core" means core `docs/spec/*` drafts or `packages/{links,identity,runtime,intents}`. "Parlay" means `docs/spec/messaging.md`, `apps/parlay` or `packages/messaging-*`.

| # | Concept | Where it lives | User problem it solves | User burden |
| --- | --- | --- | --- | --- |
| I1 | Signed-object profile (links §3.1: strict I-JSON, exact members, received-bytes signing input, 64-byte signature) and the signature-domain table (§7.2) | links.md §3.1, §7.2. Normatively reused by signaling (leg certificates, messages), identity portability (move statements, AMD-P5/P11), key-delegation certificates (messaging §3.2), intents §3.1/§3.3/§3.5, organizations | None directly. It is a **shared core primitive** | None |
| I1b | `bindle_meta`/`bindle_data` query envelope, raw-query parser, uniform `link_invalid` | links.md §2, §3.2–§5, §8; `packages/links/envelope.mjs` | Real users: org and relation invitations (`orgs/invitations.mjs`, `relation-invitations.mjs`); RTC tickets (`rtc/tickets.mjs`, `rtc/service.mjs`, dropped by signaling.v1); `identity/link-response.mjs`. Intents §3.4 borrows the parser | None |
| I1c | Non-link code in `packages/links` that other packages import | `envelope.mjs` helpers (`strictJSON`, `exactMembers`, `plainObject`: identity, `federation/directory`, `rtc/messages`); `author-proof.mjs` `jcs` (`email-bridge/wire`); `types.mjs` `MESSAGING_INGRESS_SLOT` (`identity/delegation.mjs`, `apps/connections.mjs`, `federation/brokered.mjs`), `PUBLIC_INTAKE_*` (`brokered.mjs`, `email-bridge/wire`), `LINKS_CONTRACT` (`federation.mjs`, `account/storage.mjs`); `sharing-fields.mjs` `withdrawsSharing` (`identity/age-policy.mjs`, `routes/contact-profile.mjs`); `handoff.mjs` `validateDescribe` (`routes/integrations.mjs`); `policies.mjs` (`runtime/developer-contact.mjs`); `preview.mjs` (`routes/intents.mjs`, `routes/federation.mjs`); `audience`, `contact-profile`, `parents` (`runtime/accounts.mjs`, `account/contacts.mjs`, `routes/rtc-owner.mjs`) | Key delegation and the email bridge depend on these | None |
| I2 | Contact link type: `kinds`, MIME and quota members, expiry, revoke | links.md §6; messaging.md §4.1, §4.5; `links/issuance.mjs`, `types.mjs`; Parlay `domains/contacts.mjs` | Let people reach me without exposing everything | Kinds, limits, expiry; share; revoke; understand the link is a bearer secret |
| I3 | Intake configuration (tags per link) | links.md §6.2–§6.3; messaging.md §4.3–§4.4 | Sort arrivals by link | Per-link tag settings |
| I4 | Conditional links: audience, response signing, replay, policy registry, `link-response.v1` | links.md §7, §9; `links/audience.mjs`, `replay.mjs`, `policies.mjs`, `author-proof.mjs`; `identity/link-response.mjs` | Gate who may write (in practice only developer contact) | "Continue as …" page, eligibility states |
| I5 | Contact parent and its cap (AMD-L1) | `links/parents.mjs` | Anchor for per-link configuration | None |
| I6 | Links contract, link-type-to-slot table, bulk reissue | messaging.md §4.2; `links/engine.mjs`, `account/links.mjs` | Links surviving an app switch | "Reissue your previous app's links" |
| I7 | Messaging-address descriptor and consumer | messaging.md §2.1, §2.3; `links/handoff.mjs`, `routes/links.mjs`; `MESSAGING_ADDRESS_DECLARATION` | Find the ingress from a link | None |
| I8 | Contact-link landing and previews | links.md §6.4; `links/preview.mjs`, `profile.mjs`, `routes/contacts.mjs`; `apps/web/src/bl/contact-link.mjs` | Open a link without an app | Landing choices |
| I9 | Contact profile and per-link sharing | `links/contact-profile.mjs`, `sharing-fields.mjs`; `account/contact-profile.mjs`; routes; Account & security UI. `/api/profile` is read by the embed view | Show name and photo to contacts only | Profile editor, disclosure toggle, per-link toggles |
| I10 | Developer contact via a conditional link | `runtime/developer-contact.mjs`, `GET /api/developer-contact` | Reach the developer; paid priority; free cut-off at 1,500 accounts | Console card with eligibility states |
| I11 | Core-registered intents `send-message`, `add-contact`, `open-conversation`; `contact-link` format; legacy forms; `/i/contact` | intents.md §3.5, §4.1–§4.2, §11; `intents/registered.mjs`, `legacy.mjs`, `schema.mjs`; `routes/intents.mjs`; `CONTACT_INTENTS` | Hand a contact to my messaging app | App chooser; the built-in handler leads nowhere |
| I12 | Signaling `link` basis, `mint_link`, RTC compatibility port | signaling.md §5.1–§5.6, §14, §20.3; `runtime/accounts.mjs`, `routes/rtc-owner.mjs`, `rtc/service.mjs` | Let contacts call me | Per-link calling settings |
| I13 | Signaling `offer` basis and `pairing` record | signaling.md §5.7–§5.8 | Calls in a conversation; device wiring | Answer; a pairing page |
| I14 | Signaling `none` basis (held requests) | signaling.md §5.2 | Unsolicited sessions, opt-in | One toggle, default off |
| I15 | Organization and relation invitations | organizations.md §5.1, §9.4; `packages/orgs/*` | Invite into an organization | An accept page |
| I16 | Email to the handle address, invariant auto-reply, into the messaging intake | messaging.md §9; `packages/email-bridge` | Public reachability by email | One owner setting |
| I17 | Legacy `?sig=` leftovers | links.md §10; `links/preview.mjs`, `types.mjs` | None | None |
| I18 | Parlay accepted-peer sets, blocks, rules, tags, classifier | messaging.md §6.4–§6.7; [messaging-app §12](messaging-app.md#12-views-tags-rules-and-the-classifier-slot) | Who may talk to me; organizing | Requests view, rules, block |

**What the inventory shows.** I1 is core and stays core. I1b's only non-contact users are Organizations and RTC tickets, which signaling.v1 drops. I2–I12 exist to support one primitive, a standing configurable signed contact URL. Intents already carries anything an invitation needs: fragment placement (§3.4), link hosting and handoff to the viewer's provider (§10), consent (§7) and capability secrecy (§9.3).

## 2. User problems and the simplest solutions

| Problem, stated plainly | Simplest design | Spec surface |
| --- | --- | --- |
| P1. "Let a person I know add me, and add them." | Template **Invite a person**: a single-use link whose rule puts the redeemer in "Contacts" (`can message you`). | Messaging: intent data, redemption, results |
| P2. "Put a contact link on my website, but keep control." | Template **Website contact link**: unlimited uses; its rule puts joiners in a `request` list, so each conversation they start is vetted. | Same; links, rules and lists are Parlay |
| P3. "Let people follow my newsletter without messaging me." | Template **Newsletter/follow**: unlimited uses; its rule puts joiners in a `receive only` list. Always unsubscribable. | Same, plus one generic content-refusal rule |
| P4. "Keep strangers out and stop spam." | First contact gated by list policy; uniform refusal. Strangers reach me only through email (today) or a public link I published. | Messaging §6.7 rewrite |
| P5. "Group people (friends, customers, subscribers)." | First-class contact lists, each with a relationship policy. Tags stay plain labels. | None (Parlay) |
| P6. "Decide automatically what happens to arrivals." | One owner rules engine (conditions → place in lists, tag, hold, refuse, route) for redemptions and inbound messages. | None (Parlay) |
| P7. "Invite someone into my organization." | Unchanged. | Organizations |
| P8. "Let a contact call me." | A Parlay call-invite message carrying a signaling `offer`. | Signaling drops `link` |
| P9. "Users can reach the developer; paid users get priority." | "Message the developer" mints a principal-bound invitation for that user on demand. | None (3sln.me hook) |
| P10. "Show my name and photo to contacts only." | A Parlay peer profile record (deferred). | Deferred |
| P11. "Stop someone." | Block in Parlay. | Existing §6.5 |

## 3. Options

**(A) Standing public contact link with conditions (today).** High burden (I2–I12); quotas are rate limits, not consent; revocation cuts off everyone; needs the identity-key signature, links contract, descriptor and unwired foreign audience resolution; about 1,500 lines of core. **Rejected.**

**(B) Invitation URL on the inviter's app origin.** Duplicates intents (landing, handoff, choice, consent) and ties the link to one app origin. **Superseded by B'.**

**(B') Invitation as an intent, with issuer-side uses, owner rules and list policies (recommended).** One intent kind and one redemption message cover P1–P3. How many may join, what happens to them and what they may do afterwards all stay in the inviter's app (§4.4). Single-use and multi-use differ only in the issuer's record, and the relationship is enforced by the inviter's list policy, so the wire carries neither a use count nor a direction.

**(C) Requests to a handle** (a verified-author `conversation-init` that the recipient's provider forwards). It is the most complex piece: provider-side blocks, per-issuer spam budgets, uniform `202` timing, and a second consent under extensions rev 3.1. P2's public link with a `request` list already gives an opt-in, per-link, revocable door for strangers, and P9 no longer needs requests. The `request` list policy is not option C: it applies only to people already placed in a list through a link. **Deferred; a possible later phase only** (CL-7).

**(D) Others.** D1, handle-only requests and no invitations: **rejected**. D2, mutual requests auto-accept: **cut**. D3, organization-supplied allowlists: **deferred**. D4, a core allowlist shared with signaling: **rejected**. D5, N-use invitations: **adopted** as an issuer-side setting with the public-link safeguards of §4.5. D6, tokenless "allow me" intents: **rejected**, since a `receive only` list covers following. D7, a protocol-level `direction` member: **rejected** after evaluation (§4.3), because the inviter enforces the relationship from its own lists.

## 4. Boundary and design

### 4.1 Core keeps the signed-object profile and nothing contact-specific

- **Rule.** Core defines no contact concept, allowlist, link landing, link-type registry, query link envelope or hard-coded intent kind.
- **Core keeps (H1):**
  1. the **signed-object profile** (links §3.1: strict I-JSON, exact members, received-bytes signing input, 64-byte signature) and the **signature-domain table** (links §7.2 minus its link-data and audience rows), moved to a short core identity-and-keys specification (Q2). Signaling, identity portability, key delegation, intents and organizations repoint their "links §3.1" references to it;
  2. the matching code, `packages/core/strict-json.mjs` (`strictJSON`, `exactMembers`, `plainObject`, `jcs`) and `packages/core/signed-object.mjs` (compact JWS sign/verify), with no link vocabulary;
  3. one generic **capability-handling** rule in security.md: redaction, `no-store`, `no-referrer`, no service-worker caching, fragment placement.
- **The query envelope** (`bindle_meta`/`bindle_data`: links §2, §3.2–§5, §8) moves to an Organizations annex, its only remaining user. `link-response.v1` is withdrawn (CL-3). RTC tickets leave with the signaling.v1 migration. Until then they import the core signed-object module, never `packages/orgs` (L5).

### 4.2 Intents

- Intents is a **Bindle-published extension with its own spec** (intents.md). It defines no kinds. §11 "Registered kinds" and the AMD-I2 migration leave. `send-message`, `add-contact`, `open-conversation` and `connect` become Messaging-published artefact lines.
- The `intents.v1` declaration whose `intents` option is a subset of the contact intents (protocol.md, extensions rev 3 §2.8 row naming links) is **withdrawn outright**, not left empty. Handling providers declare the intents extension by its spec URL.
- intents.md replaces `contact-link` with a generic `capability` string format: a bearer secret; forces `capability: true`; displayed only by `presence` or `origin`; bounded by the field's own `maxLength`. The contact-derived 4,352-character bound and the §3.5 contact-link text go (L6).
- The raw-query parser is inlined in §3.4. References to links in §3.1, §3.3, §3.5 (`kid` bound), §8 step 6 ("for a contact link, links §8"), §9.3 and §10 Tooling are repointed to the core identity-and-keys spec or security.md, or deleted (H1, L10).
- Core code drops `registeredIntentHandlers`, `/i/contact`, contact `INTENT_BUILTINS`, `intents/legacy.mjs`, `CONTACT_INTENTS` and the hard-coded kinds. Nothing is published, so the legacy forms are removed, not migrated.

### 4.3 Bindle Messaging specifies only intent data, redemption and results

The Messaging spec defines exactly the following. **Everything else in this spike (uses, expiry policy, templates, rules, admission, lists and their policies, tags, safeguards, labels) is Parlay application behaviour, and the spec says so explicitly.**

**Kind** `https://spec.bindle.example/messaging/v1/intents/connect`. Effect `send`. Disclosure categories `personal-data` and `send-as-you` (the redeemer reveals itself and sends as itself). `capability: true`. Data (L1: no `handle`):

| Member | Field | Display |
| --- | --- | --- |
| `inviter` | principal | `value` (the `iss` host; a handle only if the provider already holds a verified binding) |
| `token` | string, `format: capability`, 22–43 base64url characters (≥128 random bits) | `presence` |
| `delegation` | string, at most 2,048 characters: the inviter's current key-delegation certificate (messaging §3.2), compact JWS | `presence` |
| `expires_at` | integer, Unix seconds; optional (absent means the issuer sets no expiry) | `value` |
| `hint` | optional enum `no-reply` | `value`, labelled "The inviter says you won't be able to reply". Display only; no protocol effect |

The certificate makes the link about 2 KB. It still fits intents §3.5, but its QR code is dense. This is the accepted cost of verifying the ingress without a lookup service.

**Handler duties, in order (H2, L2).**
1. Validate data shape and `expires_at` locally. No fetch happens on open or prefetch. Fetches start only after the provider-level consent (intents §7), which is a viewer action.
2. Resolve the inviter's identity key through the directory, with pinned continuity. Verify the `delegation` signature, `typ`, `bindle`, that `iss`/`sub` equal `inviter`, and that `purposes` includes the author purpose. Check **status** by `jkt` (messaging §3.4) and require `active`. Certificate expiry is not checked, because certificates last at most 24 hours and invitations last longer. A changed delegate key or an app switch revokes the `jkt`, so the invitation dies with the old app, as intended.
3. The redemption target is the certificate's `client.ingress`. There is no `ingress` data member to forge. The redemption POST follows the messaging §2.3 host-wide fetch rules: HTTPS, no redirects, private-address screening, and bounded size and time.
4. Show the verified handle ("Allow alice@a.example to message you?", plus the labelled hint when present). Only on confirmation, admit the inviter to message the viewer (in Parlay: add it to the viewer's default `can message you` list, or "Following" when the hint is present; §4.4). **Nothing is sent to any party before steps 2–4 succeed.**
5. Send the redemption. Keep at most one pending redemption per token digest per account, and retry with identical bytes.
6. **Rollback (M2).** Remove the admission only if this flow created it, no conversation with the inviter exists, and either a terminal error arrived or `returnControl.expiresAt` passed without an accept.

Disclosure (L2): for a foreign inviter, the inviter's provider learns when the viewer consented and which provider fetched. In v1 inviter and viewer are same-host (§4.5), so no cross-host fetch occurs.

**Redemption message.** A `conversation-init` (messaging §6.1), signed by the redeemer's delegate key, with `recipient: {issuer, owner, invite: base64url(SHA-256(token))}` and `Authorization: BindleInvite <token>`. Its genesis lists **exactly two participants**, has no `subject` and empty `content`, and its acceptance is never `acceptListed` (H3). Profile: the base `…/messaging/v1`. The inviter's binding and limits arrive in its invitation response.

**Inviter processing order (M1: cheap checks first).**
1. Pre-crypto budgets: per-source and per-invitation rate limits, size and framing.
2. A read-only lookup of the token digest. Unknown, cancelled, expired, exhausted, or bound to a different claimed principal → `invite_invalid`.
3. Verify the author (messaging §3.3, with the §3.4 status check).
4. In one transaction: re-check, record the redemption, and count the use. A principal that already redeemed this token is a **replay** (M2): the stored result is returned and nothing is counted again, keyed on `(token digest, author principal)`.
5. Hand the redemption to the owner's admission decision (§4.4), which is application behaviour.

**Results (uniform).**
- `invite_invalid` (401) for every token failure in step 2, and for a bound principal mismatch, with one body and timing class.
- `rate_limited` (429) for budgets. A per-invitation 429 reveals liveness only to someone who already holds the token.
- Ordinary `author_unverifiable`, `malformed` and `too_large` as in messaging §8.3.
- Otherwise the ordinary receipt (custody). The outcome is either an ordinary invitation response `accept`, or **no response**, which lapses at `returnControl.expiresAt` exactly as messaging §6.7 auto-rejection does. Held, ignored and refused redemptions are indistinguishable. A refused redemption gets no response.

**No protocol direction (evaluated; D7).** The redeemer always admits the inviter to send to it. Whether the redeemer may message back is decided and enforced by the inviter's app, from the inviter's lists (§4.4). The spec needs only one generic rule for that, not a direction field:
- **Content refusal by owner policy.** A receiver MAY refuse content records (`message`, `edit`, `retract`, `peer-proposal`, `peer-response`, `rotate`) from an accepted peer under owner policy, with the uniform `not_authorized`. It keeps accepting `leave`, `ingress`, `rejoin`, `secret-share` and receipts from that peer, so bindings and unsubscribe keep working.
- **Interop result.** A redeemer app that ignores the hint and offers compose gets `not_authorized` and shows "Not delivered". That costs one refused round trip and needs no negotiation. List policy changes need no protocol message. The `hint` only sets expectations, and a template derives it at mint time, so a later rule change can make it stale. That is why it is labelled as the inviter's claim.
- **Unsubscribe** is local and immediate: the redeemer removes the inviter from its list (a removal under §6.5 for their two-party conversation) or blocks, after which the inviter's records are refused. It also sends the existing `leave` record (§6.3), which Parlay honours by removing the person from its lists.

**First-contact gate (H4).** The owner's list policies gate **first contact only**: `conversation-init` and `one-off`. An author whose lists do not admit first contact (none, or only `receive only`) and who presents no live token gets `not_authorized`, before custody, with the same code and timing class as "not hosted here" and "blocked". A `request` member's first contact is accepted into custody and held. Unanswered, it lapses as in §6.7. Records, `peer-hello` and `rejoin` stay gated by the existing per-conversation accepted-peer set and pair tokens (§6.3–§6.6), so groups with non-contacts and rejoin keep working. A group peer does not join any list. List policy applies to first contact and to the owner's two-party conversations with that person. The ingress URL is not a secret. §6.7 is **rewritten** rather than extended: policy refusal is a pre-custody gate, and the no-oracle requirement covers it.

**Identity moves (L8).** List memberships are keyed by principal. When the app verifies an identity-portability move statement for a principal in its lists, it re-keys the memberships. Bound invitations are not re-bound; they expire.

### 4.4 Parlay behaviour (application, not spec)

**Invitation link record.** Its only settings are **uses** (1, N or unlimited; "1, by bob@b.example" when started from a known handle, which binds it) and **expiry** (single use: default 7 days, maximum 30; multi-use: optional). Its **id** lets rules match "arrived via link X". Bookkeeping, not settings: an owner-private name (for example "for Bob"), the token digest, state (live or revoked) and a redemption ledger (principal, time, outcome) for notices, replay and removal. Admission, relationship and tags are **not** stored on the link.

**Contact lists (first-class).** A list has a name and one **relationship policy**:

| Policy | They may | You may | First contact from them | Content from them in your two-party conversations |
| --- | --- | --- | --- | --- |
| `can message you` | message you | message them | admitted | admitted |
| `request` | ask to start a conversation, vetted by you | message them | held for you (silent lapse if unanswered) | admitted in conversations you accepted |
| `receive only` | receive what you send (newsletter, follow) | send to them | refused | refused (content-refusal rule, §4.3) |

- A person may be in several lists. The **most permissive** policy applies (`can message you` > `request` > `receive only`). A **block** overrides every list. There are no per-person overrides in v1: an exception is made by moving the person to another list.
- "Contacts" (`can message you`) is the default list on both sides. When a redeemer accepts an invitation with the `no-reply` hint, its handler puts the inviter in a default "Following" list (`can message you`, so the publisher can deliver). Unsubscribing is removing it from that list.
- **Tags** stay plain labels, used for sorting and rule conditions. They carry no policy.
- **Sending to a list** fans out over the members' two-party conversations, within Parlay limits. For a `receive only` list this is a newsletter.
- **Changing a list's policy** applies to every member at once, at their next inbound evaluation. What the other side observes:
  - after a downgrade to `receive only`, their next message or first contact gets `not_authorized`, the same code that removal or block already produces;
  - after a downgrade to `request`, their new conversations go unanswered, which looks the same as an owner who does not reply;
  - after an upgrade, they observe nothing until they try.

  There is no notice and no new oracle. One residual difference: a `receive only` member can tell it is not blocked, because its `leave` is still accepted. Only that member learns this, about itself.

**One rules engine.** An ordered list of owner rules (conditions → actions) handles both redemptions and inbound messages.
- Conditions: arrived via link X, handle domain, organization membership (where Parlay can verify it), list, tag, body content.
- Actions: place in list(s), tag, hold for review, refuse, route.
- Placement and tag actions accumulate. The first matching hold or refuse decides.
- A redemption matching no placement rule is **held for review**, which is the safe default. On approval the owner picks the list, "Contacts" preselected.
- Outcome on the wire (§4.3):
  - placement in a `can message you` or `receive only` list → `accept` (a `receive only` member's conversation exists so the owner can deliver);
  - placement only in `request` → held, like any request;
  - hold or refuse → no response.

**Templates.** A template creates the link, its default rule and, where needed, the target list. The owner then edits rules and lists like any others.

| Template | Link | Rule created ("arrived via this link" → …) | Target list (policy) | Intent hint |
| --- | --- | --- | --- | --- |
| Invite a person | 1 use (bound when started from a handle), 7 days | place in list | Contacts (`can message you`) | none |
| Website contact link | unlimited, no expiry | place in list | "Website contacts" (`request`) | none |
| Newsletter/follow | unlimited, no expiry | place in list | "Newsletter" (`receive only`) | `no-reply` |

**Delete or revoke a link** offers three things: stop new joins (always); remove the rules that match it; and optionally remove everyone admitted through it, which takes them out of the lists the link's rules placed them in and is a removal under messaging §6.5 where no other list keeps them.

**Leaked single-use invitation (H3).** A single-use token can leak through mail and chat URL rewriters (which log fragments), group chats, screenshots, QR photographs and clipboard managers. Email is where this happens most, because Parlay cannot reply over the email channel (messaging §9), so the owner pastes the link by hand (L4). Damage is bounded at no extra user burden:
- default binding whenever the owner starts from a handle;
- the redemption genesis carries no content and only two parties, so no attacker message or co-participants arrive;
- "Invitation 'for Bob' was used by mallory@evil.example", with Block one tap away and shown before any profile text;
- a contact admitted by an unbound invitation stays **message-only (no ringing)** until the owner replies once. This is internal state, not a setting;
- the real Bob's failure reads "This invitation was already used or is no longer valid; ask for a new one".
- Bound-principal hints in the link are **not adopted** (L3), because they would put the invitee's principal in the link as a correlator. The handler's failure text mentions trying another account.

### 4.5 Public multi-use links: a public link is leaked by design

Token secrecy bounds nothing for a posted link. It is a public address. What bounds the damage:
- **Admission.** Public templates place joiners in a `request` or `receive only` list, never directly in `can message you`. The owner can change the rule, and the editor labels a `can message you` placement on an unlimited link "anyone with the link can message you".
- **No payload.** Redemptions carry no content, so the worst a held flood produces is a list of "X wants to join via Website link".
- **Cost before crypto.** Per-invitation and per-source rate limits (reference: 30 redemptions per hour per link and 200 held per link) and a token lookup run before any directory or status fetch.
- **Cheap principals.** v1 is **same-host only** (M5): persons have no directory yet, so foreign principals get `author_unverifiable` without a fetch. Per-issuer budgets and rules on handle domain are needed before foreign redemption is enabled.
- **After admission.** Admitted joiners are message-only (no ringing) until the owner replies, and the ledger records which link admitted them.
- **Revocation.** The link can be revoked with optional removal of everyone it admitted (§4.4).
- **Newsletter-style links** (rule places joiners in `receive only`) admit no inbound content. Their risk is subscriber-list pollution and fan-out cost: each subscriber's ingress is its own certificate-bound ingress (§4.3), and fan-out stays within Parlay's limits and the §2.3 fetch rules.

### 4.6 Signaling

- **Remove the `link` basis:** §5.3, AMD-SG-L1a/b, `mint_link`, resolving a recipient from a contact link, the `links` batch member, and the link control and revocation rows.
- **Calls** are call-invite messages carrying an `offer` (§5.7) inside a conversation. The conversation gate admits them. Signaling sees only a generic session kind.
- **CL-10 is withdrawn and deferred** (M3). No service entity or conferencing consumer exists. `none = admit` would be broader than `link`, would reopen unsolicited reachability and the presence oracle for people, and would be a relay cost-DoS. **Future generic idea, not designed now:** an issuer-held, multi-use, optionally principal-bound *ticket* basis (the `offer` mechanism without the principal requirement), if a real consumer appears.
- Routing remains for the own-entity fallback (§5.4 case 2).

### 4.7 Developer contact (M4)

- The console's "Message the developer" asks 3sln.me. A host hook checks eligibility at mint time (same-host only; paid-only at or above the 1,500-account threshold). It then asks the developer identity's Parlay, through that identity's own app grant, to mint a **single-use invitation bound to the requesting user's principal**, with a short expiry (reference: 1 hour), and hands the `connect` intent to the user's own messaging app.
- The developer identity's rule for these links places the user in a "Users" list (`can message you`) and tags `priority:<tier>` as an owner-private label. The tier label is disclosed only to the developer identity's messaging app. 3sln.me operates it today, and if it ever moves to a third-party host, that host learns the label (L9).
- `GET /api/developer-contact` returns `{available, eligibility}`. No new public endpoint, and no "temporarily unavailable" regression.

### 4.8 Profile and sharing

Per-link sharing, `discloseToContacts` and `bio` are deleted. Display name and avatar stay an account preference (`/api/profile`, read by the embed view). What contacts see is a Parlay peer profile record, which is deferred.

### 4.9 Extensions revision 3.1 alignment (M6)

- Manifest declarations are `{spec, options}`, with no slots, `features`, keys or refs. A provider feature is identified by its extension spec URL (one feature per extension).
- **`messaging-address` / `address-routing` is withdrawn.** CR-X3-04 and CR-X3-23's conversion into an `address-routing` provider feature, and the retention of `MESSAGING_ADDRESS_DECLARATION`, are superseded by CL-4: there is no handle-to-ingress lookup. The coordinator reconciles this in DEVLOG.
- Key delegation's occupant check becomes the value of the messaging-ingress fragment's `mailbox` field. `key-delegation.v1` becomes its extension URL.
- The 3sln.me email bridge is its own provider-published extension (for example `https://provider.example/extensions/email-bridge/v1`) consuming the public-intake fragment. It never places anyone in a list.
- Intents is a Bindle-published extension with its own spec. links.md no longer defines `intents.v1` or `link-response.v1`.
- The stale "extensions §9.8" reference (messaging §9 and revision 1 of this spike) becomes protocol §3 (no occupancy oracle).
- Requests, if ever built, would be a feature with its own field grant. That is one more reason they are deferred.

## 5. User-facing surface

**Flows.**
- **Invite a person.** In Parlay: Invite (optionally "to bob@b.example"), then share or show a QR code. "Bob accepted" follows, or "used by …" with Block.
- **Publish a website or newsletter link.** Choose the template and copy the link. Joiners appear in the template's list ("Website contacts" with their requests, or "Newsletter" subscribers). Revoke from the link list.
- **Accept, honestly counted (M5).** The first time:
  1. at the link host, enter your handle and confirm the destination provider. This is skipped inside your own provider, with the scheme handler, or as one tap for a remembered provider;
  2. sign in if needed;
  3. first-use consent for the kind (once, if "always");
  4. "Allow alice@a.example to message you?"

  That is four screens the first time, then two. There is no "allow anyway".
- **New users.** Without a connected messaging app the provider returns `intent_no_handler`. 3sln.me keeps the pending intent through sign-up and connecting Parlay within the one-hour intent retention (intents §6). Otherwise the user reopens the link, which stays redeemable until spent or expired.
- **Strangers.** Nothing arrives except email (lands as unverified, as today) and joins through links the owner published.
- **Organize.** Optional rules and lists.
- **Call a contact.** Tap Call in the conversation.
- **Contact the developer.** One button; your messaging app opens connected to the developer.

**Concepts.**

| Before | After |
| --- | --- |
| Contact link; kinds and limits; expiry; revoke; rotate; conditional audience; "Continue as …"; per-link intake tags; per-link sharing; disclose-to-contacts; previous-app reissue; per-link calling; signaling requests toggle; send-message versus add-contact; developer eligibility — **about 14** | Contacts (block); invitation link (pick a template); optional: lists (with a policy), rules. Uses and expiry appear only when customizing — **2 required, 2 optional** |

Hidden concepts the user still meets: provider choice, the app chooser and consent, and "invitation used or no longer valid" with no reason given.

## 6. Decisions (provisional, unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| CL-1 | Core defines no contact concept, contact list, link landing, link-type registry, query link envelope or hard-coded intent kind. | Reviewer ___ Date ___ Outcome ___ |
| CL-2 | *Revised (H1).* links is split. The signed-object profile, strict-JSON rules and the signature-domain table (minus link rows) go to a core identity-and-keys spec. Only the query envelope (§2, §3.2–§5, §8) goes to an Organizations annex. | Reviewer ___ Date ___ Outcome ___ |
| CL-3 | Withdrawn: conditional links and audiences, response signing, the replay record, the policy registry, `link-response.v1`, the contact parent and AMD-L1, and the legacy `?sig=` text. | Reviewer ___ Date ___ Outcome ___ |
| CL-4 | Messaging withdraws standing contact links, intake configuration, the links contract and the messaging-address descriptor, including rev 3's `address-routing` conversion. | Reviewer ___ Date ___ Outcome ___ |
| CL-5 | *Revised.* An invitation is a Messaging `connect` intent with data `{inviter, token, delegation, expires_at?, hint?}`; `hint` is display-only (`no-reply`). The spec defines only this data, the redemption message and uniform results (§4.3). Uses, admission and relationship are issuer-side. | Reviewer ___ Date ___ Outcome ___ |
| CL-6 | *Revised (H4).* Owner list policy gates first contact only (`conversation-init`, `one-off`), with a pre-custody uniform `not_authorized` (`request` members' first contact is held after custody). Records, `peer-hello` and `rejoin` keep their per-conversation gates. §6.7 is rewritten. The ingress is never secret. | Reviewer ___ Date ___ Outcome ___ |
| CL-7 | *Revised (M4).* Requests are deferred: no v1 use case needs them. Possible later phase only. Mutual auto-accept is cut. | Reviewer ___ Date ___ Outcome ___ |
| CL-8 | *Revised.* Rules, tags, lists and the classifier are Parlay-internal. One rules engine handles invitation admission and inbound messages. Lists are tags with provenance. | Reviewer ___ Date ___ Outcome ___ |
| CL-9 | The signaling `link` basis, §5.3, AMD-SG-L1a/b and `mint_link` are withdrawn. Calls are call-invite messages carrying offers. | Reviewer ___ Date ___ Outcome ___ |
| CL-10 | *Withdrawn (M3); deferred.* No `none = admit`. A ticket basis is noted as a future generic idea only. | Reviewer ___ Date ___ Outcome ___ |
| CL-11 | Intents is a Bindle-published extension with its own spec, and registers no kinds. Messaging publishes `send-message`, `add-contact`, `open-conversation` and `connect`. `intents.v1` and its contact-intents option, the built-in handler and the legacy forms are removed. | Reviewer ___ Date ___ Outcome ___ |
| CL-12 | Intents replaces `contact-link` with a generic `capability` format bounded per field, inlines the raw-query parser, and repoints every links reference. security.md gains one capability-handling rule. | Reviewer ___ Date ___ Outcome ___ |
| CL-13 | *Revised (M4).* Developer contact uses principal-bound single-use invitations minted on demand after a 3sln.me eligibility check. | Reviewer ___ Date ___ Outcome ___ |
| CL-14 | Per-link sharing, `discloseToContacts` and `bio` are removed. Display name and avatar stay an account preference. The peer profile record is deferred. | Reviewer ___ Date ___ Outcome ___ |
| CL-15 | No contact or invitation previews. Link hosts show at most the kind title (intents §10). | Reviewer ___ Date ___ Outcome ___ |
| CL-16 | *Merged into CL-2.* | — |
| CL-17 | *Revised (L7).* The **user decision** "No anonymous link messages" (2026-10-14) applies. This spike provisionally widens its scope to all Bindle first contact (redemptions are authored). Bridged email stays the separately decided channel-origin exception and never places anyone in a list. | Scope widening: Reviewer ___ Date ___ Outcome ___ |
| CL-18 | *Revised.* Organization-supplied allowlists are deferred. Tokenless one-way intents, the "allow anyway" option and bound-principal hints in links are rejected. | Reviewer ___ Date ___ Outcome ___ |
| CL-19 | *New (H2).* Before sending anything, the handler verifies the inviter's delegation certificate (directory key, purposes) and its `jkt` status, and redeems only to the certificate's `client.ingress`, under §2.3 fetch rules. | Reviewer ___ Date ___ Outcome ___ |
| CL-20 | *New (M1, M2, H3).* Inviter processing is cheap checks first. Replay is keyed `(token digest, author principal)`. The redemption genesis is two parties with no subject or content and never `acceptListed`. Refused or held redemptions get no response. Rollback applies only to self-created entries. | Reviewer ___ Date ___ Outcome ___ |
| CL-21 | *New (owner refinement 2; D7).* No protocol-level direction. The redeemer admits the inviter to send; the inviter enforces whether the redeemer may reply, from its lists. Messaging gains one generic rule: a receiver MAY refuse content records from an accepted peer under owner policy with `not_authorized`, while still accepting `leave`, `ingress`, `rejoin`, `secret-share` and receipts. Unsubscribe is local removal or block, plus the courtesy `leave`. | Reviewer ___ Date ___ Outcome ___ |
| CL-22 | *New (owner refinements 1 and 2).* A Parlay link's only settings are uses and expiry (plus its id, name, token digest, state and ledger as bookkeeping). Contact lists are first-class with a relationship policy (`can message you`, `request`, `receive only`). The most permissive policy applies, a block overrides, there are no per-person overrides in v1, and a policy change applies at once. Tags are plain labels. One rules engine places arrivals in lists, tags, holds, refuses or routes. Unmatched redemptions are held. Templates create link, rule and target list (§4.4). Delete or revoke offers removal of the link's rules and, optionally, of the people it admitted. | Reviewer ___ Date ___ Outcome ___ |
| CL-23 | *New (H3).* Leaked-invite bounds: default binding, "used by" notice with Block, and unbound-admitted and public-admitted contacts message-only until the owner replies. | Reviewer ___ Date ___ Outcome ___ |
| CL-24 | *New (M5).* v1 redemption is same-host only. Foreign redemption waits for the person directory and per-issuer budgets. | Reviewer ___ Date ___ Outcome ___ |
| CL-25 | *New (H5, M7).* A replacement key-delegation gate lands before `LINKS_ENABLED` is retired or any reset runs. | Reviewer ___ Date ___ Outcome ___ |

## 7. Change requests (none applied)

**links.md.**
- **CR-LK1.** Split it. §3.1 and §7.2 (minus link rows) go to the core identity-and-keys spec. §2, §3.2–§5 and §8 become an Organizations annex. §6, §7, §9 and §10 are deleted. AMD-L1 is withdrawn.
- **CR-LK2.** Envelope vectors 1, 3–7, 12 and 13 go to Organizations. Audience vectors 2, 8–11 and 14 are dropped. Pure-JWS vectors go with the profile.

**Core identity-and-keys spec (new or existing; Q2).**
- **CR-K1.** Host the signed-object profile and the signature-domain table.
- **CR-K2.** Repoint "links §3.1" in signaling (leg certificates, messages), identity-portability (move statements, AMD-P5/P11), messaging §3.2, intents and organizations.

**messaging.md.**
- **CR-M1.** §1: drop links, the links contract and `link-response`. Keep the directory and key delegation, by its extension URL.
- **CR-M2.** Replace §4 with "Invitations" (§4.3 of this spike): the `connect` kind, the `BindleInvite` scheme, handler duties, inviter processing order, results, the content-refusal rule, the optional display `hint`, and the explicit statement that uses, admission, rules, lists and relationship policy are application behaviour.
- **CR-M3.** Delete §2.3's descriptor, the `messaging-address` consumer, `linkRevoked` and the link wording in §2.1–§2.2. Keep the host-wide fetch rules, and state that they apply to redemption. Senders reach a person through an invitation or an established conversation.
- **CR-M4.** §5.1 `recipient`: replace `contactId`/`resource` with `invite`. §8.2 adds the `(owner, token digest, author principal)` namespace. §8.3: add `invite_invalid` (401); remove `link_malformed`, `link_invalid`, `audience_ineligible` and `audience_unavailable`.
- **CR-M5.** Rewrite §6.7 for the first-contact gate (CL-6).
- **CR-M6.** §6.3/§6.4: add the generic content-refusal-by-owner-policy rule (CL-21), and state that it uses the uniform `not_authorized`.
- **CR-M7.** Publish the CL-11 kinds.
- **CR-M8.** §9: "extensions §9.8" becomes protocol §3. Intake is the rev 3.1 fragment; the email bridge is a provider-published extension. The auto-reply is unchanged.
- **CR-M9.** The peer profile record (deferred).

**signaling.md.**
- **CR-S1.** §5.1: remove resolving the recipient from a contact link.
- **CR-S2.** §5.2 and §5.6: remove the `link` rows and the routing text that "shrinks to `link` invites".
- **CR-S3.** Remove §5.3, §20.3, `mint_link` (§10.2), the §14 link rows and the minted-parent revocation text. Amend SG-5 and §19.5.
- **CR-S4.** §9.1: remove `links` from the batch.
- *CR-S5 (CL-10) is withdrawn.*

**intents.md.** CR-I1: remove §11, AMD-I2 and the contact intents of `intents.v1`. CR-I2: `capability` format, a per-field bound, and §3.5 text without contact links. CR-I3: inline the parser; repoint §3.1, §3.3, §3.5, §8 step 6, §9.3 and §10 Tooling.

**organizations.md.** CR-O1: §5.1 and §9.4 reference the annex. AMD-O7's signature-domain rows go to the identity-and-keys spec.

**security.md and protocol.md** (coordinate with the agents editing protocol.md and extensions.md). CR-SEC1: the capability-handling rule; intents §9.3 points here. CR-P1: withdraw `intents.v1`'s contact-intents option and `link-response.v1`, and update the protocol example. CR-X1: withdraw the CR-X3-04 and CR-X3-23 `address-routing` conversion, and add the key-delegation `mailbox` occupant check.

## 8. Code plan (`npm test`, plus browser verification when implemented)

- **CR-C0. Safety first (H5); no behaviour change.**
  - Add a stateful `KEY_DELEGATION_ENABLED` flag, computed from live `key-delegation/` rows only. It gates `delegationsEnabled` (`identity/delegation.mjs:76`), the `account/identity.mjs:51` issuance check, `routes/delegation.mjs`, `routes/member-certificates.mjs:79` and the `providers.mjs` delegations row. Later it folds into rev 3.1 Messaging extension enablement.
  - Stop `account/flags.mjs:25` deriving anything from `link/` rows for delegation.
  - Re-home `MESSAGING_INGRESS_SLOT` to a non-links module (for example `packages/identity/messaging-ingress.mjs`, later the rev 3.1 `mailbox` fragment constant) for `delegation.mjs`, `apps/connections.mjs` and `federation/brokered.mjs`.
  - Move `PUBLIC_INTAKE_*` to `email-bridge`. Move `strictJSON`, `exactMembers`, `plainObject` and `jcs` (from `author-proof.mjs`) to `core/strict-json.mjs`, and JWS sign/verify to `core/signed-object.mjs`. Repoint RTC there.
  - **`validateDescribe` / `MESSAGING_DESCRIBE`.** First confirm whether the occupant port's `ingress` (`delegation.mjs:13,153`), which becomes the certificate's `client.ingress`, is fed by the validated `describe` result. If it is, move `validateDescribe` to the delegation side. Otherwise delete it together with `MESSAGING_DESCRIBE` (`routes/integrations.mjs`, `integration-ports.mjs:15`), and change their gate to `KEY_DELEGATION_ENABLED` meanwhile.
  - `intents/schema.mjs` gains `capability`.
- **CR-C1. Delete:**
  - `packages/links/{audience,author-proof,contact-profile,engine,handoff,issuance,parents,policies,preview,profile,replay,sharing-fields,types}.mjs` once CR-C0 has emptied their outside importers;
  - `identity/link-response.mjs`;
  - `runtime/account/{links,contacts,contact-profile}.mjs`;
  - `routes/{links,contacts,contact-profile}.mjs`;
  - the contact-path, `/oembed`, avatar, `/api/links/respond` and descriptor routes;
  - `LINKS_CONTRACT`, `MESSAGING_ADDRESS_DECLARATION` and `messagingAddressMounted` (`federation.mjs`, `account/storage.mjs`, `brokered.mjs`);
  - `collectLinkState`, `ContactProfiles` and `rtcContactBasis` in `runtime/accounts.mjs`;
  - `link/` references in `referencedSigningKids`;
  - `withdrawsSharing` use in `identity/age-policy.mjs`.
- **CR-C2.** Link envelope sign/parse to `packages/orgs/link-envelope.mjs` over `core/signed-object.mjs`; raw-query parser to `packages/intents/format.mjs`.
- **CR-C3. Intents:** remove `registeredIntentHandlers`, `/i/contact`, contact `INTENT_BUILTINS`, `legacy.mjs`, `CONTACT_INTENTS` (`routes/federation.mjs`), `canonicalContactLink` (`routes/intents.mjs`) and the hard-coded kinds.
- **CR-C4. Profile:** reduce to `/api/profile` (`displayName`, `avatar`).
- **CR-C5. Developer contact:** an eligibility read and a mint hook through the developer identity's Parlay grant. Remove the `policies.mjs` import.
- **CR-C6. RTC** (with the signaling.v1 migration; flags stay off): remove `endpoints.inspect`, `set-contact-rtc`, `rtc/contact/` and the ticket envelope use.
- **CR-C7. Flags:** retire `LINKS_ENABLED` and its `BINDLEBOX_ENABLED` alias **only after CR-C0**. Add a default-off Parlay flag for public links.
- **CR-C8. Web:** remove the contact-link landing, the sharing editor and the occupant developer card. Add "Message the developer".
- **CR-C9. Parlay:**
  - `InvitesCreate`, `InvitesRevoke` and `InvitesList` with templates;
  - the redemption path in the ingress;
  - the first-contact gate;
  - the `connect` handler in `web/bl/intents.mjs`;
  - first-class lists with relationship policies, the content-refusal rule, and the rules engine (admission and inbound);
  - the redeemer-side "Following" list and unsubscribe;
  - remove `ContactsCreateLink`, `ContactsRevokeLink` and the link edge-index entries.
- **CR-C10. Docs:** mark [bindle-links](bindle-links.md), [contact-link-previews](contact-link-previews.md), [intent-links](intent-links.md) "Registered kinds", [messaging-app §6](messaging-app.md#6-contact-links-core-envelope-app-type) and [system-identities-contact](system-identities-contact.md) as superseded by this spike.

## 9. Data reset (destructive cleanup acceptable: no real users, DEVLOG 2026-10-27, SQ-1)

`contact-links-retired-v1`, bounded and idempotent, in the style of `messaging-retired-v1`. It **runs only after CR-C0** (the delegation gate no longer reads `link/`). It deletes, in order:
1. the derived and transient families: `link-evaluations/`, `link-audience/`, `link-replay/`, `link-gc-cursor/`, `links-rpc/`, `link-change/`, `link-state/`;
2. `contact-sharing/`, `rtc/contact/`, `profile.bio` and `profile.discloseToContacts`;
3. `link/` records last among the data.

It then writes its marker last, and updates `export-contributors.mjs` (remove the `links` and `contact-sharing` families and the link prefix classifications).

**Keeps:**
- `contact-key/` (the identity signing keys, despite the name);
- `key-delegation/`;
- organization and relation invitations;
- `profile.displayName` and `profile.avatar`.

Keys pinned only by `link/` become prunable under normal key policy.

Parlay drops contact-link parents, link edge-index entries and contacts added from links (their principals were unverified claims), and seeds the "Contacts" list (`can message you`) from accepted conversation peers. This is logged in DEVLOG when implemented.

## 10. Phased order

No phase leaves Parlay unable to start a new contact, and none breaks key delegation.
1. **Specs.** All CRs in §7, coordinated with the extensions and protocol editors. Spec/implementation gaps go in DEVLOG.
2. **Safety gates (CR-C0).** The delegation gate, the module re-homing, the core signed-object and strict-JSON modules, the RTC repoint, and `capability` in intents. `npm test` must show no behaviour change.
3. **Parlay single-use invitations, alongside contact links.**
   - Covers CR-C9's single-use subset: the "Contacts" list, the first-contact gate, the Invite-a-person template, and the redemption and handler path with CL-19 and CL-20.
   - Developer contact switches to bound invitations (CR-C5).
   - Contact links still work, so there are two first-contact paths during the overlap.
   - Engine tests cover spend races, replay by principal, binding, expiry, uniform results, rollback, groups with non-contacts, and seeded redemption chaos. Browser tests cover intent handoff.
4. **Core removal and reset.** CR-C1 to CR-C4, CR-C7 and CR-C8, then the §9 reset, with engine-level and seeded chaos tests and `npm test`, `test:e2e` and the browser suites. Parlay's invitations already cover first contact, so removing links leaves no gap.
5. **Public and one-way links (flag, default off).** Multi-use links, the Website and Newsletter templates, the rules engine, first-class lists with `request` and `receive only` policies, the content-refusal rule (CL-21), the `hint`, unsubscribe, and the §4.5 safeguards.
6. **Signaling** `link` removal with the signaling.v1 migration (CR-C6, CR-S1 to CR-S4).
7. **Later, only if needed:** the peer profile record, foreign redemption (CL-24), requests (CL-7), organization allowlists, and a ticket basis.

## 11. Open owner questions (each with a recommended answer)

- **Q1. Website contact link template: place joiners in a `request` list, or in `can message you`?** **Recommend `request`.** A posted link is a public address. The owner vets each conversation a stranger starts and can move trusted people to "Contacts". Newsletter/follow uses `receive only`, which admits no inbound content.
- **Q2. Where does the signed-object profile live: a new short core `keys.md`, or a section of identity-portability.md?** **Recommend a new short `keys.md`** (profile plus signature-domain table). Portability is a separate concern, and several extensions reference the profile.
- **Q3. On the redeemer's side, is "Following" an ordinary `can message you` list (the publisher may also start new conversations), or does it need a narrower "this conversation only" policy?** **Recommend an ordinary `can message you` list.** It matches "the subscriber allowlists the publisher", adds no fourth policy, and unsubscribing (removal from the list) fully undoes it.

## 12. Review disposition

| Finding | Resolution |
| --- | --- |
| H1 links §3.1 is shared core | Split (§4.1, CL-2, CR-LK1, CR-K1/K2); intents references repointed (CR-I3) |
| H2 unverified ingress | Delegation certificate in data, status check, certificate ingress, §2.3 fetch rules, nothing sent first (§4.3, CL-19) |
| H3 leaked invitation blast radius | Two-party empty genesis, no `acceptListed`, used-by notice, message-only state, default binding (§4.4, CL-23); public links (§4.5) |
| H4 groups broken | First-contact-only gate, §6.7 rewritten (CL-6, CR-M5) |
| H5 key delegation broken | CR-C0, `KEY_DELEGATION_ENABLED`, re-homing, describe check, I1c inventory (§8, CL-25) |
| M1 cheap checks first | Inviter order (§4.3) |
| M2 races and rollback | Replay by `(token digest, principal)`, one pending redemption per account, self-created rollback with `returnControl.expiresAt` timeout (§4.3) |
| M3 CL-10 | Withdrawn; ticket basis noted (§4.6) |
| M4 requests | Deferred; developer contact via bound invitations (§3 C, §4.7) |
| M5 interop and step count | Same-host v1 (CL-24), honest flow and new-user path (§5) |
| M6 extensions rev 3 | §4.9, CR-X1, CR-P1, CR-M8 |
| M7 reset | Complete prefixes, ordering, export classification, `contact-key/` kept, phase gap removed (§9, §10) |
| L1 `handle` lure | Dropped |
| L2 viewed oracle | Fetches only after consent; disclosed (§4.3) |
| L3 multi-account | Hint rejected with reason; failure text (§4.4) |
| L4 email | Disclosed under H3 (§4.4) |
| L5 RTC imports orgs | RTC uses core signed-object module (§4.1, CR-C0) |
| L6 naming, effect, categories | `capability`, per-field bound, `send`, `personal-data` + `send-as-you` (§4.2, §4.3) |
| L7 CL-17 provenance | Cited as user decision; widening flagged (CL-17) |
| L8 identity moves | Re-key on verified move; bound invitations expire (§4.3) |
| L9 tier disclosure | Disclosed (§4.7) |
| L10 intents §9.3 pointer | CR-SEC1 |
