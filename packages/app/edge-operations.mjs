// Edge registry stays separate from the account single writer's allowlist.
import {PublicIdentityAvailable} from './domains/public-identity.mjs';
import {operations} from './engine.mjs';
import {FLAG_OPERATIONS} from './domains/flags.mjs';
export const EDGE_OPERATIONS=operations(PublicIdentityAvailable,...FLAG_OPERATIONS);
