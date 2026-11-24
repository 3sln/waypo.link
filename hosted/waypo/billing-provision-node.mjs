// Offline operator tool. Never mount this as an HTTP action or pass request data.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {acquireNodeInstallationOperation,nodeInstallationControlDirectory} from '@3sln/waypo/adapters/node/installation-operation';
import {createEmptyBillingCapacityProvisioner} from './billing-controls.mjs';
const unconfirmed=new Set();
export async function provisionEmptyNodeBillingCapacity({filename,issuer,environment,organizationId}){
 if(typeof issuer!=='string'||new URL(issuer).href!==issuer||!['sandbox','production'].includes(environment)||typeof organizationId!=='string'||!organizationId.length||organizationId.length>256)throw TypeError('Explicit operator billing identity required');
 if(typeof filename!=='string'||!filename)throw TypeError('Existing canonical installation file required');const lexical=resolve(filename),before=lstatSync(lexical);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('billing_database_invalid');const canonical=realpathSync(lexical),operation=await acquireNodeInstallationOperation(await nodeInstallationControlDirectory(canonical));let maintained,db,view,primary;
 try{
  await operation.assertServingAllowed();const current=lstatSync(canonical);if(current.dev!==before.dev||current.ino!==before.ino)throw Error('database_file_changed');
  // Deny locked/prebootstrap installations using a read-only view BEFORE any
  // mutable adapter/database open. This marker is not a bootstrap bypass.
  view=new DatabaseSync(canonical,{readOnly:true});view.exec('PRAGMA trusted_schema=OFF;');const saved=view.prepare('SELECT substr(value,1,16385) AS value,length(CAST(value AS BLOB)) AS bytes FROM waypo_state WHERE key=?').get('bootstrap/installation');let marker;try{if(!saved||saved.bytes>16384)throw Error();marker=JSON.parse(saved.value);}catch{throw Error('billing_installation_unavailable');}
  if(marker.version!==1||marker.status!=='initialized'||typeof marker.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(marker.id)||!Number.isSafeInteger(marker.consumedGeneration)||marker.consumedGeneration<0)throw Error('billing_installation_unavailable');
  try{view.close();view=undefined;}catch(error){throw Object.assign(new AggregateError([error],'Read-only billing inspection closure unconfirmed'),{code:'billing_capacity_cleanup_unconfirmed'});}
  maintained=openNodeSqliteStore({filename:canonical});const path=maintained.filename;db=new DatabaseSync(path);const after=lstatSync(path);if(before.dev!==after.dev||before.ino!==after.ino)throw Error('database_file_changed');
  db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
  const store={async transaction(callback){operation.assertHeld();db.exec('BEGIN IMMEDIATE');try{const tx={get:async key=>{const row=db.prepare('SELECT value FROM waypo_state WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;},put:async(key,value)=>db.prepare('INSERT INTO waypo_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value))};const result=await callback(tx);operation.assertHeld();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const provision=createEmptyBillingCapacityProvisioner({store,issuer,environment,organizationId,firstBinding:async(tx,{prefix,limit})=>{if(prefix!=='hosted/polar/waypo_'||limit!==1)throw Error('invalid_billing_probe');return db.prepare('SELECT key FROM waypo_state WHERE key>=? AND key<? ORDER BY key LIMIT 1').get(prefix,'hosted/polar/waypo`')??null;}});
  return await provision();
 }catch(error){primary=error;throw error;}finally{
  const failures=[];for(const resource of[db,maintained,view])if(resource)try{await resource.close();}catch(error){failures.push(error);}
  if(failures.length||primary?.code==='billing_capacity_cleanup_unconfirmed'){unconfirmed.add(operation);throw Object.assign(new AggregateError([primary,...failures].filter(Boolean),'Billing operator closure unconfirmed; stop this process before reopening'),{code:'billing_capacity_cleanup_unconfirmed'});}
  try{operation.close();}catch(error){unconfirmed.add(operation);throw Object.assign(new AggregateError([primary,error].filter(Boolean),'Billing operation lease closure unconfirmed'),{code:'billing_capacity_cleanup_unconfirmed'});}
 }
}
