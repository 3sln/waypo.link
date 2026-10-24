// Device authorization grant fixture (red-team round 3, D4/D5): the real LA1 identity core with real owner
// FederationService shards, as in tests/device-authorization.test.mjs, exported for the device-approval-paths suite.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {identityEngine,activate,context,sessionContext,config as identityConfig,PASSWORD,MemoryAccounts,MemoryDevices} from './identity-engine.mjs';
import {forEachSeed,createScheduler,fakeClock} from './chaos.mjs';
import {createTestEngine} from './app-engine.mjs';
import {dpopKey} from '../authorization-entry-helpers.mjs';
import {LinkedSystemAction,LinkedApprovalAction,LinkedResolveQuery,LinkedLineageQuery,LinkedOutboxQuery,MemoryLinkedLimits} from '../../packages/identity/index.mjs';
import {FederationController} from '../../packages/federation/runtime.mjs';
import {MemoryFederationStore} from '../../packages/federation/index.mjs';
import {dpopNonces} from '../../packages/federation/dpop.mjs';
import {NO_EXPIRY} from '../../packages/federation/app-sessions.mjs';
import {bindChildTokens,sweepDeviceFamilies,createDeviceGrantProvider,linkedPort,attachAppSessions,deviceManifest,DEVICE_GRANT,DEVICE_FEATURE,DeviceAuthorize,DeviceToken,DeviceReview,DeviceApprove,DeviceRpc,DeviceCancel,DeviceLineageDrain,MemberDpopRpc} from '../../packages/federation/device-authorization.mjs';

const DAY=86400000,MINUTE=60000,issuer=identityConfig.origin,SECRET='device-test-dpop-secret-0001',FORM={'Content-Type':'application/x-www-form-urlencoded'};
const fragment='https://schema.example/settings/v1',schema={id:fragment,title:'Settings',description:'Shared settings',publisher:'https://schema.example',fields:{theme:{title:'Theme',type:'enum',values:['dark','light']}}};
const cli={id:'https://acme.example/cli',name:'Acme CLI',origin:'https://acme.example',redirectUris:['https://acme.example/callback'],grantTypes:[DEVICE_GRANT,'refresh_token'],deviceFragments:[fragment]};
const web={id:'https://web.example/app',name:'Web app',origin:'https://web.example',redirectUris:['https://web.example/callback']};
const unreviewed={...cli,id:'https://unreviewed.example/cli',origin:'https://unreviewed.example',redirectUris:['https://unreviewed.example/cb'],reviewed:false};
const body=fields=>new URLSearchParams(fields).toString();

export async function fixture({clock=fakeClock(),flag=true,repository,deviceRequests,linkedPollLimits,policy={},featureAllowed}={}){
 const id=identityEngine({clock,config:{...identityConfig,deviceAuthorizationEnabled:true},...repository?{repository}:{},...deviceRequests?{deviceRequests}:{},...linkedPollLimits?{linkedPollLimits}:{}});
 const linked=linkedPort(id.engine,{LinkedSystemAction,LinkedApprovalAction,LinkedResolveQuery,LinkedLineageQuery,LinkedOutboxQuery});
 const shards=new Map(),clients=[cli,web,unreviewed];
 const shard=owner=>{if(!shards.has(owner)){const subject=`${issuer}/entities/${owner}`;
  const controller=new FederationController({metadata:new MemoryFederationStore(),issuer,clients,crypto:webcrypto,clock:clock.now,routingKey:owner,refreshEnabled:true,schemaHosts:['schema.example'],schemaFetcher:async()=>structuredClone(schema),dispatcher:async()=>({ok:true}),dpop:{secret:SECRET},
   validateSubject:async(candidate,epoch)=>candidate===subject&&epoch==='epoch-1'&&(await id.repository.get(owner))?.status==='active',
   // The production bridge (runtime/federation.mjs): the identity session authorizes the owner shard.
   auth:{owner:async(ctx,{mutation})=>{const {account,session}=await id.service.authorized(ctx,mutation);if(account.id!==owner)throw Object.assign(new Error('forbidden'),{code:'forbidden'});return {subject,epoch:'epoch-1',authTime:id.service.authAt(session)};}}});
  attachAppSessions(controller.service,{linked,config:policy});shards.set(owner,controller);}return shards.get(owner);};
 const nonces=dpopNonces({secret:SECRET,crypto:webcrypto,clock:clock.now}),pollLimits=new MemoryLinkedLimits(clock.now);
 const provider=createDeviceGrantProvider({issuer,clients,featureAllowed,linked,shard,nonces,limits:new MemoryLinkedLimits(clock.now),pollLimits,crypto:webcrypto,clock:clock.now});
 const engine=await createTestEngine({providers:{config:{DEVICE_AUTHORIZATION_ENABLED:flag?'true':'false'},deviceGrant:provider}});
 const op=(Kind,input)=>engine.perform(new Kind({input}));
 const iat=()=>Math.floor(clock.now()/1000);
 const f={id,clock,linked,shard,nonces,provider,engine,op,pollLimits,
  service:owner=>shard(owner).service,
  authorize:(fields,{headers={},remoteIP='192.0.2.10'}={})=>op(DeviceAuthorize,{headers:{...FORM,...headers},body:body(fields),remoteIP}),
  start:async(key,fields={},options)=>{const r=await f.authorize({client_id:cli.id,dpop_jkt:key.jkt,...fields},options);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;},
  proof:async(key,extra={})=>key.sign({htu:`${issuer}/oauth/token`,nonce:await nonces.issue('token'),iat:iat(),...extra}),
  poll:async(key,flow,{proof,clientId=cli.id,remoteIP='192.0.2.10',headers={}}={})=>op(DeviceToken,{headers:{...FORM,...proof===null?{}:{DPoP:proof??await f.proof(key)},...headers},body:body({grant_type:DEVICE_GRANT,device_code:flow.device_code,client_id:clientId}),remoteIP}),
  login:async(handle='alice')=>id.act('loginPassword',{handle,password:PASSWORD,turnstileToken:'verified'},context),
  review:(session,flow)=>op(DeviceReview,{context:sessionContext(session),requestId:requestOf(flow),code:flow.user_code}),
  approve:async(session,flow,extra={})=>{const view=await f.review(session,flow);return op(DeviceApprove,{context:sessionContext(session),requestId:requestOf(flow),code:flow.user_code,approved:view.consent.requests.map(r=>({fragment:r.fragment,fields:r.fields,revision:r.revision})),...extra});},
  refresh:async(owner,key,token,extra={})=>f.service(owner).refresh({refreshToken:token,clientId:cli.id,dpop:await key.sign({htu:`${issuer}/oauth/token`,nonce:await nonces.issue('token'),iat:iat(),...extra})}),
  rpc:async(key,token,extra={})=>op(DeviceRpc,{authorization:`DPoP ${token}`,dpop:await key.sign({htu:`${issuer}/bindle/rpc`,ath:token,iat:iat(),...extra}),envelope:envelope()}),
  families:async owner=>(await f.service(owner).store.transaction(tx=>tx.list('federation/family/'))).map(row=>row.value),
  dispose:async()=>{await engine.dispose();await id.engine.dispose();}};
 return f;
}
export const requestOf=flow=>flow.device_code.split('.')[0];
export {cli,issuer,DEVICE_GRANT,DeviceApprove,DeviceReview,LinkedApprovalAction,activate,sessionContext,context,dpopKey};
