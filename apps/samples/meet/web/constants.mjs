// Constants shared by Meet's browser app and its metadata (sample-only).
export const SIGNALING_FRAGMENT='https://spec.bindle.example/fragments/signaling/v1';
export const SIGNALING_CONTRACT='https://spec.bindle.example/contracts/signaling/v1';
export const SIGNALING_METHODS=Object.freeze(['register','unregister','endpoints','open','offer','revoke_offer','claim','send','renew','listen']);
/** Meet's sample session kind (a call with someone invited to a meeting). */
export const CALL_KIND='https://meet.example/kinds/call/v1';
