import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,baseURL,artifacts} from './browser.mjs';
let browser;
test.before(async()=>{browser=await launch();});test.after(async()=>browser?.close());
for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const [width,height] of [[390,844],[1280,900]])test(`UI quality ${locale} ${colorScheme} ${width}x${height}: account retry, offline shell and layout`,async t=>{
 const context=await browser.newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(12000);
 const account={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'quality',status:'active'};let requests=0,fail=true;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let value={};
 if(path==='/api/config')value={origin:baseURL,providers:{},localDevelopment:true,integrationsEnabled:false};
 if(path==='/api/session')value={account,sessionContext:'quality',csrfToken:'csrf'};
 if(path==='/api/account'){requests++;if(fail){await route.fulfill({status:500,json:{error:'unavailable'}});return;}value={account,collections:[],messages:[],contacts:[],rules:[],resources:[],views:[]};}
 if(path==='/api/views')value={views:[]};if(path==='/api/incoming')value={items:[],cursor:null};await route.fulfill({json:value});});
 await page.goto(baseURL+'/console?lang='+locale);await page.locator('.app-shell').waitFor();const retry=page.locator('#main-content button').filter({hasText:locale==='es'?/Reintentar|Intentar|nuevo/:/Retry/});await retry.waitFor();assert.equal(requests,3);
 const contrast=await page.locator('.empty-state h3').evaluate(e=>{const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),l=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const a=l(rgb(getComputedStyle(e).color)),b=l(rgb(getComputedStyle(document.documentElement).backgroundColor));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert.ok(contrast>=4.5,`Error heading contrast ${contrast}`);
 await page.screenshot({path:`${artifacts}/ui-quality-error-${locale}-${colorScheme}-${width}.png`,fullPage:true});fail=false;await retry.click();await page.locator('.empty-state').first().waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('Getting your account information'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const colors=await page.locator('.app-shell').evaluate(e=>({ink:getComputedStyle(e).color,background:getComputedStyle(document.documentElement).backgroundColor}));assert.notEqual(colors.ink,colors.background);
 await context.setOffline(true);await page.locator('.offline-banner').waitFor();assert.equal(await page.locator('.app-shell').count(),1);assert.equal(await page.locator('.auth-card').count(),0);
 await page.screenshot({path:`${artifacts}/ui-quality-offline-${locale}-${colorScheme}-${width}.png`,fullPage:true});
});
