import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedWorkerEnvironment,composeWaypoLinkProviderConfiguration} from '../composition.mjs';
import {WAYPO_LINK_ISSUER} from '../policy-preset.mjs';
import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
import {freeCreationRate} from './free-rate.fixture.mjs';

const admission={revision:1,maxPublicAccounts:16,maxProtectedAccounts:2,acceptingNewAccounts:false};
const free=environment=>({mode:'free',environment,accountAdmission:admission,accountCreationRate:freeCreationRate()});
const direct={revision:1,operations:{GET:{delivery:'direct-allowed',defaultTtlMs:1000,maxTtlMs:1000,maxObjectBytes:1,mintRate:{capacity:1,refillPerMinute:1}},PUT:{delivery:'proxy'},DELETE:{delivery:'proxy'}}};
function provider(environment,blobDelivery){return {...nativeCapacityProfile(),issuer:environment==='production'?WAYPO_LINK_ISSUER:'https://identity.example/api/auth',adminUrl:environment==='production'?'https://waypo.link/admin/':'https://identity.example/admin/',installationId:'hosted-download-policy',authSecret:'private-fixture-hosted-download-policy-secret32',admission:'closed',services:{...nativeCapacityProfile().services,blobs:true,...blobDelivery===undefined?{}:{blobDelivery}}};}
function environmentFor(config,settings){return {WAYPO_CONFIG:JSON.stringify(config),[settings.mode==='free'?'HOSTED_FREE_CONFIG':'HOSTED_BILLING_CONFIG']:JSON.stringify(settings)};}

test('hosted Worker rejects replayable R2 reads in every billing mode before reading email or vendor ports',()=>{
 for(const environment of ['sandbox','production'])for(const settings of [free(environment),{environment,paidPlansEnabled:false,subscriptionServicingEnabled:false},{environment,paidPlansEnabled:true,subscriptionServicingEnabled:true,enableActions:true}]){
  const env=environmentFor(provider(environment,direct),settings);
  for(const name of ['EMAIL','POLAR_ACCESS_TOKEN','POLAR_WEBHOOK_SECRET'])Object.defineProperty(env,name,{get(){assert.fail(name+' must not be touched');}});
  assert.throws(()=>hostedWorkerEnvironment(env),{code:'hosted_direct_downloads_unavailable'});
 }
});

test('default, proxied and disabled read policies still compose the free Worker without vendor credentials',()=>{
 for(const policy of [undefined,{revision:1,operations:{GET:{delivery:'proxy'}}},{revision:1,operations:{GET:{delivery:'direct-disabled'}}}]){
  const result=hostedWorkerEnvironment(environmentFor(provider('sandbox',policy),free('sandbox')));
  assert.equal(result.settings.mode,'free');
  assert.equal(JSON.parse(result.env.WAYPO_CONFIG).policy.freeServices.storageBytes,500000000);
  assert.equal(Object.hasOwn(result.settings,'accessToken'),false);
 }
});

test('the Worker-only guard does not silently rewrite Node or reference delivery configuration',()=>{
 const config=composeWaypoLinkProviderConfiguration(provider('sandbox',direct),free('sandbox'));
 assert.deepEqual(config.services.blobDelivery,direct);
});
