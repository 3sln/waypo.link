# Device and contact file beaming (superseded)

**Superseded 2026-10-26** (provisional; user direction, not yet signed off: Reviewer ___ Date ___ Outcome ___).

Beam, the device-to-device file transfer feature, was removed from the 3sln.me core on 2026-10-26. File transfer is an application-level experience, so it becomes an application built on the generic [RTC signaling extension](rtc-signaling.md), which is designed but not implemented. The contact profile, sharing and saved-contact rules that this document also carried are kept and now live in [signed contact endpoints](../../apps/parlay/docs/legacy/contact-tokens.md#contact-profile-sharing-and-saved-contacts). The full former specification is in the git history; the last commit that contains it is `54124aa`.
