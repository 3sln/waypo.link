// CBOR in-place artefact rewrite reset (2026-10-29; provisional, unsigned): a store that observed a contract's old
// version-1 record refuses the rewritten line (`artefact_history_rewritten`), which is why ARTEFACT_STORE moves to a fresh
// name; on the fresh store a grant or request still pinning the old digest fails closed (`artefact_digest_mismatch`)
// on every use, with no state change, while the current digest pins and validates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {configuredArtefacts,configuredContractVersion,pinConfiguredContract,ARTEFACT_STORE,ARTEFACT_STORE_FILE} from '../../packages/runtime/artefact-pins.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
import {fakeClock} from '../helpers/chaos.mjs';

const C='https://contracts.example/files';
const contract=data=>({$id:C,oneOf:[{type:'object',properties:{method:{const:'put'},args:{type:'object',properties:{data},required:['data'],additionalProperties:false}},required:['method','args'],additionalProperties:false}],'x-methods':{put:{effect:'write',request:{type:'object'},result:{type:'object'}}}});
const before=contract({type:'string'}),after=contract({'x-type':'bytes','maxLength':16});
const digestOf=body=>versionDigest(versionRecord({id:C,kind:'rpc-contract'},{version:1,prev:null,body}));
const config=(store,body)=>{const c={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_CONTRACTS:{[C]:body,[C+'/envelope']:{bindle_artefact:1,id:C,kind:'rpc-contract',versions:[{version:1,prev:null,body}]}}};c.ARTEFACTS=configuredArtefacts({config:c,store,clock:fakeClock()});return c;};

test('the reset names a fresh artefact store on both adapters',()=>{assert.equal(ARTEFACT_STORE,'bindle-artefacts-v4');assert.equal(ARTEFACT_STORE_FILE,'artefacts-v4.sqlite');});

test('an in-place rewrite is refused by a store that saw the old record; a fresh store fails old pins closed and serves the new one',async t=>{
 const old=new SqliteMetadata(':memory:'),fresh=new SqliteMetadata(':memory:');t.after(()=>{old.close();fresh.close();});
 const oldDigest=await digestOf(before),newDigest=await digestOf(after);assert.notEqual(oldDigest,newDigest);
 const a=config(old,before);t.after(()=>a.ARTEFACTS.engine.dispose());
 assert.equal((await pinConfiguredContract(a,C)).digest,oldDigest);
 assert.equal((await configuredContractVersion(a,{contract:C,reference:{version:1,digest:oldDigest},method:'put',args:{data:'eA=='}})).valid,true);
 const b=config(old,after);t.after(()=>b.ARTEFACTS.engine.dispose());
 await assert.rejects(pinConfiguredContract(b,C),e=>e.code==='artefact_history_rewritten','re-pinning the rewritten line on the old store');
 await assert.rejects(configuredContractVersion(b,{contract:C,reference:{version:1,digest:newDigest},method:'put',args:{data:new Uint8Array(1)}}),e=>['artefact_history_rewritten','artefact_digest_mismatch','artefact_unavailable'].includes(e.code),'the old store cannot serve the rewritten line');
 const c=config(fresh,after);t.after(()=>c.ARTEFACTS.engine.dispose());
 assert.equal((await pinConfiguredContract(c,C)).digest,newDigest);
 for(let i=0;i<2;i++)await assert.rejects(configuredContractVersion(c,{contract:C,reference:{version:1,digest:oldDigest},method:'put',args:{data:'eA=='}}),e=>['artefact_digest_mismatch','artefact_unavailable'].includes(e.code),'a stale pin fails closed, every time');
 assert.equal((await configuredContractVersion(c,{contract:C,reference:{version:1,digest:newDigest},method:'put',args:{data:new Uint8Array(1)}})).valid,true);
 await assert.rejects(configuredContractVersion(c,{contract:C,reference:{version:1,digest:newDigest},method:'put',args:{data:'eA=='}}),{code:'invalid_args'},'base64 text is not bytes under the rewritten contract');
});
