import test from 'node:test';import assert from 'node:assert/strict';
import {createFinancialOwnerProofs}from'../financial-owner-proofs.mjs';
const issuer='https://identity.example/api/auth',owner={issuer,subject:'alice',sessionId:'actual-resolved-native-sid'};
const request=()=>new Request('https://identity.example/api/hosted/billing/checkout',{method:'POST',headers:{'x-waypo-expected-user':'alice'}});
function fixture(options={}){let at=1000,nonce=0,allowed=true;const calls=[],api=createFinancialOwnerProofs({issuer,clock:()=>at,random:()=>new Uint8Array(32).fill(++nonce),authorizeOwnerInTransaction:async(tx,caller)=>{calls.push({tx,caller});return allowed;},...options});return{api,calls,at:value=>at=value,allow:value=>allowed=value};}
test('private operation proof rechecks the exact owner and transaction, is request-bound for disclosure and disappears at completion',async()=>{
 const f=fixture(),tx={},original=request();let saved;
 await f.api.withOwner({request:original,owner},async proof=>{saved=proof;const input={subject:'alice',...proof};assert.equal(await f.api.authorizeInTransaction(tx,input),true);assert.equal(f.calls[0].tx,tx);assert.deepEqual(f.calls[0].caller,owner);assert.equal(await f.api.authorizeDisclosure(tx,{...input,request:original,owner}),true);assert.equal(await f.api.authorizeDisclosure(tx,{...input,request:request(),owner}),false);assert.equal(await f.api.authorizeDisclosure(tx,{...input,request:original,owner:{...owner,sessionId:'other-sid'}}),false);assert.equal(await f.api.authorizeInTransaction(tx,{...input,subject:'bob'}),false);f.allow(false);assert.equal(await f.api.authorizeInTransaction(tx,input),false);});
 assert.equal(await f.api.authorizeInTransaction(tx,{subject:'alice',...saved}),false);f.api.close();
});
test('expiry or cancellation while the actual owner check awaits cannot become positive authority',async()=>{
 let release,entered;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),f=fixture({authorizeOwnerInTransaction:async()=>{entered();await held;return true;}}),controller=new AbortController(),original=new Request(request(),{signal:controller.signal});
 await f.api.withOwner({request:original,owner},async proof=>{const check=f.api.authorizeInTransaction({}, {subject:'alice',...proof});await ready;controller.abort();release();assert.equal(await check,false);});f.api.close();
 const g=fixture({ttlMs:10});await g.api.withOwner({request:request(),owner},async proof=>{g.at(1010);assert.equal(await g.api.authorizeInTransaction({}, {subject:'alice',...proof}),false);});g.api.close();
});
test('finite concurrent proof stock, closed owners/origins, nonce collision and cleanup fail closed',async()=>{
 const f=fixture({maxProofs:1});await f.api.withOwner({request:request(),owner},async()=>{await assert.rejects(f.api.withOwner({request:request(),owner},async()=>{}),/financial_owner_busy/);});
 for(const bad of [{request:new Request('https://other.example/'),owner},{request:request(),owner:{...owner,verified:true}},{request:request(),owner:{...owner,issuer:'https://other.example/api/auth'}}])await assert.rejects(f.api.withOwner(bad,async()=>{}),/financial_owner_required/);
 await assert.rejects(f.api.withOwner({request:request(),owner},async()=>{throw Error('operation failed');}),/operation failed/);await f.api.withOwner({request:request(),owner},async()=>{});f.api.close();await assert.rejects(f.api.withOwner({request:request(),owner},async()=>{}),/financial_owner_required/);
 const g=fixture({random:()=>new Uint8Array(32)});await g.api.withOwner({request:request(),owner},async()=>{await assert.rejects(g.api.withOwner({request:request(),owner},async()=>{}),/financial_owner_nonce_collision/);});g.api.close();
});
