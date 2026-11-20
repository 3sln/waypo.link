import test from 'node:test';
import assert from 'node:assert/strict';
import {billingLimits,createBillingVendorBudget,createBillingBindingCapacity,createEmptyBillingCapacityProvisioner} from '../billing-controls.mjs';
import {TransactionStore} from '../../../../waypo/tests/engine/helpers/transaction-store.mjs';
test('vendor budget prepays attempts, survives restart/limits changes and prevents clock rollback reset',async()=>{
 const store=new TransactionStore();let now=86400000+1000;
 const make=(limits={})=>createBillingVendorBudget({store,issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org',clock:()=>now,limits:{checkout:2,cancel:2,...limits}});
 await make()('checkout');await make()('checkout');await assert.rejects(make()('checkout'),error=>error.message==='billing_vendor_budget'&&error.retryAfter>0);
 now=1000;await assert.rejects(make()('checkout'),/budget/);await make()('cancel');
 await assert.rejects(make({checkout:1})('checkout'),/budget/);await make({checkout:3})('checkout');
 now=2*86400000+1000;await make()('checkout');
 await assert.rejects(createBillingVendorBudget({store,issuer:'https://identity.example/api/auth',environment:'production',organizationId:'org'})('checkout'),/unavailable/);
 for(const input of [{unknown:2},{cancel:0},{cancel:Infinity},{cancel:'1'}])assert.throws(()=>billingLimits(input));
});
test('parallel attempts share durable stock; failed external work has no refund and cancellation has own reserve',async()=>{
 const store=new TransactionStore(),prepay=createBillingVendorBudget({store,issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org',clock:()=>1000,limits:{checkout:1,cancel:2}});
 const results=await Promise.allSettled([prepay('checkout'),prepay('checkout')]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
 await assert.rejects(prepay('checkout'),/budget/);await prepay('cancel');await prepay('cancel');await assert.rejects(prepay('cancel'),error=>error.message==='billing_cancellation_budget');
 assert.equal(store.snapshot().size,2,'fixed row stock, no caller-controlled indexes');
});


test('binding stock is finite, transactional, retained across limits changes and anchored against missing counters',async()=>{
 const store=new TransactionStore(),options={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org',limits:{maxBindings:1}},reserve=createBillingBindingCapacity(options);
 await assert.rejects(store.transaction(reserve),/capacity_unavailable/);
 await createEmptyBillingCapacityProvisioner({...options,store,firstBinding:async()=>null})();
 await assert.rejects(store.transaction(async tx=>{await reserve(tx);throw Error('rollback');}),/rollback/);assert.equal(store.snapshot().size,2);
 await store.transaction(reserve);await assert.rejects(store.transaction(reserve),/capacity_budget/);
 const raised=createBillingBindingCapacity({...options,limits:{maxBindings:2}});await store.transaction(raised);await assert.rejects(store.transaction(raised),/capacity_budget/);
 await store.transaction(tx=>tx.delete('hosted/polar/bindings-stock-v1'));await assert.rejects(store.transaction(raised),/capacity_unavailable/);
});


test('old uncounted financial bindings prevent fresh provisioning and runtime flags cannot initialize stock',async()=>{
 const options={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'},store=new TransactionStore([['hosted/polar/waypo_old',{subject:'old-owner'}]]);
 const provision=createEmptyBillingCapacityProvisioner({...options,store,firstBinding:async(tx,input)=>{assert.deepEqual(input,{prefix:'hosted/polar/waypo_',limit:1});return {key:'hosted/polar/waypo_old'};}});
 await assert.rejects(provision(),/requires_migration/);await assert.rejects(store.transaction(createBillingBindingCapacity({...options,limits:{maxBindings:1000}})),/capacity_unavailable/);assert.equal(store.snapshot().size,1);
});
