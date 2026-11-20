import {nativeCapacityProfile} from './native-capacity.fixture.mjs';
import {freeCreationRate} from './free-rate.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {composeWaypoLinkProviderConfiguration,hostedWorkerEnvironment,createWaypoLinkExtensionFactory,validateHostedFreeSettings} from '../composition.mjs';
import {createPolicyEngine,createPolicyEventsPort,AccountPolicyQuery,RunFundingMaintenanceAction} from '@3sln/waypo/engines/policies';
import {TransactionStore} from '../../../../waypo/tests/engine/helpers/transaction-store.mjs';
const issuer='https://identity.example/api/auth',settings={mode:'free',environment:'sandbox',accountCreationRate:freeCreationRate(),accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:2,acceptingNewAccounts:true}},provider={...nativeCapacityProfile(),issuer,installationId:'free-test',adminUrl:'https://identity.example/admin/',authSecret:'test-only-free-mode-secret-longer-than32'};
test('free hosted mode is explicit, finite, requires no Polar configuration and cannot silently coexist with billing',()=>{
 const env={WAYPO_CONFIG:JSON.stringify(provider),HOSTED_FREE_CONFIG:JSON.stringify(settings)};
 Object.defineProperties(env,{POLAR_ACCESS_TOKEN:{get(){throw Error('Polar token touched');}},POLAR_WEBHOOK_SECRET:{get(){throw Error('Polar secret touched');}}});
 const result=hostedWorkerEnvironment(env),config=JSON.parse(result.env.WAYPO_CONFIG);assert.deepEqual(config.policy.freeServices,{storageBytes:500000000,signaling:true});assert.deepEqual(config.policy.plans,{});assert.deepEqual(config.accountAdmission,settings.accountAdmission);assert.deepEqual(config.accountCreationRate,settings.accountCreationRate);assert.equal(result.settings.mode,'free');assert.equal(Object.hasOwn(result.settings,'accessToken'),false);
 assert.throws(()=>hostedWorkerEnvironment({WAYPO_CONFIG:env.WAYPO_CONFIG}),/exactly one/);assert.throws(()=>hostedWorkerEnvironment({...env,HOSTED_BILLING_CONFIG:'{}'}),/exactly one/);
 for(const extra of [{mode:'paid'},{freeStorageBytes:0},{freeStorageBytes:Infinity},{enableActions:true},{environment:'test'},{accountAdmission:undefined},{accountCreationRate:undefined},{accountCreationRate:{...freeCreationRate(),global:{capacity:Infinity,refillPerMinute:1}}},{accountAdmission:{...settings.accountAdmission,maxPublicAccounts:Infinity}},{accountAdmission:{...settings.accountAdmission,acceptingNewAccounts:'true'}}])assert.throws(()=>validateHostedFreeSettings({...settings,...extra}));
 assert.throws(()=>validateHostedFreeSettings({mode:'free',environment:'sandbox'}));
 assert.throws(()=>composeWaypoLinkProviderConfiguration(provider,{mode:'free',environment:'sandbox'}));
 assert.deepEqual(composeWaypoLinkProviderConfiguration({...provider,accountAdmission:{...settings.accountAdmission,maxPublicAccounts:99999}},settings).accountAdmission,settings.accountAdmission);
 assert.equal(composeWaypoLinkProviderConfiguration(provider,{...settings,freeStorageBytes:600000000}).policy.freeServices.storageBytes,600000000);
 assert.throws(()=>composeWaypoLinkProviderConfiguration(provider,{...settings,environment:'production'}),/production issuer is fixed/);
});
test('free hosted extension has no billing route, offer, customer ledger or vendor work',async()=>{
 const extension=await createWaypoLinkExtensionFactory(settings)({});assert.deepEqual(extension.userLinks,[]);assert.equal(extension.describeAccountServices,undefined);
 for(const path of ['/account/billing','/api/hosted/billing/status','/api/hosted/billing/checkout','/api/hosted/polar/webhook'])assert.equal((await extension.handle(new Request('https://identity.example'+path))).status,404);
 assert.equal(extension.recordServiceUsage,undefined);assert.equal(extension.runDue,undefined);
});
test('configured free policy grants shared capacity and signaling with real policy engine and no billing event',async t=>{
 const store=new TransactionStore(),config=composeWaypoLinkProviderConfiguration(provider,settings).policy,ports={store,configuration:()=>config},engine=createPolicyEngine(ports),events=createPolicyEventsPort(ports);t.after(()=>engine.dispose());
 await events.recordAccount({subject:'owner',createdAt:Date.now(),contacts:[{id:'email-ref',type:'email',verified:true,healthy:true}]});const state=await engine.query(new AccountPolicyQuery({subject:'owner'},{issuer,subject:'owner',sessionId:'native-session'})).peek();assert.equal(state.storageBytes,500000000);assert.equal(state.maySignal,true);assert.equal(state.maySyncWrite,true);assert.equal(state.overageBudget,0);
 await store.transaction(tx=>events.recordServiceUsage(tx,{issuer,subject:'owner',usedBytes:500000000}));assert.equal((await store.transaction(tx=>events.accountCapacity(tx,{issuer,subject:'owner'}))).maxAccountBytes,500000000);
 const result=(await engine.dispatch(new RunFundingMaintenanceAction({subject:'owner'})).next('result')).detail;assert.equal(result.scheduled,false);assert.equal([...store.snapshot().keys()].some(key=>key.startsWith('hosted/')),false);
});


test('closed commercial flags select no vendor extension, paid plans or credential access',async()=>{
 const settings={environment:'sandbox'},env={WAYPO_CONFIG:JSON.stringify(provider),HOSTED_BILLING_CONFIG:JSON.stringify(settings)};
 Object.defineProperties(env,{POLAR_ACCESS_TOKEN:{get(){throw Error('Polar token touched');}},POLAR_WEBHOOK_SECRET:{get(){throw Error('Polar secret touched');}}});
 const composed=hostedWorkerEnvironment(env),policy=JSON.parse(composed.env.WAYPO_CONFIG).policy;assert.deepEqual(policy.plans,{});assert.deepEqual(policy.freeServices,{storageBytes:500000000,signaling:true});assert.equal(Object.hasOwn(composed.settings,'accessToken'),false);
 const extension=await createWaypoLinkExtensionFactory(composed.settings)({});assert.deepEqual(extension.userLinks,[]);assert.equal(extension.recordServiceUsage,undefined);
 for(const path of ['/account/billing','/api/hosted/billing/checkout','/api/hosted/polar/webhook'])assert.equal((await extension.handle(new Request('https://identity.example'+path))).status,404);
 for(const flags of [{enableActions:true},{enableTrial:true},{paidPlansEnabled:'true'},{subscriptionServicingEnabled:1}])assert.throws(()=>createWaypoLinkExtensionFactory({...settings,...flags}));
 assert.equal(Object.keys(composeWaypoLinkProviderConfiguration(provider,{...settings,paidPlansEnabled:true}).policy.plans).length,1);
});


test('every public hosted mode requires finite account admission and creation rate regardless of paid flags',()=>{
 const publicProvider={...provider,admission:'public'},admission=settings.accountAdmission,rate=settings.accountCreationRate;
 for(const flags of [{},{paidPlansEnabled:true},{subscriptionServicingEnabled:true}]){
  const commercial={environment:'sandbox',...flags};
  assert.throws(()=>composeWaypoLinkProviderConfiguration(publicProvider,commercial));
  assert.throws(()=>composeWaypoLinkProviderConfiguration({...publicProvider,accountAdmission:admission},commercial));
  assert.throws(()=>composeWaypoLinkProviderConfiguration({...publicProvider,accountCreationRate:rate},commercial));
  const config=composeWaypoLinkProviderConfiguration({...publicProvider,accountAdmission:admission,accountCreationRate:rate},commercial);assert.deepEqual(config.accountAdmission,admission);assert.deepEqual(config.accountCreationRate,rate);
  const strict={...admission,maxPublicAccounts:3};const overridden=composeWaypoLinkProviderConfiguration({...publicProvider,accountAdmission:admission,accountCreationRate:rate},{...commercial,accountAdmission:strict});assert.equal(overridden.accountAdmission.maxPublicAccounts,3);
  for(const malformed of [{accountAdmission:{...admission,maxPublicAccounts:Infinity}},{accountCreationRate:null}])assert.throws(()=>composeWaypoLinkProviderConfiguration({...publicProvider,accountAdmission:admission,accountCreationRate:rate},{...commercial,...malformed}));
  assert.throws(()=>hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(publicProvider),HOSTED_BILLING_CONFIG:JSON.stringify(commercial)}));
  assert.equal(composeWaypoLinkProviderConfiguration({...provider,admission:'closed'},commercial).admission,'closed');
 }
 const env=hostedWorkerEnvironment({WAYPO_CONFIG:JSON.stringify(publicProvider),HOSTED_BILLING_CONFIG:JSON.stringify({environment:'sandbox',accountAdmission:admission,accountCreationRate:rate})});assert.deepEqual(JSON.parse(env.env.WAYPO_CONFIG).accountAdmission,admission);
});
