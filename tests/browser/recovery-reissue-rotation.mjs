// Console flow (apps/web/src/bl/recovery-reissue.mjs): a reissue begin refused with `rotation_unavailable` (review
// 2026-10-23 item 3: the identity key cannot be rotated, so a new file would hold the same key) explains it, stores no
// file secret and stages nothing. Engine-level with stub ports; run with the browser loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BeginRecoveryReissue} from '../../apps/web/src/bl/recovery-reissue.mjs';

test('rotation_unavailable at begin is explained and nothing is staged',async()=>{
 const secrets=new Map(),published=[];
 const r={api:{request:async path=>{assert.equal(path,'/api/auth/recovery/reissue/begin');throw Object.assign(new Error('raw server text'),{code:'rotation_unavailable',status:409});}},browser:{storeSecret:(k,v)=>secrets.set(k,v),focus(){}},state:{peek:()=>({locale:'en'})}};
 const action=new BeginRecoveryReissue({values:{acknowledged:'on'}});
 await assert.rejects(action.perform(r,{publish:v=>published.push(v)},{values:{acknowledged:'on'}}),error=>/cannot be replaced right now/.test(error.message)&&/keeps working/.test(error.message));
 assert.equal(secrets.size,0,'no file secret stored');assert.deepEqual(published,[]);
 // Any other refusal passes through unchanged.
 r.api.request=async()=>{throw Object.assign(new Error('other'),{code:'deletion_scheduled'});};
 await assert.rejects(action.perform(r,{},{values:{acknowledged:'on'}}),{code:'deletion_scheduled'});
});
