// ORG-5 on workerd: member discovery runs through the Worker composition (the route-level discovery engine over the
// person's AccountObject), and the new organization routes answer an unknown organization with the same uniform 404 as
// every other organization route. Creating an organization needs an allowlisted creator id, which this harness cannot
// know before signup, so the deeper flows are covered on the Node runtime (tests/orgs-context-runtime.test.mjs) over the
// same AccountController and federation code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';

const CLIENTS=JSON.stringify([{id:'https://erp.example/client.json',name:'ERP',origin:'https://erp.example',redirectUris:['https://erp.example/callback']}]);
const GHOST='12345678-1234-4123-8123-123456789abc';
const read=async(h,cookie,path)=>{const r=await h.request(path,{headers:{Cookie:cookie}});return {status:r.status,body:await r.json()};};

test('Worker: discovery lists nothing for a person without memberships; the ORG-5 routes refuse unknown organizations uniformly',async t=>{
 const h=await createHarness({bindings:{ORGANIZATIONS_ENABLED:'true',INTEGRATIONS_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS}});t.after(()=>h.close());
 const {cookie}=await h.signup();
 const listed=await read(h,cookie,'/api/orgs');assert.equal(listed.status,200,JSON.stringify(listed.body));assert.deepEqual(listed.body,{organizations:[],pending:[]});
 const baseline=await read(h,cookie,`/api/orgs/${GHOST}`);assert.equal(baseline.status,404);
 for(const route of ['membership','requests','connections','preferences']){const r=await read(h,cookie,`/api/orgs/${GHOST}/${route}`);assert.deepEqual(r,baseline,route);}
 // Writes need the session's CSRF token before any organization is consulted.
 const write=await h.request(`/api/orgs/${GHOST}/connections`,{method:'POST',value:{operation:'suspend',input:{}},headers:{Cookie:cookie,Origin:h.origin}});assert.equal(write.status,403);
});

test('Worker: discovery and the ORG-5 routes are not exposed with ORGANIZATIONS_ENABLED off',async t=>{
 const h=await createHarness({bindings:{FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS}});t.after(()=>h.close());
 const {cookie}=await h.signup();
 assert.equal((await read(h,cookie,'/api/orgs')).status,404);
 for(const route of ['membership','preferences'])assert.equal((await read(h,cookie,`/api/orgs/${GHOST}/${route}`)).status,404,route);
});
