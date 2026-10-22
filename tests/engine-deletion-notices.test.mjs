import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../vendor/ngin/index.js';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {forEachSeed,createScheduler,injectFaults} from './helpers/chaos.mjs';
import {SendAccountDeletionNotice,deletionNoticeTemplate,createDeletionNotices} from '../packages/runtime/deletion-notices.mjs';
import {CancelDeletionLink} from '../packages/runtime/routes/deletion.mjs';
import {DeletionService,REQUEST_KEY,FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {createAppEngine,perform} from '../packages/app/engine.mjs';
import {nullAudit} from '../packages/app/providers.mjs';
import {RequestAccountDeletion,StepAccountDeletion,CancelAccountDeletionByToken} from '../packages/app/domains/account-deletion.mjs';
import {key} from '../packages/core/records.mjs';

const ORIGIN='https://notices.example',DAY=86400000;
const flags={for:()=>({background:()=>true,enabled:()=>true,global:()=>true})};
const notice=(extra={})=>({owner:OWNER,handle:'n.abc123',kind:'scheduled',basis:'owner',executeAfter:Date.UTC(2026,10,5),graceDays:14,cancellable:true,cancelToken:'a'.repeat(43),channels:{email:'owner@notices.example',emailVerifiedAt:1,push:[{id:'phone',endpoint:'https://push.example/copied',keys:{p256dh:'key',auth:'auth'}}]},attemptId:'attempt-1',...extra});
const action=input=>new SendAccountDeletionNotice({actor:{kind:'system',owner:OWNER,reason:'notice'},input});
test('notice templates: every cancellable email/push carries the same fragment-only link; English and Spanish deadlines; no execution/completion cancel claim',()=>{
 for(const locale of ['en','es'])for(const kind of ['scheduled','reminder-3d','reminder-1d']){
  const result=deletionNoticeTemplate(notice({kind,cancelUrl:'https://evil.example/steal'}),{origin:ORIGIN,locale}),url=new URL(result.push.path,ORIGIN);
  assert.equal(url.origin,ORIGIN);assert.equal(url.pathname,'/account/deletion/cancel');assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'),'a'.repeat(43));assert(result.text.includes(url.href));assert(!result.text.includes('evil.example'));assert.match(result.text,/UTC/);assert.match(result.text,/n\.abc123/);assert(Buffer.byteLength(JSON.stringify(result.push))<=2048);
  assert.match(result.text,locale==='es'?/Confirma en la página/:/Confirm on the page/);
 }
 for(const kind of ['executing','completed']){const result=deletionNoticeTemplate(notice({kind,cancellable:false}),{origin:ORIGIN});assert(!result.text.includes('a'.repeat(43)));assert(!result.push.path.includes('#'));assert(!result.text.includes('Not you? Cancel'));}
 const admin=deletionNoticeTemplate(notice({basis:'admin-underage',cancellable:false}),{origin:ORIGIN});assert.match(admin.text,/appeal/);assert(!admin.text.includes('token='));
 for(const origin of ['https://notices.example/','https://user:pass@notices.example','http://notices.example','javascript:alert(1)'])assert.throws(()=>deletionNoticeTemplate(notice(),{origin}),TypeError);
 for(const extra of [{owner:'bad'},{kind:'bad'},{handle:'x\nInjected'},{handle:'<img src=x>'},{cancelToken:'bad'},{executeAfter:NaN},{graceDays:0},{kind:'completed'},{basis:'admin-underage'}])assert.throws(()=>deletionNoticeTemplate(notice(extra),{origin:ORIGIN}),TypeError);
});
test('engine notice acceptance: mail and push fail independently, explicit provider evidence required, completion is email only and kills cause no effects',async t=>{
 const calls=[],state={mail:'ok',push:'ok',killed:false};
 const h=await createTestEngine({providers:{config:{origin:ORIGIN},flags:{for:()=>({background:()=>!state.killed})},mail:{async sendDeletionNotice(input){calls.push(['mail',input]);if(state.mail==='throw')throw Error('private provider error');return state.mail==='ok'?{messageId:'fake-mail'}:{};}},push:{async send(subscription,payload){calls.push(['push',subscription,payload]);if(state.push==='throw')throw Error('private endpoint failure');return state.push==='ok'?{accepted:true}:{};}}}});t.after(()=>h.dispose());
 for(const [mail,push,channels]of [['ok','ok',['push','email']],['throw','ok',['push']],['ok','throw',['email']],['empty','empty',[]],['throw','throw',[]]]){
  Object.assign(state,{mail,push});const result=await h.perform(action(notice()));assert.deepEqual(result,{accepted:channels.length>0,channels});
 }
 Object.assign(state,{mail:'ok',push:'ok'});calls.length=0;
 assert.deepEqual(await h.perform(action(notice({kind:'completed',cancellable:false}))),{accepted:true,channels:['email']});assert.deepEqual(calls.map(c=>c[0]),['mail']);
 assert.equal(calls[0][1].notice.cancelToken,undefined,'a completion mail gets no stale token');assert.equal(calls[0][1].notice.channels,undefined,'push endpoints never reach the mail transport');
 calls.length=0;state.killed=true;assert.deepEqual(await h.perform(action(notice())),{accepted:false,channels:[]});assert.deepEqual(calls,[]);
 state.killed=false;await assert.rejects(h.perform(action(notice({channels:{email:null,push:Array(17).fill({})}}))),TypeError);
 await assert.rejects(h.perform(new SendAccountDeletionNotice({actor:{kind:'owner',owner:OWNER},input:notice()})),TypeError);
});
test('cancel-link client Action: real engine dispatch forwards only the input to the injected API and propagates refusal',async t=>{
 const calls=[],api={cancel:async input=>{calls.push(input);if(input.token==='bad')throw Object.assign(new Error('invalid'),{code:'invalid_token'});return {cancelled:true};}},engine=new Engine({providers:{api:Provider.fromSingleton(api)}});t.after(()=>engine.dispose());
 const value={owner:OWNER,token:'a'.repeat(43)};assert.deepEqual((await engine.dispatch(new CancelDeletionLink(value)).next('result')).detail,{cancelled:true});assert.deepEqual(calls,[value]);await assert.rejects(engine.dispatch(new CancelDeletionLink({owner:OWNER,token:'bad'})).next('complete'),{code:'invalid_token'});
});
test('mail transport: existing EMAIL transport sends accounts@, escaped HTML and the exact cancel link; fake provider only',async()=>{
 const {mailTransport}=await import('../apps/worker/email.mjs');
 const sent=[],mail=mailTransport({MAIL_ENABLED:'true',APP_ORIGIN:ORIGIN,BRAND_NAME:'Fixture <brand>',EMAIL:{send:async envelope=>{sent.push(envelope);return {messageId:'fake-accepted'};}}}),port=createDeletionNotices({origin:ORIGIN,flags,mail});
 try{assert.equal((await port.deliver(notice())).accepted,true);assert.equal(sent.length,1);assert.equal(sent[0].from,'accounts@notices.example');assert.equal(sent[0].to,'owner@notices.example');assert.match(sent[0].html,/Fixture &lt;brand&gt;/);assert.match(sent[0].html,/href="https:\/\/notices\.example\/account\/deletion\/cancel#owner=.*&amp;token=/);assert(sent[0].text.includes('token='+'a'.repeat(43)));}finally{await port.dispose();}
});
test('seeded notice chaos: provider-accepted then lost replies retry safely; copied endpoints survive deletion; every delivered token remains cancel-only',async()=>forEachSeed(50,async random=>{
 const scheduler=createScheduler(random),base=await createTestEngine({seed:random.seed}),clock=base.clock,delivered=[],pushes=[],accept={value:false};
 const mail=injectFaults({async sendDeletionNotice(input){delivered.push(input.notice);return accept.value?{messageId:'fake'}:{};}},[{method:'sendDeletionNotice',when:1,mode:'after'}]);
 const push=scheduler.wrap(injectFaults({async send(subscription,payload){pushes.push({subscription,payload});return {accepted:accept.value};}},[{method:'send',when:random.chance(.5)?1:2,mode:'after'}]),'push');
 const notices=createDeletionNotices({origin:ORIGIN,flags,mail,push});
 const identity={id:OWNER,handle:'n.abc123',status:'active',verifiedEmail:'owner@notices.example',emailVerifiedAt:clock.now()-DAY};
 const ports={identity:{get:async()=>identity},security:async()=>({epoch:1,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices,due:{put:async()=>{},delete:async()=>{}}};
 const service=new DeletionService({executor:{metadata:base.metadata,config:{}},ports,flags,clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},wake:async()=>{}}),engine=createAppEngine({providers:{lifecycle:service,clock,random:{uuid:()=>crypto.randomUUID()},audit:nullAudit}});
 try{
  await base.metadata.put('owner',OWNER);await base.metadata.put(key('push-subscription',OWNER,'p'),{id:'p',owner:OWNER,endpoint:'https://push.example/snapshot',keys:{p256dh:'k',auth:'a'}});
  await perform(engine,new RequestAccountDeletion({actor:{kind:'owner',owner:OWNER,stepUpAt:clock.now()},input:{confirmHandle:'@n.abc123',acknowledgements:{messages:true,storage:true,names:true},operationId:'notice-chaos-operation-0001'}}));
  assert.equal((await base.metadata.get(REQUEST_KEY)).noticeAccepted,false);clock.set((await base.metadata.get(REQUEST_KEY)).executeAfter);
  const results=await scheduler.run([()=>base.metadata.delete(key('push-subscription',OWNER,'p')),()=>perform(engine,new StepAccountDeletion({actor:{kind:'system',owner:OWNER,reason:'chaos'}}))]);
  for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.stack);assert.equal(results[1].value.reason,'notice-unaccepted');assert.equal(await base.metadata.get(FENCE_KEY),undefined);
  accept.value=true;clock.advance(3600000);identity.security={epoch:2,changedAt:clock.now()};ports.security=async()=>identity.security;
  await perform(engine,new StepAccountDeletion({actor:{kind:'system',owner:OWNER,reason:'chaos'}}));const row=await base.metadata.get(REQUEST_KEY);assert.equal(row.noticeAccepted,true);assert(row.executeAfter>=clock.now()+14*DAY);assert(pushes.length>=3);assert(pushes.every(p=>p.subscription.endpoint==='https://push.example/snapshot'));
  const token=random.pick(delivered).cancelToken;assert(!JSON.stringify(row).includes(token));assert.equal((await perform(engine,new CancelAccountDeletionByToken({actor:{kind:'cancel-link',owner:OWNER},input:{token}}))).state,'cancelled');
  await assert.rejects(perform(engine,new CancelAccountDeletionByToken({actor:{kind:'cancel-link',owner:OWNER},input:{token}})),{code:'invalid_token'});
 }finally{await engine.dispose();await notices.dispose();await base.dispose();}
}));
