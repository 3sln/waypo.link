// Wargame 3 F5: per-connection app-notification receipt caps and short leases for `reserved` receipts.
import {decodeRPC} from '../packages/core/rpc-wire.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {FederationController,federationMetadata} from '../packages/federation/runtime.mjs';
import {federationControllerOptions,federationEpoch} from '../packages/runtime/federation.mjs';
import {APP_NOTIFICATIONS,APP_NOTIFICATION_PREFERENCES} from '../packages/federation/app-notifications.mjs';
import {createAppNotification} from '../packages/runtime/app-notifications.mjs';

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISSUER='https://provider.example';
const evil={id:'https://evil.example/client',origin:'https://evil.example',name:'Evil app',redirectUris:['https://evil.example/callback']};
const good={id:'https://calendar.example/client',origin:'https://calendar.example',name:'Calendar app',redirectUris:['https://calendar.example/callback']};
const subject=ISSUER+'/entities/'+OWNER,resource=subject+'/app-messages';
const fragment={id:APP_NOTIFICATION_PREFERENCES,title:'App messages',description:'Allow app messages',publisher:'https://3sln.me',fields:{notifications:{type:'resource',title:'Messages',contracts:[APP_NOTIFICATIONS]}}};
async function keys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const kid=crypto.randomUUID();return {APP_NOTIFICATION_SIGNING_JWK:{...await crypto.subtle.exportKey('jwk',pair.privateKey),kid,alg:'ES256'},APP_NOTIFICATION_PUBLIC_JWKS:{keys:[{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256'}]}};}

async function fixture(t,start){
 const realNow=Date.now,clock={now:start};Date.now=()=>clock.now;t.after(()=>{Date.now=realNow;});
 const directory=await mkdtemp(join(tmpdir(),'wg3-appmsg-'));const db=new SqliteMetadata(join(directory,'a.sqlite')),fedDB=new SqliteMetadata(join(directory,'f.sqlite'));t.after(async()=>{db.close();fedDB.close();await rm(directory,{recursive:true,force:true});});
 const blobs=new Map(),io={failPut:false};
 const bucket={put:async(p,b)=>{if(io.failPut)throw Error('lost storage response');blobs.set(p,new Uint8Array(b));},get:async p=>blobs.has(p)?{arrayBuffer:async()=>blobs.get(p).buffer}:null,delete:async p=>blobs.delete(p)};
 const identity={id:OWNER,status:'active',termsVersion:'2026-10-11',handle:'n.1',assignmentId:crypto.randomUUID(),recoveryHash:'recovery'},epoch=await federationEpoch(identity);
 const config={APP_ORIGIN:ISSUER,KEY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:[evil,good],FEDERATION_SCHEMAS:{[APP_NOTIFICATION_PREFERENCES]:fragment},FEDERATION_IDENTITY_CHECK:async(o,v)=>o===OWNER&&v===epoch,...await keys()};
 const account=new AccountController({metadata:db,gate:new SerialGate(),blobs:bucket,archives:bucket,config,sql:db.sql});await account.touch(OWNER);
 const controller=new FederationController({...federationControllerOptions({config,repository:{get:async id=>id===OWNER?identity:null},accounts:{get:()=>account},owner:OWNER}),metadata:federationMetadata(fedDB),auth:{owner:async()=>({subject,epoch})}});
 const ownerAuth={sessionToken:'session'};
 await controller.configure(ownerAuth,{fragment:APP_NOTIFICATION_PREFERENCES,values:{notifications:resource},expectedRevision:null});
 async function connect(client){const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url'),methods=['createOwn'];const request=await controller.beginAuthorization({clientId:client.id,redirectUri:client.redirectUris[0],challenge,challengeMethod:'S256',state:'state',requests:[{fragment:APP_NOTIFICATION_PREFERENCES,required:true,purpose:'Send me messages',fields:['notifications'],methods:{notifications:{[APP_NOTIFICATIONS]:methods}}}]});const view=await controller.inspect(ownerAuth,request.requestId);const callback=new URL((await controller.approve(ownerAuth,{requestId:request.requestId,approved:[{fragment:APP_NOTIFICATION_PREFERENCES,revision:view.requests[0].revision,fields:['notifications'],resources:{notifications:[resource]},methods:{notifications:{[APP_NOTIFICATIONS]:methods}}}]})).redirectUri);const session=await controller.exchange({clientId:client.id,redirectUri:client.redirectUris[0],code:callback.searchParams.get('code'),verifier});const pref=await controller.rpc(session.access_token,{version:'0',tx:crypto.randomUUID(),resource:'@preferences',contract:'https://3sln.me/artefacts/contracts/preferences/v2',method:'read',args:{fragment:APP_NOTIFICATION_PREFERENCES}});return {session,ref:pref.result.values.notifications[0],client};}
 const send=async(conn,transactionId=crypto.randomUUID(),createdAt=Date.now())=>controller.rpc(conn.ref.token,{version:'0',tx:transactionId,resource:conn.ref.id,contract:APP_NOTIFICATIONS,method:'createOwn',args:{transactionId,createdAt,subject:'Hi',body:'Hello'}},{requestOrigin:conn.client.origin});
 return {clock,db,io,connect,send,account};
}

test('one app cannot starve other apps of app messages through the account-wide receipt cap',async t=>{
 const f=await fixture(t,Date.UTC(2026,9,20,23,0,0));
 // The app sends at its permitted pace: 10 per minute, 100 per UTC day, with fresh tokens per burst.
 async function burst(count){let sent=0;const conn=await f.connect(evil);while(sent<count){for(let i=0;i<10&&sent<count;i++){const r=await f.send(conn);assert.equal(r.error,undefined,JSON.stringify(r.error));sent++;}f.clock.now+=61000;}}
 await burst(100);
 f.clock.now=Date.UTC(2026,9,21,0,0,0);await burst(100);
 f.clock.now=Date.UTC(2026,9,22,0,0,0);await burst(56); // day-1 receipts are still retained (2 days)
 const retained=(await f.db.list({prefix:'app-notification-receipt/'})).size;assert.ok(retained>=256);
 const victim=await f.connect(good),outcome=await f.send(victim).catch(error=>({error}));
 assert.equal(outcome.error,undefined,`after ${retained} receipts from one app, another app's first message was refused: ${outcome.error?.code} ${outcome.error?.message}`);
});

test('a crash-left reserved receipt is a short lease: it expires and stops counting toward receipt caps',async t=>{
 const f=await fixture(t,Date.UTC(2026,9,20,12,0,0)),conn=await f.connect(good),tx=crypto.randomUUID(),createdAt=Date.now();
 f.io.failPut=true;assert.equal((await f.send(conn,tx,createdAt)).error?.code,'indeterminate');f.io.failPut=false;
 const [[path,row]]=[...(await f.db.list({prefix:'app-notification-receipt/'}))];
 assert.equal(row.state,'reserved');assert.ok(row.expiresAt-Date.now()<=10*60000,`reserved receipt lease is ${row.expiresAt-Date.now()} ms`);
 // Inside the lease the outcome stays indeterminate.
 assert.equal((await f.send(conn,tx,createdAt)).error?.code,'indeterminate');
 assert.equal((await f.db.get(path)).state,'reserved');
 // After the lease lapses the abandoned reservation is swept on the connection's next admission and is no longer
 // retained or counted. (Same-tx replay is still governed by the generic federation RPC journal.)
 f.clock.now+=6*60000;
 const next=await f.send(conn);assert.equal(next.error,undefined,JSON.stringify(next.error));
 assert.equal(await f.db.get(path),undefined,'the lapsed reserved receipt is still retained');
 const rows=[...(await f.db.list({prefix:'app-notification-receipt/'})).values()];assert.deepEqual(rows.map(r=>r.state),['done']);
});

// Review follow-up 9 (2026-10-23): the per-connection reserve is itself bounded account-wide, and the capacity check
// is atomic with the reservation write.
const seed=async(db,prefix,count,expiresAt)=>{for(let i=0;i<count;i++)await db.put(`${prefix}${String(i).padStart(6,'0')}`,{fingerprint:'seed',state:'done',result:{id:'seed',accepted:true,receivedAt:0},expiresAt});};
test('the per-connection receipt reserve has an account-wide hard bound',async t=>{
 const f=await fixture(t,Date.UTC(2026,9,20,12,0,0)),conn=await f.connect(good),until=Date.now()+86400000;
 // 1,500 live receipts from other connections (each under its reserve): above the 1,024 account cap, but a fresh
 // connection still gets its reserved share.
 for(let n=0;n<47;n++)await seed(f.db,`app-notification-receipt/seed-${String(n).padStart(3,'0')}/`,32,until);
 const reserved=await f.send(conn);assert.equal(reserved.error,undefined,JSON.stringify(reserved.error));
 // Fill to the hard bound with more connections, each under its reserve: now the reserve is refused too.
 const live=(await f.db.list({prefix:'app-notification-receipt/'})).size;
 for(let n=47;n*32<4096+32;n++)await seed(f.db,`app-notification-receipt/seed-${String(n).padStart(3,'0')}/`,32,until);
 assert.ok((await f.db.list({prefix:'app-notification-receipt/'})).size>=4096&&live<4096);
 const refused=await f.send(conn);assert.equal(refused.error?.code,'rate_limited',`reserve was not bounded: ${JSON.stringify(refused)}`);
});
test('concurrent sends at the per-connection cap cannot both pass the capacity check',async t=>{
 const f=await fixture(t,Date.UTC(2026,9,20,12,0,0)),conn=await f.connect(good);
 // Capture one verified federation context, then drive the handler concurrently without the account's serial gate,
 // as a Worker Durable Object interleaves at awaited I/O (budget and quota calls) between check and write.
 let context;const original=f.account.federationRPC;f.account.federationRPC=async function(c,...rest){context??={...c,args:c.args instanceof Uint8Array?decodeRPC(c.args):c.args};return original.call(this,c,...rest);};
 const first=await f.send(conn);assert.equal(first.error,undefined);assert.ok(context,'the federation context was not captured');
 const [prefix]=[...(await f.db.list({prefix:'app-notification-receipt/'})).keys()].map(k=>k.slice(0,k.lastIndexOf('/')+1));
 await seed(f.db,prefix+'seed-',318,Date.now()+86400000); // 319 live receipts for this connection; one slot left
 // Hold every attempt at work admission (between the early check and the reservation write) until all have arrived.
 let arrived=0,open;const barrier=new Promise(r=>open=r),admit=f.account.admitWork;f.account.admitWork=async function(...args){if(++arrived>=3)open();await Promise.race([barrier,new Promise(r=>setTimeout(r,500))]);return admit.apply(this,args);};
 const attempt=()=>{const tx=crypto.randomUUID();return createAppNotification(f.account,OWNER,{...context,tx,args:{...context.args,transactionId:tx}}).then(()=>'ok',error=>error.code);};
 const results=await Promise.all([attempt(),attempt(),attempt()]);
 assert.equal(results.filter(r=>r==='ok').length,1,`concurrent sends with one slot left: ${JSON.stringify(results)}`);
 assert.ok((await f.db.list({prefix})).size<=320);
});
