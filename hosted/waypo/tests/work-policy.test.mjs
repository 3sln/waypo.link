import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
import {serviceWorkProfile} from './work-policy.fixture.mjs';
import {freeCreationRate} from './free-rate.fixture.mjs';
import {composeWaypoLinkProviderConfiguration,hostedWorkerEnvironment} from '../composition.mjs';
import {createWaypoLinkNodeApplication} from '../node.mjs';
import {validateProviderConfiguration} from '@3sln/waypo/configuration';
const settings={mode:'free',environment:'sandbox',accountCreationRate:freeCreationRate(),accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:2,acceptingNewAccounts:false}};
const provider=()=>({...nativeCapacityProfile(),issuer:'https://identity.example/api/auth',adminUrl:'https://admin.identity.example/',installationId:'work-fixture',authSecret:'fixture-only-work-at-least-thirty-two-characters',admission:'closed'});

test('hosted Node and Worker reject missing or malformed work policies before runtime allocation',async()=>{
 const invalid=[];const missing=provider();delete missing.tokenWork;invalid.push(missing);
 for(const value of [null,false,{},'disabled',{...provider().tokenWork,extra:true},{...provider().tokenWork,costs:{lookup:1,refresh:Infinity}},{...provider().tokenWork,family:{capacity:0,refillPerMinute:1}}])invalid.push({...provider(),tokenWork:value});
 for(const flag of ['sync','signaling','notifications'])invalid.push({...provider(),services:{[flag]:true}});
 for(const value of [null,false,{},'disabled',{...serviceWorkProfile(),extra:true},{...serviceWorkProfile(),costs:{...serviceWorkProfile().costs,'storage-write':1025}},{...serviceWorkProfile(),app:{capacity:Infinity,refillPerMinute:1}}])invalid.push({...provider(),services:{sync:true,workBudget:value}});
 for(const input of invalid){let allocations=0;Object.defineProperty(input,'database',{enumerable:true,configurable:true,get(){allocations++;throw Error('Runtime allocation must not be reached');}});assert.throws(()=>composeWaypoLinkProviderConfiguration(input,settings),TypeError);assert.equal(allocations,0);delete input.database;assert.throws(()=>hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(input),HOSTED_FREE_CONFIG:JSON.stringify(settings)}),TypeError);await assert.rejects(createWaypoLinkNodeApplication(input,settings),TypeError);assert.equal(allocations,0);}
});

test('all enabled hosted capabilities require explicit finite admission without billing or public signup',()=>{
 const input={...provider(),services:{sync:true,attachments:true,subscriptions:true,notifications:true,signaling:true,workBudget:serviceWorkProfile()}},before=structuredClone(input),config=composeWaypoLinkProviderConfiguration(input,settings);assert.deepEqual(input,before);assert.equal(config.admission,'closed');assert.equal(config.accountAdmission.acceptingNewAccounts,false);assert.deepEqual(config.policy.freeServices,{storageBytes:500000000,signaling:true});assert.deepEqual(config.policy.plans,{});assert.deepEqual(config.tokenWork,input.tokenWork);assert.deepEqual(config.services.workBudget,input.services.workBudget);
 const output=JSON.parse(hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(input),HOSTED_FREE_CONFIG:JSON.stringify(settings)}).env.WAYPO_CONFIG);assert.deepEqual(output.services.workBudget,input.services.workBudget);assert.equal(output.accountAdmission.maxPublicAccounts,16,'test admission limit is unchanged');
});

test('closed hosted operator can disable optional modules; private core does not inherit hosted mandatory policies',()=>{
 const input=provider(),config=composeWaypoLinkProviderConfiguration(input,settings);assert.equal(config.services,undefined);assert.deepEqual(config.tokenWork,input.tokenWork);input.services={sync:false,signaling:false,notifications:false};assert.equal(composeWaypoLinkProviderConfiguration(input,settings).services.workBudget,undefined);
 for(const key of ['nativeCredentials','nativeRetainedLimits','nativeStorageCapacity','sessionSecurity','tokenWork'])delete input[key];assert.equal(validateProviderConfiguration(input).tokenWork,undefined);
});

test('checked-in engineering preview remains closed with finite work policies and no optional feature activation',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'),read=name=>{const line=source.split('\n').find(value=>value.includes('"'+name+'":'));return JSON.parse(JSON.parse(line.slice(line.indexOf(':')+1).trim().replace(/,$/,'')));},input=read('WAYPO_CONFIG'),free=read('HOSTED_FREE_CONFIG'),config=composeWaypoLinkProviderConfiguration(input,free);assert.equal(config.admission,'closed');assert.equal(config.accountAdmission.acceptingNewAccounts,false);assert.equal(config.accountAdmission.maxPublicAccounts,1);assert.deepEqual(free.allowedSignupCountries,[]);for(const flag of ['sync','attachments','subscriptions','notifications','signaling'])assert.notEqual(config.services?.[flag],true);assert.equal(config.tokenWork.revision,'engineering-example-work-v1');assert.equal(config.services.workBudget.revision,'engineering-example-work-v1');assert.match(source,/not financially safe defaults/);
});
