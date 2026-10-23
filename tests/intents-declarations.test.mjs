import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntentDeclarations,adoptIntentDeclarations} from '../packages/intents/declarations.mjs';
import {IntegrationManifest,createIntegrationsProvider,validIntegrationValue,integrationSnapshot} from '../packages/federation/integrations.mjs';
import {createAppEngine,read} from '../packages/app/engine.mjs';
const clientId='https://app.example/client/metadata.json',kind='https://spec.bindle.example/intents/send-message/v1',digest='sha256-'+'A'.repeat(43),entry={kind,version:1,digest,route:'https://app.example/client/intent'};
test('INT-3 declarations are exact, pinned, bounded, duplicate-refusing and prefix bound',()=>{
 assert.deepEqual(validateIntentDeclarations(clientId,[entry]),[entry]);
 for(const bad of [null,{},Array(17).fill(entry)])assert.deepEqual(validateIntentDeclarations(clientId,bad),[]);
 for(const change of [{version:0},{version:1025},{version:1.2},{digest:'sha256-x'},{digest:'sha256-'+'A'.repeat(42)+'B'},{route:'https://evil.example/client/intent'},{route:'https://app.example/intent'},{route:entry.route+'?x=1'},{route:entry.route+'#x'},{route:'https://app.example/client/a%2fb'},{route:'https://app.example/client/a/../intent'},{extra:true},{kind:'http://spec.bindle.example/intents/v1'}])assert.deepEqual(validateIntentDeclarations(clientId,[{...entry,...change}]),[],JSON.stringify(change));
 assert.deepEqual(validateIntentDeclarations(clientId,[entry,{...entry,route:'https://evil.example/'}]),[]);
 const second={...entry,kind:'https://spec.bindle.example/intents/add-contact/v1'};assert.deepEqual(validateIntentDeclarations(clientId,[entry,{...entry,extra:1},second]),[second]);
 const result=validateIntentDeclarations(clientId,[entry]);result[0].route='changed';assert.equal(entry.route,'https://app.example/client/intent');
});
test('INT-3 public manifest engine path retains declarations and stable snapshots',async t=>{
 const engine=createAppEngine({providers:{config:{INTEGRATIONS_ENABLED:'true'},clock:{now:()=>0},random:{uuid:()=>crypto.randomUUID()},audit:{record(){}},integrations:createIntegrationsProvider()}});t.after(()=>engine.dispose());
 const input={clientId,manifest:{v:1,intents:[entry]},redirectUris:['https://app.example/client/callback']},result=await read(engine,new IntegrationManifest({input}));
 assert.deepEqual(result,{status:'valid',manifest:{v:1,intents:[entry]}});assert.equal(validIntegrationValue(result,input),true);
 const snapshot=integrationSnapshot({id:clientId,authMethod:'none',redirectUris:input.redirectUris,integration:result});assert.deepEqual(snapshot.manifest.intents,[entry]);
 assert.deepEqual(await read(engine,new IntegrationManifest({input:{...input,manifest:{v:1,intents:[entry,entry]}}})),{status:'valid',manifest:{v:1}});
});
test('INT-3 adopted snapshot changes audit without review; transient observations retain defaults',()=>{
 const pinned={clientId,manifest:{v:1,intents:[entry]}},moved={clientId,manifest:{v:1,intents:[{...entry,route:'https://app.example/client/changed',version:2}]}};
 const changed=adoptIntentDeclarations(pinned,moved,{adopted:true});assert.deepEqual(changed.changes,['intents_changed']);assert.deepEqual(changed.removed,[]);assert.deepEqual(changed.next,moved);
 const removed=adoptIntentDeclarations(pinned,{manifest:{v:1}},{adopted:true});assert.deepEqual(removed.removed,[kind]);assert.deepEqual(removed.next.manifest,{v:1});
 assert.deepEqual(adoptIntentDeclarations(pinned,{manifest:{v:1}}),{next:pinned,changed:false,changes:[],removed:[]});assert.deepEqual(pinned.manifest.intents,[entry]);
});
test('INT-3 one integration hook adopts actual refetched declarations without owner review and preserves them on transient/identity failure',async()=>{
 const {classifyIntegrationChange}=await import('../packages/federation/integrations.mjs'),client={id:clientId,redirectUris:['https://app.example/client/callback'],authMethod:'none',integration:{status:'valid',manifest:{v:1,intents:[entry]}}},pinned=integrationSnapshot(client);
 const changed=structuredClone(client);changed.integration.manifest.intents=[{...entry,route:'https://app.example/client/moved'}];const adopted=classifyIntegrationChange(pinned,{client:changed});assert.equal(adopted.decision,'adopt');assert(adopted.changes.includes('intents_changed'));assert.equal(adopted.next.manifest.intents[0].route,changed.integration.manifest.intents[0].route);
 delete changed.integration.manifest.intents;const removed=classifyIntegrationChange(pinned,{client:changed});assert.equal(removed.decision,'adopt');assert(!removed.next.manifest.intents);assert.deepEqual(classifyIntegrationChange(pinned,{transient:true}).next,pinned);
 changed.redirectUris=['https://app.example/client/new'];assert.deepEqual(classifyIntegrationChange(pinned,{client:changed}).next.manifest.intents,[entry]);
});
