// RTC-g "Calls & connections" and the portal ring in real Chromium and Firefox: the production view, ring, dialog,
// catalogue and stylesheet over a local fixture (no API, no delivery claim). Checks 360 px and desktop widths, light and
// dark colour schemes, English and Spanish, no horizontal scroll, the ring inside the viewport, readable contrast,
// keyboard reachability, the dialog's focus trap, and that a ring arriving never moves focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,firefox} from 'playwright';
const project=resolve('.'),browsers={};let server,origin;
const boot=String.raw`import {dodo} from '/apps/web/src/shared/stack.mjs';
import createApp from '/apps/web/src/ui/release-app.mjs';
import localizeTree from '/apps/web/src/ui/localize.mjs';
import {createLocalization} from '/apps/web/src/shared/i18n.mjs';
import {builtInModules} from '/apps/web/src/shared/portal-modules.mjs';
import {compilePortalModules} from '/packages/portal/index.mjs';
import rtcSettingsView from '/apps/web/src/ui/rtc-settings.mjs';
import {rtcRing,withRtcSurface} from '/apps/web/src/ui/rtc-ring.mjs';
import {SETTINGS} from '/tests/helpers/rtc-settings-fixture.mjs';
const q=new URLSearchParams(location.search),locale=q.get('locale')??'en',now=Date.now(),O='https://space.example',OWNER='550e8400-e29b-41d4-a716-446655440001',CALL='https://spec.bindle.example/rtc-purposes/call/v1',APP='https://app.example/client';
const peer={iss:O,sub:'550e8400-e29b-41d4-a716-446655440002'},far={iss:'https://a-very-long-provider-name.example',sub:'990e8400-e29b-41d4-a716-000000000009'};
const rtc={...structuredClone(SETTINGS),owner:OWNER,generation:1,status:'loaded',contacts:[{parent:'c1',purposes:[CALL]}],
 sessions:[{sid:'s'.repeat(22),role:'callee',state:'connected',own:false,peer,peerHandle:'river_with_a_rather_long_handle',purpose:CALL,media:['audio','video','data'],createdAt:now-60000,ringUntil:now,endsAt:now+86400000,held:false,claimed:true}],
 missed:[{id:'m1',caller:far,callerHandle:null,purpose:CALL,kind:'held',at:now-3600000}],blocked:[{principal:far,at:now,handle:null}],
 blockedIssuers:[{issuer:'https://a-very-long-blocked-provider-name.example',at:now}],muted:[{kind:'issuer',value:'https://spam.example',at:now},{kind:'origin',value:'https://a-rather-long-dialer-application.example',at:now},{kind:'origin',value:'https://a-rather-long-dialer-application.example',issuer:'https://a-very-long-provider-name.example',at:now}],
 tickets:[{jti:'t1',purposes:[CALL],uses:3,usesLeft:2,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true,clientId:APP,origin:'https://app.example'},{jti:'t2',purposes:[CALL],uses:1000,usesLeft:1000,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true,clientId:null,origin:null}],
 endpoints:[{endpoint:'ep_'+'a'.repeat(22),clientId:APP,origin:'https://app.example',label:'Laptop',purposes:[CALL],lastSeen:now}]};
const invite={sid:'r'.repeat(22),caller:peer,callerHandle:'river_with_a_rather_long_handle',callerOrigin:'https://a-rather-long-calling-application-name.example',purpose:CALL,title:{en:'Call',es:'Llamada'},media:['audio','video'],ringUntil:now+600000,apps:[{clientId:APP,origin:'https://app.example'}]};
const account={id:OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{rtcSignalingEnabled:true}};
const navigation=compilePortalModules(builtInModules).list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
let state={locale,view:'calls',modal:null,navigation,brand:{name:'3sln.me'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],session:{account,sessionContext:'ctx'},
 config:{origin:O,termsVersion:'2026-10-11',localDevelopment:false},data:{account,features:{rtcSignalingEnabled:true},messages:[],views:[],contacts:[{id:'c1',name:'Website form',active:true}],collections:[],resources:[],rules:[],devices:[],pushDevices:[],storage:{plan:'free',usedBytes:0,storageBytes:1000000}},
 rtc,rtcRing:{owner:OWNER,generation:1,invites:[],dismissed:[]}};
const l=createLocalization({locale}),localize=tree=>localizeTree(tree,l),app=withRtcSurface(createApp({views:{calls:s=>localize(rtcSettingsView(s))},localize}));
const root=document.getElementById('app'),ringRoot=document.createElement('div');ringRoot.className='rtc-ring-root';ringRoot.setAttribute('aria-live','polite');root.after(ringRoot);
window.intents=[];let opener=null;
const render=()=>{dodo.reconcile(root,[app(state)]);const r=rtcRing(state);dodo.reconcile(ringRoot,r?[localize(r)]:[]);};
const onIntent=event=>{const d=event.detail;window.intents.push(d);if(d.kind==='open-modal'){opener=document.activeElement;state={...state,modal:d.modal};render();requestAnimationFrame(()=>document.querySelector('[role=dialog] button')?.focus());}if(d.kind==='close-modal'){state={...state,modal:null};render();opener?.focus();}
 if(d.kind==='review-rtc-approve'){const data=new FormData(d.form);opener=document.activeElement;state={...state,modal:{kind:'rtc-confirm',action:'approve-app',input:{clientId:d.clientId,purposes:state.rtc.purposes.map(p=>p.id).filter(l=>data.get('approve:'+l)==='on')}}};render();requestAnimationFrame(()=>document.querySelector('[role=dialog] button')?.focus());}};
root.addEventListener('3sln-intent',onIntent);ringRoot.addEventListener('3sln-intent',onIntent);
window.ringFar=()=>{state={...state,rtcRing:{...state.rtcRing,invites:[{...invite,sid:'f'.repeat(22),caller:far,callerHandle:null,callerOriginReportedBy:'a-very-long-provider-name.example',callerProvider:far.iss}]}};render();};
window.ring=on=>{const n=on===true?1:Number(on)||0;state={...state,rtcRing:{...state.rtcRing,invites:Array.from({length:n},(_,k)=>({...invite,sid:String.fromCharCode(114+k).repeat(22)}))}};render();};
render();window.ready=true;`;
test.before(async()=>{server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1'),path=u.pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}
 if(path==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}const file=resolve(project,'.'+path);if(!file.startsWith(project+'/')||!['/apps/','/packages/','/vendor/','/tests/helpers/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/javascript');res.end(await readFile(file));}catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;for(const [name,type] of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));await new Promise(r=>server?.close(r));});
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
// WCAG relative luminance contrast of an element's text against the nearest opaque background.
const contrast=(p,selector)=>p.evaluate(sel=>{const parse=c=>{const m=c.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return {rgb:m.slice(0,3),a:m.length>3?m[3]:1};};const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
 const el=document.querySelector(sel);if(!el)return null;let n=el,bg=null;while(n&&!bg){const c=parse(getComputedStyle(n).backgroundColor);if(c.a>0.9)bg=c.rgb;n=n.parentElement;}bg??=parse(getComputedStyle(document.body).backgroundColor).rgb;const fg=parse(getComputedStyle(el).color).rgb,[a,b]=[lum(fg),lum(bg)].sort((x,y)=>y-x);return (a+0.05)/(b+0.05);},selector);

for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [360,1280])test(`RTC-g ${name} ${locale} ${colorScheme} ${width}`,async()=>{
 const page=await browsers[name].newPage({viewport:{width,height:800},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${origin}/?locale=${locale}`);await page.waitForFunction(()=>window.ready);await settle(page);
  const text=await page.locator('.rtc-settings').innerText();
  for(const pattern of locale==='es'?[/Llamadas y conexiones/,/Privacidad de red/,/Solo a través de relé \(recomendado\)/,/Comprueba con quién hablas/]:[/Calls & connections/,/Network privacy/,/Relay only \(recommended\)/,/Check who you are talking to/])assert.match(text,pattern);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll');
  const panels=await page.locator('.rtc-panel').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect()).map(r=>[Math.round(r.left),Math.round(r.right)]));
  assert.ok(panels.every(([l,r])=>l>=0&&r<=width),'every panel inside the viewport');
  if(width===360)assert.equal(new Set(panels.map(([l])=>l)).size,1,'one column on a phone');else assert.ok(new Set(panels.map(([l])=>l)).size>=2,'two columns on a desktop');
  for(const selector of ['.rtc-privacy h2','.rtc-privacy .field-help','.rtc-missed .field-help','.rtc-choice strong']){const ratio=await contrast(page,selector);assert.ok(ratio>=4.5,`${selector} contrast ${ratio?.toFixed(2)} in ${colorScheme}`);}
  const bg=await page.evaluate(()=>getComputedStyle(document.querySelector('.rtc-panel')).backgroundColor);assert.equal(colorScheme==='dark'?/rgb\((\d+)/.exec(bg)[1]<80:/rgb\((\d+)/.exec(bg)[1]>200,true,`panel background ${bg} follows the ${colorScheme} scheme`);
  // Keyboard: the first privacy choice is reachable by Tab and arrow keys move within its group.
  const relay=page.locator('input[name=other][value=relay]');await relay.focus();assert.equal(await relay.evaluate(e=>document.activeElement===e),true);await page.keyboard.press('ArrowDown');assert.equal(await page.locator('input[name=other][value=public]').evaluate(e=>e.checked&&document.activeElement===e),true,'arrow keys move within the radio group');
  // A ring arriving neither steals focus nor overflows; it fits a 360 px screen.
  await page.evaluate(()=>window.ring(true));await settle(page);
  assert.equal(await page.locator('input[name=other][value=public]').evaluate(e=>document.activeElement===e),true,'focus stays where the owner was');
  const box=await page.locator('.rtc-ring').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+0.5&&box.y+box.height<=800,'the ring is inside the viewport');
  assert.match(await page.locator('.rtc-ring').innerText(),locale==='es'?/Abrir en app\.example/:/Open in app\.example/);
  assert.ok(await contrast(page,'.rtc-ring .field-help')>=4.5,'ring text contrast');
  // Keyboard into the ring: Decline is a real button; Block caller opens the confirmation with focus inside, Tab is
  // trapped, and Cancel returns focus to the button that opened it.
  const block=page.locator('.rtc-ring button',{hasText:locale==='es'?'Bloquear a quien llama':'Block caller'});await block.focus();await page.keyboard.press('Enter');await settle(page);
  const dialog=page.locator('[role=dialog]');await dialog.waitFor();assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'focus moves into the dialog');
  for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'Tab stays inside the dialog');}
  const cancel=dialog.locator('button',{hasText:locale==='es'?'Cancelar':'Cancel'});await cancel.focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await block.evaluate(e=>document.activeElement===e),true,'focus returns to the opener');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'still no horizontal scroll with the ring');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

// Review F8 and F5: three invites on a 360 px phone stay inside the viewport and scroll within the ring; every invite's
// controls are reachable; the heading the console focuses after a Decline or Not now takes focus without page scroll.
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])test(`RTC-g ${name} ${locale} 360 three invites`,async()=>{
 const page=await browsers[name].newPage({viewport:{width:360,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${origin}/?locale=${locale}`);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>window.ring(3));await settle(page);
  assert.equal(await page.locator('.rtc-ring').count(),3);
  const stack=await page.locator('.rtc-ring-stack').evaluate(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,scroll:n.scrollHeight>n.clientHeight,overflow:getComputedStyle(n).overflowY};});
  assert.ok(stack.top>=0&&stack.bottom<=640&&stack.left>=0&&stack.right<=360,`the stack fits the viewport ${JSON.stringify(stack)}`);
  assert.ok(stack.bottom-stack.top<=640*0.7+1,'the ring leaves most of the page visible');assert.equal(stack.scroll,true,'the invites scroll inside the stack');assert.equal(stack.overflow,'auto');
  const last=page.locator('.rtc-ring').nth(2).locator('button').first();await last.focus();await settle(page);
  const box=await last.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=640,'the last invite\'s Decline scrolls into view when focused');
  const heading=page.locator(`[id="rtc-ring-${'t'.repeat(22)}"]`);await heading.evaluate(h=>h.focus());assert.equal(await heading.evaluate(h=>document.activeElement===h),true,'the next invite heading takes focus');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll');assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

// Service follow-ups (2026-10-27): narrowing an app's approved purposes from the apps panel, by keyboard, at phone and
// desktop widths (interim owner approval; extensions rev 3.2 removed AMD-X1): the checkboxes toggle with Space, the save
// button opens the confirmation for a narrowing with focus inside, its
// summary fits and reads, Cancel returns focus to the opener, and confirming sends exactly the purposes kept.
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const [width,colorScheme] of [[360,'dark'],[1280,'light']])test(`RTC approval narrowing ${name} ${locale} ${width} ${colorScheme}`,async()=>{
 const page=await browsers[name].newPage({viewport:{width,height:800},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${origin}/?locale=${locale}`);await page.waitForFunction(()=>window.ready);await settle(page);
  const SYNC='https://spec.bindle.example/rtc-purposes/device-sync/v1',CALL='https://spec.bindle.example/rtc-purposes/call/v1';
  const sync=page.locator(`.rtc-app input[name="approve:${SYNC}"]`);assert.equal(await sync.isChecked(),true);
  await sync.focus();await page.keyboard.press('Space');assert.equal(await sync.isChecked(),false,'Space unchecks the purpose');
  const review=page.locator('.rtc-app form button[type=submit]',{hasText:locale==='es'?'Guardar fines aprobados':'Save approved purposes'});
  await review.focus();await page.keyboard.press('Enter');await settle(page);
  const dialog=page.locator('[role=dialog]');await dialog.waitFor();assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'focus moves into the dialog');
  const summary=await dialog.locator('.rtc-narrow-summary').innerText();
  assert.match(summary,locale==='es'?/Ya no aprobados[\s\S]*Sincronización[\s\S]*Siguen aprobados[\s\S]*Llamada/:/No longer approved[\s\S]*Device sync[\s\S]*Still approved[\s\S]*Call/);
  const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+0.5,'the dialog fits the viewport');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll');
  assert.ok(await contrast(page,'.rtc-narrow-summary .rtc-label')>=4.5,'summary label contrast');
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'Tab stays inside the dialog');}
  await dialog.locator('button',{hasText:locale==='es'?'Cancelar':'Cancel'}).focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await review.evaluate(e=>document.activeElement===e),true,'Cancel returns focus to the review button');
  await page.keyboard.press('Enter');await settle(page);await dialog.waitFor();
  await dialog.locator('button',{hasText:locale==='es'?'Aprobar menos fines':'Approve fewer purposes'}).click();
  assert.deepEqual(await page.evaluate(()=>window.intents.filter(i=>i.kind==='rtc-action').at(-1)),{kind:'rtc-action',action:'approve-app',input:{clientId:'https://app.example/client',purposes:[CALL]}});
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

// RTC wargame M6 and M2: the ring's provider block and app mute for a foreign caller, and the settings' call links by
// app, blocked providers and mutes, by keyboard, at phone and desktop widths in both schemes and languages: focus order
// through the ring's controls, the provider dialog taking and returning focus, contrast and no horizontal scroll.
for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const [width,colorScheme] of [[360,'dark'],[1280,'light']])test(`RTC wargame M2/M6 ${name} ${locale} ${width} ${colorScheme}`,async()=>{
 const page=await browsers[name].newPage({viewport:{width,height:800},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const t=(en,es)=>locale==='es'?es:en;
 try{
  await page.goto(`${origin}/?locale=${locale}`);await page.waitForFunction(()=>window.ready);await page.evaluate(()=>window.ringFar());await settle(page);
  const ring=page.locator('.rtc-ring');assert.match(await ring.innerText(),locale==='es'?/según a-very-long-provider-name\.example/:/reported by a-very-long-provider-name\.example/);
  // Focus order: Decline, Not now, Block caller, Block this provider, Mute this app.
  const decline=ring.locator('button').first();await decline.focus();const order=[await decline.innerText()];
  for(let i=0;i<4;i++){await page.keyboard.press('Tab');order.push(await page.evaluate(()=>document.activeElement.textContent));}
  assert.deepEqual(order,[t('Decline','Rechazar'),t('Not now','Ahora no'),t('Block caller','Bloquear a quien llama'),t('Block this provider','Bloquear este proveedor'),t('Mute this app','Silenciar esta app')]);
  const box=await ring.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+0.5,'the ring fits');
  for(const label of [t('Block this provider','Bloquear este proveedor'),t('Mute this app','Silenciar esta app')]){const b=ring.locator('button',{hasText:label});const c=await b.boundingBox();assert.ok(c&&c.x>=0&&c.x+c.width<=width+0.5&&c.height>=20,`${label} is inside the viewport with a usable target`);}
  assert.ok(await contrast(page,'.rtc-ring button.danger')>=4.5,'danger text contrast in the ring');
  // The provider block opens its confirmation with focus inside, names the provider, traps Tab and returns focus.
  const provider=ring.locator('button',{hasText:t('Block this provider','Bloquear este proveedor')});await provider.focus();await page.keyboard.press('Enter');await settle(page);
  const dialog=page.locator('[role=dialog]');await dialog.waitFor();assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'focus moves into the dialog');
  const text=await dialog.innerText();assert.match(text,locale==='es'?/¿Bloquear este proveedor\?/:/Block this provider\?/);assert.match(text,/a-very-long-provider-name\.example/);
  const d=await dialog.boundingBox();assert.ok(d&&d.x>=0&&d.x+d.width<=width+0.5,'the dialog fits');
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true,'Tab stays inside the dialog');}
  await dialog.locator('button',{hasText:t('Cancel','Cancelar')}).focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await provider.evaluate(e=>document.activeElement===e),true,'Cancel returns focus to Block this provider');
  await page.keyboard.press('Enter');await settle(page);await dialog.waitFor();await dialog.locator('button',{hasText:t('Block provider','Bloquear proveedor')}).click();
  assert.deepEqual(await page.evaluate(()=>window.intents.filter(i=>i.kind==='rtc-action').at(-1)),{kind:'rtc-action',action:'block',input:{issuer:'https://a-very-long-provider-name.example'}});
  await dialog.locator('button',{hasText:t('Cancel','Cancelar')}).click();await settle(page);// the fixture keeps the dialog open after an intent
  await ring.locator('button',{hasText:t('Mute this app','Silenciar esta app')}).click();
  assert.deepEqual(await page.evaluate(()=>window.intents.at(-1)),{kind:'rtc-action',action:'mute',input:{kind:'origin',value:'https://a-rather-long-calling-application-name.example',issuer:'https://a-very-long-provider-name.example'},ring:true,sid:'f'.repeat(22)});
  await page.evaluate(()=>window.ring(0));await settle(page);
  // Settings: call links grouped by app with bulk revokes; blocked providers and mutes listed with their controls.
  const tickets=page.locator('.rtc-tickets');assert.deepEqual(await tickets.locator('.rtc-ticket-app h3').allInnerTexts(),['Caller',t('Unknown app','App desconocida')]);
  const all=tickets.locator('button',{hasText:t('Revoke all call links','Revocar todos los enlaces de llamada')});await all.focus();
  const ticketOrder=[];for(let i=0;i<4;i++){await page.keyboard.press('Tab');ticketOrder.push(await page.evaluate(()=>document.activeElement.textContent));}
  assert.deepEqual(ticketOrder,[t('Revoke','Revocar'),t('Revoke all from this app','Revocar todos los de esta app'),t('Revoke','Revocar'),t('Revoke all from unknown apps','Revocar todos los de apps desconocidas')],'focus follows the reading order through the groups');
  const blocked=page.locator('.rtc-blocked');assert.match(await blocked.innerText(),/a-very-long-blocked-provider-name\.example/);
  assert.equal(await blocked.locator('.rtc-row').count(),5,'one person, one provider, three mutes');
  // Review R3: the scoped mute row names its provider; keyboard order reaches its Unmute after the unscoped row's.
  const scoped=blocked.locator('.rtc-row').last();assert.match(await scoped.innerText(),locale==='es'?/según a-very-long-provider-name\.example/:/reported by a-very-long-provider-name\.example/);
  const unmutes=blocked.locator('.rtc-row button',{hasText:t('Unmute','Dejar de silenciar')});const count=await unmutes.count();
  await unmutes.nth(count-2).focus();await page.keyboard.press('Tab');assert.equal(await scoped.locator('button').evaluate(e=>document.activeElement===e),true,'Tab reaches the scoped row\'s Unmute');
  await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.intents.at(-1)),{kind:'rtc-action',action:'unmute',input:{kind:'origin',value:'https://a-rather-long-dialer-application.example',issuer:'https://a-very-long-provider-name.example'}});
  const ratio=await contrast(page,'.rtc-blocked .rtc-mute-provider');assert.ok(ratio>=4.5,`provider label contrast ${ratio?.toFixed(2)} in ${colorScheme}`);
  for(const selector of ['.rtc-blocked h3','.rtc-blocked .field-help','.rtc-tickets .rtc-ticket-app .field-help','.rtc-tickets .rtc-ticket-app h3','.rtc-blocked .rtc-row button']){const ratio=await contrast(page,selector);assert.ok(ratio>=4.5,`${selector} contrast ${ratio?.toFixed(2)} in ${colorScheme}`);}
  const rows=await page.locator('.rtc-blocked .rtc-row, .rtc-tickets .rtc-row').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect()).map(r=>[r.left,r.right]));assert.ok(rows.every(([l,r])=>l>=0&&r<=width+0.5),'rows stay inside the viewport');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
