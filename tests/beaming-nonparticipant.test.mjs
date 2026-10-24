// Red-team round 3 D3: a non-participant who names an existing offer gets a different answer from an unknown offer,
// and also learns participant device/account state (validateOffer runs device checks before the participant check).
import test from 'node:test';
import assert from 'node:assert/strict';
import {beamRoutes} from '../packages/beaming/http.mjs';
import {BeamError} from '../packages/beaming/index.mjs';

const sender='11111111-1111-4111-8111-111111111111',recipient='22222222-2222-4222-8222-222222222222',stranger='66666666-6666-4666-8666-666666666666';
const offerId='33333333-3333-4333-8333-333333333333',unknownId='77777777-7777-4777-8777-777777777777',grantId='44444444-4444-4444-8444-444444444444';
function fixture(){
 const record={id:offerId,sender,recipient,senderDevice:'sender-device',recipientDevice:null,allowedDevices:['recipient-device'],permission:{kind:'contact',id:grantId},expiresAt:Date.now()+60000,state:'offered'};
 const accounts=new Map([[sender,{status:'active',handle:'s',sessions:[{id:'sender-device',expiresAt:Date.now()+60000}]}],[recipient,{status:'active',handle:'r',sessions:[{id:'recipient-device',expiresAt:Date.now()+60000}]}],[stranger,{status:'active',handle:'x',sessions:[{id:'stranger-device',expiresAt:Date.now()+60000}]}]]);
 const peer={beamPermission:async()=>({kind:'contact',id:grantId}),beamRaw:async(owner,id)=>{if(id!==offerId)throw new BeamError('beam_not_found','Transfer not found.',404);return record;},beamAction:async()=>({})};
 const env={APP_ORIGIN:'https://portal.example',IDENTITY_REPOSITORY:{get:async id=>accounts.get(id)}};
 const fetch=path=>beamRoutes({path,url:new URL(path,env.APP_ORIGIN),request:new Request(new URL(path,env.APP_ORIGIN)),env,owner:{account:{id:stranger},devices:[{id:'stranger-device',current:true}]},object:{},accountHandle:()=>peer,body:async()=>({}),json:v=>v});
 const outcome=path=>fetch(path).then(v=>({ok:v}),e=>({code:e.code,status:e.status}));
 return {accounts,outcome};
}

test('a stranger cannot distinguish an existing offer from an unknown one',async()=>{
 const f=fixture();
 const unknown=await f.outcome(`/api/beams/${sender}/${unknownId}`),existing=await f.outcome(`/api/beams/${sender}/${offerId}`);
 assert.deepEqual(existing,unknown);
});

test('a stranger does not learn whether the participants\' devices are still signed in',async()=>{
 const f=fixture(),before=await f.outcome(`/api/beams/${sender}/${offerId}`);
 f.accounts.get(sender).sessions=[];
 const after=await f.outcome(`/api/beams/${sender}/${offerId}`);
 assert.deepEqual(after,before);
});

test('the beam service answers a non-participant account as for an unknown offer, before expiry or device checks',async()=>{
 const {BeamService}=await import('../packages/beaming/index.mjs');
 const rows=new Map(),metadata={get:async k=>structuredClone(rows.get(k)),put:async(k,v)=>{rows.set(k,structuredClone(v));},transaction:async fn=>fn({get:async k=>structuredClone(rows.get(k)),put:async(k,v)=>{rows.set(k,structuredClone(v));}})};
 const service=new BeamService({metadata,config:{},entitlement:async()=>({plan:'plus'})});
 rows.set('beam/offer/'+offerId,{id:offerId,sender,recipient,senderDevice:'sender-device',recipientDevice:null,allowedDevices:['recipient-device'],expiresAt:Date.now()-1,state:'offered',signals:[],nextSeq:{sender:0,recipient:0}});
 const unknown=await service.action(unknownId,{account:stranger,device:'stranger-device'},'get').catch(e=>({code:e.code,status:e.status}));
 const existing=await service.action(offerId,{account:stranger,device:'stranger-device'},'get').catch(e=>({code:e.code,status:e.status}));
 assert.deepEqual(existing,unknown);assert.deepEqual(existing,{code:'beam_not_found',status:404});
});

test('review follow-up: an unknown sender identity is refused before its account object, and a lifecycle-faulted sender answers as an unknown offer',async()=>{
 const opened=[];const env={APP_ORIGIN:'https://portal.example',IDENTITY_REPOSITORY:{get:async id=>id===sender?{status:'deleted',handle:'s',sessions:[]}:null}};
 const handles=id=>{opened.push(id);return {beamRaw:async()=>{throw Object.assign(new Error('gone'),{code:'account_deleted',status:410});}};};
 const fetch=path=>beamRoutes({path,url:new URL(path,env.APP_ORIGIN),request:new Request(new URL(path,env.APP_ORIGIN)),env,owner:{account:{id:stranger},devices:[{id:'stranger-device',current:true}]},object:{},accountHandle:(_env,id)=>handles(id),body:async()=>({}),json:v=>v}).then(v=>({ok:v}),e=>({code:e.code,status:e.status}));
 const ghost='99999999-9999-4999-8999-999999999999';
 assert.deepEqual(await fetch(`/api/beams/${ghost}/${offerId}`),{code:'beam_not_found',status:404});
 assert.ok(!opened.includes(ghost),'an unknown sender UUID never reaches the account object');
 assert.deepEqual(await fetch(`/api/beams/${sender}/${offerId}`),{code:'beam_not_found',status:404});
});
