// The identity's app-grant epoch as a dependency-free function, for grant stores that must not import the federation
// runtime (MCP shards). It MUST equal `federationEpoch` (packages/runtime/federation.mjs): it changes with the recovery
// credential and with `federationGeneration` (recovery start, reissue confirmation or cancellation, suspension), so a
// grant minted under one epoch never outlives an authority reset. tests/mcp-authority-epoch.test.mjs pins the equality.
import {digest} from '../messaging/store.mjs';
export async function authorityGrantEpoch(account){const generation=account.federationGeneration;return digest(crypto,`bindle-account-authority-v1\0${account.assignmentId??account.id}\0${account.recoveryHash??''}${Number.isSafeInteger(generation)&&generation>0?'\0g'+generation:''}`);}
