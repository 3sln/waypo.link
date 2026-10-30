// Persisted app sessions in real browsers (ui-elements-audit W11, account-chooser-island §5.4), Chromium and Firefox:
// a DPoP-bound session survives a reload (real IndexedDB, structured-cloned non-extractable CryptoKey, Web Locks,
// BroadcastChannel), two tabs renew without tripping reuse detection, sign-out in one tab signs the other out, nothing
// token-like reaches localStorage, sessionStorage or cookies, and storage that refuses to open (some private modes)
// falls back to memory without hanging.
//
// app.example serves the SDK from this checkout via Playwright routes; provider.example is testing.mjs's mock running
// in THIS process (so its refresh families survive page reloads), behind CORS like a real provider. Local evidence only.
//
// Run:   node --test tests/browser/persisted-sessions-browser.mjs   (also part of npm run test:elements-gallery)
// Env:   PERSIST_ENGINES=chromium,firefox
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox} from 'playwright';
import {createMockProvider} from '../../packages/sdk/src/testing.mjs';

const project=resolve(new URL('../..',import.meta.url).pathname);
const APP='https://app.example',ISSUER='https://provider.example';
const engines=(process.env.PERSIST_ENGINES??'chromium,firefox').split(',').map(s=>s.trim()).filter(Boolean);

const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notes</title></head><body><div id="slot"></div>
<script type="module">
import {BindleClient} from '/packages/sdk/src/identity.mjs';
import {memoryStorage} from '/packages/sdk/src/testing.mjs';
import '/packages/sdk/src/define.mjs';
window.events=[];
const client=new BindleClient({clientId:'${APP}/client',redirectUri:'${APP}/callback',defaultHost:'provider.example'});
const session=document.createElement('bindle-session');session.client=client;
session.innerHTML='<bindle-sign-in></bindle-sign-in>';
// The first state descendants render is recorded before any restore completes.
window.firstSignInText=null;
document.addEventListener('bindle-session-change',e=>window.events.push(['change',e.detail?.subject??null,session.lastChange?.cause??null]));
document.getElementById('slot').append(session);
queueMicrotask(()=>{const el=document.querySelector('bindle-sign-in');window.firstState=session.state;window.firstSignInText=el.shadowRoot?.textContent??'';});
await session.ready;
window.signIn=async()=>{
  await client.discoverHost('provider.example');
  const begun=await client.beginAuthorization({intent:'login',presentation:'popup'});
  const callback=await (await fetch('${ISSUER}/test/authorize?url='+encodeURIComponent(begun.authorizationUrl))).text();
  await client.completeLogin(callback);return session.state;
};
window.rpc=async()=>(await client.rpc({resource:'@preferences',contract:'x',method:'read'})).result.subject;
window.ready=true;
</script></body></html>`;

async function harness(browserType,{privateMode=false}={}){
  const browser=await browserType.launch();
  const ctx=await browser.newContext({ignoreHTTPSErrors:true});
  const provider=createMockProvider({issuer:ISSUER,accounts:[{handle:'ada',displayName:'Ada Lovelace'}],profile:true,declaration:'full',fedcm:false,reuseDetection:true,clients:[{clientId:APP+'/client',redirectUris:[APP+'/callback']}]});
  const cors={'access-control-allow-origin':APP,'access-control-allow-headers':'content-type,dpop,authorization,accept','access-control-allow-methods':'GET,POST','access-control-expose-headers':'DPoP-Nonce,WWW-Authenticate','vary':'origin'};
  if(privateMode)await ctx.addInitScript(()=>{
    // Storage that exists but refuses to open, as in private browsing modes that block IndexedDB.
    const refuse=()=>{const request={result:undefined,error:new DOMException('The operation is insecure.','SecurityError'),onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null};setTimeout(()=>request.onerror?.({target:request}),0);return request;};
    Object.defineProperty(IDBFactory.prototype,'open',{value:refuse,configurable:true});
  });
  await ctx.route('https://**/*',async route=>{const req=route.request(),url=new URL(req.url());try{
    if(url.origin===APP&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:page});
    if(url.origin===ISSUER){
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      if(url.pathname==='/test/authorize')return route.fulfill({status:200,headers:{...cors,'content-type':'text/plain'},body:provider.authorize(url.searchParams.get('url'))});
      const headers=Object.fromEntries(Object.entries(req.headers()).filter(([name])=>!name.startsWith(':')));
      const response=await provider.handle(new Request(req.url(),{method:req.method(),headers,body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()}));
      return route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),...cors},body:Buffer.from(await response.arrayBuffer())});
    }
    if(url.origin!==APP||!['/packages/','/vendor/'].some(p=>url.pathname.startsWith(p)))return route.abort();
    const file=resolve(project,'.'+url.pathname);if(!file.startsWith(project+'/'))return route.abort();
    return route.fulfill({contentType:'text/javascript',body:await readFile(file)});
  }catch(error){return route.fulfill({status:500,body:String(error)}).catch(()=>{});}});
  const open=async()=>{const p=await ctx.newPage();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.goto(APP+'/');await p.waitForFunction(()=>window.ready===true,null,{timeout:15000});return p;};
  return {browser,ctx,provider,open,close:()=>browser.close()};
}
const leaks=p=>p.evaluate(()=>({local:JSON.stringify({...localStorage}),session:JSON.stringify({...sessionStorage}),cookie:document.cookie}));

for(const engine of engines){
  const type={chromium,firefox}[engine];
  test(`${engine}: a reload keeps the DPoP-bound session; tabs renew without reuse; sign-out follows across tabs`,{timeout:90000},async()=>{
    const h=await harness(type);
    try{
      const a=await h.open();
      assert.equal(await a.evaluate(()=>window.signIn()),'signed-in');
      assert.equal(await a.evaluate(()=>window.rpc()),h.provider.accounts[0].subject);
      // Nothing token-like outside IndexedDB.
      for(const value of Object.values(await leaks(a)))assert.equal(/refresh-|access-/.test(value),false,`token material outside IndexedDB: ${value}`);
      await a.reload();await a.waitForFunction(()=>window.ready===true);
      // Before the restore finished, the sign-in element showed the restoring state, never the form.
      assert.equal(await a.evaluate(()=>window.firstState),'restoring');
      assert.equal(await a.evaluate(()=>/Your handle/.test(window.firstSignInText)),false,'no flash of the signed-out form');
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').state),'signed-in');
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').lastChange.cause),'restored');
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').persistence),'device');
      assert.match(await a.evaluate(()=>document.querySelector('bindle-sign-in').shadowRoot.textContent),/Ada Lovelace/);
      assert.equal(await a.evaluate(()=>window.rpc()),h.provider.accounts[0].subject,'the restored session renews and calls');
      // A second tab restores the same account; concurrent renewals in both tabs are serialized (Web Locks).
      const b=await h.open();
      assert.equal(await b.evaluate(()=>document.querySelector('bindle-session').state),'signed-in');
      for(let round=0;round<3;round++)await Promise.all([a,b].map(p=>p.evaluate(()=>document.querySelector('bindle-session').client.refresh().then(()=>true))));
      assert.equal(h.provider.revokedFamilies.size,0,'no refresh-token reuse across tabs');
      // Sign-out in tab a erases the record; tab b signs out over BroadcastChannel.
      await a.evaluate(()=>document.querySelector('bindle-session').signOut({revoke:true}));
      await b.waitForFunction(()=>document.querySelector('bindle-session').state==='signed-out',null,{timeout:5000});
      await a.reload();await a.waitForFunction(()=>window.ready===true);
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').state),'signed-out');
      assert.deepEqual([...a.errors,...b.errors],[]);
    }finally{await h.close();}
  });
  test(`${engine}: storage that refuses to open (private mode) falls back to memory and never hangs`,{timeout:60000},async()=>{
    const h=await harness(type,{privateMode:true});
    try{
      const a=await h.open();
      assert.equal(await a.evaluate(()=>window.signIn()),'signed-in');
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').persistence),'memory');
      assert.equal(await a.evaluate(()=>window.rpc()),h.provider.accounts[0].subject);
      for(const value of Object.values(await leaks(a)))assert.equal(/refresh-|access-/.test(value),false);
      await a.reload();await a.waitForFunction(()=>window.ready===true);
      assert.equal(await a.evaluate(()=>document.querySelector('bindle-session').state),'signed-out');
      assert.deepEqual(a.errors,[]);
    }finally{await h.close();}
  });
}
