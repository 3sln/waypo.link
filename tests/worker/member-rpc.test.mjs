// Integration gap 3 on workerd: member-token RPC rides the DPoP path, mounted under the organization/member flags
// independently of the device grant (DEVICE_AUTHORIZATION_ENABLED off), through the front's provider and the owner's
// FederationObject `memberRpc` step. Without those flags the path is not mounted (the generic Bearer handler answers).
import {rpcInit,rpcBody} from '../helpers/rpc.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {dpopKey} from '../authorization-entry-helpers.mjs';

const CLIENTS=JSON.stringify([{id:'https://erp.example/client.json',name:'ERP',origin:'https://erp.example',redirectUris:['https://erp.example/callback']}]);
const MEMBER_FLAGS={FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS,ORGANIZATIONS_ENABLED:'true',MEMBER_CERTIFICATES_ENABLED:'true',DIRECTORY_ENABLED:'true'};
async function rpc(h,token){
 const key=await dpopKey(),r=await h.mf.dispatchFetch(h.origin+'/bindle/rpc',rpcInit({version:'0',tx:crypto.randomUUID(),resource:'@profile',contract:'https://3sln.me/artefacts/contracts/profile/v1',method:'read',args:{}},{Authorization:'DPoP '+token,DPoP:await key.sign({htu:h.origin+'/bindle/rpc',ath:token})}));
 return {status:r.status,body:await rpcBody(r)};
}
test('Worker: member-token DPoP RPC is mounted under the org/member flags without the device grant',async t=>{
 const h=await createHarness({bindings:MEMBER_FLAGS});t.after(()=>h.close());
 const owner=(await h.signup()).result.account.id;
 // An active owner: the front forwards to that owner's FederationObject `memberRpc`, whose provider refuses the unknown
 // token (401), rather than the step being unmounted there (404) or the generic Bearer handler answering.
 const known=await rpc(h,`${owner}.${'a'.repeat(43)}`);assert.deepEqual([known.status,known.body.error,known.body.message],[401,'unauthorized','A DPoP access token is required.'],JSON.stringify(known.body));
 const unknown=await rpc(h,`${crypto.randomUUID()}.${'a'.repeat(43)}`);assert.deepEqual([unknown.status,unknown.body.message],[401,'A DPoP access token is required.']);
 // Device routes stay unmounted.
 const device=await h.mf.dispatchFetch(h.origin+'/oauth/device_authorization',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'client_id=x'});assert.equal(device.status,404);
});
test('Worker: member-token DPoP RPC is not mounted with the member flags off',async t=>{
 const h=await createHarness({bindings:{FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS}});t.after(()=>h.close());
 const response=await rpc(h,`${crypto.randomUUID()}.${'a'.repeat(43)}`);assert.deepEqual([response.status,response.body.message],[401,'Bearer token required.']);
});
