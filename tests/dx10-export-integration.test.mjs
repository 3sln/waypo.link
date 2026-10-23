import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPORT_OPERATIONS,externalStorageMapping} from '../packages/runtime/account/exports.mjs';
import {CreateExportWithHooks,OfferOverQuotaExport,OverQuotaExportEvidence} from '../packages/runtime/export-hooks.mjs';
import {deviceGrantRows,exportGrantsPort} from '../packages/runtime/export-ports.mjs';
import {createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {encryptSecret} from '../packages/runtime/secrets.mjs';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
const DEVICE='urn:ietf:params:oauth:grant-type:device_code';
test('adapter registry replaces create and registers both retention hooks without duplicate wire names',()=>{
 const values=Object.values(EXPORT_OPERATIONS);assert(values.includes(CreateExportWithHooks));assert(values.includes(OfferOverQuotaExport));assert(values.includes(OverQuotaExportEvidence));assert.equal(values.filter(op=>op.operation==='exports.create').length,1);
});
test('device grant contributor exports public inventory and excludes authority',async()=>{
 const raw={grants:['public-grant-id'],subject:'private',clientId:'cli.example',grantType:DEVICE,createdAt:1,expiresAt:20,lastUsedAt:3,status:'active',familyId:'secret-family',currentHash:'secret-hash',rotationKey:'secret-rotation',lineage:{lineageId:'secret-lineage'}};
 assert.deepEqual(deviceGrantRows([{...raw,grantType:'authorization_code'}]),[]);
 const grants=exportGrantsPort({devices:async()=>[raw]}),contributor=createExportContributors({grants}).find(c=>c.name==='grants'),page=await contributor.page({owner:OWNER,limit:10});
 assert.deepEqual(page.rows[0].grantIds,['public-grant-id']);assert.equal(page.rows[0].device,true);assert.equal(page.rows[0].clientId,'cli.example');assert(!JSON.stringify(page).includes('secret'));assert.equal((await grants.page({owner:OWNER,cursor:'done'})).rows.length,0);
});
test('external mapping pages preserve Drive mappings and export only S3/WebDAV namespace metadata',async t=>{
 const f=await createTestEngine();t.after(()=>f.dispose());const config={KEY_ENCRYPTION_KEY:btoa('x'.repeat(32))};
 for(const [id,provider,owner]of [['s3','s3',OWNER],['dav','webdav',OWNER],['other','s3',OTHER]])await f.metadata.put('resource/'+id,{id,owner,provider,secret:await encryptSecret({bucket:'bucket',prefix:'documents',endpoint:'https://user:password@storage.example/private?token=secret',accessKeyId:'secret-access',secretAccessKey:'secret-key',password:'secret-password'},config.KEY_ENCRYPTION_KEY)});
 await f.metadata.put('drive/object/r/file',{owner:OWNER,key:'logical',fileId:'provider-id',version:'v1'});
 const externalStorage=externalStorageMapping({metadata:f.metadata,config});assert.equal((await externalStorage.page({owner:OWNER,cursor:'drive/object/r/file',limit:1})).rows.length,0);const contributor=createExportContributors({externalStorage}).find(c=>c.name==='external-storage');let cursor=null,rows=[];
 for(let n=0;n<20;n++){const page=await contributor.page({owner:OWNER,cursor,limit:1});rows.push(...page.rows);if(page.done)break;cursor=page.cursor;}
 assert.equal(rows.length,3);assert(rows.some(r=>r.key==='logical'&&r.version==='v1'));assert(rows.some(r=>r.provider==='s3'&&r.bucket==='bucket'&&r.prefix==='documents'));assert(rows.some(r=>r.provider==='webdav'&&r.prefix==='documents'));assert(!JSON.stringify(rows).match(/secret|password|endpoint|other/));
});

test('Node adapter reads existing native federation storage and filters device families by owner',async t=>{
 const {mkdtemp,mkdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{SqliteMetadata}=await import('../apps/node/resources.mjs'),{createNodeServer}=await import('../apps/node/server.mjs'),{FEDERATION_LAYOUT}=await import('../packages/runtime/federation.mjs');
 const directory=await mkdtemp(join(tmpdir(),'dx10-grants-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'federation'),{recursive:true});const metadata=new SqliteMetadata(join(directory,'federation',`${FEDERATION_LAYOUT}-${OWNER}.sqlite`)),origin='http://localhost:8799';
 await metadata.put('federation/family/device',{subject:`${origin}/entities/${OWNER}`,clientId:'cli.example',grantType:DEVICE,status:'active',currentHash:'secret'});await metadata.put('federation/family/other',{subject:`${origin}/entities/${OTHER}`,clientId:'other.example',grantType:DEVICE});await metadata.put('federation/grant/g1',{id:'g1',clientId:'app.example',active:true});metadata.close();
 const app=await createNodeServer({directory,config:{APP_ORIGIN:origin}});t.after(()=>app.close());const grants=app.resources.accounts.get(OWNER).config.exportPorts.contributorPorts.grants,page=await grants.page({owner:OWNER});assert.equal(page.rows.length,2);assert.equal(page.rows.find(r=>r.device).clientId,'cli.example');assert(!JSON.stringify(page).match(/secret|other.example/));
});

test('grant projection respects contributor page limits across device inventories',async()=>{
 const grants=exportGrantsPort({devices:async()=>Array.from({length:7},(_,n)=>({clientId:'cli'+n+'.example',grantType:DEVICE}))});let cursor=null,rows=[];
 do{const page=await grants.page({owner:OWNER,cursor,limit:2});assert(page.rows.length<=2);rows.push(...page.rows);cursor=page.cursor;}while(cursor);assert.equal(rows.length,7);assert.equal(new Set(rows.map(r=>r.clientId)).size,7);
});
