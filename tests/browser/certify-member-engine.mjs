import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,Provider} from '../../vendor/ngin/index.js';
import {CertifyMemberIntent,CertifyMemberView,certifyRequest,createCertifyPort} from '../../apps/web/src/bl/certify-member.mjs';
import {forEachSeed} from '../helpers/chaos.mjs';
const SUBJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://home.example',AUD=ISSUER+'/identity/dddddddd-dddd-4ddd-8ddd-dddddddddddd',CLIENT='https://app.example/client.json',REDIRECT='https://app.example/callback',STATE='a'.repeat(43);
function fixture({flags=true,authenticated=true,framed=false,viewPatch={},issue}={}){
 const location=new URL('/console?'+new URLSearchParams({member_certify:'1',state:STATE,client_id:CLIENT,redirect_uri:REDIRECT,aud:AUD}),ISSUER),sent=[],calls=[];
 const view={subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'},redirectUri:REDIRECT,purposes:['https://spec.bindle.example/purposes/member-access/v1'],...viewPatch},opener={postMessage:(data,origin)=>sent.push({data,origin})},win={};win.top=framed?{}:win;
 const api={setContext:session=>calls.push({context:session.account.id}),get:async path=>{calls.push({path});if(path==='/api/config')return {organizationsEnabled:flags,memberCertificatesEnabled:flags};if(path==='/api/session')return {authenticated,account:{id:SUBJECT}};return view;},request:async(path,input)=>{calls.push({path,input});return issue?issue(input):{certificate:'issued'};}};
 const port=createCertifyPort({api,location,opener,window:win}),engine=new Engine({providers:{certify:Provider.fromSingleton(port)}});
 const act=async(action,input)=>{const feed=engine.dispatch(new CertifyMemberIntent(action,input));await feed.next('complete');};
 const event=(patch={})=>({source:opener,origin:'https://app.example',data:{type:'bindle:member-key',state:STATE,delegate:{kty:'EC',x:'holder'},proof:{iat:123,signature:'proof'}},...patch});
 return {port,engine,act,event,sent,calls,location,opener,view,snapshot:()=>port.snapshot()};
}
test('valid top-level acquisition loads exact context and discloses ready only to the registered app origin',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');assert.equal(f.snapshot().phase,'review');assert.deepEqual(f.sent,[{data:{type:'bindle:member-ready',state:STATE,subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'}},origin:'https://app.example'}]);assert.equal((await f.engine.query(new CertifyMemberView()).peek()).phase,'review');
});
test('framing, disabled flags, anonymous sessions and substituted contexts fail before any ready/key delivery',async t=>{
 for(const options of [{framed:true},{flags:false},{authenticated:false},{viewPatch:{subject:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}},{viewPatch:{issuer:'https://evil.example'}},{viewPatch:{aud:AUD+'evil'}},{viewPatch:{client:{client_id:'evil',origin:'https://app.example'}}}]){
  const f=fixture(options);t.after(()=>f.engine.dispose());await f.act('load');assert.ok(f.snapshot().error);assert.equal(f.sent.length,0);assert.equal(f.snapshot().view,null);
 }
 for(const state of ['', 'short','<script>'+STATE])assert.throws(()=>certifyRequest(new URL(ISSUER+'/console?state='+encodeURIComponent(state))));
});
test('source, origin and state fencing refuses unsolicited keys and consent remains explicit',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');
 for(const event of [f.event({source:{}}),f.event({origin:'https://evil.example'}),f.event({data:{type:'bindle:member-key',state:'wrong'}}),f.event({data:{type:'other',state:STATE}})]){await f.act('key',event);assert.equal(f.snapshot().key,null);}
 await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,0);
 await f.act('key',f.event());await f.act('approve',{confirm:false});assert.equal(f.calls.filter(x=>x.input).length,0);assert.equal(f.snapshot().phase,'review');
 await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,1);assert.equal(f.calls.at(-1).input.consent,true);assert.equal(f.snapshot().phase,'complete');assert.equal(f.snapshot().key,null);assert.equal(f.sent.at(-1).data.result.certificate,'issued');
 await f.act('key',f.event());await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,1);
});
test('cancel clears holder data and cannot subsequently issue from a replay',async t=>{
 const f=fixture();t.after(()=>f.engine.dispose());await f.act('load');await f.act('key',f.event());await f.act('cancel');assert.equal(f.snapshot().phase,'canceled');assert.equal(f.snapshot().key,null);assert.equal(f.sent.at(-1).data.code,'canceled');await f.act('key',f.event());await f.act('approve',{confirm:true});assert.equal(f.calls.filter(x=>x.input).length,0);
});
test('seeded approval/key replays issue once while a provider response is pending',async()=>{
 await forEachSeed(12,async random=>{
  let resolve,started;const entered=new Promise(r=>{started=r;}),held=new Promise(r=>{resolve=r;}),f=fixture({issue:async()=>{started();return held;}});
  try{
   await f.act('load');await f.act('key',f.event());const pending=f.act('approve',{confirm:true});await entered;
   for(const action of random.shuffle(['key','approve','key','approve']))await f.act(action,action==='key'?f.event():{confirm:true});
   assert.equal(f.calls.filter(x=>x.input).length,1);resolve({certificate:'once'});await pending;assert.equal(f.snapshot().phase,'complete');assert.equal(f.sent.filter(x=>x.data.type==='bindle:member-result').length,1);
  }finally{resolve?.({certificate:'once'});await f.engine.dispose();}
 });
});
