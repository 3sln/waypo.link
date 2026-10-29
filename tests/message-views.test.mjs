import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountItemIndex} from '../packages/runtime/item-index.mjs';
import {MessageViews,normalizeIncomingFilter,normalizeIncomingQuery} from '../packages/runtime/message-views.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const message=(id,extra={})=>({id,owner,receivedAt:1000,readAt:null,collection:'legacy-private',tags:[],classification:'unclassified',mimeType:'text/plain',size:4,bytes:new Uint8Array([1]),blobRef:'private-ref',...extra});
function fixture(t){const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());return {metadata,index:new AccountItemIndex(metadata.sql),views:new MessageViews(metadata)};}
test('Views normalize a bounded AND grammar and reject executable/ambiguous filters',()=>{
 assert.deepEqual(normalizeIncomingFilter({version:1,tagsAll:['b','a'],types:[],read:false}),{version:1,tagsAll:['a','b'],read:false});
 for(const f of [{version:2},{version:1,tagsAny:['a']},{version:1,tagsAll:['a','a']},{version:1,read:0},{version:1,types:['sql']},{version:1,classifications:['<script>']},{version:1,receivedAfter:20,receivedBefore:10},{version:1,receivedBefore:Infinity}])assert.throws(()=>normalizeIncomingFilter(f),{code:'invalid_view'});
 assert.throws(()=>normalizeIncomingQuery({view:'all',viewRevision:1,filter:{version:1}}),{code:'invalid_view'});
 assert.throws(()=>normalizeIncomingQuery({limit:101}),{code:'invalid_view'});
});
test('saved Views use CAS, bounded definitions and deletion never erases underlying messages',async t=>{
 const {index,views,metadata}=fixture(t);index.upsert(message('one'));
 assert.deepEqual((await views.list(owner)).map(v=>v.id),['all','unread']);
 const view=await views.mutate(owner,'create',null,{name:'<literal custom label>',filter:{version:1,tagsAll:['work']}});
 const changes=await Promise.allSettled([views.mutate(owner,'update',view.id,{name:'First',filter:{version:1},expectedRevision:1}),views.mutate(owner,'update',view.id,{name:'Second',filter:{version:1},expectedRevision:1})]);assert.equal(changes.filter(v=>v.status==='fulfilled').length,1);assert.equal(changes.find(v=>v.status==='rejected').reason.code,'view_conflict');
 await assert.rejects(views.resolve(owner,{view:view.id,viewRevision:1}),{code:'view_conflict'});
 await views.mutate(owner,'delete',view.id,{expectedRevision:2});assert(index.get('one'));assert.equal((await views.list(other)).length,2);
 await views.mutate(owner,'delete','all',{expectedRevision:1});assert.equal((await new MessageViews(metadata).list(owner)).some(v=>v.id==='all'),false);
});
test('indexed filters paginate beyond the old 100-item snapshot and keep scopes independent',async t=>{
 const {index,views}=fixture(t);
 for(let i=0;i<350;i++)index.upsert(message(String(i).padStart(4,'0'),{receivedAt:i,collection:i%2?'legacy-private':'legacy-other',tags:i%2?['a','b']:['a'],classification:i%2?'work':'personal'}));
 index.upsert(message('foreign',{owner:other,tags:['a','b'],classification:'work',receivedAt:1000}));
 let cursor,ids=[];do{const page=await index.incomingPage(owner,{filter:{version:1,tagsAll:['b','a'],classifications:['work'],read:false,receivedAfter:5,receivedBefore:340},limit:30,cursor});ids.push(...page.items.map(m=>m.id));cursor=page.cursor;}while(cursor);
 assert.equal(ids.length,168);assert.equal(new Set(ids).size,ids.length);assert(!ids.includes('foreign'));
 const original=index.page(owner,{collection:'legacy-private',limit:200}).items.map(v=>v.id);await views.mutate(owner,'update','all',{name:'Everything',expectedRevision:1,filter:{version:1}});assert.deepEqual(index.page(owner,{collection:'legacy-private',limit:200}).items.map(v=>v.id),original);
 const item=(await index.incomingPage(owner,{limit:1})).items[0];assert.equal(item.bytes,undefined);assert.equal(item.blobRef,undefined);
});
test('cursors are authenticated, owner/filter-bound and explicitly stale after index mutation',async t=>{
 const {index}=fixture(t);for(let i=0;i<3;i++)index.upsert(message('m'+i,{receivedAt:i}));
 const page=await index.incomingPage(owner,{limit:1});assert(page.cursor);
 for(const input of [{cursor:page.cursor+'a'},{cursor:page.cursor,filter:{version:1,read:false}},{cursor:page.cursor,view:'all',viewRevision:1}])await assert.rejects(index.incomingPage(owner,input),{code:'invalid_cursor'});
 await assert.rejects(index.incomingPage(other,{cursor:page.cursor}),{code:'invalid_cursor'});
 index.upsert(message('m1',{receivedAt:1,readAt:2000}));await assert.rejects(index.incomingPage(owner,{cursor:page.cursor}),{code:'cursor_stale'});
 const stable=await index.incomingPage(owner,{limit:1});index.upsert(message('m1',{receivedAt:1,readAt:2000}));assert((await index.incomingPage(owner,{cursor:stable.cursor})).items.length);
 const reopened=new AccountItemIndex(index.sql);assert((await reopened.incomingPage(owner,{cursor:stable.cursor})).items.length);
});
test('bounded legacy backfill resumes, deduplicates live updates and rolls back with original metadata',async t=>{
 const {index,metadata}=fixture(t);
 for(let i=0;i<205;i++){const m=message(String(i).padStart(3,'0'),{receivedAt:i});metadata.sql.exec('INSERT INTO inbox_catalog(id,owner,received_at,collection,unread,quarantined,record) VALUES(?,?,?,?,?,?,?)',m.id,owner,i,m.collection,1,0,JSON.stringify(m));}
 assert.equal(index.migrateIncoming(),false);index.upsert(message('202',{receivedAt:202,tags:['live']}));const resumed=new AccountItemIndex(metadata.sql);assert.equal(resumed.migrateIncoming(),true);assert.equal((await resumed.incomingPage(owner,{filter:{version:1,tagsAll:['live']}})).items.length,1);
 const before=resumed.incomingState('revision');await assert.rejects(metadata.transaction(async()=>{resumed.upsert(message('rollback'));throw Error('rollback');}),/rollback/);assert.equal(resumed.get('rollback'),null);assert.equal(resumed.incomingState('revision'),before);
});
test('portable owner methods provide Views and SQL pages without granting another account authority',async t=>{
 const {metadata}=fixture(t),blobs={put:async()=>{},get:async()=>null,delete:async()=>{}},controller=new AccountController({metadata,gate:new SerialGate(),blobs,archives:blobs,sql:metadata.sql,config:{APP_ORIGIN:'https://space.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'}});
 const invoke=(method,...args)=>controller.invoke({method,args:[owner,...args]});await controller.warm(owner);
 for(let i=0;i<120;i++)controller.itemIndex.upsert(message('portable'+i,{tags:['wanted'],receivedAt:i}));
 const saved=await invoke('createView',{name:'Wanted',filter:{version:1,tagsAll:['wanted']}});assert(saved.id);const page=await invoke('queryIncoming',{view:saved.id,viewRevision:1,limit:100});assert.equal(page.items.length,100);assert.equal((await invoke('queryIncoming',{view:saved.id,viewRevision:1,limit:100,cursor:page.cursor})).items.length,20);
 const foreign=await controller.invoke({method:'listViews',args:[other]});assert.equal(foreign.$fault.code,'forbidden');assert((await invoke('listViews')).views.some(v=>v.id===saved.id));
});
test('actual Node owner routes enforce session, Origin, CSRF, methods and strict query parameters',async()=>{
 const {createNodeServer}=await import('../apps/node/server.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'bindle-views-')),origin='http://localhost:8789';let app;
 try{app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BILLING_ENABLED:'false'}});
  const request=(path,{method='GET',body,headers={}}={})=>app.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},...body===undefined?{}:{body:JSON.stringify(body)}}));
  const pending=await(await request('/api/auth/signup',{method:'POST',body:{handle:'views_test',method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}})).json();
  const {softAuthenticator}=await import('./helpers/soft-passkey.mjs');assert.equal((await request('/api/auth/passkey/register',{method:'POST',body:{pendingToken:pending.pendingToken,response:await softAuthenticator({origin}).register(pending.registrationOptions)}})).status,200);
  const recovery=await(await request('/api/auth/recovery/download',{method:'POST',body:{pendingToken:pending.pendingToken}})).json();
  const activation=await request('/api/auth/recovery/confirm',{method:'POST',body:{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}});assert.equal(activation.status,200);const session=await activation.json(),headers={Cookie:activation.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':session.csrfToken};
  assert.equal((await request('/api/views')).status,401);assert.equal((await request('/api/incoming')).status,401);
  const body={name:'Work',filter:{version:1,classifications:['work']}};
  assert.equal((await request('/api/views',{method:'POST',body,headers:{...headers,'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await request('/api/views',{method:'POST',body,headers:{...headers,Origin:'https://elsewhere.example'}})).status,403);
  const created=await request('/api/views',{method:'POST',body,headers});assert.equal(created.status,200);const view=await created.json();
  assert.equal((await request('/api/views/'+view.id,{method:'POST',body,headers})).status,405);
  assert.equal((await request('/api/incoming?limit=1&limit=2',{headers})).status,400);
  assert.equal((await request('/api/incoming?owner='+other,{headers})).status,400);
  const page=await request('/api/incoming?view='+view.id+'&viewRevision=1',{headers});assert.equal(page.status,200);assert.deepEqual((await page.json()).items,[]);
  const updated=await request('/api/views/'+view.id,{method:'PUT',headers,body:{...body,name:'Revised',expectedRevision:1}});assert.equal(updated.status,200);
  assert.equal((await request('/api/incoming?view='+view.id+'&viewRevision=1',{headers})).status,409);
  assert.equal((await request('/api/views/'+view.id,{method:'DELETE',headers,body:{expectedRevision:2}})).status,200);
  // Conversation organization (PATCH /api/incoming) left the core with messaging on 2026-10-27.
  assert.equal((await request('/api/incoming',{method:'PATCH',headers,body:{}})).status,405);

 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});