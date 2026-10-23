import test from 'node:test';import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createAppEngine,perform} from '../packages/app/engine.mjs';
import {ResolveIntent,RecordDecision} from '../packages/intents/router.mjs';
import {registeredIntent,REGISTERED_INTENTS,registeredIntentHandlers} from '../packages/intents/registered.mjs';
import {parseLegacyIntent,legacyIntentScheme} from '../packages/intents/legacy.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',origin='https://provider.example',actor={kind:'owner',owner};
test('oversized legacy capabilities require armed consent, stay built-in only and never enter durable records',async t=>{
 const db=new SqliteMetadata(':memory:');let now=Date.now(),serial=0;const pin=registeredIntent('add-contact'),contact=origin+'/users/alice/contact/'+owner+'?sig=e30.'+Buffer.from(JSON.stringify({sub:owner,padding:'x'.repeat(5000)})).toString('base64url')+'.YWJj',legacy={intent:'add-contact',contact};assert(contact.length>4352);assert.deepEqual(parseLegacyIntent(legacyIntentScheme(legacy)).legacy,legacy);
 const config={APP_ORIGIN:origin,INTENT_LINKS_ENABLED:'true',INTENT_APP_HANDLERS_ENABLED:'true',CLIENT_METADATA_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',INTENT_BUILTINS:registeredIntentHandlers(origin),ARTEFACTS:{enabled:true,resolve:async reference=>({reference,body:REGISTERED_INTENTS.find(d=>d.id===reference.artefact).versions[0].body})}};
 await db.put('resource/app',{id:'app',owner,clientId:'https://app.example/client.json',kind:'app-connection',status:'active',state:'active',generation:1,integration:{snapshot:{manifest:{intents:[{kind:pin.artefact,version:1,digest:pin.digest,route:'https://app.example/intent'}]}}}});
 const engine=createAppEngine({providers:{accountStore:db,config,clock:{now:()=>now},random:{uuid:()=>String(++serial)},audit:{record(){}}}});t.after(async()=>{await engine.dispose();db.close();});const run=(Type,input)=>perform(engine,new Type({actor,input:{legacy,placement:'fragment',...input}}));
 const flow=await run(ResolveIntent,{});assert.equal(flow.state,'choose');assert.equal(flow.candidates.length,1);assert.equal(flow.candidates[0].builtin,true);assert(!JSON.stringify(flow).includes(contact));
 await assert.rejects(run(RecordDecision,{flow:flow.flow,handler:flow.candidates[0].id,choice:'always'}),{code:'intent_stale'});now+=1000;
 const result=await run(RecordDecision,{flow:flow.flow,handler:flow.candidates[0].id,choice:'always'}),target=new URL(result.target);assert.equal(target.pathname,'/i/contact');assert.equal(target.search,'');assert.deepEqual(parseLegacyIntent(decodeURIComponent(target.hash.slice(8))).legacy,legacy);
 assert.equal((await run(ResolveIntent,{activated:true})).state,'handoff');assert(!JSON.stringify([...(await db.list()).values()]).includes(contact));
 for(const bad of [{...legacy,contact:contact+'x'.repeat(18000)},{...legacy,intent:'open-conversation'},{...legacy,extra:true}])assert.throws(()=>parseLegacyIntent(bad),{code:'intent_malformed'});
});
