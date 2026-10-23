import test from 'node:test';
import assert from 'node:assert/strict';
import {busHarness,manifest,url,ISSUER} from '../event-bus-fixture.mjs';
import {eventBusProvider} from '../../packages/app/domains/events.mjs';
import {busKeys} from '../../packages/events/index.mjs';

test('ART-4 engine forwards bus version/digest through its provider and resolves the admitted body',async t=>{
 const body=manifest(),digest='sha256-'+'A'.repeat(43),reference={artefact:url,version:1,digest},calls=[],keys=await busKeys({KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
 const artefacts={enabled:true,async pin(input){calls.push(input);return {reference};},async resolve(input){assert.deepEqual(input,reference);return {body,reference};}};
 const h=await busHarness(t,{providers:{eventBus:eventBusProvider({enabled:true,keys:async()=>keys,issuer:ISSUER,artefacts})}});
 const result=await h.run('events.create',{input:{url,manifest:{...body,title:'Untrusted adapter copy'},version:1,digest}});
 assert.deepEqual(calls,[{artefact:url,version:1,digest,kind:'bus'}]);assert.equal(result.bus.version,1);assert.equal(result.bus.digest,digest);assert.equal(result.bus.title,body.title);
});
test('ART-4 engine refuses versioned bus input without the enabled artefact port',async t=>{
 const h=await busHarness(t);await assert.rejects(h.run('events.create',{input:{url,manifest:manifest(),version:1,digest:'sha256-'+'A'.repeat(43)}}),{code:'unsupported_artefact_version'});
});
