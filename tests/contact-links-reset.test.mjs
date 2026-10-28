// Contacts phase 4 reset `contact-links-retired-v1` (packages/runtime/contact-links-reset.mjs; rethink rev 2 §9;
// provisional, unsigned) and the reduced profile slice (packages/runtime/account/profile.mjs, CR-C4). Over the real SQLite
// adapter and AccountController: bounded slices, idempotency, the prescribed deletion order with the marker last, the
// keep list, the export inventory, the warm and alarm hooks, and a seeded chaos run interleaving reset slices with
// profile saves and writes to kept families (CHAOS_SEED=<seed> replays one).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {resetContactLinks,CONTACT_LINKS_RESET_MARKER,CONTACT_LINKS_RESET_STEPS,CONTACT_LINKS_RESET_PREFIXES} from '../packages/runtime/contact-links-reset.mjs';
import {exportInventory,createExportContributors,EXPORT_CLAIMED_PREFIXES} from '../packages/runtime/export-contributors.mjs';
import {key} from '../packages/core/records.mjs';
import {forEachSeed,createScheduler} from './helpers/chaos.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ORIGIN='https://provider.example',JTI='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function store(t){const db=new SqliteMetadata(':memory:');t.after(()=>db.close());return db;}
// Rows of every retired family, several per prefix so slices must page.
async function seedRetired(db,{per=3}={}){
 for(const prefix of CONTACT_LINKS_RESET_PREFIXES)for(let i=0;i<per;i++)await db.put(`${prefix}${OWNER}/${i}`,{owner:OWNER,i});
 await db.put(key('link',JTI),{version:1,jti:JTI,owner:OWNER,header:{kid:'k1'},claims:{exp:Math.floor(Date.now()/1000)+3600}});
 await db.put('developer-contact/occupant-v1',{version:1,jti:JTI,sealed:'opaque'});
 await db.put('profile',{owner:OWNER,displayName:'Legacy name',bio:'Legacy bio',avatar:'https://img.example/a.png',discloseToContacts:true,updatedAt:1});
}
// Families the reset must keep (identity keys despite the name, delegations, org and relation invitations, look-alikes).
const KEPT=Object.freeze({
 'owner':OWNER,'contact-key/k1':{kid:'k1',publicJwk:{}},'signing-key':'k1',[key('key-delegation',OWNER,'jkt')]:{owner:OWNER},
 // Real key shapes (packages/orgs/roster.mjs ORG_KEYS, packages/orgs/relation-keys.mjs K), review L4.
 'org/invitation/11111111-1111-4111-8111-111111111111':{state:'pending'},'org/invitation-open/11111111-1111-4111-8111-111111111111':{open:true},
 'rel/inv/22222222-2222-4222-8222-222222222222':{state:'open'},'rel/inv-by/p-key/22222222-2222-4222-8222-222222222222':{x:1},'rel/inv-open/i-key/22222222-2222-4222-8222-222222222222':{x:1},
 'rel/inv-due/0000001800000000/22222222-2222-4222-8222-222222222222':{x:1},'rel/inv-done/0000001700000000/33333333-3333-4333-8333-333333333333':{x:1},
 'linked/approval':{x:1},'link':{exact:true},'links':{exact:true},'contact-sharing':{exact:true},'migration/messaging-retired-v1':{version:1},
});
async function seedKept(db){for(const [path,value]of Object.entries(KEPT))await db.put(path,value);}
async function remaining(db){const out=[];for(const prefix of CONTACT_LINKS_RESET_PREFIXES)for(const k of (await db.list({prefix})).keys())out.push(k);return out;}
async function drain(db,limit){let slices=0,result;do{result=await resetContactLinks(db,{limit});slices++;assert.ok(result.deleted<=limit,`slice deleted ${result.deleted} > ${limit}`);assert.ok(slices<1000,'the reset terminates');}while(!result.done);return slices;}
async function assertKept(db){for(const [path,value]of Object.entries(KEPT))assert.deepEqual(await db.get(path),value,path);}

test('steps: the §9 order, link/ last among the data, the profile strip between, every prefix slash-terminated',async()=>{
 assert.deepEqual(CONTACT_LINKS_RESET_STEPS.map(s=>s.prefix??'strip:'+s.strip),['link-evaluations/','link-audience/','link-replay/','link-gc-cursor/','links-rpc/','link-change/','link-state/','contact-sharing/','rtc/contact/','developer-contact/','strip:profile','link/']);
 assert.deepEqual(CONTACT_LINKS_RESET_STEPS.find(s=>s.strip).members,['bio','discloseToContacts']);
 for(const prefix of CONTACT_LINKS_RESET_PREFIXES)assert.ok(prefix.endsWith('/'),prefix);
 assert.ok(Object.isFrozen(CONTACT_LINKS_RESET_STEPS));await assert.rejects(resetContactLinks(new Map(),{limit:0}),TypeError);
});

test('bounded slices: no slice exceeds its limit; it completes, keeps the keep list and strips only the retired profile members',async t=>{
 for(const limit of [1,2,5,64,1000]){
  const db=store(t);await seedRetired(db);await seedKept(db);
  const slices=await drain(db,limit);if(limit===1)assert.ok(slices>CONTACT_LINKS_RESET_PREFIXES.length*3,'small limits really page');
  assert.deepEqual(await remaining(db),[]);await assertKept(db);
  const profile=await db.get('profile');assert.deepEqual({displayName:profile.displayName,avatar:profile.avatar,owner:profile.owner,updatedAt:profile.updatedAt},{displayName:'Legacy name',avatar:'https://img.example/a.png',owner:OWNER,updatedAt:1});
  assert.equal(Object.hasOwn(profile,'bio'),false);assert.equal(Object.hasOwn(profile,'discloseToContacts'),false);
  assert.equal((await db.get(CONTACT_LINKS_RESET_MARKER)).version,1);
 }
});

test('idempotent: after the marker nothing runs; without it a rerun over clean data only rewrites the marker',async t=>{
 const db=store(t);await seedRetired(db);await seedKept(db);await drain(db,7);
 assert.deepEqual(await resetContactLinks(db),{done:true,deleted:0});
 // A row appearing after completion is not touched while the marker exists (no code writes these families any more).
 await db.put('link/late',{x:1});assert.deepEqual(await resetContactLinks(db),{done:true,deleted:0});assert.deepEqual(await db.get('link/late'),{x:1});
 await db.delete('link/late');await db.delete(CONTACT_LINKS_RESET_MARKER);const before=await db.get('profile');
 assert.deepEqual(await resetContactLinks(db),{done:true,deleted:0});assert.deepEqual(await db.get('profile'),before,'a stripped profile is not rewritten');await assertKept(db);
 // An empty account (no profile row at all) completes at once.
 const empty=store(t);assert.deepEqual(await resetContactLinks(empty),{done:true,deleted:0});assert.equal(await empty.get('profile'),undefined);
});

test('order: no later step deletes while an earlier prefix has rows, the strip follows step 2, link/ goes last and the marker after everything',async t=>{
 for(const limit of [1,3,64]){
  const db=store(t);await seedRetired(db);await seedKept(db);const events=[];
  const recorder=new Proxy(db,{get(target,prop){
   if(prop==='put')return async(k,v)=>{if(k===CONTACT_LINKS_RESET_MARKER){assert.deepEqual(await remaining(target),[],'marker before the last delete');assert.equal(Object.hasOwn(await target.get('profile'),'bio'),false,'marker before the strip');}events.push(['put',k]);return target.put(k,v);};
   if(prop==='transaction')return fn=>target.transaction(tx=>fn(new Proxy(tx,{get(inner,name){
    if(name==='delete')return async keys=>{for(const k of [].concat(keys))events.push(['delete',k]);return inner.delete(keys);};
    if(name==='put')return async(k,v)=>{events.push(['put',k]);return inner.put(k,v);};
    const value=Reflect.get(inner,name);return typeof value==='function'?value.bind(inner):value;}})));
   const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
  await drain(recorder,limit);
  const stepOf=k=>{const i=CONTACT_LINKS_RESET_STEPS.findIndex(s=>s.prefix?k.startsWith(s.prefix):k===s.strip);assert.ok(i>=0,'unexpected write '+k);return i;};
  const order=events.filter(([op,k])=>k!==CONTACT_LINKS_RESET_MARKER&&(op==='delete'||k==='profile')).map(([,k])=>stepOf(k));
  for(let i=1;i<order.length;i++)assert.ok(order[i]>=order[i-1],`step ${order[i]} after step ${order[i-1]} (limit ${limit})`);
  assert.deepEqual(events.at(-1),['put',CONTACT_LINKS_RESET_MARKER]);assert.equal(events.filter(([,k])=>k===CONTACT_LINKS_RESET_MARKER).length,1);
  assert.equal(events.filter(([op,k])=>op==='put'&&k==='profile').length,1,'one profile strip');
 }
});

test('export: retired families are excluded as retired, never claimed; the profile exports only displayName and avatar',async t=>{
 for(const prefix of [...CONTACT_LINKS_RESET_PREFIXES.filter(p=>p!=='rtc/contact/'),'link/x','contact-sharing/x','developer-contact/occupant-v1']){
  const [row]=exportInventory([prefix]);assert.equal(row.contributor,undefined,prefix);assert.match(row.reason,/^Retired: contact-link rows pending the contact-links-retired-v1 reset/,prefix);
 }
 assert.match(exportInventory(['rtc/contact/x'])[0].reason,/^Retired/);
 for(const name of ['links','contact-sharing'])assert.equal(Object.values(EXPORT_CLAIMED_PREFIXES).includes(name),false,name);
 assert.equal(EXPORT_CLAIMED_PREFIXES.profile,'profile');assert.equal(exportInventory([CONTACT_LINKS_RESET_MARKER])[0].reason.startsWith('Derived: storage migration markers'),true);
 const db=store(t);await seedRetired(db);
 const contributors=createExportContributors({accountStore:db}),profile=contributors.find(c=>c.name==='profile');
 assert.equal(contributors.some(c=>['links','contact-sharing'].includes(c.name)),false);
 const page=await profile.page({owner:OWNER,limit:10});assert.deepEqual(page.rows.map(r=>Object.keys(r.record).sort()),[['avatar','displayName','owner','updatedAt']]);
});

async function controller(t){
 const db=store(t),c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 return {db,c};
}

test('AccountController: warm runs the reset to completion for a small account, the alarm continues a large one, and the profile slice reads only kept members',async t=>{
 {const {db,c}=await controller(t);await db.put('owner',OWNER);await seedRetired(db);await seedKept(db);
  await c.touch(OWNER);assert.equal((await db.get(CONTACT_LINKS_RESET_MARKER)).version,1,'warm completed the reset');assert.deepEqual(await remaining(db),[]);await assertKept(db);
  assert.deepEqual(await c.accountProfile(OWNER),{displayName:'Legacy name',avatar:'https://img.example/a.png',revision:(await c.accountProfile(OWNER)).revision});}
 {const {db,c}=await controller(t);await db.put('owner',OWNER);for(let i=0;i<600;i++)await db.put(`link-audience/${OWNER}/${String(i).padStart(4,'0')}`,{i});await db.put(key('link',JTI),{owner:OWNER});
  await c.touch(OWNER);assert.equal(await db.get(CONTACT_LINKS_RESET_MARKER),undefined,'one bounded slice per warm');assert.ok((await db.list({prefix:'link-audience/'})).size<600);assert.ok(await db.get(key('link',JTI)),'link/ stays until the earlier families are gone');
  for(let i=0;i<5&&await db.get(CONTACT_LINKS_RESET_MARKER)===undefined;i++)await c.alarmMaintenance();
  assert.ok(await db.get(CONTACT_LINKS_RESET_MARKER),'the alarm path finishes it');assert.deepEqual(await remaining(db),[]);}
});

test('profile slice: exact members, HTTPS avatars, expectedRevision fences stale and concurrent saves',async t=>{
 const {db,c}=await controller(t);await db.put('owner',OWNER);await c.touch(OWNER);
 const first=await c.accountProfile(OWNER);assert.deepEqual({displayName:first.displayName,avatar:first.avatar},{displayName:'',avatar:''});
 for(const bad of [{displayName:'A',avatar:'',bio:''},{displayName:'A',avatar:'',discloseToContacts:false},{displayName:'A'},{displayName:'A\u0007',avatar:''},{displayName:'A',avatar:'http://img.example/a'},{displayName:'A',avatar:'',expectedRevision:'x'},null,[]])
  await assert.rejects(c.accountProfile(OWNER,bad),{code:'profile_invalid'},JSON.stringify(bad));
 const saved=await c.accountProfile(OWNER,{displayName:'Ann',avatar:'https://img.example/ann.png',expectedRevision:first.revision});assert.equal(saved.displayName,'Ann');
 await assert.rejects(c.accountProfile(OWNER,{displayName:'Stale',avatar:'',expectedRevision:first.revision}),{code:'profile_stale',status:409});
 // Two tabs saving from the same revision: exactly one wins, the other is stale; the stored row has no retired members.
 const results=await Promise.allSettled([c.accountProfile(OWNER,{displayName:'Tab one',avatar:'',expectedRevision:saved.revision}),c.accountProfile(OWNER,{displayName:'Tab two',avatar:'',expectedRevision:saved.revision})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'profile_stale');
 assert.deepEqual(Object.keys(await db.get('profile')).sort(),['avatar','displayName','owner','updatedAt']);
});

test('seeded chaos: reset slices interleaved with profile saves and kept-family writes never lose a kept write and always finish clean',async t=>{
 await forEachSeed(12,async random=>{
  const db=new SqliteMetadata(':memory:');try{
   await db.put('owner',OWNER);await seedRetired(db,{per:1+random.int(4)});
   const scheduler=createScheduler(random),wrapped=scheduler.wrap(db,'store'),c=new AccountController({metadata:wrapped,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN},sql:db.sql});
   const kept=new Map(),saves=[];let n=0;
   const work=Array.from({length:6+random.int(6)},()=>{const kind=random.pick(['reset','reset','profile','kept','kept']);const id=n++;
    if(kind==='reset'){const limit=1+random.int(6);return ()=>resetContactLinks(wrapped,{limit});}
    if(kind==='profile'){const value={displayName:'Name '+id,avatar:random.chance(0.5)?'':'https://img.example/'+id+'.png'};return async()=>{await c.accountProfile(OWNER,value);saves.push(value);};}
    const path=random.pick(['contact-key/','orgs/invitation/','relations/invitation/',key('key-delegation',OWNER,'')])+id,value={id};kept.set(path,value);return ()=>wrapped.put(path,value);});
   const results=await scheduler.run(work);for(const r of results)if(r.status==='rejected')throw r.reason;
   let guard=0;while(!(await resetContactLinks(db,{limit:1+random.int(8)})).done)assert.ok(++guard<500);
   assert.deepEqual(await remaining(db),[]);for(const [path,value]of kept)assert.deepEqual(await db.get(path),value,path);
   const profile=await db.get('profile');assert.equal(Object.hasOwn(profile,'bio')||Object.hasOwn(profile,'discloseToContacts'),false);
   // The profile holds one of the saves (the last committed), or the legacy kept members when nothing saved.
   if(saves.length)assert.ok(saves.some(s=>s.displayName===profile.displayName&&s.avatar===profile.avatar),JSON.stringify(profile));
   else assert.deepEqual([profile.displayName,profile.avatar],['Legacy name','https://img.example/a.png']);
   assert.equal((await db.get(CONTACT_LINKS_RESET_MARKER)).version,1);
  }finally{db.close();}
 });
});
