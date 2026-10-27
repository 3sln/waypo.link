// RTC-i regression (bug 1 and divergence 10): the real Node provider with its DEFAULT wiring, no test seams. No
// RTC_BOUND_CHECK is injected (apps/node uses the owner's federation shard checkBound) and no FEDERATION_SCHEMAS or
// FEDERATION_CONTRACTS are registered (the slot manifest and the rtc-signaling/v1 contract ship as first-party
// documents while RTC_SIGNALING_ENABLED and EXTENSIONS_ENABLED are on). An application connects through the real
// authorization request, owner consent, token and /bindle/rpc routes, and its contract writes must answer.
//
// Before the fix, `register` never answered: the contract handler runs inside the owner's account gate, the default
// bound check called the federation shard, whose boundApproval called back into the same account (appConnectionCheck)
// from inside the shard's store transaction, so the account gate and the shard gate waited on each other. The same
// cycle formed between two concurrent RPCs (the shard's token check calls the account inside a shard transaction). The
// handler now takes the bound approval from the verified dispatch context and never calls the shard.
// Local behaviour only: loopback HTTP, no peer provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import http from 'node:http';
import {createNodeServer} from '../apps/node/server.mjs';
import {RTC_SIGNALING_SLOT,RTC_SIGNALING_CONTRACT,RTC_SIGNALING_METHODS} from '../packages/rtc/extension.mjs';
import {RTC_PURPOSE_REFERENCES} from '../packages/rtc/purposes.mjs';
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import shipped from '../docs/artefacts/rtc-signaling-v1.json' with {type:'json'};

const ORIGIN='https://rtc-default.example',APP={id:'https://app.example/client',name:'Default wiring app',origin:'https://app.example',redirectUris:['https://app.example/callback']};
const CALL=RTC_PURPOSE_REFERENCES[0].artefact;
const within=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label}: no answer within ${ms} ms`)),ms).unref())]);

async function boot(t,extra={}){
 const directory=await mkdtemp(join(tmpdir(),'rtc-default-'));
 const config={APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',WORK_LIMITS_ENABLED:'false',FEDERATION_ENABLED:'true',EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',DIRECTORY_ENABLED:'true',RTC_SIGNALING_ENABLED:'true',RTC_TICKETS_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([APP]),...extra};
 const app=await createNodeServer({directory,config});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.server.closeAllConnections?.();await app.close();await rm(directory,{recursive:true,force:true});});
 const port=app.server.address().port;
 // node:http (fetch cannot set Host): real loopback HTTP with the provider's configured host.
 const request=(path,{method='GET',data,cookie,csrf,bearer,origin=ORIGIN}={})=>new Promise((resolve,reject)=>{
  const body=data===undefined?undefined:Buffer.from(JSON.stringify(data));
  const req=http.request({host:'127.0.0.1',port,path,method,headers:{Host:new URL(ORIGIN).host,Origin:origin,...body?{'Content-Type':'application/json','Content-Length':body.length}:{},...cookie?{Cookie:cookie}:{},...csrf?{'X-CSRF-Token':csrf}:{},...bearer?{Authorization:`Bearer ${bearer}`}:{}}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:Object.entries(res.headers).flatMap(([k,v])=>Array.isArray(v)?v.map(x=>[k,x]):[[k,String(v)]])})));});
  req.on('error',reject);if(body)req.write(body);req.end();});
 const post=(path,data,options={})=>request(path,{...options,method:'POST',data});
 return {app,request,post};
}

async function connect(w,purposes=[CALL]){
 const pending=await (await w.post('/api/auth/signup',{method:'password',password:'A durable default wiring test password!',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();
 const recovery=await (await w.post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
 const activation=await w.post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true});
 assert.equal(activation.status,200,'signup');
 const session=await activation.json(),owner={cookie:activation.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken};
 const verifier=randomUUID()+randomUUID(),challenge=createHash('sha256').update(verifier).digest('base64url');
 const r=await w.post('/api/oauth/requests',{clientId:APP.id,redirectUri:APP.redirectUris[0],challenge,challengeMethod:'S256',state:'s',identity:session.account.handle+'@'+new URL(ORIGIN).host,requests:[{fragment:RTC_SIGNALING_SLOT,required:true,purpose:'Calls',fields:['signaling'],methods:{signaling:{[RTC_SIGNALING_CONTRACT]:[...RTC_SIGNALING_METHODS]}},options:{purposes:[...purposes]}}]},{origin:APP.origin});
 const created=await r.json();assert.equal(r.status,201,'the slot is requestable without operator registration: '+JSON.stringify(created));
 let view=await (await w.request('/api/oauth/requests/'+created.requestId,owner)).json();
 const rtc=view.requests[0].resources.find(x=>x.id.endsWith('/rtc')).id;
 assert.equal((await w.post('/api/preferences',{fragment:RTC_SIGNALING_SLOT,expectedRevision:null,values:{signaling:rtc}},owner)).status,200,'occupant assignment');
 view=await (await w.request('/api/oauth/requests/'+created.requestId,owner)).json();
 const d=await w.post('/api/oauth/requests/'+created.requestId+'/decision',{requestId:created.requestId,approved:[{fragment:RTC_SIGNALING_SLOT,revision:view.requests[0].revision,fields:['signaling'],resources:{signaling:[rtc]},methods:view.requests[0].methods,options:{purposes:[...purposes]}}]},owner);
 const decision=await d.json();assert.equal(d.status,200,JSON.stringify(decision));
 const token=await (await w.post('/oauth/token',{clientId:APP.id,redirectUri:APP.redirectUris[0],code:new URL(decision.redirectUri).searchParams.get('code'),verifier},{origin:APP.origin})).json();
 const rpc=(bearer,resource,contract,method,args={})=>w.post('/bindle/rpc',{version:'0',tx:randomUUID(),resource,contract,method,args},{bearer,origin:APP.origin});
 const prefs=await (await rpc(token.access_token,'@preferences','https://3sln.me/artefacts/contracts/preferences/v1','read',{fragment:RTC_SIGNALING_SLOT})).json();
 const ref=prefs.result?.values?.signaling;assert.ok(ref,'preferences read: '+JSON.stringify(prefs));
 return {owner,session,call:async(method,args={})=>{const res=await rpc(ref.token,ref.id,RTC_SIGNALING_CONTRACT,method,args);return {status:res.status,...await res.json()};}};
}

test('RTC-i bug 1: contract writes answer through /bindle/rpc with the default Node bound check (no seams)',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 const reg=await within(c.call('register',{purposes:[CALL]}),10000,'register');
 assert.equal(reg.status,200,JSON.stringify(reg));
 assert.match(reg.result.endpoint,/^[A-Za-z0-9_-]+$/);assert.equal(typeof reg.result.endpoint_secret,'string');assert.ok(Number.isSafeInteger(reg.result.expires_at));
 const ep={endpoint:reg.result.endpoint,endpoint_secret:reg.result.endpoint_secret};
 // A second write right after the first (the account gate and the shard gate were both stuck before the fix).
 const minted=await within(c.call('mint_ticket',{purposes:[CALL],uses:2,expires_in:3600}),10000,'mint_ticket');
 assert.equal(minted.status,200,JSON.stringify(minted));assert.match(minted.result.link,/^https:\/\/rtc-default\.example\//);
 // The shipped contract's result shapes keep every member the occupant returns (nothing withheld by shaping).
 const listed=await within(c.call('endpoints'),10000,'endpoints');
 assert.deepEqual(Object.keys(listed.result.endpoints[0]).sort(),['endpoint','label','last_seen','purposes']);
 const heard=await within(c.call('listen',{...ep,wait:0}),10000,'listen');
 assert.equal(heard.status,200,JSON.stringify(heard));assert.deepEqual(Object.keys(heard.result).sort(),['cursor','events','gap']);
 // An unapproved purpose is still refused live (the default bound check approves only what the owner approved).
 const other=await within(c.call('register',{purposes:[RTC_PURPOSE_REFERENCES[1].artefact]}),10000,'register (unapproved)');
 assert.equal(other.error?.code,'forbidden',JSON.stringify(other));
});

test('RTC-i bug 1: concurrent contract writes for one owner all answer (no account-gate / shard-gate cycle)',{timeout:60000},async t=>{
 // The second form of the cycle: RPC B's token check holds the shard gate while it waits on the account gate that RPC A
 // holds; if A's bound check then needed the shard, neither would answer. A's approval now rides in its context.
 const w=await boot(t),c=await connect(w);
 const results=await within(Promise.all(Array.from({length:4},()=>c.call('register',{purposes:[CALL]}))),15000,'four concurrent registers');
 for(const r of results)assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(new Set(results.map(r=>r.result.endpoint)).size,4);
});

test('RTC-i bug 1: a disconnected application is refused by the default bound check, not approved from stale state',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 assert.equal((await within(c.call('register',{purposes:[CALL]}),10000,'register')).status,200);
 const apps=await (await w.request('/api/apps',c.owner)).json();
 const id=(apps.connections??apps.apps??apps)[0]?.id;assert.ok(id,'app connection listed: '+JSON.stringify(apps));
 const cut=await w.request('/api/apps/'+encodeURIComponent(id),{...c.owner,method:'DELETE'});assert.ok([200,204].includes(cut.status),'disconnect: '+cut.status);
 const after=await within(c.call('register',{purposes:[CALL]}),10000,'register after disconnect');
 assert.notEqual(after.status,200,JSON.stringify(after));
});

test('RTC-i divergence 2: the shipped contract carries contract-level x-bindle-brokerable:false and compiles; the marker is root-only',()=>{
 assert.equal(shipped['x-bindle-brokerable'],false);assert.equal(shipped.$id,RTC_SIGNALING_CONTRACT);
 assert.deepEqual(Object.keys(shipped['x-methods']).sort(),[...RTC_SIGNALING_METHODS].sort());
 const v=compileContractVersion(structuredClone(shipped));
 assert.equal(v.validate({method:'register',args:{purposes:[CALL]}}),true);
 assert.equal(v.validate({method:'register',args:{purposes:[CALL],extra:1}}),false,'unknown argument members are refused');
 assert.equal(compileContractVersion({...structuredClone(shipped),'x-bindle-brokerable':true}).validate({method:'endpoints',args:{}}),true);
 for(const bad of [{...structuredClone(shipped),'x-bindle-brokerable':'false'},{...structuredClone(shipped),$defs:{...shipped.$defs,jwk:{...shipped.$defs.jwk,'x-bindle-brokerable':false}}}]){
  const compiled=compileContractVersion(bad);
  assert.throws(()=>{compiled.validate({method:'endpoints',args:{}});compiled.shape('open',{sid:'s',peer_keys:[{jwk:{}}]});},{code:'artefact_unverifiable'});
 }
});

// RTC-i review M1: removing an application that holds an RTC bound grant. The owner's force removal ran inside the
// account gate and awaited the external revocation cascade (the federation shard's removalRevoke), whose boundSync
// hook calls the same account's rtcAppChanged (gated): the account gate waited on itself. With an RPC of that app in
// flight a second cycle formed (the shard's tokenRecord holds the shard transaction and waits on the account gate).
// The cascade drains now run after the gated commit, outside the account gate, as the alarm runs them.
const appConnection=async(w,c)=>{const apps=await (await w.request('/api/apps',c.owner)).json();const row=(apps.apps??apps.connections??apps).find(a=>a.clientId===APP.id&&a.status!=='disconnected');assert.ok(row,'app connection listed: '+JSON.stringify(apps));return row;};
const force=(w,c,row)=>w.post('/api/apps/removal/force',{connection:row.id,expectedGeneration:row.generation},c.owner);

test('RTC-i review M1: force-removing an app that holds an RTC bound grant answers and ends its RTC state',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 const reg=await within(c.call('register',{purposes:[CALL]}),10000,'register');assert.equal(reg.status,200,JSON.stringify(reg));
 const before=await (await w.request('/api/rtc/settings',c.owner)).json();assert.equal(before.endpoints?.length,1,JSON.stringify(before.endpoints));
 const row=await appConnection(w,c),res=await within(force(w,c,row),15000,'force removal');
 const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
 // The account answers afterwards (its gate is free) and the app's credentials no longer work.
 const after=await within(c.call('endpoints'),10000,'endpoints after removal');assert.notEqual(after.status,200,JSON.stringify(after));
 // The cascade's rtcAppChanged (shard boundSync, outside the gate now) and the connection cascade ended the app's RTC state.
 const settled=await within(w.request('/api/rtc/settings',c.owner),10000,'settings after removal');assert.equal(settled.status,200);
 assert.deepEqual((await settled.json()).endpoints,[]);
});

test('RTC-i review M1: force removal with an RPC of that app in flight answers (no account-gate / shard-gate cycle)',{timeout:90000},async t=>{
 const w=await boot(t),c=await connect(w);
 assert.equal((await within(c.call('register',{purposes:[CALL]}),10000,'register')).status,200);
 const row=await appConnection(w,c);
 const inflight=Array.from({length:6},()=>c.call('endpoints'));
 const res=await within(Promise.all([force(w,c,row),...inflight]),20000,'force removal with RPCs in flight');
 assert.equal(res[0].status,200,'force removal');
 for(const r of res.slice(1))assert.ok([200,401,403,404].includes(r.status),JSON.stringify(r));
 assert.equal((await within(w.request('/api/apps',c.owner),10000,'apps after removal')).status,200);
});

// RTC-i review L1: the dispatch approval is computed in the RPC's authorization transaction in the shard. A narrowing
// that commits after it, and whose hook (boundSync -> rtcAppChanged) enters the account gate before the RPC does, must
// not be bypassed by that older snapshot. The RPC is held between the shard and the account (a latch on the account's
// federationRPC entry) while the owner narrows the app to CALL; released, its register for SYNC must be refused.
test('RTC-i review L1: an RPC authorized before an owner narrowing, entering the gate after its hook, is refused for the removed purpose',{timeout:60000},async t=>{
 const SYNC=RTC_PURPOSE_REFERENCES[1].artefact,w=await boot(t),c=await connect(w,[CALL,SYNC]);
 assert.equal((await within(c.call('register',{purposes:[SYNC]}),10000,'register before')).status,200,'SYNC is approved at first');
 // The writer is a flag proxy over the controller: the latch is an own property of the controller, set and deleted
 // through the proxy, over the prototype's invoke (so the proxy's flag pinning still wraps it).
 const account=w.app.resources.accounts.get(c.session.account.id),invoke=Object.getPrototypeOf(account).invoke;let release,arrived;
 const latch=new Promise(r=>release=r),reached=new Promise(r=>arrived=r);
 account.invoke=async function(request){if(request?.method==='federationRPC'){arrived();await latch;}return invoke.call(this,request);};
 t.after(()=>{release();delete account.invoke;});
 const pending=c.call('register',{purposes:[SYNC]});
 await within(reached,10000,'the RPC reached the account');
 const narrowed=await within(w.post('/api/rtc/narrow-app',{clientId:APP.id,purposes:[CALL]},c.owner),10000,'narrow-app');
 assert.equal(narrowed.status,200,await narrowed.clone().text());
 release();delete account.invoke;
 const stale=await within(pending,10000,'register after narrowing');
 assert.equal(stale.error?.code,'forbidden',JSON.stringify(stale));
 // CALL is still approved; a fresh RPC (authorized after the narrowing) for SYNC is refused as before.
 assert.equal((await within(c.call('register',{purposes:[CALL]}),10000,'register CALL')).status,200);
 assert.equal((await within(c.call('register',{purposes:[SYNC]}),10000,'register SYNC')).error?.code,'forbidden');
});

// RTC-i review L3: one precedence for the shipped first-party documents. While RTC_SIGNALING_ENABLED and
// EXTENSIONS_ENABLED are on, the shipped rtc-signaling/v1 contract wins over an operator registration of the same id
// for BOTH the plain id and its `/envelope`, as the built-in slot manifest replaces an operator fragment. An operator
// that registered only the plain id never gets mixed bodies. With a flag off, operator registrations apply.
test('RTC-i review L3: the shipped contract and slot manifest win consistently over operator registrations while the flags are on',async()=>{
 const {configuredArtefactDocuments}=await import('../packages/runtime/artefact-pins.mjs');
 const {federationSchemas}=await import('../packages/runtime/federation.mjs');
 const operator={...structuredClone(shipped),title:'Operator registration'},slot={id:RTC_SIGNALING_SLOT,title:'Operator slot',fields:{}};
 const on={EXTENSIONS_ENABLED:'true',RTC_SIGNALING_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'};
 for(const registered of [{[RTC_SIGNALING_CONTRACT]:operator},{[RTC_SIGNALING_CONTRACT+'/envelope']:{bindle_artefact:1,id:RTC_SIGNALING_CONTRACT,kind:'rpc-contract',versions:[{version:1,prev:null,body:operator}]}},{[RTC_SIGNALING_CONTRACT]:operator,[RTC_SIGNALING_CONTRACT+'/envelope']:{bindle_artefact:1,id:RTC_SIGNALING_CONTRACT,kind:'rpc-contract',versions:[{version:1,prev:null,body:operator}]}}]){
  const docs=configuredArtefactDocuments({...on,FEDERATION_CONTRACTS:JSON.stringify(registered),FEDERATION_SCHEMAS:JSON.stringify({[RTC_SIGNALING_SLOT]:slot})});
  assert.equal(docs[RTC_SIGNALING_CONTRACT].title,shipped.title,'plain id: shipped ('+Object.keys(registered)+')');
  assert.equal(docs[RTC_SIGNALING_CONTRACT+'/envelope'].versions[0].body.title,shipped.title,'envelope: shipped ('+Object.keys(registered)+')');
  assert.notEqual(docs[RTC_SIGNALING_SLOT].title,'Operator slot','the built-in slot manifest wins too');
  assert.notEqual(federationSchemas({...on,FEDERATION_SCHEMAS:JSON.stringify({[RTC_SIGNALING_SLOT]:slot})})[RTC_SIGNALING_SLOT].title,'Operator slot');
 }
 // Either flag off: nothing first-party is added, so an operator registration applies.
 for(const off of [{RTC_SIGNALING_ENABLED:'false'},{EXTENSIONS_ENABLED:'false'}]){
  const docs=configuredArtefactDocuments({...on,...off,FEDERATION_CONTRACTS:JSON.stringify({[RTC_SIGNALING_CONTRACT]:operator})});
  assert.equal(docs[RTC_SIGNALING_CONTRACT].title,'Operator registration');assert.equal(docs[RTC_SIGNALING_CONTRACT+'/envelope'],undefined);
 }
});
