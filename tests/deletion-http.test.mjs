// DX-5 HTTP integration over the mounted routes. Real IdentityService and AccountController engines run over SQLite, with fake notice transports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {createIdentityEngine} from '../packages/identity/index.mjs';
import {lifecycleIdentityPort} from '../packages/identity/lifecycle-tombstone.mjs';
import {identitySecurityPort} from '../packages/identity/service.mjs';
import {identityEngine,activate,signupInput,PASSWORD} from './helpers/identity-engine.mjs';
import {createDeletionNotices,deletionNoticeTemplate} from '../packages/runtime/deletion-notices.mjs';
import {REQUEST_KEY,FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {deletionEngine} from '../packages/runtime/account/deletion.mjs';
import {StepAccountDeletion} from '../packages/app/domains/account-deletion.mjs';
import {perform} from '../packages/app/engine.mjs';
import {key} from '../packages/core/records.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';

// The routes are mounted (packages/runtime/routes/index.mjs); the real router runs here.
const {default:http}=await import('../packages/runtime/http.mjs');
const ORIGIN='https://3sln.example',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',DAY=86400000;
const input=handle=>({confirmHandle:'@'+handle,acknowledgements:{messages:true,storage:true,names:true},operationId:'deletion-http-operation-0001'});
const bucket=()=>({get:async()=>null,put:async()=>({}),delete:async()=>{}});
export async function deletionHTTPFixture(t){
 const h=identityEngine({config:{origin:ORIGIN,rpID:'3sln.example',rpName:'Fixture',termsVersion:'2026-10-11'}}),{owner,ownerContext:ctx}=await activate(h.act,signupInput()),id=owner.account.id;
 t.after(()=>h.engine.dispose());const state={enabled:true,killed:false,accepted:true,mailAccepted:true,pushAccepted:true,limit:true},emails=[],pushes=[],rpc=[];
 const base=createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}}}),flags={for:context=>({...base.for(context),enabled:name=>name==='ACCOUNT_DELETION_ENABLED'?state.enabled&&!state.killed&&context?.subject?.owner!==OTHER:base.for(context).enabled(name),background:()=>!state.killed,global:()=>state.enabled&&!state.killed})};
 const mail={async sendDeletionNotice(value){emails.push({...value,template:deletionNoticeTemplate(value.notice,{origin:ORIGIN,locale:value.locale})});if(!state.mailAccepted)throw Error('mail down');return state.accepted?{messageId:'fake-'+emails.length}:{};}},push={async send(subscription,payload){pushes.push({subscription:structuredClone(subscription),payload});if(!state.pushAccepted)throw Error('push down');return {accepted:state.accepted};}};
 const notices=createDeletionNotices({origin:ORIGIN,flags,mail,push});t.after(()=>notices.dispose());
 const record=await h.repository.get(id);Object.assign(record,{verifiedEmail:'owner@deletion.example',emailVerifiedAt:h.clock.now()-DAY,security:{epoch:2,changedAt:h.clock.now()-4*DAY},termsVersion:'superseded'});record.revision++;assert(await h.repository.compareAndSwap(id,record.revision-1,record));
 const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());
 const ports={identity:lifecycleIdentityPort(h.repository,{clock:h.clock.now}),security:identitySecurityPort(h.repository),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices,due:{put:async()=>{},delete:async()=>{}},exports:null,erasure:{federation:null,mcp:null,operatorApps:null}};
 const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket(),archives:bucket(),sql:metadata.sql,config:{APP_ORIGIN:ORIGIN,flags,LIFECYCLE_CLOCK:h.clock.now,LIFECYCLE_LOG:()=>{},ACCOUNT_DELETION_PORTS:ports,IDENTITY_ACCOUNT:owner=>h.repository.get(owner)}});
 await controller.warm(id);const subscription={id:'phone',owner:id,endpoint:'https://fcm.googleapis.com/fcm/send/copied',keys:{p256dh:'fake-key',auth:'fake-auth'}};await metadata.put(key('push-subscription',id,'phone'),subscription);
 const env={APP_ORIGIN:ORIGIN,flags,ABUSE_HASH_KEY:'isolated-deletion-test-hash',ABUSE:{consume:async()=>state.limit},IDENTITY_ENGINE:()=>createIdentityEngine(h.resources),ACCOUNTS:{get:owner=>({invoke:async call=>{rpc.push({owner,method:call.method});if(owner!==id)return {$fault:{code:'invalid_token',message:'invalid',status:400}};return controller.invoke(call);}})},ASSETS:{fetch:async()=>new Response(await readFile('.output/public/build-manifest.json'),{headers:{'Content-Type':'application/json'}})}};
 const request=(path= '/api/account/deletion',{method='GET',value,headers={},auth=true,origin=ORIGIN}={})=>http.fetch(new Request(ORIGIN+path,{method,headers:{...method==='POST'?{'Content-Type':'application/json',Origin:origin}:{},...auth?{Cookie:'__Host-bindle_session='+encodeURIComponent(ctx.sessionToken),'X-CSRF-Token':ctx.csrfToken}:{},...headers},...value===undefined?{}:{body:typeof value==='string'?value:JSON.stringify(value)}}),env,{});
 const post=(value=input(owner.account.handle),options={})=>request('/api/account/deletion',{method:'POST',value,...options});
 const token=()=>new URL(emails.at(-1).template.text.match(/https:\/\/[^\s]+\/account\/deletion\/cancel#[^\s]+/)[0]).hash.slice(1);
 const cancelLink=(value=Object.fromEntries(new URLSearchParams(token())),options={})=>request('/api/account/deletion/cancel-token',{method:'POST',value,auth:false,headers:{'X-Bindle-Cancel':'1',...options.headers},...options, ...options.headers?{headers:{'X-Bindle-Cancel':'1',...options.headers}}:{}});
 return {h,id,ctx,state,env,controller,metadata,emails,pushes,rpc,flags,input:()=>input(owner.account.handle),request,post,token,cancelLink,step:()=>perform(deletionEngine(controller).engine,new StepAccountDeletion({actor:{kind:'system',owner:id,reason:'test'}}))};
}
test('HTTP: fresh privileged evidence, replay, status redaction, current-terms exemption and owner cancel without step-up',async t=>{
 const x=await deletionHTTPFixture(t),result=await x.post();assert.equal(result.status,200,await result.clone().text());assert.equal((await result.json()).state,'scheduled');
 const record=await x.metadata.get(REQUEST_KEY);assert.equal(record.actor.sessionId,(await x.h.service.privileged(x.ctx)).sessionId);assert.equal(record.graceDays,14);assert.equal(record.noticeAccepted,true);assert.equal(x.emails.length,1);assert.equal(x.pushes.length,1);
 assert.equal((await x.post()).status,200);assert.equal(x.emails.length,1,'operation replay does not resend');
 assert.equal((await x.post({...x.input(),confirmHandle:'@someone-else'})).status,409);
 const status=await x.request(),text=await status.text();assert.equal(status.status,200);for(const secret of ['owner@deletion.example','fcm.googleapis.com','cancelToken',x.ctx.sessionToken])assert(!text.includes(secret));assert.equal(status.headers.get('Cache-Control'),'no-store');
 x.h.clock.advance(300001);const cancelled=await x.request('/api/account/deletion/cancel',{method:'POST',value:{}});assert.equal(cancelled.status,200,await cancelled.clone().text());assert.equal((await cancelled.json()).state,'cancelled');
 assert(!x.rpc.some(call=>['touch','admitWork'].includes(call.method)),'routes run before admission and activity');
});
test('HTTP: recent sign-in, stale/future step-up and body-forged authority never schedule deletion',async t=>{
 const x=await deletionHTTPFixture(t);let record=await x.h.repository.get(x.id);delete record.sessions[0].stepUpAt;record.revision++;await x.h.repository.compareAndSwap(x.id,record.revision-1,record);
 for(const time of [null,x.h.clock.now()-300000,x.h.clock.now()+1]){
  record=await x.h.repository.get(x.id);if(time===null)delete record.sessions[0].stepUpAt;else record.sessions[0].stepUpAt=time;record.revision++;await x.h.repository.compareAndSwap(x.id,record.revision-1,record);
  const response=await x.post({...x.input(),stepUpAt:x.h.clock.now(),sessionId:'forged'});assert.equal((await response.json()).error,'step_up_required');assert.equal(await x.metadata.get(REQUEST_KEY),undefined);
 }
 await x.h.act('stepUp',{method:'password',password:PASSWORD},x.ctx);const response=await x.post({...x.input(),stepUpAt:x.h.clock.now()});assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_request');
});
test('HTTP adversarial: Origin, fetch metadata, CSRF, selector confusion, methods and bounded bodies',async t=>{
 const x=await deletionHTTPFixture(t);
 for(const path of ['/api/account/deletion','/api/account/deletion/cancel'])for(const headers of [{Origin:'https://evil.example'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'},{'X-CSRF-Token':'bad'}]){
  const response=await x.request(path,{method:'POST',value:path.endsWith('/cancel')?{}:x.input(),headers});assert.equal(response.status,403,JSON.stringify(headers));
 }
 assert.equal((await x.post(x.input(),{auth:false})).status,401);
 assert.equal((await x.post(x.input(),{headers:{'X-Bindle-Account':OTHER}})).status,409);
 assert.equal((await x.request('/api/account/deletion',{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await x.request('/api/account/deletion',{method:'DELETE'})).status,405);
 assert.equal((await x.request('/api/account/deletion?owner='+OTHER)).status,400);
 assert.equal((await x.post(' '.repeat(4097))).status,413);
 assert.equal((await x.post('[]')).status,400);
 assert.equal((await x.post(x.input(),{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal(await x.metadata.get(REQUEST_KEY),undefined);assert.equal(x.emails.length,0);
});
test('HTTP adversarial: scanner GET cannot cancel, link POST is single-use, cross-account token cannot cancel and returns no data',async t=>{
 const x=await deletionHTTPFixture(t);assert.equal((await x.post()).status,200);const value=Object.fromEntries(new URLSearchParams(x.token()));
 assert.equal((await x.request('/api/account/deletion/cancel-token',{auth:false})).status,405);
 assert.equal((await x.cancelLink(value,{origin:'https://evil.example'})).status,403);
 assert.equal((await x.cancelLink(value,{headers:{'X-Bindle-Cancel':''}})).status,403);
 assert.equal((await x.cancelLink(value,{headers:{'Sec-Fetch-Site':'same-site'}})).status,403);
 const foreign=await x.cancelLink({...value,owner:OTHER});assert.deepEqual(await foreign.json(),{error:'invalid_token',message:'This link is no longer valid.'});assert.equal((await x.metadata.get(REQUEST_KEY)).state,'scheduled');
 assert.equal((await x.cancelLink({...value,token:'x'.repeat(43)})).status,400);
 assert.equal((await x.cancelLink({...value,extra:true})).status,400);
 const result=await x.cancelLink(value);assert.equal(result.status,200);assert.deepEqual(await result.json(),{cancelled:true});assert.equal(result.headers.get('Set-Cookie'),null);
 const replay=await x.cancelLink(value);assert.equal(replay.status,400);assert.deepEqual(await replay.json(),{error:'invalid_token',message:'This link is no longer valid.'});
 x.state.limit=false;const limited=await x.cancelLink(value);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
});
test('HTTP: default-off new requests, ramp-down continuity and env kill use the flags port',async t=>{
 // Flag off and no request: the status route answers 404, exactly as before it existed.
 const x=await deletionHTTPFixture(t);x.state.enabled=false;assert.equal((await x.post()).status,404);assert.equal((await x.request()).status,404);
 x.state.enabled=true;assert.equal((await x.post()).status,200);x.state.enabled=false;assert.equal((await x.request()).status,200);assert.equal((await x.cancelLink()).status,200);
 // Status follows no flag (§8.1): an existing request stays visible under an env kill; cancel refuses.
 x.state.killed=true;assert.equal((await x.request()).status,200);assert.equal((await x.request('/api/account/deletion/cancel',{method:'POST',value:{}})).status,503);assert.equal((await x.cancelLink({owner:x.id,token:'x'.repeat(43)})).status,503);assert.equal((await x.request('/account/deletion/cancel',{auth:false})).status,503);
});
test('HTTP: copied push endpoints survive removal; absent provider acceptance holds at deadline; security change sends a fresh notice',async t=>{
 const x=await deletionHTTPFixture(t);x.state.accepted=false;assert.equal((await x.post()).status,200);await x.metadata.delete(key('push-subscription',x.id,'phone'));
 let record=await x.metadata.get(REQUEST_KEY);x.h.clock.set(record.executeAfter);const held=await x.step();assert.equal(held.reason,'notice-unaccepted');assert.equal(await x.metadata.get(FENCE_KEY),undefined);assert.equal(x.pushes.at(-1).subscription.endpoint,'https://fcm.googleapis.com/fcm/send/copied');
 const identity=await x.h.repository.get(x.id);identity.security={epoch:3,changedAt:x.h.clock.now()};identity.revision++;await x.h.repository.compareAndSwap(x.id,identity.revision-1,identity);x.state.accepted=true;
 await x.step();record=await x.metadata.get(REQUEST_KEY);assert(record.executeAfter>=x.h.clock.now()+14*DAY);assert.equal(record.noticeAccepted,true);assert.equal(x.emails.at(-1).notice.kind,'scheduled');assert.equal(x.pushes.at(-1).subscription.endpoint,'https://fcm.googleapis.com/fcm/send/copied');
});
test('HTTP: cancel page uses the shipped ngin graph, no secrets in HTML, strict CSP, no mutation on GET or Range abuse',async t=>{
 const x=await deletionHTTPFixture(t);await x.post();const before=(await x.metadata.get(REQUEST_KEY)).revision;
 for(const range of [undefined,'bytes=0-1,3-4','bytes=999999999999999999999-','bytes=-999999999999999999999']){
  const page=await x.request('/account/deletion/cancel?lang=es#'+x.token(),{auth:false,headers:range?{Range:range}:{}});assert.equal(page.status,200);assert.equal(page.headers.get('Content-Language'),'es');assert.match(page.headers.get('Content-Security-Policy'),/form-action 'none'/);assert.equal(page.headers.get('Cache-Control'),'no-store');const html=await page.text();assert(!html.includes(new URLSearchParams(x.token()).get('token')));assert.match(html,/type="importmap"/);assert.match(html,/Cancelar/);assert.equal(page.headers.get('Content-Range'),null);
 }
 assert.equal((await x.metadata.get(REQUEST_KEY)).revision,before);assert.equal((await x.request('/account/deletion/cancel?token=leak',{auth:false})).status,400);
 const head=await x.request('/account/deletion/cancel',{method:'HEAD',auth:false});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const script=await x.request('/account/deletion/cancel.mjs',{auth:false});assert.match(await script.text(),/credentials:'omit'/);
});
