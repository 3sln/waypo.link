// Bindle RPC wire for SDK users and integrations (docs/spec/protocol.md §5; provisional). One source of truth,
// re-exported from packages/core/rpc-wire.mjs as packages/sdk/src/cbor.mjs re-exports the codec, so the SDK, the provider
// and integrations read and write exactly the same bytes. Parlay imports it from here only.
export {RPC_MEDIA_TYPE,RPC_MAX_BYTES,RPC_RESPONSE_HEADERS,RPCWireFault,isRPCMediaType,readBoundedBytes,decodeRPC,encodeRPC,encodedSize,readRPCRequest,readRPCRequestBytes,rpcResponse,rpcError,rpcEnvelope,rpcRequestInit,readRPCResponse} from '../../core/rpc-wire.mjs';
