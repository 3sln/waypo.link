# Recovery file and identity transfer — design spike

> **Group:** 3sln.me reference service, with proposed Bindle change requests
>
> **Status:** design spike (2026-10-28, revised 2026-10-28), documentation only. **Owner-approved:** option C and the recommendations of the first revision (§0 items 1, 2, 4 and 5, §4 as written in that revision, and the answers to Q1–Q14 in §6.4), with the owner's modifications: the move record must not name the user's key, a background data migration is added, and proof of download compares hashes of the encrypted file. Reviewer: owner. Date: 2026-10-28. Outcome: approved with those modifications (DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer"). **Provisional:** the designs that carry out those modifications are coordinator proposals and not signed off: the provider-signed move record (§3), the background migration protocol (§5), the details of the hash proof of download (§4.3), the password-free cooling-off rules and the pending-removal interlocks (§4.2), the proof-only presentation for the sign-in spike (§4.5) and the new questions Q15–Q30 (§6.5). Sign-off for them: Reviewer ___ Date ___ Outcome ___. No code, spec or DEVLOG entry was changed. Production release remains disabled.
>
> **Covers:** what the recovery file holds and what a stable user signing key is relied on for today; the opaque recovery credential (option C); the move record that proves a cooperative move without naming any user key, and how apps and peers detect it and follow it (the "moved" annotation); the background migration of settings and data from the old provider to the new one; the recovery file lifecycle (periodic reissue, overlap, acknowledgement by hash, questionnaire encryption, the proof-only presentation that authorizes sensitive actions); spec impact, dev-data migration, phases and open owner questions.
>
> **Does not cover:** sign-in methods, sign-in emails, passkey stability and intents through sign-in (the separate [sign-in and intents spike](sign-in-and-intents-spike.md)); the item-classification work; pricing of the redirect extension (unchanged); name certificates (unchanged); the internal wire format of each migrated data kind beyond what §5 fixes.

Input: the owner directions in DEVLOG "2026-10-28 — Owner directions: sign-in, intents through login, recovery file, identity transfer", and the owner decisions in "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer". The owner wants the most value for the least complexity and cost, and notes that a migration needs the old provider's cooperation in any case, because it must redirect. Code references are to HEAD d58305f. Hosts under `.example` are placeholders.

## 0. Decisions in one screen

**Option C (hybrid) is adopted** (owner, 2026-10-28). Items marked *provisional* are the coordinator's designs for the owner's modifications.

1. **The recovery file becomes an opaque credential** (approved). It holds the issuer, the UUID, a random reset credential and a public file id. It holds no private keys. It works only at the live provider, which checks the credential's hash. Questionnaire encryption stays as it is, on the device.
2. **The identity signing key stays, in provider custody only** (approved). It keeps rotating with continuity statements (organizations §3a.4) and is never exported to the user.
3. **A move is cooperative and is proven by two provider signatures, never by a user key** (owner modification; design provisional, §3). Before commit, the destination signs a **move acceptance** with its provider **transfer key**. At commit, the source signs a **move record** with its own transfer key. The record names the source, the destination, the destination's transfer-key fingerprint and the acceptance's digest. It names no user key, so user-key rotations on either side never touch it. The record and acceptance are published as the "moved" annotation on the old directory and identity routes, and in `moves` of the new identity document. Verifiers trust the source's transfer key by pin, and re-pin the identity's key from the destination's document.
4. **Withdrawn** (approved): the user-held keychain, the portable identity package, transfer-in from recovery files, unattested moves, rotation at every recovery issuance (P15), and retired-key honouring of imported links (P11). Provider attestation keys come back in a reduced form, as transfer keys with continuity (§3.3, Q16).
5. **Lost, honestly** (approved): an exit when the old provider is defunct or hostile. The user then starts a new identity and peers reconnect by hand. An optional user-held recovery key can add the exit later (§2.4).
6. **Data follows slowly in the background** (owner modification; design provisional, §5). At commit the source freezes the account. The destination then pulls settings and data over an authenticated, resumable, rate-limited channel that the user's move consent authorizes, for the 90-day redirect window. Grants, sign-in methods, the recovery file and billing never migrate; emails arrive unverified; apps reconnect and re-pull their own state.
7. **Proof of download by hash** (owner direction; details provisional, §4.3). The user re-uploads the downloaded file, still encrypted. The browser hashes the picked bytes and compares them with the hash of the bytes it downloaded, without decrypting. The hash is kept in the setup page's memory and also on the server.
8. **File proof for sensitive actions** (requested by the sign-in spike; provisional, §4.5). A proof-only presentation of the current file and its answers authorizes, for example, removing an established sign-in method, without starting a recovery or reissue. The token never leaves the isolated document; the server checks a single-use MAC. The hash re-upload does not count. Reissue and transfer are refused while a sign-in method removal is pending, and the reissue rules no longer mention passwords (§4.2).

**Why now.** There is no second Bindle provider and there are no real users. Every portability feature costs code, review and residual risk. The keychain in the file was also the largest offline-attack exposure of the questionnaire design; removing it makes the owner's questionnaire idea sound.

## 1. Inventory

### 1.1 The recovery file today

| Layer | Contents (as implemented) | Source |
| --- | --- | --- |
| Outer envelope v1 (plain JSON) | `format`, `version`, `normalization: 3sln-answers-v1`, 1–12 typed questions with optional public hints, Argon2id (64 MiB, t=3, p=1, 16-byte salt), AES-256-GCM. Every answer feeds one key. No per-answer hashes, no other key slots, no server secret. | [recovery file](../3sln/accounts/recovery-file.md); `packages/recovery/index.mjs` |
| Payload v2 (encrypted) | `{version:2, issuer, entity (UUIDv4), recoveryToken, warning, keychain:{signing:{kid,privateJWK}, encryption:{kid,privateJWK}}, proof}`. The proof is a provider ES256 signature over the whole payload. No handle. | [recovery identity](../3sln/accounts/recovery-identity.md); `packages/recovery/identity-backup.mjs` |
| Legacy payload v1 | Issuer, handle and token. No keys. Still recognised under account policy. | same |

How the file is used:

- **Setup.** `downloadRecovery` creates the token and stores only its hash. The browser encrypts the payload in an isolated first-party document and downloads only the envelope. The user re-enters every answer, and the browser decrypts the in-memory envelope before `confirmRecovery`. This proves the answers and the ciphertext, not a durable file write.
- **Recovery at 3sln.me.** The server checks the token hash and the provider proof. It then checks that the keychain **matches the keys it already holds**. It never imports or restores keys from the file (recovery identity, "Export and retained-account recovery", steps 4–5). So at the same provider, the keys in the file are a redundant equality check.
- **Reissue.** Two-phase reissue with a 7-day cooling-off window (implemented 2026-10-23, cancel confirmation 2026-10-28). Each issuance first rotates the signing key (P15), so that a superseded file holds only a retired key. It binds the kids of the current and previous files (`keys.mjs` recovery binding). Cancelling rotates away from the voided file's kid. The encryption key is never rotated, so every superseded or voided file still discloses the current encryption private key (a known residual).
- **Transfer-out at 3sln.me.** The browser decrypts the current file and builds the portable identity package from its keychain (`packageFromBackup`, `apps/web/src/bl/transfer-flow.mjs`). It then form-POSTs the package to the destination. The file's private keys are the actual transfer material.
- **Transfer-in at 3sln.me.** The intake accepts a package, or a 3sln-format file for an **unattested** move (Q4, user decision 2026-10-22). `packages/identity/transfer-in.mjs`, `transfer-enrollment.mjs` and `runtime/transfer-intake.mjs` implement it.

Stale text: [account lifecycle](../3sln/accounts/account-lifecycle.md) still describes the file as JSON with issuer, handle and secret, and says reissue invalidates previous files. Both are superseded by payload v2 and the cooling-off window. Fix this in phase 1.

### 1.2 Who relies on a stable user key

"Stable user key" means the per-identity ES256 signing key (`use:"sig"`) published in the identity document. It is provider-custodied (sealed under `KEY_ENCRYPTION_KEY`) and copied into every v2 recovery file.

| Consumer | Key it uses | Needs the key to be **in the user's file**? | If the file stops carrying keys |
| --- | --- | --- | --- |
| Parlay key-delegation certificates (messaging §3.2) | Identity signing key (`kid` = identity keyId), signed by the provider | No | Unchanged |
| Cross-provider author verification (messaging §3.3) | Directory-resolved identity key with pinned continuity, then the delegate key. Today only same-host principals verify (CL-24). | No | Unchanged |
| Receipts and records with lasting effect (messaging §3.4, §8.1) | Delegate key plus delegation status | No | Unchanged |
| Organization member and entity certificates (organizations §5.2, §9.5) | **Certification keys** (`use:"cert"`), provider-held, never in files (R4-H1) | No | Unchanged |
| Organization links, relation participation statements, continuity statements | Identity signing key, signed by the provider | No | Unchanged |
| Relation events, intent attributions | Certification keys | No | Unchanged |
| Signaling leg certificates and control statements (signaling §6.1) | Certification keys. Pairings and admission are keyed by origin principal. | No | Unchanged |
| Email-bridge intake provenance | The bridge's own key (removed 2026-10-28 (owner direction; revisit later)) | No | Not applicable |
| Name certificates | Provider recovery/name authority | No | Unchanged |
| Organization memberships, relation edges, signaling pairings, Parlay peers | Keyed by **origin principal** `(iss₀, sub)` | No | Unchanged. The origin principal is kept (§3). |
| Identity encryption key (ECDH) | No consumer. Provisioned and exported only. | — | Deleted (Q11, approved) |
| Recovery at 3sln.me | Equality check against retained keys | Only as a redundant check | The token hash alone suffices |
| Move statement (portability §4) | Identity signing key. 3sln.me builds it from the file's key at the destination. | **Yes**, as implemented | Replaced by the provider-signed move record and acceptance (§3). No user key is involved. |
| Portable identity package (§9), transfer-in from file, unattested moves (§8.5) | Private keys out of the file | **Yes** | Withdrawn |
| Rotation at transfer-in and retired-key honouring (P11, §7.1) | Arriving key | Yes, indirectly | Moot: the destination starts with a fresh identity key of its own |
| P15 rotation at every issuance, recovery kid binding, rotate-on-cancel | Exist only because files carry the key | Yes | Removed |

**What actually breaks if the file stops carrying keys:** only the self-sovereign paths, meaning moves built from the file and unattested exits. Nothing in messaging, signaling, organizations or relations relies on the user holding the key. They rely on a provider-custodied key with continuity, and on the origin principal.

**What a move does to the identity key under the adopted design:** the destination generates a fresh identity key. Verifiers accept it because the source's provider signature says the identity moved there and the destination's provider signature says it accepted the identity (§3.8). The identity key was always a provider-held key, so a provider transfer key carries the same trust; it is simply not per user. Organizations already treat every adopted move as an authority reset, so a fresh key costs them nothing extra.

## 2. Options (decided)

### 2.1 The three options

- **A. Keep a stable identity key in the recovery file.** The user holds the private signing and encryption keys, so in principle they can prove continuity even when the old provider is gone or hostile.
- **B. Opaque recovery credential, transfer by forwarding.** The file is a secret that the provider verifies. A transfer means the old provider redirects and annotates its directory with "moved to X". There is no signature continuity for peers.
- **C. Hybrid — adopted (owner, 2026-10-28).** The file is opaque, as in B. The identity key stays provider-held with continuity. The providers sign the move (§3), which gives peers cryptographic continuity without the user ever holding a key. A user-held recovery key may be added later.

### 2.2 Comparison

Column C reflects the provider-signed record of §3.

| | A. Keys in file | B. Opaque + redirect only | C. Opaque + provider-signed record (adopted) |
| --- | --- | --- | --- |
| **Value: cooperative move** | Yes. Two signatures (identity key and attestation key). | Yes. Apps relink by reconnecting. Peers must trust a TLS-served annotation or re-add the user. | Yes. Pinned peers follow automatically, and apps relink by reconnecting. Data follows in the background (§5). |
| **Value: defunct or hostile provider** | Partial. Unattested moves are never adopted automatically. | None. Start fresh. | None now. Start fresh. Optional user recovery key later (§2.4). |
| **Value: continuity for peers** | Yes | No. A move is an unattested key reset. | Yes. The move is attested by both providers and peers re-pin the identity key from it. |
| **Complexity (spec)** | Highest: statement, attestation, attestation-key chains (P16), package, unattested path, first-use flags, retired-key honouring, a 152 KiB document budget | Lowest | Low: two small signed objects and one provider key set with continuity. No source user keys in the destination document (budget about 130 KiB). |
| **Complexity (code)** | All implemented behind default-off flags (about 4.4k lines of portability tests plus transfer-in, enrollment, attestation keys, the package codec and P15 binding) | Most of that deleted | Transfer-in intake, package and P15 deleted. Attestation-key code is reused as transfer keys. Transfer-out, disputes and redirect management are kept. The migration channel (§5) is new. |
| **Cost** | Ongoing review of a fork-prone design | Lowest | Low, plus the migration channel's storage and egress during the window |
| **Security: stolen file plus cracked answers** | Durable private keys disclosed forever | A reset token, usable only online, behind the 7-day waits, notices and cancellation. Revocable. | Same as B |
| **Security: compromised old provider** | Can forge both signatures | Can forge the annotation | Can forge the record (stated trust assumption, §3.11) |
| **Security: lapsed old domain** | Blocked for pinned verifiers by P16 | Annotation forgeable over TLS by the domain's buyer | Blocked for verifiers that pinned the source's transfer keys: the buyer holds no transfer private key and cannot add a continuity-linked key (§3.3). First-contact verifiers get `source_unanchored` and confirm through their own channel. |
| **Security: leaked transfer key** | (attestation key) needs an old file as well | n/a | Can forge records for that source's identities, but a forged record fails the "source let go" check while the source runs, and needs a cooperating destination's acceptance (§3.11) |
| **User burden** | Same file and answers, but a lost file can never be fully retired | Same file and answers | Same file and answers. A leaked file is fully retired by a reissue. |

### 2.3 What A really bought, and what B and C lose

- **A's distinctive value is the unattested exit.** By spec, an unattested move is never adopted automatically, so the practical difference from "start fresh and re-invite" is a cryptographic hint on a manual step, where social engineering concentrates (design threat T9).
- **A's cost is that durable private keys travel in a file protected by questionnaire answers.** Offline guessing yields keys that can never be revoked. P15 rotation exists to blunt this, and brings its own residuals.
- **B loses continuity for peers.** C keeps it at almost no extra cost: the source already custodies the identity and already signs for it.
- **B and C both depend on the old provider cooperating, and give nothing if it vanishes.** As the owner notes, a migration needs the old provider anyway, because it must redirect. For 3sln.me as the source, the transfer-out rules already commit it to cooperate (portability §6.1 authority, 90 days of free redirects, the US$10 ten-year extension, and now the migration channel).

### 2.4 Upgrade path, if the defunct-provider exit is wanted later

The upgrade is a **user-held recovery key**, an extra key in the identity document, provisionally `use:"recover"`. The user keeps its private key offline, separate from the questionnaire file or in a high-entropy slot. It signs nothing day to day. It could sign a distinct defunct-provider move object that pinned verifiers accept only when the old host has answered the uniform 404 for 30 days. That restores A's exit without putting the day-to-day signing key in a file. It is a different object from the provider-signed record of §3 and would get its own `typ`. Add it when there is a second provider and a real exit scenario. Nothing in C blocks it.

## 3. The move record and app-side recognition (provisional)

### 3.1 Constraints from the owner's modification

- **No user key is named.** The first revision had the source sign with the identity's signing key (header `kid`) and name the destination's first identity key (`key`). The owner rejected this because it complicates rotation: the record would pin the destination to a key it may rotate before verifiers see it, and the destination would have to keep listing the source's user keys forever so that first-contact verifiers could check the chain.
- **The record carries a provider key fingerprint or a provider-signed consent.** The source signs, with a provider key, a statement that the user consented to move to destination X.
- **What must hold:** a malicious destination or an outside attacker cannot claim a move; old→new principal mapping works for apps and peers; the record survives key rotations on both sides and the source's later shutdown; replays and forks fail closed.

### 3.2 Options considered

| Option | Signed by | Names | Verdict |
| --- | --- | --- | --- |
| R1. Source identity key signs, naming the destination's provider-key fingerprint | Identity signing key at the source | The user's source key in the header `kid` | Rejected. It still names a user key, and the destination must keep listing source user keys. |
| R2. Source transfer key signs a consent record naming the destination's transfer-key fingerprint | Source provider | Destination provider key fingerprint | Sound. A malicious source could name a fingerprint the destination never agreed to or does not hold. |
| **R3. R2 plus a destination acceptance, signed before commit and bound into the record by digest** | Both providers | Destination provider key fingerprint and the acceptance digest | **Recommended.** Neither provider alone can produce a published move. It proves the destination holds the named key. It costs one signature and about 1 KiB. |
| R4. Destination-signed claim plus the source's unsigned TLS annotation | Destination provider | — | Rejected. A malicious destination could claim moves, and nothing remains after the redirect window. |

Q15 asks the owner to confirm that the countersignature is mandatory.

### 3.3 Transfer keys

The `portability.v1` feature replaces `attestation_jwks_uri` with **`transfer_jwks_uri`**: a JWKS of the provider's ES256 **transfer keys**. They are provider keys, never identity keys. They sign only `bindle-identity-move+jwt` and `bindle-move-acceptance+jwt`, separated by `typ` (keys §4).

- **Listing.** A provider keeps listing every transfer key that signed a record or acceptance for as long as it operates, including after it stops using the key. It SHOULD rotate its signing transfer key yearly.
- **Continuity (P16, reduced).** Every transfer key except the provider's first carries `"continuity":{"kid","sig"}`: a 64-byte ES256 signature by an earlier listed key over the ASCII bytes `bindle-transfer-key-continuity-v1.` followed by the new key's RFC 7638 thumbprint. This is the existing portability §5.1 rule renamed. It is the only thing that stops the buyer of a lapsed domain from listing a fresh key next to copied public keys (Q16).
- **Pinning.** A verifier pins an issuer's transfer keys, storing each trusted key's thumbprint **and public JWK**, the first time it pins any identity of that issuer, and an application does so at account link. This is one fetch per issuer, shared by every identity of that issuer, not per user. Later, a key is trusted when it is pinned, or chains by continuity to a pinned key that is still listed or held. A listed set in which no key is trusted is a **transfer-key reset**: nothing it signs is adopted automatically. An SDK MAY ship its home provider's root.
- **Revocation.** A compromised key is removed from the set. Before an automatic adoption while the issuer is reachable, a verifier uses a JWKS fetched within the last hour, and a `kid` missing from a successful fetch is revoked (the existing IP-R1-M3 rule).
- **Re-signing.** A source or destination that rotates away from a compromised key MAY re-sign its committed records or acceptances with identical payloads under a new key. Verifiers treat records with byte-identical payload segments as the same record, so a re-signed record is not equivocation and chain digests still link (both digests below are over payload segments).

### 3.4 The move acceptance (destination)

The destination signs this after the user's authorization exists at the source, and before commit. It says "this destination will host identity `sub` from `from` at `to.identity`".

- Header: exactly `{"alg":"ES256","kid":<destination transfer kid>,"typ":"bindle-move-acceptance+jwt"}`.
- Payload: exactly `{bindle:"move-acceptance", v:1, sub, kind, seq, from:{iss,identity}, to:{iss,identity}, transfer, iat}`.
  - `transfer` is the source-issued transfer identifier (128 random bits, base64url) from the source's `202` answer (§3.6). It binds the acceptance to one authorization, so it cannot be replayed into another.
  - `seq`, `from`, `to` and `kind` must equal the record's.
- At most 2,560 bytes compact.

### 3.5 The move record (source)

The source signs this at commit, after it has verified transfer authority under portability §6.1 and the acceptance under §3.6. It says "the identity `sub`, with the user's consent, has moved from us to `to`, which accepted it with the key whose fingerprint is `dest_key`".

- Header: exactly `{"alg":"ES256","kid":<source transfer kid>,"typ":"bindle-identity-move+jwt"}`. The `typ` is kept; `v:2` distinguishes it from the implemented, user-key-signed statement, which is withdrawn.
- Payload: exactly `{bindle:"identity-move", v:2, sub, kind, seq, prev, from:{iss,identity}, to:{iss,identity}, dest_key, accept, aep, at}`.

| Member | Definition |
| --- | --- |
| `sub`, `kind` | As portability §4. Unchanged by every move. |
| `seq` | `1` for the first move, then the previous record's `seq` plus one. |
| `prev` | `null` when `seq` is 1. Otherwise `sha256-` followed by the canonical unpadded base64url SHA-256 of the ASCII bytes of the previous record's **payload segment**. |
| `from`, `to` | `{iss, identity}` as portability §4. `to.identity` is on `to.iss`'s origin. The two issuers differ. |
| `dest_key` | The RFC 7638 SHA-256 thumbprint (unpadded base64url) of the destination transfer key that signed the acceptance. |
| `accept` | `sha256-` digest of the acceptance's payload segment, in the `prev` encoding. |
| `aep` | The identity's authority epoch at the source at commit. Destination certificates carry a strictly higher `aep`. |
| `at` | Unix seconds of the commit. |

- No user key, no user key id and no consent evidence beyond the source's signature: the signature **is** the consent statement, because a source signs only after portability §6.1 (current recovery credential aged 7 days, a step-up or a 7-day public wait, notices, the destination shown by origin) and, at 3sln.me, the 24 h disputable delay.
- At most 3,072 bytes compact, the existing statement cap.
- **No expiry.** A committed move is permanent history. What expires is around it (§3.10).

### 3.6 The exchange at the move endpoint

Revision 4 of portability §5.2. The destination calls `POST <move_endpoint>`:

```
{"v":2, "sub", "to":{"iss","identity"}, "transfer":<string|null>,
 "acceptance":<JWS|null>, "redirect_base":"<URL>", "migration_jkt":"<thumbprint>"}
```

1. **Start.** The user at the destination names their old account. The destination posts with `transfer` and `acceptance` null. The source answers uniformly `202 {"status":"pending","authorize_url","transfer","retry_after"}`, whether or not the identity exists, as today.
2. **Authorize at the source.** The user follows `authorize_url` by top-level navigation, and the source checks §6.1. Its confirmation page names the destination by origin and also lists the data kinds the destination will copy, with sizes (§5.3). The user may deselect kinds. The current recovery credential (portability §6.1 item 2) is presented by file proof (§4.5). The authorization cannot start while a sign-in method removal or a reissue is pending (§4.2).
3. **Accept.** The destination repeats the POST with `transfer` and an acceptance bound to it. The source verifies the acceptance under the destination's live `transfer_jwks_uri` (manifest-fetched), checks that its claims and `to` origin equal the authorization, and stores its digest and `dest_key`. Until commit it answers `202` with a size `estimate` per consented kind, so that the destination can refuse before anything irreversible happens (§5.3). A new acceptance for the same `transfer` replaces the stored one only before commit and only from the same destination origin.
4. **Commit.** When the delay ends without a dispute, the source commits (portability §6.3, unchanged otherwise) and signs the record. The next POST returns `200 {"status":"moved","record","acceptance","redirect_until","migration":{"endpoint","token","until"}|null}`. `migration_jkt` is the thumbprint of a per-move key the destination generated for the migration channel (§5.4). The endpoint stays idempotent, as today.

The request still carries no credentials. The source acts only on an authorization it already holds, and binds `transfer`, `redirect_base`, `migration_jkt` and the destination origin on first acceptance.

### 3.7 Where the record is published

1. **Source directory and identity routes**, while the redirect lasts: `308` to the destination with the body `{"v":2,"iss","sub","moved":{"record","acceptance"}}`. Portability §10 scope, header and path rules are unchanged. After the redirect ends, these routes give the uniform 404.
2. **Destination identity document:** `moves`, an array of `{"record","acceptance","source_key"}` in `seq` order. `source_key` is a copy of the source's public transfer JWK that signed the record. Verifiers use it only when its thumbprint matches a pin they hold or a key in a live fetch of the source's JWKS (keys §3 item 5 forbids keys taken from the object otherwise). It lets pinned verifiers check a record after the source has shut down. The destination does **not** list any source user key. Per move: 3,072 + 2,560 + 512 + 96 bytes framing = 6,240 bytes. Budget: 32,768 + 16 × 6,240 = **132,608 bytes**, down from 152,576.
3. **Source authorization endpoint:** `identity_moved` with `{"to":{"iss","identity"}}` (portability §11, unchanged).
4. **Destination token response:** `bindle_origin` (`{iss, sub}`) and `bindle_moves` (the `moves` array).

### 3.8 How apps and peers verify, and map old to new

**Adopting a move** (replaces portability §8.3). A verifier with a pin for the origin principal adopts a record automatically only when all of these hold:

1. **Source signature.** The record's `typ` is exact, and its `kid` resolves to a source transfer key that is trusted under §3.3 (pinned, or continuity-linked to a pin). If the only path is a first fetch of the source's JWKS during this verification, the result carries `source_unanchored: true` (it replaces `attestation_first_use`).
2. **Linkage.** `from` equals the pinned current issuer and identity URI. `seq` equals the pinned `seq` plus one, and `prev` equals the pinned head. `sub` and `kind` are unchanged.
3. **Destination signature.** The acceptance verifies under a key from `to.iss`'s live `transfer_jwks_uri` **whose thumbprint equals `dest_key`**. Its `sub`, `kind`, `seq`, `from` and `to` equal the record's, and `accept` equals the digest of its payload segment.
4. **Destination agrees.** The destination's manifest meets the protocol §2 floor and declares `directory.v1`. Its directory `?sub=` lookup returns exactly `to.identity`. The identity document there has matching `iss` and `sub` and a `moves` array ending with this record and acceptance.
5. **The source has let go** (portability §8.3 item 5, unchanged). The source's directory answers with the `308` or moved body carrying this exact record (byte-identical payload), or 404. An unreachable source is `temporarily_unavailable`, and after 7 days of failed attempts it counts as gone.

**Effects of adoption.** Atomically: update the successor pin (`seq`, head digest, current issuer and identity URI); map `(to.iss, sub)` to the origin principal; **replace the identity-key pin** with the current active signing key of the destination's document (a provider-attested key reset, not a continuity link); stop accepting the earlier host's identity and certification keys; raise the `aep` floor to the record's `aep`; and pin the destination's transfer keys if not already pinned. Adoption is an authority reset (organizations §5.2a), as today.

**First contact** (replaces portability §8.6). A verifier meeting a moved identity for the first time walks the chain from the origin. Each record must pass items 1–3 against the previous record instead of a pin. A source transfer key is anchored by a pin, by `source_key` matching a pin, or by a live fetch (which sets `source_unanchored`). Each source must pass item 5 under the 7-day rule. If any source is both unreachable and unpinned, the chain is unverified: the verifier keys the identity by its current `(iss, sub)`, shows the origin claim as unverified, and never merges the two later without a human decision. The fetch-budget rule (IP-R1-M8) is unchanged.

**Applications** map old to new when the token response from `to.iss` carries `bindle_origin` equal to an existing account's principal, `sub` is unchanged, and the `bindle_moves` chain verifies as above. If the result carries `source_unanchored`, the app confirms ownership through a channel it already holds (for example its own verified email) before linking. Otherwise the user is new. The SDK helper does all of this (phase 3), and apps SHOULD pin the issuer's transfer keys at account link (Q14, modified: it was the per-user key thumbprint).

### 3.9 Interaction with key rotation and shutdown

| Event | Effect on the record | Rule |
| --- | --- | --- |
| Destination rotates the identity's signing key, once or many times | None. The record names no user key. | Normal §3a.4 continuity at the destination. Verifiers re-pinned at adoption and follow continuity from there. |
| Source rotated the identity key before the move | None | The source destroys its identity keys at commit (portability §6.3). |
| Source rotates its transfer key after the move | None | It keeps listing the old key with continuity. `source_key` in `moves` still matches pins. |
| Source transfer key compromised | New verifications fail once the key is removed | The source re-signs the identical payload under a new key (§3.3) and the destination replaces its `moves` entry. Earlier adopters keep their pins. |
| Destination rotates its transfer key | None | It keeps listing the old key. `dest_key` keeps naming the key that signed. |
| Destination transfer key compromised | The attacker can sign acceptances, but cannot get a source record | The destination re-signs the acceptance. The source re-binds only if it is still running. Otherwise `dest_key` keeps the old key. Verifiers that already adopted keep their pins. |
| Source shuts down after the redirect window | Live checks against the source are impossible | Verifiers with a pin, or with `source_key` matching a pin, verify offline. Item 5 counts as gone after 7 days. First-contact verifiers without a pin get an unverified chain. |
| Source shuts down **during** the window | Same, and migration stops | §5.9 "Source goes offline". A source SHOULD warn its moved identities' destinations and keep the migration channel up for at least 30 days after the warning. |
| Source domain lapses and is bought | The buyer can serve forged moved bodies and a new JWKS | No pinned key and no valid continuity, so it is a transfer-key reset for pinned verifiers. First-contact verifiers get `source_unanchored` (residual, as before). |
| A later move B → C | B is the source of a new record with `seq` 2 | B signs with B's transfer key. `prev` links to record 1. C's `moves` holds both, each with its own `source_key`. |

### 3.10 Expiry and the windows

- **Authorization** (before commit) expires under portability §6.2: at most 7 days after authorization on the session path. The acceptance is useful only while it does, because it is bound to `transfer`.
- **Record:** never expires.
- **Redirect window:** `redirect_until` is at least `at` + 90 days at 3sln.me (free), extendable by the US$10 ten-year extension (Q13, approved). It is not in the record, because extending the redirect must not change a signed object. It is returned at commit and is visible in the source's owner console.
- **Migration window:** `migration.until` defaults to the end of the free 90-day window and never extends beyond `redirect_until` (§5.4, Q18).
- **After the redirect ends:** the source treats the identity as deleted (uniform 404), never reassigns its handles or `sub`, and keeps listing its transfer keys while it operates.

### 3.11 Replay, forgery and hijack; the trust assumption

**Trust assumption.** The source provider is fully trusted for the identities it hosts until a move commits. It custodies their keys and could always impersonate them, so it can also move them: a malicious or compromised source can move a user to an accomplice destination that signs the acceptance. The protocol cannot prevent that. It only bounds it: notices and delays are the duty of an honest source (portability §6.1, 3sln.me's 24 h delay), and verifiers that pinned the identity see an authority reset. No other party, alone, can claim a move.

| Attack | Defence |
| --- | --- |
| An outsider or a malicious destination claims a move (forged `bindle_origin`, forged `moves`) | It needs a record signed by the source's trusted transfer key naming exactly that destination and identity URI. A destination can sign acceptances freely, but they are inert without a record. |
| A record replayed to a different destination, or presented for a different identity | `to`, `sub` and `dest_key` are signed. Item 3 requires the destination's own acceptance, and item 4 its directory. |
| An acceptance replayed into another authorization | It names `transfer`, which binds one authorization, one identity and one destination origin. |
| An old record replayed after a later move (A→B replayed once the user is at C) | `seq` and `prev`. Pinned verifiers ignore a record at or below the pinned `seq` whose payload is identical. |
| Source equivocation: two records with valid signatures for one `seq` and different payloads | Contested, fail closed, keep the pin, report (portability §8.4, now defined on payload segments). |
| A forged or cached `308`, CDN mistake or redirect man-in-the-middle | Redirects are hints. Adoption needs both signatures and the destination directory. |
| A leaked source transfer key, source still running | A forged record fails item 5: the source's directory still serves the identity or carries the real record. The source removes the key, and the one-hour fetch rule makes it revoked. |
| A leaked source transfer key after the source is gone | Residual for first-contact verifiers with no pin. Pinned verifiers that already adopted detect a broken `from` or equivocation. |
| Lapsed source domain | §3.9. No continuity from a pinned key. |
| Annotation-driven phishing ("reconnect at evil.example") | It requires a valid record, so the source must be compromised. Apps always show the destination origin before redirecting. |
| A stolen current recovery file plus a session starts a move | Unchanged: portability §6.1 and 3sln.me's rules (file aged 7 days, step-up credential aged 7 days, 24 h notified delay, disputes, no waiting path within 7 days of a reset). |
| A hostile `sub` collision at the destination | Unchanged: index conflicts (IP-R1-M5) make both identities contested. |

### 3.12 How apps detect a move and users reconnect

Apps learn of a move only on their next contact; nothing is pushed (Q12, approved). At commit the source severs connections with terminal `connection-revoked` and revokes grants and tokens. After that, any of these tells the app: a failed token refresh and an `identity_moved` answer at the source's authorization endpoint; a directory or identity-document fetch that returns the `308` with the signed body; or the user signing in through the new provider, whose token response carries `bindle_origin` and `bindle_moves`.

The app shows "Your account moved from `3sln.me` to `b.example`", naming both origins and highlighting the registrable domain. A button starts fresh discovery at `to.iss` (protocol §2). The app never forwards PKCE material, codes or tokens. After sign-in, the app links the account under §3.8, asks for grants again, and re-pulls any state it holds for the user (§5.2, "App-held state").

### 3.13 How peers follow a move

- **Parlay contacts.** Receivers key peers by origin principal (AMD-P8). An author whose `(iss, sub)` is unknown and whose identity document carries `moves` is checked under §3.8 against the receiver's pins. If it passes, the author is matched to the existing peer and the identity-key pin is replaced. Delegation certificates from the destination are then signed by the new key. A receiver with no pin treats the author as a new peer, the safe direction.
- **Signaling pairings.** Counterparts key them by origin principal, and they keep matching after adoption (signaling §14.3). The source deletes its own offers and pairings at commit. In-progress sessions are not migrated.
- **Organization memberships and relation edges.** Keyed by origin principal. Adoption is an authority reset: governance is held until re-confirmed (organizations §5.2a). Member and entity certificates are re-acquired under the destination's certification keys.
- **Apps:** reconnect (§3.12).
- **Defunct or hostile source:** there is no record. Peers see the uniform 404, the user creates a new identity, and counterparts re-add them.

## 4. Recovery file lifecycle

§4.1, §4.2 and §4.4 are approved as written in the first revision (Q4–Q11). §4.3 is revised for the owner's hash proof of download. The additions to §4.2 (password-free rules, pending-removal interlocks) and §4.5 (file proof) answer the sign-in spike and are provisional.

### 4.1 Payload v3 (opaque)

The payload is `{version:3, issuer, entity, recoveryToken, fileId, issuedAt}`.

- `fileId` is a random, non-secret 128-bit id. It is also placed in the **public envelope header**, and it is included in the AAD so that tampering is detected after decryption. The security console shows the current file's id and issue date.
- There is no keychain and no provider proof. An opaque token is checked server-side by its hash, and the browser checks `issuer` against the selected provider as today.
- Name certificates keep the provider authority.
- Adding `fileId` to the header changes the strict schema, so this is in effect envelope v2, with no legacy reader needed (Q10, approved).

### 4.2 Periodic reissue and overlap

This builds on the existing two-phase reissue (`reissueRecoveryBegin` / `Confirm` / `Cancel*`), which already keeps the old file current until confirmation.

- **Cadence.** The console offers a new file **at least annually**, and on request at any time. An offer is a reminder; it changes nothing on the server.
- **Nothing expires.** An old file never expires by age and is never cancelled before acknowledgement. Begin stages the new file; the old one stays current until confirmation (§4.3). An abandoned or failed reissue leaves the old file current.
- **Reminders.** 30 days before the anniversary, on it, then monthly, by push and the verified email, plus a console banner. Transport acceptance is recorded, never delivery.
- **After confirmation, the 2026-10-23 cooling-off window is kept**, including for scheduled annual reissues (Q4, approved). No file can start a recovery for 7 days after a reissue; passkeys, email sign-in and existing sessions keep working. File proof (§4.5) is also refused while a reissue is pending and for those 7 days (sign-in spike RM-7), for the same reason.
- **Forced reissue paths are kept:** an elevated-proof abort and a completed recovery. A recovery always ends with a new file. Arrival by move also forces one: the destination issues its own file (§5.2).

**The cooling-off rules restated without passwords** (passwords are dropped, owner-approved 2026-10-28; restatement provisional, Q28). Rules (a)–(d) of [recovery identity](../3sln/accounts/recovery-identity.md) "Cooling-off window" become:

- **(a) Passkey only.** A voluntary reissue (scheduled or on request) needs a passkey step-up within the last 5 minutes with a passkey enrolled at least 7 days earlier. Nothing else authorizes it. An account whose only methods are sign-in emails cannot begin a voluntary reissue: the console says to add a passkey and wait 7 days (sign-in spike SI-13 and SI-4). Forced reissues (a completed recovery, an elevated-proof abort, arrival by move) are unaffected.
- **(b), (c)** unchanged: the new file cannot start a recovery for 7 days; earlier sessions and the pre-reissue email (and addresses replaced in the 30 days before the begin, as today) can cancel.
- **(d) The previous file is cancel-only, and only after an *ordinary* reissue.** The former "password branch" is renamed the **ordinary branch**: every reissue that is not file-locked. Its definition no longer mentions passwords. After an ordinary reissue the previous file can cancel the pending reissue (`/cancel-file`) and regains full authority only through that cancellation. After a **file-locked** reissue (today called "file-proof": a passkey enrolled before the previous file was issued, and no channel-removing event in the 30 days before the begin, unchanged; recorded as `recoveryPrevious.fileLocked`) it can neither recover nor cancel. The branch is renamed because the sign-in spike uses "file proof" for the presentation of §4.5, which is unrelated. Under v3 the cancel check is the previous file's token hash and `fileId`, not a v2 kid binding.
- The "no passkey and no email" case disappears: the sign-in floor (sign-in spike SI-12) means every active account has a passkey or a sign-in email, and an email-only account does not reissue voluntarily.

**Pending sign-in method removal blocks reissue and transfer** (sign-in spike RM-6; provisional). While a Tier B sign-in method removal is pending:

- **reissue begin is refused** with "finish or cancel the pending sign-in change first". A begin cancels nothing. Forced reissues still run, and a completed recovery cancels every pending removal (RM-8);
- **a transfer authorization cannot start** at the source (§3.6 step 2), with the same message;
- conversely, a Tier B removal cannot be requested while a reissue or a transfer authorization is pending. The three flows are mutually exclusive per account, serialized in the identity's single writer. A removal that takes effect is a contact-channel change, so the existing portability §6.1 exclusions (7 days on the session path, a fresh wait on the waiting path) then apply to any later transfer.

### 4.3 What "acknowledge" proves: hash proof of download (provisional details)

The owner's direction: the user re-uploads the recovery file still encrypted; the browser hashes it and compares the result with the hash of the encrypted bytes it downloaded. Nothing is decrypted.

**What is hashed.** SHA-256 over the exact bytes of the downloaded Blob: the UTF-8 serialization of the envelope that the setup document produced. The browser computes it once, before triggering the download, from the same `Uint8Array` it wraps in the Blob, so the hash describes exactly what was offered for saving.

**Where the hash is kept: both places** (Q20).

| Location | Purpose | Lifetime |
| --- | --- | --- |
| Setup document memory | Immediate comparison and precise error messages without a server round trip | Until the page closes |
| Server, as `envelopeDigest` on the staged file | Confirmation after a reload, on another device, or later from the console. Also the reference for the periodic check-up. | With the staged file; it becomes the current file's digest at confirmation and is replaced at the next reissue |

The browser sends `{fileId, envelopeDigest}` to the server when it stages the file (the existing download step), with the same authority as today. The server cannot check that the digest matches real bytes, because it never sees them. That is acceptable: the check guards the user against a failed save, not against themselves. The digest is not a recovery credential. It cannot start a recovery or reveal anything about the answers, and confirmation still needs the owner's session and the staged state. A leaked digest would let someone who also holds a candidate file confirm that the file is current, which they could learn from `fileId` anyway.

**Flow.** Download, then "Check your saved file": the user picks the file with a file picker. The browser reads the public header first. If `fileId` differs, it says "this is a different recovery file". Otherwise it hashes the picked bytes and compares them with the in-memory digest, or with the server's `envelopeDigest` when memory was lost. A match enables confirmation, and the server compares again on `confirm`. A mismatch with the right `fileId` says "this copy was changed or damaged; download it again".

**What it proves:** the exact bytes that were downloaded exist where this device's file picker can reach them, complete and unmodified, at the time of the check. In other words, the save completed and the user can find the file.

**What it does not prove:** that the user remembers the answers (nothing is decrypted); that a copy exists off this device; that the file will survive; that the file opens on another device within its memory limits. The UI asks the user to keep a second copy elsewhere and says honestly that the service cannot check this. For the same reason the hash check **never counts as file proof** (§4.5) and authorizes nothing beyond confirming its own staged file.

**The answers check stays separate** (Q21). Setup keeps the existing in-memory round trip, in which the user re-enters every answer and the browser decrypts the in-memory envelope. That is the only check of answer memory. Order: answers round trip, then download, then hash check, then confirm.

**In-memory fallback.** Where picking the downloaded file is impractical (some in-app browsers block downloads or file pickers), the user may confirm after the answers round trip alone. The file is then marked `downloadUnverified`: the console shows "file not yet checked", and reminders follow after 7 days and then 90 days. Because the server holds `envelopeDigest`, the user can complete the check later from any device (for example a laptop where the file was synced) without a reissue.

**Confirmation** remains the only event that makes the new file current, and the server still requires the staged file's token, which the setup document holds in memory as today. When memory was lost (a reload), the server-held digest plus the owner session and step-up authorize confirmation of the staged file instead.

**Periodic check-up.** Separate from reissue, the console offers "check my recovery file". The user picks the file, and the browser hashes it and compares the result with the current file's `envelopeDigest`. No answers are entered and nothing is decrypted. An optional "also test my answers" step decrypts locally and compares `fileId`, with no server call. A failed check offers a reissue.

### 4.4 Questionnaire encryption

Approved as in the first revision.

- **Answers never leave the device.** They are processed only in the isolated `/recovery/setup` and `/recovery/restore` documents.
- **KDF.** Argon2id v19, 64 MiB, t=3, p=1, 32-byte output, random 16-byte salt. Do not lower it, and do not fall back silently. Low-memory phone measurement remains a release gate.
- **Brute-force resistance.** Answers from personal facts have low entropy. As an unmeasured order of magnitude, a space of 2³⁰ candidates falls in days to weeks on one GPU, so the answers are a speed bump, not a secret, unless the user adds a private passphrase. Under C a cracked file yields only a revocable, online-only reset token.
- **Server-assisted (OPRF) hardening:** deferred (Q8, approved).
- **Forgotten answers.** The file is unusable. The user signs in with another method and reissues. Support does not bypass this.
- **Optional printed recovery code slot** (Q7, approved, phase 1b): a 26-character Crockford Base32 code (130 bits) as a second wrap of the data key. A passkey-PRF slot is not recommended.

### 4.5 Proof-only presentation ("file proof", provisional)

The sign-in spike (§6.4, RM-2, RM-4, RM-5) needs the owner to prove possession of the **current** file **and** its answers to authorize a sensitive action, such as removing an established sign-in method, without starting a recovery or a reissue. This is that presentation.

- **Key.** When the server creates the token, it also computes `proofKey = HKDF-SHA256(recoveryToken, salt = fileId, info = "bindle-recovery-proof-v1")` and stores `proofKey` sealed under `KEY_ENCRYPTION_KEY` next to the token hash. The payload is unchanged. `proofKey` cannot start a recovery and does not reveal the token.
- **Challenge.** On a signed-in owner session, the action's page asks the server for a challenge bound to `{session, action, target, fileId of the current file}`: for example `remove-method` and the method id. It is single-use and expires after 5 minutes.
- **Presentation.** The isolated `/recovery/prove` document (the same isolation as `/recovery/restore`; answers never leave it) takes the picked file and the answers, decrypts locally, checks `issuer` and that `fileId` equals the challenge's, and returns only `mac = HMAC-SHA256(proofKey, "bindle-recovery-proof-v1\n" ‖ challengeId ‖ "\n" ‖ action ‖ "\n" ‖ target)` to the page. **The token never leaves the isolated document**, so a compromised console page learns a single-use MAC, not a reset credential.
- **Server check.** `fileId` is the current file's (not a staged, superseded, voided or consumed one). The file was issued at least 7 days ago, and no reissue is pending or confirmed within 7 days, and no recovery completed within 7 days (RM-7). The challenge is unused, unexpired and bound to this session, action and target. The MAC verifies in constant time. Then the action proceeds under its own rules (delays, notices).
- **Effects.** None on the file: no recovery starts, no session is revoked, no reissue happens, and the token stays current. The use is audited and a notice goes to every channel ("your recovery file was used to authorize …").
- **Limits.** A wrong answer fails locally (decryption fails), so the server sees only presentations of files that decrypt. A MAC failure therefore means an old or foreign file. After 5 failures in 24 hours, file proof is locked for 24 hours with a notice. Every challenge is rate-limited per account and network.
- **Signed-out cancel (RM-5).** A pending Tier B removal may also be cancelled with file proof from the signed-out cancel page linked in the notice. There the challenge is bound to the pending removal id instead of a session, behind CAPTCHA, and it can only cancel.
- **What it proves:** at presentation time, possession of the current file and knowledge of its answers (or its code slot, §4.4), checked by the server. **What it does not prove:** that the presenter is the owner rather than someone who stole the file and cracked the answers. That is why it is combined with an established passkey where one exists (RM-4), refused during the post-reissue gap, and followed by delays and notices.
- **Not file proof:** the hash re-upload of §4.3, which proves the encrypted bytes were saved but not that the answers open them.
- **Transfer.** The portability §6.1 item 2 presentation of the current recovery credential at the source uses the same mechanism, with action `transfer` and the transfer identifier as target (Q29). The 7-day age rule of item 2 is the same rule as above.

## 5. Background migration (provisional)

The owner asked for a background, slow migration of settings and data from the previous provider to the new one, with corner cases resolved. This section designs it. Portability §11 "Data" today says data migrates only through export and import formats it does not define; §5 is that definition, at the minimum level of detail an interoperable pull needs.

### 5.1 Principles

1. **Freeze at commit** (Q17). At commit the source already stops treating the identity as active (portability §6.3): no sessions, no tokens, no new artefacts. The account's data is therefore a fixed **snapshot** from the commit onwards, and no delta sync is needed. Changes the user makes between consent and commit are in the snapshot.
2. **Destination pulls, source serves.** The source is passive and read-only. It serves the snapshot to exactly one party, authenticated by a key the destination named before commit.
3. **The move consent authorizes it.** The source's confirmation page (§3.6 step 2) lists the kinds and sizes, and the user may deselect kinds. Nothing outside the consented kinds is served.
4. **Usable first, complete later.** Small, high-value kinds first; bulk bytes last; the destination account is usable from activation.
5. **Nothing that is trust migrates as trust.** Grants, sign-in methods, verification states, recovery credentials and certificates never carry over. They arrive at most as suggestions the user acts on.
6. **Reuse the export.** At 3sln.me the source side is the account export's contributor projections ([account deletion and export](account-deletion-export.md) §1.1), with the same redactions, served page by page instead of as a tar. The inventory-completeness test then covers migration too.

### 5.2 What migrates

| Kind | Migrates? | How it arrives at the destination |
| --- | --- | --- |
| Preferences, fragments and field values (contract-keyed) | Yes, per contract URL and version the destination supports | Imported as the owner's values. A contract the destination does not support is parked or skipped (§5.9). |
| Grants and app connections | **No, as grants** (protocol §1) | A list of previously connected apps (client id, origin, display name, fragments it held) becomes **reconnect suggestions**. Each app needs consent again at the destination. Apps unknown at the destination appear by origin only, unverified. |
| Hosted storage objects (resources) | Yes: descriptors, logical keys, versions, content types and bytes | Bytes are verified by SHA-256 (§5.5). Resource URLs change, so counterparts re-consent (portability §11). |
| External storage (Drive, S3, R2 in the owner's account) | References only | Credentials never migrate. The user reconnects the integration at the destination, which then applies the imported logical-key mapping. |
| Provider-held contacts and lists (profile, saved contacts, sharing settings) | Yes | Imported as records. Entries pointing at other identities stay keyed by those identities' origin principals. |
| App-held contacts and state (Parlay conversations, peers) | No: they live with the app | The app reconnects and re-keys by origin principal (§3.12). |
| Signaling pairings, offers, designations | No (deleted at commit) | A summary of paired peers becomes suggestions to pair again. Sessions are never migrated. |
| Key delegations (Parlay device keys) | No (revoked at commit) | Apps request new delegation certificates under the destination's identity key. |
| Organization memberships (person side) | The list only | Organizations treat the adoption as an authority reset; certificates are re-acquired. The moving identity's own organizations are unaffected. |
| Organization identity data (an organization moving) | Only if the destination declares the organizations extension and supports its policy records; otherwise the destination refuses before commit (§5.3) | Imported as the organization's records. Governance is held until re-confirmed. |
| Activity history | Yes, read-only, bounded by the destination's retention policy | Imported as history. Nothing re-fires. |
| Notification preferences | Yes | Push subscriptions do not migrate (they are capability URLs); devices subscribe again. Undelivered notifications are not migrated. |
| Email addresses | Addresses on other domains: yes, **as unverified** (Q23) | The destination sends one-click re-verification. Only a verified address can become a sign-in email again, by the user's own toggle (sign-in spike, approved states). Addresses on the source's own domain do not move; the source MAY forward mail to them during the window. |
| Passkeys, sign-in emails, sessions | No | Passkeys are bound to the source's RP ID. The user enrolls methods at the destination before or at activation. |
| Recovery file | No | The source's file is dead from commit (the source refuses recoveries). The destination makes the user create a new file at activation (forced issuance), using §4.3. |
| Handles and name certificates | No | Chosen at the destination before commit (§5.3). The old handle stays retained at the source and is never reassigned. |
| Billing, plan, invoices | No | The source settles under its own policy at commit (proration or cancel at period end). Invoices stay downloadable from the source's owner export during the window. The destination starts its own billing. |
| Security log, audit, lifecycle and quota state | No | Available in the source's owner export during the window. |

### 5.3 Preflight, before commit

Everything that could make the destination refuse is checked before the source commits, while the move can still be abandoned at no cost:

- **Estimate.** Once the user has authorized at the source, the move endpoint's `202` carries `estimate: [{kind, contract?, count, bytes}]` for the consented kinds.
- **Destination checks.** The destination checks quota (bytes, with headroom), supported contracts and kinds, the organizations extension for an organization move, its own document budget, a free handle the user has chosen, and at least one sign-in method enrolled at the destination. It then either signs the acceptance or tells the user what to change: upgrade, deselect kinds at the source, or pick another handle.
- **Shown to the user at the source:** the destination origin, the kinds and sizes, which kinds the destination said it cannot import, and the migration window.

### 5.4 The channel and its authorization

- **Endpoint.** `migration.endpoint`, an HTTPS URL on the source's origin, returned at commit. Optional in the feature; a source without it offers export only (Q19).
- **Token.** `migration.token` is an opaque, high-entropy access token. The source stores only its hash. It is scoped to one moved identity, read-only, limited to the consented kinds, and valid until `migration.until`.
- **Sender-constrained.** The token is bound to `migration_jkt` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) `cnf.jkt`). Every request carries a DPoP proof signed by the per-move key the destination generated before commit, so a leaked token alone is useless. This key is neither a transfer key nor an identity key. A DPoP row is added to keys §4 for it.
- **Window.** `until` defaults to the end of the free 90-day redirect window (Q18). The source SHOULD extend it by any period in which it was itself unavailable. It never extends beyond `redirect_until`.
- **Ending early.** The destination ends the channel with `complete` (§5.5). The user can end it from the destination, which calls `complete` with `cancelled`. The source cannot authenticate the user directly any more. It accepts end requests only over this channel or through a chain it verifies (portability §10 "Ending early").
- **Rate limits.** The source advertises `limits: {rps, bytes_per_day}` in the manifest and answers `429` with `Retry-After`. A source MUST offer at least enough throughput to move its largest plan's quota within 30 days (Q24). The destination backs off with jitter and never exceeds the advertised rate.

### 5.5 Wire

All responses are JSON except blob bodies. Every response carries `Repr-Digest: sha-256=…` ([RFC 9530](https://www.rfc-editor.org/rfc/rfc9530)) over its exact bytes.

- `GET {endpoint}/manifest` returns `{v:1, sub, snapshot_at, until, limits, kinds:[{kind, contract?, version, count, bytes, pages}], excluded:[{kind, reason}]}`. `kind` is a short registered name for generic kinds (`fragments`, `resources`, `lists`, `activity`, `notification-prefs`, `emails`, `connected-apps`, `pairings-summary`, `memberships`) or an HTTPS URL for provider-specific kinds.
- `GET {endpoint}/kinds/{kind}?cursor=…` returns a page `{records:[…], next:<cursor|null>}`. A page is at most 1 MiB and 500 records. Cursors are stable, because the snapshot is immutable. Each record carries a stable source `id` and `version`.
- `GET {endpoint}/blobs/{entryId}` returns the bytes, with `Range` support, exact `Content-Length`, and the SHA-256 and size that the `resources` record listed. The destination checks both before it commits the object.
- `POST {endpoint}/complete` with `{status:"complete"|"cancelled", kinds:[{kind, imported, skipped, bytes}]}` ends the channel. The source records the summary, notifies the user's former channels where it still may, and schedules deletion (§5.8).

**Idempotency and resume.** The destination keys every imported record by `(origin principal, kind, source id, version)` and every blob by its SHA-256. Re-importing is a no-op. It persists each kind's cursor only after the page's records are durably imported, so a crash repeats at most one page.

### 5.6 Ordering and dependencies

1. **Activation (synchronous at commit):** the identity, its fresh keys, the chosen handle, the enrolled sign-in methods. The forced recovery-file issuance (§4.3) is prompted at once.
2. **Settings:** contract definitions the destination needs, then fragment and field values, notification preferences, emails (unverified, re-verification sent).
3. **Structure:** lists and contacts, tags and categories before the rules that reference them, membership list, connected-app and pairing suggestions.
4. **Resource metadata**, then **blobs**, smallest first, so that items referencing a blob find its descriptor already present and show "still arriving".
5. **History:** activity.
6. **`complete`.**

A record that references something not yet imported is imported with a pending reference and resolved when the target arrives. A reference still unresolved at `complete` is reported as skipped.

### 5.7 Progress the user sees

- **At the destination:** a "Moving your data from `3sln.me`" panel with per-kind progress (records and bytes), an estimated finish, the window's end date, a list of skipped and parked items with reasons, and actions (pause, resume, stop the migration, upgrade storage). Notifications at milestones, on stalls longer than 24 hours, 14 days before the window ends, and at completion.
- **At the source** (the owner's 410 export console, portability §6.3): "Moved to `b.example` on …; data copy in progress / complete; data at this provider will be deleted on …", plus the owner export as an escape hatch.

### 5.8 Source retention and deletion

- The source keeps the snapshot until `complete` plus 7 days, or until `migration.until`, whichever comes first. A `cancelled` completion is treated the same way, after a confirmation step at the destination that says the source will delete the rest.
- It then deletes through its ordinary deletion executor. It never emits `subject-deleted` (AR-9), keeps the identity tombstone (handles retained, `sub` never reused), and keeps the redirect record and its transfer keys.
- **Legal holds** override deletion for the held data only. Held data is still served to the migration within the window, because a hold restricts deletion, not access.
- **Owner export** stays available at the source until deletion (Q26). It is the user's fallback for unsupported kinds, a hostile destination, or a window that is too short.

### 5.9 Corner cases

| Case | Resolution |
| --- | --- |
| Source goes offline mid-migration | The destination retries with exponential backoff and resumes from the stored cursors. The source SHOULD extend `until` by its outage. If it never returns, the destination keeps what it has, marks the rest "not received", and tells the user. The move itself is unaffected, because the record is already published. |
| Source refuses or turns hostile after consent | The protocol cannot force a source. The destination reports "your old provider stopped sending data", keeps what it has, and points the user to the source's owner export. For a source that declares `migration_endpoint`, serving the window is a conformance requirement, and a refusal is a reportable conformance failure. 3sln.me as a source commits to it in its terms. |
| User changes data at the source during migration | Impossible after commit: the account is frozen (§5.1). Inbound traffic after commit follows the portability §10 redirects to the destination. Mail to source-domain addresses is forwarded during the window or bounced with a notice (source policy). No delta sync. |
| Quota exceeded at the destination | Prevented by preflight (§5.3). If it happens anyway (estimate drift, or the user fills the new account), the destination pauses only blob import, keeps importing metadata, and asks the user to upgrade, delete or stop. Anything not imported by `until` remains in the source's owner export until deletion. |
| Unsupported kinds or contracts at the destination | Listed at preflight. At import, records of an unsupported contract are parked as inert opaque data up to 10 MiB per account and applied if support arrives within the retention period. Anything beyond that is skipped and listed (Q25). Never silently dropped. |
| Conflicting handles | Resolved before commit: the user picks a free handle at the destination. Handles never move. |
| Grants for apps not known at the destination | Reconnect suggestions only, shown by origin as unverified. The app goes through normal discovery and consent at the destination. |
| Partial failure and retry | Page-level idempotency (§5.5). A record that fails import three times is set aside as "could not import", with the reason, and the cursor moves on. A blob with a digest mismatch is retried once from scratch, then reported. |
| User cancels mid-way | The move is not undone: it is committed, and going back is a new move with a higher `seq`. Cancelling stops the pull and calls `complete` with `cancelled`, after a warning that the source will delete the rest 7 days later. Imported data stays. |
| Second move before the first migration completes | By default the destination refuses to start an outward move while an inbound migration is incomplete. The user may override after a warning that the rest of the first provider's data will not follow; the override calls `complete` with `cancelled` on the first channel (Q22). |
| Source deletion timing | `complete` + 7 days, or `until`, whichever comes first (§5.8). Legal holds excepted. |
| Legal holds and export | §5.8. The owner export covers what migration does not, until deletion. |
| Very large accounts | Throughput floor (§5.4), smallest blobs first, and the window shown with an ETA from day one. If the ETA exceeds the window, preflight says so and recommends the owner export for bulk bytes, or a paid redirect extension where the source offers a longer migration window. |
| App-held state | Not migrated by providers. Apps detect the move (§3.12), link the account under §3.8, and re-pull or re-key their own state by origin principal. |
| The destination is deleted or shut down during migration | The source ends the channel when `to.identity` answers 404 for 30 days (portability §10) and deletes on schedule. |
| Token or DPoP key leak at the destination | The key is required with the token, and the channel is read-only, scoped and time-bounded. The destination can end the channel with `complete` and ask the source, through a verified chain, for a new token bound to a new key. |

## 6. Spec impact, dev-data migration, phases and open questions

### 6.1 Spec impact (proposed change requests, unsigned)

| Document | Change |
| --- | --- |
| [Identity portability](../spec/extensions/identity-portability.md), new revision 4 | §1 model: two provider signatures, the source's record and the destination's acceptance. No user key. §2 terms: move record, move acceptance, transfer key. §3: `transfer_jwks_uri` replaces `attestation_jwks_uri`; `transfer_in_endpoint` dropped; `move_endpoint` kept; new optional `migration_endpoint` semantics returned at commit. §4: the move record (v2, provider-signed, `dest_key`, `accept`, `aep`, `at`, payload-segment digests). §5: transfer keys (§5.1 reduced and renamed), the exchange of §3.6, the acceptance format. §6 authority: kept, minus the key-possession sentences, plus the kinds list on the confirmation page. §6.3: kept. §7: `moves` holds `{record, acceptance, source_key}`; no source user keys listed; budget 132,608 bytes. §7.1: replaced by "the destination generates a fresh identity key". §8.3, §8.6: rewritten as §3.8 here; `source_unanchored` replaces `attestation_first_use`; §8.4 equivocation defined on payload segments. §8.5 unattested moves and §9 package: withdrawn. §10 redirects: body carries `{record, acceptance}`. §11 "Data": points to the new migration section. New section: background migration (§5 here). AMD-P5: only the move row remains. AMD-P11: withdrawn. AMD-P6: "a recovery file holds no keys and is never transfer authority by itself". |
| [Keys](../spec/keys.md) §4 | Rows: `bindle-identity-move+jwt` (source transfer key), `bindle-move-acceptance+jwt` (destination transfer key), and DPoP proofs on the migration channel (a per-move key, never an identity or transfer key). The `bindle-move-attestation+jwt` proposal is dropped. |
| [Organizations](../spec/extensions/organizations.md) §3, §3a | The organization recovery file holds no private keys (v3). §3a.3: `moves` entries change shape; the cross-host no-rollback rule is kept and trivially met by the fresh key. §3a.4: adopting a move replaces the identity-key pin (a provider-attested key reset), already an authority reset under §5.2a. |
| [Messaging](../spec/extensions/messaging.md), [signaling](../spec/extensions/signaling.md) | No normative change. AMD-P8 wording: "verified under portability §8.3 against the receiver's pins". |
| [Extensions](../spec/extensions.md) revision 3, CR-X3-14 | The `portability.v1` member list changes as above. The approved §2.4 audience-endpoint wording stays, though `transfer_in_endpoint` no longer needs it. |
| 3sln.me: [recovery identity](../3sln/accounts/recovery-identity.md), [recovery file](../3sln/accounts/recovery-file.md), [account lifecycle](../3sln/accounts/account-lifecycle.md) | Payload v3, header `fileId`, hash proof of download with server `envelopeDigest`, the answers round trip kept, check-up by hash, the optional code slot, reissue cadence and reminders, P15 and kid binding removed, stale lifecycle paragraph fixed. Cooling-off rules (a)–(d) restated without passwords (ordinary versus file-locked branch). The proof-only presentation (`/recovery/prove`, sealed `proofKey`, single-use MAC challenges). Reissue, transfer authorization and Tier B removal mutually exclusive. |
| [Sign-in and intents spike](sign-in-and-intents-spike.md) §6.4, §9.3 | Its items (a)–(c) are answered by §4.5 and §4.2 here. That spike is not edited by this revision. |
| [Account deletion and export](account-deletion-export.md) | Contributors also serve migration pages. The source-side retention of §5.8 joins the deletion executor's reasons. |
| [Portability design](identity-portability.md) | P8, P10, P11 and P15 superseded. P16 kept in reduced form for transfer keys. Q4 (unattested transfer-in) and Q1's honouring conditions reversed (Q2, Q3 approved). §6.4 redirects and the extension unchanged. |

### 6.2 Migration of local and dev data

Destructive cleanup is acceptable (owner, 2026-10-27), and is logged in DEVLOG.

1. Stop recognising payload v1 and v2 files. On deploy, mark every account `recoveryRequired` with the existing forced-reissue marker, and drop `recoveryHash`, `recoveryPrevious` and resume hashes. Users with a passkey or email sign in and download a v3 file; dev accounts without either are reset.
2. Delete the recovery kid-binding records, and rotate every identity signing key once, so that keys that sat in v2 files are retired.
3. Delete the identity encryption keys and their retained history, and remove them from exports.
4. Purge moved tombstones, `pending-transfer` identities, transfer-in receipts, successor pins and attestation-key state created in local testing. Transfer keys are generated fresh.
5. Name certificates, handles, memberships and grants are untouched.

### 6.3 Phased plan

| Phase | Scope | Gates |
| --- | --- | --- |
| 0 | This spike. Option C and the first-revision recommendations are owner-approved (2026-10-28). The §3, §4.2 restatement, §4.3, §4.5 and §5 designs await sign-off. | Owner sign-off on Q15–Q30 |
| 1 | Recovery file v3: opaque payload, header `fileId`, hash proof of download (memory and server `envelopeDigest`), `downloadUnverified` fallback and reminders, check-up by hash, file proof (§4.5), password-free cooling-off rules and the pending-removal interlocks (§4.2), annual reminder, P15 and kid binding removed, encryption key removed, dev-data steps 1–3, 3sln.me account docs. Optional 1b: code slot. | `npm test`, `test:recovery-reissue`, recovery e2e in Chromium and Firefox (including picking a modified and a different file, and file proof with a wrong, old and current file), Node and browser vectors, low-memory phone KDF measurement |
| 2 | Portability spec revision 4 (docs), including the migration section. Code: delete the package, transfer-in from package or file, and the unattested paths; rename attestation keys to transfer keys. Keep the transfer-out engine, disputes, redirects and redirect management, with `IDENTITY_TRANSFER_OUT_ENABLED` and `IDENTITY_TRANSFER_IN_ENABLED` off. Record the spec/implementation gap in DEVLOG. Dev-data step 4. | `npm test`, `test:worker`, moved-route and redirect tests |
| 3 | When a second provider is in sight: the record and acceptance, the §3.6 exchange, verifier adoption in organizations, Parlay and signaling, the SDK reconnect helper and transfer-key pinning at link. | Two-provider conformance run; independent review |
| 3b | Migration channel. **Source side first**, because 3sln.me's exit promise depends on it: export contributors served as pages, DPoP-bound token, manifest, limits, `complete`, retention and deletion. Then the destination importer with the ordering, idempotency and progress UI. Engine-level tests with seeded chaos for the §5.9 cases (source outage, digest mismatch, quota, cancel, second move). | `npm test`, engine chaos suite, two-provider run, browser check of progress UI |
| 4 (optional) | User-held recovery key (§2.4), only if a defunct-provider exit is wanted | Separate spike |

### 6.4 Owner questions answered 2026-10-28

All approved as recommended (Reviewer: owner; Date: 2026-10-28; Outcome: approved), with the stated modifications.

| ID | Question | Outcome |
| --- | --- | --- |
| Q1 | Adopt option C? | Yes. The record is redesigned around provider keys (§3). |
| Q2 | Withdraw unattested transfer-in from 3sln-format files (reverses user decision Q4 of 2026-10-22)? | Yes |
| Q3 | Replace rotation at transfer-in and retired-key honouring (P11) with a fresh destination key? | Yes. The fresh key is no longer named in the record (§3.1). |
| Q4 | Keep the 7-day no-recovery gap after every reissue, including scheduled ones? | Yes |
| Q5 | Annual reissue as a reminder only; the old file never expires or is cancelled before acknowledgement? | Yes |
| Q6 | Re-upload as the acknowledgement, with an in-memory fallback? | Yes, **modified**: the re-upload is checked by hash without decryption (§4.3). |
| Q7 | Optional printed recovery code slot? | Yes, phase 1b |
| Q8 | Server-assisted (OPRF) answer hardening? | Deferred |
| Q9 | Keep the transfer-out engine dormant behind its flag? | Yes |
| Q10 | Drop legacy v1 and v2 file recognition? | Yes |
| Q11 | Remove the unused identity encryption key? | Yes |
| Q12 | Tell apps about a move only on next contact? | Yes |
| Q13 | Keep 90 days of free redirects and the US$10 ten-year extension? | Yes |
| Q14 | Apps pin at account link, so lapsed-domain annotations fail closed? | Yes, **adapted** by §3.3: apps pin the issuer's transfer keys instead of the per-user identity-key thumbprint. Provisional until Q16 is confirmed. |

### 6.5 New open questions (each with a recommended answer)

| ID | Question | Recommended answer |
| --- | --- | --- |
| Q15 | Make the destination's acceptance countersignature mandatory (R3), rather than the source record with a fingerprint alone (R2)? | **Yes.** No single provider can then publish a move, and it proves the destination holds the key named by `dest_key`. Cost: one signature, about 1 KiB. |
| Q16 | Keep a reduced P16: transfer keys with continuity signatures, pinned per issuer by verifiers and by apps at link? | **Yes.** Without continuity, the buyer of a lapsed domain can list a fresh key next to copied public keys. Per-issuer pins cost one fetch per issuer. |
| Q17 | Freeze the account at commit and migrate a snapshot, with no delta sync? | **Yes.** The source already stops serving the identity at commit, and late inbound traffic follows the redirects. |
| Q18 | Migration window equal to the free 90-day redirect window, source keeping data until `complete` + 7 days or the window's end? | **Yes.** It never extends past `redirect_until`. The source extends it by its own outages. |
| Q19 | Define the migration channel in Bindle (portability revision 4, generic kinds plus URL-named provider kinds), rather than as a 3sln.me-only format? | **Yes, minimal.** Generic kinds for fragments, resources, lists, activity, emails and suggestions. `migration_endpoint` optional; a source without it offers export only. |
| Q20 | Keep the encrypted file's hash both in the setup page's memory and on the server (`envelopeDigest`)? | **Yes.** The server copy enables confirmation after a reload or on another device, and the check-up. It is not a recovery credential. |
| Q21 | Keep the in-memory answers round trip at setup alongside the hash check? | **Yes.** The hash check proves the file exists, not that the user remembers the answers. |
| Q22 | Refuse an outward move while an inbound migration is incomplete, unless the user overrides after a warning? | **Yes.** |
| Q23 | Migrate email addresses as unverified, requiring re-verification before verified or sign-in status? | **Yes.** Verification is a provider's own trust and never transfers. |
| Q24 | Require a source throughput floor sufficient to move its largest plan's quota within 30 days? | **Yes**, published in the manifest's `limits`. |
| Q25 | Park records of unsupported contracts at the destination (inert, up to 10 MiB per account) rather than drop them? | **Yes.** Beyond the cap, skip and list them; the owner export covers the rest. |
| Q26 | Must the source keep its owner export available until it deletes the moved account's data? | **Yes** as 3sln.me policy, and SHOULD in the spec. It is the fallback for every migration failure. |
| Q27 | Implement file proof as a single-use HMAC challenge under a server-sealed `proofKey` derived from the token, computed in the isolated document, so that the token never reaches the console page? | **Yes.** It starts nothing, changes nothing on the file, and leaks only a single-use MAC if the page is compromised. |
| Q28 | Restate the cooling-off rules without passwords: voluntary reissue by an aged passkey only (email-only accounts must add a passkey first), the former password branch renamed the ordinary branch and the "file-proof" branch renamed file-locked, with the previous file keeping its cancel right only after an ordinary reissue? | **Yes.** It keeps the 2026-10-23 wargame protections and matches the sign-in spike's SI-13. |
| Q29 | Present the current recovery credential for a transfer (portability §6.1 item 2) by file proof rather than by sending the token? | **Yes.** Same mechanism and the same 7-day age rule; the token stays on the device. |
| Q30 | Make reissue, transfer authorization and Tier B sign-in method removal mutually exclusive per account? | **Yes.** Each changes who can act for the account; serializing them avoids a removal racing a reissue or move. |
