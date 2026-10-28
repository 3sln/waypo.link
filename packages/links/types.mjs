// Core links: the link-type table (docs/architecture/messaging-extraction.md C1; docs/spec/messaging.md §4.2).
// Core may not import Parlay, so app link types are named here by URI. Each binding maps one link type to
// the provider-consumed field whose current value may issue, list, evaluate and revoke it through the links contract, plus the
// exact type-specific meta member set the provider validates before signing. CONTACT_LINK_TYPE names the legacy core
// contact type, whose issuer (ContactEndpointService on `contact-grant` parents) left the core with messaging on
// 2026-10-27; it has no binding, so nothing mints or verifies it any more.
import { boundedString, mimeValid } from '../core/records.mjs';
// Contacts spike CR-C0: the messaging-ingress fragment and the messaging profile live with key delegation
// (packages/identity/messaging-ingress.mjs, also a public browser module for this file); re-exported here for the link
// modules until CR-C1 removes them. The public-intake constants moved to the email bridge (packages/email-bridge/wire.mjs).
import { MESSAGING_INGRESS_FRAGMENT, MESSAGING_PROFILE } from '../identity/messaging-ingress.mjs';
export { MESSAGING_INGRESS_FRAGMENT, MESSAGING_PROFILE };

export const CONTACT_LINK_TYPE = 'https://spec.bindle.example/links/contact/v1';
// Placeholder identifiers under spec.bindle.example until publication authority is agreed (messaging-protocol/constants.mjs).
export const MESSAGING_CONTACT_LINK_TYPE = 'https://spec.bindle.example/messaging/v1/links/contact';
export const LINKS_CONTRACT = 'https://spec.bindle.example/contracts/links/v1';

const KINDS = ['conversation-init', 'one-off'];
const kindsValid = kinds => Array.isArray(kinds) && kinds.length > 0 && kinds.length <= KINDS.length && kinds.every((kind, i) => KINDS.includes(kind) && (i === 0 || kinds[i - 1] < kind));
const intIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
// messaging.md §4.1: the common members plus sub/resource/kinds/mime/quota members; `audience` is provider-built.
const messagingContact = Object.freeze({
  fragment: MESSAGING_INGRESS_FRAGMENT,
  // Links stay on the provider origin under the contact path, so the landing route and an app switch keep them.
  path: (handle, jti) => `/users/${encodeURIComponent(handle)}/contact/${encodeURIComponent(jti)}`,
  members: Object.freeze(['resource', 'kinds', 'mimeTypes', 'maxMessages', 'maxBytes', 'maxMessageBytes']),
  conditional: true,
  valid: claims => boundedString(claims.resource, 128) && kindsValid(claims.kinds) && Array.isArray(claims.mimeTypes) && claims.mimeTypes.length > 0 && claims.mimeTypes.length <= 32 && claims.mimeTypes.every(mimeValid) && new Set(claims.mimeTypes).size === claims.mimeTypes.length && intIn(claims.maxMessages, 1, 100000) && intIn(claims.maxBytes, 1, 1073741824) && intIn(claims.maxMessageBytes, 1, 10485760) && claims.maxMessageBytes <= claims.maxBytes,
});

/** Link type URI -> {fragment, path(handle, jti), members, conditional, valid(claims)}. Append-only; a binding is a reviewed change. */
export const LINK_TYPE_BINDINGS = Object.freeze(Object.assign(Object.create(null), { [MESSAGING_CONTACT_LINK_TYPE]: messagingContact }));
export const linkBinding = type => (typeof type === 'string' && Object.hasOwn(LINK_TYPE_BINDINGS, type) ? LINK_TYPE_BINDINGS[type] : null);

// BB-C1b: the handoff (links/handoff.mjs). A link of a bound type resolves to the current value of the binding's field,
// described through the messaging-mailbox provider feature (Bindle Messaging §2.5; the 3sln.me messaging-address
// feature it replaced is withdrawn). Kept until contacts spike phase 4. Placeholders under spec.bindle.example.
export const DESCRIPTOR_MEDIA_TYPE = 'application/vnd.bindle.messaging.ingress+json';
/** Link type -> field fragment, the reviewed registration table (messaging.md §4.2). */
export const LINK_FRAGMENT_TABLE = Object.freeze(Object.entries(LINK_TYPE_BINDINGS).map(([type, binding]) => Object.freeze({ type, fragment: binding.fragment })));
export const linkFragment = type => linkBinding(type)?.fragment ?? null;
