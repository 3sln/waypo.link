import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {artefactRuntime} from '../../packages/runtime/artefacts.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';

const id='https://scale.example/contract';
const bytes=value=>value===undefined?0:Buffer.byteLength(JSON.stringify(value));
function metered(db){
 const stats={gets:0,bytes:0,lists:0};
 const wrap=tx=>({get:async key=>{const value=await tx.get(key);stats.gets++;stats.bytes+=bytes(value);return value;},put:(...args)=>tx.put(...args),list:async args=>{stats.lists++;return tx.list(args);}});
 return {stats,reset:()=>Object.assign(stats,{gets:0,bytes:0,lists:0}),store:{...wrap(db),transaction:fn=>db.transaction(tx=>fn(wrap(tx)))}};
}
test('artefact head reads and warm latest work stay bounded; only new suffix bodies are validated',async t=>{
 for(const size of [8,128,512]){
  const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const m=metered(db),versions=[];let prev=null,validations=0;
  for(let version=1;version<=size+1;version++){const entry={version,prev,body:{$id:id,type:'object',properties:{value:{type:'string'}}}};prev=await versionDigest(versionRecord({id,kind:'rpc-contract'},entry));versions.push(entry);}
  const documents={[id]:{bindle_artefact:1,id,kind:'rpc-contract',versions:versions.slice(0,size)}};
  const runtime=artefactRuntime({store:m.store,documents,clock:{now:()=>1800000000000},flags:{for:()=>({global:()=>true})},random:{},audit:{record(){}},validateBody:()=>{validations++;return true;}});t.after(()=>runtime.engine.dispose());
  const pin=await runtime.pin({artefact:id});assert.equal(validations,size);
  const head=await db.get('artefacts/line/'+id);assert(bytes(head)<512);assert.equal(head.digests,undefined);assert.equal(head.observed,undefined);
  m.reset();await runtime.pin({artefact:id});assert(m.stats.gets<=4);assert(m.stats.bytes<1024);assert.equal(m.stats.lists,0);assert.equal(validations,size);
  m.reset();await runtime.resolve(pin.reference);assert(m.stats.gets<=4);assert(m.stats.bytes<2048);assert.equal(m.stats.lists,0);
  documents[id].versions=versions;await runtime.pin({artefact:id});assert.equal(validations,size+1);
  documents[id]=structuredClone(documents[id]);documents[id].versions[0].body.type='string';
  await assert.rejects(runtime.pin({artefact:id}),error=>error.code==='artefact_history_rewritten');
 }
});
test('legacy inline history migrates every page and warm elided histories avoid record reads',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const m=metered(db),versions=[],digests=[];let prev=null;
 for(let version=1;version<=128;version++){const entry={version,prev,body:{$id:id,type:'object'}};prev=await versionDigest(versionRecord({id,kind:'rpc-contract'},entry));versions.push(entry);digests.push(prev);}
 const envelope={bindle_artefact:1,id,kind:'rpc-contract',versions:versions.map((entry,i)=>i===127?entry:{version:entry.version,prev:entry.prev})},documents={[id]:envelope};
 for(let i=0;i<127;i++)documents[id+'/versions/'+(i+1)]=versionRecord(envelope,versions[i]);
 const make=store=>artefactRuntime({store,documents,clock:{now:()=>1800000000000},flags:{for:()=>({global:()=>true})},random:{},audit:{record(){}},validateBody:()=>true});
 const runtime=make(m.store);t.after(()=>runtime.engine.dispose());const pin=await runtime.pin({artefact:id});m.reset();await runtime.pin({artefact:id});assert(m.stats.gets<=4);assert(m.stats.bytes<1024);
 const head=await db.get('artefacts/line/'+id);delete head.headDigest;delete head.observedCount;await db.put('artefacts/line/'+id,{...head,digests,observed:digests});await db.delete('artefacts/digests/'+id+'/0');
 const cold=make({...m.store});t.after(()=>cold.engine.dispose());await cold.pin({artefact:id});assert.deepEqual(await db.get('artefacts/digests/'+id+'/0'),digests);assert.equal((await db.get('artefacts/line/'+id)).digests,undefined);
 assert.equal((await cold.resolve(pin.reference)).reference.digest,digests.at(-1));
});
test('normalized operator registry follows revisions and live edits while preserving builtin precedence',async()=>{
 const {configuredArtefactDocuments}=await import('../../packages/runtime/artefact-pins.mjs');
 const {GOOGLE_DRIVE_SETUP_FRAGMENT:builtin}=await import('../../packages/storage/google-drive-integration.mjs');
 const config={INTEGRATIONS_ENABLED:'true',FEDERATION_SCHEMAS:{[builtin.id]:{id:builtin.id,title:'Override'},[id]:{id}},FEDERATION_CONTRACTS:{}};
 const first=configuredArtefactDocuments(config);assert.equal(configuredArtefactDocuments(config),first);assert.deepEqual(first[builtin.id],builtin);
 delete config.FEDERATION_SCHEMAS[id];assert.equal(Object.hasOwn(first,id),false);config.FEDERATION_SCHEMAS[id]={id,title:'Live'};assert.equal(first[id].title,'Live');
 config.FEDERATION_SCHEMAS={[id]:{id,title:'Replacement'}};const second=configuredArtefactDocuments(config);assert.notEqual(first,second);assert.equal(second[id].title,'Replacement');
 config.INTEGRATIONS_ENABLED='false';assert.equal(Object.hasOwn(configuredArtefactDocuments(config),builtin.id),false);
 config.FEDERATION_CONTRACTS=JSON.stringify({[id]:{id,title:'JSON revision'}});assert.equal(configuredArtefactDocuments(config)[id].title,'Replacement');
 config.FEDERATION_SCHEMAS={};assert.equal(configuredArtefactDocuments(config)[id].title,'JSON revision');
});
test('normalized registry keeps the 100-fragment bound for live edits and never hands out live operator objects',async()=>{
 const {configuredArtefactDocuments,registeredArtefact}=await import('../../packages/runtime/artefact-pins.mjs');
 const {CONSENT_CONTRACT_SCHEMAS}=await import('../../packages/consent/contracts.mjs');
 const schemas=Object.fromEntries(Array.from({length:100},(_,i)=>[`${id}/f${i}`,{id:`${id}/f${i}`,nested:{title:'T'}}])),config={FEDERATION_SCHEMAS:schemas,FEDERATION_CONTRACTS:{[id]:{$id:id,nested:{a:1}}}};
 const documents=configuredArtefactDocuments(config),fragment=documents[`${id}/f0`];
 assert.notEqual(fragment,schemas[`${id}/f0`]);assert.deepEqual(fragment,schemas[`${id}/f0`]);assert.ok(Object.isFrozen(fragment)&&Object.isFrozen(fragment.nested));
 assert.throws(()=>{fragment.nested.title='mutated';},TypeError);assert.equal(schemas[`${id}/f0`].nested.title,'T');
 assert.notEqual(documents[id],config.FEDERATION_CONTRACTS[id]);assert.ok(Object.isFrozen(documents[id].nested));
 const builtin=CONSENT_CONTRACT_SCHEMAS[0];assert.notEqual(documents[builtin.$id],builtin);assert.deepEqual(documents[builtin.$id],builtin);
 assert.equal(Object.getOwnPropertyDescriptor(documents,`${id}/f1`).value,documents[`${id}/f1`]);
 // A replaced live entry is seen (new copy); the bound is enforced again on the next lookup.
 schemas[`${id}/f0`]={id:`${id}/f0`,nested:{title:'Live'}};assert.equal(configuredArtefactDocuments(config)[`${id}/f0`].nested.title,'Live');
 schemas[`${id}/f100`]={id:`${id}/f100`};
 assert.throws(()=>configuredArtefactDocuments(config),{name:'TypeError',message:'Invalid reviewed fragment registry.'});
 assert.throws(()=>registeredArtefact(config,id),TypeError);assert.throws(()=>documents[id],TypeError);
 delete schemas[`${id}/f100`];assert.equal(registeredArtefact(config,id),true);
 // The Google Drive builtin counts toward the bound while integrations are enabled, as before.
 config.INTEGRATIONS_ENABLED='true';assert.throws(()=>configuredArtefactDocuments(config),TypeError);
});
