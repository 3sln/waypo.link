# @3sln/bindle UI elements: design and coverage audit

> **Group:** `@3sln/bindle` SDK: custom elements and provider islands
>
> **Status:** provisional. Coordinator-commissioned audit, 2026-10-29, following the owner directions of 2026-10-29 (DEVLOG: "UI elements cover every app-integration pattern"; the elements "represent the brand through their quality, not branding"). Unsigned. This document changes no product code, tests or specs. Every proposal here is a recommendation until it is recorded in DEVLOG.md with a sign-off.
>
> **Covers:** coverage of app-integration patterns by `<bindle-session>`, `<bindle-sign-in>`, `<bindle-account>`, `<bindle-avatar>`, `<bindle-monogram>` and `<bindle-request>` (`packages/sdk/src/elements/**`, `capabilities.mjs`) and by the island parts in `apps/embed/**` (`sign-in`, `avatar`, `account-switcher`, `request`); a visual and interaction review of every element state; the privacy and security constraints that limit the fixes; a proposed element design system; and a prioritised work plan.
>
> **Does not cover:** provider pages (consent, login, account console), the sample apps under `apps/samples` and the simulation under `tests/sim` (separate owner), Bindle interop, and production verification of anything.

Architecture/frontend/security sign-off: Reviewer ___ / Date ___ / Outcome ___

Builds on: [embed islands](embed-islands.md), [adaptive app sign-in](adaptive-app-sign-in.md), [embeddable elements](embeddable-elements.md), [components profile](components-profile.md), [components-v1](../profiles/components-v1.md), [release gates (reference-host presentation and framing)](../3sln/release-gates.md#reference-host-presentation-and-framing-3slnme-policy) and the [integration guide](../integration.md#embeddable-elements-provisional).

## 0. Method and evidence

- **Harness.** A scratch Playwright harness (not committed) reuses the patterns of `tests/browser/request-element-browser.mjs` and `tests/browser/provider-matrix.mjs`. `app.example` serves the SDK from this checkout; the provider is `testing.mjs`'s in-page mock (`createMockProvider`, with `componentsDeclaration` when islands are on); `embed.provider.example` serves the **real** island runtime (`apps/embed/src/boot.mjs`, `styles/shell.css`, `styles/parts.css`) with a fake island worker that answers `start`/`render`/`remove` and paints tiles with the real `worker/avatar.mjs` encoder (`monogramPNG`, `transparentPNG`). App sessions are created with `client.beginAuthorization` + `provider.authorize` + `completeLogin` before `<bindle-session>` connects.
- **Engines.** Chromium (headless, all 92 scenarios) and Firefox (5 key scenarios, same results). WebKit, screen readers, forced colours and real touch devices were **not** run in this audit.
- **What the evidence is.** Local rendering of the shipped CSS and DOM against a mock provider and a fake worker. It says nothing about the deployed embed origin, real leader election, real avatar bytes or real flows.
- **Screenshots.** Captured 2026-10-29 into the session scratchpad (`…/scratchpad/elements-audit/shots/`, not in the repository; `artifacts/browser/` is gitignored). They are cited below by file name. Viewports: 390 × 560–640 at 2× and 1280 × 440–640 at 1×; light and dark; `en` and `es`. Prefixes: `E` = standard composition (islands off), `I` = islands live, `M` = montage. W1 in §5 turns the harness into a committed gallery.

## 1. Coverage matrix

Legend: **Today** lists the elements, attributes, properties and events that support the pattern now. **Gaps** are precise: a missing element, attribute, property, event, state or API. Gap IDs (G-n) are reused in §5.

| # | Integration pattern | Today | Gaps |
| --- | --- | --- | --- |
| P1 | **Sign-in required** (nothing works until the user signs in) | `<bindle-sign-in>` (standard form or sign-in island) on a landing view; app listens to `bindle-session-change` / `bindle-sign-in-end` and swaps views itself. `<bindle-session>.state` is `signed-out\|pending\|signed-in`. | **G2** no gate: missing a `<bindle-gate>` element (or `signed-in`/`signed-out`/`loading` slots on `<bindle-session>`) that shows fallback content until a session exists. **G2b** `<bindle-sign-in>` keeps rendering the full form after sign-in (`E13-sign-in-while-signed-in`); missing a signed-in behaviour (hide, or a "Signed in as …" summary with Continue). **G3** app sessions are memory-only (`account.mjs`: "the only state a fresh page can be in"), so every reload returns to the gate; missing an opt-in persisted session and a `restoring` state (see P4). |
| P2 | **Works signed out; header avatar/sign-in to sync** | `<bindle-account>` shows its `signed-out` slot, default a bare **Sign in** button (`E03`) that starts identity-optional login; signed in it shows the trigger + panel. | **G1** no compact signed-out composition: the documented markup (integration guide, `embed-elements` fixture) slots the whole `<bindle-sign-in>` form into the header (`E01-*`, `I01-*`: the header grows to 250 px at 390 wide). Missing: `<bindle-account signed-out="button\|panel">` where `panel` opens the sign-in composition (form or island) inside the same popover/sheet as the account menu. **G9** flow notices (`Waiting for…`, `blocked`) render inline inside the element and push the header open (`E05e-popup-waiting-account`). **G3** the header flips to signed-out on every reload. |
| P3 | **Public view; sign in to unlock a feature** (incremental authorization) | `<bindle-request kind="grant-more\|configure">`: JS-only `config={INCREMENTAL_AUTH_ENABLED:true}` and `request={…}`; request island when declared; events `bindle-request-start`, `bindle-request-end {outcome}`; result on `element.result`. Inert by default (flag off). | **G7a** signed out, it renders a disabled **Review access** button with no explanation (`E11b-request-signed-out`); missing a combined "sign in and grant" path (`login` with `requests` from the same control) or a `signed-out` slot. **G7b** no declarative attributes (fragment, fields) and no `requests-src` equivalent; integrators must script. **G7c** no granted/declined state rendering beyond one status line; `held` (declined/partial) has no visual. **G7d** the `request` part is implemented (`apps/embed/src/parts/request.mjs`, `islands-protocol` PARTS) but the release-gates islands row still allowlists only `avatar`, `account-switcher`, `sign-in`; reconcile. **G7e** `<bindle-request>` is missing from the integration guide's element list. |
| P4 | **Returning user / resume** | Island R1: with a component binding in the embed partition, the sign-in island signs the app in with one click and one popup. Without islands: full flow again. | **G3** no persisted app session (DPoP-bound refresh with a non-extractable key would satisfy the release gate "persistent browser refresh tokens are issued only DPoP-bound"); missing `<bindle-session persist="off\|session\|device">`, `state:'restoring'` and a `bindle-session-change` cause `restored`. **G3b** the sign-in island cannot say "Continue as Ada" because P10 forbids storage access before activation (§3, C8); needs a security decision, not just UI. |
| P5 | **Multiple accounts / switcher** | Island: `account-switcher` lists up to 8 bound accounts, `select` → `bindle-account-select {subject}`, "Use another account", "Remove from this site". Standard composition: **Use another account** (`select-account` or handle form). `BindleClient.sessions` holds several app sessions and `BindleSession.selectAccount(subject)` exists. | **G4** without islands there is no account list: three held sessions show only "Use another account" (`E07d-menu-multi-held-sessions`). Missing: a frozen `sessions` getter on `<bindle-session>`, a `bindle-sessions-change` event, account rows in the fallback panel (`actions` token `accounts`), and `bindle-account-select` for those rows. **G5** `signOut()` signs out of every held session; missing `signOut({subject})` and a per-row "Sign out of this account". **G4b** the switcher island renders at 300 px (iframe intrinsic width) inside the panel although components-v1 §6 allows 280–480; missing an element-set inline size. |
| P6 | **Embedded island vs popup vs redirect** | `<bindle-session presentation="auto\|popup\|redirect" popup-fallback="redirect\|prompt">`, `islands="auto\|off"`, `island-issuers`; island → element `islandFlow` → `bindle-sign-in-end`; `popup-blocked`/`unavailable` show **Continue at {host}** / **Continue in this tab**. | **G10** sign-in island width: the per-locale width table of embed-islands §3.2 is not implemented; in shrink-to-fit containers the iframe falls back to its 300 px intrinsic width (probe in `I01d`: host and iframe 300 px). **G11** documented but missing: `<bindle-sign-in island="auto\|off">`, `<bindle-session embed-origin>`, `connectedMoveCallback`. Default disagreement: embed-islands §12.1 says `islands` defaults to **off**, `session.mjs` defaults to **auto**, and the integration guide says "on by default" but also "today no island mounts" (stale). **G8** sheet mode (`sheet`, `sheet-breakpoint`, `placement`, scroll lock, swipe dismiss, embed-islands §9.1–9.4) is not implemented: the panel is always an anchored popover. |
| P7 | **Step-up ("confirm it's you")** | `actions="reauth"` (shown only when the issuer declares `reauthenticate`), `reauth-max-age`; `<bindle-session>.reauthenticate()`. | **G6b** no event that reports step-up success to the app from the element (only the generic `bindle-flow-end {intent:'reauthenticate'}` on the session); missing `bindle-account-reauth {outcome, authTime}` or documented use of the flow event; no in-panel busy state. |
| P8 | **Sign-out** | `actions="sign-out"` (app only, `revoke-on-sign-out`), `provider-sign-out` (end-session, with the "other apps stay signed in" note); `bindle-account-change {cause:'sign-out'}`; islands receive `forget`. | **G5** no per-account sign-out (see P5). No confirmation pattern for `provider-sign-out` beyond the trailing "…". |
| P9 | **Disconnect / removal** (user removes the app at the provider, grant revoked, "Remove from this site") | Island "Remove from this site" with in-island confirmation; provider-side revocation surfaces as a failed refresh → session ends. | **G6** the app cannot tell revocation from expiry: `bindle-account-change.cause` is `sign-in\|switch\|sign-out\|expired`; missing `revoked` (and `removed` for an island removal of the current account) plus an element notice ("You were signed out because access to {app} was removed at {host}"). No standard-composition "Remove" (fine: nothing local to remove without islands). |
| P10 | **Errors, offline, popup blocked** | `failureText()` codes; `role=alert` error line; blocked/waiting notices; island degradation to `fallback`. | **G9** notices are inline blocks inside the element, not anchored to the control (`E05c`, `E05d`, `E05e`). **G14** no offline state: a network failure renders the generic "couldn't reach this provider" (`E05b`) with no retry affordance. **G16** no busy state on the trigger or buttons while a flow runs (the **Sign in** button stays enabled while waiting, `E05e`). |
| P11 | **Bring-your-own provider** | Handle form with `@host` suffix; `actions="provider"` handle form in the panel; `default-host="none"`. | Panel handle form lacks the suffix, help and examples of the main form (`E08-menu-handle-form`). |
| P12 | **Sign-up** | Island `island-label="sign-up"`. | Standard composition has no sign-up framing (copy, heading slot default); missing `<bindle-sign-in intent="sign-up">` that also sets the island label. |
| P13 | **Localization / RTL** | `lang` → `es` catalogue for elements and islands; `dir` from locale; `<bdi dir=auto>` on names; RTL initials. | Spanish strings overflow the switcher actions (`I03c-switcher-compact-es`). The element ignores the page `dir` when `lang` says LTR, and the island takes `dir` only from its own locale (`I03g-switcher-rtl-page`); acceptable, but document it. |
| P14 | **Embedder adaptation** | Public `--bindle-*` properties and `::part()` on elements; `trigger="avatar"`, `density`, `island-variant`, `island-label`; `theme="light\|dark"`. | **G17** islands take no tokens (rev 3.3), so one composition mixes the embedder's radius/accent/font with provider defaults (`I06-islands-vs-embedder-tokens`). **G17b** an embedder `color-scheme: dark` without `theme` keeps the element palette light (`E12b-dark-embedder-page-light-os`): `schemeFor` returns the `auto` class, so `--_*` defaults follow `prefers-color-scheme`, while only the identity tiles follow `light-dark()`. **G12** no size/shape presets on the trigger or sign-in controls (§4.6). |

## 2. Visual and interaction review

Severity: **S1** broken or inaccessible; **S2** visibly unpolished, fix before showing externally; **S3** refinement.

### 2.1 `<bindle-account>` trigger and panel

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V1 | S1 | **Avatar island misaligned and square.** `.avatar-island` is positioned at `inset .3em` from `.wrap`, but the standard avatar sits inside the trigger after its 1 px border, `.3em` padding and vertical centring in a 44 px box, so the island sits ~2 px up and left. The island raster (`parts.css .avatar`) is a full-bleed square and nothing clips it, so a square photo or monogram covers the round avatar and overhangs the pill. | `I02-avatar-island-light`, `I02-avatar-island-dark`, `I02c-avatar-island-sizes`, `I03-*` | Clip on the embedder side: `.avatar-island{border-radius:50%;overflow:hidden;clip-path:circle(50%)}`, and on `<bindle-avatar>`'s `.island`. Position from the same variables as the trigger: `inset-block-start:calc(1px + (var(--_trigger-h) - var(--bindle-avatar-size)) / 2)`, `inset-inline-start:calc(1px + .3em)`, or CSS anchor positioning where supported (`anchor-name` on `.avatar-box`). Size and position stay embedder-side facts (C1). |
| V2 | S1 | **Monogram replaces initials when the avatar island is live without a binding.** `worker/index.mjs tile()` returns the subject monogram for any non-null subject, so "AL" becomes a pixel monogram as soon as islands mount. components-v1 §6 says the avatar island "draws nothing otherwise … so enabling the island never replaces initials"; embed-islands §6.4/§11 says monogram. | `I02b-avatar-island-no-binding` vs `E06-signed-in-initials-light`; `I03d-switcher-no-binding` | Reconcile the specs in favour of components-v1 (transparent without a binding). That keeps one raster per state (C3) and lets the element's initials show. |
| V3 | S2 | **Long names wrap to three lines** and grow the header. | `E06-signed-in-long-name-*`, `E07d-menu-multi-held-sessions` | One line with ellipsis: `.label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-inline-size:var(--bindle-label-max,14em)}`, 10em under 480 px. The full name stays in the accessible name and the panel header. |
| V4 | S2 | **Trigger reads as a form control**: a 1 px `#7c838d` pill border on every state, no hover change, no menu affordance. | `E06-*`, `E09b-trigger-hover` (identical to rest) | Ghost trigger: transparent at rest, `surface-raised` (or 8% accent tint) on hover, 12% on press, a 16 px chevron after the label, border only in forced colours. Keeps the 44 px target. |
| V5 | S2 | **Panel header repeats the name only**; with the switcher live it duplicates the island's current-account card directly below. | `E07b-menu-all-actions`, `I03-switcher-three-light` | Without the switcher: 40 px avatar + name + granted handle + "via {host}". With the switcher live: hide the header (the island card is the header) or show only the app slot. |
| V6 | S2 | **Menu items are an undifferentiated list**: no icons, no groups, the red "Sign out of {host}…" sits between neutral items, "Manage at {host}" has no external-link cue, the `menu-end` separator is the only divider. | `E07b-menu-all-actions`, `E07c-menu-all-actions-es-dark` | Three groups: account (Use another account, Use a different provider, Confirm it's you), app slots (`menu-start`/`menu-end`), session (Sign out of this app, Sign out of {host}…). Icons from §4.4. External glyph on Manage. Danger colour only for the provider-wide action. |
| V7 | S2 | **Hover is white on a grey panel** (inverted); the 3 px focus ring with 2 px offset nearly touches the panel edge. | `E09d-menu-item-hover`, `E09c-menu-keyboard` | Panel surface = `surface`; hover = `surface-raised` or 8% accent; focus ring 2 px inset (`outline-offset:-2px`) inside list items. |
| V8 | S2 | **Patchwork surfaces with the switcher**: grey panel (`#f4f5f7`) around a white island (fixed-palette trust header and surface), no separator between island and app actions. | `I03-switcher-*`, `I03b-switcher-1280` | Make the panel surface equal to the island default surface (white / `#1b1d22`) and separate regions with 1 px decorative borders; let the island sit edge to edge inside the panel (no padding) so its own borders align. |
| V9 | S2 | **Handle form in the panel** has no `@host` suffix, no help, and a label that repeats the item just clicked. | `E08-menu-handle-form` | Reuse the sign-in field component (suffix, help, inline error); replace the list with the form (back button) instead of appending below it. |
| V10 | S3 | **No motion.** Panel appears instantly; no transitions anywhere in the elements. | all `E07*` | §4.5: 120 ms fade + 4 px rise on open, 90 ms on close, `@starting-style`; none under reduced motion. |
| V11 | S3 | `trigger="avatar"` shows a bordered circle around the picture. | `E06b-signed-in-avatar-only` | Ghost circle with hover ring; picture fills the target. |

### 2.2 `<bindle-sign-in>` (standard composition)

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V12 | S1 | **Double focus ring** on the handle field: `.identity:focus-within` draws a 3 px ring and the shared `input:focus-visible` rule (base styles, higher specificity than `input{outline:none}`) draws a second ring around the input. | `E09e-sign-in-focus`, `E05-invalid-handle` | `.identity input:focus-visible{outline:none}`; keep the wrapper ring only. |
| V13 | S2 | **Two "Continue" buttons** (primary "Continue with {host}" and a secondary form "Continue"), no divider, unclear hierarchy. | `E02-sign-in-standalone-*`, `E01-*` | "or" divider between the provider button and the form; label the form button "Continue with handle" or make it a trailing arrow button inside the field. |
| V14 | S2 | **Suffix floats at the far end** of the field instead of after the typed text, so it reads like a placeholder. | `E09e-sign-in-focus` | Mirror-width technique: an invisible span with the typed value sizes the input so `@host` follows the text; collapse when `@` is typed (already hidden). |
| V15 | S2 | **Errors are detached**: the field does not change, and the message sits after the submit button. | `E05-invalid-handle`, `E05b-unknown-provider` | Danger border + icon on the field when `aria-invalid`, message directly under the field, replacing the help line; keep `role=alert`. |
| V16 | S2 | **Layout shift and hierarchy flip on discovery**: before capabilities arrive the form is primary; then "Continue with {host}" is inserted above and the submit turns secondary. | `E04b-discovery-pending` vs `E02-sign-in-standalone-light` | Reserve the provider-button row with a static placeholder while discovery is pending (embedder-side and constant), and never restyle the submit after first paint. |
| V17 | S2 | **Notices are inline cards**: status line + notice box both shown, uneven wrapping of three buttons. | `E05c-popup-blocked-prompt`, `E05d-popup-waiting` | One notice per flow with one primary action; status line visually hidden (keep the live region); waiting state shows a spinner in the clicked button and a single "Continue in this tab" link. |
| V18 | S2 | **Copy**: "Your Bindle identity" is protocol jargon for end users; the help sentence is long. | all `E02*` | Proposed: "Your handle" + example `ada@3sln.me`. Release gates require "the framework brand" in handle entry, so this needs an owner decision (§3, C10). |
| V19 | S2 | `identity-required` still shows "Continue with {host}" (the attribute only affects empty-submit validation). | `E02b-sign-in-identity-required` | Hide the identity-optional button when `identity-required` is set, or rename the attribute. |
| V20 | S3 | Dark scheme: pastel accent `#8fb0ff` with dark text looks washed out; field darker than page. | `E02-sign-in-standalone-dark` | §4.3 dark palette (`#7aa2ff` on `#1b1d22`, field = surface). |
| V21 | S3 | Disabled = 70% opacity, no busy indicator. | code (`baseStyles`) | §4.2 busy state. |

### 2.3 Sign-in island (`#sign-in.v1`)

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V22 | S1 | **Invisible keyboard focus**: `.control:focus-visible` is `2px solid var(--c-focus)` with `-2px` offset, and `--c-focus` equals `--c-accent`, the filled button's background. Probe: outline `rgb(47,91,211)` on background `rgb(47,91,211)`, contrast 1:1 (WCAG 2.4.7 / 2.4.11). | `I01d-sign-in-island-keyboard-focus` | Two-tone inset ring inside the clipped root: `outline:2px solid var(--c-on-accent);outline-offset:-4px;box-shadow:inset 0 0 0 2px var(--c-accent)` for filled; accent ring for outline/neutral controls. Same fix for the request island and switcher rows. |
| V23 | S2 | **Placeholder-looking mark**: a hollow 14 px circle reads as a radio button. | `I01b-sign-in-island-standalone-variants`, `I01-*` | A neutral 16 px sign-in glyph from §4.4, or no mark. Avoid provider logos (owner direction: no branding). |
| V24 | S2 | **Fallback ↔ island mismatch**: island label is 600 weight with a mark; the element fallback is 400 without; island and the element's "Use a different provider" touch (0 px gap); the island takes the iframe's 300 px intrinsic width. | `I01-*`, `I01b`, `E01-*` | One button spec for both sides (§4.2: 500 weight, 8 px gap); element sets the island inline size (G10). |
| V25 | S2 | **Skeleton → island reflow**: while the island is `mounting`, the whole standard form shows, then collapses to island + link. | `I01e-island-skeleton` vs `I01-signed-out-sign-in-island-light-390-en` | While `mounting`, render a same-size placeholder button (embedder-side, constant), switch to the standard form only on `fallback`. Timing differences are already accepted residuals (adaptive §8.2); the placeholder adds none. |
| V26 | S2 | **Disarmed state looks disabled**: `html[data-armed=false]` desaturates and mixes 70% accent, so the control looks greyed until the pointer has dwelt 400 ms. | `I04-request-island-dark`, `I01-*-dark` | Keep "visibly inactive" (§13.4) but subtler: full colour, no hover feedback and default cursor while disarmed; on arming, a 120 ms hover-tint fade. |
| V27 | S3 | No busy state inside the island after activation (only `aria-busy`). | `I01f-island-pending-flow` | Inline spinner replacing the mark while `model.flow` is set (constant size). |

### 2.4 Account-switcher island (`#account-switcher.v1`)

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V28 | S1 | **Grid blowout with a long name**: `.switcher` and `.text` are grids with auto tracks, so one long name makes the content 463 px wide in a 300 px frame (probe). Names clip without ellipsis, "Manage at {host}" is clipped on both sides (centred overflow), and **"Remove from this site" is pushed out of view** at 390 wide. | `I03-switcher-three-light`, `I03-switcher-many-dark`, `I03c-switcher-compact-es` | `.switcher{grid-template-columns:minmax(0,1fr)}`, `.text{grid-template-columns:minmax(0,1fr)}`; actions as a 2 × 2 grid or a vertical list of 40 px rows with icons; labels wrap to two lines within fixed rows (embed-islands §13.1 already allows two-line labels). |
| V29 | S2 | **"More at {host}" hidden below eight invisible rows**: with fewer than 8 accounts the user scrolls through blank space to find it, and the list shows a large empty well. | `I03-switcher-three-light`, `I03d-switcher-no-binding` | Keep the DOM and scroll height constant (C2) but place "More" visually after the last real row with CSS `order`; fill the remaining space with constant, island-only content (a caption "Accounts you use on this site appear here"). Island pixels are not embedder-observable (§7 snapshot statement), so this does not leak. |
| V30 | S2 | Current-account card text and row text start at different x (40 px vs 32 px tiles). | `I03-*` | Fixed 40 px leading column for both. |
| V31 | S2 | "Show my account at {host}" (no binding) truncates and sits on a monogram tile. | `I03d-switcher-no-binding` | Neutral person glyph tile, two-line label. |
| V32 | S3 | Remove confirmation crams warning + two actions into one 48 px row; warning truncates. | `I03e-switcher-remove-confirm` | Two-row confirm inside the fixed actions region (taller fixed region in every state). |

### 2.5 `<bindle-avatar>`, `<bindle-monogram>`

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V33 | S2 | Signed out, `<bindle-avatar>` renders nothing (0 × 0), so the layout shifts on sign-in. | `E10c-avatar-signed-out` | Reserve the box (`inline-size/block-size: var(--bindle-avatar-size)`) and draw a neutral person glyph or nothing, per a `signed-out="empty\|glyph"` attribute. |
| V34 | S3 | The 5 × 5 monogram with 12.5% inset is clipped by the circle at the corners. | `E10-avatars-light`, `E10-avatars-dark` | 20% inset for circular tiles (shared `islands-protocol` constants so islands match, M6). |
| V35 | S3 | Initials tiles are good: correct grapheme handling for emoji and Arabic, crisp at all sizes. | `M-triggers`, `E10-*` | Keep. |

### 2.6 `<bindle-request>` and request island

| ID | Sev | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| V36 | S2 | Standard button is a bare secondary "Review access"; signed out it is a disabled button with no reason. | `E11-request-light`, `E11b-request-signed-out` | Primary-tonal button with a lock/plus glyph; signed out: hide by default or render the `signed-out` slot. |
| V37 | S2 | Island label has a double space before "·" (`' · '` span plus 8 px gap), is 3.5em tall (sign-in is 44 px), and adjacent islands touch. | `I04-request-island-light`, `I04-request-island-dark` | Drop the leading space; same 44/48 px height rule as sign-in; element margin. |

### 2.7 Cross-cutting

- **Dark embedder pages** (G17b): `E12b-dark-embedder-page-light-os` shows white inputs and buttons on a dark page. Fix: when the inherited `color-scheme` is exactly `dark` (or `light`), apply that palette class, not `auto`.
- **Fonts**: elements inherit the page font, islands always use `system-ui` (`I06`, `E12c-serif-page-font`). Acceptable (C6), but controls that sit next to islands should use the same system stack so a composition does not mix fonts (§4.2).
- **Forced colours**: elements and islands have rules; not re-verified here (existing `provider-matrix-tile-forced-*` artifacts cover tiles only).
- **No horizontal overflow** at 390 px in any scenario; no page errors in any scenario.

## 3. Constraints that shape the design

Each fix in §2 and each proposal in §4 was checked against these. Sources: release gates (reference-host presentation and framing), embed-islands §6, §9, §11, §13, components-v1 §3–§7, adaptive app sign-in §8–§13.

| ID | Constraint | Consequence for design |
| --- | --- | --- |
| C1 | **Island sizes are fixed or embedder-set, never derived from state or content**; islands never post sizes; elements never measure island content (§13.1, components-v1 §6). | Every island box (trigger avatar, switcher 320/248, sign-in 44/48 × inline) is chosen by the element from attributes, CSS and viewport. The fixes for V1, V24, V25, G4b and G10 set sizes from attributes or a static per-locale table, never from what the island shows. Presets (§4.6) map to fixed numbers. |
| C2 | **Constant shape in every account state**: switcher always 8 row nodes + "More", constant scroll height, single roving Tab stop, constant number of Tab presses; focus moves only on activation or programmatic parent focus; `preventScroll` (§13.1, §14.1). | V29 must reorder visually only (CSS `order`), not change DOM count or scroll height. Empty-state art inside the island is fine because island pixels are not observable; anything that changes scrolling or focus is not. |
| C3 | **No state-dependent messages, sizes, focus or error signals** from islands; one raster swap per tile per state (§6.3, §13.2, release gates). | V2 (transparent avatar without binding) keeps one swap. Busy spinners inside islands are allowed only after a user activation (flow outcome and duration are accepted residuals). |
| C4 | **Inert until visible**: island pointer activation arms 400 ms after visibility and dwell; disarmed controls look visibly inactive; keyboard not gated (§13.4). Provider authorization pages are inert until visible and focused for 600 ms. | V26 softens but keeps a visible disarmed state. Elements must not present the island as "ready" (no hover affordance) while `data-armed=false`. |
| C5 | **No theme tokens** (extensions rev 3.3 §2.7, CR-X3-33): elements send `{}`; islands use provider defaults; trust text uses a fixed palette. | Elements cannot recolour islands. To look like one system, element defaults must equal island defaults (§4.3), and embedder adaptation must be **enumerated presets** that are size-neutral or map to fixed sizes (§4.6). New island props need a components-v1 change (props are a closed enum per part). |
| C6 | **Embed-origin CSP and Trusted Types**: static `shell.css`/`parts.css`, one constructed sheet, no inline script, no third-party fonts. | Islands use `system-ui`; no web fonts, no embedder fonts. Icons are inline SVG in the island bundle or CSS masks from same-origin assets. |
| C7 | **Cross-origin isolation and opener rules**: the shell sends `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: cross-origin` (`packages/runtime/routes/federation.mjs`), so COEP embedders can frame it (not browser-verified here). Island flows need an opener: an app with `COOP: same-origin` makes island popups `unavailable`, and the element must then offer its own path. The element tears down on `sandbox`/`credentialless`. | The element's fallback path (Continue at {host} / Continue in this tab) must look first-class, not like an error (V17). Integration docs must tell COOP apps to use `same-origin-allow-popups` or expect the fallback. |
| C8 | **P10: sign-in and request islands touch no storage and make no network request before activation.** | No "Continue as Ada" in the sign-in island (G3b) without a security decision; R1 one-click remains the returning-user story. |
| C9 | **Entitlement**: element events carry only app-entitled data; the trigger shows only app-granted name/handle/picture; never the typed handle; `select` is honoured only for held sessions. | G4's fallback account list may show only sessions the app holds (`BindleClient.sessions`), with their granted profile; never island data. |
| C10 | **Handle-entry rule** (release gates): the sign-in element shows the framework brand, an editable handle, the `@3sln.me` suffix until `@` is typed, and names the resolved host before navigating. | V18 copy changes need an owner decision; V14 keeps the suffix behaviour. |
| C11 | **Security copy is not slottable** (`sign-in.mjs` header); trust-bearing island text uses a fixed palette and cannot be themed. | Presets may not hide or recolour trust text; slots stay limited to headings, help and menu extensions. |

## 4. Proposed element design system

One system for elements and islands, so a composition reads as one component whatever mounts. Values are proposals (provisional).

### 4.1 Sizes and spacing

- **Grid:** 4 px. Spacing steps 4, 8, 12, 16, 24.
- **Control heights:** `sm` 32 px visual (hit area extended to 44 px with a transparent `::before`), `md` 40 px (default for header placements; 44 px hit area), `lg` 48 px (forms, hero, coarse pointer default). Islands keep components-v1 ranges: sign-in 44–56 (element maps `md`→44, `lg`→48), avatar 16–512.
- **Avatar sizes:** 24, 28, 32, 40, 48, 64, 96. Trigger uses 28 (`md`) or 32 (`lg`).
- **Panel:** inline 320 px (popover), `min(22rem, 88vw)` side sheet, full width ≤ 40rem bottom sheet; switcher island width = panel inline size (280–480 clamp), height 320/248 by `density`.
- **Radius:** 8 px default controls, 12 px panel, full for avatars and pill triggers.
- **Typography:** inherit the embedder font in elements, except controls adjacent to islands (sign-in button row, request button) which use `system-ui` like islands. 15/20 body, 13/16 secondary, 12/16 trust captions; 500 for buttons, 600 for names.

### 4.2 States

| State | Treatment |
| --- | --- |
| Rest | Primary: filled accent. Secondary: surface with `border-strong`. Ghost (trigger, menu items): transparent. |
| Hover | Ghost/secondary: `surface-raised`; primary: accent darkened 8% (`color-mix`). Not shown while an island is disarmed (C4). |
| Pressed | 12% tint, no movement. |
| Focus-visible | 2 px `focus` ring with 2 px offset in elements; inside clipped island roots and list items: inset two-tone ring (`on-accent` 2 px at −4 px plus 2 px accent inset shadow). Contrast ≥ 3:1 against both the control and its surround (fixes V22). |
| Disabled | `text-muted` on `surface-raised`, no opacity, `cursor:not-allowed`. |
| Busy | Label kept (width stable), 16 px spinner replaces the leading glyph, `aria-busy`, control inert. |
| Error | Danger border + icon on the field; message under the field. |
| Disarmed (islands) | Full colour, no hover feedback, default cursor; 120 ms tint fade on arming. |

### 4.3 Palettes (element defaults = island defaults)

Contrast ratios computed with the WCAG formula.

| Token | Light | Dark | Checks |
| --- | --- | --- | --- |
| `surface` | `#ffffff` | `#1b1d22` | — |
| `surface-raised` | `#f6f7f9` | `#24272e` | — |
| `text` | `#16181d` | `#eceef2` | 17.8 / 14.5 on surface |
| `text-muted` | `#5b6270` | `#a9b0bb` | 6.1 / 7.7 on surface; 5.7 / 6.8 on raised |
| `accent` | `#2b59d1` | `#7aa2ff` | 6.1 / 6.8 on surface; 6.0 on dark raised |
| `on-accent` | `#ffffff` | `#0b1020` | 6.1 / 7.6 on accent |
| `border` (decorative) | `#e3e6eb` | `#343840` | dividers only |
| `border-strong` (controls) | `#8a919c` | `#7d8590` | 3.2 / 4.5 on surface |
| `focus` | `#2b59d1` | `#9dbaff` | 6.1 / 8.8 on surface |
| `danger` | `#b42318` | `#ff8a7a` | 6.6 / 7.4 on surface |

The current defaults (`#2f5bd3`, `#8fb0ff`, `#7c838d` …) pass the island contrast matrix; the change is about polish (calmer borders, less washed-out dark accent) and about making panel and island surfaces identical (V8). Both `shared.mjs` and `shell.css` must change together; the island contrast test (`THEME_DEFAULTS`, `CONTRAST_PAIRS`) needs the new values.

### 4.4 Iconography

One 16/20 px inline-SVG set, 1.5 px stroke, round caps, `currentColor`, shipped in the element bundle and duplicated in the island bundle (C6): chevron-down (trigger), check (current account), plus (use another account), globe (different provider), shield (confirm it's you), log-out (sign out), external (manage), person (no binding / signed-out avatar), lock (request), alert (error), spinner. No provider logos.

### 4.5 Motion

Panel open: opacity 0→1 and translateY(4px)→0 in 120 ms `cubic-bezier(.2,0,0,1)` via `@starting-style`; close 90 ms. Sheet: 180 ms slide. Hover/press tints: 80 ms. Spinner: 800 ms linear. Nothing animates size or position of an island box (C1). Everything is off under `prefers-reduced-motion: reduce` (the existing global rule stays).

### 4.6 Embedder adaptation without theme tokens

Keep the `--bindle-*` properties for elements (they never reach islands), and add **enumerated presets** that both sides understand. Presets either do not affect size or map to fixed numbers chosen by the element (C1, C5):

| Attribute (element) | Values | Element effect | Island prop (needs components-v1 change) |
| --- | --- | --- | --- |
| `size` | `sm\|md\|lg` | control height 32/40/48, avatar 24/28/32 | none: the element sets the iframe height from the preset (sign-in 44 for sm/md, 48 for lg) |
| `shape` | `rounded\|pill\|square` | radius 8 / full / 2 | `shape` enum (radius only, no layout effect) |
| `appearance` | `filled\|tonal\|outline\|ghost` | button style | extends `variant` (`filled\|outline` today) |
| `tone` | `accent\|neutral` | accent or neutral (text-on-surface) primary | `tone` enum; neutral avoids the provider blue clashing with an embedder brand |
| `signed-out` (`<bindle-account>`) | `button\|panel` | G1 | — |
| `density` | `regular\|compact` | existing | existing |

Islands still validate every prop (C5); trust text keeps the fixed palette (C11).

### 4.7 Accessibility targets

WCAG 2.2 AA: 1.4.3 text contrast ≥ 4.5:1, 1.4.11 control boundaries and focus ≥ 3:1, 2.4.7/2.4.11 focus visible and not obscured (fixes V22), 2.5.8 target ≥ 24 px with 44 px hit areas kept as the house rule, 1.4.4/1.4.10 resize and reflow (truncation keeps full text in accessible names; 200% zoom without loss of the distinguishing handle), 4.1.3 status messages via the existing live regions. Keyboard: trigger opens with Enter/Space/ArrowDown, Escape returns focus, roving list in the switcher. Release evidence per embed-islands §14.2 (VoiceOver, NVDA, TalkBack) remains outstanding.

## 5. Prioritised work plan

Ownership: elements (`packages/sdk/src/elements/**`, `packages/i18n/sdk-catalogue.mjs`) and islands (`apps/embed/**`, `packages/i18n/islands-catalogue.mjs`, `islands-protocol.mjs`) can be separate writers; spec changes (components-v1, embed-islands, release gates) go through the coordinator. Each item needs DOM/browser verification and, for protocol changes, the island tests.

| Order | Item | Fixes | Notes |
| --- | --- | --- | --- |
| W1 | **Commit an elements gallery** (`tests/browser/elements-gallery.mjs`) from this audit's harness: every scenario in §0, light/dark, 390/1280, en/es, Chromium + Firefox, writing to `artifacts/browser/elements-gallery/`, plus overflow and contrast probes. | evidence | Gives every later item a before/after. |
| W2 | **S1 accessibility and layout bugs**: island focus ring (V22, also request/switcher), switcher grid blowout (V28), double field ring (V12), avatar island clip and alignment (V1). | V1, V12, V22, V28 | Small CSS changes; no protocol change. |
| W3 | **Spec reconciliation**: avatar island transparent without a binding (V2); `islands` default (G11); `request` in the release-gates islands row (G7d); integration guide refresh (stale island status, `themeTokens`, `<bindle-request>`) (G7e). | V2, G7d, G7e, G11 | Coordinator + owner sign-off; worker `tile()` change after. |
| W4 | **Header patterns**: `<bindle-account signed-out="button\|panel">` (G1), notices inside the panel or anchored to the trigger (G9), busy states (G16), trigger truncation and ghost style (V3, V4), panel header and groups (V5, V6), reserve `<bindle-avatar>` box (V33). | G1, G9, G16, V3–V7, V33 | Largest visible win for P2. |
| W5 | **Design-system pass**: shared palette (§4.3) in `shared.mjs` and `shell.css`, icon set (§4.4), state styles (§4.2), motion (§4.5), one button spec for element and island (V23, V24, V26). | V8, V10, V13, V17, V20, V21, V23, V24, V26, V27 | Update `THEME_DEFAULTS`/contrast tests together. |
| W6 | **Sign-in polish**: inline suffix (V14), field errors (V15), stable discovery layout (V16), island mounting placeholder (V25), `identity-required` (V19), sign-in island width table (G10), copy decision (V18, C10). | V14–V19, V25, G10 | Copy needs owner decision. |
| W7 | **Gate and multi-account APIs**: `<bindle-gate>` or session slots (G2), signed-in behaviour of `<bindle-sign-in>` (G2b), `sessions` getter + `bindle-sessions-change` + fallback account rows (G4), `signOut({subject})` (G5), `revoked`/`removed` causes and notice (G6), reauth event (G6b). | G2, G4–G6 | Engine-first: add to the `BindleSession` controller and test at the engine level before the elements. |
| W8 | **Switcher island polish**: visual "More" ordering and empty-state caption (V29), aligned columns (V30), no-binding card (V31), two-row confirm (V32), Spanish fit (P13). | V29–V32 | Preserve C2 probes (size, scroll, Tab count identical for 0–8 bindings). |
| W9 | **Presets** (`size`, `shape`, `appearance`, `tone`) on elements, then the matching enum props in components-v1 and the islands (§4.6); `color-scheme: dark` honoured (G17b). | G12, G17, G17b | Island props need a profile change and review. |
| W10 | **Sheet mode** (G8) and `<bindle-request>` signed-out/combined path and declarative attributes (G7a–c), sign-up framing (P12). | G7, G8, P12 | Sheet design already specified (embed-islands §9.4). |
| W11 | **Persisted app sessions** (G3) and any "Continue as" island design (G3b). | G3 | Security design first (DPoP-bound refresh at rest, P10). Not a UI-only change. Design: [account-chooser-island](account-chooser-island.md). **CH0 (persisted app sessions) implemented locally 2026-10-29, provisional and unsigned:** `persist="device\|off"`, state `restoring`, cause `restored`, cross-tab locks and sign-out ([integration](../integration.md#persisted-app-sessions-w11-provisional)); no `session` mode. The chooser island (G3b, CH1–CH3) is not implemented. |

## 6. Open questions for the owner

1. Handle-entry copy: keep "Your Bindle identity" (release-gate wording requires the framework brand) or move to "Your handle" with the brand elsewhere (V18, C10)?
2. Should `<bindle-account>`'s recommended header markup become `signed-out="panel"` (sign-in inside the account popover) instead of slotting the full form (G1)?
3. Islands default: `auto` (code, integration guide) or `off` (embed-islands §12.1) (G11)?
4. Persisted app sessions (G3): in scope before release, or is island R1 the only returning-user path?
5. Presets that reach islands (§4.6): acceptable as new components-v1 props, given rev 3.3 removed tokens?
