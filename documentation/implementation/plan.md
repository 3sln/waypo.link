# Implementation map

Waypo is under development. Production release remains disabled. Public self-hosting and admission references were refreshed from source commit `f916cac`, now selected by the hosted source pin for local pair qualification. Native-session handoff has local Node/Worker browser evidence; fundamental cost/security and production release gates remain open.

| Capability | Current evidence and limit |
| --- | --- |
| Identity and passkeys | Real local Node and Worker browser flows; external deployment remains gated. |
| Administration and account lifecycle | Portable policy and local adapters; consult the individual guides for limitations. |
| Optional services | Configured adapters and local tests do not establish public delivery or interoperability. |
| Offline accounts | Actual local Node/Worker browser evidence for previously verified account selection, fresh-tab offline reopening and isolated queued edits. Fresh offline authentication is not provided. |
| Account porting | Cooperative transfer remains a proposed design. |
| Synchronized state SDK | Generic map/list/text facade and versioned codec boundary tested; current providers remain Yjs-only. Cross-engine migration is not implemented. |
| Rich notifications | Local Node/Worker inbox, both sanitizers, privacy/search/deadline/retention controls and owner isolation tested. Protected action execution remains unavailable while real approval integration is built. |
| Hosted email | Purpose-specific adapter and native Worker binding integration are tested using a mock Email Sending binding. API acceptance is not inbox delivery; live delivery is unverified. |
| Account admission | Source implementation has atomic retained-account allocation and prepaid global creation-attempt blocks; hosted rollout and comprehensive spend protection remain gated. |
| Self-hosting | Private Node evaluation is documented; public deployment and restoration remain release gates. |

Read [self-hosting](self-hosting.md), [application integration](app-integration.md), [architecture](../design/architecture.md), and [release gates](../release-gates.md). Checked development work is not production approval.
