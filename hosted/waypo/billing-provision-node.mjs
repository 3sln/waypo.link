// Offline operator tool. Never mount this as an HTTP action or pass request data.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {openNodeSqliteStore} from '@3sln/waypo/adapters/node/sqlite';
import {createEmptyBillingCapacityProvisioner} from './billing-controls.mjs';
export async function provisionEmptyNodeBillingCapacity({filename,issuer,environment,organizationId}){
 if(typeof issuer!=='string'||new URL(issuer).href!==issuer||!['sandbox','production'].includes(environment)||typeof organizationId!=='string'||!organizationId.length||organizationId.length>256)throw TypeError('Explicit operator billing identity required');
 // Reuse the maintained adapter's path/schema/permissions checks. The operator
 // must stop the service first; this is not an online generic store escape hatch.
 const maintained=openNodeSqliteStore({filename});let db;
 try{
  const path=maintained.filename,before=lstatSync(path);db=new DatabaseSync(path);const after=lstatSync(path);if(before.dev!==after.dev||before.ino!==after.ino)throw Error('database_file_changed');
  db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
  const store={async transaction(callback){db.exec('BEGIN IMMEDIATE');try{const tx={get:async key=>{const row=db.prepare('SELECT value FROM waypo_state WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;},put:async(key,value)=>db.prepare('INSERT INTO waypo_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value))};const result=await callback(tx);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const provision=createEmptyBillingCapacityProvisioner({store,issuer,environment,organizationId,firstBinding:async(tx,{prefix,limit})=>{if(prefix!=='hosted/polar/waypo_'||limit!==1)throw Error('invalid_billing_probe');return db.prepare('SELECT key FROM waypo_state WHERE key>=? AND key<? ORDER BY key LIMIT 1').get(prefix,'hosted/polar/waypo`')??null;}});
  return await provision();
 }finally{db?.close();await maintained.close();}
}
