import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import{DatabaseSync}from'node:sqlite';
import {provisionNodeInstallation,openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {acquireNodeInstallationOperation,nodeInstallationControlDirectory} from '@3sln/waypo/adapters/node/installation-operation';
import {createNodeApplication} from '@3sln/waypo/node';
import {provisionEmptyNodeBillingCapacity} from '../billing-provision-node.mjs';
import {createBillingBindingCapacity} from '../billing-controls.mjs';
import {execFileSync}from'node:child_process';
async function initialized(filename){const store=openNodeSqliteStore({filename});try{await store.transaction(async tx=>{const row=await tx.get('bootstrap/installation');await tx.put('bootstrap/installation',{...row,status:'initialized'});});}finally{await store.close();}}
function financialRows(filename){const db=new DatabaseSync(filename,{readOnly:true});try{return db.prepare("SELECT key,value FROM waypo_state WHERE key LIKE 'hosted/polar/%' ORDER BY key").all();}finally{db.close();}}
test('actual SQLite operator provision uses exact customer prefix, never resets stock or accepts old uncounted customers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'waypo-billing-provision-')),scope={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'};
 try{
  const filename=join(dir,'fresh.sqlite');await provisionNodeInstallation({filename,installationId:'billing-fixture'});
  const lockedBytes=await readFile(filename);await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename}),/billing_installation_unavailable/);assert.deepEqual(await readFile(filename),lockedBytes);assert.deepEqual(financialRows(filename),[]);await initialized(filename);
  assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:true,count:0});
  const store=openNodeSqliteStore({filename});try{await store.transaction(createBillingBindingCapacity(scope));}finally{await store.close();}
  assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:false,count:1});
  await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename,organizationId:'other'}),/unavailable/);
  const old=join(dir,'old.sqlite');await provisionNodeInstallation({filename:old,installationId:'old-fixture'});await initialized(old);const oldStore=openNodeSqliteStore({filename:old});try{await oldStore.transaction(async tx=>{await tx.put('hosted/polar/a-budget-before-customer',{v:1});await tx.put('hosted/polar/waypo_existing',{subject:'old'});});}finally{await oldStore.close();}
  await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename:old}),/requires_migration/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('billing operator shares canonical serving gate and quarantine without changing financial counters',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'waypo-billing-gate-')),filename=join(directory,'metadata.sqlite'),scope={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'};await provisionNodeInstallation({filename,installationId:'billing-gate'});await initialized(filename);
 try{const operation=await acquireNodeInstallationOperation(await nodeInstallationControlDirectory(filename));try{await symlink(directory,join(directory,'alias'));for(const selected of[filename,join(directory,'alias','metadata.sqlite')])await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename:selected}),{code:'native_backend_lease_busy'});assert.deepEqual(financialRows(filename),[]);}finally{operation.close();}
  await provisionEmptyNodeBillingCapacity({...scope,filename});const store=openNodeSqliteStore({filename});try{await store.transaction(createBillingBindingCapacity(scope));}finally{await store.close();}const before=financialRows(filename),quarantine=await acquireNodeInstallationOperation(await nodeInstallationControlDirectory(filename));try{await quarantine.quarantine({operationId:'1'.repeat(64),snapshotDigest:'2'.repeat(64)});}finally{quarantine.close();}
  await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename}),{code:'installation_restore_quarantined'});assert.deepEqual(financialRows(filename),before);assert.equal(JSON.parse(before.find(row=>row.key==='hosted/polar/bindings-stock-v1').value).count,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('actual live Node provider prevents billing provisioning until confirmed shutdown',{timeout:15000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'waypo-billing-serving-')),filename=join(directory,'metadata.sqlite'),scope={issuer:'http://localhost:20931/api/auth',environment:'sandbox',organizationId:'org'};let app;
 try{await provisionNodeInstallation({filename,installationId:'billing-serving'});await initialized(filename);app=await createNodeApplication({issuer:scope.issuer,adminUrl:'http://localhost:20932/',installationId:'billing-serving',database:filename,authSecret:'private-billing-serving-fixture-secret-over32',admission:'closed',allowInsecureLoopback:true,services:{logs:false,blobs:false}});const before=financialRows(filename);await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename}),{code:'native_backend_lease_busy'});assert.deepEqual(financialRows(filename),before);await app.close();app=null;assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:true,count:0});
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});

test('an unknown read-only inspection close retains the operation lease through GC until process exit',{timeout:15000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'waypo-billing-unknown-close-')),filename=join(directory,'metadata.sqlite'),scope={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'};
 try{await provisionNodeInstallation({filename,installationId:'billing-unknown-close'});await initialized(filename);
  const script=`import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{provisionEmptyNodeBillingCapacity}from'./billing-provision-node.mjs';import{acquireNodeInstallationOperation,nodeInstallationControlDirectory}from'@3sln/waypo/adapters/node/installation-operation';const input=JSON.parse(process.argv[1]),close=DatabaseSync.prototype.close;let once=true;DatabaseSync.prototype.close=function(){if(once){once=false;throw Error('injected inspection close uncertainty');}return close.call(this);};try{await assert.rejects(provisionEmptyNodeBillingCapacity(input),{code:'billing_capacity_cleanup_unconfirmed'});}finally{DatabaseSync.prototype.close=close;}globalThis.gc();await assert.rejects(acquireNodeInstallationOperation(await nodeInstallationControlDirectory(input.filename)),{code:'native_backend_lease_busy'});console.log('unknown-close lease retained');`;
  const output=execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',script,JSON.stringify({...scope,filename})],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000,maxBuffer:65536});assert.match(output,/unknown-close lease retained/);assert.deepEqual(financialRows(filename),[]);assert.deepEqual(await provisionEmptyNodeBillingCapacity({...scope,filename}),{provisioned:true,count:0});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('billing provisioning refuses genuine hot rollback and committed WAL before SQLite can recover either',{timeout:15000},async()=>{
 const {copyFile}=await import('node:fs/promises');
 for(const mode of['rollback','wal']){
  const directory=await mkdtemp(join(tmpdir(),'waypo-billing-recovery-')),filename=join(directory,'metadata.sqlite'),scope={issuer:'https://identity.example/api/auth',environment:'sandbox',organizationId:'org'};
  try{
   await provisionNodeInstallation({filename,installationId:'billing-recovery'});await initialized(filename);
   const script=mode==='rollback'?"import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;PRAGMA cache_size=5;BEGIN IMMEDIATE;');db.prepare('UPDATE waypo_state SET value=? WHERE key=?').run(JSON.stringify({changed:'x'.repeat(8192)}),'bootstrap/installation');const q=db.prepare('INSERT INTO waypo_state(key,value) VALUES(?,?)');for(let n=0;n<256;n++)q.run('fixture/hot-'+n,JSON.stringify('x'.repeat(8192)));process.exit(0);":"import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA wal_autocheckpoint=0;BEGIN IMMEDIATE;');db.prepare('INSERT INTO waypo_state(key,value) VALUES(?,?)').run('fixture/wal-pending','{}');db.exec('COMMIT');process.exit(0);";
   execFileSync(process.execPath,['--input-type=module','-e',script,filename],{stdio:'ignore',timeout:10000});
   const side=filename+(mode==='rollback'?'-journal':'-wal'),beforeMain=await readFile(filename),beforeSide=await readFile(side);assert.ok(beforeSide.length>512);
   if(mode==='rollback'){
    assert.equal(beforeSide.subarray(0,8).toString('hex'),'d9d505f920a163d7');
    const copy=join(directory,'recovery-demonstration.sqlite');await copyFile(filename,copy);await copyFile(side,copy+'-journal');const recovered=new DatabaseSync(copy);try{assert.equal(recovered.prepare("SELECT count(*) AS n FROM waypo_state WHERE key LIKE 'fixture/hot-%'").get().n,0);}finally{recovered.close();}assert.notDeepEqual(await readFile(copy),beforeMain,'the owned copied hot pair really requires SQLite recovery');
   }
   await assert.rejects(provisionEmptyNodeBillingCapacity({...scope,filename}),{code:'billing_database_recovery_required'});
   assert.deepEqual(await readFile(filename),beforeMain);assert.deepEqual(await readFile(side),beforeSide);
  }finally{await rm(directory,{recursive:true,force:true});}
 }
});
