// Bindle CBOR profile codec (docs/architecture/cbor-rpc-spike.md revision 2 §2, §3, §6, §7.3; provisional): vectors,
// deterministic encoding, the strict-decode rejection table, resource bounds, value types, COSE mode, fingerprints and
// seeded round-trip/mutation/truncation properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as C from '../packages/core/cbor.mjs';
import * as SDK from '../packages/sdk/src/cbor.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {randomMap,randomValue,mutate,toHex,fromHex} from './helpers/cbor-corpus.mjs';

const {encode,decode,CBORFault,BindleDecimal,NDArray,Float16Bytes}=C;
const vectors=JSON.parse(readFileSync(new URL('./vectors/cbor-profile.json',import.meta.url),'utf8'));
const TYPED={u16:Uint16Array,u32:Uint32Array,u64:BigUint64Array,i8:Int8Array,i16:Int16Array,i32:Int32Array,i64:BigInt64Array,f16:globalThis.Float16Array,f32:Float32Array,f64:Float64Array};
function expected(v){
 if(Array.isArray(v))return v.map(expected);
 if(v===null||typeof v!=='object')return v;
 if('$int' in v)return BigInt(v.$int);
 if('$bytes' in v)return fromHex(v.$bytes);
 if('$decimal' in v)return BindleDecimal.from(v.$decimal);
 if('$typed' in v){const b=fromHex(v.hex);return TYPED[v.$typed]?new TYPED[v.$typed](b.buffer,0,b.length/TYPED[v.$typed].BYTES_PER_ELEMENT):new Float16Bytes(b);}
 if('$nd' in v)return new NDArray(v.$nd,expected(v.data));
 const o=Object.create(null);for(const [k,x] of Object.entries(v))Object.defineProperty(o,k,{value:expected(x),enumerable:true,writable:true,configurable:true});return o;
}
const refuses=(hex,code,options={top:'any'})=>assert.throws(()=>decode(typeof hex==='string'?fromHex(hex):hex,options),e=>e instanceof CBORFault&&e.code===code,`${typeof hex==='string'?hex:'bytes'} → ${code}`);
const hex=v=>toHex(encode(v));

test('profile accept vectors (RFC 8949 Appendix A within the profile, numbers, decimals, typed arrays, tag 40)',()=>{
 assert.ok(vectors.accept.length>=70);
 for(const v of vectors.accept){
  const bytes=fromHex(v.hex),value=decode(bytes,{top:'any'}),want=expected(v.value);
  assert.deepStrictEqual(value,want,v.name);
  assert.equal(toHex(encode(value)),v.hex,`${v.name}: decode→encode is the identity`);
  assert.equal(toHex(encode(want)),v.hex,`${v.name}: deterministic encoding`);
 }
});

test('profile refuse vectors: one per strict-decode rule (§2.3)',()=>{
 assert.ok(vectors.refuse.length>=130);
 for(const v of vectors.refuse)refuses(v.hex,v.code);
});

test('RFC 8949 §4.2.1 deterministic encoding: shortest heads, bytewise key order, shortest floats',()=>{
 const table=[
  [0,'00'],[23,'17'],[24,'1818'],[255,'18ff'],[256,'190100'],[65535,'19ffff'],[65536,'1a00010000'],[2**32-1,'1affffffff'],[2**32,'1b0000000100000000'],
  [-24,'37'],[-25,'3818'],[-256,'38ff'],[-257,'390100'],[Number.MAX_SAFE_INTEGER,'1b001fffffffffffff'],[-Number.MAX_SAFE_INTEGER,'3b001ffffffffffffe'],
  [5n,'05'],[-5n,'24'],[2n**53n-1n,'1b001fffffffffffff'],[2n**53n,'1b0020000000000000'],[2n**64n-1n,'1bffffffffffffffff'],[-(2n**64n),'3bffffffffffffffff'],
  [2n**64n,'c249010000000000000000'],[-(2n**64n)-1n,'c349010000000000000000'],
  [1.5,'f93e00'],[-2.25,'f9c080'],[65503.5,'fa477fdf80'],[5.960464477539063e-8,'f90001'],[1.1,'fb3ff199999999999a'],[100000.5,'fa47c35040'],
  [2**53,'fa5a000000'],[1e20,'fb4415af1d78b58c40'],[Number.MIN_VALUE,'fb0000000000000001'],
  ['','60'],['a'.repeat(23),'77'+'61'.repeat(23)],['a'.repeat(24),'7818'+'61'.repeat(24)],[new Uint8Array(0),'40'],[new Uint8Array(256),'590100'+'00'.repeat(256)],
  [{b:1,a:2,aa:3},'a3616102616201626161'+'03'],[{'é':1,z:2},'a2617a0262c3a901'],[Object.assign(Object.create(null),{x:[]}),'a1617880'],
  [[true,false,null],'83f5f4f6'],
 ];
 for(const [value,want] of table)assert.equal(hex(value),want,want);
 // A safe-range bigint encodes exactly like the equal number (spike §2.6) and decodes to number.
 assert.equal(decode(encode({n:7n})).n,7);
 // Key order is by encoded bytes (length first, then UTF-8 bytes), not UTF-16 order: "z" (1 byte) < "aa" < "é" (c3 a9).
 assert.deepEqual(Object.keys(decode(fromHex(hex({'é':0,aa:0,z:0})))),['z','aa','é']);
 assert.deepEqual(Object.keys(decode(fromHex(hex({'\uffef':0,'\u{10000}':0})))),['\uffef','\u{10000}'],'UTF-8 order, where UTF-16 order would differ');
});

test('encoder refuses values outside the profile instead of dropping or coercing them',()=>{
 const bad=[undefined,NaN,Infinity,-Infinity,-0,Symbol('x'),()=>1,new Date(0),new Map(),new Set(),/x/,new ArrayBuffer(1),new DataView(new ArrayBuffer(1)),new Uint8ClampedArray(1),
  new Float32Array([NaN]),new Float64Array([1,NaN]),'﷐','\uD800','a\uDFFF',2n**1024n,-(2n**1024n)-1n,new (class X{})(),[1,,3],Object.assign([1],{extra:1}),{[Symbol('k')]:1},
  Object.defineProperty({},'g',{get:()=>1,enumerable:true}),Object.defineProperty({},'h',{value:1,enumerable:false}),{u:undefined},{'￾':1}];
 for(const v of bad)assert.throws(()=>encode(v),CBORFault,String(typeof v));
 // A cycle hits the depth bound, not the stack.
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>encode(cyclic),e=>e.code==='depth');
 // Node Buffers are byte strings.
 assert.equal(hex(Buffer.from([1,2])),'420102');
 // 2^1024-1 is the largest positive bignum (128 content bytes).
 assert.equal(encode(2n**1024n-1n).length,1+2+128);
});

test('number classification: safe integers, the ±(2^53-1) float rule and bigint boundaries (§2.2 rule 9)',()=>{
 for(const n of [Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER])assert.equal(typeof decode(encode([n]),{top:'any'})[0],'number');
 for(const n of [2n**53n,-(2n**53n),2n**63n,2n**64n-1n,-(2n**64n),2n**64n,2n**200n])assert.equal(decode(encode([n]),{top:'any'})[0],n);
 // Unsafe integral numbers are floats and stay numbers (an approximation), never silently become bigint.
 for(const n of [2**53,-(2**53),2**60,1e20,1e300]){const back=decode(encode([n]),{top:'any'})[0];assert.equal(typeof back,'number');assert.equal(back,n);}
 assert.equal(decode(fromHex('fb4415af1d78b58c40'),{top:'any'}),1e20);
 // Typed arrays: −0 and ±∞ survive exactly; scalars refuse them.
 const f=decode(encode(new Float64Array([-0,Infinity,-Infinity])),{top:'any'});assert.ok(Object.is(f[0],-0));assert.equal(f[1],Infinity);
});

test('BindleDecimal: exact parsing, normal form, no silent coercion',()=>{
 assert.equal(BindleDecimal.from('1.50').toString(),'1.5');
 assert.equal(BindleDecimal.from('-0.050').toString(),'-0.05');
 assert.equal(BindleDecimal.from('100.000'),100);
 assert.equal(BindleDecimal.from('0.0'),0);
 assert.equal(BindleDecimal.from('123456789012345678901234567890'),123456789012345678901234567890n);
 const big=BindleDecimal.from('12345678901234567890123.45');assert.equal(big.mantissa,1234567890123456789012345n);assert.equal(big.exponent,-2);
 assert.equal(hex(BindleDecimal.from('1.5')),'c482200f');
 for(const bad of ['1e5','+1','01.5','1.','.5','','1,5',' 1',`0.${'0'.repeat(1024)}1`,1.5])assert.throws(()=>BindleDecimal.from(bad),CBORFault,String(bad));
 assert.throws(()=>BindleDecimal.from('1'+'0'.repeat(400)),e=>e.code==='bignum','integral results obey the bignum bound');
 for(const [m,e] of [[10n,-1],[0n,-1],[15n,0],[15n,1],[15,-1],[15n,-1025],[15n,-1.5]])assert.throws(()=>new BindleDecimal(m,e),CBORFault);
 const d=BindleDecimal.from('2.5');
 assert.throws(()=>d+1,TypeError);assert.throws(()=>+d,TypeError);assert.throws(()=>Number(d),TypeError);assert.throws(()=>JSON.stringify({d}),TypeError);
 assert.equal(`${d}`,'2.5');assert.ok(Object.isFrozen(d));
 // The bound -1024 is accepted on both sides.
 const tiny=decode(fromHex('c4823903ff01'),{top:'any'});assert.equal(tiny.exponent,-1024);assert.equal(tiny.toString(),`0.${'0'.repeat(1023)}1`);
 assert.equal(toHex(encode(tiny)),'c4823903ff01');
 // Decimal and float of the same value are different data items.
 assert.notEqual(hex(BindleDecimal.from('1.5')),hex(1.5));
});

test('bignum bound: 128 content bytes accepted, 129 refused (§2.2 rule 3)',()=>{
 const max='c25880'+'ff'.repeat(128);assert.equal(decode(fromHex(max),{top:'any'}),2n**1024n-1n);
 refuses('c25881'+'01'+'00'.repeat(128),'bignum');
 refuses('c35881'+'01'+'00'.repeat(128),'bignum');
 assert.equal(decode(fromHex('c35880'+'ff'.repeat(128)),{top:'any'}),-(2n**1024n));
});

test('typed arrays and tag 40: little-endian tags, fresh aligned buffers, codec wrapper',()=>{
 const cases=[[new Int8Array([1,-1]),72],[new Uint16Array([1,65535]),69],[new Uint32Array([7]),70],[new BigUint64Array([2n**64n-1n]),71],[new Int16Array([-2]),77],[new Int32Array([-3]),78],[new BigInt64Array([-(2n**63n)]),79],[new Float32Array([1.5]),85],[new Float64Array([1.1]),86]];
 if(typeof Float16Array==='function')cases.push([new Float16Array([1,-1]),84]);
 for(const [array,tag] of cases){
  const bytes=encode(array),back=decode(bytes,{top:'any'});
  assert.equal(bytes[0],0xd8);assert.equal(bytes[1],tag);
  assert.equal(Object.getPrototypeOf(back),Object.getPrototypeOf(array));assert.deepStrictEqual([...back],[...array]);
  assert.equal(back.byteOffset,0);assert.equal(back.buffer.byteLength,back.byteLength);
 }
 // A view into a larger buffer encodes only its own elements.
 const base=new Uint16Array([9,1,2,9]);assert.equal(hex(base.subarray(1,3)),'d8454401000200');
 // Decoded bytes are copies, not views of the input.
 const input=encode({b:new Uint8Array([1,2,3])}),out=decode(input);input[input.length-1]=0;assert.equal(out.b[2],3);
 // Float16Bytes wrapper encodes as tag 84.
 assert.equal(hex(new Float16Bytes(fromHex('003c'))),'d85442003c');
 assert.throws(()=>new Float16Bytes(new Uint8Array(3)),CBORFault);
 assert.throws(()=>encode(new Float16Bytes(fromHex('007e'))),e=>e.code==='typed_array');
 // ndarray
 const nd=new NDArray([2,3],new Float32Array(6));assert.ok(Object.isFrozen(nd)&&Object.isFrozen(nd.shape));
 const back=decode(encode({m:nd})).m;assert.ok(back instanceof NDArray);assert.deepEqual(back.shape,[2,3]);assert.ok(back.data instanceof Float32Array);
 for(const [shape,data] of [[[],[]],[[0],[]],[[2],[1]],[[1,1,1,1,1,1,1,1,1],[1]],[[1.5],[1]],[[2],new Uint8Array(2)],[[1],'x']])assert.throws(()=>new NDArray(shape,data),CBORFault);
});

test('without a native Float16Array, tag 84 decodes to the Float16Bytes wrapper and round-trips',async()=>{
 const saved=Object.getOwnPropertyDescriptor(globalThis,'Float16Array');
 if(saved)delete globalThis.Float16Array;
 let M;try{M=await import('../packages/core/cbor.mjs?no-float16');}finally{if(saved)Object.defineProperty(globalThis,'Float16Array',saved);}
 const value=M.decode(fromHex('d85444003c00bc'),{top:'any'});
 assert.ok(value instanceof M.Float16Bytes);assert.equal(value.length,2);assert.equal(toHex(value.bytes),'003c00bc');
 assert.equal(toHex(M.encode(value)),'d85444003c00bc');
 assert.throws(()=>M.decode(fromHex('d85442007e'),{top:'any'}),e=>e.code==='typed_array');
});

test('resource bounds: lengths before allocation, depth 32, entries, items, size',()=>{
 const nest=(n,inner='80')=>'81'.repeat(n)+inner;
 assert.equal(decode(fromHex(nest(31)),{top:'any'}).length,1,'32 levels are accepted');
 refuses(nest(32),'depth');
 refuses('a16161'+nest(31),'depth',{});
 decode(fromHex('a16161'+nest(30)));
 // Tags count as a level.
 refuses(nest(32,'c482200f'),'depth');refuses(nest(32,'d85540'),'depth');refuses(nest(32,'c249010000000000000000'),'depth');
 decode(fromHex(nest(31,'c249010000000000000000')),{top:'any'});
 // Encoder mirrors the decoder's depth rule.
 let deep=[];for(let i=0;i<31;i++)deep=[deep];encode(deep);assert.throws(()=>encode([deep]),e=>e.code==='depth');
 // Entry and item caps (defaults 65,536 entries and 131,072 items; small caps here keep the test fast).
 refuses('8a'+'00'.repeat(10),'too_many_entries',{top:'any',maxEntries:9});
 refuses('a2616100616200','too_many_entries',{maxEntries:1});
 refuses('83'+'00'.repeat(3),'too_many_items',{top:'any',maxItems:3});
 decode(fromHex('83'+'00'.repeat(3)),{top:'any',maxItems:4});
 refuses(new Uint8Array(1_500_001).fill(0),'too_large',{top:'any'});
 assert.throws(()=>encode({a:'x'.repeat(100)},{maxBytes:50}),e=>e.code==='too_large');
 // Default caps at full scale: 65,537 entries refused; 131,073 items refused even when spread over containers.
 refuses('9a00010001'+'00'.repeat(65537),'too_many_entries',{top:'any'});
 refuses('83'+('9a00010000'+'00'.repeat(65536)).repeat(2)+'00','too_many_items',{top:'any'});
 assert.throws(()=>encode(new Array(65537).fill(0)),e=>e.code==='too_many_entries');
 // A typed array counts as one item however many elements it has.
 decode(encode([new Float64Array(150000)]),{top:'any',maxItems:2});
 // Length bombs fail in O(1) without allocation.
 const started=performance.now();
 for(const h of ['5bffffffffffffffff','9bffffffffffffffff','bbffffffffffffffff','7bffffffffffffffff','5a7fffffff','9a7fffffff','ba7fffffff','d8565a7fffffff','c25a7fffffff'])refuses(h,'truncated');
 assert.ok(performance.now()-started<200);
 // Top level must be a map unless the caller says otherwise.
 refuses('80','not_map',{});refuses('01','not_map',{});refuses('','not_map',{});
 assert.throws(()=>decode('a0'),TypeError);
 assert.throws(()=>decode(new Uint8Array(1),{maxItems:-1}),TypeError);
 assert.throws(()=>decode(fromHex('a0'),{top:'array'}),TypeError);
});

test('decoded maps are null-prototype objects whose keys are defined, never assigned',()=>{
 const value=decode(fromHex('a2617801695f5f70726f746f5f5fa16161f5'));
 assert.equal(Object.getPrototypeOf(value),null);
 assert.deepEqual(Object.keys(value),['x','__proto__']);
 assert.equal(Object.getPrototypeOf(value.__proto__),null);assert.equal(value.__proto__.a,true);
 assert.equal(({}).a,undefined,'no prototype pollution');
 assert.equal(value.toString,undefined);
});

test('COSE mode: top-level integer labels decode to a Map; nested maps keep the text-key rule (§2.6)',()=>{
 const header=new Map([[16,'application/vnd.bindle.integration-event+cwt'],[1,-7],[4,new TextEncoder().encode('kid-1')]]);
 const bytes=encode(header,{cose:true});
 assert.equal(toHex(bytes),'a301260445'+toHex(new TextEncoder().encode('kid-1'))+'1078'+(44).toString(16)+toHex(new TextEncoder().encode('application/vnd.bindle.integration-event+cwt')));
 const back=decode(bytes,{cose:true});assert.ok(back instanceof Map);assert.deepEqual([...back.keys()],[1,4,16]);assert.equal(back.get(1),-7);
 // Claims sets mix integer and text labels; integers sort first (major 0/1 before major 3).
 const claims=encode(new Map([['events',{}],[1,'https://issuer.example'],[-1,0]]),{cose:true});
 assert.deepEqual([...decode(claims,{cose:true}).keys()],[1,-1,'events']);
 refuses(toHex(bytes),'key_type',{});
 refuses('a1a1010202','key_type',{cose:true});
 refuses('a16161a10102','key_type',{cose:true});
 refuses('a20201010102','key_order',{cose:true});refuses('a2010101'+'02','duplicate_key',{cose:true});
 refuses('a11b002000000000000001','key_type',{cose:true});
 assert.throws(()=>encode(header),CBORFault,'Maps need cose mode');
 assert.throws(()=>encode({a:header},{cose:true}),CBORFault,'only at the top level');
 // The COSE_Sign1 outer array decodes with top:'any' (no tag 18).
 decode(encode([encode(header,{cose:true}),{},new Uint8Array(3),new Uint8Array(64)]),{top:'any'});
});

test('fingerprints: SHA-256 over domain ‖ 0x00 ‖ deterministic CBOR (§2.4)',async()=>{
 const input=C.fingerprintInput({a:1});
 assert.equal(toHex(input),toHex(new TextEncoder().encode('bindle-rpc-fingerprint-v1'))+'00'+'a1616101');
 const want=createHash('sha256').update(input).digest('hex');
 assert.equal(await C.fingerprint({a:1}),want);
 assert.equal(want,'1f5e1ff2924d8c911c1b0080ffb095e616eecb54ad4603d672445f1afa544c9a');
 const envelope={resource:'https://resource.example/r/1',addressedResource:'https://resource.example/r/1',contract:'https://contracts.example/object-storage/v1',method:'get',args:{key:'app/directory.json',data:new Uint8Array([1,2,3]),size:2n**64n},scope:{},epoch:null,resourceGeneration:null,connectionGeneration:null};
 assert.equal(await C.fingerprint(envelope),createHash('sha256').update(Buffer.concat([Buffer.from('bindle-rpc-fingerprint-v1\0'),encode(envelope)])).digest('hex'));
 assert.equal(await C.fingerprint(envelope),'d9220cb5e3d9add47d375ff5508e4a2cf28cf1cacd3667c1dde888143d71b5c9');
 // Equality semantics: same decoded value ⇒ same fingerprint; key insertion order is irrelevant; 5n and 5 agree.
 assert.equal(await C.fingerprint({b:1,a:5n}),await C.fingerprint({a:5,b:1}));
 // A byte string and its look-alike index map differ (the JSON canonical() collision).
 assert.notEqual(await C.fingerprint({d:new Uint8Array([7])}),await C.fingerprint({d:{0:7}}));
 // Decimal 1.5, float 1.5 and text "1.5" differ.
 const three=await Promise.all([BindleDecimal.from('1.5'),1.5,'1.5'].map(v=>C.fingerprint({v})));assert.equal(new Set(three).size,3);
 // Domain separation.
 assert.notEqual(await C.fingerprint({a:1},{domain:'other-domain-v1'}),await C.fingerprint({a:1}));
 for(const domain of ['','has space','nul\0','é'])assert.throws(()=>C.fingerprintInput({},{domain}),TypeError);
 assert.equal(C.sameValue({a:[1,2n]},{a:[1,2]}),true);assert.equal(C.sameValue({a:1},{a:1.5}),false);
});

test('SDK re-exports the core codec (one implementation for provider, SDK and Parlay)',()=>{
 for(const name of ['CBORFault','LIMITS','MEDIA_TYPE','RPC_FINGERPRINT_DOMAIN','BindleDecimal','Float16Bytes','NDArray','encode','decode','sameValue','fingerprintInput','fingerprint'])assert.equal(SDK[name],C[name],name);
 assert.equal(C.MEDIA_TYPE,'application/vnd.bindle.rpc+cbor');
 assert.deepEqual({...C.LIMITS},{maxBytes:1500000,maxDepth:32,maxEntries:65536,maxItems:131072,maxBignumBytes:128,minDecimalExponent:-1024,maxDimensions:8});
});

test('seeded properties: round trip, decode⇒encode identity under mutation, every truncation refused',async()=>{
 await forEachSeed(250,async r=>{
  const value=randomMap(r),bytes=encode(value),back=decode(bytes);
  assert.equal(toHex(encode(back)),toHex(bytes),'encode(decode(encode(v))) = encode(v)');
  assert.ok(C.sameValue(value,back));
  for(let i=0;i<12;i++){
   const m=mutate(r,bytes);let decoded;
   try{decoded=decode(m);}catch(error){assert.ok(error instanceof CBORFault,String(error));continue;}
   assert.equal(toHex(encode(decoded)),toHex(m),'an accepted mutation is canonical');
  }
  const cuts=bytes.length<=64?Array.from({length:bytes.length},(_,i)=>i):Array.from({length:32},()=>r.int(bytes.length));
  for(const n of cuts)assert.throws(()=>decode(bytes.subarray(0,n)),CBORFault);
 });
 // Non-map top-level values too.
 await forEachSeed(150,async r=>{const v=randomValue(r),b=encode(v);assert.equal(toHex(encode(decode(b,{top:'any'}))),toHex(b));},{base:10_001});
});

test('seeded fuzz: random byte strings never escape as anything but CBORFault',async()=>{
 await forEachSeed(3000,async r=>{
  const n=r.int(24),b=new Uint8Array(n);for(let i=0;i<n;i++)b[i]=r.chance(0.3)?r.pick([0x18,0x19,0x1a,0x1b,0x5f,0x9f,0xbf,0xff,0xf9,0xfa,0xfb,0xc2,0xc4,0xd8,0x81,0xa1,0x61]):r.int(256);
  try{const v=decode(b,{top:'any'});assert.equal(toHex(encode(v)),toHex(b));}catch(error){assert.ok(error instanceof CBORFault,String(error?.stack));}
 },{base:20_001});
});
