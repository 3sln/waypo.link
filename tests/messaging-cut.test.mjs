// Messaging removed from core (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset"):
// - the BB-CUT reset `messaging-retired-v1` (packages/runtime/messaging-reset.mjs) deletes every legacy messaging row
//   in bounded slices and keeps activity, links and account state, including under injected faults (seeded);
// - a shelved archive from before the reset restores without its legacy `message/` rows, with the reset's own cleanup;
// - the reset keeps live link families, preserves a legacy-only profile, survives corrupt rows and never stops the
//   other alarm maintenance;
// - the removed legacy routes answer uniformly without reaching an account;
// - the public-intake fragment and the email bridge are gone (owner direction 2026-10-28): the only recognized field is
//   the provider-only messaging-ingress field, and Parlay claims only the mailbox contract;
// - the Parlay app's env rename keeps the retired names as aliases.
// Engine level over the real SQLite adapter and AccountController. Rerun a seeded failure with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {resetLegacyMessaging,MESSAGING_RESET_MARKER,MESSAGING_RESET_PREFIXES} from '../packages/runtime/messaging-reset.mjs';
import {appMessageKey,appMessageUsageKey} from '../packages/activity/app-messages.mjs';
import {key} from '../packages/core/records.mjs';
import application from '../packages/runtime/http.mjs';
import {RECOGNIZED_FIELDS} from '../packages/apps/connections.mjs';
import {MESSAGING_INGRESS_FRAGMENT} from '../packages/identity/messaging-ingress.mjs';
import {fragmentOutcome,consumes} from '../packages/core/fragments.mjs';
import {FEATURE_DEFINITIONS} from '../packages/app/domains/provider-features.mjs';
import {EXT,PROVIDER_EXT} from '../packages/core/extensions.mjs';
import {validateIntegrationManifest} from '../packages/federation/integrations.mjs';
import {parlayEnv,PARLAY_ENV_NAMES} from '../apps/parlay/env.mjs';
import {RETIRED_FLAGS,FLAGS} from '../packages/flags/registry.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ORIGIN='https://provider.example',KEK=Buffer.alloc(32,7).toString('base64');
const memoryBucket=()=>{const objects=new Map();return {objects,put:async(k,v)=>{objects.set(k,typeof v==='string'?v:new Uint8Array(v));},get:async k=>objects.has(k)?{size:objects.get(k).length??objects.get(k).byteLength,text:async()=>objects.get(k),json:async()=>JSON.parse(objects.get(k)),arrayBuffer:async()=>objects.get(k).buffer}:null,delete:async k=>{for(const name of [k].flat())objects.delete(name);}};};
function account(t,{metadata}={}){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 const blobs=memoryBucket(),archives=memoryBucket();
 const controller=new AccountController({metadata:metadata?.(db)??db,gate:new SerialGate(),blobs,archives,config:{APP_ORIGIN:ORIGIN,KEY_ENCRYPTION_KEY:KEK,WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'},sql:db.sql});
 t.after(()=>controller.engine.dispose());
 return {db,blobs,archives,controller};
}
// Legacy rows in every family the reset owns, plus rows it must keep.
const LEGACY_ROWS=[
 [key('message',OWNER,'m1'),{id:'m1',owner:OWNER,collection:'c',mimeType:'text/plain',size:4,receivedAt:1,blobRef:`messages/${OWNER}/m1`}],
 [key('message',OWNER,'m2'),{id:'m2',owner:OWNER,collection:'c',mimeType:'text/plain',size:4,receivedAt:2}],
 // Review L4: presentation revisions are garbage too; a ref outside `messages/<owner>/` (corrupt) is never queued.
 [key('message',OWNER,'m3'),{id:'m3',owner:OWNER,collection:'c',mimeType:'text/html',size:4,receivedAt:3,blobRef:`messages/${OWNER}/m3`,presentation:{revision:2,history:[{revision:1,blobRef:`messages/${OWNER}/m3/presentations/p1`},{revision:2,blobRef:'messages/someone-else/x'}]}}],
 [key('message',OWNER,'m4'),{id:'m4',owner:OWNER,collection:'c',mimeType:'text/plain',size:4,receivedAt:4,blobRef:'messages/someone-else/m4'}],
 [key('message-usage',OWNER),{bytes:8,messages:2}],[key('message-receipt','g1','k1'),{id:'m1'}],
 [key('contact-grant','g1'),{id:'g1',owner:OWNER,active:true,claims:{exp:2e9}}],[key('contact-grant-tombstone','g0'),{owner:OWNER}],
 ['contact-name/g1','Friends'],['contact-url/g1',{sealed:'x'}],[key('contact-author-day',OWNER,'d'),{n:1}],[key('contact-delivery-receipt',OWNER,'g1','r'),{retainUntil:1}],
 ['conversation/room/r1/',{id:'r1'}],['conversation/history/r1/e1/',{}],['conversation/outbox/o1/',{}],['conversation/block/p/',{}],
 ['contact-redeemed/g1',{peer:'p'}],['contact-redeemed-peer/p/g1',{grantId:'g1'}],['saved-contact/p',{}],
 ['beam/profile',{displayName:'Legacy'}],['beam/grant/g1',{}],['beam/offer/o1',{}],
 ['developer-contact/v2',{grantId:'g1'}],
 ['migration/app-messages-v1',{completedAt:1}],['migration/app-messages-v1-cursor','x'],['migration/beam-retired-v1',{}],
 [key('notification-event',OWNER,'m1'),{id:'m1',owner:OWNER,messageId:'m1'}],
];
// Rows outside the reset prefixes that a dropped legacy item owns (review L4): its postback preparation.
const LEGACY_SIDE_ROWS=[['message-postback-prepared/h-m3',{version:1,owner:OWNER,messageId:'m3',expiresAt:2e12}]];
const LEGACY_GARBAGE=[`messages/${OWNER}/m1`,`messages/${OWNER}/m3`,`messages/${OWNER}/m3/presentations/p1`].sort();
const garbage=async db=>[...(await db.list({prefix:'blob-garbage/'})).values()].sort();
const KEPT_ROWS=[
 [appMessageKey(OWNER,'a1'),{id:'a1',owner:OWNER,collection:'c',mimeType:'text/plain',size:4,receivedAt:3,readAt:null,tags:[]}],
 [appMessageUsageKey(OWNER),{bytes:4,messages:1}],[key('notification-event',OWNER,'a1'),{id:'a1',owner:OWNER,messageId:'a1'}],
 [key('collection',OWNER,'c'),{id:'c',owner:OWNER,name:'Inbox',active:true}],[key('rules',OWNER),[]],[key('tag-labels',OWNER),{revision:0,labels:{}}],
 ['profile',{owner:OWNER,displayName:'Kept',avatar:''}],['message-views/v1/'+OWNER,{views:[]}],
 ['message-postback-prepared/h-a1',{version:1,owner:OWNER,messageId:'a1',expiresAt:2e12}],
];
// Contact-link families the BB-CUT reset itself keeps (review L1). Since contacts phase 4 the `contact-links-retired-v1`
// reset deletes them in `warm` too (tests/contact-links-reset.test.mjs), so they are checked against the BB-CUT function only.
const LINK_ROWS=[[key('link','j1'),{jti:'j1',owner:OWNER,claims:{exp:2e9}}],['link-replay/j1/e/x',{expiresAt:1}],['developer-contact/occupant-v1',{version:1}],
 ['contact-sharing/j1',{profileFields:['bio'],updatedAt:1}],['link-audience/j1/h',{version:1,expiresAt:2e12}],['link-gc-cursor/replay','link/j0/']];
const seed=async db=>{for(const [k,v]of [...LEGACY_ROWS,...LEGACY_SIDE_ROWS,...KEPT_ROWS])await db.put(k,v);};
const remaining=async db=>{const out=[];for(const prefix of MESSAGING_RESET_PREFIXES)for(const k of (await db.list({prefix})).keys())out.push(k);return out;};

test('BB-CUT reset: warm deletes every legacy messaging family in bounded slices, keeps activity, links and account rows, and writes its marker last',async t=>{
 const {db,controller}=account(t);await db.put('owner',OWNER);await seed(db);
 // Bounded: a 5-row slice leaves work and no marker.
 const partial=await resetLegacyMessaging(db,{limit:5});assert.deepEqual(partial,{done:false,deleted:5});assert.equal(await db.get(MESSAGING_RESET_MARKER),undefined);
 await controller.warm(OWNER);
 assert.deepEqual(await remaining(db),[]);assert.equal((await db.get(MESSAGING_RESET_MARKER)).version,1);
 // The search backfill may stamp a revision on the kept item; nothing else changes.
 for(const [k,v]of KEPT_ROWS){const {revision,...stored}=await db.get(k)??{};assert.deepEqual(k.startsWith('app-message/')?stored:await db.get(k),v,k);}
 assert.equal(await db.get(key('notification-event',OWNER,'m1')),undefined,'a deleted item takes its notification event');
 for(const [k]of LEGACY_SIDE_ROWS)assert.equal(await db.get(k),undefined,'a deleted item takes its postback preparations '+k);
 assert.deepEqual(await garbage(db),LEGACY_GARBAGE,'content and presentation blobs go to the garbage queue once; foreign refs never');
 // Idempotent: a later warm or alarm does nothing more.
 await db.put(key('message',OWNER,'late'),{id:'late',owner:OWNER});assert.deepEqual(await resetLegacyMessaging(db),{done:true,deleted:0});
});

test('BB-CUT reset: the item index and search drop the deleted legacy items in the reset transaction',async t=>{
 const {db,controller}=account(t);await db.put('owner',OWNER);
 for(const [k,v]of LEGACY_ROWS.slice(0,2))await db.put(k,v);controller.itemIndex.upsert(LEGACY_ROWS[0][1]);controller.itemIndex.upsert(LEGACY_ROWS[1][1]);
 await controller.warm(OWNER);
 assert.deepEqual(controller.itemIndex.page(OWNER).items.map(i=>i.id),[]);
 for(const id of ['m1','m2'])assert.equal((await db.get(key('search-revision',OWNER,'message:'+id)))?.operation,'tombstone','search tombstone '+id);
});

test('BB-CUT reset (seeded): lost acknowledgements and failed commits never delete a kept row, never queue a blob twice, and the marker follows the last delete',async()=>{
 const t={after:()=>{}},runs={faults:0};
 await forEachSeed(10,async random=>{
  const db=new SqliteMetadata(':memory:');try{
   await db.put('owner',OWNER);await seed(db);
   let armed=true;const faulty=new Proxy(db,{get(target,prop){
    if(prop==='transaction')return async fn=>{const before=armed&&random.chance(0.3),after=armed&&random.chance(0.3);if(before){runs.faults++;throw Object.assign(new Error('commit failed'),{code:'injected'});}const value=await target.transaction(fn);if(after){runs.faults++;throw Object.assign(new Error('ack lost'),{code:'injected'});}return value;};
    if(prop==='put')return async(k,v)=>{if(k===MESSAGING_RESET_MARKER&&(await remaining(target)).length)throw new Error('marker before the last delete');return target.put(k,v);};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   let done=false;for(let pass=0;pass<200&&!done;pass++){if(pass===150)armed=false;try{done=(await resetLegacyMessaging(faulty,{limit:1+random.int(6)})).done;}catch(error){assert.equal(error.code,'injected');}
    for(const [k,v]of KEPT_ROWS)assert.deepEqual(await db.get(k),v,k);}
   assert.equal(done,true);assert.deepEqual(await remaining(db),[]);
   assert.deepEqual(await garbage(db),LEGACY_GARBAGE);
  }finally{db.close();}
 });
 assert.ok(runs.faults>10,JSON.stringify(runs));void t;
});

// Review M1: one assertion set for "this legacy item was dropped with full cleanup", used by the reset and the restore.
async function assertDropped(db,controller,id,{refs}){
 assert.equal(await db.get(key('message',OWNER,id)),undefined,'row '+id);
 assert.ok(!controller.itemIndex.page(OWNER).items.some(item=>item.id===id),'item index '+id);
 assert.equal((await db.get(key('search-revision',OWNER,'message:'+id)))?.operation,'tombstone','search tombstone '+id);
 assert.equal(await db.get(key('notification-event',OWNER,id)),undefined,'notification event '+id);
 assert.equal(await db.get('message-postback-prepared/h-'+id),undefined,'postback preparation '+id);
 const queued=await garbage(db);for(const ref of refs)assert.ok(queued.includes(ref),'garbage '+ref);
 assert.ok(!queued.some(ref=>!ref.startsWith(`messages/${OWNER}/`)),'only refs under the owner prefix');
}
const legacyItem=id=>({id,owner:OWNER,collection:'c',mimeType:'text/plain',size:1,receivedAt:1,blobRef:`messages/${OWNER}/${id}`,presentation:{revision:1,history:[{revision:1,blobRef:`messages/${OWNER}/${id}/presentations/p1`}]}});
const sideRows=async(db,controller,id)=>{controller.itemIndex.upsert(legacyItem(id));await db.put(key('notification-event',OWNER,id),{id,owner:OWNER,messageId:id});await db.put('message-postback-prepared/h-'+id,{version:1,owner:OWNER,messageId:id,expiresAt:2e12});};

test('the reset drops an in-metadata legacy item with full cleanup',async t=>{
 const {db,controller}=account(t);await db.put('owner',OWNER);
 await db.put(key('message',OWNER,'live'),legacyItem('live'));await sideRows(db,controller,'live');
 await controller.warm(OWNER);
 await assertDropped(db,controller,'live',{refs:[`messages/${OWNER}/live`,`messages/${OWNER}/live/presentations/p1`]});
});

test('a shelved archive from before the reset restores without legacy message rows, with the same cleanup as the reset',async t=>{
 const {db,archives,controller}=account(t);await db.put('owner',OWNER);await db.put(MESSAGING_RESET_MARKER,{version:1});
 const foreign={...legacyItem('bad'),blobRef:'messages/someone-else/bad',presentation:undefined};
 const rows=[[key('message',OWNER,'old'),legacyItem('old')],[key('message',OWNER,'bad'),foreign],[appMessageKey(OWNER,'a1'),{id:'a1',owner:OWNER,collection:'c',mimeType:'text/plain',size:1,receivedAt:1,readAt:null,tags:[]}]];
 const {archiveDigest}=await import('../packages/runtime/account/support.mjs');
 await archives.put(`accounts/${OWNER}.json`,JSON.stringify({version:1,owner:OWNER,rows,digest:await archiveDigest(JSON.stringify(rows))}));await db.put('shelved',true);
 // Shelving moved the rows to the archive but left their item-index entries, notification events and preparations.
 await sideRows(db,controller,'old');controller.itemIndex.upsert(foreign);
 await controller.warm(OWNER);
 assert.ok(await db.get(appMessageKey(OWNER,'a1')));assert.equal(await db.get('shelved'),undefined);
 await assertDropped(db,controller,'old',{refs:[`messages/${OWNER}/old`,`messages/${OWNER}/old/presentations/p1`]});
 await assertDropped(db,controller,'bad',{refs:[]});
 assert.deepEqual(await garbage(db),[`messages/${OWNER}/old`,`messages/${OWNER}/old/presentations/p1`].sort());
});

test('review L1: the BB-CUT reset never touches contact-link families (the contacts phase 4 reset owns them)',async t=>{
 const {db}=account(t);await db.put('owner',OWNER);await seed(db);for(const [k,v]of LINK_ROWS)await db.put(k,v);
 assert.equal((await resetLegacyMessaging(db,{limit:3})).done,false);
 await db.put('contact-sharing/j2',{profileFields:['displayName'],updatedAt:2});
 while(!(await resetLegacyMessaging(db,{limit:3})).done);
 assert.deepEqual(await db.get('contact-sharing/j2'),{profileFields:['displayName'],updatedAt:2});for(const [k,v]of LINK_ROWS)assert.deepEqual(await db.get(k),v,k);
 for(const prefix of ['contact-sharing/','link-audience/','link-gc-cursor/'])assert.ok(!MESSAGING_RESET_PREFIXES.some(p=>p.startsWith(prefix)||prefix.startsWith(p)),prefix);
});

test('review L3: a legacy-only beam/profile is copied to profile before beam/ is deleted; an existing profile wins',async t=>{
 const {db,controller}=account(t);await db.put('owner',OWNER);
 await db.put('beam/profile',{displayName:'Legacy name',bio:'Old bio',avatar:'https://avatars.example/a.png',discloseToContacts:true,updatedAt:5,extra:'dropped'});
 await controller.warm(OWNER);
 assert.equal(await db.get('beam/profile'),undefined);
 // The contacts phase 4 reset (also run by warm) then strips the retired bio and discloseToContacts members.
 assert.deepEqual(await db.get('profile'),{displayName:'Legacy name',avatar:'https://avatars.example/a.png',owner:OWNER,updatedAt:5});
 assert.equal((await controller.accountProfile(OWNER)).displayName,'Legacy name');
 const other=account(t);await other.db.put('owner',OWNER);await other.db.put('profile',{displayName:'Current',bio:'',avatar:'',discloseToContacts:false});await other.db.put('beam/profile',{displayName:'Legacy',bio:'',avatar:'http://insecure.example',discloseToContacts:true});
 await other.controller.warm(OWNER);assert.equal((await other.db.get('profile')).displayName,'Current');
});

test('review L2: corrupt legacy rows never wedge the reset, and a failing reset never stops the other alarm maintenance',async t=>{
 const {db,blobs,controller}=account(t);await db.put('owner',OWNER);await db.put('item-index-ready',true);
 // An id too long for a search document, a missing id, a non-object row and a foreign blob ref.
 await db.put(key('message',OWNER,'long'),{id:'x'.repeat(400),owner:OWNER,blobRef:`messages/${OWNER}/long`});
 await db.put(key('message',OWNER,'noid'),{owner:OWNER});await db.put(key('message',OWNER,'str'),'corrupt');
 await db.put(key('message',OWNER,'foreign'),{id:'foreign',owner:OWNER,blobRef:'messages/other/foreign'});
 for(let i=0;i<4&&await db.get(MESSAGING_RESET_MARKER)===undefined;i++)await controller.alarmMaintenance();
 assert.ok(await db.get(MESSAGING_RESET_MARKER),'the reset completes over corrupt rows');
 assert.deepEqual(await remaining(db),[]);assert.ok(!(await garbage(db)).includes('messages/other/foreign'));
 // A reset slice that throws on every pass: blob garbage is still collected by the same alarm.
 await db.delete(MESSAGING_RESET_MARKER);await db.put(key('message',OWNER,'poison'),{id:'poison',owner:OWNER});
 controller.resetLegacyMessaging=async()=>{throw new Error('poison slice');};
 await blobs.put(`messages/${OWNER}/orphan`,'x');await db.put('blob-garbage/orphan',`messages/${OWNER}/orphan`);
 await controller.alarmMaintenance();
 assert.equal(await db.get('blob-garbage/orphan'),undefined,'garbage collection ran after the failed slice');assert.equal(blobs.objects.has(`messages/${OWNER}/orphan`),false);
 assert.equal(await db.get('maintenance/alarm-retry'),undefined,'the failure did not enter the maintenance retry backoff');
});

test('removed legacy routes answer like any unknown path and never reach an account (contact paths are not special since contacts phase 4)',async()=>{
 let calls=0;const env={APP_ORIGIN:ORIGIN,ABUSE_HASH_KEY:'k',ABUSE:{consume:async()=>true},IDENTITY_REPOSITORY:{get:async()=>{calls++;return {status:'active',handle:'person'};}},ACCOUNTS:{get:()=>({invoke:async()=>{calls++;return {};}})}};
 const link=`${ORIGIN}/users/person/contact/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee?bindle_meta=a.b.c`;
 const send=(url,init)=>application.fetch(new Request(url,init),env);
 const control=link.replace('/contact/','/not-a-route/');
 for(const accept of ['application/json','application/vnd.bindle.contact-intake+json','application/vnd.bindle.contact-token+jwt','application/vnd.bindle.contact-profile+json','text/plain'])assert.equal((await send(link,{headers:{Accept:accept}})).status,(await send(control,{headers:{Accept:accept}})).status,accept);
 const init=()=>({method:'POST',body:'x',headers:{'Content-Type':'multipart/form-data; boundary=x'}});assert.equal((await send(link,init())).status,(await send(control,init())).status);
 assert.equal((await send(link+'&bindle_data=a.b.c',{headers:{Accept:'application/json'}})).status,(await send(control+'&bindle_data=a.b.c',{headers:{Accept:'application/json'}})).status);
 assert.equal(calls,0,'no identity lookup or account call');
});

test('the email bridge is struck: no public-intake fragment or artefact, no provider feature for it, Parlay claims only the mailbox contract',async()=>{
 const PUBLIC_INTAKE_FRAGMENT='https://spec.bindle.example/fragments/public-intake/v1',PUBLIC_INTAKE_CONTRACT='https://spec.bindle.example/contracts/public-intake/v1',MAILBOX='https://spec.bindle.example/messaging/v1/contracts/mailbox';
 await assert.rejects(readFile(new URL('../docs/artefacts/fragments/public-intake-v1.json',import.meta.url)),e=>e.code==='ENOENT','the artefact was withdrawn');
 assert.deepEqual(Object.keys(RECOGNIZED_FIELDS),[MESSAGING_INGRESS_FRAGMENT]);assert.equal(RECOGNIZED_FIELDS[PUBLIC_INTAKE_FRAGMENT],undefined);
 // Review M2 (carried over to the remaining field): provider-only (extensions §11.1); an application can never request it.
 const field=RECOGNIZED_FIELDS[MESSAGING_INGRESS_FRAGMENT].fields.mailbox;assert.equal(fragmentOutcome(RECOGNIZED_FIELDS[MESSAGING_INGRESS_FRAGMENT]).status,'valid');
 assert.deepEqual(field.consumers,['provider']);assert.equal(field.selection,'exclusive');assert.equal(field.announce,true);assert.equal(consumes(field,'application'),false);
 assert.deepEqual(Object.keys(FEATURE_DEFINITIONS),[EXT.messagingMailbox]);assert.deepEqual(Object.keys(PROVIDER_EXT),[]);
 assert.equal(FEATURE_DEFINITIONS['https://3sln.me/extensions/email-bridge/v1'],undefined);
 assert.ok(RETIRED_FLAGS.EMAIL_BRIDGE_ENABLED);assert.equal(FLAGS.EMAIL_BRIDGE_ENABLED,undefined);
 const manifest=JSON.parse(await readFile(new URL('../apps/parlay/integration.json',import.meta.url)));
 assert.equal(manifest.extensions,undefined);assert.deepEqual(manifest.resources.contracts,[MAILBOX]);assert.ok(!manifest.resources.contracts.includes(PUBLIC_INTAKE_CONTRACT));
 const r=validateIntegrationManifest({...manifest,extensions:[{slot:'https://spec.bindle.example/slots/public-message-intake/v1',role:'occupant',ref:'mailbox'}]},{clientId:'https://messages.example/bindle/client.json',confidential:true,redirectUris:['https://messages.example/bindle/callback'],jwksUri:'https://messages.example/bindle/jwks.json'});
 assert.equal(r.status,'valid');assert.equal(r.manifest.extensions,undefined,'an `extensions` member in an integration manifest is ignored');
});

test('Parlay env rename: PARLAY_* wins; an unset PARLAY_* reads the retired BINDLEBOX_* value; the core alias stays retired',()=>{
 // Review L3 (2026-10-28): the switch has no alias; BINDLEBOX_ENABLED is retired, so it never turns Parlay on.
 assert.equal(PARLAY_ENV_NAMES.includes('ENABLED'),false);assert.equal(PARLAY_ENV_NAMES[0],'SERVICES');
 assert.equal(parlayEnv({BINDLEBOX_ENABLED:'true'}).PARLAY_ENABLED,undefined);
 assert.equal(parlayEnv({BINDLEBOX_ENABLED:'true',PARLAY_ENABLED:'false'}).PARLAY_ENABLED,'false');
 assert.equal(parlayEnv({BINDLEBOX_KEY_ENCRYPTION_KEY:'k',PARLAY_KEY_ENCRYPTION_KEY:'n'}).PARLAY_KEY_ENCRYPTION_KEY,'n','the new name wins');
 assert.equal(parlayEnv({}).PARLAY_ENABLED,undefined);
 const binding={get(){}},env=parlayEnv({LINK_INDEX:binding,BINDLEBOX_SERVICES:binding});assert.equal(env.LINK_INDEX,binding);assert.equal(env.PARLAY_SERVICES,binding,'bindings pass through');
 // Core: BINDLEBOX_ENABLED stays retired, and LINKS_ENABLED (its rename) was retired by contacts phase 4; no core flag is
 // named for the app and none reads either old name.
 assert.ok(RETIRED_FLAGS.BINDLEBOX_ENABLED&&RETIRED_FLAGS.LINKS_ENABLED);assert.equal(FLAGS.LINKS_ENABLED,undefined);assert.equal(FLAGS.PARLAY_ENABLED,undefined);
});
