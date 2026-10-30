// Persisted app sessions (ui-elements-audit W11, account-chooser-island §5.4) against the REAL entry, token, revocation
// and embed handlers: the SDK persists only DPoP-bound sessions the provider advertises an idle lifetime for, restores
// them in a new document, serializes rotation across documents, and the provider's reuse detection ends the family and
// its paired component credential. Local evidence only (in-memory stores, simulated provider page).
import test from 'node:test';
import assert from 'node:assert/strict';
import {withExtensionEntries} from '../packages/core/extensions.mjs';
import {createSession} from '../packages/sdk/src/flows.mjs';
import {memoryStorage,memorySessionBackend} from '../packages/sdk/src/testing.mjs';
import {handleCallback} from '../packages/sdk/src/callback.mjs';
import {EMBED_PROOF_TYP} from '../packages/federation/dpop.mjs';
import {provider,post,createEntry,providerPage,pageHeaders,exchange,refresh,dpopKey,tokenNonce,embedHeaders,embedNonce,issuer,embedOrigin,clientId,redirectUri} from './authorization-entry-helpers.mjs';
const host=new URL(issuer).host;

// The provider page outcome for an entry URL (see authorization-entry-sdk-contract.test.mjs).
async function authorize(p,url){const entryId=new URL(url).searchParams.get('entry'),session=p.signIn(p.accounts[0]);return (await providerPage(p,entryId,session)).result.redirectUri;}
function fakeWindow(p){
 const win={navigator:{language:'en'},location:{href:'https://app.example/',assign(){}},matchMedia:()=>({matches:false})};
 win.open=()=>{const popup={closed:false,opener:win,document:{title:'',body:{textContent:''}},close(){popup.closed=true;},focus(){},location:{}};
  Object.defineProperty(popup.location,'href',{get:()=>popup.url,set:value=>{popup.url=value;if(new URL(value).origin!==issuer)return;queueMicrotask(async()=>{const callback=await authorize(p,value);await handleCallback({location:{href:callback},history:{replaceState(){}},storage:memoryStorage(),BroadcastChannel:globalThis.BroadcastChannel,render:false,close:false});});}});
  return popup;};
 return win;
}
// The served manifest plus the entry extension and `popup` (the reference runtime keeps entry routes unmounted, F8).
function declared(p){return async(input,init)=>{const response=await p.fetch(input,init),url=new URL(input instanceof Request?input.url:input);if(url.pathname!=='/.well-known/bindle/manifest.json'||!response.ok)return response;const manifest=await response.json(),entry=p.entries.manifest();return new Response(JSON.stringify({...withExtensionEntries(manifest,entry.extensions??[],{merge:true}),login_presentation:['redirect','popup']}),{status:200,headers:{'Content-Type':'application/json'}});};}
const settle=async()=>{for(let i=0;i<6;i++){await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setImmediate(resolve));}};
async function tab(p,backend,cleanups){
 const store=backend.handle(),session=createSession({clientId,redirectUri,fetcher:declared(p),storage:memoryStorage(),history:{replaceState(){}},window:fakeWindow(p),defaultHost:host,sessionStore:store,clock:p.clock,timers:{setTimeout:()=>0,clearTimeout(){}}});
 cleanups.push(()=>{session.dispose();store.close();});await session.restored;await session.loadCapabilities();return session;
}

test('W11 contract: an interactive DPoP-bound sign-in persists, a new document restores it and renews against the real provider',async t=>{
 const p=await provider(),backend=memorySessionBackend(),cleanups=[];t.after(()=>cleanups.forEach(fn=>fn()));
 const manifest=await(await declared(p)(`${issuer}/.well-known/bindle/manifest.json`)).json();assert.ok(manifest.dpop_signing_alg_values_supported.includes('ES256'));
 const a=await tab(p,backend,cleanups);
 assert.deepEqual(await a.signIn({identity:'alex'}),{outcome:'completed'});
 const issued=a.client.session;assert.ok(issued.dpopJkt);assert.ok(Number.isSafeInteger(issued.refresh_idle_expires_in),'the provider advertises the idle lifetime');
 const [record]=backend.records.values();assert.equal(record.subject,p.accounts[0].subject);assert.equal(record.key.privateKey.extractable,false);assert.equal(record.refreshToken,issued.refresh_token);
 const b=await tab(p,backend,cleanups);
 assert.equal(b.state,'signed-in');assert.equal(b.lastChange.cause,'restored');assert.equal(b.session.subject,p.accounts[0].subject);
 const renewed=await b.client.refresh();assert.notEqual(renewed.refresh_token,issued.refresh_token);assert.equal([...backend.records.values()][0].refreshToken,renewed.refresh_token);
 // Tab a still holds the rotated-away token in memory; its next renewal adopts the stored successor under the lock.
 const again=await a.client.refresh();assert.notEqual(again.refresh_token,renewed.refresh_token);assert.equal(a.state,'signed-in');assert.equal(b.state,'signed-in');
 // Sign-out deletes the record and revokes the latest token: the family is gone at the provider.
 await a.signOut({revoke:true});assert.equal(backend.records.size,0);await settle();assert.equal(b.state,'signed-out');
 const proofKey=await dpopKey();assert.equal((await refresh(p,again.refresh_token,{dpop:await proofKey.sign({htu:`${issuer}/oauth/token`,nonce:await tokenNonce(p),iat:Math.floor(p.clock()/1000)})})).status,400);
});

test('W11 contract: a stale stored refresh token is reuse at the real provider (past its 30 s grace): the family ends and the SDK erases it',async t=>{
 const p=await provider(),backend=memorySessionBackend(),cleanups=[];t.after(()=>cleanups.forEach(fn=>fn()));
 const a=await tab(p,backend,cleanups);await a.signIn({identity:'alex'});
 const [[id,stale]]=backend.records;const snapshot={...stale};
 await a.client.refresh();p.time.advance(31000);
 backend.records.set(id,snapshot);
 const b=await tab(p,backend,cleanups);
 await assert.rejects(b.client.refresh(),{code:'revoked'});await settle();
 assert.equal(backend.records.size,0);assert.equal(b.state,'signed-out');assert.equal(b.lastChange.cause,'revoked');
 assert.equal(a.state,'signed-out','the other tab follows the erased record');
});

test('provider: reuse of a DPoP-bound refresh token revokes the family and its paired component credential',async()=>{
 const p=await provider(),app=await dpopKey(),frame=await dpopKey(),api=path=>`${embedOrigin}/embed/api/${path}`,iat=()=>Math.floor(p.clock()/1000);
 const {entryId,verifier}=await createEntry(p,{delivery:'embed-popup',embedJkt:frame.jkt,dpopJkt:app.jkt},{Origin:embedOrigin});
 const view=await p.entries.view(entryId),challenge=await(await post(p,`${issuer}/oauth/entries/${entryId}/embed-challenge`,{},pageHeaders(view))).json();
 const {pageSecret}=await(await post(p,`${issuer}/oauth/entries/${entryId}/embed-verify`,{proof:await frame.sign({typ:EMBED_PROOF_TYP,htu:`${issuer}/oauth/entries/${entryId}/embed-verify`,nonce:challenge.challenge,claims:{entry:entryId},iat:iat()})},pageHeaders(view))).json();
 const {result}=await providerPage(p,entryId,p.signIn(),{pageSecret});assert.ok(result?.claim&&result?.code,'the flow delivered a component claim and an app code');
 const {credential}=await(await post(p,api('claim'),{claim:result.claim},embedHeaders({DPoP:await frame.sign({htu:api('claim'),nonce:await embedNonce(p),ath:result.claim,iat:iat()})}))).json();
 const startSession=async()=>p.fetch(api('session'),{method:'POST',headers:embedHeaders({Authorization:`BindleEmbed ${credential}`,DPoP:await frame.sign({htu:api('session'),nonce:await embedNonce(p),ath:credential,iat:iat()})})});
 const tokenURL=`${issuer}/oauth/token`,renew=async token=>refresh(p,token,{dpop:await app.sign({htu:tokenURL,nonce:await tokenNonce(p),iat:iat()})});
 const token=await(await exchange(p,result.code,verifier,{dpop:await app.sign({htu:tokenURL,nonce:await tokenNonce(p),iat:iat()})})).json();
 assert.ok(Number.isSafeInteger(token.refresh_idle_expires_in));assert.equal((await startSession()).status,200);
 const rotated=await(await renew(token.refresh_token)).json();assert.ok(rotated.refresh_token);
 p.time.advance(31000);
 const reused=await renew(token.refresh_token);assert.equal(reused.status,400);assert.equal((await reused.json()).error,'invalid_grant');
 assert.equal((await renew(rotated.refresh_token)).status,400,'the successor died with the family');
 assert.equal((await startSession()).status,401,'the paired component credential died with the family');
});
