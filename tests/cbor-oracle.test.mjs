// Cross-check of the Bindle CBOR codec against cborg 6.2.0 in strict mode (spike §7.3 "Cross-implementation"). cborg is
// not vendored (Apache-2.0 only; see the fixture provenance); tests/vectors/generate-cborg-oracle.mjs recorded its
// verdicts and RFC 8949 re-encodings offline for a seeded corpus, and this test replays them against our codec.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode,encode,CBORFault} from '../packages/core/cbor.mjs';
import {createRandom,randomMap,toHex,fromHex} from './helpers/cbor-corpus.mjs';

const fixture=JSON.parse(readFileSync(new URL('./vectors/cbor-cborg-oracle.json',import.meta.url),'utf8'));
const verdict=hex=>{try{return {ok:true,value:decode(fromHex(hex),{top:'any'})};}catch(error){if(!(error instanceof CBORFault))throw error;return {ok:false,code:error.code};}};

test('oracle fixture provenance is pinned and the corpus is reproducible from its seeds',()=>{
 const p=fixture.provenance;
 assert.equal(p.package,'cborg');assert.equal(p.version,'6.2.0');assert.equal(p.license,'Apache-2.0');
 assert.match(p.integrity,/^sha512-/);assert.match(p.tarballSha256,/^[0-9a-f]{64}$/);
 const seeds=new Map(fixture.cases.filter(c=>/^seed:\d+$/.test(c.origin)).map(c=>[Number(c.origin.slice(5)),c.hex]));
 assert.ok(seeds.size>=100);
 for(const [seed,hex] of seeds)assert.equal(toHex(encode(randomMap(createRandom(seed),{oracle:true}))),hex,`seed ${seed}`);
});

test('accept/refuse agreement with cborg and identical deterministic bytes on the shared subset',()=>{
 let shared=0;
 for(const c of fixture.cases){
  const ours=verdict(c.hex);
  if(c.origin.startsWith('profile:')){
   // Profile rules stricter than cborg's strict mode (float shortness, key order, integral and -0 floats, bignum
   // preferred serialization, NaN in typed arrays, noncharacters): cborg accepts, we refuse with the named code.
   assert.equal(c.accept,true,c.origin);assert.deepEqual(ours,{ok:false,code:c.origin.slice(8)},c.hex);continue;
  }
  if(ours.ok){
   assert.equal(c.accept,true,`we accept what cborg refuses: ${c.hex} (${c.error})`);
   assert.equal(c.reencoded,c.hex,`cborg re-encodes our canonical input differently: ${c.hex}`);
   shared++;
  }
  // Every generated (unmutated) value is in the shared subset.
  if(/^seed:\d+$/.test(c.origin))assert.equal(ours.ok,true,c.origin);
 }
 assert.ok(shared>=150,`shared accepted subset is ${shared}`);
});

test('where cborg refuses, the Bindle codec refuses too (cborg-refused mutations)',()=>{
 const refused=fixture.cases.filter(c=>!c.accept);
 assert.ok(refused.length>=300);
 for(const c of refused)assert.equal(verdict(c.hex).ok,false,`${c.hex}: cborg says ${c.error}`);
});
