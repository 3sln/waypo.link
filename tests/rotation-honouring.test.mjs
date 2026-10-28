// PORT-9, old-key honouring (identity portability P11; docs/spec/identity-portability.md §7.1, AMD-P10/P11). Recovery file
// v3 (owner approval 2026-10-28) holds no keys, so the recovery binding that pinned retired keys is gone. Contact-link records (`link/<jti>`) used to reference keys too; contact links left the core in contacts phase 4
// (2026-10-28), so such records no longer protect a key (keys pinned only by them become prunable, rethink §9); published keys carry `created`/`retired` (Unix seconds); a bare retired-key signature on
// anything newly minted is never honoured. Engine level: a real AccountController over in-memory SQLite, plus the
// registry over the memory store, plus seeded chaos schedules (tests/helpers/chaos.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {MemoryMessagingStore,key,base64url,textEncoder,canonical} from '../packages/core/records.mjs';
import {IdentityKeyRegistry,createIdentityKeyEngine,performKeyAction,readKeyQuery,EnsureIdentityKey,RotateIdentityKey,IdentityKeyHistory,KEY_HISTORY_LIMIT,referencedSigningKids} from '../packages/identity/keys.mjs';
import {encryptSecret,decryptSecret} from '../packages/runtime/secrets.mjs';
import {forEachSeed,createScheduler,fakeClock} from './helpers/chaos.mjs';

const origin='https://honour.example',owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bucket={get:async()=>null,put:async()=>({}),delete:async()=>{}};
const KEK=Buffer.alloc(32,9).toString('base64'),sealing={seal:value=>encryptSecret(value,KEK),open:value=>decryptSecret(value,KEK)};
const decoded=segment=>JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));
const headerOf=token=>decoded(token.split('.')[0]);

async function account(t){
 const db=new SqliteMetadata(':memory:'),controller=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,sql:db.sql,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:KEK,IDENTITY_ACCOUNT:async id=>({id,status:'active',handle:'person'})}});
 t.after(async()=>{await controller.engine.dispose();db.close();});await controller.warm(owner);
 return {db,controller};
}
const rotate=async c=>{const kid=(await c.signingKey(owner)).kid;return {rotation:await c.rotateIdentityKey(owner,{purpose:'signing',expectedKid:kid})};};

test('contacts phase 4: a leftover link record no longer protects its key; the account rotates and prunes as if it were absent', async t => {
 const {db,controller:c}=await account(t),k0=(await c.signingKey(owner)).kid,jti=crypto.randomUUID();
 // A live, unrevoked contact-link row from before the change (the reset deletes such rows; here it is planted).
 await db.put(key('link',jti),{version:1,jti,owner,header:{alg:'ES256',kid:k0,typ:'bindle-link-meta+jwt'},claims:{exp:Math.floor(Date.now()/1000)+86400},revoked:false});
 for(let i=0;i<KEY_HISTORY_LIMIT+1;i++)await rotate(c);
 const history=(await c.identityKeyHistory(owner,{purpose:'signing'})).map(k=>k.kid);
 assert.equal(history.includes(k0),false,'the key pinned only by a link record was pruned');assert.ok(history.length<=KEY_HISTORY_LIMIT);
 assert.equal((await db.transaction(tx=>referencedSigningKids({list:prefix=>tx.list({prefix}).then(rows=>[...rows].map(([key,value])=>({key,value}))),get:k=>tx.get(k)},owner,Date.now()))).has(k0),false);
});

test('published signing keys carry created and retired in Unix seconds; the current key has no retired member', async t => {
 const {controller:c}=await account(t);
 const k0=(await c.signingKey(owner)).kid,{rotation}=await rotate(c);
 const history=await c.identityKeyHistory(owner,{purpose:'signing'}),[old,current]=history;
 assert.equal(old.retired,Math.floor(old.retiredAt/1000));assert.equal(old.created,Math.floor(old.createdAt/1000));assert.equal(current.retired,null);
 assert.equal(current.rotation,null,'an ordinary rotation carries no issuance tag any more');
 const published=await c.identitySigningKey(owner,k0),now=await c.identitySigningKey(owner,rotation.kid);
 assert.deepEqual([published.state,published.active,published.retired,published.created],['retired',false,old.retired,old.created]);
 assert.equal(Object.hasOwn(now,'retired'),false);assert.equal(now.created,current.created);
});

test('recovery file v3: a leftover recovery binding row protects nothing; rotation prunes as usual and no key is pinned by a file', async () => {
 const store=new MemoryMessagingStore(),clock=fakeClock(1800000000000),engine=createIdentityKeyEngine({store,...sealing,clock:clock.now});
 const act=(Action,input)=>performKeyAction(engine,new Action({owner,input})),ask=(Query,input)=>readKeyQuery(engine,new Query({owner,input}));
 let {kid}=await act(EnsureIdentityKey,{purpose:'signing'});const first=kid;
 await store.transaction(tx=>tx.set(key('identity-key-recovery',owner),{owner,kids:[first]}));
 for(let i=0;i<KEY_HISTORY_LIMIT+2;i++)({kid}=await act(RotateIdentityKey,{purpose:'signing',expectedKid:kid}));
 const history=(await ask(IdentityKeyHistory,{purpose:'signing'})).map(k=>k.kid);
 assert.equal(history.includes(first),false);assert.ok(history.length<=KEY_HISTORY_LIMIT);
 await assert.rejects(act(EnsureIdentityKey,{purpose:'encryption'}),{code:'invalid_purpose'},'the encryption purpose was removed');
});
