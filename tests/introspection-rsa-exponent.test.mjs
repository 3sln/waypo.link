import test from 'node:test';
import assert from 'node:assert/strict';
import {rsaExponentOk} from '../packages/federation/introspection.mjs';

test('client assertion RSA keys need an odd exponent of at least 65537',()=>{
 assert.equal(rsaExponentOk('AQAB'),true);
 for(const e of ['Aw','AQ','AQAA','',undefined,'AQABAQABAQAB','!!'])assert.equal(rsaExponentOk(e),false,String(e));
});
