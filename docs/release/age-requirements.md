# Signup age requirements by jurisdiction

Research snapshot 2026-10-21 (agent web research; for counsel review, not legal advice). Reviewer: ___ Date: ___ Outcome: ___

User decision (2026-10-21): per jurisdiction, require the minimum age at which a person may sign up without verifiable parental consent or mandatory age verification, enforced by a self-attestation toggle "I am older than N". Jurisdictions where a toggle cannot satisfy the law are blocked from signup.

Key points:
- GDPR Art. 8 covers consent-based processing only; paid plans need contract capacity → gate paid at majority (18; TH 20).
- DSA Art. 28 likely N/A (micro/small enterprise exclusion; not an online platform).
- Geolocation approximate; terms must require truthful country.
- Messaging extraction improves AU/UK/MS/TN position; messaging app needs own review.
- Sanctioned territories (IR, KP, SY, CU, Crimea/DNR/LNR) blocked separately (export control).

Launch availability (provisional, reversible; 2026-10-22): **EU27, Iceland, Norway, Liechtenstein and the UK are blocked for the representative reason**, independently of the age blocks. See the [representative spike](eu-uk-representative-spike.md). The country ages below are retained for a future reopening.

| Jurisdictions | Launch status |
|---|---|
| AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE | Blocked: representative |
| IS, NO, LI (EEA), GB (UK) | Blocked: representative |
| GP, MQ, GF, RE, YT, MF (EU outermost regions, TFEU Art. 349/355(1)); AX (Åland, Art. 355(4)) | Blocked: representative |
| Unknown location: Cloudflare `XX`, Tor `T1`, or no country | Blocked on the Worker (`region-unknown`); Node follows `REGION_POLICY` |

Territories added 2026-10-23 (wargame, provisional, reversible): Cloudflare geolocates EU outermost regions and Åland under their own ISO 3166-1 codes, not FR/FI, so the block lists them explicitly; their retained ages follow France (15) and Finland (13). Crown dependencies (JE, GG, IM), Gibraltar (GI), and French overseas collectivities and territories outside the EU (BL, PM, NC, PF, WF, TF) are open counsel questions in DEVLOG.md; they are not blocked. Reviewer: ___ Date: ___ Outcome: ___

Unknown locations (2026-10-23, provisional): on the Worker (3sln.me), an unknown country (`XX`), Tor (`T1`) or a missing country fails closed for signup and paid checkout with a distinct "region couldn't be determined" message (`REGION_POLICY=block-unknown`, the default; `allow-unknown` is the default only for local development on a loopback `http` origin). A self-hosted Node server owns its own representative policy: `REGION_POLICY` defaults to `allow-unknown`, and a country is known only from an operator-configured `TRUSTED_COUNTRY_HEADER` set by the operator's reverse proxy. The proxy must overwrite that header, never append to it; a present but invalid value (for example duplicates joined by an appending proxy) is treated as unknown (`XX`). Client-sent country headers are always ignored.

Paid checkouts (2026-10-23 review, provisional): person checkout, organization creation, renewal, billing-lapse claim and ownership-transfer acceptance checkouts, and the anonymous redirect-extension purchase all require a fresh paid-age attestation from a location the region policy permits. The organization break-glass checkout is now routed as `POST /api/orgs/:id/break-glass-checkout` and passes the same `PaidCheckoutAllowed` gate before dispatch (implemented locally; no live checkout verification).

Recommended config:
```json
{
  "default": 18,
  "countries": {
    "AT":14,"BE":13,"BG":14,"HR":16,"CY":14,"CZ":15,"DK":13,"EE":13,"FI":13,"FR":15,
    "DE":16,"GR":15,"HU":16,"IE":16,"IT":14,"LV":13,"LT":14,"LU":16,"MT":13,"NL":16,
    "PL":16,"PT":13,"RO":16,"SK":16,"SI":15,"ES":16,"SE":13,"IS":13,"NO":13,"LI":16,
    "GB":13,"CH":16,"US":13,"CA":13,"AU":16,"NZ":16,"JP":16,"KR":14,"SG":13,
    "IN":18,"MX":18,"AR":18,"ZA":18,"AE":18,"SA":18,"PH":18,"VN":18,"TH":20,"MY":18,"IL":18,
    "GP":15,"MQ":15,"GF":15,"RE":15,"YT":15,"MF":15,"AX":13
  },
  "representativeBlocked": ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","NO","LI","GB","GP","MQ","GF","RE","YT","MF","AX"],
  "blocked": ["CN","BR","ID","TR","RU","IR","KP","SY","CU"],
  "regions": { "CA-QC":14,"US-TX":18,"US-FL":18,"US-NE":18,"US-UT":18,"US-AR":18,"US-LA":18,"US-GA":18,"US-OH":18,"US-VA":18,"US-ID":18,"US-IL":18,"US-SC":18 },
  "blockedRegions": ["US-MS","US-TN","UA-43","UA-40","UA-14","UA-09"]
}
```
Uncertain: ES (16 ahead of bill), CH, AU, NZ, MX, AR, IL, VN, AE, TR, ID, TN, state hedges.
Block rationale: BR ECA Digital bans self-declaration (in force 17 Mar 2026); ID PP Tunas; CN real-name; TR under-15 e-Devlet verification from 1 Nov 2026; RU localisation/sanctions; US-MS HB1126 all-user age verification; US-TN HB1891.
UK: blocked at launch for the representative reason; before reopening at 13, complete OSA children's access + risk assessments and terms prohibiting primary priority content. AU: allow 16, record eSafety self-assessment.
Re-check dates: GR vote 22 Oct 2026; TR 1 Nov 2026; ANPD sanctions Nov 2026; AU children's code 10 Dec 2026; CA AB1043 1 Jan 2027; UAE ~Jan 2027; IN Rule 10 13 May 2027; UT app store 6 May 2027; 5th Cir MS ruling; 6th Cir TN remand.

Principal sources: Mayer Brown (Brazil ECA Digital, Apr 2026); eSafety social media age restrictions and FAQs; DLA Piper (Australia SMMA, Feb 2026; Virginia, Mar 2026); Baker McKenzie (Australia children's privacy code, May 2026; Japan APPI reform, May 2026); dpdprules.org Rule 10; IAPP and HB1126 text (Mississippi); DataGuidance (Tennessee); 11th Circuit opinion (Florida HB3); InfoLawGroup (Texas SB2420); Wiley (Utah ASAA); Cooley (California AADC, Mar 2026); Orrick tracker (Nebraska); Bird & Bird (Denmark); Congreso BOCG (Spain); EU KIDS Act proposal COM(2026) 681; Hogan Lovells and uaelegislation.gov.ae (UAE); Tilleke & Gibbins (Vietnam); Al Jazeera (Turkey, Apr 2026); NPC Advisory 2024-03 (Philippines). Several entries rely on secondary or vendor sources and are marked uncertain.
