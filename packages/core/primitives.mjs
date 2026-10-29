// Shared value primitives. Portable and side-effect free: no platform API, no
// storage. Public build source (jstools.config.mjs) because shared client/server
// modules import it. The SDK keeps standalone copies: it ships as standalone bundles.

import {encode,BindleDecimal,NDArray,Float16Bytes} from './cbor.mjs';

// Lowercase hyphenated UUID of any version.
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Lowercase RFC 9562 version 4 UUID, as crypto.randomUUID() produces.
export const UUID_V4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const isUUID=value=>typeof value==='string'&&UUID.test(value);
export const isUUIDv4=value=>typeof value==='string'&&UUID_V4.test(value);

// Deterministic JSON for fingerprints and digests: object keys sorted by code
// unit, arrays in order, everything else as JSON.stringify encodes it (so an
// undefined member encodes as `undefined`, not `null`). Changing these rules
// changes every stored fingerprint.
// CBOR phase 2 (spike §6 item 3): values only the Bindle CBOR profile carries no longer collide with JSON look-alikes
// or throw. A safe-range bigint renders as the equal number (the codec's one normalization); a byte string, typed
// array, decimal, ndarray or unsafe bigint renders as `c'<hex of its deterministic CBOR>'`, which no JSON value
// produces. Every value the JSON rules could already render keeps its exact rendering, so stored fingerprints of
// JSON-era values are unchanged.
const hexBytes=bytes=>{let out='';for(const b of bytes)out+=b.toString(16).padStart(2,'0');return out;};
const cborToken=value=>`c'${hexBytes(encode(value))}'`;
export const canonical=value=>{
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(typeof value==='bigint')return value>=-9007199254740991n&&value<=9007199254740991n?String(value):cborToken(value);
 if(value&&typeof value==='object'){const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null&&(ArrayBuffer.isView(value)||value instanceof BindleDecimal||value instanceof NDArray||value instanceof Float16Bytes))return cborToken(value);}
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
};
