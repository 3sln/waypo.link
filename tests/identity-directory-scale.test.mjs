import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryMessagingStore,key} from '../packages/core/records.mjs';
import {IdentityKeyRegistry} from '../packages/identity/keys.mjs';
import {IdentityDirectory} from '../packages/federation/directory.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',issuer='https://foreign.example';
const bytes=v=>v===undefined?0:Buffer.byteLength(JSON.stringify(v));
function metered(){const inner=new MemoryMessagingStore(),stats={rows:0,bytes:0};return {stats,reset(){stats.rows=stats.bytes=0;},store:{transaction:fn=>inner.transaction(tx=>fn({...tx,get:async k=>{const value=await tx.get(k);stats.rows++;stats.bytes+=bytes(value);return value;},list:async(...args)=>{const rows=await tx.list(...args);stats.rows+=rows.length;for(const row of rows)stats.bytes+=bytes(row.value);return rows;}}))}};}
async function jwk(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {d,...publicJwk}=await crypto.subtle.exportKey('jwk',pair.privateKey);return publicJwk;}
test('tombstone exact lookup and append read bounded rows/bytes after one atomic legacy migration',async()=>{
 const publicJwk=await jwk(),work=[];
 for(const count of [128,12800]){
  const m=metered(),registry=new IdentityKeyRegistry({store:m.store,historyLimit:2});
  await m.store.transaction(async tx=>{for(let page=0;page<count/128;page++)await tx.set(key('identity-key-pruned',owner,'',page),{owner,page,kids:Array.from({length:128},(_,i)=>`old-${page*128+i}`)});});
  await registry.register(owner,{kid:'warm',alg:'ES256',publicJwk});
  await assert.rejects(registry.register(owner,{kid:`old-${count-1}`,alg:'ES256',publicJwk}),{code:'key_exists'});
  await registry.revoke(owner,{purpose:'signing',kid:'warm'});
  await registry.register(owner,{kid:'second',alg:'ES256',publicJwk});
  m.reset();await registry.register(owner,{kid:'third',alg:'ES256',publicJwk});work.push({...m.stats});
  assert.ok(m.stats.rows<40);assert.ok(m.stats.bytes<12000);
  await assert.rejects(registry.register(owner,{kid:'warm',alg:'ES256',publicJwk}),{code:'key_exists'});
 }
 assert.ok(Math.abs(work[1].bytes-work[0].bytes)<1000,JSON.stringify(work));assert.equal(work[1].rows,work[0].rows);
});
test('directory bulky document cache cannot evict the verification roster; resolve store work stays flat',async()=>{
 const publicJwk=await jwk(),counts=[];
 for(const count of [10,1000]){
  const m=metered(),dir=new IdentityDirectory({store:m.store,fetch:async()=>{},enabled:true,issuers:[issuer],clock:()=>1000});dir.capacity(count);
  const document={v:1,iss:issuer,sub:owner,kind:'person',keys:[{kid:'key',alg:'ES256',use:'sig',state:'active',jwk:publicJwk}],moves:[{statement:'s'.repeat(90000),attestation:null}],features:{padding:'p'.repeat(60000)}};
  await dir.accept(issuer,owner,issuer+'/person',document);
  for(let i=0;i<count;i++)dir.remember(dir.cache,issuer+'\n'+i,{document,identity:issuer+'/person',until:301000,ttl:300000});
  dir.remember(dir.cache,issuer+'\n'+owner,{document,identity:issuer+'/person',until:301000,ttl:300000});
  assert.equal(dir.cache.size,count+1);assert.ok(dir.cacheBytes<(count+1)*1024);assert.ok(dir.documentBytes<=dir.limits.cacheBytes);
  m.reset();assert.equal((await dir.resolve({issuer,subject:owner,kid:'key'})).kid,'key');counts.push({...m.stats});
  // Full document eviction must not cause roster refresh egress before refresh-ahead.
  dir.documentBytes-=dir.documents.get(issuer+'\n'+owner).bytes;dir.documents.delete(issuer+'\n'+owner);
  dir.fetcher=async()=>{throw new Error('unexpected fresh roster fetch');};
  assert.equal((await dir.refresh({issuer,subject:owner,early:true})).keys[0].kid,'key');
  assert.equal((await dir.refresh({issuer,subject:owner,verificationOnly:true})).keys[0].kid,'key');
  dir.clock=()=>301000;assert.equal(await dir.resolve({issuer,subject:owner,kid:'key'}),null);
 }
 assert.deepEqual(counts[0],counts[1]);
});
