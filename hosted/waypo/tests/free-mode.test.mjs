import {freeCreationRate} from './free-rate.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {composeWaypoLinkProviderConfiguration,hostedWorkerEnvironment,createWaypoLinkExtensionFactory,validateHostedFreeSettings} from '../composition.mjs';
import {createPolicyEngine,createPolicyEventsPort,AccountPolicyQuery,RunFundingMaintenanceAction} from '@3sln/waypo/engines/policies';
import {TransactionStore} from '../../../../waypo/tests/engine/helpers/transaction-store.mjs';
const issuer='https://identity.example/api/auth',settings={mode:'free',environment:'sandbox',accountCreationRate:freeCreationRate(),accountAdmission:{revision:1,maxPublicAccounts:16,maxProtectedAccounts:2,acceptingNewAccounts:true}},provider={issuer,installationId:'free-test',adminUrl:'https://identity.example/admin/',authSecret:'test-only-free-mode-secret-longer-than32'};
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
