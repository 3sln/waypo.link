// Wargame Q3 (2026-10-23): a failed TURN issuance must not lock the participant out of relay credentials. On failure
// the 'issuing' marker returns to unset and the relay reservation is released when the budget supports release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';

const origin='http://localhost:8797',password='Beam integration password enough entropy!';
const files=[{id:'one',name:'one.txt',size:12,type:'text/plain'},{id:'two',name:'two.txt',size:24,type:'text/plain'}];
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'beam-ice-retry-')),config={APP_ORIGIN:origin,BEAM_ENABLED:'true',BEAM_STUN_ENABLED:'false',BEAM_MONTHLY_DELIVERY_BYTES:'1000000000',BEAM_MONTHLY_OFFERS:'20'};let signups=0;const app=await createNodeServer({directory,config});
 const request=async(path,{method='GET',input,headers={}}={})=>{const response=await app.fetch(new Request(new URL(path,origin),{method,headers:{Origin:origin,...path==='/api/auth/signup'?{'CF-Connecting-IP':`127.0.0.${++signups}`}:{},...headers,...input!==undefined?{'Content-Type':'application/json'}:{}},...input===undefined?{}:{body:JSON.stringify(input)}}));return {status:response.status,value:await response.json(),response};};
 const post=(path,input)=>request(path,{method:'POST',input});
 const signup=async()=>{const pending=await post('/api/auth/signup',{password,method:'password',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'});assert.equal(pending.status,200,JSON.stringify(pending.value));const recovery=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:recovery.value.recoveryToken,downloadConfirmed:true});assert.equal(activated.status,200);return {...activated.value,headers:{Cookie:activated.response.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':activated.value.csrfToken}};};
 const sender=await signup(),recipient=await signup();
 await app.resources.accounts.get(sender.account.id).metadata.put('billing/state',{owner:sender.account.id,source:'polar',plan:'plus',validUntil:Date.now()+3600000});
 const device=async s=>(await request('/api/session',{headers:s.headers})).value.devices.find(d=>d.current).id;
 const controller=app.resources.accounts.get(sender.account.id),actor={account:sender.account.id,device:await device(sender)},recipientDevice=await device(recipient);
 const record=await controller.beams.create(sender.account.id,actor,{recipient:recipient.account.id,devices:[recipientDevice],deviceId:recipientDevice,files});
 await controller.beams.action(record.id,{account:recipient.account.id,device:recipientDevice},'accept',{fileIds:['one']});
 Object.assign(controller.config,{BEAM_TURN_ENABLED:'true',CLOUDFLARE_TURN_KEY_ID:'mock-key',CLOUDFLARE_TURN_API_TOKEN:'mock-token'});
 return {controller,actor,record,sender,close:async()=>{await app.close();await rm(directory,{force:true,recursive:true});}};
}
const turn=()=>new Response(JSON.stringify({iceServers:[{urls:['turn:turn.cloudflare.com:3478?transport=udp'],username:'u',credential:'c'}]}),{status:201});

test('a transient TURN provider failure releases the reservation and allows a retry, then issuance is single-use',async()=>{
 const f=await fixture(),originalFetch=globalThis.fetch;
 try{
  const events=[];f.controller.config.BEAM_RELAY_BUDGET={reserve:async()=>{events.push('reserve');return {enforced:true,id:events.length};},commit:async r=>{events.push('commit:'+r.id);},release:async r=>{events.push('release:'+r.id);}};
  let calls=0;globalThis.fetch=async url=>{if(String(url).includes('/revoke'))return new Response(null,{status:204});calls++;return calls===1?new Response('{}',{status:503}):turn();};
  const ice=()=>f.controller.beamIce(f.sender.account.id,f.record.id,f.actor);
  await assert.rejects(ice(),{code:'beam_turn_unavailable'});
  assert.deepEqual(events,['reserve','release:1']);
  assert.equal((await f.controller.beams.raw(f.record.id)).iceIssued.sender,undefined);
  const second=await ice();assert.equal(second.relayEnabled,true);
  assert.equal((await f.controller.beams.raw(f.record.id)).iceIssued.sender,true);
  await assert.rejects(ice(),{code:'beam_turn_already_issued'});
 }finally{globalThis.fetch=originalFetch;await f.close();}
});

test('an unfunded relay reservation does not leave the participant stuck in issuing',async()=>{
 const f=await fixture(),originalFetch=globalThis.fetch;
 try{
  let funded=false;f.controller.config.BEAM_RELAY_BUDGET={reserve:async()=>({enforced:funded}),commit:async()=>{}};
  globalThis.fetch=async()=>turn();
  await assert.rejects(f.controller.beamIce(f.sender.account.id,f.record.id,f.actor),{code:'beam_turn_unfunded'});
  funded=true;assert.equal((await f.controller.beamIce(f.sender.account.id,f.record.id,f.actor)).relayEnabled,true);
 }finally{globalThis.fetch=originalFetch;await f.close();}
});
