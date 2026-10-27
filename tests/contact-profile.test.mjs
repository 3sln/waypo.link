// The contact profile, per-link sharing, redemption bindings and saved contacts moved out of packages/beaming when
// Beam left the core (DEVLOG 2026-10-26 "Beam removed from core"): HTTP behaviour, the read fallback over legacy
// Beam-era keys, release-v1 dual writes and rollback safety, the `beam-retired-v1` step, revocation cleanup and the
// export inventory (review follow-ups R1–R4 included).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {collectLinkState,DEAD_PARENT_HOLD_MS} from '../packages/links/audience.mjs';
import {ContactProfiles,CONTACT_KEYS,LEGACY_CONTACT_KEYS,contactGrantKeys} from '../packages/links/contact-profile.mjs';
import {retireBeamStorage,BEAM_RETIRED_MARKER,BEAM_ONLY_PREFIXES} from '../packages/runtime/beam-retirement.mjs';
import {exportInventory,createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {key} from '../packages/messaging/store.mjs';
import {ROUTES,routeMethods} from '../packages/runtime/routes/index.mjs';
import {admission} from '../packages/runtime/routes/contact-profile.mjs';
import {createsContentOrGrant} from '../packages/identity/age-policy.mjs';

const origin='http://localhost:8797',password='Contact profile password with enough entropy!';
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'contact-profile-')),config={APP_ORIGIN:origin};let signups=0;const app=await createNodeServer({directory,config});
 const request=async(path,{method='GET',input,headers={}}={})=>{const response=await app.fetch(new Request(new URL(path,origin),{method,headers:{Origin:origin,...path==='/api/auth/signup'?{'CF-Connecting-IP':`127.0.0.${++signups}`}:{},...headers,...input!==undefined?{'Content-Type':'application/json'}:{}},...input===undefined?{}:{body:JSON.stringify(input)}}));const text=await response.text();let value=null;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,value,response};};
 const post=(path,input,session)=>request(path,{method:'POST',input,headers:session?.headers});
 const signup=async()=>{const pending=await post('/api/auth/signup',{password,method:'password',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'});assert.equal(pending.status,200,JSON.stringify(pending.value));const recovery=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:recovery.value.recoveryToken,downloadConfirmed:true});assert.equal(activated.status,200);return {...activated.value,headers:{Cookie:activated.response.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':activated.value.csrfToken}};};
 const holder=await signup(),owner=await signup();
 const collection=(await request('/api/account',{headers:owner.headers})).value.collections[0].id;
 const contact=options=>post('/api/contacts',{name:'Profile grant',collections:[collection],mimeTypes:['text/plain'],expiresAt:Date.now()+3600000,...options},owner);
 return {app,request,post,holder,owner,contact,metadata:id=>app.resources.accounts.get(id).metadata,close:async()=>{await app.close();await rm(directory,{force:true,recursive:true});}};
}

test('profile, sharing and saved contacts over HTTP disclose only the redeemed link’s selected fields',async()=>{
 const f=await fixture();try{
  const set=await f.request('/api/profile',{method:'PUT',headers:f.owner.headers,input:{displayName:'Shared name',bio:'Private biography',avatar:'https://image.example/private.png',discloseToContacts:true}});assert.equal(set.status,200,JSON.stringify(set.value));
  assert.deepEqual((await f.request('/api/profile',{headers:f.owner.headers})).value,{displayName:'Shared name',bio:'Private biography',avatar:'https://image.example/private.png',discloseToContacts:true});
  assert.equal((await f.metadata(f.owner.account.id).get('profile')).displayName,'Shared name');
  const hidden=await f.contact({}),named=await f.contact({profileFields:['displayName']});assert.equal(named.status,200,JSON.stringify(named.value));
  assert.deepEqual(hidden.value.profileFields,[]);assert.deepEqual(named.value.profileFields,['displayName']);assert.equal(named.value.discloseProfile,true);assert.equal('beamEnabled' in named.value,false);
  // Redeem: the saved contact keeps the URL encrypted, and the directory never lists the owner's sessions.
  const redeemed=await f.post('/api/contacts/redeem',{url:named.value.url},f.holder);assert.equal(redeemed.status,200,JSON.stringify(redeemed.value));assert.deepEqual(redeemed.value,{peer:f.owner.account.id,grantId:named.value.id});
  const stored=await f.metadata(f.holder.account.id).get('saved-contact/'+f.owner.account.id);assert.equal(stored.grantId,named.value.id);assert(!JSON.stringify(stored).includes(named.value.url));
  const listing=(await f.request('/api/contacts/directory',{headers:f.holder.headers})).value;assert.equal(listing.length,1);
  assert.deepEqual(listing[0],{peer:f.owner.account.id,grantId:named.value.id,url:named.value.url,handle:f.owner.account.handle,profile:{displayName:'Shared name'}});
  const endpoint='/api/contacts/profile/'+f.owner.account.id;assert.deepEqual((await f.request(endpoint,{headers:f.holder.headers})).value,{displayName:'Shared name'});
  // Sharing: the renamed route; Beam's permission is no longer accepted.
  assert.equal((await f.request('/api/contacts/'+named.value.id+'/beam',{method:'PUT',headers:f.owner.headers,input:{profileFields:[]}})).status,404);
  assert.equal((await f.request('/api/contacts/'+named.value.id+'/sharing',{method:'PUT',headers:f.owner.headers,input:{beamEnabled:true}})).value.error,'contact_sharing_invalid');
  assert.equal((await f.request('/api/contacts/'+named.value.id+'/sharing',{method:'PUT',headers:f.owner.headers,input:{profileFields:['passwordHash']}})).value.error,'profile_fields_invalid');
  assert.deepEqual((await f.request('/api/contacts/'+named.value.id+'/sharing',{method:'PUT',headers:f.owner.headers,input:{profileFields:['displayName','bio']}})).value,{id:named.value.id,profileFields:['displayName','bio'],discloseProfile:true});
  assert.deepEqual((await f.request(endpoint,{headers:f.holder.headers})).value,{displayName:'Shared name',bio:'Private biography'});
  assert.deepEqual((await f.request('/api/account',{headers:f.owner.headers})).value.contacts.find(c=>c.id===named.value.id).profileFields,['displayName','bio']);
  // The master switch withholds every field.
  await f.request('/api/profile',{method:'PUT',headers:f.owner.headers,input:{displayName:'Shared name',bio:'Private biography',avatar:'',discloseToContacts:false}});assert.equal((await f.request(endpoint,{headers:f.holder.headers})).value,null);
  await f.request('/api/profile',{method:'PUT',headers:f.owner.headers,input:{displayName:'Shared name',bio:'Private biography',avatar:'',discloseToContacts:true}});
  // A second redemption replaces the saved contact's grant; a mismatched grant is refused.
  assert.equal((await f.post('/api/contacts/redeem',{url:hidden.value.url},f.holder)).status,200);assert.equal((await f.request(endpoint,{headers:f.holder.headers})).value,null);
  assert.equal((await f.request(endpoint+'?grantId='+named.value.id,{headers:f.holder.headers})).value.error,'profile_grant_mismatch');
  // Public profile representation: identity and selected fields only.
  const publicProfile=await f.request(named.value.url,{headers:{Accept:'application/vnd.bindle.contact-profile+json'}});assert.equal(publicProfile.status,200);
  assert.deepEqual(publicProfile.value,{identityURI:`${origin}/users/${f.owner.account.handle}`,profile:{displayName:'Shared name',bio:'Private biography'}});
  // Forget removes the saved contact.
  assert.deepEqual((await f.request('/api/contacts/directory/'+f.owner.account.id,{method:'DELETE',headers:f.holder.headers})).value,{removed:true,peer:f.owner.account.id});
  assert.deepEqual((await f.request('/api/contacts/directory',{headers:f.holder.headers})).value,[]);assert.equal((await f.request(endpoint,{headers:f.holder.headers})).value.error,'contact_not_found');
  // No Beam route survives.
  for(const path of ['/api/beams/status','/api/beams/mailbox'])assert.equal((await f.request(path,{headers:f.holder.headers})).status,404,path);
  assert.equal((await f.post('/api/beams/offers',{recipient:f.owner.account.id,files:[]},f.holder)).status,404);
 }finally{await f.close();}
});

test('route registry: contact profile routes are mounted before contacts and no Beam route remains',()=>{
 assert.deepEqual(routeMethods('/api/profile'),['GET','PUT']);assert.deepEqual(routeMethods('/api/contacts/11111111-1111-4111-8111-111111111111/sharing'),['PUT']);
 assert.deepEqual(routeMethods('/api/contacts/redeem'),['POST']);assert.deepEqual(routeMethods('/api/contacts/directory/11111111-1111-4111-8111-111111111111'),['DELETE']);
 for(const path of ['/api/beams/status','/api/beams/offers','/api/beams/mailbox','/api/beams/invites','/api/beams/invites/redeem','/api/contacts/11111111-1111-4111-8111-111111111111/beam'])assert.equal(routeMethods(path),null,path);
 assert.equal(ROUTES.some(module=>module.stages&&String(module.stages.owner).includes('beam')),false);
});

// Unit level over the real SQLite adapter.
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PEER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',GRANT='cccccccc-cccc-4ccc-8ccc-cccccccccccc',OTHER='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function store(t){const db=new SqliteMetadata(':memory:');t.after(()=>db.close());return db;}
const grantRow=(id=GRANT,extra={})=>({id,owner:OWNER,active:true,quarantined:false,claims:{exp:Math.floor(Date.now()/1000)+3600},...extra});
const service=(db,endpoints={})=>new ContactProfiles({metadata:db,endpoints});
async function seedLegacy(db){
 await db.put('beam/profile',{owner:OWNER,displayName:'Legacy name',bio:'Legacy bio',avatar:'',discloseToContacts:true});
 await db.put(key('contact-grant',GRANT),grantRow());
 await db.put('beam/grant/'+GRANT,{beamEnabled:true,profileFields:['displayName']});
 await db.put('beam/redeemed/'+GRANT,{peer:PEER,grantId:GRANT,owner:OWNER,expiresAt:Date.now()+3600000});
 await db.put(`beam/redeemed-peer/${PEER}/${GRANT}`,{grantId:GRANT});
 await db.put('beam/directory/'+OTHER,{peer:OWNER,grantId:GRANT,owner:OTHER,expiresAt:Date.now()+3600000,encryptedURL:{sealed:'x'}});
}

test('v1 reads: legacy rows answer before any copy, and every write keeps both keys with one stamp',async t=>{
 const db=store(t),contacts=service(db,{inspect:async()=>({grant:grantRow(),endpoint:'https://portal.example/users/person/contact/'+GRANT})});await seedLegacy(db);
 assert.deepEqual(await contacts.profile(OWNER),{displayName:'Legacy name',bio:'Legacy bio',avatar:'',discloseToContacts:true});
 assert.deepEqual(await contacts.contactInfo(OWNER,PEER,{grantId:GRANT}),{profile:{displayName:'Legacy name'}},'legacy beamEnabled is not surfaced');
 assert.deepEqual(await contacts.disclosed(OWNER,PEER,{grantId:GRANT}),{displayName:'Legacy name'});
 assert.deepEqual((await contacts.peerBindings(OWNER,PEER)).map(b=>b.grantId),[GRANT]);
 assert.deepEqual(await contacts.directory(),[{peer:OTHER,grantId:GRANT,encryptedURL:{sealed:'x'}}]);
 assert.deepEqual([...await contacts.sharingRows()],[[GRANT,{profileFields:['displayName']}]]);
 assert.deepEqual(await contacts.publicProfile(OWNER,'signed'),{identityURI:'https://portal.example/users/person',profile:{displayName:'Legacy name'}});
 // Dual writes: both keys, one stamp; the legacy twin keeps the pre-removal shape.
 await contacts.profile(OWNER,{displayName:'New name',bio:'',avatar:'',discloseToContacts:true});
 const [newProfile,oldProfile]=[await db.get('profile'),await db.get('beam/profile')];assert.deepEqual(newProfile,oldProfile);assert.ok(Number.isSafeInteger(newProfile.updatedAt));assert.equal(newProfile.displayName,'New name');
 assert.deepEqual(await contacts.sharing(OWNER,GRANT,{discloseProfile:true}),{id:GRANT,profileFields:['displayName','bio','avatar'],discloseProfile:true});
 const sharingNew=await db.get('contact-sharing/'+GRANT),sharingOld=await db.get('beam/grant/'+GRANT);assert.deepEqual(sharingNew.profileFields,['displayName','bio','avatar']);assert.equal('beamEnabled' in sharingNew,false);
 assert.deepEqual(sharingOld,{beamEnabled:true,profileFields:['displayName','bio','avatar'],updatedAt:sharingNew.updatedAt},'a rollback still reads its stored beamEnabled');
 await contacts.redeem(OWNER,'signed',PEER);for(const k of ['contact-redeemed/'+GRANT,'beam/redeemed/'+GRANT])assert.equal((await db.get(k)).peer,PEER,k);for(const k of [`contact-redeemed-peer/${PEER}/${GRANT}`,`beam/redeemed-peer/${PEER}/${GRANT}`])assert.equal((await db.get(k)).grantId,GRANT,k);
 await assert.rejects(contacts.redeem(OWNER,'signed',OTHER),{code:'contact_already_redeemed'});
 await contacts.remember(PEER,{peer:PEER,grantId:GRANT,owner:OTHER,expiresAt:Date.now()+3600000});for(const k of ['saved-contact/'+OTHER,'beam/directory/'+OTHER])assert.equal((await db.get(k)).owner,OTHER,k);
 assert.deepEqual(await contacts.forget(PEER,OTHER),{removed:true,peer:OTHER});assert.deepEqual(await contacts.directory(),[]);for(const k of ['saved-contact/'+OTHER,'beam/directory/'+OTHER])assert.equal(await db.get(k),undefined,k);
});

test('R1 rollback: a legacy row rewritten by pre-removal code after the copy wins, and is re-copied by the alarm pass',async t=>{
 const db=store(t),contacts=service(db);
 await db.put('beam/profile',{owner:OWNER,displayName:'v1',bio:'',avatar:'',discloseToContacts:true});
 let r;do r=await retireBeamStorage(db);while(!r.done);
 assert.equal((await db.get('profile')).displayName,'v1');assert.ok(await db.get('beam/profile'),'v1 never deletes a legacy row');
 // Pre-removal code (rollback) withdraws disclosure, writing only the legacy key, without a stamp.
 await db.put('beam/profile',{owner:OWNER,displayName:'v2-rolled-back',bio:'',avatar:'',discloseToContacts:false});
 const profile=await contacts.profile(OWNER);assert.equal(profile.displayName,'v2-rolled-back');assert.equal(profile.discloseToContacts,false,'a withdrawn disclosure is never re-enabled');
 // The marker does not stop the alarm-path reconciliation: the newer legacy row is copied forward.
 for(let i=0;i<5;i++)await retireBeamStorage(db);assert.equal((await db.get('profile')).displayName,'v2-rolled-back');
 // A stamped neutral row newer than a stamped legacy row wins (both written by v1 code, legacy first).
 await db.put('beam/profile',{owner:OWNER,displayName:'older',bio:'',avatar:'',discloseToContacts:false,updatedAt:1});await db.put('profile',{owner:OWNER,displayName:'newer',bio:'',avatar:'',discloseToContacts:false,updatedAt:2});
 assert.equal((await contacts.profile(OWNER)).displayName,'newer');
});

test('R1 rollback: pre-removal code still sees v1 bindings and deletions it makes are honoured',async t=>{
 const db=store(t),contacts=service(db);
 await db.put('beam/redeemed/'+GRANT,{peer:PEER,grantId:GRANT,owner:OWNER,expiresAt:Date.now()+3600000});await db.put('beam/directory/'+OTHER,{peer:OWNER,grantId:GRANT,owner:OTHER,expiresAt:Date.now()+3600000});
 let r;do r=await retireBeamStorage(db);while(!r.done);
 assert.equal((await db.get('beam/redeemed/'+GRANT)).peer,PEER,'pre-removal code checks only beam/redeemed/ for a prior binding');assert.equal((await db.get('contact-redeemed/'+GRANT)).peer,PEER);
 // Pre-removal code forgets the saved contact (legacy key only): the neutral copy must not resurrect it.
 await db.delete('beam/directory/'+OTHER);assert.deepEqual(await contacts.directory(),[]);
 const pass=await retireBeamStorage(db,{limit:64});assert.ok(pass.pruned>=1);assert.equal(await db.get('saved-contact/'+OTHER),undefined);
});

test('disclosure needs the exact redeemed link, an active grant, a field allowlist and the master switch',async t=>{
 const db=store(t),contacts=service(db);await seedLegacy(db);const second='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 await db.put(key('contact-grant',second),grantRow(second));await db.put('beam/grant/'+second,{profileFields:['displayName','passwordHash']});await db.put('beam/redeemed/'+second,{peer:PEER,grantId:second,owner:OWNER,expiresAt:Date.now()+3600000});
 assert.equal(await contacts.disclosed(OWNER,PEER),null);
 assert.deepEqual(await contacts.disclosed(OWNER,PEER,{grantId:second}),{displayName:'Legacy name'},'unknown fields are never disclosed');
 await assert.rejects(contacts.disclosed(OWNER,OTHER,{grantId:second}),{code:'contact_inactive'},'another peer cannot use the binding');
 await db.put('beam/profile',{owner:OWNER,displayName:'Legacy name',bio:'',avatar:'',discloseToContacts:false});assert.equal(await contacts.disclosed(OWNER,PEER,{grantId:second}),null);
 await db.put('beam/profile',{owner:OWNER,displayName:'Legacy name',bio:'',avatar:'',discloseToContacts:true});
 await db.put(key('contact-grant',second),grantRow(second,{active:false}));await assert.rejects(contacts.disclosed(OWNER,PEER,{grantId:second}),{code:'contact_inactive'});
 await assert.rejects(contacts.sharing(OWNER,second,{profileFields:['displayName']}),{code:'contact_not_found'});
 await assert.rejects(contacts.sharing(OWNER,GRANT,{beamEnabled:false}),{code:'contact_sharing_invalid'});
 await assert.rejects(contacts.profile(OWNER,{displayName:'x',bio:'',avatar:'http://insecure.example/a.png',discloseToContacts:true}),{code:'profile_invalid'});
 const quarantined=service(db,{inspect:async()=>({grant:grantRow(),endpoint:'https://portal.example/users/person/contact/'+GRANT})});await db.put(key('contact-grant',GRANT),grantRow(GRANT,{quarantined:true}));
 assert.equal((await quarantined.publicProfile(OWNER,'signed')).profile.displayName,'Legacy name','quarantine is silent to the public profile');
 await assert.rejects(quarantined.sharing(OWNER,GRANT,{profileFields:[]}),{code:'contact_not_found'});
});

test('saved contacts are bounded at 1,000, counted on the authoritative legacy rows',async t=>{
 const db=store(t),contacts=service(db);const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 await db.transaction(async tx=>{for(let i=0;i<1000;i++)await tx.put('beam/directory/'+id(i),{peer:PEER,grantId:id(i),owner:id(i),expiresAt:Date.now()+3600000});});
 assert.equal((await contacts.directory()).length,1000);
 await assert.rejects(contacts.remember(PEER,{peer:PEER,grantId:GRANT,owner:OTHER,expiresAt:Date.now()+3600000}),{code:'contact_directory_full'});
 assert.deepEqual(await contacts.remember(PEER,{peer:PEER,grantId:GRANT,owner:id(0),expiresAt:Date.now()+3600000}),{peer:id(0),grantId:GRANT},'an existing contact can be refreshed');
 assert.equal((await db.get('saved-contact/'+id(0))).grantId,GRANT);
});

test('revocation cleanup keys cover both the neutral and the legacy rows of a grant',()=>{
 assert.deepEqual(contactGrantKeys(GRANT,PEER).sort(),['beam/grant/'+GRANT,'beam/redeemed/'+GRANT,`beam/redeemed-peer/${PEER}/${GRANT}`,'contact-redeemed/'+GRANT,`contact-redeemed-peer/${PEER}/${GRANT}`,'contact-sharing/'+GRANT].sort());
 assert.deepEqual(contactGrantKeys(GRANT,'not-a-uuid').sort(),['beam/grant/'+GRANT,'beam/redeemed/'+GRANT,'contact-redeemed/'+GRANT,'contact-sharing/'+GRANT].sort());
});

test('beam-retired-v1 copies generic rows without deleting them, deletes Beam-only families in bounded batches and writes its marker last',async t=>{
 const db=store(t),now=Date.now();await seedLegacy(db);
 for(let i=0;i<5;i++)await db.put(`beam/offer/${i}`,{state:'accepted',expiresAt:now+1000,iceIssued:{sender:{state:'issued',count:1,expiresAt:now+60000,usernames:[{username:'live-'+i,expiresAt:now+60000},{username:'old-'+i,expiresAt:now-1}]}}});
 await db.put('beam/usage',{month:'2026-10',bytes:1,offers:1});await db.put('beam/mailbox/m',{expiresAt:now});await db.put('beam/invite/i',{expiresAt:now});await db.put('beam/nearby/n',{expiresAt:now});
 const revoked=[];let failNext=true;const revoke=async username=>{if(failNext){failNext=false;throw new Error('provider down');}revoked.push(username);};
 let passes=0,result;do{result=await retireBeamStorage(db,{limit:3,revoke});passes++;if(!result.done)assert.equal(await db.get(BEAM_RETIRED_MARKER),undefined,'the marker is written last');}while(!result.done&&passes<50);
 assert.equal(result.done,true);assert(passes>3,`bounded batches took ${passes} passes`);
 assert.deepEqual(revoked.sort(),['live-1','live-2','live-3','live-4'],'only unexpired usernames are revoked, and a failed revocation does not block the step');
 for(const prefix of BEAM_ONLY_PREFIXES)assert.equal((await db.list({prefix})).size,0,prefix);
 for(const prefix of Object.values(LEGACY_CONTACT_KEYS))assert.ok((await db.list({prefix})).size,'legacy rows are kept in v1: '+prefix);
 assert.deepEqual(await db.get('profile'),{owner:OWNER,displayName:'Legacy name',bio:'Legacy bio',avatar:'',discloseToContacts:true,migrated:true});
 assert.deepEqual(await db.get('contact-sharing/'+GRANT),{profileFields:['displayName'],migrated:true},'beamEnabled is not copied');
 assert.equal((await db.get('contact-redeemed/'+GRANT)).peer,PEER);assert.equal((await db.get(`contact-redeemed-peer/${PEER}/${GRANT}`)).grantId,GRANT);
 assert.deepEqual((await db.get('saved-contact/'+OTHER)).encryptedURL,{sealed:'x'});
 // Idempotent: a further pass copies nothing.
 const again=await retireBeamStorage(db,{limit:64,revoke});assert.equal(again.moved,0);assert.equal(again.done,true);
});

test('beam-retired-v1 warm path never calls the TURN provider and keeps offers with live credentials for the alarm',async t=>{
 const db=store(t),now=Date.now();await db.put('beam/offer/live',{expiresAt:now+1000,iceIssued:{sender:{state:'issued',usernames:[{username:'u',expiresAt:now+60000}]}}});await db.put('beam/offer/dead',{expiresAt:0,iceIssued:{}});
 for(let i=0;i<5;i++)await retireBeamStorage(db,{revoke:'defer'});
 assert.equal(await db.get('beam/offer/dead'),undefined);assert.ok(await db.get('beam/offer/live'));assert.equal(await db.get(BEAM_RETIRED_MARKER),undefined,'not done while an offer awaits revocation');
 const revoked=[];const r=await retireBeamStorage(db,{revoke:async u=>revoked.push(u)});assert.deepEqual(revoked,['u']);assert.equal(await db.get('beam/offer/live'),undefined);
 // TURN revocation counts against the batch budget.
 for(let i=0;i<4;i++)await db.put('beam/offer/x'+i,{expiresAt:now+1000,iceIssued:{sender:{usernames:[{username:'a'+i,expiresAt:now+60000},{username:'b'+i,expiresAt:now+60000}]}}});
 const calls=[];await retireBeamStorage(db,{limit:3,revoke:async u=>calls.push(u)});assert.ok(calls.length<=3,`${calls.length} revocations in a 3-unit batch`);
});

test('accounts: warm survives a failing beam-retired-v1 and falls back to the alarm; the alarm path keeps reconciling after the marker',async t=>{
 const db=store(t),c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:'https://provider.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),CLOUDFLARE_TURN_KEY_ID:'k',CLOUDFLARE_TURN_API_TOKEN:'t'},sql:db.sql});
 const original=globalThis.fetch;let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;return new Response(null,{status:204});};t.after(()=>{globalThis.fetch=original;});
 await db.put('beam/offer/live',{expiresAt:Date.now()+1000,iceIssued:{sender:{usernames:[{username:'u',expiresAt:Date.now()+60000}]}}});
 const list=db.list.bind(db);let failing=true;db.list=async options=>{if(failing&&options?.prefix?.startsWith('beam/'))throw new Error('storage hiccup');return list(options);};
 await c.touch(OWNER);assert.equal(providerCalls,0,'warm never calls TURN');
 failing=false;await c.touch(OWNER);assert.equal(providerCalls,0);assert.ok(await db.get('beam/offer/live'),'warm defers offers holding live credentials');
 await c.retireBeamStorage({alarm:true});assert.equal(providerCalls,1);assert.equal(await db.get('beam/offer/live'),undefined);
 let r;do r=await c.retireBeamStorage({alarm:true});while(!r.done);
 await db.put('beam/profile',{owner:OWNER,displayName:'rolled back',bio:'',avatar:'',discloseToContacts:false});
 assert.equal((await c.retireBeamStorage()).moved,0,'the warm path stops at the marker');
 for(let i=0;i<5;i++)await c.retireBeamStorage({alarm:true});assert.equal((await db.get('profile')).displayName,'rolled back');
});

test('accounts run beam-retired-v1 on warm: legacy rows stay readable and are copied',async()=>{
 const f=await fixture();try{
  const db=f.metadata(f.owner.account.id);await db.delete(BEAM_RETIRED_MARKER);await db.delete('migration/beam-retired-v1-cursor');
  await db.put('beam/profile',{owner:f.owner.account.id,displayName:'Before removal',bio:'',avatar:'',discloseToContacts:false});await db.put('beam/offer/x',{expiresAt:0});await db.put('beam/usage',{month:'2026-10'});
  const profile=await f.request('/api/profile',{headers:f.owner.headers});assert.equal(profile.value.displayName,'Before removal');
  for(let i=0;i<3&&!await db.get(BEAM_RETIRED_MARKER);i++)await f.request('/api/profile',{headers:f.owner.headers});
  assert.ok(await db.get(BEAM_RETIRED_MARKER));assert.equal(await db.get('beam/offer/x'),undefined);assert.equal(await db.get('beam/usage'),undefined);assert.equal((await db.get('profile')).displayName,'Before removal');assert.ok(await db.get('beam/profile'));
 }finally{await f.close();}
});

test('R3 sharing: a body with both keys is refused, and capacity and terms classification use the effective fields',async t=>{
 const db=store(t);await db.put(key('contact-grant',GRANT),grantRow());const contacts=service(db),path='/api/contacts/'+GRANT+'/sharing';
 const both={discloseProfile:false,profileFields:['displayName','bio','avatar']};
 await assert.rejects(contacts.sharing(OWNER,GRANT,both),{code:'contact_sharing_invalid'});
 const rule=admission.protective.find(r=>r.match(path,'PUT'));
 for(const [body,protective] of [[both,false],[{discloseProfile:false},true],[{profileFields:[]},true],[{discloseProfile:true},false],[{profileFields:['bio']},false],[{discloseProfile:false,profileFields:[]},false],[{},false],[{profileFields:'x'},false]]){
  assert.equal(rule.test(body),protective,JSON.stringify(body));assert.equal(createsContentOrGrant(path,'PUT',body),!protective,'terms '+JSON.stringify(body));
 }
});

test('export inventory: profile, saved contacts, sharing grants and redemption bindings are exported once, from the authoritative row',async t=>{
 for(const [prefix,contributor] of [['beam/profile','profile'],['beam/directory/x','saved-contacts'],['beam/grant/x','contact-sharing'],['beam/redeemed/x','contact-redemptions']])assert.equal(exportInventory([prefix])[0].contributor,contributor,prefix);
 for(const prefix of ['profile','saved-contact/x','contact-sharing/x','contact-redeemed/x','contact-redeemed-peer/x/y','beam/redeemed-peer/x/y','beam/offer/x','beam/usage','migration/beam-retired-v1','migration/beam-retired-v1-cursor'])assert.ok(exportInventory([prefix])[0].reason,prefix);
 // R4: singleton keys match exactly.
 assert.deepEqual(exportInventory(['profiles'])[0],{prefix:'profiles'},'an unreviewed family is not covered by the profile singleton');
 assert.equal(exportInventory(['beam/profile-x'])[0].contributor,undefined);assert.match(exportInventory(['beam/profile-x'])[0].reason,/^Legacy/);
 const db=store(t),contacts=service(db);await seedLegacy(db);await contacts.profile(OWNER,{displayName:'Dual',bio:'',avatar:'',discloseToContacts:true});
 await db.put('beam/grant/'+OTHER,{beamEnabled:false,profileFields:['bio']});await db.put('beam/directory/'+PEER,{peer:OWNER,grantId:OTHER,owner:PEER,expiresAt:5,encryptedURL:{sealed:'secret'}});await db.put('beam/profile-other',{owner:OWNER,displayName:'not a profile'});
 let r;do r=await retireBeamStorage(db);while(!r.done);
 const read=async name=>{const contributor=createExportContributors({accountStore:db}).find(v=>v.name===name);let cursor=null;const out=[];do{const page=await contributor.page({owner:OWNER,cursor,limit:10});out.push(...page.rows.map(r=>r.record));cursor=page.cursor;}while(cursor);return out;};
 const profile=await read('profile');assert.equal(profile.length,1,'dual rows export once; the singleton never matches beam/profile-other');assert.equal(profile[0].displayName,'Dual');
 assert.deepEqual((await read('contact-sharing')).sort((a,b)=>a.id.localeCompare(b.id)),[{id:GRANT,profileFields:['displayName']},{id:OTHER,profileFields:['bio']}]);
 const redemptions=await read('contact-redemptions');assert.equal(redemptions.length,1);assert.equal(redemptions[0].peer,PEER);assert.equal(redemptions[0].grantId,GRANT);
 const saved=await read('saved-contacts');assert.deepEqual(saved.map(r=>r.contact).sort(),[PEER,OTHER].sort(),'saved contacts are exported although their owner is the other account');
 assert(!JSON.stringify(saved).includes('secret')&&!JSON.stringify(saved).includes('sealed'),'the encrypted capability URL is never exported');
});

test('contact revocation cleanup reclaims sharing and redemption rows under both key generations',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,26,12)});
 const db=store(t),c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:'https://provider.example',KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 await c.touch(OWNER);c.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});
 const link=()=>c.createContactLink(OWNER,'person',{name:'contact',mimeTypes:['text/plain'],expiresAt:Date.now()+300*86400000,maxMessages:5});
 const fresh=await link(),legacy=await link();
 await c.contactSharing(OWNER,fresh.id,{profileFields:['displayName']});await c.contactRedeem(OWNER,fresh.url,PEER);
 await db.put('beam/grant/'+legacy.id,{beamEnabled:true,profileFields:['bio']});await db.put('beam/redeemed/'+legacy.id,{peer:OTHER,grantId:legacy.id,owner:OWNER,expiresAt:Date.now()+3600000});await db.put(`beam/redeemed-peer/${OTHER}/${legacy.id}`,{grantId:legacy.id});
 for(const id of [fresh.id,legacy.id])await c.revokeContact(OWNER,id);
 t.mock.timers.tick(DEAD_PARENT_HOLD_MS+1000);await collectLinkState(c,OWNER);
 for(const prefix of ['contact-sharing/','contact-redeemed/','contact-redeemed-peer/','beam/grant/','beam/redeemed/','beam/redeemed-peer/'])assert.equal((await db.list({prefix})).size,0,prefix);
});
