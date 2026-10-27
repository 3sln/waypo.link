import test from 'node:test';
import assert from 'node:assert/strict';
import {firefox} from 'playwright';
import {launch,baseURL,artifacts} from './browser.mjs';

// Composite ancestor backgrounds, including alpha, instead of comparing against
// the root canvas: this catches light feature surfaces inside a dark shell.
async function contrasts(locator){return locator.evaluateAll(nodes=>nodes.map(e=>{
 const rgba=value=>{const values=value.match(/[\d.]+/g)?.map(Number)??[0,0,0];return [...values.slice(0,3),values[3]??1];};
 const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [...a.slice(0,3).map((v,i)=>(v*a[3]+b[i]*b[3]*(1-a[3]))/alpha),alpha];};
 let bg=[255,255,255,1];const ancestors=[];for(let n=e;n;n=n.parentElement)ancestors.unshift(n);for(const n of ancestors)bg=over(rgba(getComputedStyle(n).backgroundColor),bg);
 const fg=over(rgba(getComputedStyle(e).color),bg),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),a=lum(fg),b=lum(bg);
 return {text:e.textContent.slice(0,70),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
}));}
for(const browserName of ['chromium','firefox']){
 let browser;test.before(async()=>{if(browserName==='firefox')browser=await firefox.launch();else browser=await launch();});test.after(async()=>browser?.close());
 for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const [width,height] of [[390,844],[1280,900]])test(`round 2 ${browserName} ${locale} ${colorScheme} ${width}`,async t=>{
 const context=await browser.newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const account={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'quality',status:'active',hasPassword:true,consoleFeatures:{accountExportEnabled:true,overQuotaRetentionEnabled:true}};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let value={};
 if(path==='/api/config')value={origin:baseURL,providers:{},localDevelopment:true,integrationsEnabled:false};
 if(path==='/api/session')value={account,sessionContext:'quality',csrfToken:'csrf'};
 if(path==='/api/account')value={account,collections:[],messages:[],contacts:[],rules:[],resources:[],views:[],features:account.consoleFeatures,storage:{usedBytes:0,storageBytes:1073741824,plan:'free'}};
 if(path==='/api/views')value={views:[]};if(path==='/api/incoming')value={items:[],cursor:null};
 if(['/api/exports','/api/account/retention'].includes(path)){await route.fulfill({status:429,json:{error:'rate_limited'}});return;}
 await route.fulfill({json:value});});
 const check=async selector=>{const nodes=page.locator(selector);assert.ok(await nodes.count(),selector);for(const result of await contrasts(nodes))assert.ok(result.ratio>=4.5,`${selector}: ${result.text}: ${result.ratio}`);};
 await page.goto(`${baseURL}/console?lang=${locale}&view=billing`);await page.emulateMedia({colorScheme});assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches),colorScheme==='dark');await page.locator('.billing-availability').waitFor();await page.locator('.skip-link').focus();await check('.skip-link');await page.locator('.skip-link').evaluate(e=>e.blur());await check('.sidebar-storage, .sidebar-storage strong, .billing-availability, .breadcrumb, .workspace-footer');await page.screenshot({path:`${artifacts}/round2-billing-${browserName}-${locale}-${colorScheme}-${width}.png`,fullPage:true});
 // Navigate through the actual shell intent, keeping the same engine and owner.
 await page.locator('#app').evaluate(root=>root.dispatchEvent(new CustomEvent('3sln-intent',{bubbles:true,detail:{kind:'navigate',view:'contacts'}})));
 await page.locator('.saved-contacts').waitFor();await check('.saved-contacts .muted, .contact-profile-settings .field-help');await page.screenshot({path:`${artifacts}/round2-contacts-${browserName}-${locale}-${colorScheme}-${width}.png`,fullPage:true});
 if(width===390){const box=await page.locator('.saved-contacts input').boundingBox();assert.ok(box.height>=44);}
 await page.waitForURL('**view=contacts**');await page.reload();await page.locator('.saved-contacts').waitFor();
 await page.goBack();await page.locator('.billing-availability').waitFor();
 await page.locator('#app').evaluate(root=>root.dispatchEvent(new CustomEvent('3sln-intent',{bubbles:true,detail:{kind:'navigate',view:'settings'}})));await page.locator('.shortcut-search input').waitFor();if(width===390){for(const selector of ['.shortcut-search input','.topbar-search','.workspace-footer a'])for(const box of await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))))assert.ok(box.height>=44&&box.width>=44,selector);}

 await page.locator('#app').evaluate(root=>root.dispatchEvent(new CustomEvent('3sln-intent',{bubbles:true,detail:{kind:'navigate',view:'account-data'}})));
 await page.locator('.account-data [role=alert]').first().waitFor();assert.match(await page.locator('.account-data').textContent(),locale==='es'?/Espera.*intenta/:/Wait.*try again/);assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`${artifacts}/round2-${browserName}-${locale}-${colorScheme}-${width}.png`,fullPage:true});
 });
 test(`round 2 ${browserName}: device choice, signup reload and saved landing locale`,async t=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});t.after(()=>context.close());const page=await context.newPage();let starts=0;
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/auth/linked/start')starts++;return route.fulfill({json:path==='/api/config'?{origin:baseURL,localDevelopment:true,providers:{},deviceAuthorizationEnabled:true,signupEnabled:true,ageRequirement:{minimumAge:18}}:path==='/api/signup/status'?{signupEnabled:true,freeSignupOpen:true,paidSignupOpen:true}:{}});});
 await page.goto(baseURL+'/console');await page.getByRole('button',{name:'Sign in with another device',exact:true}).click();await page.locator('fieldset').waitFor();const hint=await page.evaluate(()=>navigator.maxTouchPoints>0&&innerWidth<768?'Phone or tablet':'Computer');assert.equal(await page.locator('fieldset [aria-pressed=true]').textContent(),hint);await page.waitForTimeout(200);assert.equal(starts,0);await page.getByRole('button',{name:'Computer',exact:true}).click();await page.waitForFunction(()=>document.querySelector('fieldset [aria-pressed=true]')?.textContent==='Computer');assert.equal(await page.locator('fieldset [aria-pressed=true]').textContent(),'Computer');
 const [started]=await Promise.all([page.waitForRequest(r=>new URL(r.url()).pathname==='/api/auth/linked/start'),page.getByRole('button',{name:'Continue',exact:true}).click()]);assert.equal(started.postDataJSON().deviceKind,'computer');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 for(const name of ['Use my recovery file','Sign in by email']){const box=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box.height>=44,name);}
 await page.getByRole('button',{name:'Create a 3sln.me account',exact:true}).click();await page.getByRole('button',{name:'Password',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('[name=ageConfirmed]').waitFor();await page.reload();await page.locator('[name=ageConfirmed]').waitFor();assert.equal(await page.locator('.signup-wizard').count(),1);await page.locator('[name=ageConfirmed]').check();await page.locator('[name=termsAccepted]').check();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('.signup-wizard input[name=password]').waitFor();await page.reload();await page.locator('.signup-wizard input[name=password]').waitFor();
 await page.evaluate(()=>localStorage.setItem('personal-space-preferences',JSON.stringify({locale:'es'})));await page.goto(baseURL+'/');await page.waitForURL('**/?lang=es');assert.equal(await page.locator('html').getAttribute('lang'),'es');
 await page.goto(baseURL+'/account/transfer-out?lang=en');await page.getByRole('heading',{name:'Move your identity',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');await page.goto(baseURL+'/account/transfer-out');await page.getByRole('heading',{name:'Mueve tu identidad',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'es');
 });

}
