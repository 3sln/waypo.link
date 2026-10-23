import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateRemoval,buildRemovalClaims,peekRemovalRequest,verifyRemovalRequest,parseRemovalResult,parseRemovalReturn,verifyRemovalAssertion} from '../packages/federation/removal.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
const crypto=webcrypto,issuer='https://provider.example',subject=issuer+'/entities/one',clientId='https://app.example/bindle/client.json',returnUri=issuer+'/apps/removal/return',now=1800000000000,removal='rm_1234567890123456789012';
const enc=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const base={issuer,subject,clientId,removal,cleanupBy:now/1000+900,returnUri};
const result={v:1,items:[{label:'Messages',disposition:'kept',location:'owner-storage'}],message:'Stored for you.'};
async function signer(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),kid='removal.1234567890123456789012',jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256',use:'sig'};return {jwk,async sign(claims,header={alg:'ES256',typ:'bindle-removal+jwt',kid}){const input=enc(header)+'.'+enc(claims);return input+'.'+Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(input))).toString('base64url');}};}
test('removal member is prefix-bound, distinct and public back-channel is false',()=>{
 const value={uri:'https://app.example/bindle/remove',cleanup_seconds:60,back_channel:true};assert.deepEqual(validateRemoval(value,{clientId}),{...value,back_channel:false});assert.equal(validateRemoval(value,{clientId,confidential:true}).back_channel,true);
 for(const patch of [{uri:'https://app.example/remove'},{uri:value.uri+'?x=1'},{uri:'https://elsewhere.example/remove'},{cleanup_seconds:59},{cleanup_seconds:86401},{cleanup_seconds:60.5},{back_channel:'true'}])assert.equal(validateRemoval({...value,...patch},{clientId}),undefined);
 for(const field of ['initiateLoginUri','managementUrl','eventsEndpoint','rpcEndpoint','discoveryEndpoint'])assert.equal(validateRemoval(value,{clientId,[field]:value.uri}),undefined);assert.equal(validateRemoval(value,{clientId,redirectUris:[value.uri]}),undefined);
 const parsed=validateIntegrationManifest({v:1,removal:value},{clientId});assert.equal(parsed.status,'valid');assert.equal(parsed.manifest.removal.back_channel,false);
});
test('request claims include optional organization actor and conceal public connection',()=>{
 const c=buildRemovalClaims(base,{clock:()=>now,crypto});assert.equal(c.exp-c.iat,300);assert.equal(c.bindle.connection,undefined);assert.equal(c.jti.length,22);
 const actor={iss:'https://home.example',sub:'https://home.example/entities/admin'};assert.deepEqual(buildRemovalClaims({...base,actor,connection:'c_1',generation:3},{clock:()=>now,crypto}).bindle.actor,actor);
 for(const patch of [{lifetime:301},{lifetime:0},{generation:1,connection:'bad space'},{actor:{iss:issuer}},{returnUri:'https://evil.example/return'},{jti:'short'}])assert.throws(()=>buildRemovalClaims({...base,...patch},{clock:()=>now,crypto}));
});
test('verified request checks local relationship before keys and consumes nonce last',async()=>{
 const s=await signer(),c=buildRemovalClaims(base,{clock:()=>now,crypto}),token=await s.sign(c),calls=[],options={issuer,clientId,returnUri,now,crypto,relationship:async()=>{calls.push('relationship');return true;},keys:async()=>{calls.push('keys');return {keys:[s.jwk]};},replay:async()=>{calls.push('replay');return true;}};
 assert.equal(peekRemovalRequest(token).sub,subject);assert.deepEqual((await verifyRemovalRequest(token,options)).claims,c);assert.deepEqual(calls,['relationship','keys','replay']);calls.length=0;
 await assert.rejects(verifyRemovalRequest(token,{...options,relationship:()=>false}));assert.deepEqual(calls,[]);
 for(const patch of [{aud:'https://foreign.example/client.json'},{exp:c.iat+301},{iat:c.iat+31,exp:c.iat+200},{exp:c.iat-31,iat:c.iat-100},{bindle:{...c.bindle,return_uri:issuer+'/other'}}])await assert.rejects(verifyRemovalRequest(await s.sign({...c,...patch}),options));
 await assert.rejects(verifyRemovalRequest(token,{...options,replay:()=>false}));await assert.rejects(verifyRemovalRequest(token,{...options,keys:{keys:[s.jwk,s.jwk]}}));
 await assert.rejects(verifyRemovalRequest(await s.sign(c,{alg:'ES256',typ:'at+jwt',kid:s.jwk.kid}),options));assert.throws(()=>peekRemovalRequest(token+'.x'));
});
test('front outcomes survive bad result while strict result schema discards controls and oversize',()=>{
 assert.deepEqual(parseRemovalResult(enc(result)),result);
 for(const v of [{...result,v:2},{...result,message:'bad\ntext'},{...result,message:'x'.repeat(501)},{...result,items:Array(17).fill(result.items[0])},{...result,items:[{...result.items[0],note:'\u202eevil'}]},{...result,items:[{...result.items[0],location:'unknown'}]}])assert.equal(parseRemovalResult(enc(v)),undefined);
 assert.equal(parseRemovalResult(enc('x'.repeat(2049))),undefined);assert.equal(parseRemovalResult(enc(result)+'='),undefined);
 for(const outcome of ['completed','failed','canceled','in-progress'])assert.deepEqual(parseRemovalReturn(new URLSearchParams({removal,outcome,result:'bad'})),{removal,outcome});
 assert.equal(parseRemovalReturn('removal=a&removal=b&outcome=completed'),undefined);assert.equal(parseRemovalReturn(new URLSearchParams({removal,outcome:'in-progress'}),{backChannel:true}),undefined);
});
test('back-channel assertion binds removal before replay or signature lookup',async()=>{
 const s=await signer(),claims={iss:clientId,sub:clientId,aud:issuer+'/complete',iat:now/1000,exp:now/1000+60,jti:'1234567890123456',bindle_removal:removal},token=await s.sign(claims,{alg:'ES256',typ:'JWT',kid:s.jwk.kid});let replay=0;const options={removal,clientId,audience:claims.aud,keys:[s.jwk],now,crypto,replay:()=>{replay++;return true;}};
 assert.equal((await verifyRemovalAssertion(token,options)).bindle_removal,removal);assert.equal(replay,1);await assert.rejects(verifyRemovalAssertion(token,{...options,removal:'different'}));assert.equal(replay,1);
});
test('authority signer uses separated purpose; unknown local clients cause no key fetch',async()=>{
 const {federationAuthority}=await import('../packages/runtime/federation.mjs');const owner='00000000-0000-4000-8000-000000000001';let fetched=0,signed;
 const authority=federationAuthority({config:{APP_ORIGIN:issuer,KEY_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),INTEGRATION_EVENT_PORTS:{signer:{sign:(purpose,claims)=>{signed={purpose,claims};return {token:'signed'};}}}},clock:()=>now,repository:{get:async()=>({status:'active'})},shard:()=>({integrationClientAuth:async()=>null}),directory:{resolveKeys:async()=>{fetched++;}}});
 assert.deepEqual(await authority.removalSign(base),{token:'signed'});assert.equal(signed.purpose,'removal');assert.equal(signed.claims.bindle.purpose,'remove');await assert.rejects(authority.removalVerifyAssertion({owner,clientId,removal,assertion:'unknown'}));assert.equal(fetched,0);
});
