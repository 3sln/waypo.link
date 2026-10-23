// Native built-document checks over the real ephemeral Worker; engine state-machine paths have separate tests.
import test from 'node:test';import assert from 'node:assert/strict';
import {chromium,firefox} from 'playwright';
const origin=process.env.E2E_BASE_URL;let browsers={};
test.before(async()=>{for(const [name,type]of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));});
for(const browser of ['chromium','firefox'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [320,390,1440])test('native portability '+[browser,locale,colorScheme,width].join(' '),async()=>{
 const context=await browsers[browser].newContext({locale,viewport:{width,height:900},colorScheme}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{for(const path of ['/account/transfer-out','/transfer-in','/account/transfer-out/dispute#owner=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&token='+'a'.repeat(43)]){
  const response=await page.goto(origin+path);assert.equal(response.status(),200,path);const headers=response.headers();assert.equal(headers['referrer-policy'],'no-referrer');assert.match(headers['content-security-policy'],/frame-ancestors 'none'/);assert.equal(headers['cross-origin-opener-policy'],'same-origin');assert.ok(!headers['content-security-policy'].includes('challenges.cloudflare.com'),'package document cannot run challenge scripts');
  await page.locator('main').waitFor();await page.waitForFunction(()=>document.querySelector('main')?.getAttribute('aria-busy')==='false');assert.equal(await page.locator('html').getAttribute('lang'),locale);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement!==document.body),true);if(path.includes('dispute'))assert.equal(new URL(page.url()).hash,'');
 }
 const missing=await context.request.get(origin+'/moved/'+'a'.repeat(160)),expired=await context.request.get(origin+'/api/portability/redirect?id='+'a'.repeat(160));assert.equal(missing.status(),404);assert.equal(expired.status(),404);assert.equal(await missing.text(),await expired.text());
 assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('native first-party challenge popup returns proof only to the same-origin caller',async()=>{
 const context=await browsers.chromium.newContext(),page=await context.newPage();try{
 await page.route('**/api/transfer-in/check',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({mode:'attested',from:{iss:'https://old.example'},kind:'person'})}));
 await page.goto(origin+'/transfer-in');await page.locator('main').waitFor();await page.locator('input[type=file]').last().setInputFiles({name:'package.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.getByRole('button',{name:'Complete security check',exact:true}).waitFor();
 const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'Complete security check',exact:true}).click();const child=await popup;await child.waitForEvent('close');await page.getByText('Security check ready.',{exact:true}).waitFor();
 }finally{await context.close();}
});

test('native package POST retains the import-map CSP hash and removes bootstrap material before rendering',async()=>{const context=await browsers.chromium.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));try{await page.goto(origin+'/transfer-in');await page.locator('main').waitFor();const navigation=page.waitForNavigation();await page.evaluate(()=>{const form=document.createElement('form');form.method='POST';form.action='/bindle/portability/transfer-in';const field=document.createElement('input');field.name='package';field.value=JSON.stringify({sub:'not-valid',proof:'bootstrap-fixture'});form.append(field);document.body.append(form);form.submit();});const response=await navigation;assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/sha256-/);assert.ok(!response.headers()['content-security-policy'].includes('challenges.cloudflare.com'));await page.locator('main').waitFor();await page.waitForFunction(()=>document.querySelector('main')?.getAttribute('aria-busy')==='false');assert.equal(await page.locator('#transfer-package').count(),0);assert.equal(await page.getByText('bootstrap-fixture').count(),0);assert.deepEqual(errors,[]);}finally{await context.close();}});
