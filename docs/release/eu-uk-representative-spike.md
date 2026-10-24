# EU/UK representative obligations: research spike

Snapshot 2026-10-22 (agent research). **Not legal advice; counsel must confirm.** Legal reviewer: ___ Date: ___ Outcome: ___ (provisional until signed).

Labels: **[Law]** is what the text says, **[Practice]** is what regulators have done or published, and **[Inference]** is this spike's reading.

## Short answer

**Is it a blocker?** No. Neither the EU nor the UK forbids a non-resident service, free or paid. The duty to appoint a representative only applies once the service **targets** people in the EU or UK. When it does apply, it costs a few hundred to a few thousand euros a year per regime. The more expensive part is the substantive compliance that comes with targeting (GDPR, DSA notice-and-action, UK Online Safety Act assessments). The representative is a small cost on top of that.

**Recommendation: (b) block EU/EEA/UK sign-ups for launch,** and treat (a) as the planned way to enter later.
- **(a) Appoint representatives.** Prighter's published list prices for the GDPR and UK GDPR representative are €420 to €852 a year each at the entry tiers, and €2,040 to €4,752 at the higher tiers, excluding VAT ([Prighter pricing](https://prighter.com/pricing), read 2026-10-22; check which tier applies). DSA Art. 13 representation is priced by quote at [Prighter](https://prighter.com/pricing) and [EDPO](https://edpo.com/data-protection-representative-price/). Other providers include [VeraSafe](https://verasafe.com/representative-services/dsa-article-13-representative-program/) and [DataRep](https://www.datarep.com/service/eu-dsa-article-13-representative-service/), price unverified. Indicative total: about €1–3k a year plus a DSA quote.
- **(b) Block sign-ups.** This is cheap because the country-block mechanism already exists (`AGE_POLICY.blocked` in `packages/identity/age-policy.mjs`), and it removes any targeting argument.
- **(c) Operate without representatives.** The risk is a fine plus an order to appoint, for example [Locatefamily.com, €525,000](https://www.autoriteitpersoonsgegevens.nl/en/current/dutch-dpa-imposes-fine-of-eu525000-on-locatefamilycom). As currently drafted, the service displays local-currency prices (privacy.md §3) and applies a per-member-state age gate, both of which point toward targeting. **Not recommended** unless those are removed.

## 1. EU GDPR, Art. 3(2) and Art. 27

- **Trigger [Law].** The GDPR applies to a non-EU controller that offers goods or services to data subjects "in the Union", "irrespective of whether a payment … is required", or that monitors their behaviour ([GDPR Art. 3(2)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)). Recital 23 adds that "mere accessibility" of a website is not enough. Indicators of targeting are an EU language or currency with the ability to order in it, or mentioning EU customers.
- **Targeting test [Practice].** [EDPB Guidelines 3/2018](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf) §2(b), pp. 17–18, apply the Pammer/Alpenhof factors: naming the EU or a member state, EU-directed advertising, ccTLDs or .eu, EU contact details, EU testimonials, EU language or currency, and EU delivery. These are weighed in combination. Provision that is "inadvertent or incidental" is out of scope (p. 18). The test applies at the moment of offering. A service offered only outside the EU that is "not withdrawn" when its users travel into the EU is out of scope (p. 15, Example 10).
- **Free versus paid.** Free services count under Art. 3(2)(a) and EDPB p. 16.
- **Merchant of record [Inference].** Polar acting as merchant of record does not change who the controller is. 3sln decides the purposes and means of account, messaging and storage data ([Art. 4(7)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)), so 3sln is the controller. Polar is a separate controller for checkout data. If Polar's checkout shows EUR or GBP prices, that is itself a targeting indicator.
- **Obligation [Law].** Art. 27(1) requires a written designation of a representative in a member state where the targeted users are (Art. 27(3)). Supervisory authorities and data subjects can address the representative (Art. 27(4)). The controller stays liable (Art. 27(5)). The EDPB says authorities may serve corrective measures and fines through the representative (pp. 27–28).
- **Exemption [Law/Practice].** Art. 27(2)(a) exempts processing that is "occasional", involves no large-scale Art. 9 or Art. 10 data, and is unlikely to result in risk. All three conditions must hold. The EDPB reads "occasional" as "not carried out regularly, and outside the regular course of business" (p. 25).
- **Exemption applied to 3sln [Inference].** Accounts, messaging and storage are 3sln's core business, so the exemption does not fit.
- **Enforcement [Practice].** In 2021 the Dutch DPA fined Locatefamily.com €525,000 for Art. 27 alone, plus an order to appoint ([decision](https://www.autoriteitpersoonsgegevens.nl/documenten/boete-locatefamilycom)). That site published data on about 700,000 Dutch residents, which made it a high-harm case. DPAs also fine US firms that have no EU presence, for example [Clearview AI, €30.5m](https://www.autoriteitpersoonsgegevens.nl/en/current/dutch-dpa-imposes-a-fine-on-clearview-because-of-illegal-data-collection-for-facial-recognition). The GDPR also applies in Iceland, Liechtenstein and Norway through the EEA Agreement.

## 2. UK GDPR, Art. 3(2) and Art. 27, and the ICO's position

- **[Law]** The UK GDPR mirrors the EU text, with the representative located in the UK ([UK GDPR Art. 27](https://www.legislation.gov.uk/eur/2016/679/article/27)). legislation.gov.uk blocked automated fetches, so the exact current wording is unverified.
- **[Practice]** In the [ICO territorial scope knowledge hub](https://ico.org.uk/media2/migrated/4031113/ic-327905-y2y5-knowledge-hub-territorial-scope.pdf) (§3 and §4), the ICO says:
  - Targeting must be "more than just a neutral offer to the world at large", and incidental UK customers are not caught.
  - Indicators include GBP pricing, a .co.uk domain, a UK app-store listing, UK marketing and UK contacts. "One of these may well be enough".
  - Organisations should take "a cautious approach" to the occasional-processing exemption.
  - Enforcement is directed at the controller, not the representative.
- **[Practice]** This search found no published ICO penalty for a missing representative alone.

## 3. EU Digital Services Act, Art. 13

- **Hosting service [Law].** Storing information "provided by, and at the request of, a recipient" is a hosting service ([DSA Art. 3(g)(iii)](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)). 3sln's object storage and stored messages fit that definition.
- **Online platform [Law].** An online platform must disseminate to the public, meaning to "a potentially unlimited number of third parties" (Art. 3(i) and (k)). Private messaging falls outside that (Recital 14). Profiles here are private by default and shared per contact.
- **3sln's category [Inference].** 3sln is a hosting service but not an online platform, unless public links, public profiles or open channels are added.
- **Trigger [Law].** The DSA applies to providers that "offer services in the Union", which requires a "substantial connection" (Art. 3(d) and (e)). Recital 8 says that connection arises from:
  - an EU establishment;
  - a **significant number of users relative to a member state's population**; or
  - targeting, such as language, currency, a national app store, local advertising or local-language support.

  Mere technical accessibility is not enough.
- **Obligation [Law].** Art. 13 requires a written legal representative, notified to a Digital Services Coordinator. The representative can be held liable itself (Art. 13(3)).
- **No SME exemption [Law].** The micro/small enterprise exemption in Art. 19(1) covers only Section 3, the online-platform rules. Art. 13 (and Art. 11, 12, 14 and 16) apply to all intermediary or hosting providers that are in scope.
- **Free services [Inference].** The DSA covers information society services "normally provided for remuneration". A free tier of a paid service still qualifies.
- **Enforcement [Practice].** This search found no published Art. 13 penalty against a small non-EU provider.

## 4. Other regimes

- **NIS2 Art. 26 representative: not applicable.** NIS2 only covers medium or larger entities for cloud services (≥50 staff or over €10m turnover, [NIS2 Art. 2(1)](https://eur-lex.europa.eu/eli/dir/2022/2555/oj)). The size-independent categories in Art. 2(2) (DNS, TLD registries, trust services, public e-communications) don't cover 3sln. Article text recalled, not fetched.
- **ePrivacy and the EECC: no representative requirement.** Rules on confidentiality of communications apply to messaging if 3sln is in scope. Out of scope if not targeting.
- **UK Online Safety Act: no representative requirement, but it applies independently.** A user-to-user service has "links with the UK" if it has a significant number of UK users, if the UK is a target market, or if there is a material risk of significant harm to UK individuals ([OSA s.4(5)–(6)](https://www.legislation.gov.uk/ukpga/2023/50/section/4)). Private messaging is user-to-user. Ofcom fined 4chan, a US service, £20,000 for ignoring an information request ([Ofcom](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/investigation-into-4chan-and-its-compliance-with-duties-to-protect-its-users-from-illegal-content)). Blocking UK sign-ups reduces exposure under s.4(5).
- **EU AI Act: not applicable as currently scoped.** Authorised representatives are required for providers of high-risk systems (Art. 22) and of general-purpose AI models (Art. 54) ([AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)). 3sln *deploys* Cloudflare models for search and spam sorting, which is neither. Article text recalled, not fetched.

## 5. Avoiding targeting, and existing users

**[Inference]**
- Blocking sign-ups by Cloudflare country for EU27, IS, LI, NO and GB, with USD-only pricing and no EU-language or EU-directed marketing, supports a clear "not targeting" position under GDPR, UK GDPR and DSA Recital 8. It also keeps user numbers far from the "significant number" level.
- To make the block effective, remove local-currency price display for blocked countries. EU entries in the age table and EU/UK clauses in the policies are harmless once those countries are blocked.
- Existing users traveling into the EU or UK are out of scope (EDPB p. 15; ICO §3).
- Users signed up while the service was targeting the EU or UK: processing "related to" that offering arguably stays in scope for as long as they are served. Production release is disabled, so if the block ships before launch there are no such users. If any exist, counsel should decide whether to keep them (and appoint representatives) or offer export and closure.
- A geo-block can be evaded with a VPN. Keep the terms clause that prohibits misrepresenting location (terms §2).

## Gaps

- EUR-Lex and legislation.gov.uk blocked automated fetches. The GDPR and DSA articles were checked against [gdpr-info.eu](https://gdpr-info.eu/art-27-gdpr/) and [eu-digital-services-act.com](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_13.html). The OSA text came from search excerpts. The NIS2 and AI Act text is recalled.
- Whether the DSA applies in the EEA, and Polar's currency display, are unverified.

## Implemented

2026-10-22, EU-1: implemented option (b) locally as a separate frozen EU27/IS/NO/LI/GB representative block, retaining the country age entries and bootstrap exemption. Signup and onboarding reject trusted blocked locations; billing selection restricts those locations to USD. The existing signup screen displays a region-unavailable message. Availability wording is updated; GDPR rights remain. This is provisional and reversible, not counsel sign-off or production verification. Reviewer: ___ Date: ___ Outcome: ___.

2026-10-23, wargame follow-up: the block also lists the EU outermost regions geolocated under their own codes (GP, MQ, GF, RE, YT, MF) and Åland (AX), because GDPR applies there and Cloudflare does not report them as FR or FI. On the Worker an unknown location (`XX`, Tor `T1`, none) is blocked for signup and paid checkout instead of being treated as unblocked. Crown dependencies, Gibraltar and the non-EU French overseas collectivities (JE, GG, IM, GI, BL, PM, NC, PF, WF, TF) are open counsel questions in DEVLOG.md. Provisional. Reviewer: ___ Date: ___ Outcome: ___.
