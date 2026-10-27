// Red-team round 3, links (DEVLOG 2026-10-23 "Links, Beam, device and directory wargame fixes"): L1 limiter oracle and
// L4 revoked app-link growth. L3 (redemption index), L5 (contact-grant tombstones) and the redemption/contact-URL
// findings covered legacy contact grants, which left the core with messaging on 2026-10-27; so did the JSON inspection
// representation and its claimed-principal link-audience limiter.
import test from 'node:test';
import assert from 'node:assert/strict';
import application from '../packages/runtime/http.mjs';
import {CONTACT_LINK_TYPE,MESSAGING_CONTACT_LINK_TYPE} from '../packages/links/types.mjs';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {MemoryMessagingStore} from '../packages/core/records.mjs';
import {IdentityKeyRegistry} from '../packages/identity/keys.mjs';
import {LinkService} from '../packages/links/issuance.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {key as recordKey} from '../packages/core/records.mjs';
import {key} from '../packages/core/records.mjs';

const ORIGIN='https://provider.example',OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PEER='cccccccc-cccc-4ccc-8ccc-cccccccccccc',DAY=86400000;
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function controller(t){
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 const c=new AccountController({metadata:db,gate:new SerialGate(),blobs:{put:async()=>{},get:async()=>null,delete:async()=>{}},archives:{},config:{APP_ORIGIN:ORIGIN,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')},sql:db.sql});
 return {db,c};
}
async function owned(t){const f=controller(t);await f.c.touch(OWNER);f.c.config.IDENTITY_ACCOUNT=async()=>({status:'active',handle:'person'});return f;}

// L1: the caller's own budgets run before the identity lookup, so a limited caller gets 429 whatever the target.
{
 const ACTIVE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SUSPENDED='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const forged=(handle,sub,data)=>{const jti=crypto.randomUUID(),aud=`${ORIGIN}/users/${handle}/contact/${jti}`,now=Math.floor(Date.now()/1000);
  const meta=`${b64({alg:'ES256',kid:'k',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:CONTACT_LINK_TYPE,iss:ORIGIN,aud,jti,iat:now,exp:now+3600,sub})}.${Buffer.alloc(64,1).toString('base64url')}`;
  return `${aud}?bindle_meta=${meta}${data?`&bindle_data=${data}`:''}`;};
 const identities={[ACTIVE]:{id:ACTIVE,status:'active',handle:'person'},[SUSPENDED]:{id:SUSPENDED,status:'suspended',handle:'gone'}};
 const environment=consume=>({APP_ORIGIN:ORIGIN,ABUSE_HASH_KEY:'k',ABUSE:{consume},IDENTITY_REPOSITORY:{get:async id=>identities[id]??null},ACCOUNTS:{get:()=>({invoke:async()=>({$fault:{code:'link_invalid',status:401}})})}});
 for(const accept of ['application/vnd.bindle.contact-profile+json']){
  test(`L1: rate-limited ${accept} answers do not reveal whether the named identity is active`,async()=>{
   const env=environment(async()=>false),send=url=>application.fetch(new Request(url,{headers:{Accept:accept,'CF-Connecting-IP':'198.51.100.7'}}),env);
   const a=await send(forged('person',ACTIVE)),s=await send(forged('gone',SUSPENDED)),u=await send(forged('nobody',crypto.randomUUID()));
   assert.equal(a.status,429);assert.equal(s.status,a.status,`active ${a.status} vs suspended ${s.status}`);assert.equal(u.status,a.status,`active ${a.status} vs unknown ${u.status}`);
  });
 }
}

// L3: peerBindings() finds a peer's binding through the peer-keyed index, however many other bindings exist
// (packages/links/contact-profile.mjs; the index was Beam's permission lookup until Beam left the core, 2026-10-26).

// Plausible: quarantine is read inside the redemption transaction, not from the pre-transaction inspection snapshot.

// Plausible: an owner read of an unknown contact is a 404 fault, never a plain Error (500).

// L4: revoked app-declared links are purged past PURGE_AFTER on every issue, even far below the cap.
test('L4: revoked app links are reclaimed after the 30-day retention even when the owner never reaches the cap',async()=>{
 const clock=fakeClock(1800000000000),store=new MemoryMessagingStore(),registry=new IdentityKeyRegistry({store,clock:clock.now,seal:v=>structuredClone(v),open:v=>v});
 await registry.ensure(OWNER,'signing');
 const service=new LinkService({store,issuer:'https://3sln.example',keys:registry,clock:clock.now,maxLinks:10,signingKey:o=>registry.privateKey(o,'signing')});
 const claims={resource:'parent-1',kinds:['one-off'],mimeTypes:['text/plain'],maxMessages:5,maxBytes:65536,maxMessageBytes:16384};
 const issue=()=>service.issue(OWNER,{type:MESSAGING_CONTACT_LINK_TYPE,claims,expiresAt:clock.now()+DAY,handle:'alice'},{kind:'app',clientId:'https://box.example/app'});
 for(let day=0;day<40;day++){for(let i=0;i<5;i++){const {jti}=await issue();await service.revoke(OWNER,jti);}clock.advance(DAY);}
 const rows=await store.transaction(async tx=>(await tx.list(recordKey('link'))).length);
 assert.ok(rows<=31*5,`${rows} link records kept; revoked records older than 30 days must be reclaimed below the cap`);
 // Records inside the retention window are still listed (list/changes contract unchanged).
 assert.ok((await service.list(OWNER,{limit:100})).links.length>0);
});

// L5: a tombstone carries the reclaimed parent's signed exp and is collected once exp (plus skew) has passed.
