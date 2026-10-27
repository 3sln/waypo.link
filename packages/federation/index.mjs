export { FederationService, PREFERENCES, PROFILE, DESCRIPTOR } from './service.mjs';
export { FederationFault, validateSchema } from './schema.mjs';
export { MemoryMessagingStore as MemoryFederationStore } from '../core/records.mjs';

export { FederationController, federationMetadata, federationRemote } from './runtime.mjs';
export { handleFederation } from './http.mjs';
