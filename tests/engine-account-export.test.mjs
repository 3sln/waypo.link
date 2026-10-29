import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import * as E from '../packages/app/domains/account-export.mjs';
import {createExportDigest,EXPORT_PART_BYTES} from '../packages/runtime/export-generation.mjs';
import {exportInventory,createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {streamExport} from '../packages/runtime/export-tar.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {key} from '../packages/core/records.mjs';
const OP='00000000-0000-4000-8000-000000000001',OP2='00000000-0000-4000-8000-000000000002',OP3='00000000-0000-4000-8000-000000000003';
const read=stream=>new Response(stream).arrayBuffer().then(v=>new Uint8Array(v));
function bucket(){const rows=new Map(),calls=[];return {rows,calls,async put(key,value){calls.push(['put',key]);rows.set(key,new Uint8Array(typeof value==='string'?new TextEncoder().encode(value):value));},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){calls.push(['delete',key]);rows.delete(key);}},async get(key,{range}={}){calls.push(['get',key]);const value=rows.get(key);if(!value)return null;return {size:value.length,body:new Blob([range?value.slice(range.offset,range.offset+range.length):value]).stream(),arrayBuffer:async()=>value.slice().buffer,text:async()=>new TextDecoder().decode(value)};}};}
async function fixture(t,{enabled=true,security={epoch:0,changedAt:0},contributors,notice,faults,wrap,seed}={}){
 const clock=fakeClock(),archives=bucket(),blobs=bucket(),notices=[],env={ACCOUNT_EXPORT_ENABLED:enabled?'true':undefined};
 const ports={identitySecurity:async()=>security,digest:createExportDigest(),quota:async()=>1024**3,notice:notice??(async n=>{notices.push(n);}),contributorPorts:{identity:async()=>({id:OWNER,handle:'@owner.example1234',createdAt:1,status:'active',audit:[],passkeys:[],sessions:[]}),keys:async()=>({publicKeys:[],keyIds:[]}),grants:{page:async()=>({rows:[],done:true})},externalStorage:{page:async()=>({rows:[],done:true})}},...contributors?{contributors}:{}};
 const flags={for:ctx=>createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env,clock:clock.now}).for(ctx)};
 const f=await createTestEngine({seed,clock,faults,wrap,providers:{archives,blobs,flags},config:{APP_ORIGIN:'https://issuer.example',exportPorts:ports}});await f.metadata.put('owner',OWNER);t.after(()=>f.dispose());
 const actor=()=>({kind:'owner',owner:OWNER,sessionId:'session1',stepUpAt:clock.now(),stepUpMethod:'passkey'}),system={kind:'system',owner:OWNER};
 const op=(Operation,{actor:who=actor(),...params}={})=>['exports.list','exports.status','exports.layout'].includes(Operation.operation)?f.read(new Operation({actor:who,...params})):f.perform(new Operation({actor:who,...params}));
 const create=(operationId=OP,extra={})=>op(E.CreateExport,{input:{operationId,...extra}});
 const ready=async id=>{for(let n=0;n<300;n++){const state=await op(E.ExportStatus,{id});if(state.state==='ready')return state;await op(E.StepExport,{actor:system});}assert.fail('Export did not converge');};
 return {...f,archives,blobs,notices,env,ports,security,flags,op,create,ready,actor,system};
}

test('exports are actual ngin operations with suspended/terms-exempt policy and no owner activity',async t=>{
 const f=await fixture(t),job=await f.create(),ready=await f.ready(job.id);
 assert.equal(ready.state,'ready');assert.ok(ready.rootDigest);assert.equal(ready.volumes[0].n,1);assert.ok(f.audit.entries.some(e=>e.operation==='exports.step'));
 assert.equal(await f.metadata.get('lastOwnerActiveAt'),undefined);assert.equal(E.StepExport.gate,'none');assert.equal(E.CancelExport.warm,false);assert.equal(E.ExpireExports.warm,false);
 for(const Operation of E.ACCOUNT_EXPORT_OPERATIONS){assert.equal(Operation.termsGate,'exempt');assert.ok(['suspended','purging'].includes(Operation.lifecycle));}
 assert.deepEqual((await f.op(E.ExportList)).jobs.map(j=>j.id),[job.id]);assert.equal(await f.metadata.get('export/active'),job.id);
 const status=JSON.stringify(await f.op(E.ExportStatus,{id:job.id}));assert.ok(!status.includes('exports/'+OWNER));assert.ok(!status.includes('securityEpoch'));
});

test('flags gate creation only; targeting ramp-down keeps status, downloads, cancel and generation serviceable',async t=>{
 const f=await fixture(t,{enabled:false});await assert.rejects(f.create(),{code:'not_found'});f.env.ACCOUNT_EXPORT_ENABLED='true';const job=await f.create();delete f.env.ACCOUNT_EXPORT_ENABLED;
 await f.ready(job.id);const result=await f.op(E.ExportLayout,{id:job.id,input:{volume:1}});assert.equal(result.contentLength,result.volume.bytes);
 f.env.ACCOUNT_EXPORT_ENABLED='false';await assert.rejects(f.op(E.ExportLayout,{id:job.id,input:{volume:1}}),{code:'export_unavailable'});assert.equal((await f.op(E.StepExport,{actor:f.system})).killed,true);
 assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'ready');await f.op(E.CancelExport,{id:job.id});assert.equal(f.archives.rows.size,0);assert.equal(await f.metadata.get('export/active'),undefined);
});

test('fresh step-up, owner binding, system authority and purpose validation fail closed',async t=>{
 const f=await fixture(t);for(const actor of [{...f.actor(),stepUpAt:f.clock.now()-300001},{...f.actor(),stepUpAt:f.clock.now()+1},{...f.actor(),stepUpMethod:'email'},{kind:'owner',owner:OWNER}])await assert.rejects(f.op(E.CreateExport,{actor,input:{operationId:OP}}),{code:'step_up_required'});
 await assert.rejects(f.op(E.CreateExport,{actor:{kind:'owner',owner:OTHER,stepUpAt:f.clock.now(),stepUpMethod:'passkey'},input:{operationId:OP}}),{code:'forbidden'});
 await assert.rejects(f.op(E.StepExport),{code:'unauthorized'});await assert.rejects(f.create(OP,{purpose:'closure'}),{code:'invalid_export'});await assert.rejects(f.create(OP,{stepUpAt:f.clock.now()}),{code:'invalid_export'});
 await f.metadata.put('deletion/fence-v1',{owner:OWNER});await assert.rejects(f.create(),{code:'account_deleting'});await assert.rejects(f.op(E.StepExport,{actor:f.system}),{code:'account_deleting'});
});

test('idempotent creation, one active job and the two-per-week cap include cancelled jobs',async t=>{
 const f=await fixture(t),first=await f.create();assert.equal((await f.create()).id,first.id);assert.equal(f.notices.length,1);await assert.rejects(f.create(OP2),{code:'export_active'});
 await f.op(E.CancelExport,{id:first.id});const second=await f.create(OP2);await f.op(E.CancelExport,{id:second.id});await assert.rejects(f.create(OP3),{code:'export_rate_limited'});
 f.clock.advance(7*86400000+1);assert.ok((await f.create(OP3)).id);
});

test('security state survives audit floods, delays downloads, and invalidates epochs after recovery',async t=>{
 const f=await fixture(t,{security:{epoch:5,changedAt:fakeClock().now()-1000}});f.ports.contributorPorts.identity=async()=>({id:OWNER,audit:Array.from({length:150},()=>({type:'session-created'}))});
 const job=await f.create();assert.equal(job.notBefore,f.security.changedAt+3*86400000);await f.ready(job.id);await assert.rejects(f.op(E.ExportLayout,{id:job.id,input:{volume:1}}),{code:'export_not_before'});
 f.clock.set(job.notBefore);await f.op(E.ExportLayout,{id:job.id,input:{volume:1}});f.security.epoch++;f.security.changedAt=f.clock.now();await assert.rejects(f.op(E.ExportLayout,{id:job.id,input:{volume:1}}),{code:'unauthorized'});
});

test('range authorization charges the requested bytes and notices each distinct session or job grant',async t=>{
 const f=await fixture(t),job=await f.create();await f.ready(job.id);
 const first=await f.op(E.ExportLayout,{id:job.id,input:{volume:1,range:'bytes=4-20'}});assert.equal(first.status,206);assert.equal(first.contentLength,17);assert.equal((await f.op(E.ExportStatus,{id:job.id})).downloadedBytes,17);
 await f.op(E.ExportLayout,{id:job.id,input:{volume:1,range:'bytes=0-0'}});await f.op(E.ExportLayout,{actor:{...f.actor(),sessionId:'session2'},id:job.id,input:{volume:1,range:'bytes=0-0'}});
 // Wargame 4: a caller-built export-grant actor is not authority on the generic layout operation (the token-verifying
 // DownloadExport adapter is the only grant path; tests/export-grant-lifecycle.test.mjs covers its notices).
 await assert.rejects(f.op(E.ExportLayout,{actor:{kind:'export-grant',owner:OWNER,jobId:job.id,grantId:'grant1'},id:job.id,input:{volume:1,range:'bytes=0-0'}}),{code:'unauthorized'});
 assert.equal(f.notices.filter(n=>n.type==='export-downloaded').length,2);await assert.rejects(f.op(E.ExportLayout,{actor:{kind:'export-grant',owner:OWNER,jobId:OP3,grantId:'grant1'},id:job.id,input:{volume:1}}),{code:'unauthorized'});
 const full=await f.op(E.ExportLayout,{id:job.id,input:{volume:1,range:'bytes=0-0',ifRange:'"wrong"'}});assert.equal(full.status,200);
 await f.op(E.ExportLayout,{id:job.id,input:{volume:1}});await assert.rejects(f.op(E.ExportLayout,{id:job.id,input:{volume:1}}),{code:'export_download_cap'});
});

test('native digest provider authenticates packed and referenced payload bytes; expiry deletes exact keys and pins',async t=>{
 const f=await fixture(t);const small=new Uint8Array([1,2,3]),big=new Uint8Array(256*1024+1).fill(7),smallRef=`messages/${OWNER}/m1`,bigRef=`objects/${OWNER}/r1/v1`;
 await f.blobs.put(smallRef,small);await f.blobs.put(bigRef,big);await f.metadata.put(key('app-message',OWNER,'m1'),{id:'m1',owner:OWNER,blobRef:smallRef,size:small.length,mimeType:'application/octet-stream'});await f.metadata.put('hosted/r1/logical',{key:'../../logical',version:'v1',blobRef:bigRef,size:big.length});
 const job=await f.create();await f.ready(job.id);const record=await f.metadata.get('export/job/'+job.id);assert.equal(record.payloads.count,2);assert.ok(record.parts.some(p=>p.packed));assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,2);
 const index=record.parts.filter(p=>p.path.startsWith('payloads/'));const rows=(await Promise.all(index.map(async p=>new TextDecoder().decode(f.archives.rows.get(p.key))))).join('').trim().split('\n').map(JSON.parse);
 assert.equal(rows[0].sha256,await f.ports.digest.sha256(small));assert.equal(rows[1].sha256,await f.ports.digest.sha256(big));assert.ok(!JSON.stringify(rows).includes(bigRef));assert.equal(rows[1].source.key,'../../logical');
 for(const volume of record.volumes){assert.ok(volume.reads<=900);assert.equal((await read(streamExport(volume,f))).length,volume.bytes);}
 await f.archives.put('unrelated',new Uint8Array([9]));f.clock.set(record.expiresAt);await f.op(E.ExpireExports,{actor:f.system});assert.deepEqual([...f.archives.rows.keys()],['unrelated']);assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,0);assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'expired');assert.equal(await f.metadata.get('export/active'),undefined);
});

test('projections exclude authentication, connector and contact capabilities from every generated object',async t=>{
 const f=await fixture(t),secret='SECRET-MUST-NOT-LEAVE';
 f.ports.contributorPorts.identity=async()=>({id:OWNER,passwordHash:secret,recoveryHash:secret,sessions:[{label:'Laptop',hash:secret,csrfHash:secret}],passkeys:[{id:'pk1',label:'Key',privateKey:secret}],audit:[{type:'session-created',token:secret}],verifiedEmail:'owner@example.example'});
 f.ports.contributorPorts.keys=async()=>({publicKeys:[{kty:'EC',x:'public',d:secret}],privateKey:secret});
 f.ports.contributorPorts.grants.page=async()=>({rows:[{id:'grant',clientId:'https://app.example',jti:secret,token:secret}],done:true});
 for(const [path,value]of [[key('push-subscription',OWNER,'device'),{id:'device',owner:OWNER,label:'Phone',endpoint:secret,keys:{auth:secret,p256dh:secret}}],['resource/r1',{id:'r1',owner:OWNER,provider:'s3',secret,oauthToken:secret,s3Key:secret}],['contact-grant/g1/',{id:'g1',owner:OWNER,claims:{recipient:'peer',jti:secret,sharedSecret:secret},secret}],['vault/oauth',{secret}]])await f.metadata.put(path,value);
 const job=await f.create();await f.ready(job.id);for(const [key,value]of f.archives.rows)assert.ok(!new TextDecoder().decode(value).includes(secret),key);
});

test('inventory covers every literal account key family and seeded persisted account prefixes',async t=>{
 const roots=['packages/runtime/account','packages/activity','packages/events','packages/apps'],prefixes=new Set(),files=[];
 for(const root of roots)for(const file of await readdir(new URL('../'+root+'/',import.meta.url)))if(file.endsWith('.mjs'))files.push(root+'/'+file);
 files.push(...['accounts','account-lifecycle','lifecycle-runner','storage-quota','storage-write-budget','message-receipt-budget','message-postbacks','message-presentations','app-notifications','integration-events'].map(f=>'packages/runtime/'+f+'.mjs'),'packages/storage/google-drive.mjs','packages/identity/keys.mjs',
  // Account-store writers outside the roots above (core-scope audit, 2026-10-26).
  'packages/mcp/account.mjs','packages/automation/account.mjs','packages/activity/app-messages.mjs');
 for(const file of files){let source=await readFile(new URL('../'+file,import.meta.url),'utf8');if(file==='packages/runtime/accounts.mjs')source=source.slice(source.indexOf('export class AccountController'));for(const match of source.matchAll(/\bkey\('([a-z][a-z0-9-]*)'/g))prefixes.add(match[1]+'/');for(const match of source.matchAll(/(?:\.put|\btx\.set)\(['"`]([a-z][A-Za-z0-9_/-]*)/g))prefixes.add(match[1]);
  // Key families assigned to a constant or built in a template literal before the write (the audit's gaps).
  for(const match of source.matchAll(/=\s*['"`]((?:mcp|automation|classifier|app-notification-[a-z]+|message-postback-[a-z]+)\/[A-Za-z0-9_/-]*)/g))prefixes.add(match[1].replace(/\/[^/]*$/,'/').replace(/^classifier\/usage\/$/,'classifier/usage/v1'));}
 // Computed key-family maps (as opposed to literal writes) are part of the
 // inventory as well: key rotations, bus rows and external version mappings.
 for(const prefix of ['identity-encryption-key/','encryption-key','identity-key-retained/','identity-key-pruned/','evbus/rec/','evbus/reader/','evbus/permit/','evbus/tx/','evbus/rate/','evbus/meter/','evbus/wait/','drive/object/','drive/retained/',
  // The profile (packages/runtime/account/profile.mjs), the BB-CUT and contacts phase 4 reset markers, and the retired
  // contact-link families that may persist until the contact-links-retired-v1 reset runs (packages/runtime/contact-links-reset.mjs).
  'profile','migration/messaging-retired-v1','migration/contact-links-retired-v1','link/','link-state/','link-change/','link-evaluations/','links-rpc/','contact-sharing/','link-audience/','link-replay/','link-gc-cursor/',
  // Activity's app-message families and the audit's export gaps.
  'app-message/','app-message-usage/','mcp/operation/','mcp/operation-expiry/','automation/session/','automation/confirmation/','classifier/usage/v1','app-notification-budget/','app-notification-receipt/','message-postback-prepared/','developer-contact/occupant-v1'])prefixes.add(prefix);
 // The inventory also covers the reset module's families (it deletes them; nothing writes them any more).
 for(const prefix of (await import('../packages/runtime/contact-links-reset.mjs')).CONTACT_LINKS_RESET_PREFIXES)prefixes.add(prefix);
 const missing=exportInventory([...prefixes]).filter(v=>!v.contributor&&!v.reason);assert.deepEqual(missing,[]);
 const f=await fixture(t);await f.metadata.put('app-message/'+OWNER+'/id/',{owner:OWNER,id:'id'});await f.metadata.put('vault/oauth',{token:'secret'});const keys=[...(await f.metadata.list()).keys()].filter(k=>k!=='item-index-ready');assert.deepEqual(exportInventory(keys).filter(v=>!v.contributor&&!v.reason),[]);
 assert.deepEqual(exportInventory(['new-unreviewed-domain/'])[0],{prefix:'new-unreviewed-domain/'});
});

test('payload pin budget and missing contributor ports fail closed',async t=>{
 const f=await fixture(t),ref=`messages/${OWNER}/m1`;await f.blobs.put(ref,new Uint8Array(4));await f.metadata.put(key('app-message',OWNER,'m1'),{id:'m1',owner:OWNER,blobRef:ref,size:4});f.ports.quota=async()=>3;
 const job=await f.create();await assert.rejects(f.ready(job.id),{code:'export_pin_budget'});assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'failed');assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,0);assert.equal(f.archives.rows.size,0);
 const digest=createExportDigest();assert.equal(await digest.sha256(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.equal(EXPORT_PART_BYTES,16*1024**2);
 const contributors=createExportContributors({accountStore:f.metadata,flags:f.flags});await assert.rejects(contributors[0].page({owner:OWNER,limit:32}),{code:'export_contributor_unavailable'});
});

test('object sizes come from the digest read, and missing or foreign payloads fail without retained objects',async t=>{
 const f=await fixture(t),ref=`messages/${OWNER}/m1`;await f.blobs.put(ref,new Uint8Array(4));await f.metadata.put(key('app-message',OWNER,'m1'),{id:'m1',owner:OWNER,blobRef:ref,size:1});const job=await f.create();await f.ready(job.id);const record=await f.metadata.get('export/job/'+job.id);assert.equal(record.payloads.bytes,4);const pin=[...(await f.metadata.list({prefix:'export/pin/'})).values()][0];assert.equal(pin.size,4);
 for(const foreign of [false,true]){const g=await fixture(t);await g.metadata.put(key('app-message',OWNER,'bad'),{id:'bad',owner:OWNER,blobRef:`messages/${foreign?OTHER:OWNER}/bad`,size:1});const j=await g.create();await assert.rejects(g.ready(j.id),{code:foreign?'export_payload_invalid':'export_payload_missing'});assert.equal(g.archives.rows.size,0);assert.equal((await g.metadata.list({prefix:'export/pin/'})).size,0);}
});

test('message history spans multiple digest passes without repeating metadata or dropping payloads',async t=>{
 const f=await fixture(t),ref=`messages/${OWNER}/m1`,history=[];await f.blobs.put(ref,new Uint8Array([0]));for(let n=1;n<=32;n++){const blobRef=ref+'/presentations/p'+n;await f.blobs.put(blobRef,new Uint8Array([n]));history.push({revision:n,blobRef,size:1,mimeType:'text/plain'});}
 await f.metadata.put(key('app-message',OWNER,'m1'),{id:'m1',owner:OWNER,blobRef:ref,size:1,presentation:{revision:32,history}});const job=await f.create();await f.ready(job.id);const record=await f.metadata.get('export/job/'+job.id);assert.equal(record.payloads.count,33);assert.equal(record.counts.messages.rows,1);assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,33);
 const rows=(await Promise.all(record.parts.filter(p=>p.path.startsWith('payloads/')).map(p=>f.archives.get(p.key).then(o=>o.text())))).join('').trim().split('\n').map(JSON.parse);assert.equal(new Set(rows.map(row=>row.path)).size,33);assert.ok(rows.every(row=>row.volume===2));
});

test('the twenty-second work budget resumes the same page without duplicating metadata',async t=>{
 const descriptors=Array.from({length:3},(_,i)=>({entryId:'m'+i,kind:'message',source:{message:'m'+i,part:0},path:`data/messages/m${i}/0.bin`,ref:`messages/${OWNER}/m${i}`,size:256*1024+1}));
 const f=await fixture(t,{contributors:[{name:'messages',version:1,page:async()=>({rows:[{id:'only-once'}],payloads:descriptors,done:true})}]});for(const d of descriptors)await f.blobs.put(d.ref,new Uint8Array(d.size));const digest=f.ports.digest;let digests=0;f.ports.digest={async sha256(input){const hash=await digest.sha256(input);if(input instanceof ReadableStream){digests++;f.clock.advance(20001);}return hash;}};
 const job=await f.create();await f.op(E.StepExport,{actor:f.system});assert.equal(digests,1);assert.equal((await f.metadata.get('export/job/'+job.id)).pendingPage.payloads.length,2);await f.ready(job.id);const record=await f.metadata.get('export/job/'+job.id);assert.equal(digests,3);assert.equal(record.payloads.count,3);assert.equal(record.counts.messages.rows,1);
});

test('duplicate paths in separate pages fail, while abandoned old cleanup cannot release a new job pin',async t=>{
 const descriptor={entryId:'m1',kind:'message',source:{message:'m1',part:0},path:'data/messages/m1/0.bin',ref:`messages/${OWNER}/m1`,size:1},f=await fixture(t,{contributors:[{name:'messages',version:1,page:async({cursor})=>({rows:[{id:'m1'}],payloads:[descriptor],cursor:1,done:cursor===1})}]});await f.blobs.put(descriptor.ref,new Uint8Array([1]));const first=await f.create();await assert.rejects(f.ready(first.id),{code:'export_path_collision'});assert.equal(f.archives.rows.size,0);
 f.ports.contributors=[{name:'messages',version:1,page:async()=>({rows:[{id:'m1'}],payloads:[descriptor],done:true})}];const second=await f.create(OP2);await f.ready(second.id);await f.op(E.CancelExport,{id:first.id});assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,1);assert.equal((await f.op(E.ExportStatus,{id:second.id})).state,'ready');assert.equal((await f.op(E.ExportStatus,{id:first.id})).cleanupPending,false);
});

test('the shared E6 system operation erases every recorded key in bounded batches without identity or notice ports',async t=>{
 const f=await fixture(t),ref=`messages/${OWNER}/m1`;await f.blobs.put(ref,new Uint8Array([1]));await f.metadata.put(key('app-message',OWNER,'m1'),{id:'m1',owner:OWNER,blobRef:ref,size:1});const job=await f.create();await f.ready(job.id);assert.ok(f.archives.rows.size>2);await f.metadata.put('deletion/fence-v1',{owner:OWNER});f.ports.identitySecurity=null;f.ports.notice=undefined;
 let result;for(let n=0;n<100;n++){result=await f.op(E.CancelExport,{actor:f.system,input:{budget:2}});if(result.done)break;}assert.equal(result.done,true);assert.equal(f.archives.rows.size,0);assert.equal(await f.metadata.get('export/active'),undefined);assert.equal((await f.metadata.list({prefix:'export/pin/'})).size,0);assert.equal((await f.metadata.list({prefix:'export/pins/'})).size,0);assert.equal((await f.metadata.list({prefix:'export/path/'})).size,0);assert.equal((await f.op(E.ExportStatus,{id:job.id})).state,'cancelled');
});

test('producer summary export derives bounded aggregate counts without object keys',async t=>{
 const f=await fixture(t);await f.metadata.put('hosted/store/private-name',{key:'private-name',size:4,producer:{connection:'app',generation:1,prefix:'notes/'}});await f.metadata.put('hosted/store/another-name',{key:'another-name',size:6,producer:{connection:'app',generation:1,prefix:'notes/'}});await f.metadata.put('drive/object/drive/hash',{key:'external-name',size:8,producer:{connection:'app',generation:3,prefix:'archive/'}});
 const contributor=createExportContributors({accountStore:f.metadata,flags:f.flags}).find(v=>v.name==='producer-summaries');let cursor=null,out=[];do{const page=await contributor.page({owner:OWNER,cursor,limit:20});out.push(...page.rows);cursor=page.cursor;}while(cursor);
 assert.deepEqual(out.map(v=>v.record),[{resource:'store',connection:'app',generation:1,prefix:'notes/',items:2,bytes:10},{resource:'drive',connection:'app',generation:3,prefix:'archive/',items:1,bytes:8}]);assert.doesNotMatch(JSON.stringify(out),/private-name|another-name|external-name/);
 assert.equal(exportInventory(['app-removal/record/'])[0].contributor,'app-removals');
});
