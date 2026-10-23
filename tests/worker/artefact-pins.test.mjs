import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
const ID='https://worker-pins.example/preferences',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture(t,flag){const versions=[],digests=[];for(let n=1;n<=2;n++){const body={id:ID,title:'Preferences',description:'Owner choices.',publisher:'https://worker-pins.example',fields:{enabled:{title:'Enabled',type:'boolean',cardinality:{min:0,max:1}},...n===2?{extra:{title:'Extra',type:'boolean',cardinality:{min:0,max:1}}}:{}}},entry={version:n,prev:digests.at(-1)??null,body};versions.push(entry);digests.push(await versionDigest(versionRecord({id:ID,kind:'fragment'},entry)));}
 const h=await createHarness({bindings:{ARTEFACT_VERSIONS_ENABLED:flag,FEDERATION_ENABLED:'true',FEDERATION_SCHEMAS:JSON.stringify({[ID]:versions[0].body,[ID+'/envelope']:{bindle_artefact:1,id:ID,kind:'fragment',versions}})}});t.after(()=>h.close());const namespace=await h.mf.getDurableObjectNamespace('FEDERATION'),port=namespace.get(namespace.idFromName('bindle-artefacts-v1'));return {h,port,namespace,versions,digests};}
test('actual Worker provider-wide artefact single writer pins and resolves exact versions across stubs',async t=>{
 const {port,namespace,versions,digests}=await fixture(t,'true'),pin=await port.artefacts('pin',{artefact:ID,kind:'fragment'});assert.equal(pin.ok,true,JSON.stringify(pin));assert.equal(pin.result.reference.version,2);
 const other=namespace.get(namespace.idFromName('bindle-artefacts-v1'));assert.deepEqual((await other.artefacts('resolve',pin.result.reference)).result.body,versions[1].body);
 const mismatch=await port.artefacts('pin',{artefact:ID,version:1,digest:'sha256-'+'A'.repeat(43),kind:'fragment'});assert.equal(mismatch.error.code,'artefact_digest_mismatch');assert.equal((await port.artefacts('pin',{artefact:ID,version:1,digest:digests[0],kind:'fragment'})).ok,true);
 assert.equal((await port.invoke('ready',[],owner)).error.code,'forbidden');const shard=namespace.get(namespace.idFromName('bindle-federation-v1/'+owner));assert.equal((await shard.invoke('ready',[],owner)).ok,true);assert.equal((await shard.artefacts('pin',{artefact:ID})).error.code,'forbidden');
});
test('actual Worker flag-off artefact engine retains legacy canonical bodies and refuses version pins',async t=>{
 const {port,versions,digests}=await fixture(t,'false'),pin=await port.artefacts('pin',{artefact:ID,kind:'fragment'});assert.equal(pin.ok,true,JSON.stringify(pin));assert.equal(pin.result.legacy,true);assert.deepEqual(pin.result.body,versions[0].body);assert.equal((await port.artefacts('pin',{artefact:ID,version:1,digest:digests[0],kind:'fragment'})).error.code,'unsupported_artefact_version');
});
