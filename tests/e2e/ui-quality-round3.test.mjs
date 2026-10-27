import test from 'node:test';
import assert from 'node:assert/strict';
import {firefox} from 'playwright';
import {launch,baseURL,artifacts} from './browser.mjs';

for(const browserName of ['chromium','firefox']){
 let browser;test.before(async()=>{browser=browserName==='firefox'?await firefox.launch():await launch();});test.after(()=>browser?.close());
 for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const [width,height] of [[390,844],[1280,900]])test(`round 3 tour ${browserName} ${locale} ${colorScheme} ${width}`,async t=>{
  const context=await browser.newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[],missing=[],unhashed=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()===404)missing.push(r.url());});page.on('request',r=>{if(/\/(?:assets\/apps|assets\/packages|packages)\/.+\.(?:mjs|js)$/.test(new URL(r.url()).pathname)&&! /\.[a-f0-9]{10}\.(?:mjs|js)$/.test(r.url()))unhashed.push(r.url());});
  const account={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'quality',status:'active',hasPassword:true,consoleFeatures:{organizationsEnabled:true,accountExportEnabled:true,overQuotaRetentionEnabled:true}};
  await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let value={};
   if(path==='/api/config')value={origin:baseURL,providers:{},localDevelopment:true,integrationsEnabled:false,organizationsEnabled:true};
   if(path==='/api/session')value={account,sessionContext:'quality',csrfToken:'csrf'};
   if(path==='/api/account')value={account,collections:[],messages:[],contacts:[],rules:[],resources:[],views:[],features:account.consoleFeatures,storage:{usedBytes:0,storageBytes:1000000000,plan:'free'}};
   if(path==='/api/views')value={views:[]};if(path==='/api/incoming')value={items:[],cursor:null};
   if(path.includes('/transfer'))value={state:'none'};
   await route.fulfill({json:value});
  });
  await page.goto(`${baseURL}/console?lang=${locale}`);await page.emulateMedia({colorScheme});assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches),colorScheme==='dark');await page.locator('.app-shell').waitFor();await page.waitForTimeout(200);
  for(const view of ['inbox','rules','resources','notifications','security','connected-apps','automation','billing','settings','account-data']){
   await page.locator('#app').evaluate((root,view)=>root.dispatchEvent(new CustomEvent('3sln-intent',{bubbles:true,detail:{kind:'navigate',view}})),view);
   await page.waitForFunction(view=>(new URL(location.href).searchParams.get('view')??'inbox')===view,view).catch(e=>{throw Error(`Navigation ${view} at ${page.url()}: ${e.message}`);});await page.waitForTimeout(100);
   if(width===390){const small=await page.locator('button,summary,label:has(input[type=checkbox]),a[href]').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!n.matches('.skip-link,.org-skip')&&!n.closest('[hidden]')&&r.height<43.9;}).map(n=>({tag:n.tagName,text:n.textContent.trim().slice(0,70),height:n.getBoundingClientRect().height})));assert.deepEqual(small,[],view);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,view);
  }
  await page.screenshot({path:`${artifacts}/round3-console-${browserName}-${locale}-${colorScheme}-${width}.png`,fullPage:true});
  for(const path of ['/account/transfer-out',...process.env.E2E_PORTABILITY==='1'?['/transfer-in']:[],'/transfer-manage']){await page.goto(`${baseURL}${path}?lang=${locale}`);await page.emulateMedia({colorScheme});assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches),colorScheme==='dark');await page.locator('h1').waitFor();await page.waitForTimeout(100);if(width===390){const small=await page.locator('button,label:has(input[type=checkbox]),a[href]').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0&&n.getBoundingClientRect().height<43.9).map(n=>n.textContent));assert.deepEqual(small,[],path);}await page.screenshot({path:`${artifacts}/round3-${path.split('/').at(-1)}-${browserName}-${locale}-${colorScheme}-${width}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(unhashed,[]);
 });
}
