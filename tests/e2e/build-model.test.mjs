import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {launch,baseURL,waitForApp} from './browser.mjs';

test('content-addressed import map, CSS and isolated worker have immutable policies while the shell revalidates',async t=>{
 const browser=await launch();t.after(()=>browser.close());const page=await browser.newPage();await waitForApp(page);
 const html=await (await page.request.get(baseURL+'/console')).text();const policy=(await page.request.get(baseURL+'/console')).headers()['content-security-policy'];const meta=/<meta name="bindle-import-map-csp" content="([^"]+)">/.exec(html)?.[1];assert.ok(meta&&policy.includes("'"+meta+"'"));
 const preloads=[...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(match=>match[1]);
 assert.ok(preloads.length>=2,'The static entry closure is parser-visible');
 assert.equal(new Set(preloads).size,preloads.length);
 assert.ok(preloads.every(url=>/^\/assets\/.+\.[a-f0-9]{10}\.(?:mjs|js)$/.test(url)));
 assert.ok(!preloads.some(url=>/\/console\.[a-f0-9]{10}\.mjs$/.test(url)));
 assert.ok(!preloads.some(url=>/\/(?:admin-entry|demo-main)\./.test(url)));
 assert.ok(html.indexOf('<script src=')<html.indexOf('<link rel="modulepreload"'),'Install the CSP-authorized map before fetching modules');
 const manifest=await(await page.request.get(baseURL+'/build-manifest.json')).json();const imports=await page.evaluate(()=>JSON.parse(document.querySelector('script[type=importmap]').textContent).imports);
 const consoleBundle=imports['/src/release.mjs'];
 assert.ok(!manifest.assets.some(url=>/\/apps\/web\/src\/release\.[a-f0-9]+\.mjs$/.test(url)));
 assert.doesNotMatch(await(await page.request.get(baseURL+'/sw.js')).text(),/apps\/web\/src\/release\.[a-f0-9]+\.mjs/);
 await page.locator(`link[rel=modulepreload][href$="${consoleBundle}"]`).waitFor({state:'attached'});
 const bundleSource=await (await page.request.get(baseURL+consoleBundle)).text();
 assert.ok(bundleSource.includes(JSON.stringify(imports['/packages/recovery/index.mjs'])),'Recovery stays dynamically split');
 assert.ok(bundleSource.includes(JSON.stringify(imports['/src/providers/onboarding-entry.mjs'])),'The bundle imports the same one-use capability module as main');
 assert.equal(imports['/vendor/dodo/index.js'],imports['/assets/vendor/dodo/index.js']);assert.equal(imports['/packages/identity/handles.mjs'],manifest.imports['/packages/identity/handles.mjs']);
 for(const url of [consoleBundle,manifest.entries.app.module,manifest.entries.app.css,manifest.entries.app.wireup,manifest.workers.recovery]){assert.match(url,/\.[a-f0-9]{10}\.(?:mjs|js|css)$/);const response=await page.request.get(baseURL+url);assert.equal(response.status(),200);assert.match(response.headers()['cache-control'],/immutable/);}
 assert.equal((await page.request.get(baseURL+'/console')).headers()['cache-control'],'no-store');
 const worker=await page.request.get(baseURL+manifest.workers.recovery);assert.match(worker.headers()['content-security-policy'],/wasm-unsafe-eval/);
 const raw=await page.request.get(baseURL+'/src/main.mjs');assert.equal(raw.status(),404);
});

test('public SDK embeds from another origin with no import map and follows stable loaders to immutable standalone modules',async t=>{
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><body><script type="module">import {defineBindleElements} from ${JSON.stringify(baseURL+'/packages/sdk/src/define.mjs')};import {parseIdentity} from ${JSON.stringify(baseURL+'/packages/sdk/src/identity.mjs')};const element=document.createElement('bindle-sign-in');element.addEventListener('bindle-sign-in-request',event=>window.receivedIdentity=event.detail);document.body.append(element);window.parsedIdentity=parseIdentity('n.7k3m');window.sdkReady=typeof defineBindleElements==='function'&&!!customElements.get('bindle-sign-in')&&!customElements.get('bindle-login');</script></body>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launch();t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.sdkReady);
 assert.equal(await page.locator('script[type=importmap]').count(),0);await page.getByLabel('Your Bindle identity').fill('n.7k3m');await page.getByRole('button',{name:'Continue'}).click();const result=await page.evaluate(()=>({received:window.receivedIdentity,parsed:window.parsedIdentity}));assert.equal(result.received.handle,'n.7k3m@3sln.me');assert.equal(result.parsed.handle,result.received.handle);
 for(const path of ['/packages/sdk/src/define.mjs','/packages/sdk/src/callback.mjs','/packages/sdk/src/identity.mjs']){const response=await page.request.get(baseURL+path);assert.equal(response.headers()['access-control-allow-origin'],'*');assert.equal(response.headers()['cache-control'],'no-cache');const body=await response.text();const target=JSON.parse(/export \* from ("[^"]+")/.exec(body)[1]);const immutable=await page.request.get(baseURL+target);assert.equal(immutable.headers()['access-control-allow-origin'],'*');assert.match(immutable.headers()['cache-control'],/immutable/);}
});

test('static console keeps anonymous and context-sensitive visitors informed without JavaScript',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
 for(const path of ['/console?signin','/token-onboarding','/orgs/00000000-0000-4000-8000-000000000000/invitation']){
  await page.goto(baseURL+path);
  await page.getByRole('heading',{name:'Welcome to 3sln.me.'}).waitFor();
  assert.match(await page.locator('noscript').textContent(),/JavaScript is required to sign in/);
  assert.equal(await page.locator('a[href^="/console?"]').count(),0);
 }
});

test('console bundle preload is selected only for ordinary console routes',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
 const manifest=await(await page.request.get(baseURL+'/build-manifest.json')).json();const bundle=manifest.imports['/src/release.mjs'];
 // Stop composition roots so their rendering cannot remove or add hints.
 await page.route('**/*.mjs',route=>/\/(?:console|admin-entry|certify-member|demo-main)\.[a-f0-9]+\.mjs$/.test(new URL(route.request().url()).pathname)?route.abort():route.continue());
 for(const path of ['/console?boot','/console?admin','/console?member_certify=1','/console?demo=1','/token-onboarding','/recovery/setup','/recovery/restore','/orgs/00000000-0000-4000-8000-000000000000/invitation','/console']){
  await page.goto(baseURL+path);await page.waitForFunction(()=>document.querySelector('script[type=importmap]'));
  await page.waitForTimeout(150);
  assert.equal(await page.locator(`link[rel=modulepreload][href$="${bundle}"]`).count(),path==='/console'?1:0,path);
 }
});
