// Wargame 2026-10-23 (plausible): integration JWK Sets refuse RSA keys whose public exponent is below 65537 or even.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateJwks} from '../packages/federation/integrations.mjs';

const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function rsaJwk(exponent){
 const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array(exponent),hash:'SHA-256'},true,['sign','verify']);
 const {kty,n,e}=await webcrypto.subtle.exportKey('jwk',pair.publicKey);return {kty,n,e,alg:'RS256',use:'sig'};
}
test('an RSA integration key with e = 3 is skipped; e = 65537 is kept',async()=>{
 const good=await rsaJwk([1,0,1]);assert.equal(good.e,'AQAB');
 assert.equal((await validateJwks(webcrypto,{keys:[good]}))?.keys.length,1);
 const small=await rsaJwk([3]);assert.equal(small.e,'Aw');
 assert.equal(await validateJwks(webcrypto,{keys:[small]}),null,'e = 3 is refused');
 // Same modulus with a forged even or sub-65537 exponent never imports as a usable key either.
 for(const e of [b64([1,0,0]),b64([0,255,255]),b64([2])])assert.equal(await validateJwks(webcrypto,{keys:[{...good,e}]}),null,e);
});
