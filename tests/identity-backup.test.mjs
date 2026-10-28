// Public name certificates (packages/recovery/identity-backup.mjs). The provider-signed v2 identity backup these tests
// once covered was withdrawn with recovery file v3 (owner approval 2026-10-28); see tests/recovery-file-v3.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as backupModule from '../packages/recovery/identity-backup.mjs';
const {createNameAssignment,verifyNameAssignment}=backupModule;
const authorityKeys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const authority={kid:'provider-2026',privateKey:authorityKeys.privateKey,publicKey:authorityKeys.publicKey};
const decode=proof=>JSON.parse(Buffer.from(proof.payload,'base64url'));
const fixture=()=>({issuer:'https://identity.example',entity:crypto.randomUUID(),recoveryToken:'account.random-credential',keychain:{version:1}});

test('the v2 identity backup API is gone: only name certificates remain',()=>{
  assert.deepEqual(Object.keys(backupModule).sort(),['MAX_NAME_CERTIFICATE_BYTES','createNameAssignment','verifyNameAssignment']);
});

test('a separate public name certificate binds the UUID to canonical free or paid names and contains no recovery material',async()=>{
  const input=fixture();
  for(const handle of ['n.2a','7alice','alice-smith']){
    const claims={issuer:input.issuer,entity:input.entity,handle,assignmentId:crypto.randomUUID(),issuedAt:Date.now()};
    const certificate=await createNameAssignment(claims,authority);
    assert.equal((await verifyNameAssignment(JSON.stringify(certificate),authority,claims)).handle,handle);
    assert.equal(certificate.type,'3sln-name-assignment');
    assert.equal(certificate.entity,input.entity);
    for(const value of [certificate,decode(certificate.proof)]){assert.equal(value.keychain,undefined);assert.equal(value.recoveryToken,undefined);}
    await assert.rejects(verifyNameAssignment(certificate,authority,{entity:crypto.randomUUID()}));
    await assert.rejects(verifyNameAssignment(certificate,authority,{handle:'someone-else'}));
    await assert.rejects(verifyNameAssignment(certificate,authority,{assignmentId:crypto.randomUUID()}));
    const altered=structuredClone(certificate);altered.handle='someone-else';await assert.rejects(verifyNameAssignment(altered,authority));
    const otherKeys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    await assert.rejects(verifyNameAssignment(certificate,{kid:'provider-2026',publicKey:otherKeys.publicKey}),'another authority key');
    await assert.rejects(createNameAssignment({...claims,keychain:input.keychain},authority));
    await assert.rejects(createNameAssignment({...claims,recoveryToken:input.recoveryToken},authority));
    await assert.rejects(createNameAssignment({...claims,issuedAt:NaN},authority));
    await assert.rejects(createNameAssignment({...claims,handle:handle.toUpperCase()},authority));
    const wrongType=structuredClone(certificate);wrongType.type='3sln-identity-backup';await assert.rejects(verifyNameAssignment(wrongType,authority));
  }
});

test('certificate verification operates on a snapshot of caller-owned input',async()=>{
  const {issuer,entity}=fixture();
  function pauseOnce(method){
    let reached,release,first=true;
    const entered=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const subtle=new Proxy(crypto.subtle,{get(target,key){if(key===method)return async(...args)=>{if(first){first=false;reached();await gate;}return target[key](...args);};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
    return {crypto:{subtle,getRandomValues:crypto.getRandomValues.bind(crypto)},entered,release};
  }
  const certificate=await createNameAssignment({issuer,entity,handle:'n.2a',assignmentId:crypto.randomUUID(),issuedAt:Date.now()},authority);
  const verification=pauseOnce('verify'),pending=verifyNameAssignment(certificate,authority,{entity},{crypto:verification.crypto});
  await verification.entered;certificate.entity=crypto.randomUUID();certificate.handle='attacker-name';certificate.recoveryToken='private-credential';verification.release();
  const verified=await pending;
  assert.equal(verified.entity,entity);assert.equal(verified.handle,'n.2a');assert.equal(verified.recoveryToken,undefined);
});
