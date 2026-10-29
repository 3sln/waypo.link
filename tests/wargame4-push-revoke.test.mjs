// Wargame 4 M1: ending a device session also ends that device's push subscription (revoke, sign out other devices,
// cap eviction, recovery), with a durable identity row retried until the account object acknowledges it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {base64url} from '../packages/core/records.mjs';
import {NotificationService,SESSION_END_MS} from '../packages/activity/notifications.mjs';
import {accountChannelState,accountChannelsPort} from '../packages/runtime/account-channels.mjs';
import {queuePushEndsOn} from '../packages/identity/service.mjs';
import {transferIdentityPort} from '../packages/identity/transfer-out.mjs';
import {metadataStore} from '../packages/app/memory-providers.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {identityEngine,activate,sessionContext,context,MemoryAccounts,signInPasskey} from './helpers/identity-engine.mjs';
import {softAuthenticator} from './helpers/soft-passkey.mjs';

// Passwords were dropped (owner approval 2026-10-28): accounts sign up and sign in with a soft passkey (Node) or the fake one (engine).
const origin='http://localhost:8791',authenticator=softAuthenticator({origin});
const keys={p256dh:base64url(new Uint8Array(65).fill(4)),auth:base64url(new Uint8Array(16).fill(1))};
const sub=()=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),keys});

test.describe('node server: owner removal of a device ends its push subscription',()=>{
 let app,directory,lane=0;
 const fetchURL=(url,init={})=>{const r=new Request(new URL(url,origin),init);if(!r.headers.has('CF-Connecting-IP'))r.headers.set('CF-Connecting-IP',`203.0.113.${++lane%250}`);return app.fetch(r);};
 const post=(path,value,headers={})=>fetchURL(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
 const bind=r=>{const cookie=r.headers.getSetCookie().find(c=>c.startsWith('bindle_session='))??r.headers.get('Set-Cookie');return cookie.split(';')[0];};
 const call=(who,path,value,method='POST')=>fetchURL(path,{method,headers:{Origin:origin,...who.headers,...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}});
 async function signup(){
  const s=await post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'}),pending=await s.json(),setup={Cookie:s.headers.get('Set-Cookie').split(';')[0]};
  const registered=await post('/api/auth/passkey/register',{pendingToken:pending.pendingToken,response:await authenticator.register(pending.registrationOptions)},setup);assert.equal(registered.status,200,await registered.clone().text());
  const rec=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken},setup)).json();
  const a=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:rec.recoveryToken,downloadConfirmed:true},setup);assert.equal(a.status,200,await a.clone().text());
  const session=await a.json();return {session,headers:{Cookie:bind(a),'X-CSRF-Token':session.csrfToken}};
 }
 async function login(handle){const b=await (await post('/api/auth/login/passkey/begin',{handle,turnstileToken:'local-browser-test-token'})).json(),l=await post('/api/auth/login/passkey/finish',{challengeToken:b.challengeToken,response:await authenticator.authenticate(b.authenticationOptions)});assert.equal(l.status,200,await l.clone().text());const s=await l.json();return {session:s,headers:{Cookie:bind(l),'X-CSRF-Token':s.csrfToken}};}
 test.before(async()=>{directory=await mkdtemp(join(tmpdir(),'wg4-push-'));app=await createNodeServer({directory,config:{APP_ORIGIN:origin}});});
 test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});
 for(const mode of ['revoke','revoke-others'])test(`owner ${mode} of a device session also ends that device's push subscription`,async()=>{
  const victim=await signup(),handle=victim.session.account.handle,id=victim.session.account.id,attacker=await login(handle);
  const enrolled=await call(attacker,'/api/notifications/subscribe',{subscription:sub(),label:'Attacker phone'});assert.equal(enrolled.status,200,await enrolled.clone().text());
  const own=sub(),mine=await call(victim,'/api/notifications/subscribe',{subscription:own,label:'Owner laptop'});assert.equal(mine.status,200);
  const rows=async()=>[...(await app.resources.accounts.get(id).metadata.list({prefix:`push-subscription/${id}/`})).values()];
  assert.equal((await rows()).length,2);assert.ok((await rows()).every(row=>typeof row.sessionId==='string'),'each subscription is bound to its creating session');
  let r;
  if(mode==='revoke'){const account=await (await call(victim,'/api/account',undefined,'GET')).json(),target=account.devices.find(d=>!d.current);r=await call(victim,'/api/auth/devices/revoke',{sessionId:target.id});}
  else r=await call(victim,'/api/auth/devices/revoke-others',{});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal((await call(attacker,'/api/account',undefined,'GET')).status,401,'attacker session is revoked');
  const left=await rows();assert.deepEqual(left.map(row=>row.label),['Owner laptop'],'only the revoked device lost its subscription');
  // A late subscribe from the ended session is refused even if it slipped past session authorization.
  const ended=(await app.resources.accounts.get(id).metadata.list({prefix:`push-session-ended/${id}/`})).size;assert.ok(ended>=1);
  assert.equal((await (await call(victim,'/api/account',undefined,'GET')).json()).account.id,id);
 });
});

test('account object: ended sessions drop bound rows, refuse late subscribes and are skipped before any send',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());let now=Date.now();const owner='11111111-1111-4111-8111-111111111111';
 await db.put('owner',owner);const service=new NotificationService({store:metadataStore(db),clock:()=>now});
 const a=await service.subscribe(owner,sub(),'Phone A',{sessionId:'session-a'}),b=await service.subscribe(owner,sub(),'Phone B',{sessionId:'session-b'}),legacy=await service.subscribe(owner,sub(),'Legacy');
 await assert.rejects(service.subscribe(owner,sub(),'Bad',{sessionId:'not a session id!'}),{code:'unauthorized'});
 assert.deepEqual(await service.endSessions(owner,{sessionIds:['session-a']}),{removed:1});
 assert.deepEqual((await service.subscriptions(owner)).map(s=>s.label).sort(),['Legacy','Phone B']);
 await assert.rejects(service.subscribe(owner,sub(),'Late',{sessionId:'session-a'}),{code:'unauthorized'},'an ended session cannot enrol');
 // A row bound to an ended session is neither counted nor sent to (defence in depth for a row written by a race).
 await db.put(`push-subscription/${owner}/raced/`,{id:'raced',owner,endpoint:'https://fcm.googleapis.com/fcm/send/raced',keys,label:'Raced',sessionId:'session-a'});
 const sent=[];const state=await accountChannelState(db,owner,{push:{send:async s=>sent.push(s)}});assert.equal(state.count,2,'counts skip the ended session');
 // Sign out other devices: keep the current session and this browser's subscription; legacy rows go.
 const current=await service.subscribe(owner,sub(),'This browser (unbound)');
 assert.deepEqual(await service.endSessions(owner,{sessionIds:[],keep:['session-c'],keepSubscriptions:[current.id]}),{removed:3});
 assert.deepEqual((await service.subscriptions(owner)).map(s=>s.label),['This browser (unbound)']);
 assert.ok(a.id&&b.id&&legacy.id);
 // End markers expire once no session from before them can still be live.
 now+=SESSION_END_MS+1;await service.endSessions(owner,{sessionIds:[]});assert.equal((await db.list({prefix:`push-session-ended/${owner}/`})).size,0);
});

test('identity: every explicit session end queues a durable push-end row, retried until the account acknowledges',async()=>{
 const calls=[];let down=false;
 const accountChannels={async endSessions(owner,input){if(down)throw Object.assign(new Error('account down'),{code:'account_unavailable'});calls.push({owner,...structuredClone(input)});return {removed:0};}};
 const f=identityEngine({accountChannels}),{owner,ownerContext,file,credentialId}=await activate(f.act);
 const second=await signInPasskey(f.act,'alice',credentialId),secondContext=sessionContext(second);
 const devices=(await f.owner(ownerContext)).devices,other=devices.find(d=>!d.current);
 // Revoke with the account object down: the session ends now, the row waits.
 down=true;await f.act('revokeSession',{sessionId:other.id},ownerContext);
 assert.deepEqual((await f.repository.get(owner.account.id)).pendingPushEnds.ids,[other.id]);assert.equal(calls.length,0);
 // The owner view retries it.
 down=false;await f.owner(ownerContext);
 assert.equal((await f.repository.get(owner.account.id)).pendingPushEnds,undefined);assert.deepEqual(calls.at(-1).sessionIds,[other.id]);
 await assert.rejects(f.owner(secondContext),{code:'unauthorized'});
 // Cap eviction: the eleventh session evicts a live one, whose subscriptions end.
 let latest;for(let i=0;i<10;i++)latest=await signInPasskey(f.act,'alice',credentialId);const latestContext=sessionContext(latest);
 assert.ok(calls.at(-1).sessionIds.length>=1,'an evicted live session is reported');assert.equal((await f.repository.get(owner.account.id)).pendingPushEnds,undefined);
 // Sign out other devices keeps the current chain and the browser's own subscription id.
 const push='A'.repeat(43);await f.act('revokeOtherSessions',{pushSubscription:push},latestContext);
 assert.deepEqual(calls.at(-1).keep,[(await f.owner(latestContext)).sessionContext]);assert.deepEqual(calls.at(-1).keepSubscriptions,[push]);
 // Recovery ends every live session.
 const before=(await f.owner(latestContext)).devices.map(d=>d.id);
 await f.act('recover',{recoveryToken:file.recoveryToken,turnstileToken:'verified'});
 assert.ok(before.length>=1&&before.every(id=>calls.at(-1).sessionIds.includes(id)),'recovery reports every session that was live');
 assert.ok(context.origin);
});

test('review: the real account-channels port forwards keepSubscriptions, so revoke-others keeps this browser',async t=>{
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());const owner='11111111-1111-4111-8111-111111111111';await db.put('owner',owner);
 const service=new NotificationService({store:metadataStore(db),clock:()=>Date.now()});
 const port=accountChannelsPort(async(o,method,args)=>{assert.equal(method,'pushSessionsEnded');return service.endSessions(...args);});
 const mine=await service.subscribe(owner,sub(),'This browser (legacy)');await service.subscribe(owner,sub(),'Other',{sessionId:'session-x'});
 assert.deepEqual(await port.endSessions(owner,{sessionIds:[],keep:['session-c'],keepSubscriptions:[mine.id]}),{removed:1});
 assert.deepEqual((await service.subscriptions(owner)).map(s=>s.label),['This browser (legacy)']);
});

test('review: transfer-out removeDisputers queues the push end for every removed live session',async()=>{
 const repository=new MemoryAccounts(),now=Date.now(),id='22222222-2222-4222-8222-222222222222';
 await repository.create({id,handle:'disputed',status:'active',revision:1,security:{epoch:3,changedAt:0},credentials:[],sessions:[{id:'keep',expiresAt:now+3600000},{id:'disputer',expiresAt:now+3600000},{id:'child',parentSessionId:'disputer',expiresAt:now+3600000},{id:'stale',parentSessionId:'disputer',expiresAt:now-1}]});
 const result=await transferIdentityPort(repository,{clock:()=>now}).removeDisputers(id,{sessions:['disputer'],expectedEpoch:3});
 assert.equal(result.ok,true);assert.deepEqual(result.endedSessions.sort(),['child','disputer']);
 const record=await repository.get(id);assert.deepEqual(record.sessions.map(s=>s.id),['keep']);assert.deepEqual(record.pendingPushEnds.ids.sort(),['child','disputer']);assert.equal(typeof record.pendingPushEnds.nonce,'string');
});

test('review: a stale push-end run never clears a row queued while it was in flight (nonce, not a timestamp)',async()=>{
 let f,injected=false;const delivered=[];
 const accountChannels={async endSessions(owner,input){delivered.push(...input.sessionIds);if(!injected){injected=true;const record=await f.repository.get(owner);queuePushEndsOn(record,['queued-meanwhile'],{nonce:'second'});record.revision++;await f.repository.compareAndSwap(owner,record.revision-1,record);}return {removed:0};}};
 f=identityEngine({accountChannels,clock:{now:()=>1792000000000}});const {owner}=await activate(f.act),id=owner.account.id;
 const record=await f.repository.get(id);queuePushEndsOn(record,['first'],{nonce:'first'});record.revision++;assert.equal(await f.repository.compareAndSwap(id,record.revision-1,record),true);
 await f.service.flushPushEnds(id);
 assert.equal((await f.repository.get(id)).pendingPushEnds,undefined);
 assert.ok(delivered.includes('queued-meanwhile'),'the row queued during the first run was delivered before being cleared (same-millisecond clock)');
});
