// Engine-level tests for persisted app sessions (ui-elements-audit W11, account-chooser-island §5.4): the headless
// controller and client over a shared in-memory session backend standing in for the app origin's IndexedDB, Web Locks
// and BroadcastChannel, so several "tabs" (controllers) share one device. Provider: testing.mjs with refresh-reuse
// detection (local evidence only; the real provider's rules are covered in tests/app-sessions.test.mjs and
// tests/persisted-sessions-contract.test.mjs).
import {test as nodeTest,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../src/flows.mjs';
import {createMockProvider,memoryStorage,memorySessionBackend} from '../src/testing.mjs';

const test=(name,fn)=>nodeTest(name,{timeout:20000},fn),cleanups=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
const clientId='https://app.example/client',redirectUri='https://app.example/callback',ISSUER='https://provider.example';
// Drains the in-memory bus (setTimeout 0 deliveries) and the async handlers it starts; no wall-clock waits.
const settle=async()=>{for(let i=0;i<6;i++){await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setImmediate(resolve));}};
const neverTimers={setTimeout:()=>0,clearTimeout(){}};
function rng(seed){let x=seed>>>0||1;return ()=>{x^=x<<13;x>>>=0;x^=x>>17;x^=x<<5;x>>>=0;return x/2**32;};}

function device({accounts=[{handle:'ada',displayName:'Ada Lovelace'},{handle:'grace',displayName:'Grace Hopper'},{handle:'alan',displayName:'Alan Turing'}],locks=true,provider:options={},clock}={}){
  const provider=createMockProvider({issuer:ISSUER,accounts,profile:true,declaration:'full',fedcm:true,reuseDetection:true,...options});
  const backend=memorySessionBackend({locks}),presented=[];let now=clock??Date.now();const time=()=>++now;// strictly increasing, so "most recently used" never ties
  let drop=0,offline=false,stripIdle=false;
  // The network between the app and the provider: records every refresh token the provider answered for, and can
  // lose a response after the provider acted on it (`dropNext`) or fail before it (`offline`).
  const fetcher=async(input,init)=>{
    if(offline)throw new TypeError('Failed to fetch');
    const request=new Request(input,init),body=request.method==='POST'&&new URL(request.url).pathname==='/oauth/token'?new URLSearchParams(await request.clone().text()):null;
    let response=await provider.fetch(request);
    if(body?.get('grant_type')==='refresh_token'){const json=await response.clone().json();if(json.error!=='use_dpop_nonce')presented.push({token:body.get('refresh_token'),ok:response.ok,error:json.error});}
    if(body&&stripIdle&&response.ok){const json=await response.json();delete json.refresh_idle_expires_in;response=new Response(JSON.stringify(json),{status:200,headers:response.headers});}
    if(body&&drop>0&&response.ok){drop--;throw new TypeError('Failed to fetch');}
    return response;
  };
  const tabs=[];
  async function tab({persist,restore=true,sessionStore=backend.handle()}={}){
    const session=createSession({clientId,redirectUri,fetcher,storage:memoryStorage(),history:{replaceState(){}},window:undefined,defaultHost:'provider.example',sessionStore,clock:time,timers:neverTimers,...persist?{persist}:{},restore});
    const events=[];for(const type of ['change','account-change','sessions-change','sign-out','restore-end'])session.addEventListener(type,event=>events.push([type,event.detail]));
    const record={session,events,store:sessionStore,closed:false,close(){if(record.closed)return;record.closed=true;session.dispose();sessionStore.close();}};
    tabs.push(record);cleanups.push(()=>record.close());
    await session.restored;await session.loadCapabilities();await settle();
    return record;
  }
  // An interactive popup-style sign-in (the user went through the provider page) with a DPoP key held in memory.
  async function signIn(t,index,{dpop=true}={}){
    const begun=await t.session.client.beginAuthorization({intent:'login',presentation:'popup',dpop});
    await t.session.client.completeLogin(provider.authorize(begun.authorizationUrl,{account:provider.accounts[index]}));
    await settle();return t.session.session;
  }
  return {provider,backend,fetcher,presented,tab,tabs,signIn,subject:index=>provider.accounts[index].subject,
    advance(ms){now+=ms;},get now(){return now;},dropNext(n=1){drop=n;},set offline(value){offline=value;},set stripIdle(value){stripIdle=value;}};
}
const records=d=>[...d.backend.records.values()];
const subjects=t=>t.session.sessions.map(view=>view.subject);

test('an interactive DPoP-bound sign-in is persisted (key non-extractable, no access token) and a reload restores it before deciding',async()=>{
  const d=device(),a=await d.tab();
  assert.equal(a.session.persist,'device');
  await d.signIn(a,0);
  const [record]=records(d);
  assert.equal(record.subject,d.subject(0));assert.equal(record.issuer,ISSUER);
  assert.equal(record.key.privateKey.extractable,false,'the session key is never exportable');
  assert.equal(record.access_token,undefined);assert.equal(JSON.stringify(record).includes('access-'),false,'access tokens stay in memory');
  assert.match(record.refreshToken,/^refresh-/);assert.equal(record.refreshToken,a.session.client.session.refresh_token);
  assert.deepEqual(record.profile,{handle:'ada@provider.example',displayName:'Ada Lovelace'});
  // Reload: a new document over the same device storage.
  a.close();
  const b=await d.tab({restore:false});assert.equal(b.session.state,'signed-out');
  const c=d.tab();const pending=await Promise.race([c,Promise.resolve('pending')]);assert.equal(pending,'pending');
  const reloaded=await c;
  assert.equal(reloaded.session.state,'signed-in');assert.equal(reloaded.session.session.subject,d.subject(0));
  assert.equal(reloaded.session.lastChange.cause,'restored');
  assert.deepEqual(reloaded.session.session.profile,{handle:'ada@provider.example',displayName:'Ada Lovelace'});
  assert.equal(reloaded.session.persistence,'device');
  // The restored session holds no access token; the first use renews under the lock and rotates the stored token.
  const before=records(d)[0].refreshToken;
  const result=await reloaded.session.client.rpc({resource:'@preferences',contract:'x',method:'read'});
  assert.equal(result.result.subject,d.subject(0));
  assert.notEqual(records(d)[0].refreshToken,before);assert.equal(records(d)[0].refreshToken,reloaded.session.client.session.refresh_token);
});

test('restoring is a state of its own: the controller reports it until storage was read, then the real state',async()=>{
  const d=device();let release;const gate=new Promise(resolve=>release=resolve);
  const store=d.backend.handle(),slow={...store,list:async scope=>{await gate;return store.list(scope);}};
  const t=d.tab({sessionStore:slow});await settle();
  const session=d.tabs.at(-1).session;assert.equal(session.state,'restoring');assert.equal(session.session,null);
  release();await t;assert.equal(session.state,'signed-out');
  assert.equal(d.tabs.at(-1).events.at(-1)[0],'restore-end');
});

test('not persisted: Bearer-only refresh, persist="off", no advertised idle lifetime, no provider DPoP, auto-selected FedCM',async()=>{
  // No DPoP key: the refresh token is not sender-constrained, so it stays in memory.
  {const d=device(),t=await d.tab();await d.signIn(t,0,{dpop:false});assert.equal(records(d).length,0);assert.equal(t.session.state,'signed-in');}
  // persist="off": memory only, and switching off erases what was there.
  {const d=device(),t=await d.tab({persist:'off'});await d.signIn(t,0);assert.equal(records(d).length,0);assert.equal(t.session.persistence,'off');
   const u=await d.tab();await d.signIn(u,1);assert.equal(records(d).length,1);u.session.persist='off';await u.session.client.flushPersistence();assert.equal(records(d).length,0);}
  // The provider did not advertise refresh_idle_expires_in with the DPoP-bound refresh token.
  {const d=device();d.stripIdle=true;const t=await d.tab();await d.signIn(t,0);assert.equal(records(d).length,0);}
  // The provider does not advertise DPoP at all.
  {const d=device({provider:{dpop:false}}),t=await d.tab();await d.signIn(t,0);assert.equal(records(d).length,0);}
  // FedCM: an account the user picked persists; a browser auto-selection never does.
  for(const autoSelected of [false,true]){
    const d=device(),t=await d.tab(),win={navigator:{userActivation:{isActive:true}}};
    const fedcm=d.provider.installFedCM(win,{decide:()=>({decision:'approve',account:d.provider.accounts[0],autoSelected})});
    const {authorizeWithFedCM}=await import('../src/fedcm.mjs');
    const result=await authorizeWithFedCM({intent:'login',params:{},client:t.session.client,navigator:win.navigator,capabilities:t.session.capabilities,failures:new Map(),requests:[]});
    assert.equal(result.outcome,'completed');await settle();assert.equal(fedcm.calls.length,1);
    assert.equal(records(d).length,autoSelected?0:1,autoSelected?'auto-selected FedCM is never persisted':'a picked FedCM account persists');
  }
});

test('signOut({subject}), signOut() and forgetSession() delete persisted state, and every tab follows',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);await d.signIn(a,1);await d.signIn(a,2);
  const b=await d.tab();assert.deepEqual(subjects(b),[d.subject(0),d.subject(1),d.subject(2)]);assert.equal(b.session.session.subject,d.subject(2));
  assert.equal((await a.session.signOut({subject:d.subject(1)})).outcome,'completed');
  assert.deepEqual(records(d).map(r=>r.subject).sort(),[d.subject(0),d.subject(2)].sort());
  await settle();assert.deepEqual(subjects(b),[d.subject(0),d.subject(2)],'the other tab signs that account out too');
  assert.equal(b.events.filter(([type])=>type==='sessions-change').at(-1)[1].ended[0].cause,'sign-out');
  a.session.forgetSession({subject:d.subject(0),cause:'removed'});await a.session.client.flushPersistence();
  assert.deepEqual(records(d).map(r=>r.subject),[d.subject(2)]);
  // Tab b rotates the remaining account's token; tab a still holds the older one in memory.
  await b.session.client.refresh();const live=d.provider.liveFamilies().size;
  await a.session.signOut({revoke:true});
  assert.equal(records(d).length,0);await settle();
  assert.equal(b.session.state,'signed-out');assert.equal(b.session.lastChange.cause,'sign-out');
  // Revocation used the latest stored refresh token (not tab a's stale copy), so that family is gone at the provider.
  assert.equal(d.provider.liveFamilies().size,live-1);
  // A reload after sign-out restores nothing.
  const c=await d.tab();assert.equal(c.session.state,'signed-out');
});

test('two tabs never present the same refresh token: rotation is serialized and each tab adopts the stored successor',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);
  const b=await d.tab(),c=await d.tab();
  for(let round=0;round<6;round++)await Promise.all([a,b,c].map(t=>t.session.client.refresh()));
  const tokens=d.presented.map(p=>p.token);
  assert.equal(new Set(tokens).size,tokens.length,'every presented refresh token is fresh');
  assert.ok(d.presented.every(p=>p.ok));assert.equal(d.provider.revokedFamilies.size,0);
  for(const t of [a,b,c])assert.equal(t.session.state,'signed-in');
  assert.equal(records(d)[0].refreshToken,d.presented.length?[...d.provider.refresh.keys()].at(-1):undefined);
});

test('without cross-tab locks concurrent refreshes trip reuse detection; the family ends everywhere (why locks are required)',async()=>{
  const d=device({locks:false}),a=await d.tab();await d.signIn(a,0);const b=await d.tab();
  const results=await Promise.allSettled([a.session.client.refresh(),b.session.client.refresh()]);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(d.provider.revokedFamilies.size,1,'the provider revoked the family on reuse');
  await settle();
  // The survivor's next renewal is refused: the family and its successor are gone.
  const survivor=[a,b].find(t=>t.session.state==='signed-in');
  if(survivor){await assert.rejects(survivor.session.client.refresh(),{code:'revoked'});await settle();assert.equal(survivor.session.state,'signed-out');}
  assert.equal(records(d).length,0);
});

test('refresh-token reuse (a stale copy of the record) revokes the family; every tab ends with cause revoked and the record goes',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);const stale={...records(d)[0]};
  await a.session.client.refresh();
  // Someone restores an older copy of the record (a backup, a cloned profile): its token was already rotated.
  const [id]=d.backend.records.keys();d.backend.records.set(id,stale);
  const b=await d.tab();
  await assert.rejects(b.session.client.refresh(),{code:'revoked'});await settle();
  assert.equal(d.provider.revokedFamilies.size,1);assert.equal(records(d).length,0);
  assert.equal(b.session.state,'signed-out');assert.equal(b.session.lastChange.cause,'revoked');
  // Tab a learned of the deletion over the bus and signed that account out without presenting its token.
  assert.equal(a.session.state,'signed-out');assert.equal(a.session.lastChange.cause,'sign-out');
});

test('expired records are never restored and are erased; renewal past the idle window signs out',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);a.close();
  d.advance(604800*1000+1);
  const b=await d.tab();assert.equal(b.session.state,'signed-out');await settle();assert.equal(records(d).length,0);
});

test('storage unavailable (private mode, quota, broken database): sessions stay in memory and nothing hangs',async()=>{
  const d=device();d.backend.failing.add('*');
  const t=await d.tab();assert.equal(t.session.state,'signed-out');assert.equal(t.session.persistence,'memory');
  await d.signIn(t,0);assert.equal(t.session.state,'signed-in');assert.equal(records(d).length,0);
  await t.session.client.refresh();assert.equal(t.session.state,'signed-in');
  // Storage that breaks after the session was persisted: renewals continue in memory.
  const e=device(),u=await e.tab();await e.signIn(u,0);e.backend.failing.add('get');
  await u.session.client.refresh();assert.equal(u.session.state,'signed-in');assert.equal(u.session.persistence,'memory');
});

test('clearing site data: the next renewal finds no record, signs out locally and never presents the token',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);
  d.backend.wipe();const before=d.presented.length;
  await assert.rejects(a.session.client.refresh(),{code:'signed-out'});await settle();
  assert.equal(d.presented.length,before,'no token request after the record vanished');
  assert.equal(a.session.state,'signed-out');assert.equal(a.session.lastChange.cause,'sign-out');
  // A rotation that completes after the wipe is revoked instead of being resurrected in storage.
  const e=device(),b=await e.tab();await e.signIn(b,0);
  const store=b.store,original=store.replace;store.replace=async(...args)=>{e.backend.wipe();return original(...args);};
  await assert.rejects(b.session.client.refresh(),{code:'signed-out'});await settle();
  assert.equal(records(e).length,0);assert.equal(e.provider.liveFamilies().size,0,'the orphaned successor was revoked');
});

test('offline and provider outages keep a persisted session for a later attempt; a lost response after rotation ends the family safely',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);
  d.offline=true;await assert.rejects(a.session.client.refresh(),{code:'network-error'});
  assert.equal(a.session.state,'signed-in');assert.equal(records(d).length,1);
  d.offline=false;await a.session.client.refresh();assert.equal(a.session.state,'signed-in');
  // The provider rotated but the response never arrived: the stored token is now a used one. Presenting it is reuse,
  // which revokes the family (no silent replay); the account signs out with cause revoked.
  d.dropNext();await assert.rejects(a.session.client.refresh(),{code:'network-error'});
  await assert.rejects(a.session.client.refresh(),{code:'revoked'});await settle();
  assert.equal(a.session.state,'signed-out');assert.equal(records(d).length,0);assert.equal(d.provider.revokedFamilies.size,1);
});

test('a sign-in in one tab appears in the others (cause restored when they were signed out); held order and current survive reload',async()=>{
  const d=device(),a=await d.tab(),b=await d.tab();
  await d.signIn(a,0);await settle();
  assert.equal(b.session.session?.subject,d.subject(0));assert.equal(b.session.lastChange.cause,'restored');
  await d.signIn(a,1);await settle();assert.deepEqual(subjects(b),[d.subject(0),d.subject(1)]);assert.equal(b.session.session.subject,d.subject(0),'a held current account is not switched by another tab');
  // The most recently selected account is current after a reload.
  a.session.selectAccount(d.subject(0));await a.session.client.flushPersistence();
  const c=await d.tab();assert.equal(c.session.session.subject,d.subject(0));assert.deepEqual(new Set(subjects(c)),new Set([d.subject(0),d.subject(1)]));
});

test('records are per client scope and per (issuer, subject); a record for another client or a malformed one is ignored and erased',async()=>{
  const d=device(),a=await d.tab();await d.signIn(a,0);
  const [[id,record]]=d.backend.records;
  d.backend.records.set('foreign',{...record,scope:JSON.stringify(['other','https://other.example/callback'])});
  d.backend.records.set(id+'x',{...record,subject:'https://evil.example/people/x'});
  const b=await d.tab();assert.deepEqual(subjects(b),[d.subject(0)]);await settle();
  assert.ok(d.backend.records.has('foreign'),'another client\'s record is not touched');
});

test('seeded chaos: tabs, reloads, sign-ins, per-account and full sign-outs, refreshes, clock and storage events keep the invariants',async()=>{
  const seed=Number(process.env.SEED??20261029);
  for(let run=0;run<4;run++){
    const random=rng(seed+run),pick=list=>list[Math.floor(random()*list.length)];
    const d=device();const open=[await d.tab(),await d.tab()];const signedOut=new Set();let wiped=false;
    for(let step=0;step<40;step++){
      const t=pick(open),roll=random(),label=`seed ${seed+run} step ${step}`;
      if(process.env.CHAOS_TRACE)console.log(label,'tab',open.indexOf(t),'roll',roll.toFixed(3),'held',open.map(x=>x.session.sessions.map(v=>d.provider.accounts.findIndex(a=>a.subject===v.subject)).join('')),'records',records(d).map(r=>d.provider.accounts.findIndex(a=>a.subject===r.subject)).join(''));
      try{
        if(roll<0.25){const index=Math.floor(random()*3);await d.signIn(t,index);signedOut.delete(d.subject(index));}
        else if(roll<0.45){if(t.session.client.session)await t.session.client.refresh().catch(error=>{assert.ok(['revoked','signed-out','network-error'].includes(error?.code)||/Sign in again/.test(error.message),`${label}: ${error.message}`);});}
        else if(roll<0.55){const held=t.session.sessions;if(held.length){const s=pick(held).subject;await t.session.signOut({subject:s});signedOut.add(s);}}
        else if(roll<0.6){for(const view of t.session.sessions)signedOut.add(view.subject);await t.session.signOut();}
        else if(roll<0.75){t.close();open.splice(open.indexOf(t),1,await d.tab());}
        else if(roll<0.82){open.push(await d.tab());if(open.length>4)open.shift().close();}
        else if(roll<0.88)d.advance(Math.floor(random()*120000));
        else if(roll<0.9){d.backend.wipe();wiped=true;}
        else if(t.session.sessions.length>1)t.session.selectAccount(pick(t.session.sessions).subject);
      }catch(error){throw new Error(`${label}: ${error.stack}`);}
      await settle();
      // Invariants.
      for(const record of records(d)){assert.equal(record.key.privateKey.extractable,false,label);assert.equal(JSON.stringify(record).includes('access-'),false,label);}
      for(const s of signedOut){assert.ok(!records(d).some(r=>r.subject===s),`${label}: a signed-out account stays erased`);for(const x of open)assert.ok(!x.session.sessions.some(v=>v.subject===s),`${label}: a signed-out account is gone from every tab`);}
      for(const x of open)assert.ok(x.session.sessions.length<=8,label);
      const tokens=d.presented.map(p=>p.token);assert.equal(new Set(tokens).size,tokens.length,`${label}: no refresh token is ever presented twice`);
      if(!wiped)assert.equal(d.provider.revokedFamilies.size,0,`${label}: serialized rotation never trips reuse detection`);
    }
  }
});
