// Core principal helpers: the canonical store key of an {iss, sub} principal and principal equality.
// Moved from packages/orgs/grants.mjs (core-scope step 1, DEVLOG 2026-10-27); the encoding is unchanged because it is
// part of stored keys (for example org/member/<principalKey>, rel/cp/<instance>/<principalKey>).
export const principalKey=principal=>encodeURIComponent(JSON.stringify([principal?.iss??null,principal?.sub]));
export const samePrincipal=(a,b)=>principalKey(a)===principalKey(b);
