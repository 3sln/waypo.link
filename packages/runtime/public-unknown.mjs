// U404: HTTP serialization only. Owner/account engines retain their lifecycle faults.
// Boundary (app-uninstall §7.5a): credential validity is answered first with the standard protocol refusal
// (401/400 invalid_grant/invalid_token/invalid_client, WWW-Authenticate), which reveals nothing about targets.
// Only then does an unknown, deleted, deleting, suspended or moved TARGET answer the uniform 404.
// A credential whose own subject has such a lifecycle fault is simply an invalid credential (never 404/410).
export const lifecycleUnknown=error=>error?.status===410||['account_deleting','account_deleted','account_suspended','account_moved'].includes(error?.code);
// Target lookups: a lifecycle-faulted target or a missing addressed resource. Credential errors are excluded.
export const lookupUnknown=error=>lifecycleUnknown(error)||error?.status===404||['not_found','conversation_not_found'].includes(error?.code);
// Signed contact links and contact-delivery tokens address their target identity (the link is the target), so a
// refused link is the same target lookup as an unknown identity on those routes only.
export const contactUnknown=error=>lookupUnknown(error)||['link_invalid','unauthorized'].includes(error?.code);
