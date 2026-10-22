import test from 'node:test';
import assert from 'node:assert/strict';
import {targetSurfaces,credentialSurfaces,cases,credentialCases,fixture,requestFor,snapshot} from './helpers/public-unknown.mjs';
for(const surface of targetSurfaces)test('U404: '+surface.name+' conceals target lifecycle',async()=>{
 let expected;for(const name of cases){const result=await snapshot(await fixture(name).fetch(await requestFor(surface,name)));assert.equal(result.status,404,name+' '+JSON.stringify(result));expected??=result;assert.deepEqual(result,expected,name);}
});
for(const surface of credentialSurfaces)test('U404: '+surface.name+' refuses a lifecycle-faulted credential as an invalid credential',async()=>{
 let expected;for(const name of credentialCases){const result=await snapshot(await fixture(name).fetch(await requestFor(surface,name)));assert.ok([400,401].includes(result.status),name+' '+JSON.stringify(result));expected??=result;assert.deepEqual(result,expected,name);}
});
