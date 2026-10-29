// Wargame 2026-10-23: the EU/UK representative block covers EU territories with their own ISO codes, and an unknown
// location (Cloudflare XX, Tor T1, or none) fails closed on the Worker. Node owns its policy (REGION_POLICY).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ageRequirement,callerAgeRequirement,regionPolicy,requestAgeLocation,UNKNOWN_COUNTRY} from '../packages/identity/age-policy.mjs';
import {createNodeServer} from '../apps/node/server.mjs';

// EU outermost regions (TFEU Art. 349/355(1)) and Aland (Art. 355(4)) are EU territory where GDPR applies;
// Cloudflare geolocates them with their own ISO 3166-1 codes, not FR/FI.
const EU_TERRITORIES={GP:'Guadeloupe',MQ:'Martinique',GF:'French Guiana',RE:'Reunion',YT:'Mayotte',MF:'Saint-Martin',AX:'Aland'};
for(const [code,name] of Object.entries(EU_TERRITORIES))test(`B5: signup from ${name} (${code}) is blocked for the EU representative reason`,async()=>{
 const r=await callerAgeRequirement({country:code});
 assert.equal(r.blocked,true,`${code} reported ${JSON.stringify(r)}`);assert.equal(r.blockedReason,'representative');
});
test('B5 control: metropolitan FR is blocked',()=>{assert.equal(ageRequirement({country:'FR'}).blocked,true);});

test('region policy: Worker production fails closed, local development and Node defaults allow unknown, invalid values block',()=>{
 assert.equal(regionPolicy({}),'block-unknown');assert.equal(regionPolicy({LOCAL_DEVELOPMENT:'false'}),'block-unknown');
 assert.equal(regionPolicy({LOCAL_DEVELOPMENT:'true',APP_ORIGIN:'http://localhost:8787'}),'allow-unknown');assert.equal(regionPolicy({LOCAL_DEVELOPMENT:'true',APP_ORIGIN:'http://127.0.0.1:8788'}),'allow-unknown');
 // L6: LOCAL_DEVELOPMENT=true on a deployed or missing origin still fails closed.
 for(const APP_ORIGIN of [undefined,'https://3sln.me','http://3sln.me','https://localhost','http://localhost.example'])assert.equal(regionPolicy({LOCAL_DEVELOPMENT:'true',APP_ORIGIN}),'block-unknown',String(APP_ORIGIN));assert.equal(regionPolicy({REGION_POLICY:'allow-unknown'}),'allow-unknown');
 assert.equal(regionPolicy({REGION_POLICY:'block-unknown',LOCAL_DEVELOPMENT:'true'}),'block-unknown');assert.equal(regionPolicy({REGION_POLICY:'allow'}),'block-unknown');
});
test('region policy: XX, T1 and a missing country are blocked under block-unknown with a distinct reason',()=>{
 for(const cf of [{country:'XX'},{country:'T1'},{},undefined,{country:'de'}]){const location=requestAgeLocation({cf},{REGION_POLICY:'block-unknown'});assert.deepEqual(location,{country:UNKNOWN_COUNTRY,region:null},JSON.stringify(cf));const r=ageRequirement(location);assert.equal(r.blocked,true);assert.equal(r.blockedReason,'region-unknown');}
 for(const cf of [{country:'XX'},{country:'T1'},{}]){const location=requestAgeLocation({cf},{REGION_POLICY:'allow-unknown'});assert.deepEqual(location,{country:null,region:null});assert.equal(ageRequirement(location).blocked,false);}
 assert.deepEqual(requestAgeLocation({cf:{country:'US',regionCode:'TN'}},{}),{country:'US',region:'TN'});assert.equal(ageRequirement(requestAgeLocation({cf:{country:'US',regionCode:'TN'}},{})).blockedReason,'age');
 // A raw XX is never treated as a country.
 assert.equal(ageRequirement({country:'XX'}).blocked,true);
});
test('region policy: only an injected function port supplies a location without cf; strings and request headers do not',()=>{
 const request=new Request('https://node.example/',{headers:{'CF-IPCountry':'US','X-Bindle-Node-Country':'US'}});
 assert.deepEqual(requestAgeLocation(request,{REGION_POLICY:'block-unknown',REGION_LOCATION_SOURCE:'US'}),{country:UNKNOWN_COUNTRY,region:null});
 assert.deepEqual(requestAgeLocation(request,{REGION_POLICY:'block-unknown',REGION_LOCATION_SOURCE:()=>({country:'US'})}),{country:'US',region:null});
 // Cloudflare's own location wins over any adapter port.
 assert.deepEqual(requestAgeLocation({cf:{country:'DE'}},{REGION_LOCATION_SOURCE:()=>({country:'US'})}),{country:'DE',region:null});
});

async function node(t,config){
 const directory=await mkdtemp(join(tmpdir(),'bindle-region-'));const app=await createNodeServer({directory,config});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const host=new URL(config.APP_ORIGIN).host,port=app.server.address().port;
 const call=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,headers:{host,...body?{'content-type':'application/json'}:{},...headers}},res=>{let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:text?JSON.parse(text):null}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});
 return {app,call,requirement:async headers=>(await call('/api/config',{headers})).body.ageRequirement};
}
const spoofed={'cf-ipcountry':'DE','x-bindle-node-country':'XX','x-forwarded-for':'203.0.113.9'};
test('Node adapter: unknown locations are allowed by default (self-hosting policy) and client country headers are ignored',async t=>{
 const n=await node(t,{APP_ORIGIN:'https://node.example'});
 const r=await n.requirement(spoofed);assert.equal(r.blocked,false,JSON.stringify(r));
});
test('Node adapter: block-unknown without a trusted header blocks signup, even with spoofed country headers',async t=>{
 const n=await node(t,{APP_ORIGIN:'http://localhost:8788',REGION_POLICY:'block-unknown'});
 const r=await n.requirement({...spoofed,'x-bindle-node-country':'US'});assert.equal(r.blocked,true);assert.equal(r.blockedReason,'region-unknown');
 const response=await n.call('/api/auth/signup',{method:'POST',headers:{origin:'http://localhost:8788','x-bindle-node-country':'US'},body:{handle:'region_node',method:'passkey',termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token',ageConfirmed:18}});
 assert.equal(response.status,403,JSON.stringify(response.body));assert.equal(response.body.error,'signup_region_blocked');
});
test('Node adapter: an operator-configured trusted country header supplies the location',async t=>{
 const n=await node(t,{APP_ORIGIN:'https://node.example',REGION_POLICY:'block-unknown',TRUSTED_COUNTRY_HEADER:'X-Edge-Country'});
 assert.equal((await n.requirement({'x-edge-country':'US'})).blocked,false);
 const eu=await n.requirement({'x-edge-country':'re'});assert.equal(eu.blocked,true);assert.equal(eu.blockedReason,'representative');
 assert.equal((await n.requirement({'x-edge-country':'XX'})).blockedReason,'region-unknown');
 assert.equal((await n.requirement({'x-bindle-node-country':'US'})).blockedReason,'region-unknown','the internal header cannot be supplied by a client');
 // L5: a present but invalid value (duplicates joined by an appending proxy) is unknown, not absent.
 for(const value of ['US, DE','USA','']){const r=await n.requirement({'x-edge-country':value});assert.equal(r.blockedReason,'region-unknown',JSON.stringify(value));}
});
test('Node adapter L5: under allow-unknown a present but invalid trusted value maps to XX (unknown) and is allowed',async t=>{
 const n=await node(t,{APP_ORIGIN:'https://node.example',TRUSTED_COUNTRY_HEADER:'X-Edge-Country'});
 assert.equal((await n.requirement({'x-edge-country':'DE'})).blockedReason,'representative');assert.equal((await n.requirement({'x-edge-country':'DE, US'})).blocked,false);
});
test('Node adapter: invalid region configuration fails at startup',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-region-'));try{
  await assert.rejects(createNodeServer({directory,config:{APP_ORIGIN:'https://node.example',REGION_POLICY:'maybe'}}),/REGION_POLICY/);
  await assert.rejects(createNodeServer({directory,config:{APP_ORIGIN:'https://node.example',TRUSTED_COUNTRY_HEADER:'bad header'}}),/TRUSTED_COUNTRY_HEADER/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
