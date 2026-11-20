import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {provisionNodeInstallation,openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {provisionEmptyNodeBillingCapacity} from '../billing-provision-node.mjs';
import {createBillingBindingCapacity} from '../billing-controls.mjs';
test('actual SQLite operator provision uses exact customer prefix, never resets stock or accepts old uncounted customers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'waypo-billing-provision-')),scope={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'};
 try{
  const filename=join(dir,'fresh.sqlite');await provisionNodeInstallation({filename,installationId:'billing-fixture'});
  assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:true,count:0});
  const store=openNodeSqliteStore({filename});try{await store.transaction(createBillingBindingCapacity(scope));}finally{await store.close();}
  assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:false,count:1});
  await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename,organizationId:'other'}),/unavailable/);
  const old=join(dir,'old.sqlite');await provisionNodeInstallation({filename:old,installationId:'old-fixture'});const oldStore=openNodeSqliteStore({filename:old});try{await oldStore.transaction(async tx=>{await tx.put('hosted/polar/a-budget-before-customer',{v:1});await tx.put('hosted/polar/waypo_existing',{subject:'old'});});}finally{await oldStore.close();}
  await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename:old}),/requires_migration/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
