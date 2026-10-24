// Loopback-only browser fixture for the ORG-12e break-glass console: the production dodo console UI and interstitial,
// ngin intents and HTTP port against a fake API (Chromium and Firefox, en and es, light and dark, 390 and 1280 px).
// Polar is never contacted; checkout navigation is captured. No production, delivery or provider claim follows.
import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';import {chromium,firefox} from 'playwright';
const project=resolve('.'),org='11111111-1111-4111-8111-111111111111',memberOrg='44444444-4444-4444-8444-444444444444',ownedOrg='55555555-5555-4555-8555-555555555555',claim='66666666-6666-4666-8666-666666666666',ownedClaim='77777777-7777-4777-8777-777777777777';
let server,origin,options={};const browsers={};
const boot=`import {Engine,Provider,dodo} from '/apps/web/src/shared/stack.mjs';import State from '/apps/web/src/providers/browser-state.mjs';import OrganizationsProvider from '/apps/web/src/providers/organizations.mjs';import {OrganizationsIntent} from '/apps/web/src/bl/organizations.mjs';import {BreakGlassNotices} from '/apps/web/src/bl/org-break-glass.mjs';import organizations,{organizationsAction} from '/apps/web/src/ui/org-console.mjs';import {claimInterstitial} from '/apps/web/src/ui/org-claim-interstitial.mjs';
const org='${org}',memberOrg='${memberOrg}',ownedOrg='${ownedOrg}',claim='${claim}',ownedClaim='${ownedClaim}';const options=await fetch('/fixture').then(r=>r.json());window.calls=[];window.navigations=[];const fx=window.fixture={stage:'start',evil:false};
const created=Date.UTC(2026,9,1),principal=(sub,handle)=>({iss:'https://provider.example',sub,handle});
const disclosure=[{plan:'org-team',price:{currency:'usd',amount:120000,exponent:2},digest:'d'.repeat(64),terms:{contestDays:90}}];
const view=id=>{if(id===memberOrg)return {claim:{id:claim,state:'waiting',createdAt:created,earliestEffectAt:Date.UTC(2026,10,9),closedReason:null},decisions:[],contest:null};
 if(fx.stage==='start')return {claim:null,decisions:['start'],contest:null};
 const c={id:claim,state:'gathering',createdAt:created,earliestEffectAt:null,closedReason:null,frozen:false,initiator:principal('bea','bea'),candidate:principal('owner','me'),candidacyAccepted:fx.stage==='pay',cosigners:[{principal:principal('cy','cy<script>'),at:created}],objections:0,category:'owner-unreachable',statement:'Gone <img src=x onerror=alert(1)> since May',paid:false,waitEndsAt:null,finalEndsAt:null,decisions:fx.stage==='pay'?['pay','withdraw']:['accept','withdraw']};
 if(fx.stage==='pay')c.disclosure=disclosure;return {claim:c,decisions:[],contest:null};};
const items=()=>({items:[{org:ownedOrg,name:'Owned <b>co</b>',handle:'owned.example',role:'owner',claim:{id:ownedClaim,state:'held-for-support',createdAt:created,earliestEffectAt:null,closedReason:null,decisions:['abort']},decisions:[],contest:null},
 {org:memberOrg,name:'Club',handle:'club.example',role:'admin',claim:{id:claim,state:'waiting',createdAt:created,earliestEffectAt:null,closedReason:null,decisions:['cosign','object']},decisions:[],contest:null}]});
const api={captureContext:()=>({owner:'owner',sessionContext:'ctx'}),get(path){return this.request(path,undefined,'GET');},async request(path,body,method='POST'){window.calls.push({path,body,method});
 if(path==='/api/orgs'&&method==='GET')return {organizations:[{id:org,name:'Team',handle:'team.example',role:'member',powers:['admin'],available:true},{id:memberOrg,name:'Club',handle:'club.example',role:'member',powers:[],available:true}],pending:[],offers:[]};
 if(path==='/api/orgs/plans')return {configured:true,server:'sandbox',provisional:true,currency:'usd',plans:[]};
 if(path==='/api/orgs/break-glass')return items();
 const id=path.split('/')[3],suffix=path.split('/')[4]??'';
 if(suffix==='membership')return {organization:{id,name:id===org?'Team':'Club',label:'team',state:'active'},membership:{id:'m-'+id,grants:[]},powers:id===org?['admin']:[]};
 if(suffix==='requests')return {requests:[]};if(suffix==='members')return {members:[],requests:[]};if(suffix==='connections')return {connections:[]};if(suffix==='preferences')return {preferences:[]};
 if(suffix==='ownership')return {organization:{id},billing:{standing:'paid',plan:'org-team',configured:true},decisions:[],recovery:{state:'missing',since:1},transfer:null,claim:null};
 if(suffix==='invitee')return {invitee:{iss:'https://provider.example',sub:'22222222-2222-4222-8222-222222222222',handle:body.handle}};
 if(suffix==='break-glass'&&method==='GET')return view(id);
 if(suffix==='break-glass'){if(body.operation==='start')fx.stage='accept';if(body.operation==='accept')fx.stage='pay';return {claim:{id:claim}};}
 if(suffix==='break-glass-checkout')return {checkout:{url:fx.evil?'https://evil.example/pay':'https://sandbox.polar.sh/checkout/bg',server:'sandbox'}};
 if(path==='/api/orgs/'+id)return {id,name:'Team',label:'team',powers:['admin'],revision:1,state:'active'};return {};}};
const browser={secret:()=>undefined,storeSecret:()=>{},download:()=>{},navigate:url=>window.navigations.push(url),focus:selector=>requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelector(selector)?.focus()))};
const engine=new Engine({providers:{state:State,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),organizationsConsole:OrganizationsProvider,recoveryFile:Provider.fromSingleton({})}});
await engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,{loading:false,locale:options.locale,session:{account:{id:'owner'},sessionContext:'ctx'},config:{origin:'https://provider.example',organizationsEnabled:true},beamGeneration:1})));
const root=document.getElementById('app'),paint=async()=>{const s=await engine.container.use(['state'],({state})=>state.snapshot());dodo.reconcile(root,[claimInterstitial(s)??organizations(s)]);};engine.feed.addEventListener('browser-state-updated',()=>{window.painting=(window.painting??Promise.resolve()).then(paint);});
root.addEventListener('3sln-intent',e=>{if(e.detail.kind==='organizations')window.pending=engine.dispatch(organizationsAction(e.detail)).next('complete');});
window.act=(action,detail={})=>window.pending=engine.dispatch(new OrganizationsIntent({action,...detail})).next('complete');window.notices=()=>window.pending=engine.dispatch(new BreakGlassNotices()).next('complete');
await paint();document.documentElement.lang=options.locale;window.ready=true;`;
test.before(async()=>{server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;if(path==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(options));return;}if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}if(path==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}const file=resolve(project,'.'+path);if(!file.startsWith(project+'/')||!['/apps/web/','/packages/','/vendor/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',extname(file)==='.css'?'text/css':'text/javascript');res.end(await readFile(file));}catch(error){res.writeHead(500);res.end(error.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;for(const [name,type]of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});await mkdir('artifacts/browser',{recursive:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));await new Promise(r=>server?.close(r));});
const settle=page=>page.evaluate(async()=>{for(let i=0;i<3;i++){await window.pending;await window.painting;}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));});
const press=async(page,action)=>{await page.locator('[data-org-action="'+action+'"]').first().click();await settle(page);};
const calls=page=>page.evaluate(()=>window.calls);
const layout=async(page,label)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,label+': no horizontal scroll');assert.deepEqual(await page.locator('.org-console button,.org-console input:not([type=checkbox]),.org-console select,.org-console textarea,.org-claim-gate a').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().height<44).map(e=>e.tagName+':'+(e.dataset.orgAction??e.name??''))),[],label+': 44 px targets');assert.equal(await page.locator('.org-console img,.org-console script,.org-console b').count(),0,label+': no injected markup');};
const focused=page=>page.evaluate(()=>document.activeElement?.id??'');
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [390,1280])test('ORG-12e '+[name,locale,colorScheme,width].join(' '),async()=>{
 options={locale};const es=locale==='es',tag=[name,locale,colorScheme,width].join('-');const page=await browsers[name].newPage({viewport:{width,height:900},colorScheme});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>window.notices());await settle(page);
  // Owner interstitial: full screen, stop, contact support, not now.
  const gate=page.locator('[data-claim-gate]');assert.equal(await gate.count(),1);assert.match(await gate.textContent(),es?/Alguien reclama la propiedad de Owned <b>co<\/b>/:/Someone is claiming ownership of Owned <b>co<\/b>/);
  assert.equal(await gate.locator('a[href="mailto:contact@3sln.com"]').count(),1);await layout(page,'interstitial');await page.screenshot({path:`artifacts/browser/org-break-glass-interstitial-${tag}.png`,fullPage:true});
  await press(page,'bg-gate-abort');assert.deepEqual((await calls(page)).find(c=>c.body?.operation==='abort'),{path:'/api/orgs/'+ownedOrg+'/break-glass',body:{operation:'abort',claim:ownedClaim},method:'POST'});
  assert.equal(await page.locator('[data-claim-gate]').count(),0,'a stopped claim leaves the interstitial');
  // Personal view: the co-signature item from another organization.
  await page.evaluate(()=>window.act('reload'));await settle(page);const waiting=page.locator('#org-bg-waiting').locator('..');assert.match(await waiting.textContent(),es?/Reclamación de propiedad en Club/:/Ownership claim in Club/);await layout(page,'waiting');
  await waiting.locator('[data-org-action="bg-cosign"]').first().click();await settle(page);assert.ok((await calls(page)).some(c=>c.path==='/api/orgs/'+memberOrg+'/break-glass'&&c.body.operation==='cosign'&&c.body.claim===claim));
  // Admin context: recovery banner, wizard one step at a time with focus on each step, then start.
  await page.locator('nav select').selectOption(org);await settle(page);assert.match(await page.locator('.org-console').textContent(),es?/No hay archivo de recuperación vigente/:/No current recovery file/);
  await press(page,'bg-wizard-open');assert.equal(await focused(page),'org-bg-step');await layout(page,'alternatives');
  await press(page,'bg-wizard-next');assert.equal(await focused(page),'org-bg-step');
  await page.locator('input[name="handle"]').fill('@dana');await page.keyboard.press('Enter');await settle(page);assert.equal(await focused(page),'org-bg-step','keyboard submission moves focus to the next step');
  await page.locator('input[name="category"][value="owner-deceased"]').check();await press(page,'bg-category');assert.equal(await focused(page),'org-bg-step');
  await page.locator('textarea[name="statement"]').fill('The owner died in May.');await press(page,'bg-statement');
  const review=page.locator('.org-bg-wizard');assert.match(await review.textContent(),es?/impugnarlo durante 90 días/:/contest it for 90 days/);assert.match(await review.textContent(),/@dana/);await layout(page,'review');await page.screenshot({path:`artifacts/browser/org-break-glass-review-${tag}.png`,fullPage:true});
  await press(page,'bg-start');assert.equal((await calls(page)).some(c=>c.body?.operation==='start'),false,'native validity requires the confirmation');
  await review.locator('input[name="confirm"]').check();await press(page,'bg-start');
  assert.deepEqual((await calls(page)).find(c=>c.body?.operation==='start').body,{operation:'start',candidate:{iss:'https://provider.example',sub:'22222222-2222-4222-8222-222222222222'},category:'owner-deceased',statement:'The owner died in May.',confirm:true});
  // Timeline, then candidacy and the checkout disclosure (sandbox only).
  const panel=page.locator('#org-break-glass').locator('..');assert.match(await panel.textContent(),/@cy<script>/);assert.match(await panel.textContent(),/Gone <img src=x onerror=alert\(1\)> since May/);await layout(page,'timeline');
  await press(page,'bg-accept');assert.ok((await calls(page)).some(c=>c.body?.operation==='accept'));
  assert.match(await panel.textContent(),es?/de 30 a 127 días/:/30 to 127 days/);await layout(page,'disclosure');
  const pay=panel.locator('form').filter({has:page.locator('[data-org-action="bg-checkout"]')});await pay.locator('input[name="confirm"]').check();await press(page,'bg-checkout');assert.equal((await calls(page)).some(c=>c.path.endsWith('/break-glass-checkout')),false,'paid-age attestation required');
  await page.evaluate(()=>{window.fixture.evil=true;});await pay.locator('input[name="ageConfirmed"]').check();await press(page,'bg-checkout');assert.deepEqual(await page.evaluate(()=>window.navigations),[],'a non-sandbox URL is never opened');
  await page.evaluate(()=>{window.fixture.evil=false;});await pay.locator('input[name="confirm"]').check();await pay.locator('input[name="ageConfirmed"]').check();await press(page,'bg-checkout');
  const checkout=(await calls(page)).filter(c=>c.path.endsWith('/break-glass-checkout')).at(-1);assert.deepEqual(checkout.body,{claim,disclosure:'d'.repeat(64),confirm:true,ageConfirmed:18});assert.deepEqual(await page.evaluate(()=>window.navigations),['https://sandbox.polar.sh/checkout/bg']);
  // A plain member: the banner only.
  await page.locator('nav select').selectOption(memberOrg);await settle(page);const banner=page.locator('.org-console [role=status]').filter({hasText:es?'reclamación de propiedad abierta':'ownership claim is open'});assert.equal(await banner.count(),1);assert.equal(await page.locator('[data-org-action^="bg-"]').count(),0);await layout(page,'member');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
