import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFederationStore} from '../../packages/federation/index.mjs';
import {CommitIncrementalGrants,CurrentIncrementalGrants} from '../../packages/federation/incremental-ports.mjs';
import {AuthorizationEntries} from '../../packages/federation/authorization-entries.mjs';
import {createAppEngine,perform,read} from '../../packages/app/engine.mjs';
import {forEachSeed,createScheduler} from '../helpers/chaos.mjs';
const issuer='https://provider.example',subject=issuer+'/entities/owner',clientId='https://app.example/client',fragment='https://schema.example/preferences',contract='https://schema.example/contract',connection={id:'connection',generation:1},digest=n=>'sha256-'+String(n).repeat(42)+'A';
async function harness(t,{enabled=true,scheduler}={}){
 const store=new MemoryFederationStore();let sequence=0;const s={issuer,routingKey:'owner',store:scheduler?scheduler.wrap(store,'store'):store,artefactVersions:enabled,clients:new Map([[clientId,{origin:'https://app.example'}]]),clock:()=>1000,random:()=>String(++sequence),ensureClients:async()=>{},incrementalIdentity:async()=>({epoch:'epoch'}),active:async()=>{},connections:{binding:async()=>connection,check:async()=>true},syncResources:async()=>{},bounded:async()=>{},schema:async target=>{const version=target.version??2;return {version,digest:digest(version),schema:{fields:{first:{type:'boolean'},second:{type:'boolean'}}}};},referenceMatches:async(_tx,_line,pin,head)=>pin.version<=head.version};
 await store.transaction(tx=>tx.set('federation/preferences/'+subject+'|'+fragment,{version:2,digest:digest(2),values:{first:true,second:false}}));
 const engine=createAppEngine({providers:{federation:s,clock:{},random:{},audit:{record(){}}}});t.after(()=>engine.dispose());
 const change=(version,fields=['first'],contractVersion=version)=>({fragment,version,digest:digest(version),fields,methods:{},resources:{},contract_versions:{[contract]:{version:contractVersion,digest:digest(contractVersion)}}});
 const commit=(decision,changes)=>perform(engine,new CommitIncrementalGrants({input:{subject,clientId,decision,changes}})),current=extra=>read(engine,new CurrentIncrementalGrants({input:{subject,clientId,fragment,...extra}}));
 return {s,store,engine,change,commit,current};
}
test('incremental version pins persist and stay isolated from earlier and later authority',async t=>{
 const h=await harness(t);await h.commit('first',[h.change(1)]);assert.equal((await h.current()).version,1);
 await h.commit('second',[h.change(2,['second'])]);const current=await h.current();assert.equal(current.version,2);assert.deepEqual(current.fields,['second']);assert.deepEqual(current.contract_versions[contract],{version:2,digest:digest(2)});
 assert.deepEqual((await h.current({version:1})).fields,['first']);await assert.rejects(h.commit('downgrade',[h.change(1)]),{code:'stale_consent'});
 const rows=await h.store.transaction(tx=>tx.list('federation/grant/'));assert.deepEqual(rows.map(r=>r.value.version),[1,2]);
});
test('same fragment pin with differing contract pins never unions authority',async t=>{
 const h=await harness(t);await h.commit('old-contract',[h.change(2,['first'],1)]);await h.commit('new-contract',[h.change(2,['second'],2)]);
 const rows=await h.store.transaction(tx=>tx.list('federation/grant/'));assert.deepEqual(rows.at(-1).value.fields,['second']);assert.deepEqual((await h.current()).fields,['second']);await assert.rejects(h.commit('contract-downgrade',[h.change(2,['first'],1)]),{code:'stale_consent'});
});
test('legacy incremental grants remain byte-shaped without version metadata',async t=>{
 const h=await harness(t,{enabled:false});await h.commit('legacy',[{fragment,digest:digest(2),fields:['first'],methods:{},resources:{}}]);
 assert.deepEqual(await h.current(),{fields:['first'],methods:{},resources:{}});const [row]=await h.store.transaction(tx=>tx.list('federation/grant/'));assert.equal(Object.hasOwn(row.value,'version'),false);assert.equal(Object.hasOwn(row.value,'contract_versions'),false);
});
test('entry request reference members are refused off and validated on',()=>{
 const request={fragment,required:true,purpose:'Read',fields:['first'],version:1,digest:digest(1),contract_versions:{[contract]:{version:1,digest:digest(1)}}},make=artefactVersions=>new AuthorizationEntries({store:new MemoryFederationStore(),authority:{},issuer,artefactVersions});
 assert.throws(()=>make(false).validRequests([request],'login'),{code:'invalid_request'});assert.deepEqual(make(true).validRequests([request],'login'),[request]);
 assert.throws(()=>make(true).validRequests([{...request,digest:undefined}],'login'),{code:'invalid_request'});assert.throws(()=>make(true).validRequests([{...request,contract_versions:{[contract]:{version:1}}}],'login'),{code:'invalid_request'});
});
test('seeded concurrent version commits never downgrade or merge older authority',async t=>{
 await forEachSeed(12,async random=>{const scheduler=createScheduler(random),h=await harness(t,{scheduler});const results=await scheduler.run([()=>h.commit('one',[h.change(1)]),()=>h.commit('two',[h.change(2,['second'])]),()=>h.commit('two',[h.change(2,['second'])])]);assert.ok(results.some(r=>r.status==='fulfilled'));const current=await h.current();assert.equal(current.version,2);assert.deepEqual(current.fields,['second']);assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='stale_consent'));});
});
test('entry creation forwards tested references and persists resolved URL-only references',async()=>{
 const store=new MemoryFederationStore(),seen=[],redirectUri='https://app.example/callback',entry=new AuthorizationEntries({store,authority:{},issuer,artefactVersions:true,clients:[{id:clientId,name:'App',origin:'https://app.example',redirectUris:[redirectUri]}],pinSchema:async target=>{seen.push(structuredClone(target));return {version:target.version??2,digest:target.digest??digest(2)};}}),input={clientId,redirectUri,challenge:'A'.repeat(43),challengeMethod:'S256',state:'state-state-state',intent:'login',presentation:'redirect',requests:[{fragment,required:true,purpose:'Read',fields:['first']}]};
 const {entryId}=await entry.create(input,{remote:'127.0.0.1'}),view=await entry.view(entryId);assert.deepEqual(seen,[input.requests[0]]);assert.equal(view.entry.requests[0].version,2);assert.equal(view.entry.requests[0].digest,digest(2));
 await entry.create({...input,requests:[{...input.requests[0],version:1,digest:digest(1)}]},{remote:'127.0.0.1'});assert.equal(seen[1].version,1);assert.equal(seen[1].digest,digest(1));
});
test('silent incremental advances retain explicit authority and durable pin history in outcomes',async t=>{
 const h=await harness(t);await h.commit('old',[h.change(1)]);const advance={...h.change(2),silent:true},result=await h.commit('pin',[advance]),{before,after}=result.results[0];
 assert.equal(before.version,1);assert.equal(after.version,2);assert.equal(after.digest,digest(2));assert.deepEqual(after.contract_versions,advance.contract_versions);assert.deepEqual(after.fields,['first']);assert.deepEqual(after.pinHistory,[{at:1000,from:{version:1,digest:digest(1),contract_versions:h.change(1).contract_versions},to:{version:2,digest:digest(2),contract_versions:advance.contract_versions}}]);
 assert.deepEqual(await h.commit('pin',[advance]),result);assert.deepEqual((await h.current()).pinHistory,after.pinHistory);const rows=await h.store.transaction(tx=>tx.list('federation/grant/'));assert.deepEqual(rows.at(-1).value.pinHistory,after.pinHistory);
});
test('silent incremental advances refuse changes to explicit field authority',async t=>{
 const h=await harness(t);await h.commit('old',[h.change(1)]);await assert.rejects(h.commit('pin',[{...h.change(2,['first','second']),silent:true}]),{code:'stale_consent'});assert.equal((await h.current()).version,1);
});
