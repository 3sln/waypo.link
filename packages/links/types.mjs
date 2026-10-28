// Core links: the link-type table (docs/architecture/messaging-extraction.md C1; docs/spec/messaging.md §4.2).
// Core may not import Parlay, so app link types are named here by URI. Each binding maps one link type to
// the provider-consumed field whose current value may issue, list, evaluate and revoke it through the links contract, plus the
// exact type-specific meta member set the provider validates before signing. CONTACT_LINK_TYPE names the legacy core
// contact type, whose issuer (ContactEndpointService on `contact-grant` parents) left the core with messaging on
// 2026-10-27; it has no binding, so nothing mints or verifies it any more.
import { boundedString, mimeValid } from '../core/records.mjs';

export const CONTACT_LINK_TYPE = 'https://spec.bindle.example/links/contact/v1';
// Placeholder identifiers under spec.bindle.example until publication authority is agreed (messaging-protocol/constants.mjs).
// Extensions rev 3.2 (CR-X3-26): the former messaging-ingress slot, republished as an ordinary fragment at a new URL.
export const MESSAGING_INGRESS_FRAGMENT = 'https://spec.bindle.example/fragments/messaging-ingress/v1';
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

// BB-C1b: the handoff. The `messaging-address` provider feature resolves a link of a bound type to the current value of
// the binding's field (messaging.md §2.1, §2.3). Placeholders under spec.bindle.example.
// Extensions rev 3.2 (§11.1, CR-X3-26): the former public-message-intake slot, republished as the intake fragment.
export const PUBLIC_INTAKE_FRAGMENT = 'https://spec.bindle.example/fragments/public-intake/v1';
/** The public-intake contract a resource in the intake field serves (`deliver`). Core consumers (brokered records, the
 * email bridge) depend on the field and this contract, never on a particular messaging app or its flag. */
export const PUBLIC_INTAKE_CONTRACT = 'https://spec.bindle.example/contracts/public-intake/v1';
export const MESSAGING_PROFILE = 'https://spec.bindle.example/messaging/v1';
export const DESCRIPTOR_MEDIA_TYPE = 'application/vnd.bindle.messaging.ingress+json';
/** Link type -> field fragment, the reviewed registration table (messaging.md §4.2). */
export const LINK_FRAGMENT_TABLE = Object.freeze(Object.entries(LINK_TYPE_BINDINGS).map(([type, binding]) => Object.freeze({ type, fragment: binding.fragment })));
export const linkFragment = type => linkBinding(type)?.fragment ?? null;
