// The contact profile and per-link profile sharing (packages/links/contact-profile.mjs) on the type-neutral contact
// parent (packages/links/parents.mjs, the LinkService `link/<jti>` record), after messaging left the core (DEVLOG
// 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset"). Saved contacts and redemption bindings moved
// with the messaging app (SQ-2, provisional); the Beam-era dual write and `beam-retired-v1` were removed. Engine level
// over the real SQLite adapter and AccountController, plus a seeded chaos run (CHAOS_SEED replays a seed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {collectLinkState} from '../packages/links/audience.mjs';
import {ContactProfiles,CONTACT_KEYS} from '../packages/links/contact-profile.mjs';
import {liveParent,parentView,contactParents,LINK_RECORD_CAP} from '../packages/links/parents.mjs';
import {exportInventory,createExportContributors} from '../packages/runtime/export-contributors.mjs';
import {key} from '../packages/core/records.mjs';
import {routeMethods} from '../packages/runtime/routes/index.mjs';
import {admission} from '../packages/runtime/routes/contact-profile.mjs';
import {createsContentOrGrant} from '../packages/identity/age-policy.mjs';
import {linkService} from '../packages/runtime/account/links.mjs';
import {MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='dddddddd-dddd-4ddd-8ddd-dddddddddddd',GRANT='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ORIGIN='https://provider.example';
function store(t){const db=new SqliteMetadata(':memory:');t.after(()=>db.close());return db;}
// A parent record in the LinkService shape (only the members contact-profile and parents.mjs read).
const parentRow=(jti=GRANT,extra={})=>({version:1,jti,owner:OWNER,type:MESSAGING_CONTACT_LINK_TYPE,slot:'s',claims:{aud:`${ORIGIN}/users/person/contact/${jti}`,exp:Math.floor(Date.now()/1000)+3600},revoked:false,issuedAt:Date.now(),issuer:{kind:'owner'},...extra});
const service=(db,links={verify:async()=>{throw Object.assign(new Error('x'),{code:'link_invalid'});}})=>new ContactProfiles({metadata:db,links});
async function seed(db){await db.put('profile',{owner:OWNER,displayName:'Legacy name',bio:'Legacy bio',avatar:'',discloseToContacts:true});await db.put(key('link',GRANT),parentRow());}
async function controller(t){
 const db=store(t),c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 await c.touch(OWNER);c.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});
 const issue=(ttl=3600000)=>linkService(c).issue(OWNER,{type:MESSAGING_CONTACT_LINK_TYPE,claims:{resource:'contact',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:4096,maxMessageBytes:1024},expiresAt:Date.now()+ttl,handle:'person'});
 return {db,c,issue};
}

test('routes: profile and sharing are mounted; redemption, saved-contact and Beam routes are gone',()=>{
 assert.deepEqual(routeMethods('/api/profile'),['GET','PUT']);assert.deepEqual(routeMethods('/api/contacts/11111111-1111-4111-8111-111111111111/sharing'),['PUT']);
 for(const path of ['/api/contacts/redeem','/api/contacts/directory','/api/contacts/directory/11111111-1111-4111-8111-111111111111','/api/contacts/profile/11111111-1111-4111-8111-111111111111','/api/contacts','/api/contact-links','/api/contacts/11111111-1111-4111-8111-111111111111','/api/contacts/11111111-1111-4111-8111-111111111111/intake','/api/links/envelope','/api/beams/status'])assert.equal(routeMethods(path),null,path);
});

test('contact parents: a live, unrevoked link record of this owner; the cap is the link-record cap',async t=>{
 const now=Date.now();
 assert.equal(liveParent(parentRow(),OWNER,now),true);
 for(const row of [parentRow(GRANT,{revoked:true}),parentRow(GRANT,{owner:OTHER}),parentRow(GRANT,{claims:{exp:Math.floor(now/1000)-1}}),null])assert.equal(liveParent(row,OWNER,now),false);
 assert.equal(LINK_RECORD_CAP,1000);
 assert.deepEqual(parentView(parentRow(),now),{id:GRANT,type:MESSAGING_CONTACT_LINK_TYPE,slot:'s',active:true,createdAt:parentRow().issuedAt,expiresAt:parentRow().claims.exp*1000,conditional:false,issuer:{kind:'owner'}});
 const db=store(t);await db.put(key('link',GRANT),parentRow());await db.put(key('link',OTHER),parentRow(OTHER,{owner:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}));
 assert.deepEqual((await contactParents(o=>db.list(o),OWNER,now)).map(p=>p.id),[GRANT],'another owner\'s records never list');
});

test('sharing binds only to a live parent of this owner; revocation and expiry close it; a body with both keys is refused (R3)',async t=>{
 const db=store(t),contacts=service(db);await seed(db);
 assert.deepEqual(await contacts.sharing(OWNER,GRANT,{profileFields:['displayName']}),{id:GRANT,profileFields:['displayName'],discloseProfile:true});
 await assert.rejects(contacts.sharing(OWNER,OTHER,{discloseProfile:true}),{code:'contact_not_found',status:404});
 await db.put(key('link',OTHER),parentRow(OTHER,{owner:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}));await assert.rejects(contacts.sharing(OWNER,OTHER,{discloseProfile:true}),{code:'contact_not_found'});
 await db.put(key('link',GRANT),parentRow(GRANT,{revoked:true}));await assert.rejects(contacts.sharing(OWNER,GRANT,{discloseProfile:true}),{code:'contact_not_found'});
 await db.put(key('link',GRANT),parentRow(GRANT,{claims:{aud:'x',exp:1}}));await assert.rejects(contacts.sharing(OWNER,GRANT,{discloseProfile:true}),{code:'contact_not_found'});
 await db.put(key('link',GRANT),parentRow());const path='/api/contacts/'+GRANT+'/sharing',both={discloseProfile:false,profileFields:['displayName','bio','avatar']};
 await assert.rejects(contacts.sharing(OWNER,GRANT,both),{code:'contact_sharing_invalid'});
 const rule=admission.protective.find(r=>r.match(path,'PUT'));
 for(const [body,protective] of [[both,false],[{discloseProfile:false},true],[{profileFields:[]},true],[{discloseProfile:true},false],[{profileFields:['bio']},false],[{discloseProfile:false,profileFields:[]},false],[{},false],[{profileFields:'x'},false]]){
  assert.equal(rule.test(body),protective,JSON.stringify(body));assert.equal(createsContentOrGrant(path,'PUT',body),!protective,'terms '+JSON.stringify(body));
 }
});

test('public profile: only a verified live link of this owner, only the fields it shares, only while the master switch is on',async t=>{
 const {c,issue}=await controller(t),link=await issue();
 await c.accountProfile(OWNER,{displayName:'Shared name',bio:'Private bio',avatar:'https://image.example/a.png',discloseToContacts:true});
 assert.deepEqual(await c.contactProfile(OWNER,link.link),{identityURI:`${ORIGIN}/users/person`,profile:null},'no sharing row: nothing disclosed');
 await c.contactSharing(OWNER,link.jti,{profileFields:['displayName','avatar']});
 assert.deepEqual((await c.contactProfile(OWNER,link.link)).profile,{displayName:'Shared name',avatar:'https://image.example/a.png'});
 await c.accountProfile(OWNER,{displayName:'Shared name',bio:'Private bio',avatar:'https://image.example/a.png',discloseToContacts:false});
 assert.equal((await c.contactProfile(OWNER,link.link)).profile,null,'the master switch withdraws every link');
 await assert.rejects(c.contactProfile(OTHER,link.link),{code:'unauthorized'});
 await linkService(c).revoke(OWNER,link.jti);await assert.rejects(c.contactProfile(OWNER,link.link),{code:'unauthorized'});
 // The snapshot's contact list is the owner's parents with their sharing (the RTC owner routes read it too).
 const listed=await c.contacts(OWNER);assert.deepEqual(listed.map(p=>[p.id,p.active,p.profileFields]),[[link.jti,false,['displayName','avatar']]]);
});

test('export inventory: the profile and per-link sharing export once; legacy contact and Beam families are gone',async t=>{
 assert.equal(exportInventory(['profile'])[0].contributor,'profile');assert.equal(exportInventory(['contact-sharing/x'])[0].contributor,'contact-sharing');
 assert.deepEqual(exportInventory(['profiles'])[0],{prefix:'profiles'},'the profile singleton matches exactly (R4)');
 for(const prefix of ['contact-grant/x','beam/profile','beam/directory/x','saved-contact/x','contact-redeemed/x','conversation/room/x','message/x'])assert.equal(exportInventory([prefix])[0].contributor,undefined,prefix);
 const db=store(t),contacts=service(db);await seed(db);await contacts.profile(OWNER,{displayName:'Exported',bio:'',avatar:'',discloseToContacts:true});await contacts.sharing(OWNER,GRANT,{profileFields:['bio']});
 const read=async name=>{const contributor=createExportContributors({accountStore:db}).find(v=>v.name===name);let cursor=null;const out=[];do{const page=await contributor.page({owner:OWNER,cursor,limit:10});out.push(...page.rows.map(r=>r.record));cursor=page.cursor;}while(cursor);return out;};
 const profile=await read('profile');assert.equal(profile.length,1);assert.equal(profile[0].displayName,'Exported');
 assert.deepEqual(await read('contact-sharing'),[{id:GRANT,profileFields:['bio']}]);
});

test('link-state maintenance collects sharing rows whose parent LinkService reclaimed, and keeps live ones',async t=>{
 const {db,c,issue}=await controller(t),live=await issue(),gone=await issue();
 await c.contactSharing(OWNER,live.jti,{profileFields:['displayName']});await c.contactSharing(OWNER,gone.jti,{profileFields:['bio']});
 await db.delete(key('link',gone.jti));await db.put(CONTACT_KEYS.sharing+OTHER,{profileFields:['bio']});
 await collectLinkState(c,OWNER);
 assert.deepEqual([...(await db.list({prefix:CONTACT_KEYS.sharing})).keys()],[CONTACT_KEYS.sharing+live.jti]);
});

test('seeded chaos: sharing changes racing revocation and profile writes never disclose through a revoked parent',async t=>{
 await forEachSeed(6,async random=>{
  const {c,issue}=await controller(t),links=[await issue(),await issue(),await issue()],revoked=new Set();
  await c.accountProfile(OWNER,{displayName:'Name',bio:'Bio',avatar:'',discloseToContacts:true});
  const scheduler=createScheduler(random),ports=scheduler.wrap({
   share:i=>c.contactSharing(OWNER,links[i].jti,{profileFields:random.chance(0.5)?['displayName']:['bio']}),
   revoke:i=>{revoked.add(links[i].jti);return linkService(c).revoke(OWNER,links[i].jti);},
   profile:()=>c.accountProfile(OWNER,{displayName:'Name '+random.int(9),bio:'Bio',avatar:'',discloseToContacts:random.chance(0.8)}),
  },'account');
  const work=random.shuffle([()=>ports.share(0),()=>ports.share(1),()=>ports.share(2),()=>ports.revoke(random.int(3)),()=>ports.profile(),()=>ports.share(random.int(3))]);
  const results=await scheduler.run(work);
  for(const result of results)if(result.status==='rejected')assert.equal(result.reason?.code,'contact_not_found',`${result.reason?.code} ${scheduler.trace.join(' | ')}`);
  for(const link of links){
   if(revoked.has(link.jti))await assert.rejects(c.contactProfile(OWNER,link.link),{code:'unauthorized'});
   else{const shared=(await c.contactProfile(OWNER,link.link)).profile,profile=await c.accountProfile(OWNER);if(shared)assert.ok(profile.discloseToContacts&&Object.entries(shared).every(([field,value])=>profile[field]===value));}
  }
 });
});

test('bug hunt F1: expectedRevision guards profile saves against stale and concurrent writes',async t=>{
 const db=store(t),contacts=service(db);await seed(db);
 const loaded=await contacts.profile(OWNER),edit={displayName:'Edited',bio:'Legacy bio',avatar:'',discloseToContacts:true};
 // Another session saves first; the save that still names the old revision is refused and changes nothing.
 const other=await contacts.profile(OWNER,{...edit,displayName:'Other session',expectedRevision:loaded.revision});assert.equal(other.displayName,'Other session');assert.notEqual(other.revision,loaded.revision);
 await assert.rejects(contacts.profile(OWNER,{...edit,expectedRevision:loaded.revision}),{code:'profile_stale',status:409});
 assert.equal((await contacts.profile(OWNER)).displayName,'Other session');
 // A write that lands between the revision check and the transaction is caught inside the transaction.
 const current=await contacts.profile(OWNER),transaction=db.transaction.bind(db);let raced=false;
 db.transaction=async fn=>{if(!raced){raced=true;await transaction(tx=>tx.put('profile',{owner:OWNER,displayName:'Raced',bio:'',avatar:'',discloseToContacts:false}));}return transaction(fn);};
 await assert.rejects(contacts.profile(OWNER,{...edit,expectedRevision:current.revision}),{code:'profile_stale'});db.transaction=transaction;
 assert.equal((await contacts.profile(OWNER)).displayName,'Raced');
 // Without expectedRevision the save is unconditional (existing clients); malformed revisions are refused.
 assert.equal((await contacts.profile(OWNER,edit)).displayName,'Edited');
 for(const expectedRevision of ['',1,'x'.repeat(32),null])await assert.rejects(contacts.profile(OWNER,{...edit,expectedRevision}),{code:'profile_invalid'});
});

test('bug hunt F1 review: a stale tab withdrawing disclosure applies only the withdrawal',async t=>{
 const db=store(t),contacts=service(db);await seed(db);
 const stale=await contacts.profile(OWNER,{displayName:'Old',bio:'Old bio',avatar:'',discloseToContacts:true});
 await contacts.profile(OWNER,{displayName:'Newer',bio:'Newer bio',avatar:'',discloseToContacts:true,expectedRevision:stale.revision});
 // Withdrawal from the stale tab lands, but the stale tab's other fields do not overwrite the newer ones.
 const after=await contacts.profile(OWNER,{displayName:'Old',bio:'Old bio',avatar:'',discloseToContacts:false,expectedRevision:stale.revision});
 assert.equal(after.discloseToContacts,false);assert.equal(after.displayName,'Newer');assert.equal(after.bio,'Newer bio');
 // A stale save that keeps disclosure on is still refused.
 await assert.rejects(contacts.profile(OWNER,{displayName:'Old',bio:'Old bio',avatar:'',discloseToContacts:true,expectedRevision:stale.revision}),{code:'profile_stale'});
 // Withdrawal racing a write inside the transaction also applies only the withdrawal.
 const current=await contacts.profile(OWNER),transaction=db.transaction.bind(db);let raced=false;
 await contacts.profile(OWNER,{displayName:'Newer',bio:'Newer bio',avatar:'',discloseToContacts:true});const fresh=await contacts.profile(OWNER);
 db.transaction=async fn=>{if(!raced){raced=true;await transaction(tx=>tx.put('profile',{owner:OWNER,displayName:'Raced',bio:'',avatar:'',discloseToContacts:true}));}return transaction(fn);};
 const raced1=await contacts.profile(OWNER,{displayName:'Newer',bio:'Newer bio',avatar:'',discloseToContacts:false,expectedRevision:fresh.revision});db.transaction=transaction;
 assert.equal(raced1.discloseToContacts,false);assert.equal(raced1.displayName,'Raced');void current;
});

test('bug hunt round 3 B1: a stale save with sharing already off is refused, not treated as a withdrawal',async t=>{
 const db=store(t),contacts=service(db);await seed(db);
 const loaded=await contacts.profile(OWNER,{displayName:'Loaded',bio:'',avatar:'',discloseToContacts:false});
 await contacts.profile(OWNER,{displayName:'Other tab',bio:'',avatar:'',discloseToContacts:false,expectedRevision:loaded.revision});
 // The switch was off in the stale tab and is still off: nothing to withdraw, so the edits must not be dropped silently.
 await assert.rejects(contacts.profile(OWNER,{displayName:'Stale tab',bio:'',avatar:'',discloseToContacts:false,expectedRevision:loaded.revision}),{code:'profile_stale',status:409});
 assert.equal((await contacts.profile(OWNER)).displayName,'Other tab');
 // Inside the transaction too: a write that withdrew sharing first leaves nothing for the stale withdrawal to apply.
 await contacts.profile(OWNER,{displayName:'Shared',bio:'',avatar:'',discloseToContacts:true});const fresh=await contacts.profile(OWNER),transaction=db.transaction.bind(db);let raced=false;
 db.transaction=async fn=>{if(!raced){raced=true;await transaction(tx=>tx.put('profile',{owner:OWNER,displayName:'Raced off',bio:'',avatar:'',discloseToContacts:false}));}return transaction(fn);};
 await assert.rejects(contacts.profile(OWNER,{displayName:'Mine',bio:'',avatar:'',discloseToContacts:false,expectedRevision:fresh.revision}),{code:'profile_stale'});db.transaction=transaction;
 assert.equal((await contacts.profile(OWNER)).displayName,'Raced off');
});
