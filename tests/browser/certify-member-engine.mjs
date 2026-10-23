import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../../vendor/ngin/index.js';
import {CertifyMemberIntent,CertifyMemberView,certifyRequest,createCertifyPort} from '../../apps/web/src/bl/certify-member.mjs';
import {forEachSeed} from '../helpers/chaos.mjs';
const SUBJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://home.example',AUD=ISSUER+'/identity/dddddddd-dddd-4ddd-8ddd-dddddddddddd',CLIENT='https://app.example/client.json',REDIRECT='https://app.example/callback',STATE='a'.repeat(43);
function fixture({flags=true,authenticated=true,framed=false,viewPatch={},issue}={}){
 const location=new URL('/console?'+new URLSearchParams({member_certify:'1',state:STATE,client_id:CLIENT,redirect_uri:REDIRECT,aud:AUD}),ISSUER),sent=[],calls=[];
 const view={subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'},redirectUri:REDIRECT,purposes:['https://spec.bindle.example/purposes/member-access/v1'],organization:{name:'Acme Corp',handle:'acme',host:'home.example',verified:true,source:'local'},app:{name:'app.example',claimedName:'Acme ERP',reviewed:false},...viewPatch},opener={postMessage:(data,origin)=>sent.push({data,origin})},win={};win.top=framed?{}:win;
 const api={setContext:session=>calls.push({context:session.account.id}),get:async path=>{calls.push({path});if(path==='/api/config')return {organizationsEnabled:flags,memberCertificatesEnabled:flags};if(path==='/api/session')return {authenticated,account:{id:SUBJECT}};return view;},request:async(path,input)=>{calls.push({path,input});return issue?issue(input,calls.filter(c=>c.input).length):{certificate:'issued'};}};
 const port=createCertifyPort({api,location,opener,window:win}),engine=new Engine({providers:{certify:Provider.fromSingleton(port)}});
 const act=async(action,input)=>{const feed=engine.dispatch(new CertifyMemberIntent(action,input));await feed.next('complete');};
 const event=(patch={},signature='proof')=>({source:opener,origin:'https://app.example',data:{type:'bindle:member-key',state:STATE,delegate:{kty:'EC',x:'holder'},proof:{iat:123,signature}},...patch});
 return {port,engine,act,event,sent,calls,location,opener,view,snapshot:()=>port.snapshot()};
}
const READY={type:'bindle:member-ready',state:STATE,subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'}};
test('L1: loading discloses nothing to the app; ready with the subject goes only to the registered origin after confirmation',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');assert.equal(f.snapshot().phase,'review');assert.deepEqual(f.sent,[]);assert.equal((await f.engine.query(new CertifyMemberView()).peek()).phase,'review');
 await f.act('approve',{confirm:true});assert.equal(f.snapshot().phase,'signing');assert.deepEqual(f.sent,[{data:READY,origin:'https://app.example'}]);
});
test('L1: cancelling before confirmation tells the app only that it was canceled',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');await f.act('cancel');assert.deepEqual(f.sent,[{data:{type:'bindle:member-error',state:STATE,code:'canceled'},origin:'https://app.example'}]);assert.ok(!JSON.stringify(f.sent).includes(SUBJECT));
});
test('framing, disabled flags, anonymous sessions and substituted contexts fail before any ready/key delivery',async t=>{
 for(const options of [{framed:true},{flags:false},{authenticated:false},{viewPatch:{subject:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}},{viewPatch:{issuer:'https://evil.example'}},{viewPatch:{aud:AUD+'evil'}},{viewPatch:{client:{client_id:'evil',origin:'https://app.example'}}}]){
  const f=fixture(options);t.after(()=>f.engine.dispose());await f.act('load');assert.ok(f.snapshot().error);await f.act('approve',{confirm:true});assert.equal(f.sent.length,0);assert.equal(f.snapshot().view,null);
 }
 for(const state of ['', 'short','<script>'+STATE])assert.throws(()=>certifyRequest(new URL(ISSUER+'/console?state='+encodeURIComponent(state))));
});
test('source, origin and state fencing refuses unsolicited keys and consent remains explicit',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');
 await f.act('key',f.event());assert.equal(f.snapshot().key,null,'a key before confirmation is ignored');
 await f.act('approve',{confirm:false});assert.equal(f.snapshot().phase,'review');assert.equal(f.sent.length,0);
 await f.act('approve',{confirm:true});
 for(const event of [f.event({source:{}}),f.event({origin:'https://evil.example'}),f.event({data:{type:'bindle:member-key',state:'wrong'}}),f.event({data:{type:'other',state:STATE}})]){await f.act('key',event);assert.equal(f.snapshot().key,null);}
 assert.equal(f.calls.filter(x=>x.input).length,0);
 await f.act('key',f.event());assert.equal(f.calls.filter(x=>x.input).length,1);assert.equal(f.calls.at(-1).input.consent,true);assert.equal(f.snapshot().phase,'complete');assert.equal(f.snapshot().key,null);assert.equal(f.sent.at(-1).data.result.certificate,'issued');
 await f.act('key',f.event());await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,1);
});
test('M1: a refused proof is replaced by a fresh one from the app and issuance then completes',async t=>{
 const f=fixture({issue:(input,n)=>{if(n===1)throw Object.assign(new Error('stale'),{code:'invalid_request'});return {certificate:'issued'};}});t.after(()=>f.engine.dispose());
 await f.act('load');await f.act('approve',{confirm:true});await f.act('key',f.event({},'old'));
 assert.equal(f.snapshot().key,null,'the refused key is cleared');assert.equal(f.snapshot().phase,'signing');assert.deepEqual(f.sent.map(m=>m.data.type),['bindle:member-ready','bindle:member-ready'],'the page asks again for a fresh proof');
 await f.act('key',f.event({},'fresh'));
 assert.deepEqual(f.calls.filter(x=>x.input).map(c=>c.input.proof.signature),['old','fresh']);assert.equal(f.snapshot().phase,'complete');assert.equal(f.sent.at(-1).data.type,'bindle:member-result');
});
test('M1: the retry uses only the fresh proof and a second refusal ends with bindle:member-error',async t=>{
 const f=fixture({issue:()=>{throw Object.assign(new Error('stale'),{code:'invalid_request'});}});t.after(()=>f.engine.dispose());
 await f.act('load');await f.act('approve',{confirm:true});await f.act('key',f.event({},'old'));await f.act('key',f.event({},'fresh'));
 const issued=f.calls.filter(x=>x.input);assert.deepEqual(issued.map(c=>c.input.proof.signature),['old','fresh']);
 assert.equal(f.snapshot().phase,'failed');assert.equal(f.snapshot().key,null);assert.ok(f.snapshot().error);
 assert.deepEqual(f.sent.at(-1),{data:{type:'bindle:member-error',state:STATE,code:'acquisition_failed'},origin:'https://app.example'});
 await f.act('key',f.event({},'late'));await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,2);
});
test('M1: a terminal refusal is not retried and is told to the app at once',async t=>{
 const f=fixture({issue:()=>{throw Object.assign(new Error('gone'),{code:'forbidden'});}});t.after(()=>f.engine.dispose());
 await f.act('load');await f.act('approve',{confirm:true});await f.act('key',f.event());
 assert.equal(f.calls.filter(x=>x.input).length,1);assert.equal(f.snapshot().phase,'failed');assert.deepEqual(f.sent.map(m=>m.data.type),['bindle:member-ready','bindle:member-error']);
});
test('cancel clears holder data and cannot subsequently issue from a replay',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');await f.act('approve',{confirm:true});await f.act('cancel');assert.equal(f.snapshot().phase,'canceled');assert.equal(f.snapshot().key,null);assert.equal(f.sent.at(-1).data.code,'canceled');await f.act('key',f.event());await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,0);
});
test('seeded approval/key replays issue once while a provider response is pending',async()=>{
 await forEachSeed(12,async random=>{
  let resolve,started;const entered=new Promise(r=>{started=r;}),held=new Promise(r=>{resolve=r;}),f=fixture({issue:async()=>{started();return held;}});
  try{
   await f.act('load');await f.act('approve',{confirm:true});const pending=f.act('key',f.event());await entered;
   for(const action of random.shuffle(['key','approve','key','approve','cancel']))await f.act(action,action==='key'?f.event():{confirm:true});
   assert.equal(f.calls.filter(x=>x.input).length,1);resolve({certificate:'once'});await pending;assert.equal(f.snapshot().phase,'complete');assert.equal(f.sent.filter(x=>x.data.type==='bindle:member-result').length,1);assert.equal(f.sent.filter(x=>x.data.type==='bindle:member-ready').length,1);
  }finally{resolve?.({certificate:'once'});await f.engine.dispose();}
 });
});
const text=node=>JSON.stringify(node);
test('M2: the review screen shows the organization name and host, the app name and origin, and warns when unverified',async()=>{
 const {default:render}=await import('../../apps/web/src/ui/certify-member.mjs');
 const f=fixture();await f.act('load');const view=f.snapshot().view;await f.engine.dispose();
 const shown=text(render({phase:'review',busy:false,key:null,error:null,view},{dispatch(){}}));
 for(const value of ['Acme Corp','acme','home.example','app.example','https://app.example','Acme ERP','(not verified)','has not been reviewed'])assert.ok(shown.includes(value),value);
 assert.ok(!shown.includes('could not be verified'));
 const unknown=text(render({phase:'review',busy:false,key:null,error:null,view:{...view,organization:{name:null,handle:null,host:'other.example',verified:false,source:'directory'},app:{name:'Acme ERP',claimedName:null,reviewed:true}}},{dispatch(){}}));
 for(const value of ['Unknown organization','other.example','could not be verified','Acme ERP','https://app.example'])assert.ok(unknown.includes(value),value);
 assert.ok(!unknown.includes('has not been reviewed'));
});
