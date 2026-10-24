// ORG-10a relation documents (packages/orgs/relation-documents.mjs; spec §9.2, §9.8, §11; design §8b.10). Pure validator,
// growth table, upgrade delta, slot projection and the resolve(pin) port with hash-chain verification and caching.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRelationBody,relationAdditive,upgradeDelta,edgeEntries,projectForSlot,relationEnvelope,relationDocuments,relationPin,pinKey,RELATION_MAX_BYTES} from '../packages/orgs/relation-documents.mjs';
import {relationBodies,STORE,LEDGER,PO,BUS} from './helpers/relations-world.mjs';

const clone=v=>structuredClone(v);
const invalid=(body,options,label)=>assert.throws(()=>validateRelationBody(body,options),e=>e.code==='relation_invalid'||assert.fail(`${label}: ${e.code}`),label);
const frag=f=>new Map(Object.values(f).map(x=>[pinKey(x),x.body]));
const resolver=f=>{const m=frag(f);return p=>m.get(pinKey(p));};

test('valid documents normalize; titles and slot names are data only',async()=>{
 const {f,supply,share,group,partners}=await relationBodies();
 for(const body of [supply,share,group,partners]){const doc=validateRelationBody(body,{id:body.id,fragment:resolver(f)});assert.equal(doc.id,body.id);assert.equal(doc.access.length,body.access.length);assert.ok(doc.access.every(e=>e.reshare===false));}
 const doc=validateRelationBody(supply);assert.equal(doc.access[0].required,true);assert.equal(doc.access[2].required,false);assert.equal(doc.access[0].actor_disclosure,'pairwise');
 // Unknown members are ignored when not critical; any `crit` entry makes the document invalid for this processor.
 assert.ok(validateRelationBody({...supply,extension:{x:1}}));invalid({...supply,crit:['extension']},{},'crit');invalid({...supply,crit:undefined},{},'crit required');
});

test('the §9.2 rules: slots, arity, kinds, entries, reshare, ceilings and size',async()=>{
 const {supply}=await relationBodies();
 const mutate=(fn,label)=>{const b=clone(supply);fn(b);invalid(b,{},label);};
 mutate(b=>{b.slots={};},'no slots');
 mutate(b=>{for(let i=0;i<9;i++)b.slots['s'+i]={arity:{min:0,max:1},kinds:['organization']};},'more than 8 slots');
 mutate(b=>{b.slots.Buyer=b.slots.buyer;},'slot name pattern');
 mutate(b=>{b.slots.buyer.arity={min:2,max:1};},'min > max');
 mutate(b=>{b.slots.buyer.arity={min:0,max:1025};},'max > 1024');
 mutate(b=>{b.slots.buyer.arity={min:0,max:0};},'max 0');
 mutate(b=>{b.slots.buyer.kinds=[];},'empty kinds');
 mutate(b=>{b.slots.buyer.kinds=['robot'];},'unknown kind');
 mutate(b=>{b.slots.buyer.kinds=['organization','organization'];},'duplicate kinds');
 mutate(b=>{b.access=[];},'no entries');
 mutate(b=>{b.access=Array.from({length:65},()=>b.access[2]);},'more than 64 entries');
 mutate(b=>{b.access[0].grantor='nobody';},'unknown grantor slot');
 mutate(b=>{b.access[0].reshare=true;},'reshare:true is refused');
 mutate(b=>{b.access[0].actor_disclosure='everyone';},'actor_disclosure');
 mutate(b=>{delete b.access[0].methods;},'methods required');
 mutate(b=>{b.access[0].methods={orders:{[PO]:[]}};},'empty method list');
 mutate(b=>{b.access[0].methods={orders:{'http://insecure.example/c':['x']}};},'contract must be https');
 mutate(b=>{b.access[0].fields=['other'];},'methods outside fields');
 mutate(b=>{b.access[0].digest='sha256-short';},'digest pattern');
 mutate(b=>{delete b.access[0].version;},'fragment pins need a version');
 mutate(b=>{b.title='Supply‮';},'bidi override in title');
 mutate(b=>{b.id='http://erp.example/relations/supply';},'https id');
 mutate(b=>{b.description='x'.repeat(RELATION_MAX_BYTES);},'32 KiB bound');
 invalid(supply,{id:'https://erp.example/relations/other'},'id must match the pinned artefact');
});

test('pinned fragments: fields exist, resource fields carry exact methods, buses must admit entity readers',async()=>{
 const {f,supply}=await relationBodies(),fragment=resolver(f);
 const mutate=(fn,label)=>{const b=clone(supply);fn(b);invalid(b,{fragment},label);};
 mutate(b=>{b.access[0].methods={orders:{[LEDGER]:['get']}};},'contract outside the field contracts');
 mutate(b=>{b.access[0].methods={};},'a covered resource field without methods');
 mutate(b=>{b.access[0].fields=['missing'];b.access[0].methods={};},'a field the fragment lacks');
 const priv=f.privateBus;mutate(b=>{Object.assign(b.access[1],{fragment:priv.fragment,version:1,digest:priv.digest});},'a bus without the entity reader');
 const b=clone(supply);b.access[0].digest=f.ledger.digest;assert.throws(()=>validateRelationBody(b,{fragment}),e=>e.code==='relation_unavailable','an unavailable fragment pin');
 // Atomic fields never take methods.
 const g=(await relationBodies()).group;g.access[0].fields=['ledger','year'];g.access[0].methods.year={[LEDGER]:['get']};invalid(g,{fragment},'methods on an atomic field');
});

test('superseding entries need a higher fragment version and embed the earlier grants',async()=>{
 const {share}=await relationBodies(),base=share.access[0];
 const later={...clone(base),version:2,methods:{store:{[STORE]:['get','list','put','delete']}}};
 const doc=validateRelationBody({...share,access:[base,later]});
 assert.deepEqual(edgeEntries(doc,'owner','recipient').map(e=>e.index),[1],'the later entry supersedes');
 invalid({...share,access:[base,{...later,version:1}]},{},'same version');
 invalid({...share,access:[base,{...later,methods:{store:{[STORE]:['get']}}}]},{},'methods must embed');
 invalid({...share,access:[base,{...later,required:false}]},{},'same required');
 invalid({...share,access:[base,{...later,actor_disclosure:'named'}]},{},'same ceilings');
});

test('the matrix as it applies to a slot: what it gives and receives, publisher unverified',async()=>{
 const {supply}=await relationBodies(),doc=validateRelationBody(supply);
 const buyer=projectForSlot(doc,'buyer');assert.deepEqual(buyer.gives.map(e=>[e.to,e.index]),[['supplier',0],['supplier',2]]);assert.deepEqual(buyer.receives.map(e=>[e.from,e.index]),[['supplier',1]]);
 assert.equal(buyer.publisherVerified,false);assert.deepEqual(buyer.arity,{min:1,max:1});
 const supplier=projectForSlot(doc,'supplier');assert.deepEqual(supplier.gives.map(e=>e.index),[1]);assert.deepEqual(supplier.receives.map(e=>e.index),[0,2]);
 assert.throws(()=>projectForSlot(doc,'auditor'),e=>e.code==='relation_slot_invalid');
});

const extra=(f,grantor='buyer',grantee='supplier',required=false)=>({grantor,grantee,fragment:f.ledger.fragment,version:1,digest:f.ledger.digest,methods:{ledger:{[LEDGER]:['get']}},fields:['ledger'],required});
test('the growth table: every additive row, and every never-additive change',async()=>{
 const {f,supply}=await relationBodies(),a=clone(supply);
 const ok=(fn,label)=>{const b=clone(a);fn(b);assert.equal(relationAdditive(a,b),true,label);};
 const no=(fn,label)=>{const b=clone(a);fn(b);assert.equal(relationAdditive(a,b),false,label);};
 ok(()=>{},'identical');
 ok(b=>{b.slots.auditor={arity:{min:0,max:2},kinds:['organization']};},'add a slot with explicit min 0');
 no(b=>{b.slots.auditor={arity:{min:1,max:2},kinds:['organization']};},'a new slot with min 1');
 ok(b=>{b.access.push(extra(f));},'append an optional entry for an existing pair');
 no(b=>{b.access.push(extra(f,'buyer','supplier',true));},'append a required entry for an existing pair');
 ok(b=>{b.slots.auditor={arity:{min:0,max:2},kinds:['organization']};b.access.push(extra(f,'buyer','auditor',true));},'a required entry for a new pair');
 ok(b=>{b.access.push({...clone(a.access[2]),version:2,digest:a.access[2].digest,methods:{store:{[STORE]:['get','list','put']}},required:false});},'a superseding entry that embeds the earlier one');
 ok(b=>{b.access[1].methods.bus[BUS].push('ack');},'append a method to an existing contract array');
 no(b=>{b.access[1].methods.bus['https://contracts.example/other/v1']=['x'];},'a new contract key for an existing field');
 const withFields=clone(a);withFields.access[0].fields=['orders'];
 const b2=clone(withFields);b2.access[0].fields.push('notes');assert.equal(relationAdditive(withFields,b2),true,'append a field where fields exist');
 const b3=clone(a);b3.access[0].fields=['orders'];assert.equal(relationAdditive(a,b3),false,'fields cannot be added where absent');
 for(const [fn,label] of [[b=>{b.title='Supply 2';},'title'],[b=>{b.slots.buyer.arity.max=2;},'arity'],[b=>{b.slots.buyer.kinds.push('person');},'kinds'],[b=>{b.access.reverse();},'reorder'],[b=>{b.access.pop();},'remove'],[b=>{b.access[0].required=false;},'required'],[b=>{b.access[0].methods.orders[PO]=['status'];},'narrow methods'],[b=>{b.publisher='https://evil.example';},'publisher'],[b=>{b.extra=1;},'top-level member']])no(fn,label);
});

test('upgrade delta: per pair, non-empty means widening; a non-additive successor is refused',async()=>{
 const {f,supply}=await relationBodies(),a=clone(supply),b=clone(supply);
 b.access[1].methods.bus[BUS].push('ack');b.access.push(extra(f));
 assert.deepEqual(upgradeDelta(a,b,'supplier','buyer'),[{kind:'methods',index:1,field:'bus',contract:BUS,methods:['ack']}]);
 assert.deepEqual(upgradeDelta(a,b,'buyer','supplier'),[{kind:'entry',index:3}]);
 const c=clone(a);c.slots.auditor={arity:{min:0,max:1},kinds:['organization']};assert.deepEqual(upgradeDelta(a,c,'buyer','supplier'),[],'only a new slot: the pin advances without asking');
 const d=clone(a);d.title='Other';assert.throws(()=>upgradeDelta(a,d,'buyer','supplier'),e=>e.code==='relation_not_additive');
});

test('resolve(pin): hash chain, exact pin, fragments, cache, and lookalike or tampered documents',async()=>{
 const {f,supply,share}=await relationBodies(),fragment=resolver(f);
 const {envelope,pins}=await relationEnvelope(supply.id,[supply]);
 let fetches=0;const served=new Map([[supply.id,envelope]]),docs=relationDocuments({fetch:async id=>{fetches++;return served.get(id)??null;},fragment:async p=>fragment(p)});
 const got=await docs.resolve(pins[0]);assert.equal(got.doc.title,'Supply');assert.deepEqual(got.pin,pins[0]);
 await docs.resolve(pins[0]);assert.equal(fetches,1,'verified bodies are cached by digest');
 for(const bad of [{artefact:supply.id},{artefact:supply.id,version:1},{...pins[0],extra:1},{artefact:'http://erp.example/x',version:1,digest:pins[0].digest}])assert.throws(()=>relationPin(bad),e=>e.code==='relation_invalid');
 // A clone with the same title at another id, served under the genuine pin's digest, fails the chain check.
 const clone_={...clone(supply),id:'https://erp-relations.example/relations/supply',access:[...clone(supply).access,{...clone(supply.access[2]),grantor:'supplier',grantee:'buyer'}]};
 const {envelope:fake}=await relationEnvelope(clone_.id,[clone_]);served.set(clone_.id,fake);
 await assert.rejects(docs.resolve({...pins[0],artefact:clone_.id}),e=>e.code==='relation_unavailable');
 // The publisher serving a different body under the same id: the pinned digest no longer matches.
 const altered=clone(envelope);altered.versions[0].body.access[0].methods.orders[PO].push('cancel');const fresh=relationDocuments({fetch:async()=>altered,fragment:async p=>fragment(p)});
 await assert.rejects(fresh.resolve(pins[0]),e=>e.code==='relation_unavailable');
 await assert.rejects(relationDocuments({fetch:async()=>null}).resolve(pins[0]),e=>e.code==='relation_unavailable');
 // A later additive version: the earlier pin still extracts exactly its own version.
 const v2=clone(supply);v2.access.push(extra(f));const {envelope:two,pins:p2}=await relationEnvelope(supply.id,[supply,v2]);
 const both=relationDocuments({fetch:async()=>two,fragment:async p=>fragment(p)});assert.equal((await both.resolve(p2[0])).doc.access.length,3);assert.equal((await both.resolve(p2[1])).doc.access.length,4);
 // Wrong kind.
 const other=clone(envelope);other.kind='document';await assert.rejects(relationDocuments({fetch:async()=>other}).resolve(pins[0]),e=>e.code==='relation_unavailable');
 assert.ok(share);
});
