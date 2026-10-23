import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,issuer,subject,identity,manifest} from './directory-helpers.mjs';
import {resolveIdentityKey} from '../packages/identity/keys.mjs';
import {IdentityDirectory,directoryURL,validateDirectoryDocument} from '../packages/federation/directory.mjs';
import {RefreshDirectoryIdentity} from '../packages/app/domains/directory.mjs';
import {perform} from '../packages/app/engine.mjs';
test('engine directory derives URI from directory, pins it, returns only fresh active keys through shared hook',async t=>{
 const f=await fixture();t.after(()=>f.engine.dispose());assert.equal(await f.resolve(),null);assert.equal(f.state.calls.length,0);
 await f.refresh();assert.equal(f.state.calls.length,3);const k=await f.resolve();assert.equal(k.identity,identity);assert.equal(k.purpose,'signing');
 assert.equal((await resolveIdentityKey({issuer,subject,kid:k.kid},{directory:f.hook})).kid,k.kid);
 assert.equal(await f.resolve({identity:issuer+'/attacker'}),null);assert.equal(await f.resolve({purpose:'encryption'}),null);
 f.state.time+=300001;assert.equal(await f.resolve(),null);assert.equal(f.state.calls.length,3);await f.refresh();assert.equal(f.state.calls.length,4);
});
test('rotation continuity, reset epoch and monotonic signing/certification knowledge survive cache loss',async t=>{
 const f=await fixture();t.after(()=>f.engine.dispose());await f.refresh();const old=structuredClone(f.state.document),oldKid=old.keys[0].kid;
 await f.keys.rotate(subject,{purpose:'signing',expectedKid:oldKid});await f.update();f.state.time+=300001;await f.refresh();assert.equal((await f.resolve()).authorityEpoch,0);assert.equal(await f.resolve({kid:oldKid}),null);
 const current=structuredClone(f.state.document);f.state.document=old;f.state.time+=300001;await assert.rejects(f.refresh(),{code:'key_rollback'});
 f.state.document=current;await f.keys.revoke(subject,{purpose:'signing',kid:current.keys.find(k=>k.state==='active').kid});await f.keys.ensure(subject,'signing');await f.update();await f.refresh();assert.equal((await f.resolve()).authorityEpoch,1);
 const fresh=structuredClone(f.state.document),cert={...fresh.keys.find(k=>k.state==='active'),kid:'cert',use:'cert'};fresh.keys.push(cert);f.state.document=fresh;f.state.time+=300001;await f.refresh();assert.equal((await f.resolve({kid:'cert',purpose:'certification'})).kid,'cert');
 cert.state='retired';f.state.time+=300001;await f.refresh();cert.state='active';f.state.time+=300001;await assert.rejects(f.refresh(),{code:'key_rollback'});
});
test('flag, empty issuer allowlist, system admission and budgets refuse before egress',async t=>{
 for(const options of [{enabled:false},{issuers:[]},{limiter:{consume:async()=>false}}]){const f=await fixture(options);t.after(()=>f.engine.dispose());await assert.rejects(f.refresh());assert.equal(f.state.calls.length,0);}
 const f=await fixture();t.after(()=>f.engine.dispose());await assert.rejects(perform(f.engine,new RefreshDirectoryIdentity({actor:{kind:'owner'},input:{issuer,subject}})),{code:'forbidden'});assert.equal(f.state.calls.length,0);
});
test('unknown kid refetch is coalesced and throttled to one per identity per minute',async t=>{
 const f=await fixture();t.after(()=>f.engine.dispose());await f.refresh();const count=f.state.calls.length;
 await Promise.all(Array.from({length:12},()=>f.refresh({kid:'unknown'})));assert.equal(f.state.calls.length,count+1);
 await f.refresh({kid:'another'});assert.equal(f.state.calls.length,count+1);assert.equal(await f.resolve({kid:'unknown'}),null);
 f.state.time+=60001;await f.refresh({kid:'another'});assert.equal(f.state.calls.length,count+2);
});
test('public URL grammar denies private literals, credentials, non-HTTPS, fragments and noncanonical URLs',()=>{
 for(const u of ['http://home.example/a','https://127.0.0.1/a','https://[::1]/a','https://user@home.example/a','https://home.local/a','https://home.example/a#b','https://home.example:444/a','https://home.example/a%2fb','https://HOME.example/a'])assert.equal(directoryURL(u),null,u);
});
test('redirects, malformed/oversized/slow bodies and malformed manifests fail closed without following',async t=>{
 for(const response of [()=>new Response(null,{status:308,headers:{Location:'https://127.0.0.1/private'}}),()=>new Response('x'.repeat(65537),{headers:{'Content-Type':'application/json'}}),()=>new Response('{"issuer":1,"issuer":2}',{headers:{'Content-Type':'application/json'}}),()=>Response.json({...manifest,authorization_endpoint:'https://evil.example/auth'}),()=>new Response(new ReadableStream({start(){},cancel(){}}),{headers:{'Content-Type':'application/json'}})]){
  let calls=0;const f=await fixture({limits:{timeoutMs:20},fetch:async()=>{calls++;return response();}});t.after(()=>f.engine.dispose());await assert.rejects(f.refresh());assert.equal(calls,1);assert.equal(await f.resolve(),null);
 }
});
test('document rejects private fields, multiple active keys and private JWKs',async t=>{
 const f=await fixture();t.after(()=>f.engine.dispose());for(const mutate of [d=>d.memberships=[],d=>d.keys.push({...d.keys[0],kid:'second'}),d=>d.keys[0].jwk.d='secret',d=>d.kind='team']){const d=structuredClone(f.state.document);mutate(d);await assert.rejects(validateDirectoryDocument(d,{issuer,subject}),{code:'invalid_document'});}
});
test('cached documents cannot be mutated by callers; failures never extend stale keys',async t=>{
 const f=await fixture();t.after(()=>f.engine.dispose());await f.refresh();const result=await f.refresh();result.keys[0].jwk.x='attacker';assert.notEqual((await f.resolve()).publicJwk.x,'attacker');
 f.state.time+=300001;f.directory.fetcher=async()=>{throw new Error('offline');};await assert.rejects(f.refresh());assert.equal(await f.resolve(),null);
});
test('directory-derived URI and exact subject are required before document fetch',async t=>{
 for(const lookup of [{iss:issuer,sub:subject,identity:'https://attacker.example/identity'},{iss:issuer,sub:'22222222-2222-4222-8222-222222222222',identity}]){
  const calls=[],f=await fixture({fetch:async url=>{calls.push(url);return Response.json(url.endsWith('manifest.json')?manifest:lookup,{headers:{'Cache-Control':'max-age=300'}});}});t.after(()=>f.engine.dispose());await assert.rejects(f.refresh(),{code:'invalid_directory'});assert.equal(calls.length,2);assert.equal(await f.resolve(),null);
 }
});
test('negative caches expire within 60 seconds and no-store is never cached',async t=>{
 let calls=0;const f=await fixture({fetch:async url=>{calls++;return url.endsWith('manifest.json')?Response.json(manifest,{headers:{'Cache-Control':'max-age=3600'}}):new Response(null,{status:404,headers:{'Cache-Control':'max-age=99999'}});}});t.after(()=>f.engine.dispose());assert.equal(await f.refresh(),null);assert.equal(calls,2);await f.refresh();assert.equal(calls,2);f.state.time+=60001;await f.refresh();assert.equal(calls,3);
});
test('engine and shared hook honor a flag kill over warm caches without egress',async t=>{
 const config={DIRECTORY_ENABLED:true},f=await fixture({config});t.after(()=>f.engine.dispose());await f.refresh();assert(await f.resolve());const calls=f.state.calls.length;
 config.DIRECTORY_ENABLED=false;assert.equal(await f.resolve(),null);assert.equal(await f.hook.resolve({issuer,subject,kid:f.state.document.keys[0].kid}),null);await assert.rejects(f.refresh(),{code:'feature_disabled'});assert.equal(f.state.calls.length,calls);
});
