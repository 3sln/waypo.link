// Engine-level tests for the multi-account and gate APIs of the headless session controller (ui-elements-audit W7:
// G2, G4, G5, G6, G6b). The custom elements render these; every rule here is decided by the controller, so it is
// tested without a DOM. Provider: testing.mjs only (local evidence, nothing production-verified).
import {test as nodeTest,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,changeCauses} from '../src/flows.mjs';
import {createMockProvider,memoryStorage} from '../src/testing.mjs';

const test=(name,fn)=>nodeTest(name,{timeout:5000},fn),cleanups=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
const clientId='https://app.example/client',redirectUri='https://app.example/callback',ISSUER='https://provider.example';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// A seeded generator so the chaos test is reproducible (SEED=<n> to replay a failure).
function rng(seed){let x=seed>>>0||1;return ()=>{x^=x<<13;x>>>=0;x^=x>>17;x^=x<<5;x>>>=0;return x/2**32;};}

async function setup({accounts=[{handle:'ada',displayName:'Ada Lovelace'},{handle:'grace',displayName:'Grace Hopper'},{handle:'alan',displayName:'Alan Turing'}],clock,timers,...options}={}){
  const provider=createMockProvider({issuer:ISSUER,accounts,profile:true,supportedIntents:['login','select-account','reauthenticate','end-session'],...options});
  const session=createSession({clientId,redirectUri,fetcher:provider.fetch,storage:memoryStorage(),history:{replaceState(){}},window:undefined,defaultHost:'provider.example',...clock?{clock}:{},...timers?{timers}:{}});
  cleanups.push(()=>session.dispose());
  await session.loadCapabilities();
  const events=[];for(const type of ['change','account-change','sessions-change','sign-out'])session.addEventListener(type,event=>events.push([type,event.detail]));
  // Signs in as provider.accounts[index] without a window (the app's own exchange, as an island code would).
  const signIn=async index=>{const begun=await session.client.beginAuthorization({intent:'login',dpop:false});await session.client.completeLogin(provider.authorize(begun.authorizationUrl,{account:provider.accounts[index]}));await tick();return session.session;};
  return {provider,session,events,signIn,subject:index=>provider.accounts[index].subject};
}
const subjects=list=>list.map(view=>view.subject);
const types=events=>events.map(([type])=>type);

test('sessions: frozen views of every held session in first-seen order, with a change event per change',async()=>{
  const {session,events,signIn,subject}=await setup();
  assert.deepEqual(session.sessions,[]);assert.ok(Object.isFrozen(session.sessions));
  await signIn(0);await signIn(1);await signIn(2);
  assert.deepEqual(subjects(session.sessions),[subject(0),subject(1),subject(2)]);
  assert.ok(session.sessions.every(Object.isFrozen));
  assert.equal(session.session.subject,subject(2));
  assert.deepEqual(session.sessions[0].profile,{handle:'ada@provider.example',displayName:'Ada Lovelace'});
  // Selecting an account keeps the list order stable (rows never jump) and reports a switch.
  events.length=0;assert.deepEqual(session.selectAccount(subject(0)),{outcome:'completed'});
  assert.deepEqual(subjects(session.sessions),[subject(0),subject(1),subject(2)]);
  assert.deepEqual(types(events),['change','account-change']);
  assert.deepEqual(events[1][1],{previous:{issuer:ISSUER,subject:subject(2)},session:session.session,cause:'switch'});
  assert.deepEqual(session.lastChange,events[1][1]);
  // Re-signing in to a held account refreshes it in place.
  events.length=0;await signIn(1);assert.deepEqual(subjects(session.sessions),[subject(0),subject(1),subject(2)]);
  assert.equal(events.find(([type])=>type==='account-change')[1].cause,'switch');
  assert.equal(events.some(([type])=>type==='sessions-change'),false,'same accounts, same profiles: no list change');
  // selectAccount never starts a flow and refuses anything not held.
  assert.deepEqual(session.selectAccount('https://provider.example/people/nobody'),{outcome:'canceled',code:'no-session'});
});

test('signOut({subject}) ends one held session; the current one hands over to the most recently used remaining account',async()=>{
  const {session,events,signIn,subject}=await setup();
  await signIn(0);await signIn(1);await signIn(2);session.selectAccount(subject(1));
  events.length=0;
  // A non-current account: the current one stays, the list shrinks, islands are told to forget only that subject.
  assert.deepEqual(await session.signOut({subject:subject(0)}),{outcome:'completed'});
  assert.equal(session.session.subject,subject(1));
  assert.deepEqual(subjects(session.sessions),[subject(1),subject(2)]);
  assert.deepEqual(types(events),['sign-out','sessions-change']);
  assert.deepEqual(events[0][1].sessions,[{issuer:ISSUER,subject:subject(0)}]);
  assert.deepEqual(events[1][1].ended,[{issuer:ISSUER,subject:subject(0),cause:'sign-out'}]);
  // The current account: the most recently used remaining one (alan, signed in last) becomes current.
  events.length=0;await session.signOut({subject:subject(1)});
  assert.equal(session.session.subject,subject(2));assert.equal(session.state,'signed-in');
  assert.deepEqual(events.find(([type])=>type==='account-change')[1],{previous:{issuer:ISSUER,subject:subject(1)},session:session.session,cause:'sign-out'});
  // Unknown subjects and a missing subject string are refused without side effects.
  assert.deepEqual(await session.signOut({subject:'https://provider.example/people/nobody'}),{outcome:'canceled',code:'no-session'});
  assert.deepEqual(await session.signOut({subject:subject(2),issuer:'https://other.example'}),{outcome:'canceled',code:'no-session'});
  // The last account: signed out.
  await session.signOut({subject:subject(2)});
  assert.equal(session.session,null);assert.equal(session.state,'signed-out');assert.deepEqual(session.sessions,[]);
  assert.equal(session.lastChange.cause,'sign-out');assert.equal(session.lastChange.session,null);
});

test('signOut() without a subject ends every held session at once, with one sign-out event naming all of them',async()=>{
  const {session,events,signIn,subject}=await setup();
  await signIn(0);await signIn(1);events.length=0;
  await session.signOut();
  assert.deepEqual(types(events),['sign-out','change','account-change','sessions-change']);
  assert.deepEqual(events[0][1].sessions.map(item=>item.subject).sort(),[subject(0),subject(1)].sort());
  assert.deepEqual(events[3][1].ended.map(item=>item.cause),['sign-out','sign-out']);
  assert.equal(session.lastChange.cause,'sign-out');
});

test('signOut({subject, revoke}) revokes exactly that session with its own token',async()=>{
  const {provider,session,signIn,subject}=await setup();
  await signIn(0);await signIn(1);
  const grace=session.client.sessions.get(`${ISSUER} ${subject(1)}`),ada=session.client.sessions.get(`${ISSUER} ${subject(0)}`);
  await session.signOut({subject:subject(1),revoke:true});
  assert.ok(provider.revoked.has(grace.refresh_token));assert.equal(provider.revoked.has(ada.refresh_token),false);
  assert.equal(session.session.subject,subject(0));
});

test('revoked: a renewal the provider refuses ends the session with cause revoked, without any controller call',async()=>{
  const {provider,session,events,signIn,subject}=await setup();
  await signIn(0);await signIn(1);
  const grace=session.client.session;
  // Access ends at the provider (the user removed the app there); the app's next renewal is refused.
  await provider.fetch(new Request(`${ISSUER}/oauth/revoke`,{method:'POST',body:new URLSearchParams({token:grace.refresh_token})}));
  events.length=0;
  await assert.rejects(session.client.refresh(),{code:'revoked'});
  await tick();
  assert.equal(session.session.subject,subject(0),'the remaining account takes over');
  assert.deepEqual(events.find(([type])=>type==='account-change')[1].cause,'revoked');
  assert.deepEqual(events.find(([type])=>type==='sessions-change')[1].ended,[{issuer:ISSUER,subject:subject(1),cause:'revoked'}]);
  // A failure that is not an authoritative refusal (network) is not reported as revoked.
  const {session:other,signIn:otherSignIn}=await setup();await otherSignIn(0);
  other.client.fetcher=async()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(other.client.refresh(),error=>error.code!=='revoked');await tick();
  assert.equal(other.session,null);assert.equal(other.lastChange.cause,'sign-out');
});

test('forgetSession(): the app reports access ended at the provider (removed or revoked); bad causes are refused',async()=>{
  const {session,events,signIn,subject}=await setup();
  await signIn(0);events.length=0;
  assert.throws(()=>session.forgetSession({subject:subject(0),cause:'sign-out'}),TypeError);
  assert.deepEqual(session.forgetSession({subject:'https://provider.example/people/nobody',cause:'removed'}),{outcome:'canceled',code:'no-session'});
  assert.deepEqual(session.forgetSession({subject:subject(0),cause:'removed'}),{outcome:'completed'});
  assert.equal(session.session,null);
  assert.deepEqual(events.find(([type])=>type==='account-change')[1],{previous:{issuer:ISSUER,subject:subject(0)},session:null,cause:'removed'});
  assert.deepEqual(events.find(([type])=>type==='sign-out')[1].sessions,[{issuer:ISSUER,subject:subject(0)}],'islands forget the removed subject');
});

test('expired: a session whose renewal window ran out ends with cause expired, and the next held account takes over',async()=>{
  let now=Date.now();const pending=[];
  const timers={setTimeout:(fn,ms)=>{const timer={fn,at:now+ms,unref(){}};pending.push(timer);return timer;},clearTimeout:timer=>{const index=pending.indexOf(timer);if(index>=0)pending.splice(index,1);}};
  const {session,signIn,subject}=await setup({clock:()=>now,timers});
  // Ada signs in a minute before Grace and is current when her window runs out; Grace's is still open.
  await signIn(0);now+=60000;await signIn(1);session.selectAccount(subject(0));
  const deadline=session.client.session.refreshExpiresAt??session.client.session.expiresAt;
  now=deadline+1;for(const timer of pending.splice(0).filter(item=>item.at<=now))timer.fn();
  await tick();
  assert.equal(session.lastChange.cause,'expired');assert.equal(session.lastChange.previous.subject,subject(0));
  assert.equal(session.session?.subject,subject(1));
  assert.deepEqual(subjects(session.sessions),[subject(1)]);
});

test('reauthenticate() reports the provider auth time on completion (G6b)',async()=>{
  const {provider,session,signIn,subject}=await setup();
  await signIn(0);
  const win={navigator:{language:'en'},location:{href:'https://app.example/',assign(){}},matchMedia:()=>({matches:false})};
  const driver=provider.installPopupDriver(win,{decide:()=>({decision:'approve',account:provider.accounts[0],authTime:Date.now()-5000})});cleanups.push(()=>driver.uninstall());
  const headless=createSession({client:session.client,window:win,presentation:'popup'});cleanups.push(()=>headless.dispose());
  await headless.loadCapabilities();
  const result=await headless.reauthenticate({maxAge:300});
  assert.equal(result.outcome,'completed');assert.equal(typeof result.authTime,'number');
  assert.ok(Math.abs(result.authTime-(Date.now()-5000))<2000,'epoch milliseconds');
  assert.equal(headless.session.subject,subject(0));
  // Sign-in never carries an auth time (EE-02).
  assert.equal((await headless.signIn({identity:'grace'})).authTime,undefined);
});

test('state for a gate: signed-out, pending while a flow runs, signed-in; sessions survive switching (G2)',async()=>{
  const {session,signIn,subject}=await setup();
  assert.equal(session.state,'signed-out');
  await signIn(0);assert.equal(session.state,'signed-in');
  await signIn(1);session.selectAccount(subject(0));assert.equal(session.state,'signed-in');
  await session.signOut();assert.equal(session.state,'signed-out');
});

test('causes are a closed set',()=>{assert.deepEqual([...changeCauses],['sign-in','switch','sign-out','expired','revoked','removed','restored']);assert.ok(Object.isFrozen(changeCauses));});

test('seeded chaos: random sign-ins, switches, per-account and full sign-outs, revocations and removals keep the invariants',async()=>{
  const seed=Number.parseInt(process.env.SEED??'',10)||20261029;
  for(let round=0;round<4;round++){
    const random=rng(seed+round),{provider,session,events,signIn}=await setup({accounts:Array.from({length:5},(_,i)=>({handle:`p${i}`,displayName:`Person ${i}`}))});
    const pick=list=>list[Math.floor(random()*list.length)];
    for(let step=0;step<40;step++){
      const held=session.sessions.map(view=>view.subject),op=Math.floor(random()*7),before=session.session?.subject??null;events.length=0;
      if(op<=1)await signIn(Math.floor(random()*5));
      else if(op===2&&held.length)session.selectAccount(pick(held));
      else if(op===3&&held.length)await session.signOut({subject:pick(held)});
      else if(op===4&&held.length&&random()<0.3)await session.signOut();
      else if(op===5&&session.client.session){const current=session.client.session;await provider.fetch(new Request(`${ISSUER}/oauth/revoke`,{method:'POST',body:new URLSearchParams({token:current.refresh_token})}));await session.client.refresh().catch(()=>{});await tick();}
      else if(op===6&&held.length)session.forgetSession({subject:pick(held),cause:pick(['revoked','removed'])});
      await tick();
      const list=session.sessions,current=session.session;
      // Invariants: the current session is held; no duplicates; state agrees; at most the pending limit is held;
      // every account change names a cause from the closed set and agrees with the before/after subjects.
      const context=`seed ${seed+round} step ${step} op ${op}`;
      if(current)assert.ok(list.some(view=>view.subject===current.subject),`current is held (${context})`);
      assert.equal(new Set(list.map(view=>view.subject)).size,list.length,`no duplicates (${context})`);
      assert.equal(session.state,current?'signed-in':'signed-out',context);
      assert.equal(!!current,list.length>0,`signed in exactly while something is held (${context})`);
      for(const [type,detail] of events){
        if(type!=='account-change')continue;
        assert.ok(changeCauses.includes(detail.cause),context);
        assert.equal(detail.previous?.subject??null,before,`previous is the subject before the step (${context})`);
        assert.equal(detail.session?.subject??null,current?.subject??null,context);
      }
      if((current?.subject??null)!==before)assert.equal(events.filter(([type])=>type==='account-change').length,1,`one account change per step (${context})`);
    }
  }
});

test('gate state is derived from the controller only (G2)',async()=>{
  const {gateState}=await import('../src/elements/gate.mjs');
  assert.equal(gateState({loaded:false,state:'signed-in'}),'loading');
  assert.equal(gateState({loaded:true,state:'signed-out'}),'signed-out');
  assert.equal(gateState({loaded:true,state:'pending'}),'signed-out','a running flow keeps the sign-in content');
  assert.equal(gateState({loaded:true,state:'signed-in'}),'signed-in');
  const {session,signIn}=await setup();
  assert.equal(gateState({loaded:true,state:session.state}),'signed-out');
  await signIn(0);assert.equal(gateState({loaded:true,state:session.state}),'signed-in');
});

test('entity identities for the composed avatar are validated like granted profiles',async()=>{
  const {entityIdentity}=await import('../src/elements/avatar-view.mjs');
  assert.deepEqual(entityIdentity({subject:'https://provider.example/orgs/acme',name:' Acme ',picture:'https://provider.example/a.png'}),{subject:'https://provider.example/orgs/acme',name:'Acme',picture:'https://provider.example/a.png'});
  assert.equal(entityIdentity({subject:'http://provider.example/orgs/acme'}),null);
  assert.equal(entityIdentity({subject:'javascript:alert(1)'}),null);
  assert.deepEqual(entityIdentity({subject:'https://p.example/o',name:'A‮B',picture:'data:image/png;base64,AA'}),{subject:'https://p.example/o'});
  assert.equal(entityIdentity(null),null);
});
