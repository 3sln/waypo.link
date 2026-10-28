// Island client pieces in apps/embed that pair with the SDK elements: the leader's `/embed/api/events` stream and
// `session/end`, and the island flow transport. Islands never delegate to FedCM (extensions rev 3.3 §2.7, CR-X3-33,
// provisional): entries are always `embed-popup` and the flow never calls the browser's FedCM API. Nothing here is
// evidence of provider conformance or of browser behaviour. These tests live with the SDK suite
// because of write ownership; tests/islands-worker.test.mjs covers the rest of the worker against the real stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {openStore,frameKey,saveCredential} from '../../../apps/embed/src/keys.mjs';
import {embedAPI,createEntry} from '../../../apps/embed/src/restore.mjs';
import {createIslandWorker} from '../../../apps/embed/src/worker/index.mjs';
import * as flowModule from '../../../apps/embed/src/parts/flow.mjs';
const {createFlows}=flowModule;
import {readConfig} from '../../../apps/embed/src/boot.mjs';

const issuer='https://provider.example',embed='https://embed.provider.example',clientId='https://app.example/client',app='https://app.example';
const tick=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,{timeout=4000,message='condition'}={}){const end=Date.now()+timeout;while(!await predicate()){if(Date.now()>end)throw new Error(`Timed out waiting for ${message}.`);await tick();}}
const decode=jws=>JSON.parse(Buffer.from(jws.split('.')[1],'base64url').toString());
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const subject=`${issuer}/entities/1`,b43=c=>c.repeat(43);

// A fake embed API: sessions, a controllable NDJSON stream per session, session end and avatar 404s.
function embedServer(){
  const calls=[],streams=[];let sessions=0;
  const fetch=async(url,init={})=>{
    const path=new URL(url).pathname;calls.push({path,method:init.method??'GET',headers:init.headers??{},keepalive:init.keepalive===true});
    if(path==='/embed/api/nonce')return json({nonce:'n'+calls.length});
    if(path==='/embed/api/session')return json({session:`session-${++sessions}`,expires_in:600,view:{subject,handle:'alex',name:'Alex',avatar:false}});
    if(path==='/embed/api/session/end')return new Response(null,{status:204});
    if(path==='/embed/api/events'){
      let controller;const body=new ReadableStream({start(c){controller=c;},cancel(){stream.canceled=true;}});
      const stream={session:init.headers.Authorization,canceled:false,push:value=>controller.enqueue(new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)+'\n')),close:()=>controller.close()};
      streams.push(stream);init.signal?.addEventListener('abort',()=>{stream.aborted=true;});
      stream.push({type:'view',view:{subject,handle:'alex',name:'Alex',avatar:false}});
      return new Response(body,{status:200,headers:{'Content-Type':'application/x-ndjson'}});
    }
    return json({error:'not_found'},404);
  };
  return {fetch,calls,streams};
}

test('the leader streams /embed/api/events per held session, applies changed views and ends sessions on pagehide',async t=>{
  const server=embedServer(),store=await openStore({indexedDB:undefined}),events=[];
  await saveCredential(store,{issuer,clientId},{id:'c'.repeat(24),credential:'cred',subject,delivered:true,createdAt:0,pendingUntil:0});
  const worker=createIslandWorker({post:m=>events.push(m),storeFactory:async()=>store,crypto:webcrypto,fetch:server.fetch,indexedDB:undefined,BroadcastChannel:undefined,locks:undefined,timing:{restorePadMs:0}});
  t.after(()=>worker({op:'pagehide'}));
  await worker({id:1,op:'start',args:{config:{issuer,clientId,origin:embed},instance:'A'.repeat(22),role:'member',bucket:64,scheme:'light'}});
  const views=()=>events.filter(e=>e.event==='views').at(-1)?.views??[];
  await until(()=>views()[0]?.name==='Alex',{message:'restored view'});
  await until(()=>server.streams.length===1,{message:'stream'});
  const open=server.calls.find(c=>c.path==='/embed/api/events');
  assert.equal(open.method,'GET');assert.equal(open.headers.Authorization,'BindleEmbedSession session-1');assert.equal(open.headers['X-Bindle-Embed'],'1');
  assert.deepEqual({htm:decode(open.headers.DPoP).htm,htu:decode(open.headers.DPoP).htu},{htm:'GET',htu:`${embed}/embed/api/events`},'a GET key proof bound to the stream URL');
  const before=events.length;
  server.streams[0].push({type:'ping'});server.streams[0].push({type:'view',view:{subject,handle:'alex',name:'Alex',avatar:false}});await tick(30);
  assert.equal(events.length,before,'pings and unchanged views cost nothing');
  // A partial line is buffered until its newline; a changed view is fanned out at once.
  server.streams[0].push('{"type":"view","view":{"subject":"'+subject+'","handle":"alex",');server.streams[0].push('"name":"Alex Renamed","avatar":false}}\n');
  await until(()=>views()[0]?.name==='Alex Renamed',{message:'streamed view'});
  assert.deepEqual(views(),[{subject,handle:'alex',name:'Alex Renamed',delivered:true}]);
  // The document is told the held session tokens, because it ends them itself on pagehide (the worker is often
  // terminated before it reads that message); the worker then aborts the stream and ends nothing twice.
  assert.deepEqual(events.filter(e=>e.event==='sessions').at(-1),{event:'sessions',tokens:['session-1']});
  await worker({op:'pagehide'});await tick(20);
  assert.equal(server.streams[0].aborted,true);
  assert.deepEqual(events.filter(e=>e.event==='sessions').at(-1),{event:'sessions',tokens:[]});
  assert.equal(server.calls.filter(c=>c.path==='/embed/api/session/end').length,0);
});

test('a demoted leader (lock stolen) ends its own sessions with keepalive, bearer only',async t=>{
  const server=embedServer(),store=await openStore({indexedDB:undefined});
  await saveCredential(store,{issuer,clientId},{id:'e'.repeat(24),credential:'cred',subject,delivered:true,createdAt:0,pendingUntil:0});
  // A persistent store with fake Web Locks whose grant can be revoked, as a steal does.
  let reject;const locks={request:(name,options,callback)=>new Promise((ok,fail)=>{reject=fail;Promise.resolve(callback()).then(ok,fail);})};
  class Bus{postMessage(){}close(){}}
  const worker=createIslandWorker({post:()=>{},storeFactory:async()=>({...store,persistent:true}),crypto:webcrypto,fetch:server.fetch,indexedDB:undefined,BroadcastChannel:Bus,locks,timing:{restorePadMs:0}});
  t.after(()=>worker({op:'pagehide'}));
  await worker({id:1,op:'start',args:{config:{issuer,clientId,origin:embed},instance:'C'.repeat(22),role:'member',bucket:64}});
  await until(()=>server.streams.length===1,{message:'stream'});
  reject(Object.assign(new Error('stolen'),{name:'AbortError'}));await tick(20);
  const end=server.calls.filter(c=>c.path==='/embed/api/session/end');
  assert.equal(end.length,1);assert.equal(end[0].method,'POST');assert.equal(end[0].keepalive,true);
  assert.equal(end[0].headers.Authorization,'BindleEmbedSession session-1');assert.equal(end[0].headers.DPoP,undefined);
  assert.equal(server.streams[0].aborted,true);
});

test('a stream the server ends is followed by a fresh restore; renewal ends the replaced session',{timeout:20000},async t=>{
  const server=embedServer(),store=await openStore({indexedDB:undefined});
  await saveCredential(store,{issuer,clientId},{id:'d'.repeat(24),credential:'cred',subject,delivered:true,createdAt:0,pendingUntil:0});
  const worker=createIslandWorker({post:()=>{},storeFactory:async()=>store,crypto:webcrypto,fetch:server.fetch,indexedDB:undefined,BroadcastChannel:undefined,locks:undefined,timing:{restorePadMs:0}});
  t.after(()=>worker({op:'pagehide'}));
  await worker({id:1,op:'start',args:{config:{issuer,clientId,origin:embed},instance:'B'.repeat(22),role:'member',bucket:64}});
  await until(()=>server.streams.length===1,{message:'stream'});
  server.streams[0].close(); // expiry, eviction by a newer stream, or the binding stopped being live
  await until(()=>server.calls.filter(c=>c.path==='/embed/api/session').length===2,{timeout:5000,message:'restore after the stream ended'});
  await until(()=>server.streams.length===2,{message:'stream reopened'});
  assert.equal(server.streams[1].session,'BindleEmbedSession session-2');
  assert.deepEqual(server.calls.filter(c=>c.path==='/embed/api/session/end').map(c=>c.headers.Authorization),['BindleEmbedSession session-1'],'the replaced session is ended');
});

test('embed API: events reject a non-OK response; session end never throws',async()=>{
  const key=await frameKey(await openStore({indexedDB:undefined}),{issuer,clientId,crypto:webcrypto});
  const api=embedAPI({origin:embed,key,fetch:async url=>new URL(url).pathname.endsWith('/nonce')?json({nonce:'x'}):json({},401)});
  await assert.rejects(async()=>{for await(const _ of api.events('s'));},{status:401});
  assert.equal(await embedAPI({origin:embed,key,fetch:async()=>{throw new TypeError('offline');}}).end('s'),false);
});

test('island entries are always embed-popup; the frame key has no FedCM proof',async()=>{
  const key=await frameKey(await openStore({indexedDB:undefined}),{issuer,clientId,crypto:webcrypto});const bodies=[];
  const fetch=async(url,init)=>{bodies.push(JSON.parse(init.body));return json({entryId:b43('e')});};
  const prepare={redirectUri:app+'/callback',challenge:b43('c'),state:b43('s'),requests:[]};
  assert.equal(await createEntry({issuer,clientId,key,prepare,fetch}),b43('e'));
  // A caller asking for the withdrawn FedCM delivery still gets the popup delivery.
  await createEntry({issuer,clientId,key,prepare,delivery:'embed-fedcm',fetch});
  for(const body of bodies){assert.equal(body.delivery,'embed-popup');assert.equal(body.presentation,'popup');assert.equal(body.embedJkt,key.jkt);}
  assert.equal('fedcmProof' in key,false);
  assert.equal('fedcmUsable' in flowModule||'readFedcmToken' in flowModule,false,'no FedCM transport in the island');
});

test('shell config: a config naming FedCM makes the island inert',()=>{
  const doc=config=>({getElementById:()=>({getAttribute:()=>'application/json',textContent:JSON.stringify({v:1,issuer,clientId,origins:[app],parts:['sign-in'],worker:'/embed/assets/w.0123456789abcdef.js',...config})})});
  assert.ok(readConfig(doc({})));assert.equal('fedcm' in readConfig(doc({})),false);
  assert.equal(readConfig(doc({fedcm:{configUrl:`${issuer}/fedcm/config.json`,assertUrl:`${issuer}/fedcm/api/assert`}})),null);
  assert.equal(readConfig(doc({fedcm:null})),null);
});

// ---- Flow transport: always the popup, even where FedCM would be available ---------------------------------------
const kinds=sent=>sent.map(m=>m.type==='flow'?`flow:${m.phase}${m.outcome?':'+m.outcome:''}`:m.type);
test('island flows never call FedCM: the popup opens synchronously even with IdentityCredential and delegation',async()=>{
  const sent=[],calls=[],opened=[];
  const win={IdentityCredential:function IdentityCredential(){},navigator:{credentials:{get:async()=>{calls.push('fedcm');throw new Error('must not be called');}}},open:(...args)=>{opened.push(args);return null;}};
  const client={async call(op,args){calls.push(op);throw new Error(op);}};
  const model={prepare:{redirectUri:app+'/callback',challenge:b43('c'),state:b43('s'),requests:[]},parentOrigin:app,sandboxed:false,flow:null};
  const start=createFlows({model,send:message=>{sent.push(message);return true;},worker:async()=>client,issuer,clientId,fedcm:{configUrl:`${issuer}/fedcm/config.json`,assertUrl:`${issuer}/fedcm/api/assert`},win,doc:{featurePolicy:{allowsFeature:()=>true}}});
  start();await tick(10);
  assert.equal(opened.length,1);assert.deepEqual(opened[0],['about:blank','_blank','popup']);
  assert.deepEqual(kinds(sent),['flow:started','flow:ended:unavailable'],'the null popup is unavailable');
  assert.equal(calls.includes('fedcm'),false);assert.equal(calls.includes('fedcmProof'),false);
});
