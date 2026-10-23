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

Recommended config:
```json
{
  "default": 18,
  "countries": {
    "AT":14,"BE":13,"BG":14,"HR":16,"CY":14,"CZ":15,"DK":13,"EE":13,"FI":13,"FR":15,
    "DE":16,"GR":15,"HU":16,"IE":16,"IT":14,"LV":13,"LT":14,"LU":16,"MT":13,"NL":16,
    "PL":16,"PT":13,"RO":16,"SK":16,"SI":15,"ES":16,"SE":13,"IS":13,"NO":13,"LI":16,
    "GB":13,"CH":16,"US":13,"CA":13,"AU":16,"NZ":16,"JP":16,"KR":14,"SG":13,
    "IN":18,"MX":18,"AR":18,"ZA":18,"AE":18,"SA":18,"PH":18,"VN":18,"TH":20,"MY":18,"IL":18
  },
  "representativeBlocked": ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","NO","LI","GB"],
  "blocked": ["CN","BR","ID","TR","RU"],
  "regions": { "CA-QC": 14 },
  "usRegions": { "TX":18,"FL":18,"NE":18,"UT":18,"AR":18,"LA":18,"GA":18,"OH":18,"VA":18,"ID":18,"IL":18,"SC":18 },
  "blockedRegions": ["US-MS","US-TN"]
}
```
Uncertain: ES (16 ahead of bill), CH, AU, NZ, MX, AR, IL, VN, AE, TR, ID, TN, state hedges.
Block rationale: BR ECA Digital bans self-declaration (in force 17 Mar 2026); ID PP Tunas; CN real-name; TR under-15 e-Devlet verification from 1 Nov 2026; RU localisation/sanctions; US-MS HB1126 all-user age verification; US-TN HB1891.
UK: blocked at launch for the representative reason; before reopening at 13, complete OSA children's access + risk assessments and terms prohibiting primary priority content. AU: allow 16, record eSafety self-assessment.
Re-check dates: GR vote 22 Oct 2026; TR 1 Nov 2026; ANPD sanctions Nov 2026; AU children's code 10 Dec 2026; CA AB1043 1 Jan 2027; UAE ~Jan 2027; IN Rule 10 13 May 2027; UT app store 6 May 2027; 5th Cir MS ruling; 6th Cir TN remand.

Principal sources: Mayer Brown (Brazil ECA Digital, Apr 2026); eSafety social media age restrictions and FAQs; DLA Piper (Australia SMMA, Feb 2026; Virginia, Mar 2026); Baker McKenzie (Australia children's privacy code, May 2026; Japan APPI reform, May 2026); dpdprules.org Rule 10; IAPP and HB1126 text (Mississippi); DataGuidance (Tennessee); 11th Circuit opinion (Florida HB3); InfoLawGroup (Texas SB2420); Wiley (Utah ASAA); Cooley (California AADC, Mar 2026); Orrick tracker (Nebraska); Bird & Bird (Denmark); Congreso BOCG (Spain); EU KIDS Act proposal COM(2026) 681; Hogan Lovells and uaelegislation.gov.ae (UAE); Tilleke & Gibbins (Vietnam); Al Jazeera (Turkey, Apr 2026); NPC Advisory 2024-03 (Philippines). Several entries rely on secondary or vendor sources and are marked uncertain.
