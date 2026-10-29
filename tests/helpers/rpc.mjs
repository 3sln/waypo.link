// Test helpers for the Bindle CBOR RPC transport (protocol §5, packages/core/rpc-wire.mjs). Tests build requests and
// read responses through the real codec, so a test can never pass on a JSON body the endpoints no longer accept.
import {RPC_MEDIA_TYPE,encodeRPC,decodeRPC,isRPCMediaType,rpcResponse} from '../../packages/core/rpc-wire.mjs';
import {decode} from '../../packages/core/cbor.mjs';

export {RPC_MEDIA_TYPE,encodeRPC,decodeRPC,rpcResponse};

/** Headers for one RPC request (merged with `extra`, e.g. Authorization, DPoP, Origin). */
export const rpcHeaders=(extra={})=>({'Content-Type':RPC_MEDIA_TYPE,Accept:RPC_MEDIA_TYPE,...extra});
/** A fetch/Request init for one envelope. */
export const rpcInit=(envelope,headers={},init={})=>({method:'POST',...init,headers:rpcHeaders(headers),body:encodeRPC(envelope)});
/** A Request for one envelope. */
export const rpcRequest=(url,envelope,headers={},init={})=>new Request(url,rpcInit(envelope,headers,init));
/** Decodes a response (or Request) body: CBOR when it carries the RPC media type, else JSON when possible, else text. */
export async function readBody(message){
 const type=message.headers.get('Content-Type')??'',bytes=new Uint8Array(await message.arrayBuffer());
 if(isRPCMediaType(type))return decode(bytes,{top:'any',objects:'plain'});
 const text=new TextDecoder().decode(bytes);try{return JSON.parse(text);}catch{return text;}
}
/** The decoded body of an RPC response, asserting its media type. */
export async function rpcBody(response){
 if(!isRPCMediaType(response.headers.get('Content-Type')??''))throw new Error(`Expected a Bindle RPC response, got ${response.status} ${response.headers.get('Content-Type')}: ${await response.text()}`);
 return decode(new Uint8Array(await response.arrayBuffer()),{top:'any',objects:'plain'});
}
/** Decodes a request body a fake fetcher received (Uint8Array/ArrayBuffer/string). */
export function requestEnvelope(body){
 if(body instanceof Uint8Array)return decodeRPC(body);
 if(body instanceof ArrayBuffer)return decodeRPC(new Uint8Array(body));
 throw new Error('Expected a CBOR RPC request body.');
}
/** A minimal fake-fetch response carrying CBOR (for SDK unit tests with hand-rolled fetchers). */
export const rpcReply=(value,status=200,headers={})=>rpcResponse(value,status,headers);
/** Test adapter: a response whose body is Bindle CBOR answers `.json()` with the strictly decoded value (and `.clone()`
 * keeps that), so fixtures written against the JSON transport read the CBOR transport through the real codec. A
 * response of any other type is returned unchanged; nothing is decoded leniently. */
export function rpcAware(response){
 if(!response||!isRPCMediaType(response.headers?.get?.('Content-Type')??''))return response;
 const clone=response.clone.bind(response);
 Object.defineProperties(response,{json:{configurable:true,value:()=>rpcBody(response)},clone:{configurable:true,value:()=>rpcAware(clone())}});
 return response;
}
/** Request-side counterpart for fixtures: the init for `path` with `data`, CBOR on /bindle/rpc, JSON elsewhere. */
export const bodyInit=(path,data)=>data===undefined?{headers:{},body:undefined}:path==='/bindle/rpc'||path.endsWith('/bindle/rpc')?{headers:{'Content-Type':RPC_MEDIA_TYPE,Accept:RPC_MEDIA_TYPE},body:encodeRPC(data)}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};
