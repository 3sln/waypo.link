// Signaling no-hang regression (retargeted from rtc-bound-default.test.mjs for signaling rev 3.2; spec §21.2 "kind
// approval is checked without a federation-shard call", Appendix C.4: the no-hang part is kept). The real Node provider
// with its DEFAULT wiring, no test seams: no FEDERATION_SCHEMAS is registered (the signaling fragment and the
// signaling/v1 contract ship as first-party documents while SIGNALING_ENABLED and EXTENSIONS_ENABLED are on); the only
// operator registration is the app-published session kind (FEDERATION_CONTRACTS, as an operator pins a kind). An
// application connects through the real authorization request (the ordinary fragment, no options), owner consent,
// token and /bindle/rpc routes; the owner then approves the app for the kind through POST /api/intents/session-approve
// (the session handler approval, AMD-SG-I1, whose P1 evidence the owner stage reads from the owner's grants), after the
// approval page's review (POST /api/signaling/review, packages/signaling/owner-pages.mjs).
//
// The deadlock class RTC-i bug 1 guarded (the contract handler, inside the owner's account gate, calling the federation
// shard, whose check called back into the account) no longer applies to kind approvals: the approval is the account's
// own intents memory, read by the engine inside its own gate. The cases stay as no-hang regressions for contract
// writes, concurrent writes and app removal with RPCs in flight (RTC-i review M1). Local behaviour only: loopback
// HTTP, no peer provider.
import {bodyInit,rpcAware} from './helpers/rpc.mjs';
import test from 'node:test';
import {reviewedHTTP} from './helpers/signaling-owner-review.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import http from 'node:http';
import {createNodeServer} from '../apps/node/server.mjs';
import {digestJSON,versionRecord,parseEnvelope} from '../packages/core/artefacts.mjs';
import {SIGNALING_FRAGMENT,SIGNALING_CONTRACT,SIGNALING_METHODS} from '../packages/signaling/extension.mjs';
import {kindBody,CHAT,SYNC} from './helpers/signaling-fixture.mjs';
import {softAuthenticator,registerPending} from './helpers/soft-passkey.mjs';

const ORIGIN='https://signaling-default.example',APP={id:'https://app.example/client',name:'Default wiring app',origin:'https://app.example',redirectUris:['https://app.example/callback']};
const envelope=spec=>({bindle_artefact:1,id:spec.line,kind:'intent',versions:[{version:1,prev:null,body:kindBody(spec)}]});
const KINDS=[{line:CHAT,parties:'any'},{line:SYNC,parties:'self'}],ENVELOPES=Object.fromEntries(KINDS.flatMap(k=>{const e=envelope(k);return [[k.line,e],[k.line+'/envelope',e]];}));
const REF=Object.fromEntries(await Promise.all(KINDS.map(async k=>{const e=ENVELOPES[k.line];return [k.line,{artefact:k.line,version:1,digest:await digestJSON(versionRecord(parseEnvelope(e,{id:k.line}),e.versions[0]))}];})));
const within=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label}: no answer within ${ms} ms`)),ms).unref())]);

async function boot(t,extra={}){
 const directory=await mkdtemp(join(tmpdir(),'signaling-default-'));
 const config={APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',WORK_LIMITS_ENABLED:'false',FEDERATION_ENABLED:'true',EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',DIRECTORY_ENABLED:'true',SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([APP]),FEDERATION_CONTRACTS:JSON.stringify(ENVELOPES),...extra};
 const app=await createNodeServer({directory,config});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.server.closeAllConnections?.();await app.close();await rm(directory,{recursive:true,force:true});});
 const port=app.server.address().port;
 // node:http (fetch cannot set Host): real loopback HTTP with the provider's configured host.
 const request=(path,{method='GET',data,cookie,csrf,bearer,origin=ORIGIN}={})=>new Promise((resolve,reject)=>{
  const wire=bodyInit(path,data),body=data===undefined?undefined:Buffer.from(wire.body);
  const req=http.request({host:'127.0.0.1',port,path,method,headers:{Host:new URL(ORIGIN).host,Origin:origin,...body?{...wire.headers,'Content-Length':body.length}:{},...cookie?{Cookie:cookie}:{},...csrf?{'X-CSRF-Token':csrf}:{},...bearer?{Authorization:`Bearer ${bearer}`}:{}}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(rpcAware(new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:Object.entries(res.headers).flatMap(([k,v])=>Array.isArray(v)?v.map(x=>[k,x]):[[k,String(v)]])}))));});
  req.on('error',reject);if(body)req.write(body);req.end();});
 const post=(path,data,options={})=>request(path,{...options,method:'POST',data});
 return {app,request,post};
}

async function connect(w,kinds=[CHAT]){
 const pending=await (await w.post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();
 await registerPending(softAuthenticator({origin:ORIGIN}),async(path,data)=>(await w.post(path,data)).json(),pending);
 const recovery=await (await w.post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
 const activation=await w.post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true});
 assert.equal(activation.status,200,'signup');
 const session=await activation.json(),owner={cookie:activation.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken};
 const verifier=randomUUID()+randomUUID(),challenge=createHash('sha256').update(verifier).digest('base64url');
 const r=await w.post('/api/oauth/requests',{clientId:APP.id,redirectUri:APP.redirectUris[0],challenge,challengeMethod:'S256',state:'s',identity:session.account.handle+'@'+new URL(ORIGIN).host,requests:[{fragment:SIGNALING_FRAGMENT,required:true,purpose:'Connect your devices',fields:['signaling'],methods:{signaling:{[SIGNALING_CONTRACT]:[...SIGNALING_METHODS]}}}]},{origin:APP.origin});
 const created=await r.json();assert.equal(r.status,201,'the fragment is requestable without operator registration: '+JSON.stringify(created));
 let view=await (await w.request('/api/oauth/requests/'+created.requestId,owner)).json();
 const resource=view.requests[0].resources.find(x=>x.id.endsWith('/signaling'))?.id;assert.ok(resource,'the built-in signaling resource is a candidate: '+JSON.stringify(view.requests[0].resources));
 assert.equal((await w.post('/api/preferences',{fragment:SIGNALING_FRAGMENT,expectedRevision:null,values:{signaling:resource}},owner)).status,200,'signaling resource assignment');
 view=await (await w.request('/api/oauth/requests/'+created.requestId,owner)).json();
 const d=await w.post('/api/oauth/requests/'+created.requestId+'/decision',{requestId:created.requestId,approved:[{fragment:SIGNALING_FRAGMENT,revision:view.requests[0].revision,fields:['signaling'],resources:{signaling:[resource]},methods:view.requests[0].methods}]},owner);
 const decision=await d.json();assert.equal(d.status,200,JSON.stringify(decision));
 const token=await (await w.post('/oauth/token',{clientId:APP.id,redirectUri:APP.redirectUris[0],code:new URL(decision.redirectUri).searchParams.get('code'),verifier},{origin:APP.origin})).json();
 const rpc=(bearer,res,contract,method,args={})=>w.post('/bindle/rpc',{version:'0',tx:randomUUID(),resource:res,contract,method,args},{bearer,origin:APP.origin});
 const prefs=await (await rpc(token.access_token,'@preferences','https://3sln.me/artefacts/contracts/preferences/v1','read',{fragment:SIGNALING_FRAGMENT})).json();
 const ref=prefs.result?.values?.signaling;assert.ok(ref,'preferences read: '+JSON.stringify(prefs));
 // The owner approves the app for each kind (a session handler approval, never inside the app's authorization flow).
 const post=async(path,body)=>{const res=await w.post(path,body,owner);return {status:res.status,body:await res.json()};};
 const approve=line=>reviewedHTTP(post,[{path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP.id,kind:REF[line]}}]).then(([r])=>r);
 for(const [i,approved] of (await reviewedHTTP(post,kinds.map(line=>({path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP.id,kind:REF[line]}})))).entries())assert.equal(approved.status,200,'owner approval of '+kinds[i]+': '+JSON.stringify(approved.body));
 return {owner,session,approve,call:async(method,args={})=>{const res=await rpc(ref.token,ref.id,SIGNALING_CONTRACT,method,args);return {status:res.status,...await res.json()};}};
}

test('no-hang: contract writes answer through /bindle/rpc with the default Node wiring (no seams); kind approval is checked live without a shard call',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 const reg=await within(c.call('register',{kinds:[CHAT]}),10000,'register');
 assert.equal(reg.status,200,JSON.stringify(reg));
 assert.match(reg.result.endpoint,/^ep_[A-Za-z0-9_-]{22}$/);assert.equal(typeof reg.result.endpoint_secret,'string');assert.ok(Number.isSafeInteger(reg.result.expires_at));
 const ep={endpoint:reg.result.endpoint,endpoint_secret:reg.result.endpoint_secret};
 // A second write right after the first (the account gate and the shard gate were both stuck before the RTC fix).
 const minted=await within(c.call('offer',{...ep,kind:CHAT,profile:'webrtc',expires_in:600,uses:2}),10000,'offer');
 assert.equal(minted.status,200,JSON.stringify(minted));assert.equal(minted.result.offers.length,1);assert.equal(minted.result.offers[0].principal,null);assert.match(minted.result.offers[0].offer,/^[A-Za-z0-9_-]{22,43}$/);
 // The shipped contract's result shapes keep every member the resource returns (nothing withheld by shaping).
 const listed=await within(c.call('endpoints'),10000,'endpoints');
 assert.deepEqual(Object.keys(listed.result.endpoints[0]).sort(),['endpoint','kinds','label','last_seen']);
 const heard=await within(c.call('listen',{...ep,wait:0}),10000,'listen');
 assert.equal(heard.status,200,JSON.stringify(heard));assert.deepEqual(Object.keys(heard.result).sort(),['cursor','events','gap']);
 const revoked=await within(c.call('revoke_offer',{...ep,offers:[minted.result.offers[0].offer]}),10000,'revoke_offer');assert.equal(revoked.status,200,JSON.stringify(revoked));
 // An unapproved kind is still refused live (only what the owner approved): it answers, and registers nothing. (The
 // code must survive the RPC journal as a no-effect refusal, below.)
 const other=await within(c.call('register',{kinds:[SYNC]}),10000,'register (unapproved)');
 assert.equal(other.error?.code,'approval_required',JSON.stringify(other));
 assert.equal((await within(c.call('endpoints'),10000,'endpoints')).result.endpoints.length,1,'nothing was registered for the unapproved kind');
});

test('approval_required reaches the app through /bindle/rpc for an unapproved kind (§10.2, §21.1): a no-effect refusal survives the RPC journal and carries the provider approval page URL (§20.1.4)',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 const other=await within(c.call('register',{kinds:[SYNC]}),10000,'register (unapproved)');
 assert.equal(other.error?.code,'approval_required',JSON.stringify(other));
 // The page is this provider's own (never app-supplied): the console's signaling approval page for this app and kind.
 const page=new URL(other.error.url);assert.equal(page.origin,ORIGIN);assert.equal(page.pathname,'/console');
 assert.deepEqual(Object.fromEntries(page.searchParams),{view:'signaling',page:'approve',client:APP.id,kind:SYNC});
 assert.deepEqual(Object.keys(other.error).sort(),['code','message','url']);
});

test('no-hang: concurrent contract writes for one owner all answer (no account-gate / shard-gate cycle)',{timeout:60000},async t=>{
 // The second form of the RTC cycle: RPC B's token check holds the shard gate while it waits on the account gate that
 // RPC A holds; if A's approval check then needed the shard, neither would answer. A's approval is the account's own.
 const w=await boot(t),c=await connect(w);
 const results=await within(Promise.all(Array.from({length:4},()=>c.call('register',{kinds:[CHAT]}))),15000,'four concurrent registers');
 for(const r of results)assert.equal(r.status,200,JSON.stringify(r));
 assert.equal(new Set(results.map(r=>r.result.endpoint)).size,4);
});

test('no-hang: a disconnected application is refused, not approved from stale state',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 assert.equal((await within(c.call('register',{kinds:[CHAT]}),10000,'register')).status,200);
 const apps=await (await w.request('/api/apps',c.owner)).json();
 const id=(apps.connections??apps.apps??apps)[0]?.id;assert.ok(id,'app connection listed: '+JSON.stringify(apps));
 const cut=await w.request('/api/apps/'+encodeURIComponent(id),{...c.owner,method:'DELETE'});assert.ok([200,204].includes(cut.status),'disconnect: '+cut.status);
 const after=await within(c.call('register',{kinds:[CHAT]}),10000,'register after disconnect');
 assert.notEqual(after.status,200,JSON.stringify(after));
});

// RTC-i review M1: removing an application that holds a signaling grant. The owner's force removal ran inside the
// account gate and awaited the external revocation cascade (the federation shard's removalRevoke), whose grant hook
// (grantChanged) calls the same account's signalingAppRevoked (gated): the account gate waited on itself. With an RPC
// of that app in flight a second cycle formed. The cascade drains run after the gated commit, outside the account gate.
const appConnection=async(w,c)=>{const apps=await (await w.request('/api/apps',c.owner)).json();const row=(apps.apps??apps.connections??apps).find(a=>a.clientId===APP.id&&a.status!=='disconnected');assert.ok(row,'app connection listed: '+JSON.stringify(apps));return row;};
const force=(w,c,row)=>w.post('/api/apps/removal/force',{connection:row.id,expectedGeneration:row.generation},c.owner);

test('no-hang (review M1): force-removing an app that holds a signaling grant answers and ends its endpoints and approvals',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w);
 const reg=await within(c.call('register',{kinds:[CHAT]}),10000,'register');assert.equal(reg.status,200,JSON.stringify(reg));
 const before=await (await w.request('/api/signaling/settings',c.owner)).json();
 assert.equal(before.apps.find(a=>a.clientId===APP.id)?.endpoints.length,1,JSON.stringify(before.apps));
 const row=await appConnection(w,c),res=await within(force(w,c,row),15000,'force removal');
 const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
 // The account answers afterwards (its gate is free) and the app's credentials no longer work.
 const after=await within(c.call('endpoints'),10000,'endpoints after removal');assert.notEqual(after.status,200,JSON.stringify(after));
 // The cascade's signalingAppRevoked (shard grantChanged, outside the gate) and the connection cascade ended the app's
 // signaling state and cleared its session handler approvals.
 const settled=await within(w.request('/api/signaling/settings',c.owner),10000,'settings after removal');assert.equal(settled.status,200);
 const after2=await settled.json();assert.deepEqual(after2.apps,[],'no grant, endpoint or approval left, so no app listed');
 const account=w.app.resources.accounts.get(c.session.account.id);
 assert.deepEqual([...(await account.metadata.list({prefix:'sig/ep/'})).keys()],[],'no endpoint row');
 assert.ok([...(await account.metadata.list({prefix:'intent-memory/'})).values()].every(m=>!(m?.approvals??[]).some(a=>a.handler===APP.id)),'no approval of the removed app');
});

test('no-hang (review M1): force removal with an RPC of that app in flight answers (no account-gate / shard-gate cycle)',{timeout:90000},async t=>{
 const w=await boot(t),c=await connect(w);
 assert.equal((await within(c.call('register',{kinds:[CHAT]}),10000,'register')).status,200);
 const row=await appConnection(w,c);
 const inflight=Array.from({length:6},()=>c.call('endpoints'));
 const res=await within(Promise.all([force(w,c,row),...inflight]),20000,'force removal with RPCs in flight');
 assert.equal(res[0].status,200,'force removal');
 for(const r of res.slice(1))assert.ok([200,401,403,404].includes(r.status),JSON.stringify(r));
 assert.equal((await within(w.request('/api/apps',c.owner),10000,'apps after removal')).status,200);
});

// RTC-i review L1, retargeted to the session handler approval: an RPC authorized by the shard before the owner removes
// the app's approval for a kind must not act on that kind once it enters the account gate. The RPC is held between the
// shard and the account (a latch on the account's federationRPC entry) while the owner unapproves; released, its
// register for SYNC must be refused (the approval is read live inside the gate, never from the shard).
test('no-hang (review L1): an RPC authorized before the owner removes an approval, entering the gate after it, is refused for that kind',{timeout:60000},async t=>{
 const w=await boot(t),c=await connect(w,[CHAT,SYNC]);
 assert.equal((await within(c.call('register',{kinds:[SYNC]}),10000,'register before')).status,200,'SYNC is approved at first');
 // The writer is a flag proxy over the controller: the latch is an own property of the controller, set and deleted
 // through the proxy, over the prototype's invoke (so the proxy's flag pinning still wraps it).
 const account=w.app.resources.accounts.get(c.session.account.id),invoke=Object.getPrototypeOf(account).invoke;let release,arrived;
 const latch=new Promise(r=>release=r),reached=new Promise(r=>arrived=r);
 account.invoke=async function(request){if(request?.method==='federationRPC'){arrived();await latch;}return invoke.call(this,request);};
 t.after(()=>{release();delete account.invoke;});
 const pending=c.call('register',{kinds:[SYNC]});
 await within(reached,10000,'the RPC reached the account');
 const narrowed=await within(w.post('/api/intents/session-unapprove',{clientId:APP.id,kind:SYNC},c.owner),10000,'session-unapprove');
 assert.equal(narrowed.status,200,await narrowed.clone().text());
 release();delete account.invoke;
 const stale=await within(pending,10000,'register after narrowing');
 assert.equal(stale.error?.code,'approval_required',JSON.stringify(stale));
 const syncEndpoints=async()=>(await within(c.call('endpoints'),10000,'endpoints')).result.endpoints.filter(e=>e.kinds.includes(SYNC)).length;
 assert.equal(await syncEndpoints(),0,'nothing registered for SYNC after the narrowing (the earlier SYNC endpoint was removed by it)');
 // CHAT is still approved; a fresh RPC (authorized after the narrowing) for SYNC is refused as before.
 assert.equal((await within(c.call('register',{kinds:[CHAT]}),10000,'register CHAT')).status,200);
 const fresh=await within(c.call('register',{kinds:[SYNC]}),10000,'register SYNC');assert.equal(fresh.error?.code,'approval_required',JSON.stringify(fresh));assert.equal(await syncEndpoints(),0);
});
