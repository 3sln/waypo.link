// ORG-12e in the real shell: the built app document, modules and styles from the ephemeral local Worker
// (scripts/run-browser-checks.mjs), with the organization API as a fixture, plus the real server-rendered abort page and
// its real POST (never mocked: an unknown organization answers {received:true} with no session). Chromium and Firefox,
// 390 and 1280 px, light and dark, English and Spanish. Screenshots: artifacts/browser/org-break-glass-e2e-*.
import test from 'node:test';import assert from 'node:assert/strict';import {firefox} from 'playwright';import {launch,baseURL,screenshot} from './browser.mjs';
const browsers={};test.before(async()=>{browsers.chromium=await launch();browsers.firefox=await firefox.launch({headless:true});});test.after(async()=>{for(const b of Object.values(browsers))await b?.close();});
const account={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'bgowner',status:'active',hasPassword:true},org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',claimId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GHOST='12345678-1234-4123-8123-123456789abc',TOKEN=`bg1.${GHOST}.${GHOST}.${'A'.repeat(43)}`;
const ownerClaim={id:claimId,state:'held-for-support',createdAt:Date.UTC(2026,9,1),earliestEffectAt:null,closedReason:null,track:'S',frozen:false,channels:[{kind:'email',enrolledAt:1,excluded:false}],decisions:['abort']};
/** The organization API as a fixture: an owner with one open claim against "Acme <img>", or an admin who may start one. */
async function fixture(context,{locale,role}){
 const page=await context.newPage(),errors=[],calls=[];let open=true;page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(locale=>{if(!localStorage.getItem('personal-space-preferences'))localStorage.setItem('personal-space-preferences',JSON.stringify({locale}));},locale);
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,method=route.request().method(),body=route.request().postData();
  if(path==='/api/org-claim/abort')return route.continue(); // the real Worker route
  calls.push({path,method,body});let value={};
  if(path==='/api/config')value={origin:baseURL,localDevelopment:true,providers:{},organizationsEnabled:true};
  else if(path==='/api/session')value={authenticated:true,account,sessionContext:'bgtest',csrfToken:'csrf'};
  else if(path==='/api/account')value={account,features:{organizationsEnabled:true},collections:[],messages:[],contacts:[],rules:[],resources:[],grants:[],views:[]};
  else if(path==='/api/views')value={views:[]};else if(path==='/api/incoming')value={items:[],cursor:null,indexRevision:1};
  else if(path==='/api/orgs/break-glass')value={items:role==='owner'&&open?[{org,name:'Acme <img src=x>',handle:'acme',role:'owner',claim:ownerClaim,decisions:[],contest:null}]:[]};
  else if(path==='/api/orgs')value={organizations:[{id:org,handle:'acme',name:'Acme <img src=x>',role:role==='owner'?'owner-of-record':'member',powers:role==='owner'?['admin','owner-of-record']:['admin'],available:true}],pending:[]};
  else if(path==='/api/orgs/plans')value={configured:false,server:null,plans:[],creation:'allowlisted'};
  else if(path==='/api/orgs/'+org)value={id:org,kind:'organization',name:'Acme <img src=x>',label:'team',powers:['admin'],revision:1,state:'active'};
  else if(path==='/api/orgs/'+org+'/membership')value={organization:{id:org,name:'Acme <img src=x>',label:'team',handle:'acme',state:'active',ownerOfRecord:role==='owner'},membership:{id:'m-1',grants:[{power:'admin',grantedAt:1}]},powers:role==='owner'?['admin','owner-of-record']:['admin']};
  else if(['/requests','/connections','/preferences','/members'].some(s=>path==='/api/orgs/'+org+s))value={requests:[],connections:[],preferences:[],members:[]};
  else if(path==='/api/orgs/'+org+'/ownership')value={organization:{id:org,name:'Acme',handle:'acme',label:'team',state:'active'},billing:{standing:'paid',plan:'org-team',configured:false},transfer:null,claim:null,recovery:{state:'missing',since:1},ownerOfRecord:{sub:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},decisions:[]};
  else if(path==='/api/orgs/'+org+'/break-glass'&&method==='GET')value=role==='owner'?{organization:{id:org,name:'Acme',handle:'acme'},claim:open?ownerClaim:{...ownerClaim,state:'aborted',decisions:[]},decisions:[],contest:null}:{organization:{id:org,name:'Acme',handle:'acme'},claim:null,decisions:['start'],contest:null};
  else if(path==='/api/orgs/'+org+'/break-glass'&&method==='POST'){const input=JSON.parse(body);if(input.operation==='abort'){open=false;value={claim:{...ownerClaim,state:'aborted',closedReason:'owner',decisions:[]},tier:1};}else value={claim:null};}
  else if(path==='/api/orgs/'+org+'/invitee')value={invitee:{iss:baseURL,sub:'ffffffff-ffff-4fff-8fff-ffffffffffff',handle:'teammate'}};
  await route.fulfill({json:value});});
 return {page,errors,calls};
}
const layout=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+': no horizontal scroll');
 assert.deepEqual(await page.locator('.org-console button,.org-console a[href]:not(.org-skip),main button').evaluateAll(els=>els.filter(e=>e.offsetParent!==null&&e.getBoundingClientRect().height<44).map(e=>e.textContent.trim())),[],label+': 44 px targets');
 assert.equal(await page.locator('.org-console img').count(),0,label+': names are text');};
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])test(`ORG-12e e2e ${name} ${locale}: owner interstitial, abort page, admin entry`,async t=>{const es=locale==='es';
 for(const [width,height] of [[390,844],[1280,900]])for(const colorScheme of ['light','dark']){const tag=`${name}-${locale}-${width}-${colorScheme}`;
  // 1. The owner's sign-in interstitial, in the real shell; stopping the claim lets the console through.
  {const context=await browsers[name].newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const {page,errors,calls}=await fixture(context,{locale,role:'owner'});
   await page.goto(baseURL+'/console');const gate=page.locator('[data-claim-gate]');await gate.waitFor();
   assert.match(await gate.locator('h1').textContent(),es?/Alguien reclama la propiedad de Acme <img src=x>/:/Someone is claiming ownership of Acme <img src=x>/);
   assert.match(await gate.textContent(),es?/en espera/:/on hold/);await layout(page,tag+' interstitial');
   assert.equal(await gate.evaluate(e=>getComputedStyle(e).color===getComputedStyle(e.parentElement).color),true,'theme tokens are inherited');
   await screenshot(page,`org-break-glass-e2e-interstitial-${tag}`);
   await gate.locator('[data-org-action="bg-gate-abort"]').click();await page.waitForFunction(()=>!document.querySelector('[data-claim-gate]'));
   const abort=calls.find(c=>c.method==='POST'&&c.path==='/api/orgs/'+org+'/break-glass');assert.deepEqual(JSON.parse(abort.body),{operation:'abort',claim:claimId});
   await page.locator('.app-shell').waitFor();assert.deepEqual(errors,[]);await context.close();}
  // 2. The no-sign-in abort page (real Worker): the fragment leaves the address bar; only the button POSTs.
  {const context=await browsers[name].newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
   const response=await page.goto(`${baseURL}/org-claim/abort${es?'?lang=es':''}#org=${GHOST}&token=${TOKEN}`);
   assert.match(response.headers()['content-security-policy'],/frame-ancestors 'none'/);assert.equal(response.headers()['referrer-policy'],'no-referrer');
   await page.waitForFunction(()=>!location.hash);assert.equal(new URL(page.url()).hash,'','the capability left the address bar');assert.deepEqual(posts,[],'opening the page sent nothing');
   const button=page.locator('button'),input=page.locator('input[name="confirmed"]');await button.waitFor();assert.equal(await button.textContent(),es?'Detener esta reclamación':'Stop this claim');
   // Review M2: nothing can be sent until the confirmation is typed (no handle in this link, so the word is stop).
   assert.equal(await button.isEnabled(),false);assert.match(await page.locator('[data-type-hint]').textContent(),/stop/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok((await button.boundingBox()).height>=44);
   // Dark mode follows prefers-color-scheme. Playwright's Firefox drops colour-scheme emulation after the process swap that
   // Cross-Origin-Opener-Policy causes (checked 2026-10-23 with COOP removed), so the colours are asserted in Chromium only.
   if(name==='chromium')assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),colorScheme==='dark'?'rgb(17, 17, 17)':'rgb(255, 255, 255)');
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('name')),'confirmed','keyboard reaches the confirmation first');
   await page.keyboard.type('stop');assert.equal(await button.isEnabled(),true);
   await screenshot(page,`org-break-glass-e2e-abort-page-${tag}`);
   // One press per browser and language: the page's own per-address budget (5 a minute) is shared by this whole run.
   if(width===1280&&colorScheme==='light'){
    // A script submit without a user gesture (the typing's activation has expired) sends nothing.
    // Playwright's evaluate itself counts as a gesture, so the script submit is scheduled to run after that activation
    // (and the typing's) has expired (about 5 s in both engines).
    await page.evaluate(()=>{setTimeout(()=>document.querySelector('form').requestSubmit(),6500);});await page.waitForTimeout(7200);assert.deepEqual(posts,[],'no POST without user activation');
    await page.keyboard.press('Enter');await page.locator('[role=status]').filter({hasText:es?/Gracias/:/Thank you/}).waitFor();assert.equal(posts.length,1);}assert.deepEqual(errors,[]);await context.close();}
  // 3. An admin sees the "owner is gone?" entry in the ownership panel and the missing-recovery-file banner.
  if(width===1280||colorScheme==='light'){const context=await browsers[name].newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const {page,errors}=await fixture(context,{locale,role:'admin'});
   await page.goto(baseURL+'/console?view=organizations&org='+org);await page.locator('.app-shell .org-console #org-details').waitFor();
   await page.waitForFunction(()=>document.querySelector('.org-console')?.getAttribute('aria-busy')==='false');
   await page.locator('[data-org-action="bg-wizard-open"]').waitFor();
   assert.match(await page.locator('.org-console').textContent(),es?/No hay archivo de recuperación vigente/:/No current recovery file/);
   await page.locator('[data-org-action="bg-wizard-open"]').click();await page.locator('#org-bg-step').waitFor();
   await page.waitForFunction(()=>document.activeElement?.id==='org-bg-step',null,{timeout:3000}).catch(()=>{});assert.equal(await page.evaluate(()=>document.activeElement?.id),'org-bg-step','focus moves to the step');await layout(page,tag+' wizard');
   await screenshot(page,`org-break-glass-e2e-wizard-${tag}`);assert.deepEqual(errors,[]);await context.close();}
 }
});
