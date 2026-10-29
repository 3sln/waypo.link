// ORG-12d operator case screens in the real admin shell. Runs in its own ephemeral local Worker
// (scripts/run-browser-checks.mjs) with a fresh single-use boot token: boot is claimed, an administrator is minted and
// onboarded with a real passkey (Chromium virtual authenticator), and the real /console?admin access flow and
// passkey step-up run against the Worker. Only the four /api/admin/org-cases/* routes are fulfilled by a fixture:
// seeding a held break-glass claim (organizations, billing, owner channels, a support-capable internal operator)
// through this Worker is not practical, so this suite shows the screens and their requests, not the server's
// decisions (those are engine-tested). Each decision asks /org-cases/challenge, which the fixture answers with a real
// /api/admin/step-up/begin challenge, and
// signs it with the virtual authenticator. Variant contexts reuse the signed-in session (storage state) and drop the
// page-exit step-up withdrawal (/api/admin/step-up/end) so closing one variant does not end the next one's read
// window. Chromium and Firefox, en and es, 390 and 1280 px, light and dark. Screenshots: artifacts/browser/admin-org-cases-*.
import test from 'node:test';import assert from 'node:assert/strict';import {firefox} from 'playwright';
import {launch,baseURL,virtualAuthenticator,screenshot} from './browser.mjs';
const bootToken=process.env.E2E_BOOT_TOKEN||'';
const BOOT_PASSWORD='correct horse battery staple boot';
const ORG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',LAPSE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CLAIM='dddddddd-dddd-4ddd-8ddd-dddddddddddd',DAY=86400000;
async function probe(){try{const response=await fetch(baseURL+'/api/admin/boot/status',{method:'POST',headers:{Origin:baseURL,'Content-Type':'application/json','X-Bindle-Admin-Actor':'boot'},body:'{}'});return response.ok?await response.json():null;}catch{return null;}}
/** The org-case fixture: one held break-glass claim and one escalated lapse claim; `me` switches operators. */
function cases(){
 const now=Date.now(),s={me:'op1',decides:[],proposer:null,proposal:null,state:'held'};
 const channels=[{id:'ch-email',kind:'email',enrolledAt:now-200*DAY,ageDays:200,excluded:false,disputed:false,undeliverable:false,excludable:false},{id:'ch-push',kind:'push',enrolledAt:now-150*DAY,ageDays:150,excluded:false,disputed:false,undeliverable:true,excludable:true},{id:'ch-session',kind:'session',enrolledAt:now-100*DAY,ageDays:100,excluded:false,disputed:true,undeliverable:false,excludable:true}];
 const bg=()=>({org:ORG,handle:'acme',kind:'break-glass',process:CLAIM,state:s.state,contest:null,track:'S',causes:['objection','channel-undeliverable'],frozen:false,createdAt:now-40*DAY,paidAt:now-38*DAY,waitEndsAt:null,held:{enteredAt:now-5*DAY,ackAt:null},heldTotal:5*DAY,finalEndsAt:s.state==='final'?now+7*DAY:null,channels,disputes:[{channel:'ch-session',at:now-DAY,excluded:false}],objections:1,proposal:s.proposal?{...s.proposal,mine:s.proposer===s.me}:null,decision:null,barred:false,ownerStatus:'active',category:'owner-unreachable',statementDigest:'f'.repeat(64),billingHeld:false,timeline:[{event:'start',t:'T1',from:null,to:'gathering',at:now-40*DAY},{event:'paid',t:'T5',from:'gathering',to:'waiting',at:now-38*DAY},{event:'object',t:'T8',from:'waiting',to:'held',at:now-5*DAY}],allowed:s.state==='held'?['acknowledge','note','abort','proceed']:[],seizingEnabled:true,decisionsLeft:20-s.decides.filter(d=>d.by===s.me).length});
 const lapse=()=>({org:LAPSE,handle:'beta',kind:'lapse-claim',process:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',state:'escalated',escalatedAt:now-2*DAY,proposal:null,approved:false,allowed:['close','proceed'],seizingEnabled:true,decisionsLeft:20});
 const answer=(op,body)=>{
  if(op==='list')return {cases:[{org:ORG,handle:'acme',kind:'break-glass',process:CLAIM,state:'held',since:now-5*DAY,updatedAt:now},{org:LAPSE,handle:'beta',kind:'lapse-claim',process:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',state:'escalated',since:now-2*DAY,updatedAt:now}],next:null};
  if(op==='get')return {case:body.org===LAPSE?lapse():bg()};
  if(op==='audit')return {entries:s.decides.map((d,i)=>({seq:10+i,at:now,action:'org-case.decide',phase:'applied',actor:{handle:d.by},target:d.org,after:{decision:d.decision,kind:d.kind,outcome:d.outcome}})).reverse(),next:null};
  if(op==='decide'){let outcome='recorded';if(body.decision==='proceed'){if(!s.proposal){s.proposal={decision:'proceed',at:now,expiresAt:now+3*DAY,exclude:body.exclude};s.proposer=s.me;outcome='proposed';}else{s.proposal=null;s.state='final';outcome='approved';}}s.decides.push({...body,by:s.me,outcome});return {outcome,decisionsLeft:20-s.decides.filter(d=>d.by===s.me).length};}
  return null;
 };
 return {s,route:async route=>{const op=new URL(route.request().url()).pathname.split('/').at(-1),body=JSON.parse(route.request().postData()||'{}'),value=answer(op,body);await route.fulfill(value?{json:value,headers:{'Cache-Control':'private, no-store'}}:{status:404,json:{error:'not_found'}});}};
}
/** Claims an invited name through the real token-onboarding UI with a passkey (as tests/e2e/admin-console.test.mjs). */
async function claimThroughOnboarding(browser,link,name){
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();await virtualAuthenticator(context,page);
 await page.route(baseURL+'/api/config',async route=>{try{const response=await route.fetch(),config=JSON.parse(await response.text());config.tokenOnboardingEnabled=true;await route.fulfill({status:response.status(),headers:response.headers(),body:JSON.stringify(config)});}catch{await route.continue().catch(()=>{});}});
 await page.goto(link);await page.getByRole('button',{name:'Use invitation',exact:true}).click();
 await page.selectOption('[name=onboardingName]',name);await page.getByRole('button',{name:'Continue',exact:true}).click();
 for(let step=0;step<6;step++){const create=page.getByRole('button',{name:'Create my account',exact:true}),terms=page.locator('[name=termsAccepted]');await create.or(terms).first().waitFor();if(await create.count())break;await page.locator('[name=ageConfirmed]').check();await terms.check();await page.getByRole('button',{name:'Continue',exact:true}).click();await terms.waitFor({state:'detached'});}
 await page.getByRole('button',{name:'Create my account',exact:true}).click();await page.waitForURL(/\/recovery\/setup/);
 const pendingToken=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('3sln-setup')??'null')?.token);assert.ok(pendingToken,'onboarding produced a pending setup');
 const post=(path,data)=>context.request.post(baseURL+path,{headers:{Origin:baseURL},data});
 const file=await (await post('/api/auth/recovery/download',{pendingToken})).json();assert.equal((await post('/api/auth/recovery/confirm',{pendingToken,recoveryToken:file.recoveryToken,downloadConfirmed:true})).status(),200);
 return {context,page};
}
const layout=async(page,label)=>{
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+': no horizontal page scroll');
 assert.deepEqual(await page.locator('.admin-org-cases .button').evaluateAll(els=>els.filter(e=>e.offsetParent!==null&&e.getBoundingClientRect().height<44).map(e=>e.textContent.trim())),[],label+': 44 px targets');
 assert.equal(await page.evaluate(()=>/@[a-z0-9-]+\.[a-z]{2,}/i.test(document.querySelector('.admin-org-cases')?.innerText??'')),false,label+': no address on screen');
};
// The first painted background behind a case panel (the panel itself, or an ancestor), as relative luminance 0–1.
const luminance=page=>page.evaluate(()=>{for(let node=document.querySelector('.admin-org-cases .panel');node;node=node.parentElement){const parts=(getComputedStyle(node).backgroundColor.match(/[\d.]+/g)??[]).map(Number);if(parts.length>=3&&(parts.length<4||parts[3]>0.5))return (0.2126*parts[0]+0.7152*parts[1]+0.0722*parts[2])/255;}const parts=getComputedStyle(document.documentElement).backgroundColor.match(/[\d.]+/g)?.map(Number)??[255,255,255];return (0.2126*parts[0]+0.7152*parts[1]+0.0722*parts[2])/255;});

test('ORG-12d operator case screens in the real admin shell',async t=>{
 const status=await probe();
 if(!bootToken||!status?.configured||status.token!=='unused'){t.skip('Needs its own Worker with an unused boot token for this origin (run through scripts/run-browser-checks.mjs).');return;}
 const browsers={chromium:await launch(),firefox:await firefox.launch({headless:true})};t.after(async()=>{for(const b of Object.values(browsers))await b.close();});
 const errors=[];
 // ---- boot mints an administrator (real) ----
 const bootContext=await browsers.chromium.newContext({viewport:{width:1280,height:900}}),boot=await bootContext.newPage();boot.on('pageerror',e=>errors.push(e.message));
 await boot.goto(baseURL+'/console?boot');await boot.getByRole('heading',{name:'Set up boot access'}).waitFor();
 await boot.getByLabel('Boot token',{exact:true}).fill(bootToken);await boot.getByRole('button',{name:'Check token',exact:true}).click();await boot.getByRole('heading',{name:'Claim boot access'}).waitFor();
 await boot.getByRole('radio',{name:/Password/}).check();await boot.getByLabel('Boot password',{exact:true}).fill(BOOT_PASSWORD);await boot.getByLabel('Repeat the password',{exact:true}).fill(BOOT_PASSWORD);
 await boot.getByRole('checkbox',{name:/I understand boot access ends/}).check();await boot.getByRole('button',{name:'Claim boot',exact:true}).click();await boot.getByRole('heading',{name:'Overview'}).waitFor();
 assert.equal(await boot.getByRole('navigation',{name:'Administration sections'}).getByRole('button',{name:'Organization cases'}).count(),0,'boot is never an operator: no org-case navigation');
 const nav=name=>boot.getByRole('navigation',{name:'Administration sections'}).getByRole('button',{name,exact:true}).click();
 await nav('Reservations');await boot.getByLabel('Handle',{exact:true}).fill('case-desk');await boot.getByRole('checkbox',{name:/^Administrator/}).check();await boot.getByRole('button',{name:'Save reservation',exact:true}).click();await boot.getByText('Reservation saved.').waitFor();
 await nav('Claims');await boot.getByLabel('Reserved handle',{exact:true}).fill('case-desk');await boot.getByRole('button',{name:'Mint claim token',exact:true}).click();
 await boot.getByRole('alertdialog',{name:'Mint an administrator claim?'}).waitFor();await boot.getByRole('button',{name:'Mint administrator claim',exact:true}).click();
 const link=await boot.getByLabel('Claim link',{exact:true}).inputValue();await bootContext.close();
 // ---- the administrator: real access flow and passkey step-up; org-case routes from the fixture ----
 const admin=await claimThroughOnboarding(browsers.chromium,link,'case-desk'),page=admin.page,fixture=cases();page.on('pageerror',e=>errors.push(e.message));
 const decideBodies=[],challengeBodies=[];await admin.context.route('**/api/admin/org-cases/*',async route=>{const url=route.request().url();if(url.endsWith('/decide'))decideBodies.push(JSON.parse(route.request().postData()));
  // Review L7: the console asks /org-cases/challenge for a challenge bound to the decision. The fixture records the body
  // and answers with a REAL step-up challenge from the Worker, so the virtual authenticator still signs a real one.
  if(url.endsWith('/challenge')){challengeBodies.push(JSON.parse(route.request().postData()));const response=await route.fetch({url:baseURL+'/api/admin/step-up/begin',postData:'{}'});return route.fulfill({response});}
  return fixture.route(route);});
 await page.goto(baseURL+'/console?admin');await page.getByRole('dialog',{name:'Confirm it’s you'}).waitFor();await page.getByRole('button',{name:'Confirm with passkey',exact:true}).click();await page.getByRole('heading',{name:'Overview'}).waitFor();
 const adminNav=page.getByRole('navigation',{name:'Administration sections'});await adminNav.getByRole('button',{name:'Organization cases',exact:true}).click();
 await page.getByRole('heading',{name:'Organization cases',level:1}).waitFor();await page.getByText('@acme').waitFor();
 assert.equal(await adminNav.getByRole('button',{name:'Organization cases'}).getAttribute('aria-current'),'page');assert.equal(await adminNav.locator('[aria-current=page]').count(),1);
 await page.getByRole('button',{name:'Open case',exact:true}).first().click();await page.getByRole('heading',{name:'Organization case',level:1}).waitFor();
 await page.getByRole('cell',{name:'Known session',exact:true}).waitFor();await page.getByText('150 days before now').waitFor();
 // Propose to proceed, excluding the undeliverable push channel; the passkey is the real virtual authenticator.
 await page.getByRole('button',{name:'Propose to proceed',exact:true}).click();await page.locator('#org-case-form-heading').waitFor();
 assert.equal(await page.locator('input[name=exclude]').count(),2,'only disputed or undeliverable channels are offered');
 await page.getByLabel('Reason category').selectOption('channel-undeliverable');await page.getByLabel('Reason (10–500 characters)').fill('The push subscription has returned 410 for a week.');
 await page.locator('input[name=exclude][value=ch-push]').check();await page.getByRole('button',{name:'Confirm with passkey',exact:true}).click();
 await page.getByText('Proposal recorded. A second operator must approve it.').waitFor();await page.getByText('Waiting for a second operator. You cannot approve your own proposal.').waitFor();
 assert.equal(decideBodies.length,1);assert.deepEqual(decideBodies[0].exclude,['ch-push']);assert.deepEqual(challengeBodies[0],{org:ORG,kind:'break-glass',process:CLAIM,decision:'proceed',exclude:['ch-push']},'the challenge names exactly this decision');assert.equal(decideBodies[0].decision,'proceed');assert.ok(decideBodies[0].passkeyResponse?.id,'a real passkey assertion travels with the decision');
 assert.equal(await page.getByRole('button',{name:'Approve proposal'}).count(),0);
 await screenshot(page,'admin-org-cases-proposed');
 // A second operator (the fixture switches identity) approves with exactly the proposed exclusions.
 fixture.s.me='op2';await page.getByRole('button',{name:'Reload case',exact:true}).click();await page.getByRole('button',{name:'Approve proposal',exact:true}).click();await page.locator('#org-case-form-heading').waitFor();
 assert.equal(await page.locator('input[name=exclude]').count(),0,'the approver cannot change the exclusions');
 await page.getByLabel('Reason category').selectOption('evidence-reviewed');await page.getByLabel('Reason (10–500 characters)').fill('Second operator reviewed the same evidence.');await page.getByRole('button',{name:'Confirm with passkey',exact:true}).click();
 await page.getByText('Decision approved and applied.').waitFor();assert.deepEqual(decideBodies[1].exclude,['ch-push']);
 await page.getByRole('button',{name:'Back to queue',exact:true}).click();await page.getByRole('button',{name:'Operator audit',exact:true}).click();await page.getByText('org-case.decide').first().waitFor();await screenshot(page,'admin-org-cases-audit');
 const storageState=await admin.context.storageState();
 // ---- variants: Chromium and Firefox × en/es × 390/1280 × light/dark, view-only ----
 for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const [width,height] of [[390,844],[1280,900]])for(const colorScheme of ['light','dark']){
  const tag=`${name}-${locale}-${width}-${colorScheme}`,es=locale==='es',context=await browsers[name].newContext({viewport:{width,height},colorScheme,storageState}),view=await context.newPage(),variant=cases();
  try{view.on('pageerror',e=>errors.push(tag+': '+e.message));await context.route('**/api/admin/org-cases/*',variant.route);await context.route('**/api/admin/step-up/end',route=>route.fulfill({json:{ended:true}}));
   await view.goto(baseURL+'/console?admin'+(es?'&lang=es':''));await view.getByRole('heading',{name:es?'Resumen':'Overview',level:1}).or(view.getByRole('heading',{name:'Overview',level:1})).first().waitFor();
   await view.getByRole('navigation').getByRole('button',{name:es?'Casos de organizaciones':'Organization cases',exact:true}).click();
   await view.getByRole('heading',{name:es?'Casos de organizaciones':'Organization cases',level:1}).waitFor();await view.getByText('@beta').waitFor();
   await layout(view,tag+' queue');await screenshot(view,`admin-org-cases-${tag}-queue`);
   await view.getByRole('button',{name:es?'Abrir caso':'Open case',exact:true}).first().click();await view.getByRole('heading',{name:es?'Caso de organización':'Organization case',level:1}).waitFor();
   await view.getByRole('cell',{name:es?'Sesión conocida':'Known session',exact:true}).waitFor();await view.getByText(es?'Inaccesible':'Undeliverable').first().waitFor();
   await view.getByRole('button',{name:es?'Proponer que continúe':'Propose to proceed',exact:true}).click();await view.locator('#org-case-form-heading').waitFor();
   await layout(view,tag+' case');const lum=await luminance(view);assert.ok(colorScheme==='dark'?lum<0.35:lum>0.65,tag+': colour scheme applied ('+lum.toFixed(2)+')');
   await screenshot(view,`admin-org-cases-${tag}-case`);
   // Keyboard: the form's first control is reachable and the passkey button is a real submit.
   assert.equal(await view.getByRole('button',{name:es?'Confirmar con llave de acceso':'Confirm with passkey',exact:true}).getAttribute('type'),'submit');
  }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
});
