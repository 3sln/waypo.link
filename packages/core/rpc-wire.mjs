// Bindle RPC wire (docs/spec/protocol.md §5, docs/spec/cbor.md; CBOR spike revision 2 §4, phases 2-4). Every Bindle RPC
// envelope, result/error envelope and route-level error on an RPC endpoint is one Bindle CBOR map sent as
// `application/vnd.bindle.rpc+cbor` (owner-approved 2026-10-28: media type, envelope version "0", clean break with no
// JSON fallback, 1,500,000 encoded-byte bound). The bound is checked on the encoded bytes while reading and before the
// strict decoder runs; decoding refuses every non-canonical or out-of-profile form (packages/core/cbor.mjs) before any
// value reaches validation, authorization or the journal. Pure and runtime-neutral: Workers, browsers and Node. The
// SDK re-exports it (packages/sdk/src/rpc-wire.mjs). Faults never echo decoded values or bytes (spike §6 item 7).
import {MEDIA_TYPE,CBORFault,encode,decode} from './cbor.mjs';

export const RPC_MEDIA_TYPE=MEDIA_TYPE;
export const RPC_MAX_BYTES=1_500_000;
/** Headers on every RPC body a provider or integration generates (spike §4.1). */
export const RPC_RESPONSE_HEADERS=Object.freeze({'Content-Type':MEDIA_TYPE,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});

export class RPCWireFault extends Error{constructor(code,message,status){super(message);this.name='RPCWireFault';this.code=code;this.status=status;}}
const wireFault=(code,message,status)=>{throw new RPCWireFault(code,message,status);};

/** True for exactly the RPC media type (parameters ignored, as for the JSON type before the break). */
export const isRPCMediaType=value=>typeof value==='string'&&value.split(';')[0].trim().toLowerCase()===MEDIA_TYPE;

/** Reads a request or response body up to `maxBytes` encoded bytes, refusing early on a larger Content-Length and while
 * streaming (413 `body_too_large`). Returns a fresh Uint8Array. */
export async function readBoundedBytes(message,maxBytes=RPC_MAX_BYTES){
 const declared=message.headers?.get?.('Content-Length');
 if(declared!=null&&/^\d+$/.test(declared)&&Number(declared)>maxBytes){await message.body?.cancel?.().catch(()=>{});wireFault('body_too_large','The message is too large.',413);}
 if(!message.body?.getReader){const bytes=new Uint8Array(await message.arrayBuffer());if(bytes.byteLength>maxBytes)wireFault('body_too_large','The message is too large.',413);return bytes;}
 const reader=message.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel().catch(()=>{});wireFault('body_too_large','The message is too large.',413);}chunks.push(value);}}
 finally{try{reader.releaseLock();}catch{}}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
}

/** Strictly decodes RPC bytes to a map. Maps decode as Object.prototype objects with defined members (`objects:
 * 'plain'`), the shape handlers had under JSON.parse; `__proto__` stays data. Any profile violation is 400. */
export function decodeRPC(bytes,{maxBytes=RPC_MAX_BYTES}={}){
 if(!(bytes instanceof Uint8Array))wireFault('invalid_request','The request is not valid Bindle CBOR.',400);
 if(bytes.byteLength>maxBytes)wireFault('body_too_large','The message is too large.',413);
 try{return decode(bytes,{top:'map',objects:'plain',maxBytes});}
 catch(error){if(error instanceof CBORFault)wireFault('invalid_request','The request is not valid Bindle CBOR.',400);throw error;}
}

/** Encodes an RPC value (envelope, result/error envelope, route error). Object members whose value is undefined are
 * omitted, as the JSON transport did; anything else outside the profile throws. `maxBytes` bounds the encoding. */
export function encodeRPC(value,{maxBytes=RPC_MAX_BYTES}={}){
 const bytes=encode(value,{omitUndefined:true});
 if(bytes.byteLength>maxBytes)wireFault('result_too_large','The result is too large.',500);
 return bytes;
}
/** The encoded size of a value under the RPC encoding, for the result bound (spike §4.3). */
export const encodedSize=value=>encode(value,{omitUndefined:true}).byteLength;

/** Request side of a provider or integration RPC route: 415 for any other media type (JSON included: no dual stack),
 * 413 beyond the bound (checked on encoded bytes before decoding), 400 for any strict-decoding refusal. */
export async function readRPCRequest(request,{maxBytes=RPC_MAX_BYTES}={}){return (await readRPCRequestBytes(request,{maxBytes})).envelope;}
/** As readRPCRequest, also returning the received bytes (already verified canonical) for a cross-isolate hop. */
export async function readRPCRequestBytes(request,{maxBytes=RPC_MAX_BYTES}={}){
 if(!isRPCMediaType(request.headers.get('Content-Type')))wireFault('unsupported_media_type',`Use ${MEDIA_TYPE}.`,415);
 if(!request.body)wireFault('invalid_request','Request body required.',400);
 const bytes=await readBoundedBytes(request,maxBytes);return {bytes,envelope:decodeRPC(bytes,{maxBytes})};
}

/** A CBOR response. A value the profile cannot encode is an internal fault answered as a CBOR 500, never a JSON body. */
export function rpcResponse(value,status=200,headers={}){
 let bytes;
 try{bytes=encodeRPC(value);}catch{bytes=encodeRPC({error:'internal_error',message:'We could not complete this request. Please try again.'});status=500;}
 return new Response(bytes,{status,headers:{...headers,...RPC_RESPONSE_HEADERS}});
}
/** A route-level RPC error `{error, message}` (spike §4.2). */
export const rpcError=(code,message,status,headers={})=>rpcResponse(message===undefined?{error:code}:{error:code,message},status,headers);

/** Values cross isolates (route → Durable Object) as encoded bytes (spike §2.6): a structured clone would turn a
 * BindleDecimal, NDArray or Float16Bytes into a look-alike plain object. Receivers accept either form. */
export const rpcEnvelope=value=>value instanceof Uint8Array?decodeRPC(value):value;

/** Client side: a fetch init for one envelope. */
export const rpcRequestInit=envelope=>({body:encodeRPC(envelope),headers:{'Content-Type':MEDIA_TYPE,Accept:MEDIA_TYPE}});

/** Client side: reads a provider or integration response. Only a response whose Content-Type is the RPC type is
 * decoded (a platform page, for example a CDN 502, is a transport failure); bounded and strict. */
export async function readRPCResponse(response,{maxBytes=RPC_MAX_BYTES}={}){
 if(!isRPCMediaType(response.headers?.get?.('Content-Type')??'')){await response.body?.cancel?.().catch(()=>{});wireFault('transport_failure','The provider response is not a Bindle RPC response.',502);}
 return decodeRPC(await readBoundedBytes(response,maxBytes),{maxBytes});
}
