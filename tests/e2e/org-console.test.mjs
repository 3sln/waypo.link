import test from 'node:test';import assert from 'node:assert/strict';import {launch,baseURL,waitForApp,screenshot} from './browser.mjs';
let browser;test.before(async()=>{browser=await launch();});test.after(async()=>browser?.close());
const account={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',handle:'orgfixture',status:'active',hasPassword:true},org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const invitationToken=()=>'e30.'+Buffer.from(JSON.stringify({aud:baseURL+'/identity/'+other,exp:2000000000,jti:'fixture-invitation'})).toString('base64url')+'.sig';
// API fixture only: the app document, modules and styles are the real built assets served by the ephemeral Worker.
async function fixture(context,{locale,signedIn=()=>true}){const page=await context.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(locale=>{if(!localStorage.getItem('personal-space-preferences'))localStorage.setItem('personal-space-preferences',JSON.stringify({locale}));},locale);
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push({path,method:route.request().method(),body:route.request().postData()});let value={};
  if(path==='/api/config')value={origin:baseURL,localDevelopment:true,providers:{},organizationsEnabled:true};
  else if(path==='/api/session')value=signedIn()?{authenticated:true,account,sessionContext:'orgtest',csrfToken:'csrf'}:{authenticated:false};
  else if(path==='/api/account')value={account,features:{organizationsEnabled:true},collections:[],messages:[],contacts:[],rules:[],resources:[],grants:[],views:[]};
  else if(path==='/api/views')value={views:[]};else if(path==='/api/incoming')value={items:[],cursor:null,indexRevision:1};
  else if(path==='/api/orgs')value={organizations:[{id:org,handle:'sample-org',name:'Sample <img src=x>',role:'owner-of-record',powers:['admin','owner-of-record'],available:true}],pending:[]};
  else if(path==='/api/orgs/plans')value={configured:false,server:null,plans:[],creation:'allowlisted'};
  else if(path==='/api/orgs/'+org)value={id:org,kind:'organization',name:'Sample <img src=x>',label:'team',powers:['admin'],revision:1,ownerOfRecord:{iss:baseURL,sub:account.id}};
  else if(path==='/api/orgs/'+org+'/members')value={members:[{id:'m1',principal:{iss:baseURL,sub:account.id,handle:account.handle},grants:[{power:'admin'}]},{id:'m2',principal:{iss:baseURL,sub:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',handle:'teammate'},grants:[]}],requests:[]};
  else if(path==='/api/orgs/'+org+'/membership')value={organization:{id:org,name:'Sample <img src=x>',label:'team',handle:'sample-org',state:'active',ownerOfRecord:true},membership:{id:'membership-1',grants:[{power:'admin',grantedAt:1}]},powers:['admin','owner-of-record']};
  else if(path==='/api/orgs/'+org+'/requests')value={requests:[]};
  else if(path==='/api/orgs/'+org+'/connections')value={connections:[{id:'cx',name:'Fixture app',state:'active',generation:1}]};
  else if(path==='/api/orgs/'+org+'/preferences')value={preferences:[]};
  else if(path==='/api/orgs/'+org+'/invitee')value={invitee:{iss:baseURL,sub:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',handle:'newcomer'}};
  else if(path==='/api/orgs/'+org+'/invitations')value={invitation:'inv-1',url:baseURL+'/orgs/'+org+'/invitation?bindle_meta=e30.e30.sig',expiresAt:Date.now()+7*86400000,invitee:JSON.parse(route.request().postData()).invitee??null,grants:JSON.parse(route.request().postData()).grants};
  await route.fulfill({json:value});});
 return {page,errors,calls};}
const idle=page=>page.waitForFunction(()=>document.querySelector('.org-console')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.application[aria-busy="true"]'));
const rawCode=/\b[a-z]+(?:_[a-z]+)+\b/;
for(const locale of ['en','es'])test(`organization console ${locale}: inside the shell, own address, history, reload and theme`,async t=>{const es=locale==='es';
 for(const [width,height] of [[390,844],[1280,900]])for(const colorScheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height},colorScheme});t.after(()=>context.close());const {page,errors,calls}=await fixture(context,{locale});
  await waitForApp(page);await page.locator('.app-shell').waitFor();
  if(width<760&&await page.locator('.nav-item').filter({hasText:es?'Organizaciones':'Organizations'}).isHidden())await page.locator('.menu-button,[aria-label="Open navigation"]').first().click().catch(()=>{});
  await page.locator('.nav-item').filter({hasText:es?'Organizaciones':'Organizations'}).click();await page.locator('.app-shell .workspace .org-console').waitFor();
  assert.equal(new URL(page.url()).search,'?view=organizations','the view has its own address');assert.equal(await page.locator('.sidebar').count(),1,'the shell stays');
  await page.locator('.org-console nav select option[value="'+org+'"]').waitFor({state:'attached'});await idle(page);await page.locator('.org-console nav select').selectOption(org);await page.locator('#org-details').waitFor();await idle(page);
  assert.equal(new URL(page.url()).searchParams.get('org'),org);assert.match(await page.locator('.org-acting').textContent(),es?/Actuando para/:/Acting for/);
  assert.match(await page.locator('#org-details').textContent(),/Sample <img src=x>/);assert.equal(await page.locator('.org-console img').count(),0);
  const members=page.locator('#org-members').locator('..');assert.match(await members.textContent(),/@teammate/);assert.equal(await members.locator('textarea').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Theme: the console inherits the shell's text colour and draws borders from the shared --line token.
  assert.equal(await page.locator('.org-console').evaluate(e=>getComputedStyle(e).color===getComputedStyle(e.parentElement).color),true);
  if(width===1280||colorScheme==='light')await screenshot(page,`org-console-${width}-${colorScheme}-${locale}`);
  // Reload keeps the view and the context; Back returns to the personal context and then to Messages.
  await page.reload();await page.locator('.app-shell .org-console #org-details').waitFor();await idle(page);assert.equal(new URL(page.url()).searchParams.get('org'),org);
  await page.locator('.org-console nav select').selectOption('');await page.locator('#org-create').waitFor();await idle(page);assert.equal(new URL(page.url()).searchParams.get('org'),null);
  await page.goBack();await page.locator('#org-details').waitFor();await idle(page);assert.equal(new URL(page.url()).searchParams.get('org'),org,'Back restores the previous context');
  await page.goBack();await page.locator('#org-create').waitFor();await idle(page);assert.equal(new URL(page.url()).searchParams.get('org'),null);await page.goBack();await page.waitForFunction(()=>!document.querySelector('.org-console'));assert.equal(new URL(page.url()).pathname,'/console');assert.equal(new URL(page.url()).search,'');assert.equal(await page.locator('.app-shell').count(),1,'Back stays in the app');
  // Keyboard: the org skip link is hidden until focused.
  await page.goForward();await page.locator('.org-console').waitFor();await idle(page);assert.equal(await page.locator('.org-skip').evaluate(e=>e.getBoundingClientRect().width<=1),true);
  assert.doesNotMatch(await page.locator('.org-console').innerText(),rawCode);assert.deepEqual(errors,[]);assert.ok(calls.some(c=>c.path==='/api/orgs/'+org+'/members'));
  if(width===390&&colorScheme==='light'){
   // Invitation share UI from real forms (no JSON), with an accessible snapshot of the form labels.
   await page.locator('.org-console nav select').selectOption(org);await page.locator('#org-members').waitFor();await idle(page);
   await members.locator('input[name="invitee"]').fill('@newcomer');await members.locator('[data-org-action="invitee-resolve"]').click();await members.getByText('@newcomer').first().waitFor();await idle(page);
   const snapshot=await members.ariaSnapshot();for(const label of es?['Cualquiera que tenga el enlace','Administración','El enlace caduca tras']:['Anyone who has the link','Admin','Link expires after'])assert.match(snapshot,new RegExp(label),label);
   await members.locator('[data-org-action="invite"]').click();await page.locator('#org-invitation').waitFor();assert.match(await page.locator('#org-invitation').locator('..').locator('input[readonly]').inputValue(),/\/invitation\?bindle_meta=/);
   await screenshot(page,`org-invitation-share-${locale}`);
  }
 }
});
for(const locale of ['en','es'])test(`invitation link ${locale}: join screen signed in, and carried through sign-in when signed out`,async t=>{const es=locale==='es';
 let signed=false;const context=await browser.newContext({viewport:{width:390,height:844}});t.after(()=>context.close());const {page,errors,calls}=await fixture(context,{locale,signedIn:()=>signed});
 const link=baseURL+'/orgs/'+other+'/invitation?bindle_meta='+invitationToken();
 await page.goto(link);await page.locator('.auth-card').first().waitFor();await page.getByText(es?/Te invitaron a unirte a una organización/:/invited to join an organization/).first().waitFor();await screenshot(page,`org-invitation-signed-out-${locale}`);
 // Sign-in is simulated by the session fixture; the tab-scoped invitation brings the person back to the join screen.
 signed=true;await page.goto(baseURL+'/console');await page.locator('.app-shell #org-join').waitFor();
 const join=page.locator('#org-join').locator('..');assert.match(await join.textContent(),es?/Qué significa unirte/:/What joining means/);assert.equal(new URL(page.url()).search,'?view=organizations');
 await join.locator('[data-org-action="accept-entry"]').click();assert.equal(calls.some(c=>c.path.endsWith('/accept')),false,'joining needs explicit consent');assert.equal(await join.locator('.org-check-error').isVisible(),true);
 await screenshot(page,`org-join-${locale}`);
 await join.locator('input[name="confirm"]').check();await join.locator('[data-org-action="accept-entry"]').click();await page.waitForFunction(()=>!document.querySelector('#org-join'));
 assert.deepEqual(JSON.parse(calls.find(c=>c.path==='/api/orgs/'+other+'/accept').body),{invitation:invitationToken()});
 // Opening the link while signed in goes straight to the join screen and drops the token from the address bar.
 await page.goto(link);await page.locator('.app-shell #org-join').waitFor();assert.equal(new URL(page.url()).pathname,'/console');assert.equal(page.url().includes('bindle_meta'),false);
 assert.deepEqual(errors,[]);
});
