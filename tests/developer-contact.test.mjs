// Developer-contact tier checks and the contact-link developer policy (re-homed to packages/links/audience.mjs by
// contacts spike CR-C5; contact links keep it until phase 4). The developer-contact route (eligibility read and
// principal-bound invitations) is covered by developer-contact-invitations.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';import {developerContactTier,developerContactRoutes} from '../packages/runtime/developer-contact.mjs';import {evaluateLinkPolicy} from '../packages/links/audience.mjs';import {DEVELOPER_CONTACT_POLICY} from '../packages/links/policies.mjs';import {key} from '../packages/core/records.mjs';import {BILLING_STATE_KEY} from '../packages/billing/catalog.mjs';
const owner=crypto.randomUUID(),beneficiary=crypto.randomUUID(),origin='https://developer.example';
// A same-host world: developer and senders are real AccountControllers wired through the identity and account ports.
async function world(){
 const accounts=new Map(),directory=new Map(),tiers=new Map(),closers=[],state={population:'all-active'};
 const make=async handle=>{const id=crypto.randomUUID(),metadata=new SqliteMetadata(':memory:'),stored=new Map(),bucket={put:async(k,b)=>{stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{size:stored.get(k).byteLength,arrayBuffer:async()=>stored.get(k).buffer.slice(0)}:null,delete:async k=>{stored.delete(k);}};closers.push(()=>metadata.close());
  const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket,archives:bucket,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:Buffer.alloc(32,12).toString('base64'),WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false',CONVERSATION_ACCOUNT:o=>accounts.get(o),IDENTITY_ACCOUNT:async o=>directory.get(o)??null,DEVELOPER_CONTACT_POPULATION:{policy:async()=>{if(state.population==='throw')throw Error('down');const now=Date.now();return {mode:state.population,observedAt:now,validUntil:now+60000};}}}});
  await controller.warm(id);await controller.signingKey(id);controller.developerContactTier=async o=>{if(tiers.get(o)==='error')throw Object.assign(Error('stale'),{code:'developer_contact_eligibility_unavailable'});return tiers.get(o)??'free';};
  accounts.set(id,controller);directory.set(id,{status:'active',handle});return {id,handle,controller,stored};};
 const developer=await make('n.dev');
 return {accounts,directory,tiers,state,make,developer,close:()=>closers.forEach(close=>close())};
}
const principal=sender=>({issuer:origin,subject:sender.id});
test('tier eligibility requires recent confirmed entitlement, excludes provisional upgrades and expired/past-due states',async t=>{/* Frozen wall time: freshness bounds and the UTC-day quota cannot drift mid-test. */t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,14,12)});const metadata=new SqliteMetadata(':memory:'),now=Date.now(),config={APP_ORIGIN:origin,POLAR_SERVER:'production'},parameters={id:'paid',name:'Paid',storageBytes:5000000000,activityHour:1000,activityDay:5000},state={owner,source:'polar',catalogVersion:3,plan:'paid',status:'active',validUntil:now+86400000,reconciledAt:now,verifiedPlan:parameters,origin,server:'production',metadataPrefix:'3sln_me_',catalogMode:'static',organizationId:'org',productId:'paid',subscriptionId:'subscription',currency:'usd'},calls=[],controller={metadata,config,warm:async id=>calls.push(['warm',id]),billingRefresh:async(id,options)=>calls.push(['refresh',id,options])};try{await metadata.put(BILLING_STATE_KEY,{...state,upgrade:{version:1,owner,origin,server:'production',organizationId:'org',subscriptionId:'subscription',plan:'ultra',parameters:{...parameters,id:'ultra'},targetProductId:'ultra',currency:'usd',startedAt:now,expiresAt:now+600000}});assert.equal(await developerContactTier(controller,owner),'paid');assert.deepEqual(calls.at(-1),['refresh',owner,{force:true}]);await metadata.put(BILLING_STATE_KEY,{...state,status:'canceled'});assert.equal(await developerContactTier(controller,owner),'paid');for(const patch of [{status:'past_due'},{validUntil:now-1},{owner:beneficiary},{source:'history'},{origin:'https://wrong.example'}]){await metadata.put(BILLING_STATE_KEY,{...state,...patch});assert.equal(await developerContactTier(controller,owner),'free');}for(const reconciledAt of [undefined,now-300001,now+86400000]){await metadata.put(BILLING_STATE_KEY,{...state,reconciledAt});await assert.rejects(developerContactTier(controller,owner),{code:'developer_contact_eligibility_unavailable'});}}finally{metadata.close();}});

test('developer policy: same-host principals only; paid tiers tag priority; population decides free accounts; unknown authority is unavailable',async()=>{const w=await world();try{const d=w.developer.controller,s=await w.make('n.abc');
 assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,{issuer:'https://other.example',subject:s.id}),{eligible:false,reason:'local-only',final:false});
 assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{eligible:true,tier:'free',tags:['priority:free'],final:false});
 w.tiers.set(s.id,'paid');assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{eligible:true,tier:'paid',tags:['priority:paid'],final:false});
 w.tiers.set(s.id,'ultra');assert.equal((await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s))).final,true);
 w.tiers.delete(s.id);w.state.population='paid-only';assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{eligible:false,reason:'paid-required',tier:'free'});
 w.state.population='throw';assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{state:'unavailable'});
 w.state.population='unavailable';assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{state:'unavailable'});
 w.tiers.set(s.id,'error');assert.deepEqual(await evaluateLinkPolicy(d,DEVELOPER_CONTACT_POLICY,principal(s)),{state:'unavailable'});
 assert.deepEqual(await evaluateLinkPolicy(d,'https://3sln.example/policies/other/v1',principal(s)),{state:'unavailable'});assert.deepEqual(await evaluateLinkPolicy(d,undefined,principal(s)),{eligible:true,final:true});
}finally{w.close();}});

test('developer contact rate limiting returns a stable code without server English copy',async()=>{const result=await developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env:{},owner:{account:{id:owner}},limit:async()=>false,json:(value,status,headers)=>({value,status,headers})});assert.deepEqual(result,{value:{error:'rate_limited'},status:429,headers:{'Retry-After':'60'}});});


test('review L5: a cached tier read (GET) neither forces a billing refresh nor writes; a stale paid state reads as its plan',async t=>{t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,14,12)});const metadata=new SqliteMetadata(':memory:'),now=Date.now(),config={APP_ORIGIN:origin,POLAR_SERVER:'production'},parameters={id:'paid',name:'Paid',storageBytes:5000000000,activityHour:1000,activityDay:5000},calls=[],controller={metadata,config,warm:async id=>calls.push(['warm',id]),billingRefresh:async(id,options)=>calls.push(['refresh',id,options])};try{
 await metadata.put(BILLING_STATE_KEY,{owner,source:'polar',catalogVersion:3,plan:'paid',status:'active',validUntil:now+86400000,reconciledAt:now-3600000,verifiedPlan:parameters,origin,server:'production',metadataPrefix:'3sln_me_',catalogMode:'static',organizationId:'org',productId:'paid',subscriptionId:'subscription',currency:'usd'});
 const before=[...(await metadata.list({prefix:''})).entries()];
 assert.equal(await developerContactTier(controller,owner,{fresh:false}),'paid');assert.deepEqual(calls,[['warm',owner]],'no billing refresh');
 assert.deepEqual([...(await metadata.list({prefix:''})).entries()],before,'nothing written');
 await assert.rejects(developerContactTier(controller,owner),{code:'developer_contact_eligibility_unavailable'},'the fresh read (POST) still refuses a stale paid state');
}finally{metadata.close();}});
