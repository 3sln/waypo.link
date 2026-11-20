# Waypo analytics: consent and privacy launch spike

**Reviewed 19 November 2026. Internal decision packet, not a published privacy notice or legal sign-off. Analytics remains OFF.** This report distinguishes regulator statements from engineering/legal interpretation. It does not certify every jurisdiction or replace counsel reviewing the final data flow.

## Recommendation

Do not add an unconditional “accept cookies” toast or claim that all analytics requires consent. Equally, do not enable the current event sink on the assertion that it has no analytics cookies or user IDs. Neither assertion resolves the applicable rules.

The preferred next design candidate is **locally aggregated, coarse operational statistics** exported without per-action timestamps or precise flow durations, with a clear notice and simple objection mechanism where required. This still needs a documented data-flow assessment, lawful basis where personal information is processed, and market/processor review. A more conservative alternative for retaining the present per-action diagnostics is **optional prior opt-in**, with durable, withdrawable consent and no disadvantage for declining. These are candidates, not an activation decision.

A per-user acceptance record is necessary when we actually rely on consent; it is not a universal requirement to manufacture consent for necessary login cookies or every legitimate operational statistic. Necessary identity/security processing and optional product analytics must be described separately.

## Actual scope and launch markets

The operator is established in Spearfish, South Dakota, United States, with no stated EU/EEA or UK establishment. The owner chose transient signup-country admission without storing country, and continued access for returning travelers. No country should be added to analytics or consent records to solve this issue.

At hosted commit `0003f12`, checked-in `hosted/waypo/wrangler.jsonc` has `allowedSignupCountries:[]`, closed admission and `acceptingNewAccounts:false`. Tests use US fixtures; they do not authorize a live US launch or demonstrate a reviewed worldwide allowlist. Earlier conversational interest in all non-EU/EEA/UK countries is not a completed market review. Canada and Australia below are **future candidate markets**, not currently enabled markets.

A signup-only guard is evidence about intended markets, not a universal exemption from privacy law. EDPB territorial guidance treats offering services and monitoring behavior as separate tests and says mere website accessibility is insufficient on its own. The assessment concerns actual targeting/processing, not nationality alone. Returning travel, VPN circumvention and national cookie-law reach require fact-specific assessment; this report neither demands travel blocking nor declares those situations legally irrelevant. Analytics consent also does not cure a separate representative/territorial obligation. [EDPB territorial-scope guidance, final version](https://www.edpb.europa.eu/documents/guideline/guidelines-32018-on-the-territorial-scope-of-the-gdpr-article-3-version-adopted_en).

## Data flow being assessed

The candidate SDK and Node integration currently do the following:

1. Login/signup/security requests use necessary existing authentication cookies, passkey proofs and browser-bound email/enrollment flow state. Country is only consulted for the signup guard.
2. Trusted server hooks produce request-local closed markers after actual operations. Telemetry does not call human-activity recording or reset inactivity deletion.
3. An optional internal SDK samples auth outcomes, creation attempts, session reuse, feature requests and backoff classes. Server processing time and elapsed verified email/enrollment flow time are separate measurements. No analytics cookie, browser beacon, client analytics SDK, device fingerprint or arbitrary public event endpoint is added.
4. A durable shared daily attempt budget limits optional writes. A configured Cloudflare Analytics Engine binding receives closed method/reason/outcome dimensions, numeric timings and sampling weights. The engine records its own event timestamp. The schema has no email, user/client ID, origin/URL, token, cursor, content, country or user-agent field.
5. These are **low-cardinality event records intended for aggregate analysis**, not already-proven anonymous aggregate statistics. Sampling is not anonymization. A small pilot's rare recovery, signup or forced-auth event, its timestamp and its precise duration can be correlated with operational/access records or staff knowledge. The identity-processing step before reducing the data is itself relevant.

Consequently, treat the candidate as potentially personal/pseudonymous processing until an actual reidentification assessment establishes otherwise. Removing names does not settle whether a person can be singled out or linked through other available information. [ICO guidance on indirect identifiability](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/what-is-personal-data/can-we-identify-an-individual-indirectly/).

Cloudflare's documented three-month Analytics Engine retention matters here: per-action events are retained, not immediately reduced to an irreversible local histogram. A successful `writeDataPoint` call is not delivery proof; a hard budget is not privacy-law compliance. [Analytics Engine limits and retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/).

## EU/EEA: terminal access and personal-data processing are different questions

**Terminal-access question.** Article 5(3) ePrivacy analysis is not limited to files named cookies. The EDPB's final Guidelines 2/2023 v2, adopted October 2024, address pixels, decorated links, local processing and other ways information is obtained from terminal equipment. Use that final text, not the 2023 consultation draft. [EDPB final technical-scope guidance](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en).

**Interpretation for Waypo:** a counter computed solely from an operation already completed on the server is materially different from instructing a browser to store/read analytics state or send an analytics beacon. That distinction supports a narrower terminal-access analysis. But “server-side” is not a blanket exemption, particularly if we repurpose authentication-cookie access or browser-bound flow identifiers for optional analytics. The exact access, purposes and national implementation must be assessed. Do not reclassify product analytics as necessary authentication just because it shares the login handler.

EU member-state audience-measurement exemptions are not uniform. CNIL describes conditional exemptions and cautions that simply anonymizing outputs is insufficient; purpose, isolation and other safeguards matter. This is not a certification that Analytics Engine or Waypo meets a French exemption, nor an EU-wide rule. [CNIL current cookie/measurement FAQ](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ).

**Personal-data question.** Even if an operation is outside a terminal-access consent rule, personal-data processing still needs its own lawful basis, transparency, minimization and appropriate processor arrangements where the GDPR applies. An engineering candidate is a documented legitimate-interests assessment for low-impact service reliability/improvement: identify purpose, necessity and balancing, including less intrusive aggregation. It is not enough to say “we own the service”; analytics is not automatically necessary to perform the identity contract. [ICO legitimate-interests framework](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests).

If consent is chosen, it must remain a real choice; optional analytics cannot be bundled into mandatory free identity terms or required to log in. Refusal/withdrawal must not reduce the promised identity service. [European Commission explanation of lawful grounds and freely given consent](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en).

## UK: use the 2026 rules, not old two-exception summaries

PECR regulation 6 and Schedule A1 changed in February 2026. Current law includes an additional statistical-purpose route; therefore “all analytics cookies always need opt-in” is no longer an accurate blanket UK statement. [Current PECR regulation 6 and amendments](https://www.legislation.gov.uk/uksi/2003/2426/body/2026-09-30).

Current ICO guidance describes five exceptions. The statistical route requires a service-improvement purpose, clear information and a simple free objection mechanism. It concerns statistical results rather than individual tracking; identifiable intermediate data should not be retained beyond the aggregation process, and third parties must only assist that purpose. These conditions are not satisfied merely by calling a dataset anonymous or selecting a US processor. [ICO current exceptions guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).

**Interpretation:** the current per-action three-month event sink is not yet proven to meet this exception. Local coarse aggregation, short intermediate retention, no cross-linking and purpose-limited vendor terms would improve the argument, but still require assessment. Do not count a necessary security cookie as analytics-exempt when also using it for unrelated purposes. ICO also explains that technologies used in a server-side context are not automatically outside the rules. [ICO current technology-scope guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/).

This is a UK-specific development; it must not be projected onto EU member-state rules. A privacy notice alone is not sufficient if consent is legally required, and a consent prompt is unnecessary ceremony if the actual assessed operation qualifies for a lawful exception and its conditions are implemented.

## US, Canada and Australia: conditional market checks

| Market | Relevant rule and Waypo implication |
| --- | --- |
| United States / California | CalOPPA can require a conspicuous privacy policy for commercial websites collecting identifiable information about Californians, separately from CCPA size thresholds. Identity accounts make this a relevant baseline even if telemetry is reduced. [California AG privacy-policy guidance](https://oag.ca.gov/privacy/facts/online-privacy/privacy-policy). |
| California CCPA | The current CPPA tool uses an adjusted revenue threshold of $26,625,000, alongside other business tests; the AG FAQ's unadjusted $25M figure should not be used as a current calculation. Small revenue alone is not a universal exemption because buy/sell/share and other tests exist. Assess applicable rights and processor contracts against actual practices. [CPPA business applicability tool](https://cppa.ca.gov/pdf/business_comply.pdf). |
| Colorado example | Applicability includes business/targeting and consumer-volume/sale tests; covered controllers have disclosure obligations, relevant opt-outs and sensitive-data consent duties. This is not a generic requirement for every small service to collect an analytics-cookie acceptance. Other state statutes and thresholds vary; no 50-state certification is made here. [Colorado AG CPA guidance](https://coag.gov/resources/colorado-privacy-act/). |
| US general consumer protection | Publish only privacy promises we can honor. Avoid “we never process personal data” or “anonymous” claims for the whole identity service. [FTC business privacy guidance](https://consumer.ftc.gov/business-guidance/privacy-security). |
| Canada, if deliberately offered | PIPEDA may cover foreign organizations with a real and substantial Canadian connection. It is not only a cookie-storage question. [OPC scope/enforcement guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-complaints-and-enforcement-process/enforcement-of-pipeda/). |
| Canada consent | OPC considers sensitivity, reasonable expectations and residual harm when deciding express versus implied consent. Unexpected third-party analytics disclosure may require more than buried notice. Provincial law also requires review; do not infer federal guidance resolves Quebec. [OPC meaningful-consent guidelines](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/). |
| Australia, if deliberately offered | Many businesses at or below AUD3M turnover are exempt from the Privacy Act, but exceptions include trading in personal information and other listed activities. This is not an exemption from every privacy-related obligation. [OAIC small-business guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business). Overseas “carrying on business” and Australian-link analysis is separate. [OAIC APP key concepts](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-b-key-concepts). |

For a stable HTML source alongside the California applicability PDF, the agency's [published CPI adjustment](https://cppa.ca.gov/regulations/cpi_adjustment.html) confirms the $26,625,000 revenue threshold effective January 1, 2025. This is one applicability test, not a general small-business or analytics-consent exemption.

**Scope limit:** no live market is approved by this table. Child-directed services, sensitive categories, session recording, advertising, profiling and app-supplied arbitrary content would materially change the analysis and are not covered by the present analytics design.

## Cloudflare responsibilities

Waypo chooses collection and purpose; using Cloudflare does not transfer the operator's legal obligations. Cloudflare's current Customer DPA v6.4 is effective April 3, 2026 and covers processor/subprocessor handling within its defined scope, including transfer terms. Verify the accepted agreement, covered service, subprocessor information, retention, access permissions and transfer mechanism before activation. Do not infer that a DPA proves anonymization or supplies the operator's lawful basis. [Cloudflare Customer DPA](https://www.cloudflare.com/cloudflare-customer-dpa/).

The separate request transport, platform logs and the operator's raw identity/security records remain relevant, even if the telemetry schema excludes identifiers. Keep analytics isolated from those records and limit staff access. A later dashboard must suppress sparse cells where needed; sampling weights and precise timing should not enable reconstruction of individual journeys.

## If consent is selected: what must be built

This section is a design requirement **conditional on a consent-based approach**, not a conclusion that every user must accept cookies.

1. Before any optional event is emitted, show a concise explanation of purpose, categories, vendor and retention, with equally accessible decline. Identity works on either choice. No preselected approval or account-creation condition.
2. Record a minimal private choice: purpose/schema version, notice version, choice, server decision time and appropriate private account/visitor binding. Preserve the exact notice versions separately. Do not add country, IP or user-agent merely as consent-proof decoration. No consent identifier is exported to analytics.
3. Permit withdrawal as easily as approval; stop future optional events immediately across sessions/devices as applicable. Retain only justified evidence of prior decisions for an explicit period. A paid/free transition must not reset a refusal.
4. Cover pre-account visitors correctly: consent collected only after signup cannot authorize earlier funnel events. Either implement a bounded privacy-choice mechanism before optional events or omit those pre-consent events. Necessary auth/security data is not withheld to force an analytics choice.
5. Test decline, withdrawal, account switch, offline behavior, stale tabs, notice-version change, retries and failures. A boolean in localStorage alone is not a complete durable/account-linked evidence system; a database row alone does not prove the notice was actually shown before collection.

ICO specifies evidence of who, when, how and what information was presented when relying on consent; a record that a person merely visited or accepted general terms is insufficient. [ICO consent recording/management guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/how-should-we-obtain-record-and-manage-consent/).

If the selected lawful basis is instead a qualifying statistical exception/legitimate interest, implement its notice, objection and accountability requirements without falsely labeling continued service use as consent. Keep the decision and assessment versioned, rather than adding unnecessary personal consent records.

## Activation checklist and decisions awaiting sign-off

- Choose coarse local aggregation versus consent-based per-action diagnostics; keep the current vendor sink off meanwhile.
- Document every terminal read/write and downstream purpose, including necessary auth-cookie reuse and server flow-time derivation.
- Complete a reidentification assessment with pilot population, platform timestamps, staff logs and vendor access; do not rely on identifier omission.
- Select actual launch markets and applicable notice/basis/rights. Preserve transient signup country and traveler access unless a separate reviewed decision changes them.
- Approve processor/transfer terms, retention, access and truthful public privacy text.
- If consent is used, implement and verify the prior-choice/evidence/withdrawal flow before collection. If an exception is used, implement all of its conditions and simple objection where required.
- Verify network/storage behavior in browser and Worker tests: no accidental vendor calls or new client tracking while disabled.

**No settings were activated and no consent UI or per-user consent ledger was implemented for this spike.** The open-source implementation stays optional and provider-agnostic; each self-hoster determines its own applicable legal basis and deployment policy.
