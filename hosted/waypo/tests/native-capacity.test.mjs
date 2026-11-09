import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
import {composeWaypoLinkProviderConfiguration,hostedWorkerEnvironment} from '../composition.mjs';
import {createWaypoLinkNodeApplication} from '../node.mjs';
import {validateProviderConfiguration} from '@3sln/waypo/configuration';
import {freeCreationRate} from './free-rate.fixture.mjs';
const provider=()=>({...nativeCapacityProfile(),issuer:'https://identity.example/api/auth',adminUrl:'https://admin.identity.example/',installationId:'capacity-fixture',authSecret:'fixture-secret-at-least-thirty-two-characters'});
const settings={mode:'free',environment:'sandbox',accountCreationRate:freeCreationRate(),accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:2,acceptingNewAccounts:true}};
test('hosted Node and Worker reject absent or incomplete Native policy before startup',async()=>{
 const invalid=[];
 for(const key of ['nativeCredentials','nativeRetainedLimits','nativeStorageCapacity','sessionSecurity']){const input=provider();delete input[key];invalid.push(input);}
 for(const key of ['sessionInstallation','sessionOwner','keyInstallation','keyOwner']){const input=provider();delete input.nativeRetainedLimits[key];invalid.push(input);}
 for(const key of ['maxBytes','headroomBytes','retryMs']){const input=provider();delete input.nativeStorageCapacity[key];invalid.push(input);}
 for(const patch of [{enabled:false},{mailPolicy:undefined},{mailPolicy:{owner:{maxSends:6,windowMs:600000,cooldownMs:60000}}},{mailPolicy:{owner:{maxSends:Infinity},review:{}}}]){const input=provider();Object.assign(input.sessionSecurity,patch);invalid.push(input);}
 for(const input of invalid){assert.throws(()=>composeWaypoLinkProviderConfiguration(input,settings));assert.throws(()=>hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(input),HOSTED_FREE_CONFIG:JSON.stringify(settings)}));await assert.rejects(createWaypoLinkNodeApplication(input,settings));}
});
test('complete explicit hosted profile preserves free policy while private core stays optional',()=>{
 const input=provider(),config=composeWaypoLinkProviderConfiguration(input,settings);
 assert.deepEqual(config.nativeRetainedLimits,input.nativeRetainedLimits);assert.deepEqual(config.nativeStorageCapacity,input.nativeStorageCapacity);
 assert.deepEqual(config.policy.freeServices,{storageBytes:500000000,signaling:true});assert.deepEqual(config.policy.plans,{});
 assert.equal(JSON.parse(hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(input),HOSTED_FREE_CONFIG:JSON.stringify(settings)}).env.WAYPO_CONFIG).sessionSecurity.enabled,true);
 for(const key of ['nativeCredentials','nativeRetainedLimits','nativeStorageCapacity','sessionSecurity'])delete input[key];
 assert.equal(validateProviderConfiguration(input).nativeCredentials,undefined);
});
