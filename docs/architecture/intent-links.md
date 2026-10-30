# Intent links: app-agnostic links routed by the viewer's provider (design)

Status: **provisional design, 2026-10-22, revision 3.** Revision 3 records the coordinator's answers to the open questions, which the user delegated ("go with what makes sense"). Each is **Provisional (coordinator), not signed off by the user**; implementation proceeds on them, and they stay revisable. They are: the fragment form is required for capability kinds (Q1, §3.3); "always" means no interstitial (Q2, §6.2); no signed intents in v1 (Q3, §3.4, §6.6); the handle-entry landing rewritten with its anti-phishing rules (§6.1); and organization-installed handlers offered only in member context (§6.7). Revision 2 (Review round 1 appended and applied to the text). INT-1–INT-7 and INT-9 are implemented locally behind default-off flags, including the codec, handler declarations, router, `/i` GET/HEAD/POST, chooser and settings UI. INT-8 signed intents remains deferred; publication, OS/PWA protocol installation and production behavior remain unverified. Normative draft: [spec/intents.md](../spec/extensions/intents.md). Companion: [identity portability](identity-portability.md). Review round 1 (adversarial security and UX, 2026-10-22) is at the end; it is a review, not a sign-off. Every decision below is unsigned until it has a reviewer, a date and an outcome; the coordinator records them in DEVLOG.md.

Sign-off: reviewer ___ / date ___ / outcome ___.

## 0. Decisions in one screen

| ID | Decision | Where |
| --- | --- | --- |
| I1 | An intent is `{bintent:1, kind:<pinned artefact reference>, data}`, carried as `bintent=<base64url JSON>` on any HTTPS URL, or as a JWS when signed. It names no app. | spec §3 |
| I2 | Intent kinds are versioned, hash-pinned public artefacts of a new kind `intent`, with a declarative data schema, a disclosure, an `effect` and growth rules. | spec §4 |
| I3 | Apps declare `intents: [{kind, version, digest, route}]` in their integration manifest. A declaration grants nothing and needs no owner review; first use always asks the viewer. | spec §5 |
| I4 | The viewer's own provider routes: first use asks "just this once" or "always", showing the kind, the effect, the data this link carries and the handler's verified origin. Defaults can be changed at any time; exclusions and ignored kinds behave like incremental-authorization suppressions. | spec §7 |
| I5 | Data moves between hosts by form POST and reaches the handler in the URL fragment. The handler must confirm every action itself. | spec §6, §8 |
| I6 | Unsigned links are the norm and are always shown as from an unknown sender. Signed links use a provider-held **certification key**, never the identity key that recovery files contain. | spec §3.2–§3.3 |
| I7 | The two `web+bindle` contact intents and `bindle_intent` become the registered kinds `send-message` and `add-contact`. `intents.v1` is deprecated. | spec §11 |
| I8 | 3sln.me: `/i` is both its intent endpoint and a generic link host; its console contact flows become built-in handlers; the chooser, consent and settings follow the consent experience's risk tiers. | §6 |
| I9 | Capability kinds (contact links) MUST use the fragment form. *Provisional (coordinator), not signed off by the user*. | spec §3.4, §9.3 |
| I10 | "Always" means no provider page on a viewer-activated open; the handler still confirms. Signed intents are not in v1. *Provisional (coordinator), not signed off by the user*. | §6.2, §6.6 |
| I11 | A viewer not signed in at 3sln.me is asked where their account is (a handle only), sees the destination domain before anything is sent, and capability kinds are never forwarded without the disclosure. *Provisional (coordinator), not signed off by the user*. | §6.1, spec §10 |
| I12 | Apps an organization installed are offered to a member only when the member has chosen to act as that organization, never in their personal list. *Provisional (coordinator), not signed off by the user*. | §6.7, spec §6 |

## 1. The user's words

"For things like contact links to work when the actual messaging app (minter) is a third party, we need to offer a way for apps to mint stable app agnostic intent links; which tell us within their query params under 'bintent=<base64-encoded-json-data>' what kind of thing it wants to do, which helps the provider route it to the correct app, which should probably declare its intent handling route in its manifest, including what kinds of intents it can handle, etc; when multiple apps can handle the same intent, the user needs to choose. The first time an intent comes in that an app can handle, the user must agree to let it handle the intent, either once, or in the future as well. This UI must describe the intent, the type of data that might be shared in the link, etc. Intent keys should probably be their own public artefacts like preferences fragments, etc; so the system is extensible; the artefact can describe the purpose of the intent, the schema of its data, etc; so the UI can tell the user about it clearly. It all needs spec/design work. Be careful about which parts go into the bindle spec and which parts are 3sln.me/provider choices/details."

## 2. What exists, and what changes

| Today | Problem | Under this design |
| --- | --- | --- |
| Contact links live on the provider origin and resolve server-side to the current occupant of the `messaging-ingress` slot ([messaging app §6](messaging-app.md#6-contact-links-core-envelope-app-type)). | Solves the **recipient** side: a contact link survives the recipient's app switch. It says nothing about which app the **viewer** uses to act on it. | Unchanged. Slots stay the server-to-server mechanism; intents are the browser-side handoff for the viewer ([messaging app §13](messaging-app.md#13-email-bridge-handoff-shared-slice-x12) already draws this line). |
| `web+bindle://send-message?contact-url=…` and `web+bindle://add-contact?contact-url=…` (links §6.4, withdrawn; in git history: `git show bbbbdad:docs/spec/superseded/links.md`) | A closed list of two intents, hard-coded into the spec. Platform handler registration only. | Two registered kinds among many; the scheme form `web+bindle://intent?bintent=…` carries any kind. |
| `intents.v1` with `bindle_intent` on the provider's `login_endpoint` (GET query) | The capability lands in the provider's query logs. The provider acts itself, through its console. | `intent-links.v1` with a form-POST `endpoint`; the provider routes to a handler the viewer chose, or to its own built-in handler. |
| `/console#contact=<link>&intent=…` on 3sln.me's contact page | 3sln.me-only. | The contact page hands off through `/i`, with the same fragment discipline. |
| Parlay-minted links (none yet) | A link to `parley.example/c/…` dies when the viewer, or the minter, uses another app. | Parlay mints `open-conversation` intent links on the user's provider. |

## 3. The link

### 3.1 Example

Alice's Parlay mints a link to a conversation, hosted on her provider's intent endpoint. The decoded intent (368 bytes):

```json
{"bintent":1,
 "kind":{"artefact":"https://spec.bindle.example/intents/open-conversation/v1","version":1,
         "digest":"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"},
 "data":{"conversation":"0b6f3c1e-5d2a-4f7b-9a41-2c8e6d1f0a93",
         "creator":{"iss":"https://3sln.example","sub":"7d0c2b8e-1f4a-4c6d-8e2b-5a9f3c1d7e60"},
         "profile":"https://spec.bindle.example/messaging/v1"}}
```

The link (the digest is a placeholder):

```
https://3sln.example/i?bintent=eyJiaW50ZW50IjoxLCJraW5kIjp7ImFydGVmYWN0IjoiaHR0cHM6Ly9zcGVjLmJpbmRsZS5leGFtcGxlL2ludGVudHMvb3Blbi1jb252ZXJzYXRpb24vdjEiLCJ2ZXJzaW9uIjoxLCJkaWdlc3QiOiJzaGEyNTYtQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQSJ9LCJkYXRhIjp7ImNvbnZlcnNhdGlvbiI6IjBiNmYzYzFlLTVkMmEtNGY3Yi05YTQxLTJjOGU2ZDFmMGE5MyIsImNyZWF0b3IiOnsiaXNzIjoiaHR0cHM6Ly8zc2xuLmV4YW1wbGUiLCJzdWIiOiI3ZDBjMmI4ZS0xZjRhLTRjNmQtOGUyYi01YTlmM2MxZDdlNjAifSwicHJvZmlsZSI6Imh0dHBzOi8vc3BlYy5iaW5kbGUuZXhhbXBsZS9iaW5kbGVib3gvdjEifX0
```

A contact intent carries a whole contact link in `data.contact` and is a **capability intent**, so it is minted in the fragment form: `https://3sln.example/i#bintent=…`.

### 3.2 Why this shape

- **Base64url JSON** (the user's choice) keeps the URL copy-paste safe and the JSON readable to tooling. The JSON text is the artefacts §3 canonical form (JCS, plain integers) and the base64url is canonical, so one unsigned intent has exactly one encoding (R1-M3).
- **A pinned kind reference** (URL, version, digest) means a link minted today shows the same purpose and disclosure in ten years, whatever the publisher does to the URL. Additive later versions are handled by projection (spec §5).
- **No app, no route, no return URL.** That is what makes the link app-agnostic and removes the open-redirect surface.
- **No minter in unsigned links.** An unsigned "from Parlay" or "from Alice" would be a phishing primitive. Attribution exists only when signed.
- **Size budget.** A typical maximal contact link is about 4,190 characters (a 4,096-character `bindle_meta` plus origin and path). The `contact-link` field admits 4,352 characters; as an unsigned intent that is 4,535 bytes of JSON and 6,047 base64url characters, and signed about 6,420 characters with a short `kid`. Hence the 4,480-byte `data`, 4,608-byte object (5,120-byte signed payload), 6,400-character unsigned and 7,168-character signed value, and 8,192-character URL bounds (spec §3.5). Links §2 permits longer contact links (and legacy `sig` links up to 18,000 characters); those cannot ride in an intent, and the legacy bridge keeps them on the built-in path (R1-M2).

### 3.3 Query or fragment

The user asked for a query parameter, which stays the canonical placement: it survives every chat app and lets the link host render a preview card. The cost is that the link host's server and logs see the data, and so can a `Referer`. The design contains that cost:

- the handoff from the link host to the viewer's provider is a **form POST**, so the viewer's provider never logs the data;
- the handoff from the provider to the handler is a **fragment**, so the handler's server never sees it;
- **capability intents** (contact links) MUST be in the fragment form, so no server sees them at all (*Provisional (coordinator), not signed off by the user*, Q1; spec §3.4). A query-form capability intent is malformed. The cost is a generic preview card, which capability kinds already get.

### 3.4 Signed links

Signing is optional and adds only attribution: "this link was made by `alice@3sln.example`". The signature uses a **certification key**, never the identity signing key, because every recovery file (including a former organization owner's old copy) contains the signing key ([organizations R4-H1, R4-L2](organizations-design.md#review-round-4)). A failed signature removes attribution instead of failing the link, because stripping a signature is free anyway. 3sln.me signs only through a links-contract method (`signIntent`, §6.6), never on raw caller bytes. **Not in v1** (*Provisional (coordinator), not signed off by the user*, Q3): the first release ships unsigned links only, and treats any signed intent as unsigned (no attribution). Signing follows once certification keys exist for persons (organizations phase A).

## 4. Intent kinds

Kinds are a new artefact kind with the envelope, digests, retraction and mirrors of [artefacts](../spec/artefacts.md) unchanged, and their own growth table (spec §4.4). The design follows fragments: the publisher describes, the provider renders, and the app never writes consent text.

- `effect` is the ceiling of what a handler may do after the viewer confirms. It feeds the risk tier (§6.3).
- The `disclosure` names a category set and, per data member, how much the provider may show. That gives the "type of data that might be shared" the user asked for, without letting a minter put persuasive free text on the consent page.
- `capability: true` switches on URL secrecy everywhere (spec §9.3).
- Growth: new optional data members (each with its disclosure), new translations, and appends to enums declared extensible. A new member with a new category re-asks viewers who chose "always" (spec §7.2).

### Registered kinds

> **Superseded (2026-10-28, provisional).** Intents registers no kinds ([intents §11](../spec/extensions/intents.md#11-registered-kinds-none)); Bindle Messaging publishes `connect`, `open-conversation`, `send-message` and `add-contact` ([messaging §4.6](../spec/extensions/messaging.md#46-published-intent-kinds)), and the `contact-link` format is replaced by `capability` ([contacts and links rethink](contacts-and-links-rethink.md) CL-11, CL-12, CR-C10). The bodies below are historical.

Draft bodies (version 1). Each is wrapped in an artefact envelope at its line URL when published.

```json
{"id":"https://spec.bindle.example/intents/send-message/v1",
 "title":{"en":"Message a contact"},
 "summary":{"en":"Opens a new message to this contact in the app you choose. Nothing is sent until you send it."},
 "publisher":"https://spec.bindle.example","effect":"send","capability":true,
 "data":{"type":"object","properties":{"contact":{"type":"string","maxLength":4352,"format":"contact-link"}},"required":["contact"]},
 "disclosure":{"categories":["send-as-you"],
   "fields":{"contact":{"title":{"en":"Contact link"},"categories":[],"display":"origin"}}}}
```

```json
{"id":"https://spec.bindle.example/intents/add-contact/v1",
 "title":{"en":"Save a contact"},
 "summary":{"en":"Saves this contact link to your contacts in the app you choose."},
 "publisher":"https://spec.bindle.example","effect":"save","capability":true,
 "data":{"type":"object","properties":{"contact":{"type":"string","maxLength":4352,"format":"contact-link"}},"required":["contact"]},
 "disclosure":{"categories":["personal-data"],
   "fields":{"contact":{"title":{"en":"Contact link"},"categories":["personal-data"],"display":"origin"}}}}
```

```json
{"id":"https://spec.bindle.example/intents/open-conversation/v1",
 "title":{"en":"Open a conversation"},
 "summary":{"en":"Opens this conversation in the messaging app you choose, if you are one of its participants."},
 "publisher":"https://spec.bindle.example","effect":"view","capability":false,
 "data":{"type":"object","properties":{
   "conversation":{"type":"string","maxLength":36,"format":"uuid"},
   "creator":{"type":"principal"},
   "profile":{"type":"string","maxLength":256,"format":"https-url"}},
   "required":["conversation","creator","profile"]},
 "disclosure":{"categories":["personal-data"],
   "fields":{"conversation":{"title":{"en":"Conversation"},"categories":["personal-data"],"display":"presence"},
             "creator":{"title":{"en":"Started by"},"categories":["personal-data"],"display":"value"},
             "profile":{"title":{"en":"Messaging standard"},"categories":[],"display":"origin"}}}}
```

`open-conversation` admits nobody to anything. The handler shows the conversation only if the viewer is already a participant under [Parlay §6](../spec/extensions/messaging.md#6-conversations). The `creator` is shown as an unverified claim ("Started by alice@3sln.example, according to the link") until the handler resolves it.

## 5. Handler declarations

Parlay's client metadata gains:

```json
"bindle_integration": {"v": 1,
  "intents": [
    {"kind": "https://spec.bindle.example/intents/send-message/v1", "version": 1, "digest": "sha256-…", "route": "https://parley.example/bindle/intent"},
    {"kind": "https://spec.bindle.example/intents/add-contact/v1", "version": 1, "digest": "sha256-…", "route": "https://parley.example/bindle/intent"},
    {"kind": "https://spec.bindle.example/intents/open-conversation/v1", "version": 1, "digest": "sha256-…", "route": "https://parley.example/bindle/intent"}]}
```

How verified a declaration is: the route is on the client's verified origin and path prefix, so the provider knows *where* data goes. It does not know whether the app handles the kind well. The consent page therefore names the origin, and shows a name or a "reviewed" mark only from the provider's own review. Declarations are adopted at refetch without owner review because they grant nothing. The protection is first-use consent, not manifest review.

Candidates are connected apps plus built-ins. Discovering an unconnected app that can handle a kind (for example "Get an app that can open conversations") is a 3sln.me catalogue feature for later, and connecting one is an ordinary authorization.

## 6. 3sln.me routing, chooser and consent (provider choices)

### 6.1 Endpoint and link host

- `https://3sln.me/i` serves `GET ?bintent=`, `GET #bintent=` (read by the page script) and the form `POST`. It is declared as `intent-links.v1.endpoint`.
- The same path is 3sln.me's **generic link host**. Apps minting links for 3sln.me users use `<endpoint>?bintent=…` (or `#bintent=`, required for capability kinds). The path carries no account identifier, so links keep working when the minter moves away (§8.3).

**Signed in at 3sln.me: the viewer's own apps.** This is the main case and the one the user asked for. The viewer opens the link and sees the list of **their own connected apps that handle this kind**, with "Just once" and "Always" (§6.2, §6.3). No handle is asked for and nothing leaves 3sln.me except the handoff to the app they pick. With a default, a viewer-activated open goes straight to that app (§6.2).

**Not signed in at 3sln.me: "Where's your account?"** (*Provisional (coordinator), not signed off by the user*, revision 3.) A link minted on 3sln.me can reach someone whose account is at another provider, or who has no account. 3sln.me cannot know which, so `/i` shows a landing page that asks:

> **Where's your account?** Enter your handle, like `you@example.org`. We'll send this link to your provider so it can offer your apps.

with two other ways on: **"Sign in or sign up with 3sln.me"** (returns to the same intent after sign-in, carrying it in session storage, never in a query) and **"Open with an installed Bindle app"** (a `web+bindle://intent?bintent=…` anchor).

What happens with a handle:

1. 3sln.me discovers the handle's provider ([protocol §2](../spec/protocol.md#2-discovery-and-login)). If it declares `intent-links.v1`, the page shows the destination; otherwise it says the provider can't open these links, and sends nothing.
2. **The destination domain is shown prominently before anything is sent**: "This link will be sent to **alt.example**", with the registrable domain highlighted, the A-label form for confusable or mixed-script names (spec §7.1), and a "Not your provider?" control that returns to the handle field.
3. Only after the viewer clicks **Send to alt.example** does the page form-POST the value, top-level, to that provider's endpoint. It never auto-submits, which also gives the provider the user-activated navigation an "always" default needs (spec §7.3, R1-H5).

**Why this needs care (the phishing concern).** "Type your handle, then get sent to your provider" is a pattern phishers can copy: a fake page asks for a handle and forwards the viewer to a look-alike "provider" that then asks for a password. And a mistyped or malicious handle domain receives the link's data. The mitigations:

- **Only a handle, ever.** The landing collects the handle and nothing else: no password, passkey, code or email. Its copy says so ("3sln.me never asks for your password here"). Sign-in happens only on the provider's own origin, after the navigation, where the browser shows that origin.
- **The destination is shown before sending** (step 2), as the domain the viewer will see in the address bar.
- **The choice is remembered** in this browser's local storage only. Next time the page offers a single **Continue with alt.example** control beside "Different provider", so a returning viewer is not trained to type a handle on every link, and a page that suddenly asks again stands out.
- **Capability kinds are never forwarded without the disclosure.** For a capability kind (a contact link) the step-2 screen adds that the link contains a contact capability that alt.example will receive, and the send control is armed after the consent experience's delay. This applies to a remembered provider too: "Continue with alt.example" for a capability kind shows the same line before it submits.
- Discovery failures never redirect, and nothing is sent to a provider the viewer has not chosen on this browser (spec §10).

The residual: a viewer who types a look-alike handle and then ignores the destination shown sends the link's data to that host. For unsigned, non-capability kinds that data is what the link already showed; for capability kinds the extra disclosure is the guard.

- The landing shows the kind's title (after verifying the kind reference), quoted and attributed to the line URL's host unless 3sln.me reviewed the kind, and the link host, never data or a minter. Preview cards (Open Graph, oEmbed `link`) show a kind title only for reviewed kinds resolved from the store, and otherwise a generic card; capability kinds always get the generic card (R1-H2).

### 6.2 Processing for a signed-in viewer

Engine-first: `ReceiveIntent` (steps 1–2 of spec §6, pure, stateless and fetch-free) runs before authentication; `ResolveIntent` (steps 4–6, after the account is chosen, with per-account fetch budgets) produces an `IntentView`. A Query computes candidates for the chosen account. The page renders one of:

- **no handler**: "None of your apps can do this yet", with a link to the catalogue (later) and the kind's summary;
- **ignored kind**: a neutral page with **Undo**;
- **valid default and no widening**: direct handoff, with no 3sln.me page, whenever the delivering navigation was user-activated or came from outside the browser (spec §7.3 fetch-metadata rule). "Always" means no interstitial (*Provisional (coordinator), not signed off by the user*, Q2); the handler still confirms any action (spec §8). The one-control "Continue to Parlay" interstitial remains only as the spec §7.3 anti-bounce guard, for navigations the viewer did not activate (a script-submitted cross-site POST, no fetch metadata, framed or prefetch) and past the direct-handoff rate limit;
- otherwise the **chooser and consent** page.

### 6.3 The chooser and consent page

Built with the 3sln stack, using the [consent experience](consent-experience.md) components: its persistent header, risk tiers, arming delay and progressive disclosure.

- **Header:** "A link wants to: *Open a conversation*" — the kind title, with "described by `spec.bindle.example`" (the line URL's host, never the body's `publisher`) and a reviewed mark only for kinds 3sln.me reviewed (initially the three registered kinds). An unreviewed kind's heading is provider text ("A link of a type 3sln.me hasn't checked") with the publisher's title quoted below it; a kind published by a candidate handler's own site reads "described by Parlay's own site" and is raised one tier (R1-H2).
- **Sender:** "From: unknown sender" (unsigned) or "Made by `alice@3sln.example`" (signed and verified). A failed signature adds "This link's signature couldn't be checked."
- **Risk chip** from `effect`, raised by categories, using the existing tiers: `view` low, `save` and `join` medium, `send` high; `money`, `identity` and `send-as-you` raise one tier, as in the consent experience.
- **"This link includes"**: one row per present field, under its `display` rule ("Contact link from `3sln.example`", "Started by someone at `3sln.example` (according to the link)" — a handle only when 3sln.me already holds a verified binding, never by fetching — and "Conversation: included"). Hosts use the A-label form when mixed-script or confusable.
- **Handler list:** radio rows with the app name (reviewed) or the verified origin as primary label (unreviewed), plus "Parlay will receive the details above." Nothing is preselected without a default, and the order is 3sln.me's (reviewed first, then recently used), never a manifest's claim.
- **Account:** with several signed-in accounts, the chosen account is named on the page; organizations never appear as the viewer (spec §6). An "Acting as" control appears only for a member of an organization with installed handlers for this kind, and switching it replaces the handler list (§6.7).
- **Actions:** primary **Just once**, secondary **Always use Parlay for links like this**. Both are armed after the consent experience's standard delay, so a click-through from a hostile page cannot land on them.
- **Overflow:** "Don't offer Parlay for these links" (handler exclusion), and "Ignore links like this" (ignored kind).

The built-in console handler (until a messaging app occupies the messaging slot) gets the same page. When it is the only candidate, its own send-message or add-contact prompt shows the same rows and the once/always choice, so the viewer sees one screen, not two.

### 6.4 Settings: "Links and apps"

Under account settings: one row per kind line the viewer has met, with the default handler (changeable or removable), excluded handlers and the ignored state, each with date and undo. These records are exported with the account and deleted with it. Removing a record never replays an intent.

### 6.5 Handlers 3sln.me ships

- **Built-in:** `send-message` and `add-contact` (the console contact flows), declared in a provider-authored manifest.
- **Parlay** (an ordinary app, organizations design §1c): `send-message`, `add-contact`, `open-conversation`, through its own manifest, with no special treatment.

### 6.6 Minting API

- **Unsigned:** an SDK helper `intentLink({endpoint, kind, data, placement})` that validates against the pinned kind and encodes canonically. No provider call is needed.
- **Signed:** a links-contract method `signIntent({kind, data, exp?})` on the provider-hosted links resource, granted by fragment like `links.issue`. The provider validates data against the kind, rate-limits per app and user, and signs with the minter's certification key. Behind `SIGNED_INTENTS_ENABLED`, which stays off in v1 (*Provisional (coordinator), not signed off by the user*, Q3).

### 6.7 Organization-installed handlers

*Provisional (coordinator), not signed off by the user*; implementation proceeds on it, and it stays revisable. Answers R1-M7's open item.

- The viewer is always a person (spec §6). By default the candidates are the person's own built-ins and connected apps.
- Apps an organization installed are offered to a member **only in member context**: when the member has chosen, on the chooser, to act as that organization ("Acting as: Personal ▾ / Acme Ltd"). Then the list shows only Acme's installed apps that handle the kind and that the member's grants let them use. They are never mixed into the personal list, so a link cannot quietly route personal data into an organization's app, or the reverse.
- The chooser names the acting entity, and the handler's own confirmation names it again (spec §8 item 4). The app acts for the organization only through member context ([organizations §7](../spec/extensions/organizations.md#7-member-context-for-applications)).
- Defaults are per (person, acting entity). A personal "always" never applies in an organization's context, or the reverse. Organization-level defaults set by admins are not in v1.
- Organization context for intents arrives with the entity switcher (organizations phase B); until then only personal candidates are offered.

## 7. Contact links and app-minted links

### 7.1 Contact links, end to end

1. Alice's Parlay issues a contact link through `links.issue` on her provider (unchanged).
2. Alice shares either the contact link itself (its page offers "Message" and "Save" as intents) or an intent link `…/i#bintent=<send-message, contact>`.
3. Bob, on `alt.example`, opens it. The landing hands off to `alt.example`'s endpoint by form POST.
4. `alt.example` asks Bob the first time: "Message a contact · from unknown sender · Contact link from `3sln.example` · open with Courier (`courier.example`)". Bob chooses **Always**.
5. Courier opens with the fragment, strips it, verifies the contact link with `3sln.example` (links §8), and composes. Nothing is sent until Bob sends; delivery carries Bob's author proof (links §6.1).

Neither Parlay nor Courier appears in the link. Alice can switch to another messaging app, and Bob to another handler, and the link keeps working.

### 7.2 Migration from today's contact links

| Step | Change |
| --- | --- |
| M1 | 3sln.me declares `intent-links.v1` alongside `intents.v1`. `bindle_intent` arriving at `/console` is converted to the equivalent kind and goes through `/i` (with first-use consent). |
| M2 | The contact page's buttons hand off through `/i#bintent=…` instead of `/console#contact=…&intent=…`. The "Sign in or sign up" option prefers `intent-links.v1` at the viewer's provider and falls back to `intents.v1`. |
| M3 | The hidden legacy anchors stay; `web+bindle://intent?bintent=` anchors are added; the PWA protocol handler moves to `/i#%s`, if the browsers we support accept a fragment template (to verify; otherwise `/i?%s` with query redaction). The substituted text is percent-decoded exactly once (spec §3.4). Installed PWAs keep the old `/console?intent=%s` registration until their manifest refreshes, so `/console?intent=`, `/console?bindle_intent=` and `/console#contact=…&intent=…` stay accepted and are bridged through `/i` with first-use consent (R1-M9). |
| M4 | When no known link host depends on `intents.v1`, it is removed from the manifest. The `/console` bridges of M3 stay until a separately decided date. |
| M5 | Foreign contact links, which today's `parseIntent` drops (`{foreign:true}`), now reach the built-in handler through `/i`. Until cross-host authors verify, the built-in send-message handler says it cannot message that provider yet and offers the other candidates; add-contact may save the link. Legacy contact links above the `contact-link` bound stay on the built-in `intents.v1` path (spec §11). |

Existing contact links are unchanged: they are links, not intents, and keep `bindle_meta` or `sig`.

### 7.3 Stability across provider moves

- The intent link on `/i` carries no account, so it works for as long as 3sln.me serves `/i`, whoever minted it and wherever they moved.
- Data that points at the moved identity (a contact link on `/users/<handle>/contact/…`) follows the redirect for the redirect period, and keeps working at the destination if it imported the link's records ([identity portability §5](identity-portability.md#5-redirects-what-3slnme-redirects)).
- After the redirect lapses, old contact links die (they are capabilities tied to the old host), so apps should re-mint after a move. Parlay shows "Your contact link moved, share the new one" when the user's issuer changes.
- If a link host disappears entirely, any Bindle-aware software can still lift the `bintent` value out of the URL and send it to the viewer's provider (spec §10, tooling).

## 8. Threat model

| # | Threat | Mitigation | Residual |
| --- | --- | --- | --- |
| T1 | **Open redirect** through an intent | No navigation target ever comes from intent content: only discovered endpoints, pinned handler routes, and the kind's own line URL (spec §9.1) | — |
| T2 | **Phishing** through kind text or minter claims | Frozen publisher text attributed to its host; reviewed marks only from provider review; no minter on unsigned links; display rules keep free text off the page; bidi stripping | A convincing kind published by an attacker, shown as "described by `evil.example`" |
| T3 | **Data leakage** through logs and `Referer` | Form POST between hosts; fragment to handlers; capability kinds in fragment form; redaction; `no-referrer`; `no-store` | Query-form links are visible to the link host's server and to anyone the link is shared with, as any URL is |
| T4 | **CSRF and auto-execution** | GET and cross-site POST only render; decisions are same-origin CSRF-protected POSTs from `frame-ancestors 'none'` pages with armed buttons; handlers must confirm every action (spec §8) | A handler that ignores its obligation: its own bug, contained by disconnecting it |
| T5 | **Malicious handler registration** | Only connected apps are candidates; first-use consent per kind; exclusion and disconnection; the route is pinned to the verified origin | A viewer who connects a malicious app and then chooses "always" |
| T6 | **Hostile minter** flooding or crafting links | Strict bounds before work, schema validation, fetch budgets for kind and minter resolution, no state before consent | Annoyance links a viewer must still open |
| T7 | **Replay** | Intents are reusable requests by design; capabilities inside keep their own quotas and expiry; signed links may carry `exp` | — |
| T8 | **Kind publisher compromise** | Pinned digests; additive-only growth; retraction refuses new handling but never silently reroutes | A retraction can stop a kind from working everywhere (artefacts §9.2 residual) |
| T9 | **Default hijack** by a newly connected app | New apps never replace defaults; manifest changes cannot add authority | — |
| T10 | **Exclusion probing** by a handler or minter | Nothing is reported to minters; handlers cannot distinguish exclusion from non-choice | — |
| T11 | **Provider-choice tampering** and handle-entry phishing on a link host | The remembered provider lives only in the viewer's browser; first use always needs an explicit handle entry; the destination domain is shown before sending; only a handle is ever collected; capability kinds always get the disclosure; discovery failures never redirect (§6.1) | A compromised link host page, which could send the viewer anywhere, as any compromised page can |
| T12 | **Version confusion** (a handler receiving members it does not understand) | Projection to the handler's declared version after verified additivity, unsigned (spec §5) | Loss of attribution on projected links |

## 9. Spec versus 3sln.me

| Normative (spec) | 3sln.me (provider choice) |
| --- | --- |
| `bintent` format, encodings, placements, bounds | The `/i` path, the landing page and preview cards |
| `intent` artefact kind, data schema, disclosure, growth | Which kinds are reviewed, and their reviewed copy |
| `intents` handler declarations and versions | Catalogue of unconnected handlers (later) |
| Processing order, no-action rules, consent minima (first use, once or always, required disclosures, widening, exclusions, unobservability) | Chooser layout, risk-tier mapping, arming delay, merged built-in screen, settings page, remembered provider |
| Handoff by fragment; handler obligations | SDK helper; `signIntent` method and its rate limits |
| `intent-links.v1`; deprecation of `intents.v1` | Migration steps M1–M4 |

## 10. Slices, flags and tests

### 10.1 Slices (non-overlapping write ownership)

| Slice | Scope | Files owned | Depends on |
| --- | --- | --- | --- |
| INT-1 | Codec and validation: parsing, encodings, bounds, data schema, display rules, projection | `packages/intents/{format,schema,project}.mjs`, `tests/intents-format.test.mjs`, `docs/architecture/artefacts/intents.vectors.json` | ART-1 (`packages/core/artefacts.mjs`) |
| INT-2 | The `intent` kind's growth table in the artefact validator, and the three registered kind documents | The `intent` row in `packages/core/artefacts.mjs` (with the artefacts owner's agreement), `docs/artefacts/intents/*.json` | INT-1 |
| INT-3 | Handler declarations: validation and snapshot handling | `packages/intents/declarations.mjs`, plus a one-call hook in `packages/federation/integrations.mjs` (owned by the federation owner) | INT-1 |
| INT-4 | Router engine: `ReceiveIntent`, `Candidates`, `RecordDecision`, `SetDefault`, `ExcludeHandler`, `IgnoreKind`, `RemoveIntentRecord`; consent memory with widening; default clearing on disconnect or undeclare | `packages/intents/router.mjs`, `tests/intents-router*.test.mjs` | INT-1, INT-3 |
| INT-5 | HTTP adapter: `/i` GET and POST, landing, legacy `bindle_intent` bridge, manifest feature | `packages/runtime/routes/intents.mjs`, `tests/intents-routes.test.mjs` | INT-4 |
| INT-6 | UI: landing, chooser and consent, settings | `apps/web/src/bl/intent-*.mjs`, `apps/web/src/ui/intent-*`, DOM and browser tests | INT-5 |
| INT-7 | Contact page migration M2–M3 | `packages/runtime/contact-preview.mjs`, `apps/web/src/bl/contact-link.mjs`, `apps/web/manifest.webmanifest` (links owner) | INT-5 |
| INT-8 | `signIntent` in the links contract (later) | The links-contract module (links owner) | INT-1, ORG certification keys |
| INT-9 | Parlay declarations, route and handler confirmations | Parlay's app files (Parlay owner) | INT-3 |

### 10.1.1 Local slice status (2026-10-23)

INT-1–INT-7 and INT-9 have local implementations and dedicated codec, engine, seeded-chaos, HTTP/Worker and browser suites. INT-8 remains deferred. This is implementation status, not reviewer sign-off or production verification; the decisions and sign-off blanks above remain provisional. All three flags are registered default off. Registered identifiers remain under reserved `.example` domains.

The integration file has one INT-3 hook wrapping declaration validation and safe snapshot adoption. Intent records use the existing account metadata provider and an INT account RPC adapter; a separate provider catalogue entry is unnecessary. Disconnect/undeclare invalidates candidates immediately, and the account adapter reconciles the stored default before every intent operation, including settings reads. Cleanup does not depend on flag targeting. Flow receipts contain a digest and deadlines, never the intent value or data, and are bounded to 64 per account; browser payloads expire after one hour.

Oversized legacy contact links use a migration-only fragment and built-in-only consent path, without becoming a new-format intent or reaching app handlers. The static PWA registration stays legacy; its served manifest switches to `/i#%s` only while the intent flag is globally enabled. Parlay uses the existing `apps/parlay` application. Its handler confirms independently, and the provider built-in refuses foreign-host contact actions until verification is available.

Kind resolution uses the existing operator-configured artefact store and its bounded fetch port, with no ambient network fetch of arbitrary publisher URLs. External publisher discovery, deployed log-redaction verification, actual OS/PWA installation behaviour and production release gates remain unverified. Browser suites exercise protocol substitutions and handler confirmations locally; they do not certify third-party handlers. DEVLOG reconciliation is left to the coordinator because this workstream was instructed not to edit DEVLOG.md. Final local verification: 71 focused codec/engine/flag/boundary checks, 12 intent client-engine checks, 12 contact/transport checks, the 292-test UI-state gate, DOM smoke, asset build and Worker dry run passed. The resumed sandbox refuses loopback listeners (`listen EPERM`), so its full core run finished with 2,695 passes, nine listener failures and a native Node assertion in the export-hooks suite; Worker/browser/e2e reruns are blocked by that environment. Before the sandbox changed, Worker (80 tests), intent browser matrices and the full e2e (214 passes, four skips) passed; those earlier runs do not verify every final resumed edit.

**Wargame fixes, 2026-10-23 (unsigned; Provisional (coordinator), not signed off by the user).** Resolve checks the operator artefact registry (`ARTEFACTS.registered`, a local configuration lookup in both the in-process and remote ports) before any provider-wide store read, pin or fetch, so an unregistered kind URL fails `intent_kind_unavailable` with no shared row and no budget spent (F1). The intent page inserts its ticket and bootstrap with replacer functions (no `$&`, `` $` `` or `$'` expansion) and escapes `'` and `>` (F3); `/i`, `/i/contact` and the legacy `/console` bootstrap send `Cross-Origin-Opener-Policy: same-origin`. A navigation ticket rendered with a POST or query `bintent` carries that value's SHA-256 and activates only a resolve of the same value; fragment and legacy tickets remain unbound because the server never sees the value in the form the page submits. A per-account kind-miss limit was not added: an unregistered kind now costs only the account's own request.

### 10.2 Flags (proposed rows, default off; the flags owner adds them)

| Flag | Class | Notes |
| --- | --- | --- |
| `INTENT_LINKS_ENABLED` | a, stateful (decision records), client | Gates `/i` processing and the `intent-links.v1` declaration. Off: legacy `intents.v1` behaviour. |
| `INTENT_APP_HANDLERS_ENABLED` | a, requires `INTENT_LINKS_ENABLED` and `CLIENT_METADATA_ENABLED` | Off: only built-in handlers are candidates. |
| `SIGNED_INTENTS_ENABLED` | c, requires `INTENT_LINKS_ENABLED` | Signing through `signIntent`, and verification of signed intents. Off: signed intents are processed as unsigned. |

Gates before production: `realBrowserFlowsPassing`, `securityRedTeamFindingsResolved`, `generalPreferenceConsentComplete`, and log redaction of `bintent` verified on the deployed Worker (the same open item as `bindle_intent`).

### 10.3 Tests

**Engine-level** (most tests): every row of spec §13 against the INT-1 codec and the INT-4 engine. Highlights:

- a candidate matrix over {built-in, connected, disconnected, undeclared, excluded, sibling-domain excluded} × {kind version below, equal to and above the handler's};
- first use, once, always, widening, a default kept during re-ask, and clearing on disconnect;
- ignored kinds;
- a query-form capability intent refused; a signed intent processed as unsigned while `SIGNED_INTENTS_ENABLED` is off;
- organization-installed handlers absent from the personal list and present only in that organization's member context; defaults kept per acting entity;
- exclusions identical to non-choice in every handoff observable;
- legacy mapping.

**Seeded chaos:** random sequences of connecting and disconnecting apps, declaring and undeclaring kinds, publishing kind versions (additive, non-additive and retracted), receiving intents (random versions, sizes and mutations), deciding once or always, excluding, ignoring and undoing. Invariants:

- no handoff without a decision in the same flow or a valid default;
- never to a non-candidate or an excluded handler;
- a default is never silently switched to another app;
- no projected intent carries a member above the handler's version;
- ignored kinds never hand off;
- every rejection precedes any fetch except the kind and minter resolution budgets.

**Fuzzing:** byte-level mutation of `bintent` values and JWS segments. No exception escapes, time stays bounded, and the only outcome is `intent_malformed`.

**Browser:** the fragment strip on the handler test page, the landing's handle-only form, destination display before sending, capability disclosure on both the first and the remembered-provider path, form POST and remembered provider, armed buttons, the PWA protocol handler fragment template on each supported browser, and the absence of `bintent` from network logs of the handoff.

## 11. Open questions for the user

Revision 3: all answered as *Provisional (coordinator), not signed off by the user*. Implementation proceeds on them; they stay revisable.

1. **Capability intents in the fragment.** Make the fragment form *required* for kinds that carry a capability (contact links), keeping the query form for everything else? **Recommendation: yes. Adopted provisionally (§3.3, spec §3.4).** It keeps contact capabilities out of every server log, at the cost of no rich preview card for those links, which the design already reduces to a generic card.
2. **"Always" means no page at all.** With a valid default, should 3sln.me hand off directly, with no interstitial? **Recommendation: yes**, as the user's "or in the future as well" implies, since the handler must still confirm any action. **Adopted provisionally (§6.2),** keeping the spec §7.3 anti-bounce interstitial for navigations the viewer did not activate.
3. **Signed intents in the first release?** **Recommendation: no.** Ship unsigned links first (they deliver app-agnostic stability), and add `signIntent` once certification keys exist for persons (organizations phase A). **Adopted provisionally (§3.4, §6.6).**
4. **Handle entry (what it is about, and the phishing risk).** The user asked what this is about. It is the not-signed-in landing at `/i`: "Where's your account?" (§6.1). **Adopted provisionally:** only a handle, the destination shown before sending, the choice remembered, and capability kinds never forwarded without the disclosure.
5. **Organization-installed handlers.** **Adopted provisionally:** offered only in member context, never in the personal list (§6.7).

## 12. Reconciliation notes for DEVLOG (coordinator)

- Record I1–I8 as provisional decisions with empty reviewer, date and outcome. Record I9–I12 (revision 3) as Provisional (coordinator), not signed off by the user, with empty reviewer, date and outcome.
- AMD-I2 changes links §6.4 (links owner); AMD-I3 registers the `intent` kind (artefacts owner); AMD-I4 adds the `intents` manifest member (federation owner); AMD-I5 gives certification keys a second use (organizations author).
- `bindle_intent` log redaction, still pending for production, extends to `bintent`.
- messaging-app.md §6.1 lists the landing page and intents under core. M2 changes the 3sln.me contact page, so the Parlay owner should confirm the split still holds.

## Review round 1

Independent adversarial security and UX review, 2026-10-22, against spec revision 1 and design revision 1. Inputs: artefacts, links, contact-delivery, contact endpoints, integrations, incremental authorization, app removal, identity portability, organizations §3a, extensions §6; the bindle-links, contact-link-previews and consent-experience notes; `packages/links/*`, `apps/web/src/bl/contact-link.mjs`, `apps/web/src/providers/browser.mjs`, `packages/runtime/routes/federation.mjs` and `apps/web/manifest.webmanifest`. This is a review, not a sign-off: every fix below stays provisional until the sign-off lines above are filled. "Fixed" in this historical review means the spec or design text then said it; the current local implementation status is above and in the implementation checkpoint below.

### High

**R1-H1. Self-asserted `publisher` spoofs attribution.** *Scenario:* `evil.example/intents/msg/v1` sets `publisher: "https://spec.bindle.example"`. Revision 1 attributed kind text to "`publisher`'s host", so the consent page read "described by spec.bindle.example" over attacker text. Extensions §6 already closed this for slots. *Fix (spec §4.1, §7.1):* `publisher` must equal the origin of `id`, or the body is invalid; attribution always uses the line URL's host. Fixed.

**R1-H2. Unreviewed kind text speaks with the provider's or link host's voice.** *Scenario:* a kind titled "3sln.me security check: confirm your account to keep it" is linked through `https://3sln.me/i?bintent=…`. Chat unfurlers show the title under site name 3sln.me. The landing and consent headings repeat it on the 3sln.me origin. A handler's own site can also publish a soothing kind ("Opens a preview", `effect: view`) for its own route. *Fix (spec §7.1, §9.2, §10; design §6.1, §6.3):* preview cards show a kind title only for reviewed kinds resolved from the store, and never trigger fetches. Pages quote unreviewed text under a provider-worded heading, after the provider's effect and risk rows. A kind published on a candidate handler's registrable domain reads "described by the app's own site" and is raised one tier (consent experience D3). Fixed.

**R1-H3. A retired certification key and a self-asserted `iat` forge attribution.** *Scenario:* after a rotation, or after Alice moves away from `old.example`, the old provider still holds its certification private key. It signs a new intent with `iat` before the retirement, and revision 1 accepted "`retired` when `iat` precedes its retirement". The result is "Made by alice@old.example" forever. This also contradicted organizations §3a.3 (certificates verify only against `active` keys, and certification keys never cross a move) and identity portability §8.2 (an artifact naming an earlier host fails). *Fix (spec §3.3, §13):* only an `active` key at the minter's current issuer gives attribution. Rotation or a move ends attribution, and the link degrades to unsigned. Fixed.

**R1-H4. The handler route is the real boundary, and revision 1 left it unguarded.** *Scenario:* any page can navigate, open as a popup, or frame `https://parley.example/bindle/intent#bintent=<send-message to attacker>&bintent_iss=https://evil.example`, skipping provider consent entirely. It can then clickjack the compose confirmation, or rely on Parlay's starting sign-in at the hinted `evil.example`, a look-alike provider that harvests credentials. *Fix (spec §8):* provider consent is stated not to be a security boundary for handlers. Handlers treat routed and direct intents identically, send `frame-ancestors 'none'`, arm confirmations after a delay, and name the acting identity. They use `bintent_iss` only to choose among issuers they already have a session with. Fixed. Handler conformance is unverifiable by the provider; the residual is a careless handler, contained by exclusion or disconnection.

**R1-H5. "Always" plus no page enabled drive-by handoffs.** *Scenario:* a hostile page runs `location = "https://3sln.me/i?bintent=…"` (SameSite=Lax cookies ride on top-level GETs), or auto-submits the cross-site POST, or a remembered-provider landing auto-continues. The viewer lands in their default handler with attacker data, repeatedly and without a click: it is a setup for confirmation clickjacking and pure harassment. *Fix (spec §7.3, §10; design §6.1, §6.2):* direct handoff happens only for navigations with `Sec-Fetch-Site: none` or `same-origin`, or `cross-site` with `Sec-Fetch-User: ?1`, and within a per-account rate limit. Otherwise the provider shows a one-control armed interstitial. Link hosts never auto-submit to a remembered provider; a single "Continue with…" click supplies the activation. Q2 remains the user's decision, now with these conditions. Fixed.

### Medium

**R1-M1. Pre-authentication fetches: amplification, store probing and read receipts.** *Scenario:* revision 1 resolved kinds (steps 3–5) before authentication (step 6). Anyone could make the provider fetch arbitrary HTTPS line URLs, and could tell from `intent_kind_unavailable`, timing or success whether the shared store already held a niche kind, which leaks what other users opened. A publisher minting one line URL per recipient gets a read receipt with time and provider. Signed intents leak the same to the minter's provider. *Fix (spec §4.5, §6; design §6.2):* authentication comes first (new step 3). Before it, responses do not depend on the store or on fetches. Fetches are budgeted per account and per origin, the provider SHOULD prefer store or mirrors, and it MAY ask before fetching from a new origin. Fixed. *Residual:* the first fetch of a unique line still signals an open; only a mirror or ask-first policy removes it (3sln.me decision).

**R1-M2. Size bounds did not fit their own claim.** At the 4,352 `contact-link` maximum, a signed intent is a 4,654-byte payload and about 6,414 characters, over the 4,608 and 6,400 bounds. Links §2 allows contact links up to an 8,192-character target, so "one maximal contact link" was false, and legacy `sig` links reach 18,000. *Fix (spec §3.5, §11; design §3.2, M5):* separate signed bounds (5,120-byte payload, 7,168 characters), the exact admitted contact link stated, minters refuse rather than truncate, and over-bound legacy links stay on the built-in `intents.v1` path. Fixed.

**R1-M3. Validation differentials.** The "canonical" claim covered only base64url; whitespace, member order and `\u` escapes gave many encodings of one intent. `1.0` and `1e0` parse as integers in JavaScript but not elsewhere. `maxLength` had no unit, and `https-url`, `uuid` and `handle` had no definitions. Stripping bidi controls (rather than rejecting them) made the displayed text differ between implementations. *Fix (spec §3.1, §3.2, §4.2):* artefacts §3 rules and JCS canonical form apply. Lengths are code points. The formats are defined. Display values with controls are invalid, not stripped. Fixed.

**R1-M4. The capability flag was not derived.** *Scenario:* a kind with a `contact-link` field and `capability: false` escaped URL secrecy (§9.3) and preview rules, and a later version could add such a field. *Fix (spec §4.1, §4.3, §4.4):* a `contact-link` field forces `capability: true`, and such additions to a non-capability line are invalid. Fixed.

**R1-M5. Principal display was a fetch trigger and a credibility boost.** Showing `creator` as "Started by alice@3sln.example" needed a directory lookup at an attacker-chosen `iss` (before consent). The verified-looking handle also lent weight to an unverified claim ("Started by support@bank.example"). *Fix (spec §4.3; design §6.3):* show the `iss` host, plus a handle only from an existing verified binding, never by fetching, and always labelled as the link's claim. Fixed.

**R1-M6. Homoglyph hosts.** Kind line hosts, handler origins and `origin`-display values were shown with no IDN rule. *Fix (spec §7.1, §9.2):* use the A-label whenever the Unicode form mixes scripts or is confusable, and highlight the registrable domain. Fixed.

**R1-M7. Account and organization confusion.** The handoff does not bind an account. The viewer consents as their personal account, and the handler may act as whatever account (or organization, through member context) it has signed in. Revision 1 also implied an organization entity could be the viewer, but organizations allow no interactive login. *Fix (spec §6, §7.1, §8):* the viewer is always a person; organization action goes only through member context after confirmation in the handler. The consent page names the account, and the handler confirmation names the acting identity. Fixed. *Open (provider policy):* whether organization-installed apps are candidates for members, and organization-level defaults. *Revision 3 (Provisional (coordinator), not signed off by the user):* candidates only in member context; organization-level defaults not in v1 (§6.7). Organization-signed intents are attributable to the organization through any app holding a `signIntent` grant, so organization policy should restrict that grant (INT-8).

**R1-M8. Link hosts train viewers to type their handle on arbitrary origins.** *Scenario:* `evil.example/i?bintent=…` asks "Open with my provider", then fakes the discovery result and shows a look-alike provider sign-in page. This is inherent to any web page, but the flow makes it routine. *Not fixed in spec (residual):* 3sln.me should promote passkeys, the installed `web+bindle` handler and the remembered provider, so that viewers rarely type a handle on a link host. Users should be told that their provider never asks for a password after a link.

**R1-M9. Migration gaps.** Installed PWAs keep `/console?intent=%s` until their manifest refreshes. Today's `/console#contact=…&intent=` and `bindle_intent` are live entry points. Foreign contact links, which `parseIntent` drops today, would newly reach a built-in handler that cannot verify cross-host authors. *Fix (spec §11; design M3–M5):* the old entry points stay accepted and are bridged through `/i` with first-use consent, with no refusal. The built-in handler degrades gracefully for foreign links. Already-shared contact links are links, not intents, and are untouched. Fixed in text.

**R1-M10. Protocol-handler substitution was ambiguous.** The platform substitutes the whole scheme URL, percent-encoded, into `%s`, which invites double-decoding differentials between edge and app. *Fix (spec §3.4):* decode exactly once, then require exactly `web+bindle://intent?bintent=<raw value>`. Fixed.

**R1-M11. What each party learns.** The handling provider sees every intent its viewer opens, which is inherent; revision 1 set no retention bound. The link host learns each opener's IP and timing, plus the query-form data, and its script can read the remembered provider. The kind publisher and the minter's provider learn about opens (R1-M1). A handler verifying a contact link tells its owner host that the link was opened. *Fix (spec §6):* value and data are kept only for one flow (at most one hour) and never in records, analytics or audit. Fixed. The rest is residual and should be disclosed in 3sln.me's privacy text. It also strengthens Q1: capability kinds in the fragment keep link-host servers out.

### Low

**R1-L1. Chooser bias.** A manifest could influence order or preselection. *Fix (spec §7.3; design §6.3):* no preselection without a default, and order is never taken from manifest claims. Fixed.

**R1-L2. Fragment hygiene beyond handlers.** The fragment GET at the endpoint and fragment-form link-host pages also had to strip before loading anything, and how the value reaches the server was unspecified. *Fix (spec §6, §10):* strip with `replaceState`, then a same-origin POST that only renders. Fixed.

**R1-L3. Transient manifest failures.** "Stops declaring" could be read as covering a failed refetch, so an outage would clear defaults. *Fix (spec §7.3):* only an adopted snapshot clears a default. Fixed.

**R1-L4. Handoff fragments look like intent links.** `<route>#bintent=…&bintent_iss=…` is not an intent link under §3.4, so tooling that lifts `bintent` from history must ignore it. This is already implied by §3.4's exact fragment rule. Note only.

**R1-L5. Consent fatigue from kind proliferation.** Each app publishing its own near-duplicate kinds multiplies first-use prompts, and widening re-asks add more. *Recommendation:* the 3sln.me catalogue and SDK steer apps to registered kinds. 3sln.me may lighten first use for reviewed `view` kinds with a single candidate (still a page, never zero clicks). Exclusion and ignore semantics match incremental authorization §9 and app-removal §9.5 (kept across removal and reinstall), which is correct.

**R1-L6. Removal pending.** Under app-removal UD-1, a handler stays fully functional while its removal is pending. *Fix (spec §7.1 item 4):* the consent page discloses the pending removal. Fixed.

**R1-L7. Q1 reinforced.** Every query-form capability intent puts a contact capability into a link host's logs and into every copy of the URL. The reviewer recommends making the fragment form a MUST for `capability: true` kinds. This is the user's decision, so the text is unchanged. *Revision 3:* adopted as Provisional (coordinator), not signed off by the user (spec §3.4, §9.3).

### Checked and sound

- No navigation target comes from intent content. Routes are pinned to the verified origin and path prefix, and decisions are same-origin, CSRF-protected and unframed.
- A newly connected app cannot replace a default, and exclusions are unobservable.
- Projection to an older handler version drops attribution and undefined members.
- `bintent` is not a `bindle_*` name, and mixing it with `bindle_meta` or `sig` is malformed.
- Old `web+bindle` handlers refuse the new `intent` name (links §6.4), so they fail closed.
- Intent links on `/i` carry no account, so they survive the minter's move. Identity portability §10 already excludes intent endpoints from redirects and adds `no-store` for `bintent`.


### 2026-10-23 local routing index (provisional)

The Node metadata adapter and the Worker account controller install the same transactional
`intentIndexedMetadata` wrapper. It derives `item-index/intent-handler/` keys from adopted
connection manifests, partitioned by owner, kind and version. Resource writes, generation
changes, declaration adoption and deletes update those keys in the same transaction.
Routing reads only the requested kind and rechecks each exact resource record, its current
generation and the adopted declaration before offering a handler. A stale or corrupted
index entry cannot authorize a route. Reconciliation still runs before every owner intent
operation; defaults retain their existing generation fence. Version resolutions, including
those used to check defaults, are cached only within one operation.

An existing account is migrated once in a transaction using resource pages of 100 rows;
this first migration still takes O(resources) total work. The ready marker records a code
epoch (`INTENT_INDEX_VERSION`); a marker from any other epoch, including the original boolean
marker, clears the derived keys and rebuilds them. Bump the epoch when the derivation changes
and on the first release after a rollback to code that did not maintain the index. Subsequent lookups take work
proportional to matching handlers, independent of unrelated resources. Stores supplied
directly to the engine without the indexed capability retain the compatibility scan.
The index is derived local state, excluded from exports under the existing `item-index`
prefix. These are implemented local behaviors, with production release still disabled.
