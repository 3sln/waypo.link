// Edge registry stays separate from the account single writer's allowlist.
import {operations} from './engine.mjs';
import {FLAG_OPERATIONS} from './domains/flags.mjs';
export const EDGE_OPERATIONS=operations(...FLAG_OPERATIONS);
