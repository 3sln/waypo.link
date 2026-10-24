import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {artefactRuntime} from '../../packages/runtime/artefacts.mjs';
import {versionRecord,versionDigest,extractVersion} from '../../packages/core/artefacts.mjs';

// DEVLOG 2026-10-23 review follow-ups: the warm authenticated-prefix cache must reach exactly the verdict (and
// recorded fault) a cold process reaches for the same supplied copy, including body-less (sparse) entries.
// (tamperedRecord is accepted by both: the provider prefers its stored record for a known digest over the copy's.)
const id='https://warm.example/contract',kind='rpc-contract',body=n=>n===99?{$id:id,type:'object',properties:{x:{type:'string'}}}:{$id:id,type:'object'};
async function chain(count){const versions=[],digests=[];let prev=null;for(let version=1;version<=count;version++){const entry={version,prev,body:body(version)};prev=await versionDigest(versionRecord({id,kind},entry));versions.push(entry);digests.push(prev);}return {versions,digests};}
const sparse=(versions,upTo)=>versions.map((e,i)=>i<upTo?{version:e.version,prev:e.prev}:e);
const options=()=>({clock:{now:()=>1800000000000},flags:{for:()=>({global:()=>true})},random:{},audit:{record(){}},validateBody:()=>true});

test('core: a warm prefix never accepts a body-less entry the cold verifier rejects',async()=>{
 const {versions,digests}=await chain(4),line={id,kind},records=new Map(versions.map((e,i)=>[`${id}/versions/${i+1}`,versionRecord(line,e)]));
 // The authenticated copy is a sparse four-version envelope pinned at version 3, so entry 3 is body-less there too.
 const authenticatedCopy={bindle_artefact:1,id,kind,versions:sparse(versions,3)},auth=await extractVersion(authenticatedCopy,3,{id,kind,records});
 const tampered=new Map(records);tampered.set(`${id}/versions/3`,versionRecord(line,{...versions[2],body:body(99)}));
 const cases={
  trailing:{versions:[...versions.slice(0,2),{version:3,prev:versions[2].prev}]},
  wrongNext:{versions:[...versions.slice(0,2),{version:3,prev:versions[2].prev},{...versions[3],prev:digests[0]}]},
  tamperedRecord:{versions:sparse(versions,3),records:tampered},
  missingRecord:{versions:sparse(versions,3),records:new Map([...records].filter(([k])=>!k.endsWith('/3')))},
  valid:{versions:sparse(versions,3)},
 };
 for(const [name,c] of Object.entries(cases)){
  const envelope={bindle_artefact:1,id,kind,versions:c.versions},run=async extra=>{try{return {ok:(await extractVersion(envelope,3,{id,kind,records:c.records??records,storedDigests:digests.slice(0,3),...extra})).digest};}catch(error){return {code:error.code};}};
  const cold=await run({}),warm=await run({authenticatedPrefix:auth});
  assert.deepEqual(warm,cold,name);
  assert.equal(name==='valid',Boolean(cold.ok),name);
 }
});

test('runtime: warm and cold re-pins of a changed sparse copy record the same outcome and faults',async t=>{
 const {versions,digests}=await chain(4),line={id,kind};
 const recordDocs=list=>Object.fromEntries(list.map((e,i)=>[`${id}/versions/${i+1}`,versionRecord(line,e)]));
 const mutations={
  trailing:docs=>{docs[id]={bindle_artefact:1,id,kind,versions:[...sparse(versions,2).slice(0,2),{version:3,prev:versions[2].prev}]};},
  wrongNext:docs=>{docs[id]={bindle_artefact:1,id,kind,versions:[...sparse(versions,2).slice(0,2),{version:3,prev:versions[2].prev},{...versions[3],prev:versions[1].prev}]};},
  tamperedRecord:docs=>{docs[id]={bindle_artefact:1,id,kind,versions:sparse(versions,3)};docs[`${id}/versions/3`]=versionRecord(line,{...versions[2],body:body(99)});},
  valid:docs=>{docs[id]={bindle_artefact:1,id,kind,versions:sparse(versions,3)};},
 };
 for(const [name,mutate] of Object.entries(mutations)){
  const outcomes=[];
  for(const mode of ['warm','cold']){
   const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
   const documents={[id]:{bindle_artefact:1,id,kind,versions:sparse(versions,3)},...recordDocs(versions)};
   const store={get:k=>db.get(k),put:(...a)=>db.put(...a),list:a=>db.list(a),transaction:fn=>db.transaction(fn)};
   const first=artefactRuntime({store,documents,...options()});t.after(()=>first.engine.dispose());
   assert.equal((await first.pin({artefact:id,version:3,digest:digests[2]})).reference.version,3);
   mutate(documents);
   // Cold: a new process (new store object, so no authenticated cache) over the same durable rows.
   const second=mode==='warm'?first:artefactRuntime({store:{...store},documents,...options()});if(second!==first)t.after(()=>second.engine.dispose());
   let outcome;try{outcome={version:(await second.pin({artefact:id})).reference.version};}catch(error){outcome={code:error.code};}
   const state=await db.get('artefacts/line/'+id);outcomes.push({outcome,faults:state.faults,blockedFrom:state.blockedFrom,head:state.head});
  }
  assert.deepEqual(outcomes[0],outcomes[1],name);
  if(name==='valid')assert.equal(outcomes[0].outcome.version,4);else if(name!=='tamperedRecord')assert.ok(outcomes[0].outcome.code,name);
 }
});
