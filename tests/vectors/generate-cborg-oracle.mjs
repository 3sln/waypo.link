// Regenerates tests/vectors/cbor-cborg-oracle.json: cborg's strict-mode verdicts and RFC 8949 re-encodings for a seeded
// corpus of Bindle-profile encodings and their mutations. cborg is NOT vendored (its licence is Apache-2.0 only, while the
// repository vendors MIT snapshots; see the fixture's provenance note) and is never imported by runtime, SDK or test
// code: this offline script loads an unpacked registry tarball from a path the developer supplies, and the checked-in
// fixture holds only hex inputs and cborg's outputs.
//
//   curl -sSLO https://registry.npmjs.org/cborg/-/cborg-6.2.0.tgz && tar xzf cborg-6.2.0.tgz
//   node tests/vectors/generate-cborg-oracle.mjs ./package
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encode} from '../../packages/core/cbor.mjs';
import {createRandom,randomMap,mutate,toHex} from '../helpers/cbor-corpus.mjs';

const dir=resolve(process.argv[2]??'');
const pkg=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));
// The pinned integrity below belongs to this version; update both together.
if(pkg.name!=='cborg'||pkg.version!=='6.2.0')throw new Error('Expected an unpacked cborg 6.2.0 tarball.');
const cborg=await import(pathToFileURL(resolve(dir,'cborg.js')).href),T=await import(pathToFileURL(resolve(dir,'lib/taglib.js')).href);
const tags=[];tags[2]=T.bigIntDecoder;tags[3]=T.bigNegIntDecoder;
for(const [tag,name] of [[69,'uint16'],[70,'uint32'],[71,'bigUint64'],[72,'int8'],[77,'int16'],[78,'int32'],[79,'bigInt64'],[85,'float32'],[86,'float64']])tags[tag]=T[name+'ArrayDecoder'];
const decodeOptions={strict:true,allowIndefinite:false,allowUndefined:false,allowNaN:false,allowInfinity:false,rejectDuplicateMapKeys:true,strictUtf8:true,tags};
const typeEncoders={bigint:T.bigIntEncoder,Int8Array:T.int8ArrayEncoder,Uint16Array:T.uint16ArrayEncoder,Uint32Array:T.uint32ArrayEncoder,BigUint64Array:T.bigUint64ArrayEncoder,Int16Array:T.int16ArrayEncoder,Int32Array:T.int32ArrayEncoder,BigInt64Array:T.bigInt64ArrayEncoder,Float32Array:T.float32ArrayEncoder,Float64Array:T.float64ArrayEncoder};
const encodeOptions={...cborg.rfc8949EncodeOptions,typeEncoders};

const cases=[];const seen=new Set();
const add=(bytes,origin)=>{const hex=toHex(bytes);if(seen.has(hex))return;seen.add(hex);
 let value,record={hex,origin};
 try{value=cborg.decode(bytes,decodeOptions);}catch(error){cases.push({...record,accept:false,error:String(error.message).slice(0,120)});return;}
 let reencoded=null;try{reencoded=toHex(cborg.encode(value,encodeOptions));}catch(error){record.encodeError=String(error.message).slice(0,120);}
 cases.push({...record,accept:true,reencoded});
};
const SEEDS=150,MUTATIONS=6;
for(let seed=1;seed<=SEEDS;seed++){
 const r=createRandom(seed),bytes=encode(randomMap(r,{oracle:true}));add(bytes,`seed:${seed}`);
 for(let m=0;m<MUTATIONS;m++)add(mutate(r,bytes),`seed:${seed}:mutation:${m}`);
}
// Profile rules stricter than cborg's strict mode: cborg is expected to accept these and the Bindle codec to refuse them
// with the code after "profile:" (tests/cbor-oracle.test.mjs checks both verdicts).
const PROFILE_ONLY=[
 ['non_shortest','a16161fa3fc00000'],['non_shortest','a16161fb3ff8000000000000'],['key_order','a2616201616101'],['key_order','a262616101616202'],
 ['float','a16161f98000'],['float','a16161f93c00'],['float','a16161fa47c35000'],['bignum','a16161c24101'],['bignum','a16161c249000000000000000001'],
 ['typed_array','a16161d855440000c07f'],['text','a1616163efb790'],['text','a1616163efbfbe'],
];
for(const [code,hex] of PROFILE_ONLY)add(Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)),`profile:${code}`);
const fixture={
 provenance:{
  package:'cborg',version:pkg.version,source:`https://registry.npmjs.org/cborg/-/cborg-${pkg.version}.tgz`,
  integrity:'sha512-90BdAPd5EUayc7Cj9+xD5d+TfgQiaQ3yoroUs4hmrm0ieupQlVB+SXVnYORidh74YKng1oliynPYxeEroYgimg==',
  tarballSha256:'40a73fcf11e385c3d4e85044feb8ae84b02aab243d45c76b3200257dcabd3071',
  upstream:'https://github.com/rvagg/cborg',license:pkg.license,
  note:'Oracle outputs only; cborg source is not vendored. Its package.json and LICENSE state Apache-2.0 only (every published version), not the Apache-2.0/MIT dual licence the CBOR spike assumed, and the repository vendors MIT snapshots, so vendoring awaits an owner decision.',
  generator:'tests/vectors/generate-cborg-oracle.mjs',corpus:`randomMap(createRandom(seed),{oracle:true}) for seeds 1..${SEEDS}, ${MUTATIONS} mutations each, deduplicated`,
  decodeOptions:{...decodeOptions,tags:'2,3 bignum; 69,70,71,72,77,78,79,85,86 little-endian typed arrays (cborg taglib)'},
  encodeOptions:'rfc8949EncodeOptions with taglib bigIntEncoder and the matching little-endian typed-array encoders',
 },
 cases,
};
await writeFile(new URL('./cbor-cborg-oracle.json',import.meta.url),JSON.stringify(fixture,null,1)+'\n');
console.log(`${cases.length} cases, ${cases.filter(c=>c.accept).length} accepted by cborg`);
