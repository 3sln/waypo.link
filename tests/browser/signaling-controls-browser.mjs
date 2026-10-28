// Signaling owner controls re-homed into Account & security and the owner's app connections (signaling.md rev 3.2
// §14.1), in real Chromium and Firefox: the production console renderer, portal modules, dialogs, catalogue and
// stylesheet over a local fixture (no API, no delivery claim). Checks 360 px and desktop widths, light and dark colour
// schemes, English and Spanish, no horizontal scroll, readable contrast, keyboard reachability, the confirmation
// dialog's focus trap and focus return, and that confirming sends exactly the reviewed input.
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
import {compilePortalModules,composePortalViews} from '/packages/portal/index.mjs';
import {SETTINGS,OWNER,ORIGIN,APP,APP2} from '/tests/helpers/signaling-controls-fixture.mjs';
const q=new URLSearchParams(location.search),locale=q.get('locale')??'en',view=q.get('view')??'security',integrations=view!=='connected-apps';
const account={id:OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{signalingEnabled:true}};
const registry=compilePortalModules(builtInModules),navigation=registry.list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
// Long owner data, to prove rows wrap instead of scrolling the page sideways.
const signaling={...structuredClone(SETTINGS),owner:OWNER,generation:1,status:'loaded'};
signaling.apps[0].endpoints[0].label='A rather long device label for the living room laptop';signaling.blockedIssuers.push({issuer:'https://a-very-long-blocked-provider-name-for-testing.example',at:Date.now()});
signaling.apps[0].pairings[0].label='Pairing with an unusually long descriptive label';
let state={locale,view,modal:null,navigation,brand:{name:'3sln.me',host:'space.example'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],session:{account,sessionContext:'ctx'},
 config:{origin:ORIGIN,termsVersion:'2026-10-11',localDevelopment:false,integrationsEnabled:integrations,emailEnabled:false},
 data:{account,features:{signalingEnabled:true},messages:[],views:[],contacts:[],collections:[],resources:[],rules:[],devices:[],pushDevices:[],credentials:[],grants:[],storage:{plan:'free',usedBytes:0,storageBytes:1000000}},
 connectionsConsole:{owner:OWNER,session:'ctx',generation:1,connections:[{id:'c1',clientId:APP,name:'Studio',state:'active',integration:{kind:'external'}},{id:'c2',clientId:APP2,name:'Other app',state:'active',integration:{kind:'external'}}],offerings:[],fields:[],features:[],notices:[]},
 mcpGrants:{phase:'ready',appsPhase:'ready',grantsPhase:'ready',bindlePhase:'ready',apps:[{id:'m1',clientId:APP,name:'Studio',status:'active',resourceURI:'https://app.example/mcp',provenance:{issuer:ORIGIN},connectedAt:Date.now(),notifications:{enabled:false},generation:1}],items:[],bindle:[]},
 signaling};
const l=createLocalization({locale}),localize=tree=>localizeTree(tree,l),views=composePortalViews(registry,{t:l.t,number:l.number,date:l.date,localize}),app=createApp({views,localize});
const root=document.getElementById('app');window.intents=[];let opener=null;
const render=()=>dodo.reconcile(root,[app(state)]);
root.addEventListener('3sln-intent',event=>{const d=event.detail;window.intents.push(JSON.parse(JSON.stringify({...d,form:undefined})));
 if(d.kind==='open-modal'){opener=document.activeElement;state={...state,modal:d.modal};render();requestAnimationFrame(()=>document.querySelector('[role=dialog] .signaling-confirm button')?.focus());}
 if(d.kind==='close-modal'){state={...state,modal:null};render();opener?.focus();}});
render();window.ready=true;`;
test.before(async()=>{server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1'),path=u.pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}
 if(path==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}const file=resolve(project,'.'+path);if(!file.startsWith(project+'/')||!['/apps/','/packages/','/vendor/','/tests/helpers/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(await readFile(file));}catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;for(const [name,type] of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));await new Promise(r=>server?.close(r));});
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
// WCAG relative luminance contrast of an element's text against the nearest opaque background.
const contrast=(p,selector)=>p.evaluate(sel=>{const parse=c=>{const m=c.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return {rgb:m.slice(0,3),a:m.length>3?m[3]:1};};const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
 const el=document.querySelector(sel);if(!el)return null;let n=el,bg=null;while(n&&!bg){const c=parse(getComputedStyle(n).backgroundColor);if(c.a>0.9)bg=c.rgb;n=n.parentElement;}bg??=parse(getComputedStyle(document.body).backgroundColor).rgb;const fg=parse(getComputedStyle(el).color).rgb,[a,b]=[lum(fg),lum(bg)].sort((x,y)=>y-x);return (a+0.05)/(b+0.05);},selector);
const noSideScroll=async page=>{const wide=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth?[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,4).map(n=>`${n.tagName}.${n.className} ${Math.round(n.getBoundingClientRect().right)}/${innerWidth} ${(n.textContent??'').slice(0,40)}`):null);assert.equal(wide,null,'no horizontal scroll');};
const inside=async(page,selector,width)=>{const boxes=await page.locator(selector).evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect()).map(r=>[r.left,r.right]));assert.ok(boxes.length>0,selector);assert.ok(boxes.every(([l,r])=>l>=-0.5&&r<=width+0.5),`${selector} inside the viewport ${JSON.stringify(boxes.slice(0,3))}`);};

for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [360,1280])test(`signaling privacy ${name} ${locale} ${colorScheme} ${width}`,async()=>{
 const page=await browsers[name].newPage({viewport:{width,height:800},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));const t=(en,es)=>locale==='es'?es:en;
 try{
  await page.goto(`${origin}/?locale=${locale}&view=security`);await page.waitForFunction(()=>window.ready);await settle(page);
  const panel=page.locator('.signaling-panel'),text=await panel.innerText();
  for(const pattern of locale==='es'?[/Conexiones directas/,/Solo a través de relé \(recomendado\)/,/Entre tus propios dispositivos/,/Personas y proveedores bloqueados/]:[/Direct connections/,/Relay only \(recommended\)/,/Between your own devices/,/Blocked people and providers/])assert.match(text,pattern);
  await noSideScroll(page);await inside(page,'.signaling-panel, .signaling-panel .signaling-row',width);
  for(const selector of ['.signaling-panel h2','.signaling-panel .field-help','.signaling-choice strong','.signaling-panel .signaling-row button']){const ratio=await contrast(page,selector);assert.ok(ratio>=4.5,`${selector} contrast ${ratio?.toFixed(2)} in ${colorScheme}`);}
  const bg=await page.evaluate(()=>getComputedStyle(document.querySelector('.signaling-panel')).backgroundColor);assert.equal(colorScheme==='dark'?/rgb\((\d+)/.exec(bg)[1]<80:/rgb\((\d+)/.exec(bg)[1]>200,true,`panel background ${bg} follows the ${colorScheme} scheme`);
  // Keyboard: arrow keys move within a radio group; Tab from the save button reaches every Unblock in reading order.
  const relay=page.locator('input[name=other][value=relay]');await relay.focus();await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('input[name=other][value=public]').evaluate(e=>e.checked&&document.activeElement===e),true,'arrow keys move within the radio group');
  await panel.locator('form button[type=submit]').focus();const order=[];for(let i=0;i<4;i++){await page.keyboard.press('Tab');order.push(await page.evaluate(()=>document.activeElement.textContent));}
  assert.deepEqual(order.slice(0,3),Array(3).fill(t('Unblock','Desbloquear')),'every Unblock is reachable by Tab');
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.intents.at(-1)),{kind:'signaling-action',action:'unblock',input:{issuer:'https://spam.example'}});
  await panel.locator('form button[type=submit]').press('Enter');assert.equal(await page.evaluate(()=>window.intents.at(-1).kind),'save-signaling-policy');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const [view,width,colorScheme] of [['connections',360,'dark'],['connections',1280,'light'],['connected-apps',360,'light'],['connected-apps',1280,'dark']])test(`signaling app controls ${view} ${name} ${locale} ${width} ${colorScheme}`,async()=>{
 const page=await browsers[name].newPage({viewport:{width,height:800},colorScheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));const t=(en,es)=>locale==='es'?es:en;
 try{
  await page.goto(`${origin}/?locale=${locale}&view=${view}`);await page.waitForFunction(()=>window.ready);await settle(page);
  const controls=page.locator('.signaling-app').first(),text=await controls.innerText();
  for(const pattern of locale==='es'?[/Tipos de conexión/,/Charla/,/Cualquiera con la oferta/,/3 de 10 usos gastados/,/Emparejamientos/,/Sin vencimiento/]:[/Connection types/,/Chat/,/Anyone with the offer/,/3 of 10 uses spent/,/Pairings/,/No expiry/])assert.match(text,pattern);
  assert.equal(await page.locator('.signaling-other .signaling-app').count(),1,'the app without a connection is listed after');
  await noSideScroll(page);await inside(page,'.signaling-app .signaling-row',width);
  for(const selector of ['.signaling-app .signaling-label','.signaling-app .field-help','.signaling-app .signaling-row button.danger']){const ratio=await contrast(page,selector);assert.ok(ratio>=4.5,`${selector} contrast ${ratio?.toFixed(2)} in ${colorScheme}`);}
  // Keyboard: the controls follow reading order; Remove opens the confirmation with focus inside, Tab is trapped, Cancel
  // returns focus to the opener, and confirming sends exactly the reviewed input.
  const first=controls.locator('button').first();await first.focus();const order=[await first.innerText()];for(let i=0;i<3;i++){await page.keyboard.press('Tab');order.push(await page.evaluate(()=>document.activeElement.textContent));}
  assert.deepEqual(order,[t('Remove','Eliminar'),t('Turn off','Desactivar'),t('Remove','Eliminar'),t('Remove','Eliminar')]);
  const revoke=controls.locator('button',{hasText:t('Revoke all offers from this app','Revocar todas las ofertas de esta app')});await revoke.focus();await page.keyboard.press('Enter');await settle(page);
  const dialog=page.locator('[role=dialog]');await dialog.waitFor();assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'focus moves into the dialog');
  assert.match(await dialog.innerText(),locale==='es'?/¿Revocar todas las ofertas de esta app\?[\s\S]*Studio/:/Revoke every offer from this app\?[\s\S]*Studio/);
  const box=await dialog.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+0.5,'the dialog fits the viewport');await noSideScroll(page);
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true,'Tab stays inside the dialog');}
  await dialog.locator('button',{hasText:t('Cancel','Cancelar')}).focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await revoke.evaluate(e=>document.activeElement===e),true,'Cancel returns focus to the opener');
  await page.keyboard.press('Enter');await settle(page);await dialog.waitFor();
  await dialog.locator('.signaling-confirm button',{hasText:t('Revoke offers','Revocar ofertas')}).click();
  assert.deepEqual(await page.evaluate(()=>window.intents.at(-1)),{kind:'signaling-action',action:'revoke-offers',input:{clientId:'https://app.example/client'}});
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
