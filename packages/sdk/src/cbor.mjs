// Bindle CBOR profile codec for SDK users and integrations (docs/architecture/cbor-rpc-spike.md §4.5; provisional).
// One source of truth: re-exported from packages/core/cbor.mjs, as packages/core/ip-address.mjs is re-exported by
// item-classification-fetch.mjs, so the SDK and the provider can never disagree on what a message means. The core module
// is pure and imports nothing, so standalone SDK bundles stay self-contained. Parlay imports it from here only.
export {CBORFault,LIMITS,MEDIA_TYPE,RPC_FINGERPRINT_DOMAIN,BindleDecimal,Float16Bytes,NDArray,encode,decode,sameValue,fingerprintInput,fingerprint} from '../../core/cbor.mjs';
