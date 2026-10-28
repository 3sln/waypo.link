import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {strictJSON,jcs} from '../../packages/core/strict-json.mjs';
import {ARTEFACT_LIMITS,DEFAULT_KINDS,parseEnvelope,versionRecord,parseVersionRecord,versionDigest,digestJSON,versionURL,parseReference,verifyReference,extractVersion,verifyChain,validateAdditive,evaluateNotices,evaluateRetraction,equivocationEvidence} from '../../packages/core/artefacts.mjs';
import {forEachSeed} from '../helpers/chaos.mjs';

const vectors=JSON.parse(readFileSync(new URL('../../docs/architecture/artefacts/artefact-envelope.vectors.json',import.meta.url),'utf8'));
const ID='https://artefact.example/line',D='sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',clone=structuredClone;
const hash=s=>'sha256-'+createHash('sha256').update(s).digest('base64url');
const fault=code=>e=>e.code===code&&e.message===code;
const optional={title:'Enabled',type:'boolean',cardinality:{min:0,max:1}};
const fragment=()=>({id:ID,title:'Preferences',fields:{enabled:clone(optional)}});
async function line(bodies=[fragment()],kind='fragment',id=ID){
 const versions=[],digests=[];for(const body of bodies){const entry={version:versions.length+1,prev:digests.at(-1)??null,body:clone(body)};versions.push(entry);digests.push(await versionDigest(versionRecord({id,kind},entry)));}return {envelope:{bindle_artefact:1,id,kind,versions},digests};
}
const additive=(kind,old,edit,expected=true)=>{const next=clone(old);edit(next);assert.equal(validateAdditive(kind,old,next).additive,expected);return next;};
const objectSchema=(open=true)=>({type:'object',properties:{value:{type:'string'}},required:[],additionalProperties:open});
function rpc({open=true,shared=false}={}){
 return {$id:ID,oneOf:[{$ref:'#/$defs/readRequest'}],$defs:{args:objectSchema(false),result:objectSchema(open),readRequest:{type:'object',properties:{method:{const:'read'},args:{$ref:'#/$defs/args'}},required:['method','args'],additionalProperties:false}},'x-methods':{read:{request:'#/$defs/readRequest',result:shared?'#/$defs/args':'#/$defs/result',effect:'read',summary:{en:'Read values'}}}};
}

test('portable JSON conformance vectors: strict parse, canonical bytes, independent SHA-256',async t=>{
 for(const v of vectors.parse)await t.test(v.name,async()=>{
  const input=v.hex?Uint8Array.from(Buffer.from(v.hex,'hex')):v.utf16?String.fromCharCode(...v.utf16):v.source;
  if(v.error)assert.throws(()=>strictJSON(input),fault(v.error));
  else{const parsed=strictJSON(input);assert.equal(jcs(parsed),v.canonical);assert.equal(hash(v.canonical),v.digest);assert.equal(await digestJSON(parsed),v.digest);assert.deepEqual(strictJSON(jcs(parsed)),parsed);}
 });
});
test('strict JSON bounds, own prototype names and parser generalization preserve old callers',async()=>{
 const parsed=strictJSON('{"__proto__":{"polluted":true},"constructor":0}');assert.equal(Object.getPrototypeOf(parsed),Object.prototype);assert.equal(Object.hasOwn(parsed,'__proto__'),true);assert.equal({}.polluted,undefined);
 assert.throws(()=>strictJSON('"é"',{maxBytes:3}),fault('too_large'));assert.equal(strictJSON('"é"',{maxBytes:4}),'é');
 assert.throws(()=>strictJSON('[[0]]',{maxDepth:1}),fault('malformed'));assert.deepEqual(strictJSON('[[0]]',{maxDepth:2}),[[0]]);
 assert.throws(()=>strictJSON('{"a":[0,1]}',{maxMembers:2}),fault('too_large'));
 const old=await import('../../packages/messaging-protocol/encoding.mjs');assert.throws(()=>old.strictJSON('-1'));assert.equal(strictJSON('-1'),-1);
 for(const s of ['{}','[0,true,"x"]','{"__proto__":3}'])assert.equal(jcs(strictJSON(s)),old.jcs(old.strictJSON(s)));
});
test('refusing JCS never silently drops or coerces non-JSON values',()=>{
 const getter={};Object.defineProperty(getter,'x',{enumerable:true,get(){throw Error('getter ran');}});
 const hidden={};Object.defineProperty(hidden,'x',{value:1});
 const cycle={};cycle.x=cycle;
 for(const v of [undefined,NaN,Infinity,-Infinity,0.5,1e21,-0,9007199254740992,1n,Symbol(),()=>0,new Date(),new Map(),new Set(),new Number(1),[undefined],Array(1),Object.assign([],{x:1}),{x:undefined},{[Symbol()]:1},getter,hidden,cycle,'\ud800','\uffff',{'\ufdd0':0}])assert.throws(()=>jcs(v),fault('malformed'));
 assert.equal(jcs(Object.assign(Object.create(null),{a:-1})),'{"a":-1}');
 assert.throws(()=>jcs({a:[0,1]},{maxMembers:2}),fault('too_large'));
});
test('portable chain vectors and URL/kind domain separation',async()=>{
 const {chain:v}=vectors,e={bindle_artefact:1,id:v.id,kind:v.kind,versions:v.versions};const verified=await verifyChain(e);
 assert.deepEqual(verified.digests,v.digests);verified.records.forEach((r,i)=>assert.equal(jcs(r),v.canonical[i]));
 for(const [key,value]of [['id','https://other.example/line'],['kind','fragment']])assert.notEqual(await versionDigest({...verified.records[0],[key]:value}),v.digests[0]);
 assert.notEqual(hash(jcs(v.versions[0].body)),v.digests[0]);
 assert.equal((await verifyReference(JSON.stringify(e),{artefact:v.id,version:2,digest:v.digests[1]})).version,2);
});
test('key order, whitespace and escape variants agree; NFC and NFD remain distinct',async()=>{
 const {envelope:e,digests}=await line([{title:'café'}],'document');
 const raw=JSON.stringify(e).replace('café','caf\\u00e9');assert.equal((await verifyChain(raw)).digest,digests[0]);
 const reordered={versions:e.versions,kind:e.kind,id:e.id,bindle_artefact:1};assert.equal((await verifyChain(reordered)).digest,digests[0]);
 const other=await line([{title:'café'}],'document');assert.notEqual(other.digests[0],digests[0]);
 assert.equal(validateAdditive('document',e.versions[0].body,other.envelope.versions[0].body).additive,false);
});
test('envelope and record validation fail closed while unknown top-level envelope data is ignored',async()=>{
 const {envelope:e}=await line();assert.equal(parseEnvelope({...e,extra:{anything:1}}).extra.anything,1);
 for(const patch of [{bindle_artefact:2},{id:'http://artefact.example/line'},{id:ID+'?q'},{id:ID+'#'},{id:'https://u@artefact.example/line'},{kind:''},{versions:[]},{versions:Array(1025).fill(e.versions[0])},{signatures:Array(65).fill({})},{notices:Array(8).fill({type:'deprecated'})}])assert.throws(()=>parseEnvelope({...e,...patch}),fault('artefact_invalid'));
 assert.throws(()=>parseEnvelope(JSON.stringify(e).replace('"bindle_artefact":1','"bindle_artefact":1,"bindle_artefact":1')),fault('artefact_invalid'));
 assert.throws(()=>parseEnvelope(e,{id:'https://other.example/line'}),fault('artefact_invalid'));
 const r=versionRecord(e,e.versions[0]);for(const patch of [{t:'other'},{extra:true},{body:null},{prev:D},{version:0}])assert.throws(()=>parseVersionRecord({...r,...patch}),fault('artefact_invalid'));
 for(const url of [ID+'?',ID+'#',ID+'\n','https://artefact.example:443/line','https://artefact.example/'+('a'.repeat(260))])assert.throws(()=>versionURL(url,1));
 assert.equal(versionURL(ID,7),ID+'/versions/7');
});
test('body limits and display controls are enforced before hashing',async()=>{
 for(const body of [{title:'deceptive\u202e'},{description:'bad\n'},{summary:{en:'bad\u200b'}},{title:'x'.repeat(65536)},Object.fromEntries(Array.from({length:4097},(_,i)=>['x'+i,0]))])await assert.rejects(line([body],'document'),fault('artefact_invalid'));
 let body={};for(let i=0;i<33;i++)body={n:body};await assert.rejects(line([body],'document'),fault('artefact_invalid'));
 assert.equal(ARTEFACT_LIMITS.bodyMembers,4096);
});
test('display member names remain ordinary schema/field data; validators cannot change hashed records',async()=>{
 const body={fields:{title:clone(optional),description:clone(optional),summary:clone(optional)}};assert.ok((await line([body])).digests[0]);
 const schema={type:'object',properties:{title:{type:'string',maxLength:10},description:{type:'string'}}};assert.ok((await line([schema],'submission-schema')).digests[0]);
 const {envelope:e,digests}=await line();const verified=await extractVersion(e,1,{validateBody:(body,context)=>{assert.equal(context.kind,'fragment');body.title='Validator mutation';}});assert.equal(verified.body.title,'Preferences');assert.equal(await versionDigest(verified.record),digests[0]);
 await assert.rejects(extractVersion(e,1,{validateBody:()=>false}),fault('artefact_invalid'));
});
test('body size, depth and member limits admit their boundaries and refuse the next value',async()=>{
 for(const [kind,max]of [['document',65536],['slot',16384]]){
  assert.ok((await line([{x:'a'.repeat(max-8)}],kind)).digests[0]);await assert.rejects(line([{x:'a'.repeat(max-7)}],kind),fault('artefact_invalid'));
 }
 const members=Object.fromEntries(Array.from({length:4096},(_,i)=>['x'+i,0]));assert.ok((await line([members],'document')).digests[0]);
 let deep=0;for(let i=0;i<32;i++)deep={x:deep};assert.ok((await line([deep],'document')).digests[0]);
 const fields={fields:Object.fromEntries(Array.from({length:32},(_,i)=>['field'+i,clone(optional)]))};additive('fragment',fields,b=>{b.fields.oneMore=clone(optional);},false);
});
test('chains reject modified history, gaps, reordering, renumbering, prev mismatch and truncation',async()=>{
 const a=fragment(),b=clone(a);b.fields.more=clone(optional);const {envelope:e,digests}=await line([a,b,b]);
 for(const edit of [v=>{v[0].body.title='Changed';},v=>v.splice(1,1),v=>v.reverse(),v=>{v[1].version=3;},v=>{v[1].prev=D;}]){const bad=clone(e);edit(bad.versions);await assert.rejects(verifyChain(bad));}
 const truncated={...e,versions:e.versions.slice(0,2)};await assert.rejects(verifyChain(truncated,{storedDigests:digests}),fault('artefact_history_rewritten'));
 const rewrite=await line([{...a,title:'Changed'},b,b]);await assert.rejects(verifyChain(rewrite.envelope,{storedDigests:digests}),fault('artefact_history_rewritten'));
 const invalidSuffix=clone(e);invalidSuffix.versions[1].extra=true;assert.equal((await extractVersion(invalidSuffix,1)).digest,digests[0]);await assert.rejects(extractVersion(invalidSuffix,2),fault('artefact_invalid'));
 const malformedHistory=clone(e);malformedHistory.versions[0].body=null;await assert.rejects(verifyChain(malformedHistory,{storedDigests:digests}),fault('artefact_history_rewritten'));
 await assert.rejects(extractVersion(e,4),fault('artefact_unavailable'));
});
test('offloaded bodies are supplied by per-version URL or digest and checked against successor',async()=>{
 const a=fragment(),b=clone(a);b.fields.more=clone(optional);const {envelope:e,digests}=await line([a,b,b]),full=await verifyChain(e),off=clone(e);
 delete off.versions[0].body;delete off.versions[1].body;
 const records=new Map([[versionURL(ID,1),JSON.stringify(full.records[0])],[digests[1],full.records[1]]]);assert.deepEqual((await verifyChain(off,{records})).digests,digests);
 await assert.rejects(verifyChain(off),fault('artefact_unavailable'));
 const wrong=clone(full.records[0]);wrong.body.title='Changed';const bad=new Map(records);bad.set(versionURL(ID,1),wrong);await assert.rejects(verifyChain(off,{records:bad}),fault('artefact_digest_mismatch'));
 bad.set(versionURL(ID,1),{...wrong,id:'https://other.example/line'});await assert.rejects(verifyChain(off,{records:bad}),fault('artefact_invalid'));
 const last=clone(e);delete last.versions[2].body;await assert.rejects(verifyChain(last),fault('artefact_invalid'));
});
test('references bind version, digest and container kind; unsupported algorithms never fall back',async()=>{
 const {envelope:e,digests}=await line();const ref={fragment:ID,version:1,digest:digests[0]};assert.equal((await verifyReference(e,ref,{urlMember:'fragment'})).digest,digests[0]);
 await assert.rejects(verifyReference(e,{...ref,digest:D},{urlMember:'fragment'}),fault('artefact_digest_mismatch'));
 await assert.rejects(verifyReference(e,{slot:ID,version:1,digest:digests[0]},{urlMember:'slot'}),fault('artefact_invalid'));
 for(const ref of [{artefact:ID,version:1},{artefact:ID,version:-1,digest:D},{artefact:ID,version:1,digest:D.slice(7)},{artefact:ID,version:1,digest:D.slice(0,-1)+'B'}])assert.throws(()=>parseReference(ref),fault('artefact_invalid'));
 assert.throws(()=>parseReference({artefact:ID,version:1,digest:'sha512-anything'}),fault('artefact_unverifiable'));
 assert.equal(parseReference({artefact:ID}).latest,true);await assert.rejects(verifyReference(e,{artefact:ID}),fault('artefact_invalid'));
 const unknown=await line([{}],'relation');assert.equal((await verifyReference(unknown.envelope,{artefact:ID,version:1,digest:unknown.digests[0]})).kind,'relation');
 let checked=false;await assert.rejects(verifyReference(e,{artefact:ID,version:1,digest:D},{validateBody:()=>{checked=true;}}),fault('artefact_digest_mismatch'));assert.equal(checked,false);
 await assert.rejects(verifyReference(e,{artefact:ID,version:1,digest:digests[0]},{validateBody:()=>false}),fault('artefact_invalid'));
});
test('legacy references preserve permissive numbers and map migrated envelopes only to version one',async()=>{
 const body={fraction:0.5},legacy=hash(JSON.stringify(body));assert.equal((await verifyReference(JSON.stringify(body),{artefact:ID,digest:legacy.slice(7)})).legacy,true);
 await assert.rejects(verifyReference(body,{artefact:ID,version:1,digest:legacy}),fault('artefact_invalid'));
 const {envelope:e}=await line([{title:'Old'},{title:'New'}],'document'),v1=hash(jcs(e.versions[0].body)),v2=hash(jcs(e.versions[1].body));
 assert.equal((await verifyReference(e,{artefact:ID,digest:v1})).version,1);await assert.rejects(verifyReference(e,{artefact:ID,digest:v2}),fault('artefact_digest_mismatch'));
});
test('portable additive conformance vectors',()=>{for(const v of vectors.additive)assert.equal(validateAdditive(v.kind,v.old,v.next).additive,v.additive,v.name);});
test('fragment additions obey field rules, enum constraints and all frozen paths',()=>{
 const old=fragment();additive('fragment',old,b=>{b.fields.more=clone(optional);});
 for(const f of [{...optional,cardinality:{min:1,max:1}},{...optional,cardinality:undefined},{...optional,type:'unknown'},{...optional,type:'string'},{...optional,default:false}]){const body=clone(old);body.fields.more=f;assert.equal(validateAdditive('fragment',old,body).additive,false);}
 for(const edit of [b=>{b.title='New';},b=>{delete b.fields.enabled;},b=>{b.fields.enabled.title='New';},b=>{b.fields.enabled.cardinality.max=2;},b=>{b.publisher=ID;}])additive('fragment',old,edit,false);
 const enums={fields:{mode:{title:'Mode',type:'enum',values:['a','b'],extensible:true}}};additive('fragment',enums,b=>b.fields.mode.values.push('c'));
 for(const edit of [b=>b.fields.mode.values.reverse(),b=>b.fields.mode.values.push('a'),b=>b.fields.mode.values.push(7),b=>{b.fields.mode.extensible=false;}])additive('fragment',enums,edit,false);
 const resource={fields:{r:{title:'R',type:'resource',contracts:[ID]}}};additive('fragment',resource,b=>b.fields.r.contracts.push('https://other.example/contract'),false);
});
test('bus growth: options, declared types and open payloads only; the slot kind is retired',()=>{
 const old={fields:{r:{type:'resource'}},slot:{options:{occupant:{},consumer:{}},selection:'ordered',bus:{types:['changed'],types_extensible:true,payload:objectSchema(true),publishers:['app'],readers:['app'],history:false,retention:1,categories:[]}}};
 for(const side of ['occupant','consumer'])additive('bus',old,b=>{b.slot.options[side].flag=clone(optional);});
 additive('bus',old,b=>{b.fields.something=clone(optional);},false);
 // Extensions revision 3.2 removed slots: `slot` is no longer a default artefact kind (bus manifests keep theirs).
 assert.equal(Object.hasOwn(DEFAULT_KINDS,'slot'),false);assert.deepEqual(validateAdditive('slot',old,clone(old)),{known:false,additive:null,changes:[]});
 additive('bus',old,b=>b.slot.bus.types.push('created'));
 const frozen=clone(old);frozen.slot.bus.types_extensible=false;additive('bus',frozen,b=>b.slot.bus.types.push('created'),false);
 additive('bus',old,b=>{b.slot.bus.payload.properties.extra={type:'string'};});
 const closed=clone(old);closed.slot.bus.payload.additionalProperties=false;additive('bus',closed,b=>{b.slot.bus.payload.properties.extra={};},false);
 for(const edit of [b=>{b.slot.selection='all';},b=>b.slot.bus.publishers.push('provider'),b=>{b.slot.bus.history=true;},b=>{b.slot.bus.retention=2;},b=>b.slot.bus.categories.push('new')])additive('bus',old,edit,false);
});
test('RPC reachable optional args, result openness and frozen effects/schema constraints',()=>{
 const old=rpc();additive('rpc-contract',old,b=>{b.$defs.args.properties.extra={type:'string'};});additive('rpc-contract',old,b=>{b.$defs.result.properties.extra={type:'string'};});additive('rpc-contract',old,b=>{b['x-methods'].read.summary.es='Leer valores';});
 for(const edit of [b=>{b.$defs.args.properties.extra={default:'x'};},b=>b.$defs.args.required.push('value'),b=>{b.$defs.args.additionalProperties=true;},b=>{b['x-methods'].read.effect='write';},b=>{b['x-methods'].read.introspect=true;},b=>{b['x-methods'].read.summary.en='Changed';},b=>{b['x-methods'].read.summary['bad_tag']='x';},b=>{b.$defs.result.properties.value.maxLength=10;}])additive('rpc-contract',old,edit,false);
 additive('rpc-contract',rpc({open:false}),b=>{b.$defs.result.properties.extra={};},false);
 additive('rpc-contract',rpc({shared:true}),b=>{b.$defs.args.properties.extra={};},false);
 const unreachable=rpc();unreachable.$defs.unused=objectSchema();additive('rpc-contract',unreachable,b=>{b.$defs.unused.properties.extra={};},false);
 const fake=rpc();fake.$defs.args.properties.value.examples=[{properties:{}}];additive('rpc-contract',fake,b=>{b.$defs.args.properties.value.examples[0].properties.extra={};},false);
});
test('RPC new methods/branches/definitions and reference capture attacks',()=>{
 const old=rpc();const add=b=>{b['x-methods'].write={request:'#/$defs/writeRequest',result:'#/$defs/result',effect:'write'};b.$defs.writeRequest={type:'object',properties:{method:{const:'write'},args:objectSchema(false)},required:['method','args']};b.oneOf.push({$ref:'#/$defs/writeRequest'});};additive('rpc-contract',old,add);
 for(const key of ['$id','$anchor','$dynamicAnchor','$dynamicRef'])additive('rpc-contract',old,b=>{b.$defs.added={nested:{[key]:'capture'}};},false);
 additive('rpc-contract',old,b=>b.oneOf.push({$ref:'#/$defs/readRequest'}),false);
 additive('rpc-contract',old,b=>{add(b);delete b['x-methods'].write.effect;},false);
 additive('rpc-contract',old,b=>{add(b);delete b.$defs.writeRequest.required;},false);
 const dangling=rpc();dangling.$defs.args.properties.value={$ref:'#/$defs/later'};additive('rpc-contract',dangling,b=>{b.$defs.later={type:'string'};},false);
 const recursive=rpc();recursive.$defs.args.properties.child={$ref:'#/$defs/args'};additive('rpc-contract',recursive,b=>{b.$defs.args.properties.extra={};});
});
test('schema reachability respects literal wildcard names, pointer escapes, anchors and nested resource scopes',()=>{
 const star=rpc();star.$defs['*']=star.$defs.args;delete star.$defs.args;star.$defs.readRequest.properties.args.$ref='#/$defs/*';star.$defs.unused=objectSchema(false);
 additive('rpc-contract',star,b=>{b.$defs['*'].properties.extra={};});additive('rpc-contract',star,b=>{b.$defs.unused.properties.extra={};},false);
 const escaped=rpc();escaped.$defs['a/b~c']=escaped.$defs.args;delete escaped.$defs.args;escaped.$defs.readRequest.properties.args.$ref='#/$defs/a~1b~0c';additive('rpc-contract',escaped,b=>{b.$defs['a/b~c'].properties.extra={};});
 const anchored=rpc();anchored.$defs.args.$anchor='arguments';anchored.$defs.readRequest.properties.args.$ref='#arguments';additive('rpc-contract',anchored,b=>{b.$defs.args.properties.extra={};});
 additive('rpc-contract',anchored,b=>{b.$defs.args.properties.extra={$anchor:'arguments',type:'string'};},false);
 const scoped=rpc();scoped.$defs.args={$id:'https://artefact.example/args',type:'object',properties:{nested:{$ref:'#/$defs/inner'}},$defs:{inner:objectSchema(false)}};additive('rpc-contract',scoped,b=>{b.$defs.args.$defs.inner.properties.extra={};});
 const negative=rpc();negative.$defs.args.not=objectSchema();additive('rpc-contract',negative,b=>{b.$defs.args.not.properties.extra={};},false);
 const annotation=rpc();annotation.$defs.args.examples=[{$ref:'#/does-not-exist'}];additive('rpc-contract',annotation,b=>{b.$defs.args.properties.extra={};});
 const dynamic=rpc();dynamic.$defs.args.properties.value={$dynamicRef:'#/$defs/later'};additive('rpc-contract',dynamic,b=>{b.$defs.later={type:'string'};},false);
 for(const tag of ['x-local','i-klingon','en-GB-oed'])additive('rpc-contract',rpc(),b=>{b['x-methods'].read.summary[tag]='Publisher summary';});
 additive('rpc-contract',rpc(),b=>{b['x-methods'].read.summary.es='Spanish';b['x-methods'].read.summary.ES='Other';},false);
});
test('submission schema and manifest profile request growth follows schema references, not annotations',()=>{
 for(const kind of ['submission-schema','manifest-profile']){
  const schema={...objectSchema(false),$defs:{nested:objectSchema(false)}};schema.properties.child={$ref:'#/$defs/nested'};const old=kind==='manifest-profile'?{declaration:schema,title:'Profile'}:schema,get=b=>kind==='manifest-profile'?b.declaration:b;
  additive(kind,old,b=>{get(b).properties.extra={};});additive(kind,old,b=>{get(b).$defs.nested.properties.extra={};});
  additive(kind,old,b=>get(b).required.push('extra'),false);additive(kind,old,b=>{get(b).additionalProperties=true;},false);
 }
});
test('unknown kinds never imply additivity; a caller can supply an explicit kind table',()=>{
 for(const kind of ['relation','toString','__proto__','future'])assert.deepEqual(validateAdditive(kind,{},{}),{known:false,additive:null,changes:[]});
 const kinds={...DEFAULT_KINDS,relation:{rules:[{pattern:'/edges',operation:'add-member',allow:c=>c.value.authority===false}],validate:b=>!!b.edges}};
 assert.equal(validateAdditive('relation',{edges:{}},{edges:{a:{authority:false}}},{kinds}).additive,true);
 assert.equal(validateAdditive('relation',{edges:{}},{edges:{a:{authority:true}}},{kinds}).additive,false);
 assert.equal(validateAdditive('relation',{},{}).known,false);assert.equal(validateAdditive('document',{},{}).additive,true);
});
test('seeded additive/non-additive edit properties and chain round trips',async()=>{
 await forEachSeed(64,async random=>{
  let old=fragment();const bodies=[old],count=1+random.int(12);
  for(let i=0;i<count;i++){
   const next=clone(old),name='field'+random.int(1000000)+'_'+i;next.fields[name]={...clone(optional),title:'Field '+random.int(1000000)};
   const unchanged=JSON.stringify(old),result=validateAdditive('fragment',old,next);assert.equal(result.additive,true);assert.equal(result.changes.length,1);assert.equal(JSON.stringify(old),unchanged);
   const bad=clone(next),key=random.pick(Object.keys(old.fields));random.pick([()=>{delete bad.fields[key];},()=>{bad.fields[key].title+=' changed';},()=>{bad.fields[key].cardinality.min=1;},()=>{bad.title+='!';},()=>{bad.extra=true;}])();assert.equal(validateAdditive('fragment',old,bad).additive,false);
   old=next;bodies.push(next);
  }
  assert.equal(validateAdditive('fragment',bodies[0],old).additive,true);
  const {envelope:e,digests}=await line(bodies);assert.deepEqual((await verifyChain(e)).digests,digests);
  const version=1+random.int(bodies.length);assert.equal((await verifyReference(e,{artefact:ID,version,digest:digests[version-1]})).digest,digests[version-1]);
 });
});
test('seeded schema edits cover request/result growth, aliasing and frozen constraints',async()=>{
 await forEachSeed(96,random=>{
  const old=rpc({open:random.chance(0.5)}),next=clone(old),key='new'+random.int(100000),target=random.pick(['args','result']);next.$defs[target].properties[key]={type:random.pick(['string','boolean','integer'])};
  assert.equal(validateAdditive('rpc-contract',old,next).additive,target==='args'||old.$defs.result.additionalProperties);
  const bad=clone(old);random.pick([()=>{bad.$defs.args.required.push(key);},()=>{bad['x-methods'].read.effect='destructive';},()=>{bad.$defs.args.properties.value.type='integer';},()=>{bad.oneOf.reverse();bad.oneOf.push(clone(bad.oneOf[0]));},()=>{bad.$defs.result.additionalProperties=!bad.$defs.result.additionalProperties;}])();assert.equal(validateAdditive('rpc-contract',old,bad).additive,false);
 });
});
test('notices bind verified history beyond provider head, remain sticky, and retraction closes a line',async()=>{
 const {envelope:e,digests}=await line([{}, {}, {}],'document'),notice={type:'retracted',head:digests[2],from:2,reason:'Publisher claim',issued:'2026-10-21T00:00:00Z',successor:'https://successor.example/line'};
 const seen=evaluateNotices({...e,notices:[notice]},{digests,storedDigests:digests.slice(0,1)});assert.deepEqual(seen.notices,[notice]);assert.equal(seen.closedAt,3);assert.equal(seen.rewritten,false);
 assert.equal(evaluateNotices(e,{digests,accepted:[notice]}).rewritten,true);
 const later=await line([{}, {}, {}, {}],'document');assert.equal(evaluateNotices({...later.envelope,notices:[notice]},{digests:later.digests,accepted:[notice]}).rewritten,true);
 for(const n of [{...notice,head:D},{...notice,from:4},{...notice,reason:'bad\u202e'},{...notice,issued:'yesterday'},{...notice,issued:'2026-02-30T00:00:00Z'},{...notice,issued:'2026-10-21T24:00:00Z'},{...notice,successor:'http://bad.example/line'}])assert.deepEqual(evaluateNotices({...e,notices:[n]},{digests}).notices,[]);
 assert.deepEqual(evaluateNotices({...e,notices:[notice]},{digests,storedDigests:[D]}).notices,[]);
 assert.equal(evaluateRetraction(1,{notices:[notice]}).affected,false);assert.equal(evaluateRetraction(2,{notices:[notice]}).allowPin,false);
 const existing=evaluateRetraction(2,{notices:[notice],existingPin:true});assert.equal(existing.allowPin,true);assert.equal(existing.keepRecord,true);assert.equal(existing.revoke,false);assert.equal(existing.shouldSuspend,false);
 assert.equal(evaluateRetraction(2,{notices:[notice],signedNotices:[notice],existingPin:true}).shouldSuspend,true);assert.equal(evaluateRetraction(2,{notices:[notice],signedNotices:[notice],existingPin:true,ownerResumed:true}).shouldSuspend,false);
 const deprecated={type:'deprecated',head:digests[2],reason:'',issued:'2026-10-21T00:00:00+00:00'};assert.equal(evaluateRetraction(2,{notices:[deprecated]}).allowPin,true);assert.equal(evaluateNotices({...e,notices:[deprecated]},{digests}).notices.length,1);
});
test('equivocation requires two conflicting self-fetched or pinned-key-signed records (H2)',async()=>{
 const a=versionRecord({id:ID,kind:'document'},{version:1,prev:null,body:{title:'A'}}),b={...a,body:{title:'B'}},origin=r=>({record:r,fetchedByProvider:true,url:ID}),signed=r=>({record:r,validPinnedSignature:true});
 assert.ok(await equivocationEvidence(origin(a),origin(b)));assert.ok(await equivocationEvidence(origin(a),{record:b,fetchedByProvider:true,url:versionURL(ID,1)}));assert.ok(await equivocationEvidence(signed(a),signed(b)));assert.ok(await equivocationEvidence(origin(a),signed(b)));
 for(const foreign of [{record:b},{record:b,signatures:[{}]},{record:b,fetchedByProvider:true,url:'https://mirror.example/record'},{record:b,fetchedByProvider:true,url:ID+'/versions/2'},{digest:D}])assert.equal(await equivocationEvidence(origin(a),foreign),null);
 assert.equal(await equivocationEvidence({record:a},origin(b)),null);assert.equal(await equivocationEvidence(origin(a),origin(a)),null);assert.equal(await equivocationEvidence(origin(a),signed({...b,id:'https://other.example/line'})),null);
 assert.ok(await equivocationEvidence(origin(a),signed({...b,kind:'fragment'})));
});
