# Identity portability: moving identities between providers (design)

Status: **provisional design, 2026-10-22, revision 5.** Revision 5 closes every remaining open item. The decisions are P14–P19: the current recovery file (§1.1), pre-rotation deferred with rotation at reissue (§2.5), fork detection (§2.7), elevated resolution (§6.1a), tight verification (§6.2) and the timing parameters (§6.7). Each was **decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.** The user's own decisions (P11–P13, Q2–Q4) are unchanged. Revision 4 applies the user's later 2026-10-22 decisions: the 24 h person-move delay with disputes (M1, P12, §6.1a), and final admin-blocking rules for organization moves (M10, P13, §6.2). It also corrects an overstatement: pre-rotation alone does not close first-contact forks (§2.5–§2.6, T5). Pre-rotation and "original recovery file" stay open. "Elevated resolution" (§6.1a) and "tight verification" (§6.2) are the coordinator's proposals, unsigned. Revision 3 applies the user's 2026-10-22 decisions: Q1 accepted with conditions (§7.1), Q2–Q4 accepted, and M10 applied under the coordinator's reading (§6.2). The 24 h person-move delay (M1), pre-rotation and the meaning of "original recovery file" stay open. Revision 2 applies the confident fixes of [review round 1](#review-round-1) (IP-R1-…); its open items remain open. Design only: nothing here is implemented, routed, published or production-verified, and no code changed. Normative draft: [spec/identity-portability.md](../spec/identity-portability.md). Companion: [intent links](intent-links.md). It incorporates the constraints that organizations [review round 4](organizations-design.md#review-round-4) placed on this design (R4-H1 certification keys, R4-H2 transfer authority and stable identifiers), as relayed by the coordinator on 2026-10-22. It has not been independently reviewed. Every decision below is unsigned until it has a reviewer, a date and an outcome; the coordinator records them in DEVLOG.md.

Sign-off: reviewer ___ / date ___ / outcome ___.

## How moving works

Your identity is a permanent ID plus a signing key. A move takes both to a new provider. Your handle stays behind, and old links redirect for a while.

1. **You prove you are the owner now.** You need your newest recovery file, at least 7 days old, and a passkey or password you have had for 7 days. *Stops:* old copies of your file, and someone who has just taken over your account.
2. **Your key and your old provider both sign.** *Stops:* a key thief acting alone, or someone who buys a dead provider's domain.
3. **You wait 24 hours and are told on every channel.** Any device or email you already had can cancel or freeze the move. A frozen move never completes by itself. Stronger proof (your current file plus an old passkey) settles it, and ties go to support. A stolen phone can be removed, so it cannot freeze you forever. *Stops:* a move made in one sitting from your unlocked phone.
4. **The new provider replaces your key.** Old files then sign nothing anyone accepts, and links made before the move keep working. *Stops:* old files staying useful forever.
5. **Others remember who you were.** Contacts, apps and organizations keep your original ID and follow you only when both signatures check. *Stops:* fake redirects.
6. **Providers chain their own signing keys.** *Stops:* a lapsed-domain buyer fooling anyone who had seen that provider before. A verifier that never saw that provider is the remaining gap (§2.7).

Organizations wait 72 hours. Other admins can block an admin's move. The owner's move needs an old passkey and no recent security changes.

## 0. Decisions in one screen

| ID | Decision | Where |
| --- | --- | --- |
| P1 | A move keeps the UUID `sub` and changes the host. The signing key arrives unchanged and signs the move statement; the destination then rotates it (P11). Handles never move. | spec §1, §4 |
| P2 | Verifiers key every relationship by the **origin principal** `(iss₀, sub)` and keep a **successor pin** to the current host. Records of identities that never moved need no migration. | spec §8.1–§8.2 |
| P3 | Automatic adoption needs **two signatures**: a move statement by the identity's signing key, and an attestation by the old provider. Neither alone is authority. | spec §4, §5, §8.3 |
| P4 | The old provider attests only after **transfer authority**: the current recovery credential **plus** either a fresh step-up session (not within 7 days of a recovery) or a public 7-day waiting period with notices, cancellable by the current holder. Organizations additionally need current transfer authority under the provider's grant-management policy. Key possession or a superseded file never works. | spec §6.1 |
| P5 | HTTP 308 redirects are **routing hints** for browsers and clients, never authority. Proof travels in the destination's identity document (`moves`) and in the redirect body. | spec §7, §10 |
| P6 | At commit, the old provider revokes its certification keys, destroys its key copies and stops speaking for the identity. The destination mints fresh certification keys; verifiers learn them from the identity document at the pinned current identity URI. | spec §6.3, §7, §8.3 |
| P7 | Unattested moves (an old provider that will not or cannot attest) are never adopted automatically. A human at each verifier may adopt one after a warning, as an authority reset. | spec §8.5 |
| P8 | The interoperable key carrier is a **portable identity package**, not the recovery file format, which stays provider policy. | spec §9 |
| P9 | 3sln.me product: transfer-out with the current recovery file; 90 days of free redirects; a one-time 10-year redirect extension through Polar; a minimal moved tombstone. | §6 |
| P10 | 3sln.me accepts transfer-in from packages and from its own recovery-file format. | §7 |
| P11 | **Rotation at transfer-in, with provenance chained.** The destination rotates the signing key at activation by a continuity statement from the old key; 3sln.me always does. The key history stays published. A retired key is honoured only for artefacts recorded, or otherwise anchored, before the rotation, so pre-move contact links and messages through them keep working while old recovery files mint nothing new. Decided by the user, 2026-10-22 (Q1). | §7.1, spec §7.1 |
| P12 | **3sln.me person moves wait 24 h, and disputes hold or abort them.** A person move commits no earlier than 24 h after a notice to every channel. A dispute from a known device or confirmed email can hold the move until an elevated resolution, or abort it. A held move never commits by itself. Decided by the user, 2026-10-22 (M1). The resolution procedure is P17. | §6.1a |
| P13 | **3sln.me organization moves: admins can block an admin's move, never the owner's.** The requester can elevate to the owner. Owner decisions and owner-requested moves need tight verification. Decided by the user, 2026-10-22 (M10). Tight verification is P18. | §6.2 |
| P14 | **"The original recovery file" means the current one.** That is the file whose reset credential is the identity's live `recoveryHash` while the account is active, and that credential must have been issued at least 7 days before the move begins. Files superseded by reissue, recovery or rotation never qualify. Neither does a resume credential, nor a legacy v1 file. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §1, spec §6.1 |
| P15 | **Pre-rotation is deferred.** For now, every recovery-file issuance at 3sln.me rotates the signing key first, so a superseded file holds a retired key. Pre-rotation is revisited together with the move log (P16 stage 3). *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §2.5–§2.6 |
| P16 | **Fork detection, v1: chained attestation keys and verifier pinning.** Each attestation key after a provider's first is vouched for by an earlier one. Verifiers pin each provider's attestation keys. The `@3sln/bindle` SDK ships 3sln.me's root. The residual for verifiers that have never seen a provider is accepted. Upgrade path: shared pins, then an independent move log. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §2.7, spec §5.1, §8.6 |
| P17 | **Elevated resolution of disputed person moves: a proof ladder.** The tiers are a known channel, then elevated proof, then support. Elevated proof removes the disputing devices it names, and a further dispute goes to support. A held move with no resolution in 30 days aborts. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §6.1a |
| P18 | **Tight verification for organization owners is confirmed, tightened.** It requires an aged credential; the person recovery file is no longer an alternative. A security change in the last 30 days restores the admins' block. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §6.2 |
| P19 | **Timing parameters are confirmed** (7 d, 30 d, 24 h, 72 h, 30 d, 1 h), and the new ones are added. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* | §6.7 |

## 1. The user's words, and the constraints

The user (2026-10-22, verbatim excerpts): "Like user identities, there's an underlying stable UUID, the more human friendly aliases are just that, aliases/pointers/handles for the underlying stable UUID. We should consider a spec that lets an old provider (for identity or an org) redirect to a new provider, in case an identity moves; actually http already covers this with their 'moved' redirect code; which we can probably leverage here. We can't mandate it, but 3sln.me should let users transfer their identities (they must have the original recovery file to do so) to a new provider; and tell us about it, so we can redirect their bindle endpoints, including directory requests etc. We can guarantee at least 3 months of free redirects, and offer a cheap 10 year redirect extension, to keep their contact links, other app minted links, etc stable." And: "Be careful about which parts go into the bindle spec and which parts are 3sln.me/provider choices/details."

Review round 4 constraints, as the coordinator relayed them:

1. Key possession alone must not authorize a transfer. Require the recovery file plus a step-up session, or the file plus a public waiting period with notices and cancellation by the current holder. A superseded file must never work.
2. Organization transfers also need current owner authority under the grant-management policy (since 2026-10-22, the "membership and grant policy" of organizations spec §6.3).
3. Verifiers keep the original `(iss, sub)` as the stable identifier and pin a signed successor statement. Redirects are a discovery hint only.
4. Define how certification keys are re-established at the new provider, and how verifiers learn of them.

### 1.1 What "the original recovery file" means (P14)

*Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.*

"Original" means **authentic and current**, not "first issued". Until P15 is implemented, every file 3sln.me issued for an identity holds the same signing key, so the first file proves nothing that a former organization owner's superseded copy does not also prove. What separates the owner from an old copy is the reset credential, which only the newest file carries. The user's intent ("they must have the original recovery file") is proof of ownership, and only the current credential is that proof.

| File | Transfer authority? | Why (code read 2026-10-22, `packages/identity/service.mjs`) |
| --- | --- | --- |
| The newest file, whose credential matches `recoveryHash` while the account is `active`, issued ≥ 7 days before the move begins | **Yes** | This is the only credential that would start a recovery right now. |
| The newest file, issued < 7 days ago | No; the owner waits | `downloadRecovery` needs only a set-up or signed-in session. Without the age rule, someone who has hijacked a session could reissue the file and use it at once, and the file would add nothing to the session. This matches the 7-day credential-age rule of spec §6.1(a). |
| A file superseded by a later reissue (`downloadRecovery` replaced `recoveryHash`) | No | It is no longer current. With P15 it also holds a retired key. |
| A file used for a recovery (`recover` moved its hash to `recoveryResumeHash`) | No | It only resumes that one recovery transaction, while the account is `recovering`, and spec §6.1 item 1 refuses moves of an account that is not active. Confirming the replacement file deletes the resume hash. |
| A file from before a signing-key rotation (P11 at transfer-in; P15 at reissue) | No | Rotation always issues a new file in the same flow, so the old credential is already superseded. |
| A legacy v1 file (handle and token, no keys) | No | It cannot build a package. The owner downloads a v2 file first (§6.1), and that new file must age 7 days. |
| The source provider's file, at the destination after transfer-in | No | The destination issues its own file at activation (§7). That file is the current one for any later move, after it has aged 7 days. |
| An organization's file | Satisfies spec §6.1 item 2 only | The acting person still needs their own aged credential and the organization's transfer authority (spec §6.1 item 4; §6.2). |

Rotation itself is decided (P11).

## 2. Model

### 2.1 What moves and what does not

| Thing | After a move |
| --- | --- |
| `sub` (UUID) | Unchanged. It is the identity. |
| Signing and encryption keys | Arrive unchanged; the signing key signs the move statement. The destination then rotates the signing key with continuity (P11; 3sln.me always). The old key stays published as `retired` and honours only artefacts recorded before the rotation (§7.1). |
| Origin principal `(iss₀, sub)` | Unchanged. Every verifier's stable key. |
| Issuer, identity URI | New, at the destination. |
| Handles | Do not move. Old handles stay claimed forever at the source (names are never reassigned) and resolve to a redirect only during the redirect period. The destination assigns handles in its own namespace. |
| Certification keys | New, minted by the destination. The source's are revoked at commit. |
| OAuth grants, tokens, sessions | Do not move (protocol §1). Applications reauthorize at the destination. |
| Memberships and edges others hold for the identity | Survive, because they are keyed by origin principal. Adoption is an authority reset, so owner-interface authority is held until re-confirmed (organizations §5.2a). |
| Issued capabilities (contact links) | Survive only if the destination imported their exact stored records. Redirects bring requests to the destination, which verifies them against the reconstructed original URL, under the retired key when the record predates the rotation (§7.1). |
| Data, resources, resource URLs | Move only through export and import, outside the move protocol. Resource URLs change, so counterparts re-consent. |

### 2.2 Why two signatures, and why redirects are not authority

- **A statement alone** is a key-possession proof. Every recovery file ever issued for the identity carries that key: a former organization owner's copy, a cracked stolen copy, a file superseded by reissue. Accepting statements alone makes every old file a standing hijack tool (R4-H2).
- **An attestation alone** would let whoever controls the old domain redirect identities, including someone who bought an expired domain and republished a manifest. Requiring the identity's signature means a domain takeover cannot move identities, because the key copies were destroyed at commit and a new domain owner never had them.
- **Both together** say: the key holder chose this destination, and the provider that knew the identity's live recovery state, sessions and channels verified that the key holder is the current controller.
- **Redirects** prove only that some server answered with a `Location`. Caches, CDNs and misconfigurations can produce them, and browsers cache 308s aggressively. They are useful for getting browsers and old links to the right place, and nothing more.

The residual trust is the one that exists today: a provider custodies its users' keys, so a malicious source could forge both signatures for identities it hosts. Moving away from a provider is exactly the case where that provider is trusted one last time.

### 2.3 Why the origin principal

Organizations keep memberships, ERP records and relation edges keyed by `(iss, sub)` (organizations §5.3). If a move changed the key, every one of those would need a rekey at every verifier, and a verifier that missed the move would hold a dangling record. Keying by origin principal means a move changes only where the verifier fetches the identity document and which issuer it accepts certificates from. For the overwhelming majority of identities, which never move, origin principal and `(iss, sub)` are the same pair, so no existing record changes.

### 2.4 Alternatives considered

| Alternative | Why not |
| --- | --- |
| Redirects as authority | §2.2. Also caches make mistakes permanent. |
| Key-signed successor statements only | R4-H2: superseded files and former owners. |
| Custom-domain issuers (the domain owner repoints DNS) | Works for organizations with domains, and remains possible: such an identity never needs a move. It does not help the `n.…@3sln.me` users who are the common case, and a domain lapse is itself a takeover vector. |
| DID-style self-certifying identifiers | A new identifier scheme for every relationship, and still needs a revocation and recovery story equal to this one. |
| Pre-rotation (a committed next key, as in KERI) | **Deferred (P15, §2.5).** Revision 3 said that only pre-rotation closes the first-contact fork (T5). **That overstated it.** Pre-rotation separates the provider-held signing key from a next-key rotation authority, so a leak of the signing key cannot rotate or move the identity. It does not stop someone holding an *old* rotation key from writing an alternative history that branches where that key was used. Only an independent record (witnesses or an append-only log) or a verifier's own pin detects such a fork. |
| Moving the recovery file format into Bindle | Freezes answer normalization, Argon2 parameters and question types into the protocol. The portable package (spec §9) is enough: the source's own page decrypts its own format and hands the package to the destination. |

### 2.5 Pre-rotation, in plain terms (answers the user's questions of 2026-10-22; decided as P15 below)

**Is it only for rotating keys inside one provider?** No. It would govern every rotation: inside a provider, at recovery and at a move. It splits two jobs. The provider keeps the key that signs day to day. A separate "next key", held only by the owner, is the only thing that can replace it, so a leak of the provider's copy cannot rotate or move the identity.

**How does it interact with recovery files?** The file would hold the next key instead of the signing key. Using the file (to recover, rotate or move) spends that key: the provider publishes the rotation, commits to a fresh next key and issues a new file. An old file then signs nothing anyone honours. Its holder can still write an alternative history branching where that key was used. Anyone who already knows the identity spots it; someone meeting the identity for the first time cannot without an independent record to compare. Revision 3 overstated this: pre-rotation alone does not close that gap.

**What about things already signed, such as contact links and tokens?** Unaffected. They keep verifying through the published key history, under the Q1 rule that a retired key is honoured only for what was recorded before the rotation. New tokens use the current key. Certificates and intent links use separate certification keys.

**Decision (P15).** *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* Do **not** adopt pre-rotation in v1. Instead, **rotate the signing key at every recovery-file issuance** (3sln.me policy). Revisit pre-rotation together with the move log of §2.7 stage 3.

Why defer it:

1. **What it would buy here is mostly bought already.** Its first benefit is that a leak of the provider-held key cannot rotate or move the identity. But a move already needs the current credential and the source's attestation (P3, P4), not just the key. Verifiers also accept a rotation only from the live identity document at the pinned URI (organizations spec §3a.4), so a leaked key cannot publish one. Its second benefit is that old files sign nothing. Rotating at reissue (below) gets the same for files superseded by reissue or recovery, and P11 gets it for every file issued before a move. Its third hoped-for benefit, closing first-contact forks, it does not deliver alone (§2.6).
2. **Its cost lands on every owner.** The provider could no longer rotate on its own. Every rotation, including one after a suspected provider-side leak, would need the owner to load their file. An owner who lost the file could only do a key reset without continuity, which counts as an authority reset at every organization and peer.
3. **It is a format migration.** It needs a v3 recovery payload holding the next-rotation key instead of the signing key, a package without a signing key (the destination would mint one, which pre-rotation's move statement commits to), new continuity semantics in `keys.mjs`, and a migration that retires the key in every existing v2 file. That is a large change to custody code for a small gain now.

**If it is adopted later, the shape is fixed now so nothing built today blocks it:**

- **One file, not two.** The file holds the reset credential and the next-rotation key Rᵢ. It does **not** hold the signing key, which the provider alone custodies. A second "cold" file for Rᵢ was rejected: owners lose one of two files, and a split doubles the number of things they must keep.
- **Spending.** A recovery, a rotation or a move is signed by Rᵢ. It publishes the event with a digest of Rᵢ₊₁, and the provider immediately offers the new file holding Rᵢ₊₁. That is the same "download your new file" step that recovery and P11 already have. The provider never holds Rᵢ.
- **The provider-custodied signing key** becomes a key that Rᵢ authorizes through the key event. The provider rotates it only by asking the owner for the file, or under a standing delegation that Rᵢ signs once and that verifiers bound by `aep`. That choice is left to the later design.
- **Moves.** The move statement is signed by Rᵢ and names the destination's fresh signing key. P11's activation rotation becomes that event. Earlier artefacts are unaffected (§2.6).

**Interim: rotate at reissue** (3sln.me policy; the identity and recovery owners implement it, see §13). Every `downloadRecovery`, both a reissue on an active account and the replacement file after a recovery, first rotates the signing key with the existing `keys.mjs` continuity statement, and puts the new key in the new file in the same commit. The superseded file's key becomes `retired` and verifies only artefacts recorded before its retirement (spec §7.1). So a former organization owner's or a thief's superseded copy can no longer forge link responses or author proofs (R4-L2; T2 before a move). It depends on PORT-9: bearers must be signed with the current key, and retired keys that live records reference must never be pruned. If the 16-key history is full of referenced keys, issuance proceeds **without** rotating and the audit records it. This is a known edge, not a failure.

### 2.6 Pre-rotation: analysis behind §2.5

- **Today.** The signing key K is in every recovery file and in provider custody. A continuity statement is signed by the predecessor key, so anyone holding K can name any successor. Within one provider this is contained, because only the provider's live identity document publishes rotations (organizations spec §3a.4). Across a move it is not: with K and a leaked attestation key or a lapsed source domain, a forged chain verifies for first-contact verifiers (T5, spec §8.6).
- **Pre-rotation, as it would fit here.** Each key event publishes a digest of the next rotation key R₍ᵢ₊₁₎. A rotation, or a move statement, must be signed by the key matching the previous commitment. The provider custodies the signing key S, and the current recovery file holds only Rᵢ. Then:
  - a leak of S, or the provider's custody, cannot rotate or move the identity (an improvement over today, where S = K is the authority);
  - an old file cannot sign artefacts, so the R4-L2 and T2 residuals (an old file forging link responses and author proofs) close even without a move;
  - an old file holding a spent Rᵢ can still produce a second, validly signed event *at position i*. Pre-rotation makes a fork need the specific file for that position, but does not make a fork invalid. KERI detects this *duplicity* with witnesses, which receipt the first event they see, and watchers, which compare. Without such a record, a first-contact verifier sees two valid histories and cannot tell which came first.
- **What closes first-contact forks.** An independent append-only record of key events that verifiers consult (a witness set or a transparency log), or verifiers' own pins (already in spec §8.3–§8.4). The spec §8.3 item 5 check ("the source has let go") covers the case while the source is alive.
- **Recovery and lost files.** Recovery would spend Rᵢ and issue a file with Rᵢ₊₁. The provider must not hold Rᵢ, or a provider leak would rotate again. An owner who loses the current file therefore cannot rotate with continuity. Their recovery (by email or support) becomes a key reset without continuity, which counterparts already treat as an authority reset (organizations spec §5.2a).
- **Moves.** The current file's Rᵢ would sign the move statement, which fits the existing rule that a move needs the current file (spec §6.1 item 2). The destination commits to a new next key and issues its own file, so P11's activation rotation becomes a pre-rotated event.
- **Earlier artefacts.** Unchanged: the key history plus the recorded-issuance rule (spec §7.1) keep pre-rotation links, contact tokens and stored messages valid. Pre-rotation changes which key may *rotate*, not which signatures verify.
- **Pre-rotation and witnesses belong together.** Pre-rotation makes a fork need the specific file for one position. Witnesses or a log make such a fork visible. Each is weak without the other, so P15 defers pre-rotation until §2.7 stage 3.

### 2.7 Fork detection for first-contact verifiers (P16)

*Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.*

**The threat, realistically.** To fork a moved identity's history for someone meeting it for the first time, an attacker needs all of the following:

1. a recovery file whose key was active at some earlier host. Under P11 and P15 that means a file from before the real move that was never superseded by reissue, cracked through Argon2id and the owner's answers, or held by a former organization owner;
2. the ability to attest as that host. That means re-registering its lapsed domain and republishing a manifest, an attestation JWKS and a directory that answers "moved" (which passes spec §8.3 item 5), or a leaked attestation private key;
3. a verifier that has no pin for the identity and no knowledge of that host's real attestation keys, *and* that links the identity to something of value. In practice that is an application linking an existing account (spec §11), because organizations and peers that hold relationships also hold pins (spec §8.2).

The gain is a takeover of the victim's account at such applications. In v1 the only implementation, and so the only source, is 3sln.me, which commits to keeping its domain and attestation keys for as long as it operates (§6.4). The realistic case is a later small provider that shuts down and lets its domain lapse.

**Options weighed.**

| Option | Closes | Cost | Verdict |
| --- | --- | --- | --- |
| Accept the residual as is | Nothing | None | Too weak: a lapsed domain gives the attacker a new attestation key at no cost. |
| Keep a digest at the source after the redirect ends | Nothing for a lapsed domain, because the attacker controls what the domain then serves | Contradicts the user's Q3 privacy decision in spirit | Rejected. |
| **Chained attestation keys plus verifier pinning** | Forks for every verifier that has seen the source's real attestation keys before. A lapsed-domain attacker cannot vouch a new key into the chain without an old private key. | Small: one signature per new attestation key, and a per-issuer pin set | **v1.** |
| Witnesses: independent parties that countersign each move | Forks for verifiers that require witness receipts | Needs independent operators who do not exist yet, and a receipt protocol | Later (stage 3). |
| Append-only move log, indexed by origin principal (CT-style tree heads, inclusion and consistency proofs) | Forks for any verifier that trusts one honest log: the first record logged for a position wins, and a later different one is equivocation | Log operators (at least two independent ones to mean anything), tree-head gossip, submission at activation | Later (stage 3). |
| The artefact store as that log | — | The store (artefacts §8) is per-provider pinned storage that is addressed by digest. It has no authenticated lookup by origin principal and no signed tree heads, so it cannot prove that a second record does *not* exist. | Not as the log. A future log can reuse its record-digest encoding and the `artefact-mirror.v1` route shape. |
| A public generic log (for example Sigstore Rekor) | Timestamping only | Its search index is not authenticated, so it cannot show that no conflicting record exists. It is an external dependency with no service commitment. | At most an extra timestamp anchor in stage 3, never the fork check. |

**v1 design (spec §5.1, §8.3 item 3, §8.6, §11).**

- **Chained attestation keys.** Every attestation key except a provider's first (its root) carries `continuity`. This is an ES256 signature by an earlier key that is still listed, over the new key's RFC 7638 thumbprint, under domain `bindle-attestation-key-continuity-v1`. Yearly rotation (spec §5.1) therefore always extends one chain.
- **Pinning.** A verifier pins, per issuer, the thumbprints of the attestation keys it has accepted. On first contact with an issuer it pins the whole chain from the root (trust on first use) and records that it did so. A key enters automatic adoption only if it is pinned, or chained from a pinned key that is still listed. A set with no chain to the pins is an **attestation reset**: records signed by keys outside the chain are not adopted automatically. They fall to the §8.5 human path, and operators are alerted. Existing pins and adopted moves are untouched.
- **The 3sln.me root ships in the SDK.** `@3sln/bindle` and 3sln.me's own verifiers carry 3sln.me's attestation root thumbprint, so nobody ever trusts 3sln.me's attestation keys on first use (3sln.me policy).
- **First-use linking.** If verifying a chain required pinning any source's attestation keys for the first time, the result says so (`attestation_first_use: true`). An application SHOULD then confirm account ownership through its own channel (for example the email it holds for the account) before linking an existing account (spec §11).

**Upgrade path.**

1. **Stage 1 (v1, above).**
2. **Stage 2, shared pins.** Providers that declare portability MAY publish the attestation-key pins they hold for other issuers, with first-seen times. Before trusting an issuer on first use, a verifier MAY consult the providers its operator configured. Disagreement counts as an attestation reset. This is a cheap witness that needs no new operators. *Trigger:* a second independent provider declares `portability.v1` as a source.
3. **Stage 3, a move log, with pre-rotation.** Destinations submit each attested record at activation to a Bindle move log run by at least two independent operators. The log is indexed by origin principal, with signed tree heads and witness cosigning. Inclusion proofs ride in `moves`. First-contact verifiers require a proof from a log they pin, and query it for conflicting records. Pre-rotation (P15) is adopted at the same time. *Trigger:* any observed fork or equivocation in the wild, or three or more independent sources.

**Residual (accepted).** A verifier that has never seen a source's attestation keys, gets no stage-2 answer, and meets a chain forged with an old unsuperseded file plus that source's lapsed domain. The first-use flag tells applications when they are in that case.

## 3. Flows

### 3.1 Cooperative transfer starting at the source (3sln.me transfer-out)

1. Alice, signed in at 3sln.me, opens **Move my identity**. 3sln.me requires a passkey or password step-up and shows what moves and what does not (§2.1), the redirect offer (§6.4) and a recommendation to export first.
2. Alice loads her recovery file in the isolated first-party recovery document (the same no-third-party-script page as restore, [recovery file](../spec/recovery-file.md#browser-and-service-integration)) and enters her answers or passphrase. The page decrypts locally. 3sln.me's server checks the decrypted reset credential against the current recovery hash and the keychain against the account's keys, without consuming the credential. A superseded or consumed credential fails generically.
3. Alice names the destination by a handle or host. The page discovers its manifest and requires `portability.v1` with `transfer_in_endpoint`. It shows the destination's origin, highlighting the registrable domain.
4. 3sln.me records a pending transfer (`transfer.id`, 7-day expiry). The isolated page builds the portable package from the decrypted file, **without the reset credential**, and form-POSTs it to the destination's `transfer_in_endpoint`.
5. At the destination, Alice signs up or signs in. The destination checks the package, stores the keys, assigns an identity URI, signs a move statement and POSTs it with `transfer.id` and its `redirect_base` to 3sln.me's `move_endpoint`.
6. 3sln.me matches the pending transfer, re-checks every condition of spec §6.1 at commit, attests and commits (spec §6.3; §6.3 and §6.5 here). The response carries the attestation.
7. The destination verifies the attestation, appends the record to `moves`, mints certification keys and activates.
8. 3sln.me notifies Alice's channels, starts redirects and begins the moved-account lifecycle (§6.5).

### 3.2 Starting at the destination

Alice names 3sln.me as her old provider at the destination. Because 3sln.me declares `portability.v1`, the destination does **not** ask for her 3sln.me recovery file (decrypting it would show the destination her current reset credential, which is transfer and recovery authority here; IP-R1-M9). It sends her to 3sln.me, which runs steps 1–4 of §3.1, recording the destination origin and a `transfer.id`, and delivers the package to the destination's `transfer_in_endpoint`. A key holder who posts statements to 3sln.me first gains nothing: statements without an authorization create no blocking state (spec §5.2). Deriving a package from a recovery file at the destination is reserved for sources that cannot attest (§3.4).

### 3.3 Waiting-period path

For an owner who has the current file but cannot sign in (lost passkey and password, email login disabled): at the `authorize_url`, 3sln.me accepts the file without a session and starts a **7-day** public waiting period. It immediately notifies every verified email, push subscription and active session, and every email removed or replaced in the last 30 days, naming the destination. Each notice carries a one-click cancel link that needs no sign-in. Any fresh sign-in can cancel; any recovery, credential reset, credential enrolment or contact-channel change during the period cancels automatically, and the cancel page offers to reissue the recovery file (spec §6.2).

The path **cannot start within 7 days after a recovery, credential reset or contact-channel change** (spec §6.1(b), IP-R1-H1). Recovery at 3sln.me is immediate (`IdentityService.recover` wipes the previous owner's credentials and sessions at once), so without this rule a thief with the current file would recover, lock the owner out, and start a waiting period whose notices reach only channels and sessions the thief now controls, with the dispossessed owner unable to sign in to cancel. A recovery-derived controller therefore waits at least 14 days, during which the previous owner's channels are told twice and support can intervene.

### 3.4 Uncooperative source

When the source has no `portability.v1`, refuses, or no longer exists, the destination can still host the identity from a recovery file it can read, as an **unattested** move. Verifiers never adopt it automatically (spec §8.5). Each counterpart decides:

- a BindleBox peer's owner sees "Alice says she moved to `b.example`. Her old provider did not confirm this" and may adopt;
- an organization's operators see a pending successor for a member and may adopt it, which holds owner-interface authority as any authority reset does;
- an application treats the user as new unless it links accounts after its own checks.

This is the honest limit of "we can't mandate it". It is also where social engineering concentrates, so the warning copy matters (threat T9).

### 3.5 Returning

An identity that moved away from 3sln.me can move back. Its chain shows that it moved out of 3sln.me, so the `sub` is not "already used" (spec §9.3). The return gets a new identity URI and a higher `seq`. The old tombstone's redirect ends, and its names stay claimed. Whether the returning identity regains its old handles is a 3sln.me choice. **It does, on an attested return only**, because the permanent claim ledger still binds them to this `sub`. An unattested return (Q4) gets a fresh handle, because its chain is not verified. *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.*

## 4. Verifiers in practice

| Verifier | Learns of the move by | What changes |
| --- | --- | --- |
| Organization (member moved) | Background refresh of the member's pinned identity document receives the 308 and the moved record; or the member presents `moves` (verified in the background, R2-H1) | The successor index maps `(new iss, sub)` to the membership's origin principal. Certificates from the old issuer fail. Owner-interface authority is held until re-confirmed. Membership ID and grants are unchanged. |
| Organization's counterpart (organization moved) | The same, for entity certificates | Edges keyed by origin principal survive. The counterpart's raised `aep` floor stops pre-move certificates. |
| BindleBox peer | A message whose author is `(new iss, sub)`: the receiver resolves the new identity document, sees `moves`, verifies the chain and matches the origin principal (request-path fetches are allowed in BindleBox) | Peer records keyed by origin principal continue. Conversations continue after `rejoin` from the new occupant. |
| OAuth application | A token response with `bindle_origin` and `bindle_moves` | The SDK verifies the chain and the app links the account. Without verification, a new user. |
| Link owner (contact link opened by a moved audience) | Audience resolution through the successor index | Eligibility history keyed by origin principal continues. |

**Certification keys** (R4-H1, constraint 4). They are provider-held and never in a file or a package, so they cannot move and do not need to. The destination mints its own when it activates. Verifiers learn them the only way they learn certification keys at all: from the live identity document, now fetched at the pinned current identity URI, which the attested move record established. Between the source's commit and a verifier's adoption, certificates fail at that verifier: the source's keys are revoked, and the destination is not yet pinned. The gap lasts at most until the verifier's next background refresh (minutes under organizations §3a.4), and clients retry with the uniform error. The attestation's `aep` lets verifiers keep their epoch floor across the move, so pre-move certificates can never be replayed against the destination.

## 5. Redirects: what 3sln.me redirects

| Route | Redirected? |
| --- | --- |
| `/.well-known/bindle/manifest.json`, `/oauth/*`, `/bindle/rpc`, revocation | No (host-level). The authorization request answers `identity_moved`. |
| Directory `?handle=` for the moved identity's handles, and `?sub=` | Yes, 308 to the destination's directory path. |
| `/identity/<sub>` and its subtree, including `identity.json` | Yes, with the moved-record body, except delegation status. |
| `/identity/<sub>/delegations/<jkt>` (key-delegation status) | No. Answers the final `revoked` status itself: delegations died at commit (spec §6.3, §10). |
| `/users/<handle>/contact/<id>` (both URL forms), its avatar, oEmbed and representations | Yes, with `no-store`. |
| Contact delivery and BindleBox ingress addressed to the identity | Yes (308 keeps POST). Senders re-send after verifying (spec §10). |
| Intent-link endpoint | No. Intent links are not per-identity, and 3sln.me keeps serving them for anyone ([intent links](intent-links.md)). |
| Pages that name the identity (public profile) | Yes. |

## 6. 3sln.me as the source (product rules, not spec)

### 6.1 Persons

- Entry: account settings, behind `IDENTITY_TRANSFER_OUT_ENABLED`. Requires step-up and the current recovery file, issued at least 7 days before the move begins (§1.1, P14). Accounts with a legacy v1 file (no keys) must first download a v2 file, which requires a session and then ages 7 days.
- Refused while the account is suspended, deleting, under an admin or legal hold. Within 7 days of a recovery, credential reset, credential enrolment, contact-channel or email-login change, neither path is available (spec §6.1); the owner waits, then uses either path.
- Path (a) sends the pending-move notice to every channel at confirmation, before commit (spec §6.1(a)).
- One pending transfer per account. It expires after 7 days without a statement.
- The final confirmation names the destination origin and lists the consequences in plain words: "3sln.me will stop speaking for you. Apps connected here lose access. Your contact links keep working only if your new provider imports them."

### 6.1a Person moves: 24 h delay and disputes (M1, P12)

Decided by the user, 2026-10-22: "Okay to the 24 hour delay, and a dispute from a known device/email can prolong or abort it until resolved by some elevated means." This is 3sln.me policy, allowed by spec §6.1 ("It MAY require more").

1. **Delay.** A person move commits no earlier than **24 h** after the pending-move notice has gone to every current channel and active session. On path (a) the 24 h runs from confirmation. Path (b) already waits 7 days, and the rules below apply during it too. The move **begins** at confirmation (path (a)) or at the start of the waiting period (path (b)).
2. **Who can dispute.** A **known device**: a session, or a passkey, enrolled before the move began. Or a **confirmed email channel**: an address verified before the move began, including one removed or replaced in the 30 days before (as for path (b) notices). Every notice carries a dispute link that needs no sign-in. Devices and channels added after the move began cannot dispute.
3. **What a dispute does.** The disputer chooses:
   - **Abort.** The move is cancelled under spec §6.2, and the cancel page offers to reissue the recovery file.
   - **Hold.** The move is frozen. A held move **never commits by itself**, at any age. It ends only by an elevated resolution (item 4), by the requester withdrawing it, or by any disputer turning the hold into an abort.
4. **Elevated resolution (P17).** *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* It replaces the coordinator's earlier proposal, keeping its structure. Proof is ranked, the stronger tier wins, and nothing commits by itself:

   | Tier | Proof | What it can do |
   | --- | --- | --- |
   | 0, known channel | A known device (a passkey enrolled, or a session created, before the move began) or a confirmed email (verified before the move began, including one removed or replaced in the 30 days before it) | Abort or hold (item 3). Nothing else. |
   | 1, elevated proof | All of: (i) the current recovery credential, current for ≥ 7 days (P14), loaded in the isolated recovery page; (ii) a step-up, now, with a passkey or password enrolled ≥ 7 days before the move began; (iii) no authority reset of the account in the last 7 days | Settle against tier-0 disputes, as below. |
   | 2, support | Support-assisted verification out of band: channel and credential ages, billing records, prior devices, audit history. Audited, with a second operator for a commit. | Final within 3sln.me. |

   - **Elevated proof on the disputing side** aborts the move at once and **reissues the recovery file in the same action** (mandatory, not offered), so the requester's copy stops being current. Abort is the safe direction, so it needs no tie-break.
   - **Elevated proof on the requesting side** (path (a) only) names the disputing devices and emails. 3sln.me revokes the named sessions and **removes the named passkeys**; removing only a session would let a stolen device with a synced passkey sign in again. It detaches the named emails, which then count as channels removed in the last 30 days. A **fresh 72 h notified delay** starts, with notices to every remaining channel and to channels removed in the last 30 days. Removing disputers this way does not cancel the move, unlike other channel or credential changes during it (spec §6.1(a)–(b)). The requester may also do this when restarting after a tier-0 abort, naming the device or email that aborted. That is how a repeated abort is overcome.
   - **Contested, so support decides:**
     - any dispute during the fresh 72 h, from any remaining known device or confirmed email, or from a removed email through its notice link. There is no second self-resolution;
     - elevated proof presented on both sides of the same move;
     - within 30 days after an elevated-proof abort, a recovery-file reissue, an elevated proof or a move request by a credential other than the one that aborted.

     A contested account's transfer-out is locked until support decides. Support may abort and keep the lock for up to 30 days, or allow the move, which commits after a final 24 h notified delay and only if the requester still holds the current credential.
   - **Path (b)** requesters have no session, so they cannot reach tier 1. A tier-0 hold on path (b) is resolved only by support, or by the requester withdrawing. Any sign-in already cancels path (b) (spec §6.1(b)).
   - **Held moves expire.** A held move for which nobody starts a resolution within **30 days** is aborted. Abort is the safe direction, and an unresolved hold otherwise never ends.
5. **The abuse case: one stolen device.** An attacker with one known device but no current recovery file keeps disputing a legitimate move. The owner settles with elevated proof, naming that device. Its sessions and passkey are removed, it cannot dispute again, and it gets no further notices. The move commits after the fresh 72 h. If the attacker instead aborts each time, the owner restarts with elevated proof naming the device, with the same effect. If the attacker also holds the current file and an aged credential, the proof is equal, and the 30-day rule or the second-dispute rule sends the account to support. That is intended: cryptography cannot tell the two apart, and a held move never commits. If the stolen device's dispute comes from an email the attacker controls, removing that email sends any further dispute to support, so the attacker's power ends at a support decision, not at their choosing.
6. **The reverse case.** An attacker holding the owner's device and file starts the move. The owner aborts from any known device or confirmed email; aborting needs no proof. Any ordinary channel or credential change by the attacker cancels the move (spec §6.1). If the owner held instead of aborting, and the attacker settles with elevated proof by removing the owner's disputing devices, the owner's remaining channels, or a removed email through its notice link, can dispute again during the fresh 72 h. The move then goes to support.
7. **Rate.** A requester whose move was aborted by dispute cannot restart with the same credential until the owner has chosen whether to reissue the file (spec §6.2, IP-R1-M2). The only exception is a restart with elevated proof under item 4, which is that choice made by the stronger proof.

### 6.2 Organizations

On top of spec §6.1 item 4, 3sln.me applies its [grant-management policy](organizations-design.md#12b-3slnme-grant-management-policy-app-feature-not-spec) ([organizations §12b.5](organizations-design.md#12b5-organization-moves-m10-decided-by-the-user-2026-10-22)). **Decided by the user, 2026-10-22 (M10, final):** other admins can block an organization move, but not one the owner requested; the owner is more privileged; "these elevations need tight verification because they're quite dangerous."

- **Who may request.** The **owner of record** (§12b.1), or any admin. The requester completes the transfer-authority steps: a passkey step-up and the organization's current recovery file (its generated passphrase, R4-M5).
- **72 h notified delay** after confirmation, with notices to every admin and member.
- **Admin-requested moves.** Any other admin may **block** the move during the delay; a blocked move does not proceed. The owner may cancel it at any time. The requester may **elevate** a blocked move to the owner, under the shape of [organizations §12b.2a](organizations-design.md#12b2a-who-decides-and-when-user-decision-2026-10-22): it stays pending until the owner accepts or rejects it, the requester retracts it, or every blocking admin withdraws their block. No timeout decides it. If the owner accepts, the owner's decision is subject to tight verification, and the 72 h delay then runs again from the decision.
- **Owner-requested moves.** Admins **cannot block** them. An admin may **object**: the objection is recorded and notifies the owner and every admin again, and extends the delay to 14 days. Only the owner can cancel.
- **Tight verification (P18).** *Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* It keeps the coordinator's proposal with one change: the owner's person recovery file is no longer an alternative to an aged credential. That file is exactly what someone who took over the owner's account is most likely to hold, and it says nothing about continuity of control. An owner without an aged credential waits until one has aged. It applies to the owner's acceptance of an elevated move and to every owner-requested move:
  1. a step-up with a passkey or password enrolled more than 7 days earlier (for an owner-requested move, together with the organization's current recovery file, which every requester presents);
  2. no security change on the owner's person account in the last 30 days: no credential enrolled or removed, contact channel or email-login change, recovery-file reissue, recovery or other authority reset. **If there was one, the admins' block power returns:** the owner's move, or the owner's acceptance, is then treated like an admin-requested move, and any admin can block it until 30 days after the change;
  3. notices of the decision to every admin, naming the destination origin;
  4. a short notified delay before the decision takes effect: **24 h** for the owner's acceptance of an elevated move, after which the 72 h move delay starts. For an owner-requested move, the 72 h delay itself is that notified delay.
- **Cooling:** no transfer within 30 days after an ownership transfer, a billing-lapse ownership change, an organization recovery taking effect, or an authority reset of the owner of record's **own person account** (IP-R1-M10). A recovery-derived owner therefore cannot move the organization away at once (R4-M4), and neither can someone who took over the owner's personal account with a stolen personal file. The cooling applies to every move, however it was started.
- The organization's billing is cancelled at commit, with no automatic refund.
- Members are told that their memberships continue under the new host and that their apps will need new certificates.

### 6.3 Commit at 3sln.me

In one account-writer commit (the account's single writer, as for deletion), 3sln.me attests, records the move on the identity, revokes certification keys, sessions, passkeys' sessions, app grants and refresh families, erases the encrypted private-key copies, revokes key delegations, concludes open app removals as forced, and sets identity status `moved`. The severance uses reason `moved`, which the `subject-deleted` hook skips (app removal AR-9). Public surfaces then redirect as in §5 during the redirect period and answer exactly as for a deleted identity afterwards (uniform 404, invalid-credential refusals; app removal §8.5 RR1-R1, aligned with [app uninstall](app-uninstall.md) AU-12). `410 identity_moved` appears only in the owner's own read-only export console. Recovery of a moved account is refused.

### 6.4 Redirect periods and the 10-year extension

- **Free: 90 days** from commit ("at least 3 months"). The owner may decline the redirect at transfer-out, or end it later, because the redirect discloses the new host to anyone holding an old link.
- **Extension: one-time purchase of 10 years** from the purchase date, through a Polar one-time product (`POLAR_PRODUCT_ID_REDIRECT_10Y`), with `order.paid` handled by the existing webhook (it already receives `order.paid` and `order.refunded`). The product's metadata binds the order to the moved tombstone's ID. A refund within Polar's window ends the extension at the later of 90 days after commit or the refund date. Price: **US$10** (Q2, decided by the user, 2026-10-22). At Polar's modelled 5% + $0.50 the net is about $9, against a storage and request cost per tombstone measured in cents per decade.
- **Who can buy:** at transfer-out time, the account owner. Afterwards, anyone holding the redirect page link (`/moved/<opaque id>`), because paying can only extend a redirect to its already-attested target. The page shows the redirect status, never the target's identity URI beyond what the redirect itself discloses.
- **Changing or ending a redirect:** the moved identity signs in at 3sln.me *as an app user of its new provider* (3sln.me acts as a Bindle client; the token response's `bindle_origin`/`bindle_moves` show it is the moved identity). From there it can end the redirect early (erasure) or buy an extension. A later move (B→C) that 3sln.me verifies under spec §8.3 may retarget the redirect to C, using a `redirect_base` on C's origin that the identity supplies through this signed-in management page, never one from an unauthenticated notice (spec §10, IP-R1-L3). An extension purchase never overrides an owner's request to end the redirect. 3sln.me ends the redirect when the target identity URI has answered 404 for 30 days.
- **Expiry reminder:** opt-in at transfer-out. If chosen, 3sln.me keeps one verified email on the tombstone until the redirect ends, solely to send a reminder 30 days before expiry. Otherwise no channel is kept.
- The guarantee is a commitment for as long as 3sln.me operates. Its legal form (and what happens if the service ends) belongs to the terms owner.

### 6.5 Moved-account lifecycle and retention

1. **Export window: 30 days** after commit (Q3, decided by the user, 2026-10-22). The owner can still sign in to 3sln.me's console with existing credentials, read-only, to download exports. Nothing signs and no app works.
2. **Purge:** the existing deletion executor runs with reason `moved` (a new `TOMBSTONE_REASONS` value), erasing content, credentials, recovery hash, email claim and keys, exactly as for deletion ([account deletion](account-deletion-export.md#23-execution-order-and-crash-safety)).
3. **Moved tombstone:** `RETAINED` plus a `moved` record: `{to:{iss,identity}, redirectBase, statement, attestation, committedAt, redirectUntil, extensionOrder?, reminderEmail?}`. The names stay in the permanent claim ledger as for deletion.
4. **After `redirectUntil`:** 3sln.me deletes `moved.to`, `redirectBase`, `reminderEmail` and the order reference, and the identity answers exactly as a deleted one. It also deletes `statement` and `attestation` (Q3, decided by the user, 2026-10-22), because both contain `to.identity`. It keeps publishing its attestation keys (spec §5.1). Redirected requests are not logged per request; only the existing hashed rate-limit counters apply (privacy §3), so the privacy policy needs no new log row.

### 6.6 Privacy policy and terms (for the legal owner)

Proposed additions to [privacy §8](../legal/privacy.md#8-how-long-we-keep-it), as a row and a paragraph:

> **Moved identities.** If you move your identity to another provider, we keep a record of the move: your account ID, your account names, the address of your new provider and of your identity there, the signed move statement and our confirmation of it. We use it to send people and apps who still use your old links to your new provider. We keep it for the redirect period: 90 days, or 10 years if you buy an extension, or until you ask us to end it. Then we delete the new address and keep only the record we keep for deleted accounts. If you ask for a reminder before your redirect ends, we also keep one email address until then. While a redirect is active, anyone who uses your old links or names can see where you moved.

And to [privacy §8](../legal/privacy.md#8-how-long-we-keep-it)'s deletion paragraph: the moved-account export window (30 days) and that moving ends app authorizations at once.

Terms: a new subsection under §3 ("Your account") stating the transfer requirements (current recovery file plus sign-in, or the waiting period), that 3sln.me does not adjudicate disputes beyond these rules, the redirect commitment and its limit, and that the extension is a one-time digital purchase under §7's refund terms. [docs/legal/README.md](../legal/README.md) must list the new as-built facts when the flags turn on.

### 6.7 Timing parameters (P19)

*Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.* Spec minimums are marked "spec"; the rest are 3sln.me policy.

| Parameter | Value | Verdict and one-line rationale |
| --- | --- | --- |
| Credential age for a step-up (path (a), elevated proof, tight verification) | 7 days | **Confirmed.** It equals the path (b) waiting period, so neither path is faster for someone who has just taken over the account. A week spans every weekly routine in which an owner notices a "new passkey" email. (spec) |
| Recovery-credential age (P14) | 7 days | **New.** Same reasoning: reissuing a file from a hijacked session must not create instant transfer authority. (spec) |
| Security-change lookback for owner tight verification | 30 days | **Confirmed.** It matches the 30-day window for notices to removed channels and the cooling period, so one number governs "recent account takeover". |
| Person-move delay | 24 h | **Confirmed** (the user's M1). One day reaches an owner on another channel at the cost of one day per honest move. |
| Fresh delay after a requester-side elevated resolution | 72 h | **Confirmed.** Removing a device is itself a takeover signal, so the remaining channels get longer than the base 24 h. |
| Organization-move delay | 72 h | **Confirmed.** Three days span a weekend, so a Friday-evening request reaches admins on Monday. |
| Owner-move objection extension | 14 days | **Confirmed.** Two working weeks for admins to reach the owner out of band. The owner can still cancel. |
| Owner-acceptance delay after elevation | 24 h | **Confirmed.** It mirrors the person delay before the 72 h move delay starts again. |
| Organization cooling | 30 days | **Confirmed.** It outlasts the 7 + 7 days a recovery-derived controller needs, by a margin that covers a holiday. |
| Held-move expiry | 30 days | **New.** It bounds an unresolved hold, and aborting is the safe direction. |
| Contest window after an elevated abort | 30 days | **New.** It matches the security-change lookback. |
| Attestation-JWKS freshness before automatic adoption | 1 h | **Confirmed.** It equals the protocol §2 manifest cache cap, and adoption is a background job, so a removed (leaked) key stops automatic adoption within an hour at no user-visible cost. (spec) |
| Path (b) waiting period; pending-transfer expiry | 7 days | **Confirmed.** (spec) |
| Step-up freshness at confirmation | 10 min | **Confirmed.** It is the existing step-up window. (spec) |
| Source treated as gone after failures | 7 days | **Confirmed.** It survives a long outage without stranding adoption forever. A lapsed domain answers rather than failing, so §2.7 handles that case, not this rule. (spec) |
| Attestation idempotency retention | ≥ 30 days | **Confirmed.** (spec) |

## 7. 3sln.me as the destination (transfer-in)

- Entry: `/transfer-in`, an isolated first-party document like the recovery pages, behind `IDENTITY_TRANSFER_IN_ENABLED`. It accepts the package POST (§3.1 step 4) or a 3sln-format recovery file (§3.2).
- **Admission:** a transfer-in is a signup. It consumes an admission slot under the free-account cap or the paid waitlist, and runs Turnstile. Organizations need an existing 3sln.me person account as owner of record and a paid tier (or the internal allowlist), as for creation.
- **Checks:** the `sub` is a lowercase UUIDv4 (3sln.me policy); it is not hosted here and not in the claim ledger as another identity's, unless the chain shows it moved out of 3sln.me (§3.5); the keys correspond and match the source's current identity document.
- **Setup:** a free `n.…` handle is allocated; the owner enrols a passkey or password; at activation 3sln.me rotates the signing key (§7.1) and issues a **new recovery file** in its own format, signed by its own authority, with a new reset credential and the new key. The source's file is useless here, and its key signs nothing new that anyone honours.
- **Statement, attestation, activation:** as spec §7. Until attestation, the account is `pending-transfer`: it can sign in but signs nothing and issues no certificate.
- **Unattested transfer-in** from a source without `portability.v1`: allowed only from a 3sln-format file, shown everywhere as "moved without confirmation from `<source>`" (Q4, decided by the user, 2026-10-22). Refused while the source declares `portability.v1`, or while the source's directory still serves the identity as active (checked at intake and again before activation), because then a legitimate owner can get an attestation and an unattested request is most likely a superseded-file fork (IP-R1-M7). Such an identity is keyed by its own `(3sln.me, sub)`, never presented as the origin principal, and is displaced by a later attested move of the same identity (spec §9.3).
- **Data:** imports through `bindle-export/1` are a separate later slice. Without them, the identity arrives with no content and its contact links do not resolve here.

### 7.1 Rotation at transfer-in and old contact links (P11, decided by the user, 2026-10-22)

The user's words: "we need to chain provenance, and remember the key so messages, etc sent via an old contact link can be honored."

**The rule.** At activation, in the same account-writer commit, 3sln.me rotates the identity's signing key with the existing `keys.mjs` continuity statement: the old key signs `{version, subject, purpose, previous, signer, next{kid,alg,publicJwk}, at}` under domain `3sln-identity-key-continuity-v1`, naming the new key. The old key becomes `retired` (never `revoked` because of the move), stays in the published key history with `created` and `retired`, and verifies only artefacts recorded, or otherwise anchored, before `retired` (spec §7.1). A bare old-key signature on something new is never enough, whatever `iat` it claims.

**What 3sln.me records today, and what the rule needs from it** (code read 2026-10-22):

| Today | Effect under the rule | Change needed |
| --- | --- | --- |
| Each contact parent is stored at `contact-grant/<jti>` with the exact protected header (including `kid`) and claims; `bindle_meta` links also store the signing input. The signature is not stored. (`packages/messaging/contact-endpoints.mjs`, `packages/links/issuance.mjs`) | This is the recorded issuance. A holder of an old recovery file cannot add a record, so cannot mint a link the host will honour. | None for the record. Imported records must keep the source's exact header and claims. |
| Verification compares the stored header and claims first, then checks the signature against `contact-key/<owner>/<kid>`, requiring the key to be usable (`active:true`). | A rotation sets `state:'retired'` and keeps `active:true` (`packages/identity/keys.mjs`), so links with a recorded old `kid` already keep verifying. Revoked keys fail. | None, provided the move never revokes the old key. |
| Key history holds at most 16 keys; older keys are pruned. | Pruning a retired key would silently break its recorded links. | Never prune a retired key that a live stored record references. |
| Nothing checks a signature's time against `retiredAt`. | Not needed for links, because only stored records verify. | Retired keys must never verify anything that lacks a record (spec §7.1); new verifiers must not accept retired keys by default. |
| Contact-delivery bearers (≤ 300 s, not stored) are minted with the parent link's `kid`, and the signer requires that `kid` to be current. | After any rotation, minting a bearer from a pre-rotation link fails. That breaks machine delivery through old links. | Sign bearers with the current key and verify them against the current key (spec §7.1, "Fresh tokens"; AMD-P11). |
| Messages record the parent `jti` (`grantId`), the intake revision and the sender's author proof (with the sender's `keyId`). | The sender's proof uses the sender's key, so a recipient's rotation never affects acceptance. | None. |
| `rotateChallenge` re-signs a conditional link with the current key. | An owner-initiated reissue moves that link to the new key. | None. |

**Imported records.** Records arrive through the owner's authenticated import of the source's export (a later slice). They are accepted only for `kid`s in the key history that were active at the source before the move. A source signs nothing after its commit, so every record it exported was issued before the move and therefore before the rotation. Only the identity's owner can import, so a third party holding an old file cannot add records this way.

**Other verifiers.** BindleBox peers, organizations and counterparts keep what they already stored (messages, author proofs, participation statements received before the rotation); those stay valid under spec §7.1 case 2. Anything fresh from the identity must be signed by the current key.

**What it closes.** T2's residual for moved identities: an old or superseded recovery file can no longer produce any signature that is honoured. It does not close T5 or the IP-R1-H2 residual, because a forged chain branches off before the move. Pre-rotation would not close it either. Chained attestation keys and pinning (P16, §2.7) narrow it to verifiers that have never seen the source, and a move log would close it (§2.7 stage 3). Superseded files *before* a move are handled by rotating at reissue (P15).

## 8. Organizations

An organization moves exactly like a person (the user's decision that organization identities are the same as user identities), with the extra transfer authority of spec §6.1 item 4 and §6.2 here. Specific consequences:

- Its members' records (keyed by their origin principals) move with the organization's data import. The members' own identities are untouched.
- Its identity URI changes, so member certificates must name the new `aud`. Members' clients learn the new URI from the moved record and re-acquire certificates.
- Relation counterparts adopt the move (with an authority reset and edge holds where their policy says so) and keep edges keyed by origin principal.
- The 72 h delay, the admin block and elevation, tight verification and the 30-day cooling (§6.2) are 3sln.me policy. Another provider may choose differently, within spec §6.1.

## 9. Threat model

| # | Threat | Mitigation | Residual |
| --- | --- | --- | --- |
| T1 | A thief cracks a stolen **current** recovery file and moves the identity | Path (a) also needs a session with step-up; recovering first and then using (a) is closed by the 7-day rule; path (b) is a 7-day public wait with notices on every channel, and any sign-in cancels | An owner who has no reachable channel and does not sign in for 7 days. At 3sln.me, path (a) also waits 24 h and any known device or confirmed email can hold or abort it (§6.1a) |
| T2 | A former organization owner, or anyone with a **superseded** file | The reset credential is no longer current, so the source refuses; their key-only statement is unattested and never adopted automatically. Rotation at reissue (P15) retires the superseded file's key | Until P15 ships, or when the key history is full, they can forge identity-key signatures on non-authorizing artefacts before a move (R4-L2). After P15, or after a move to a host that rotates (P11), nothing they sign is honoured (§7.1) |
| T3 | A hostile old provider **refuses** to attest | Cannot be mandated. The unattested path plus per-verifier human adoption; the source must still honour exports (legal) | Each counterpart must decide by hand |
| T4 | A malicious old provider **forges** a move to a destination it controls | It must also hold the identity key, which it custodies. Same trust as today's custody; notices from the destination's activation reach only new channels | Inherent custody trust |
| T5 | A **domain takeover** of the old provider (expired domain), or a leaked attestation key | Alone, the attacker cannot sign statements. Combined with an old recovery file whose key was active at that source, it can forge an alternative chain. Pinned verifiers detect it (broken `from`, equivocation); live sources are protected by the spec §8.3 item 5 check (IP-R1-H2); a new attestation key without a chain to pinned keys is an attestation reset (spec §5.1) | Chained attestation keys and pinning (P16) stop a lapsed-domain attacker for every verifier that has seen the source's real attestation keys, and for everyone with respect to 3sln.me, whose root ships in the SDK. **Accepted residual:** a verifier that has never seen the source, meeting a chain forged with an unsuperseded old file plus the source's lapsed domain (or a leaked attestation key plus its domain). Applications are told through `attestation_first_use`. Closed by the move log (§2.7 stage 3). A takeover before any move is the existing custody risk |
| T6 | A **hostile destination** | It holds the key, as any host does; the next move needs its attestation, so a captive identity falls back to T3 | Choosing a provider is a trust decision |
| T7 | **Rollback or replay** of an old statement | `seq` and `prev` pins; lower `seq` ignored; the source never attests twice | None known |
| T8 | **Equivocation**: two attested destinations | Verifiers fail closed and keep the pin; operators alerted | A contested identity until humans resolve it |
| T9 | **Social engineering** of a counterpart into adopting an unattested successor | Mandatory warning naming both hosts and whether the old host still serves the identity; adoption is an authority reset with holds | A persuaded human |
| T10 | **Redirect abuse**: cache poisoning, misconfiguration, open redirects | Redirects are never authority; only per-identity routes; only to attested targets; `no-store` on capability URLs; at most 3 hops; cycle detection | A browser user who trusts a wrongly redirected page until the destination's provenance banner is checked |
| T11 | **Sub squatting** at a destination to block a later move | An attested transfer-in displaces an unattested identity with the same `sub` (spec §9.3) | None for attested moves |
| T12 | **Notice flooding** through repeated waiting-period starts | Each start needs the current credential; one pending transfer per identity; rate limits | Only a holder of the current file can do it, and they can already recover |
| T13 | **Privacy** of the move record | Public only during the redirect period; erasure on request; target deleted at expiry | The old handle is linkable to the new host while redirects run, which is the purpose of redirects |
| T14 | **Races**: transfer against recovery, deletion, suspension or ownership change | One writer per account; commit re-checks every spec §6.1 condition; chaos tests (§10.3) | — |
| T15 | **Package leakage** in transit (private keys in a form POST) | First-party isolated pages, TLS, `no-referrer`, no body logging at either end; the reset credential never leaves the source | A compromised destination page, which is T6 |
| T16 | **Dispute abuse** at 3sln.me: a stolen known device keeps holding or aborting a legitimate person move | The owner settles with elevated proof, removing the device's sessions and passkey, and waits a fresh 72 h. A repeated abort is overcome by restarting with elevated proof. Unresolved holds abort after 30 days (§6.1a, P17) | An attacker with the device *and* the current file and an aged credential, or a second stolen channel, forces support-assisted verification. The move waits, and never commits wrongly. Support's judgement is the final trust point |
| T17 | **A hijacked owner account** moves an organization over the admins | Tight verification: an aged credential (the person file is not an alternative), and any security change in 30 days restores the admins' block (§6.2, P18) | A patient attacker who controls the owner's account with an aged credential and makes no security change for 30 days; admins can then only object, and the owner's own channels get the notices |
| T18 | **Session hijack plus reissue**: someone with a hijacked session reissues the recovery file to obtain a current credential | The credential must be ≥ 7 days old (P14). The reissue notifies every channel, and with P15 it rotates the key | A takeover that stays unnoticed for 7 days, then still faces the 24 h dispute window |

## 10. Slices, flags and tests

Engine-first: every operation is an ngin Action or Query in a domain module, dispatched in the account's single writer; HTTP and UI are thin adapters. Interfaces agreed first: the PORT-1 codec API below and the PORT-5 adoption port.

### 10.1 Slices (non-overlapping write ownership)

| Slice | Scope | Files owned | Depends on |
| --- | --- | --- | --- |
| PORT-1 | Codec and verification: statements, attestations, chains, packages, redirect targets, attestation-key continuity (P16); vectors | `packages/identity/succession.mjs`, `docs/architecture/artefacts/identity-portability.vectors.json`, `tests/identity-succession.test.mjs` | — |
| PORT-2 | Source engine: begin, authorize (both paths), receive statement, cancel, expire, commit; waiting-period scheduler; moved tombstone and `moved` reason | `packages/identity/transfer-out.mjs`, a `moved` addition to `packages/identity/lifecycle-tombstone.mjs`, `tests/transfer-out*.test.mjs` | PORT-1, DX-5 deletion executor |
| PORT-3 | Moved responses and redirect router; `identity_moved` at the authorization request; directory and identity-document hooks | `packages/runtime/routes/moved.mjs`, `tests/moved-routes.test.mjs` | PORT-2 |
| PORT-4 | Destination engine: package intake, checks, statement, polling, activation, signing-key rotation at activation (P11), fresh certification keys, `moves` and the published key history in the identity document; the attestation key set as one continuity chain (P16) | `packages/identity/transfer-in.mjs`, `packages/identity/attestation-keys.mjs`, `tests/transfer-in*.test.mjs` | PORT-1, ORG directory slice |
| PORT-9 | Old-key honouring (P11): bearers signed by the current key; no pruning of retired keys that stored records reference; `retired` timestamp in published keys | Hunks in `packages/messaging/contact-endpoints.mjs`, `packages/runtime/accounts.mjs` (bearer signer) and `packages/identity/keys.mjs`, owned by the messaging and identity owners; `tests/rotation-honouring.test.mjs` | PORT-1; AMD-P10, AMD-P11 sign-off |
| PORT-5 | Verifier adoption: successor pins and index, per-issuer attestation-key pins with the shipped 3sln.me root, attestation resets, `attestation_first_use`, automatic adoption, pending successors, background-refresh hook, presentation intake | `packages/identity/successors.mjs`, `tests/successors*.test.mjs`. Organizations and BindleBox call its port; their owners wire it. | PORT-1 |
| PORT-10 | Rotation at recovery-file issuance (P15): `downloadRecovery` rotates the signing key with continuity before issuing; recovery-credential age recorded for P14 | Hunks in `packages/identity/service.mjs` and `packages/recovery/identity-backup.mjs`, owned by the identity and recovery owners; `tests/recovery-rotation.test.mjs` | PORT-9 |
| PORT-6 | UI: transfer-out and transfer-in isolated documents, moved-account console, redirect page, pending-successor review | `apps/web/src/bl/transfer-*.mjs`, `apps/web/src/ui/transfer-*` and browser tests | PORT-2, PORT-4 |
| PORT-7 | Redirect extension billing | `packages/billing/redirect-extension.mjs`, `tests/billing-redirect-extension.test.mjs` | PORT-2, billing |
| PORT-8 | Legal text | `docs/legal/*` (legal owner) | PORT-2 behaviour |

### 10.2 Flags (proposed rows for `packages/flags/registry.mjs`, all default off; the flags owner adds them)

| Flag | Class | Notes |
| --- | --- | --- |
| `IDENTITY_TRANSFER_OUT_ENABLED` | a, `risk:'crit'`, stateful | Gates **new** transfers only. Pending transfers, commits and cancellations run under the env kill switch, so turning the flag off never strands a pending move. |
| `IDENTITY_TRANSFER_IN_ENABLED` | c, `risk:'crit'`, requires `SIGNUP_ENABLED` | Gates the destination role and the `transfer_in_endpoint` declaration. |
| `IDENTITY_SUCCESSOR_ADOPTION_ENABLED` | c, `risk:'crit'` | Verifier side. Off: moves are not adopted; certificates from moved identities fail uniformly. |
| `REDIRECT_EXTENSION_ENABLED` | b, requires `BILLING_ENABLED` | Polar product purchase. |

Committed redirects are **not** flag-gated: they are a commitment made to the user. `portability.v1` is advertised only when the source endpoints are mounted (a derived flag, like `BROKERED_INTROSPECTION_MOUNTED`). Gates before production: `termsAndPrivacyApproved`, `realBrowserFlowsPassing`, `securityRedTeamFindingsResolved`, `lifecycleNoticesAndDeletionVerified`, `notificationTransportsVerified`, and the clean-room-issuer interop gate of organizations R2-M6 for any foreign issuer.

### 10.3 Tests

**Engine-level** (most tests): every row of spec §12, run against the engines with in-memory adapters. Highlights:

- a transfer-authority matrix over {current, superseded, consumed credential} × {fresh step-up, stale step-up, recovery less than 7 days old, no session} × {person, organization owner, organization admin, recovery-derived owner within 30 days};
- a waiting period cancelled by sign-in, by recovery and by expiry;
- commit effects: no key material, no certificates, `identity_moved`, revoked certification keys;
- destination activation gating;
- verifier adoption, equivocation and replay;
- recovery-file currency (P14): the newest credential issued less than 7 days ago is refused; a superseded, resume-only or legacy v1 credential is refused; a session-only reissue followed by a move attempt fails until the credential ages;
- person-move disputes (§6.1a, P17): no commit before 24 h; a hold never commits at any age; a dispute from a device or email added after the move began is ignored; elevated proof by the disputer aborts and reissues the file; elevated proof by the requester revokes the named sessions, removes their passkeys, detaches named emails and restarts a 72 h delay; a removed passkey's device cannot dispute again; a restart with elevated proof overcomes a repeated tier-0 abort; any dispute during the fresh 72 h, proof on both sides, or a conflicting elevated action within 30 days of an elevated abort locks transfer-out for support; a held move with no resolution aborts at 30 days; a path (b) hold resolves only by support or withdrawal;
- organization moves (§6.2, P18): an admin block stops an admin's move; the elevation stays pending with no timeout; an owner's move cannot be blocked; a security change on the owner's account in 30 days restores the block; a credential enrolled within 7 days fails tight verification, and the owner's person recovery file does not substitute for it;
- rotation at reissue (P15): a superseded file's key is retired and its fresh signatures fail; links recorded before the reissue keep verifying; a full history of referenced keys issues without rotating and audits it;
- attestation keys (P16): a new key chained from a pinned key is accepted; a set with no chain to the pins is an attestation reset and blocks automatic adoption; first use pins the whole chain and sets `attestation_first_use`; 3sln.me's shipped root is never trusted on first use; a lapsed-domain simulation (old file plus a republished manifest and a new attestation root) is refused by a verifier that pinned the source and accepted, flagged, by one that never did.

**Seeded chaos** (deterministic PRNG seeds recorded on failure):

- *Source:* random interleavings of begin, authorize, statement arrival (duplicated, reordered, lost responses), cancel, expiry, recovery, deletion request, suspension, ownership change and crash or restart between any two steps. Invariants: at most one attestation per `sub`; never an attestation without a current credential at commit time; no key copy after commit; redirects only to the attested target; a cancelled or expired transfer never commits.
- *Network:* N simulated providers with random move sequences, including returns, equivocating sources, unattested moves, lapsed redirects, verifiers offline for random spans and random refresh order. Invariants: pins are monotonic in `seq`; no automatic adoption without both signatures; the origin principal of every relationship never changes; certificates verify only at the pinned host; first-contact verifiers key by origin principal only when the full chain verifies.

**Browser:** the isolated transfer pages (no third-party scripts, the package POST, `no-referrer`), the redirect page and the pending-successor warning, with real DOM evidence before any flag turns on.

## 11. Spec versus 3sln.me

| Normative (spec) | 3sln.me (provider choice) |
| --- | --- |
| Move statement, attestation, `move_endpoint`, attestation keys | Screens, wording, the isolated pages |
| The minimum transfer authority (a current credential at least 7 days old, plus a session or a 7-day public wait; organization transfer authority) | Person moves: 24 h delay, disputes and the elevated-resolution proof ladder. Organizations: admin requests, blocks and elevation; tight verification for the owner; 72 h delay, 14-day objection extension, 30-day cooling. Rotation at reissue |
| Attestation-key continuity and verifier pinning; `attestation_first_use` | Shipping 3sln.me's attestation root in `@3sln/bindle`; when to start stages 2 and 3 (§2.7) |
| Commit effects at the source; activation at the destination | Export window (30 days), purge via the deletion executor, tombstone contents |
| `moves` in identity documents; verifier adoption, equivocation, unattested rules | Pending-successor review UI and copy |
| Redirect semantics *if* a provider redirects | That 3sln.me redirects, for 90 days free, 10 years for US$10 |
| Portable identity package | Recovery file format; accepting 3sln-format files at transfer-in |
| `identity_moved`, `bindle_origin`, `bindle_moves` | Sign-in as a moved identity to manage the redirect |

## 12. Open questions for the user

1. **Key rotation at transfer-in, and "original".**
   - *Rotation:* **decided by the user, 2026-10-22: accepted, with conditions.** The user's words: "we need to chain provenance, and remember the key so messages, etc sent via an old contact link can be honored." Applied as P11 (§7.1, spec §7.1): a continuity statement from the old key, a published key history, and old-key signatures honoured only for artefacts recorded or anchored before the rotation.
   - *"Original recovery file":* **closed (P14, §1.1).** It means the current file, whose credential has been current for at least 7 days. Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.
2. ~~**Extension price and buyers.**~~ **Decided by the user, 2026-10-22: accepted as recommended.** US$10 one-time for 10 years from purchase, purchasable by anyone holding the redirect page, non-refundable outside Polar's normal window.
3. ~~**Moved-account export window and retained proof.**~~ **Decided by the user, 2026-10-22: accepted as recommended.** 30 days of read-only console access for export, then purge. After the redirect ends, the statement and attestation are deleted too, since verifiers that matter already pinned them and the destination keeps publishing them in `moves`. §6.5 item 4 and the §6.6 privacy text follow this: nothing that names the new address is kept after the redirect ends.
4. ~~**Unattested transfer-in to 3sln.me.**~~ **Decided by the user, 2026-10-22: accepted as recommended.** Allowed only from 3sln-format files, clearly labelled. It is the only exit for users of a provider that has disappeared.
5. ~~**Pre-rotation.**~~ **Closed (P15, §2.5): deferred.** For now 3sln.me rotates at every recovery-file issuance. Pre-rotation is revisited with the move log (§2.7 stage 3), using the one-file shape already fixed in §2.5. First-contact forks are decided separately (P16, §2.7): chained attestation keys and pinning in v1, then shared pins, then a move log. Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.
6. ~~**The coordinator's proposals awaiting confirmation.**~~ **Closed.** Elevated resolution is decided as P17 (§6.1a item 4), as a proof ladder with device removal, a single self-resolution and a 30-day hold expiry. Tight verification is decided as P18 (§6.2), dropping the person-file alternative. All figures are in §6.7 (P19). Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.
7. **Explicitly deferred, with reasons:**
   - *Data and link import (`bindle-export/1`):* a separate later slice. Without it, moves work but old contact links resolve only by redirect plus a destination that has no record (§7).
   - *The legal form of the redirect commitment if 3sln.me ends:* this belongs to the legal owner (§6.4, §6.6).
   - *Stage 2 and stage 3 fork detection:* the triggers are in §2.7. Starting either before a second independent source exists would mean operating infrastructure for nobody.
   - *Pre-rotation:* P15.
   - *Raising `KEY_HISTORY_LIMIT` for signing keys:* only needed if the "history full, issue without rotating" edge (P15) is seen in practice. The identity owner decides then.

## 13. Reconciliation notes for DEVLOG (coordinator)

- Record P14–P19 as "decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user", with empty user sign-off. They replace the coordinator's proposals in §6.1a item 4 and §6.2.
- Cross-doc changes for other owners (this agent did not edit them): the recovery-identity spec "Return, compromise and missing state" gains rotation at every issuance (P15) and the 7-day credential age as a transfer rule (P14; extends AMD-P6). The organizations design §12b.5 mirrors P18 (aged credential, no person-file alternative). The `@3sln/bindle` SDK owner ships 3sln.me's attestation root thumbprint once attestation keys exist (P16). PORT-10 hunks belong to the identity and recovery owners.

- Record P1–P10 as provisional decisions with empty reviewer, date and outcome. P11–P13 are the user's decisions of 2026-10-22; record them as the user's, with P17 and P18 inside them recorded as the agent's decisions.
- Revision 4 corrects revision 3's claim that only pre-rotation closes the first-contact fork (§2.5–§2.6, T5, IP-R1-H2, spec §8.6).
- The organizations author owns AMD-P4 (spec §3, §3a, §5.2, §5.2a, §5.3, §9.5). Organizations spec §3's portability bullet (R4-H2) is answered by spec §6.1 here; R4-H2 can move to "resolved pending review" once the organizations author cross-references it.
- Certification keys gain a second use in the intents draft (AMD-I5: signing intent attributions). The organizations author should confirm it.
- `TOMBSTONE_REASONS` gains `moved` (PORT-2), and the deletion executor's `RETAINED` gains the `moved` record. Coordinate with the DX owners.
- The privacy and terms additions in §6.6 are proposals for the legal owner, who also maintains docs/legal/README.md.
- 410 versus 404 is reconciled: app removal §8.5 (RR1-R1) and app uninstall AU-12 chose the uniform 404 and invalid-credential refusals on public surfaces, with `410` only on the owner's own authenticated surfaces. Spec §6.3 and §6.3 here follow it. The account-deletion design's "contact links answer `account_deleted` (410)" needs the same change by its owner.
- App removal AR-9 (no `subject-deleted` for moves) is adopted in spec §6.3 (AMD-P9).

## Review round 1

Independent adversarial security review, 2026-10-22, of spec revision 1 and this design revision 1. Read against organizations §2–§3a, §5.2a, §6.3; recovery identity; recovery file; identity names; links; contact delivery; security; app removal §8 (RR1-R1, AR-9); app uninstall; account deletion; privacy §3 and §8; `packages/identity/{keys,delegation,handles,service}.mjs` and `packages/recovery`. Reviewer: independent agent (not a human sign-off). Outcome: **fixes applied where marked "fixed"; the rest open**. Sign-off: reviewer ___ / date ___ / outcome ___.

### High

**IP-R1-H1. Recovery-then-wait hijack with a stolen current file (fixed).** `IdentityService.recover` is immediate: it accepts the current token, wipes the owner's credentials and sessions and lets the presenter download a new file, which supersedes the owner's. Design §6.1 sent anyone within 7 days of a recovery to path (b), and spec path (b) excluded only resets *during* the period. Scenario: thief cracks the current file, recovers, starts path (b) the same minute. Notices go to the thief's sessions and to any email the thief has changed; the owner cannot sign in to cancel and their file is now superseded; on day 7 the identity leaves for good, beyond the reach of 3sln.me support. Fix: path (b) cannot start within 7 days of an authority reset or channel change; notices also go to channels removed or replaced in the last 30 days; each notice carries a cancel capability that needs no sign-in; credential enrolment and channel changes during the period cancel it (spec §6.1(b); design §3.3, §6.1).

**IP-R1-H2. Leaked attestation key plus any old file means an automatic hijack (fixed for live sources; residual recorded).** The dual signature is only as strong as the weaker half. A former organization owner's superseded file supplies the statement. A leaked attestation key, or the lapsed domain of a source that has stopped answering (republished manifest and JWKS), supplies the attestation. Verifiers fetched keys fresh and auto-adopted, while the source might still be hosting the identity. Fixes: §8.3 item 5 requires that the source no longer serves the identity as active (moved body, redirect or 404); a 200-active answer blocks adoption. §5.1 now requires a fresh JWKS (one hour) before automatic adoption, and a `kid` missing on refetch counts as revoked. This resolves the contradiction between "remove a compromised key" and "cache indefinitely". Residual (spec §8.6): first-contact verifiers after the source is gone cannot detect an alternative chain. Destination rotation (Q1) does not close it, because the forged branch starts at the source. *Correction (revision 4):* this item used to say that only pre-rotation closes it. Pre-rotation does not, because an old file holding a spent rotation key can still fork at its own position; only an independent record or a verifier's pin detects the fork (§2.5–§2.6).

**IP-R1-H3. Authorization not bound to the destination; first-statement DoS (fixed).** Spec §6.1 never required the committed statement's `to.iss` to be the origin the user confirmed. "Pending" was undefined, and §3.2 created pending state from an unauthenticated statement. Scenarios: (1) a holder of any old file posts a statement naming their own host before the owner's move, so the owner's statement is `refused` forever; (2) a package or `transfer.id` leak lets a key holder commit the owner's authorization to a different destination. Fix: an authorization binds to one destination origin, the `transfer` identifier and then one statement digest, and `redirect_base` must sit on that origin. Statements without an authorization create no blocking state (spec §5.2, §6.1 item 1).

### Medium

- **IP-R1-M1. Path (a) is instant and silent (fixed in part).** Malware with a step-up session plus the current file could move an identity with no notice before commit. Fixed: notice to every channel at confirmation, before commit; no step-up with a credential enrolled within 7 days; no path (a) within 7 days of a channel change. **Decided by the user, 2026-10-22:** "Okay to the 24 hour delay, and a dispute from a known device/email can prolong or abort it until resolved by some elevated means." Applied as 3sln.me policy in §6.1a (P12); the resolution procedure is P17 (decided by the security design agent under the user's delegation, 2026-10-22). Earlier text: recommend a 24 h notified delay before a person's commit at 3sln.me (provider policy; the user decides). *Why (the user asked, 2026-10-22):* it stops an attacker who has the owner's unlocked device or a hijacked signed-in session, plus the current recovery file (often saved on that same device), from moving the identity away in one sitting. Today the notice goes out at confirmation, but the commit can follow seconds later, and after commit 3sln.me has destroyed its key copies and cannot undo the move. A 24 h delay gives the owner one day to see the notice on another channel and cancel; the cost is that every honest move waits a day.
- **IP-R1-M2. Restart loop after cancellation (fixed).** The person who started the move still holds the current credential and can start again at once, flooding notices. The cancel page must offer to reissue the recovery file, and restarts with the same credential are held (spec §6.2).
- **IP-R1-M3. Attestation key caching contradiction (fixed).** See H2.
- **IP-R1-M4. `to.identity` is a claim (fixed).** Pending successors and first-contact chains made verifiers fetch a statement-chosen path on the destination origin (R2-H2 class). The destination's `?sub=` directory lookup must return exactly `to.identity` (spec §8.3 item 4).
- **IP-R1-M5. `sub` collisions across issuers (fixed).** A hostile issuer can mint an identity under a victim's `sub` and move it attested to destination D first. Then the victim cannot move to D (sub-squatting by a malicious *provider*, which displacement of unattested identities does not cover), and verifiers can see `(D, sub)` map to two origins. Fix: destinations and verifiers key by origin principal; index conflicts are contested; the victim chooses another destination (residual DoS) (spec §8.2).
- **IP-R1-M6. Equivocation was suppressed (fixed).** §8.4 said to ignore any record at or below the pinned `seq`, which hid a second attested record arriving after adoption. Differing attested records are now equivocation evidence.
- **IP-R1-M7. Unattested forks while the source is alive (fixed).** A superseded-file holder could create an unattested fork at 3sln.me, or at any destination, and socially engineer counterparts. No pending successor is offered, and 3sln.me refuses unattested transfer-in, while the source declares `portability.v1` or still serves the identity as active. **Verdict on "unattested transfer-in, labelled":** safe only with that refusal, with keying by the new `(iss, sub)` (never the claimed origin), with displacement by a later attested move, and with the T9 warning copy. The fork still signs with a key that the live source also uses; the label and separate keying are what keep it from merging.
- **IP-R1-M8. Verifier fetch amplification (fixed).** A presented 16-hop chain costs about 48 cross-issuer fetches. A role with request-path fetches (BindleBox) becomes an amplifier. Fix: offline checks first, chains verified only for an existing relationship or for origin linking, background only, under §3a.5 budgets (spec §8.6). Pins and indexes are bounded (spec §8.2).
- **IP-R1-M9. The destination sees the current reset credential (fixed).** In design §3.2 the destination decrypted the source's file, which hands it transfer and recovery authority at 3sln.me; "discard" cannot be verified. The destination-start flow now sends the user to the source, which delivers the package (spec §9.2; design §3.2).
- **IP-R1-M10. Organization moves through the owner's personal account (fixed in design; spec ambiguity fixed; blocking applied 2026-10-22 under the coordinator's reading, §6.2).** Spec path (a) and (b) spoke of "the identity's session", and organizations have none. They are now defined for organizations (spec §6.1 item 3). At 3sln.me, someone who takes over the owner of record's person account (stolen personal file, wait 7 days, enrol a passkey) became the only person able to cancel the 72 h organization move. Admins could object but not block. The 30-day cooling now includes authority resets of the owner's own account. **Open:** whether an admin objection should block rather than extend when the owner's account had any security change in the last 30 days (grant-management policy owner). *2026-10-22:* the user answered "sure from other admins, no from org owner, original requester can elevate". Applied in §6.2 under the coordinator's reading (other admins can block an admin-requested move; nobody can block the owner's own move or decision; the requester can elevate to the owner), keeping the 30-day cooling. **Confirmed by the user, 2026-10-22 (final):** the owner is more privileged, and "these elevations need tight verification because they're quite dangerous." §6.2 adds tight verification (P18, decided by the security design agent under the user's delegation, 2026-10-22), under which a security change on the owner's account in the last 30 days restores the admins' block. That answers this item's open question.

### Low

- **IP-R1-L1. Redirect path tricks (fixed).** Dot segments, `//`, encoded slashes or backslashes could make a router that matches prefixes redirect into other destination routes, and raw query bytes could produce an invalid `Location`. Only exact, non-normalized per-identity paths and RFC 3986 query characters are redirected (spec §10). The target always stays on the attested origin, so this was never an open redirect off-origin.
- **IP-R1-L2. `redirect_base` substitution (fixed).** It is now bound on first acceptance, must be unique per source at the destination (so that reconstruction knows the original origin), and has no userinfo, dot segments or encodings.
- **IP-R1-L3. Retargeting to later hosts (fixed).** "MAY redirect to the later host's `redirect_base`" had no authenticated source for that value. The value must now be supplied by the identity through an authenticated action, and the later move verified under §8.3.
- **IP-R1-L4. Stranded move (fixed).** If the source commits and dies, or the response is lost, the destination has keys but no attestation. Attestations stay retrievable by idempotent POST for at least 30 days.
- **IP-R1-L5. Delegations survive in name (fixed).** Key-delegation status lives under `/identity/<sub>/` and would have been 308-redirected to a destination that cannot know the delegations. The source now revokes them at commit and answers `revoked` itself (spec §6.3, §10; design §5).
- **IP-R1-L6. 410 versus 404 (fixed, aligned).** Design §6.3 answered 410 `identity_moved`. Aligned with app removal §8.5 RR1-R1 and app uninstall AU-12: redirect during the period, uniform 404 and invalid-credential refusals afterwards, 410 only in the owner's console. The account-deletion design's 410 for contact links needs the same change (DX owner).
- **IP-R1-L7. `subject-deleted` on moves (fixed).** Reusing the deletion executor would have told apps to purge moved users. AR-9 adopted: the severance reason `moved` is skipped (spec §6.3, AMD-P9).
- **IP-R1-L8. Privacy (fixed in text).** The retained statement contains `to.identity`, so keeping it after the redirect contradicts "then we delete the new address" unless the privacy text says otherwise (design §6.5). No per-request redirect logs; privacy §3 counters only. The owner may decline the redirect, and a purchased extension never overrides an owner's request to end it. Redirects end 30 days after the target identity URI starts answering 404, so a redirect does not outlive deletion at the destination. Shared caches are excluded (`private`), so a return or an early end takes effect.
- **IP-R1-L9. Open app removals and recovery after commit (fixed).** The commit concludes open removals as forced, and it refuses recovery and reactivation of the moved identity.
- **IP-R1-L10. Account deletion races (no change).** A pending move is refused once deletion begins (§6.1 item 1), and both run in the single writer. A deletion request should cancel a pending move explicitly; the PORT-2 chaos tests already include it.

### Checked and sound

Statement and attestation `typ` separation from links and certificates; `seq`/`prev` replay protection; the source attests at most once; certification keys never travel and `aep` floors carry over; handles are never moved or reassigned; HTTP redirects are never authority; the no-redirect fetch rule is relaxed only for hints with verification.

### Open items for the user or owners

1. ~~The 24 h notified delay for person moves at 3sln.me (M1).~~ Decided by the user, 2026-10-22 (§6.1a). Elevated resolution: P17.
2. ~~Admin blocking power in suspicious organization moves (M10).~~ Decided by the user, 2026-10-22 (§6.2). Tight verification: P18.
3. ~~Pre-rotation.~~ Deferred (P15); first-contact forks narrowed by P16 (§2.7). Decided by the security design agent under the user's delegation, 2026-10-22; not signed off by the user.
4. The account-deletion design's contact-link 410 (L6), owned by the DX owner.
