// Signaling owner pages (console view `signaling`; signaling.md rev 3.2 §20.1.4, §5.8, §4.3) in real Chromium and
// Firefox: the production console renderer, portal modules, dialogs, catalogue and stylesheet over a local fixture (no
// API, no delivery claim), with the real decision gate (bl/signaling-pages.mjs decisionGate over createArming, as
// release.mjs wires it). Checks that a decision control is refused until armed, re-arms on blur, admits a trusted
// mouse or keyboard activation once armed and never a synthetic one; and 360 px and desktop widths, light and dark
// colour schemes, English and Spanish, no horizontal scroll, readable contrast and keyboard reachability.
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
import {decisionGate} from '/apps/web/src/bl/signaling-pages.mjs';
import * as F from '/tests/helpers/signaling-pages-fixture.mjs';
const q=new URLSearchParams(location.search),locale=q.get('locale')??'en',page=q.get('page')??'approve';
const account={id:F.OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{signalingEnabled:true}};
const registry=compilePortalModules(builtInModules),navigation=registry.list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
const pages={approve:{review:F.APPROVE_REVIEW},'approve-self':{review:F.SYNC_REVIEW},pair:{},'pair-review':{review:F.PAIR_REVIEW},pairing:{detail:F.LIVE_DETAIL},overview:{},service:{service:F.SERVICE,review:F.SERVICE_REVIEW}};
const settings={...structuredClone(F.SETTINGS_WITH_PEERS),owner:F.OWNER,generation:1,status:'loaded'};
settings.pairings.push({...structuredClone(F.DETAIL.pairing),id:'pr_'+'l'.repeat(22),label:'A pairing with an unusually long descriptive label for a narrow screen',peer:{principal:{iss:'https://a-very-long-provider-name-for-testing.example',sub:'990e8400-e29b-41d4-a716-00000000000a'}}});
let state={locale,view:'signaling',modal:null,navigation,brand:{name:'3sln.me',host:'space.example'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],session:{account,sessionContext:'ctx'},
 config:{origin:F.ORIGIN,termsVersion:'2026-10-11',localDevelopment:false,integrationsEnabled:true,emailEnabled:false},
 data:{account,features:{signalingEnabled:true},messages:[],views:[],contacts:[],collections:[],resources:[],rules:[],devices:[],pushDevices:[],credentials:[],grants:[],storage:{plan:'free',usedBytes:0,storageBytes:1000000}},
 signaling:settings,signalingPage:{owner:F.OWNER,generation:1,page:page.split('-')[0],params:{},status:'ready',review:null,refusal:null,detail:null,service:null,armed:false,...structuredClone(pages[page])}};
const l=createLocalization({locale}),localize=tree=>localizeTree(tree,l),views=composePortalViews(registry,{t:l.t,number:l.number,date:l.date,localize}),app=createApp({views,localize});
const root=document.getElementById('app');window.outcomes=[];window.intents=[];
const render=()=>{dodo.reconcile(root,[app(state)]);gate.sync();};
const gate=decisionGate({win:window,doc:document,read:()=>state,arm:({armed,surface})=>{if(state.signalingPage.review?.review!==surface)return;state={...state,signalingPage:{...state.signalingPage,armed,surface}};window.outcomes.push(armed?'armed':'disarmed');render();},early:()=>window.outcomes.push('early')});
root.addEventListener('3sln-intent',event=>{const d=event.detail;
 if(d.kind==='signaling-decide'){if(!gate.passes(d.nativeEvent)){window.outcomes.push(d.nativeEvent?.isTrusted===true?'refused':'untrusted');return;}window.outcomes.push('decided');return;}
 window.intents.push(JSON.parse(JSON.stringify({...d,nativeEvent:undefined,form:undefined})));});
render();window.ready=true;`;
test.before(async()=>{server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1'),path=u.pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}
 if(path==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}const file=resolve(project,'.'+path);if(!file.startsWith(project+'/')||!['/apps/','/packages/','/vendor/','/tests/helpers/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(await readFile(file));}catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;for(const [name,type] of Object.entries({chromium,firefox}))browsers[name]=await type.launch({headless:true});});
test.after(async()=>{await Promise.all(Object.values(browsers).map(b=>b.close()));await new Promise(r=>server?.close(r));});
const settle=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const contrast=(p,selector)=>p.evaluate(sel=>{const parse=c=>{const m=c.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return {rgb:m.slice(0,3),a:m.length>3?m[3]:1};};const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
 const el=document.querySelector(sel);if(!el)return null;let n=el,bg=null;while(n&&!bg){const c=parse(getComputedStyle(n).backgroundColor);if(c.a>0.9)bg=c.rgb;n=n.parentElement;}bg??=parse(getComputedStyle(document.body).backgroundColor).rgb;const fg=parse(getComputedStyle(el).color).rgb,[a,b]=[lum(fg),lum(bg)].sort((x,y)=>y-x);return (a+0.05)/(b+0.05);},selector);
const noSideScroll=async page=>{const wide=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth?[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,4).map(n=>`${n.tagName}.${n.className} ${Math.round(n.getBoundingClientRect().right)}/${innerWidth} ${(n.textContent??'').slice(0,40)}`):null);assert.equal(wide,null,'no horizontal scroll');};
const open=async(name,{page='approve',locale='en',width=1280,colorScheme='light'}={})=>{const p=await browsers[name].newPage({viewport:{width,height:900},colorScheme}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`${origin}/?locale=${locale}&page=${page}`);await p.waitForFunction(()=>window.ready);await settle(p);return {p,errors};};
const outcomes=p=>p.evaluate(()=>window.outcomes.slice());

for(const name of ['chromium','firefox'])test(`the decision gate (${name}): refused before arming, armed after the delay, re-armed on blur, trusted activations only`,async()=>{
 const {p,errors}=await open(name);
 try{
  const decide=p.locator('[data-signaling-decide]');assert.equal(await decide.getAttribute('aria-disabled'),'true');
  assert.notEqual(await p.evaluate(()=>document.activeElement?.dataset?.signalingDecide),'true','never default focus');
  // Restart the delay (as losing focus does), then press at once: refused and explained.
  await decide.scrollIntoViewIfNeeded();await settle(p);const box=await decide.boundingBox(),press=()=>p.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await p.evaluate(()=>{window.outcomes.length=0;window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});await press();
  assert.deepEqual((await outcomes(p)).filter(o=>o!=='disarmed'),['early','refused'],'a click before arming is refused and explained');
  await p.waitForFunction(()=>window.outcomes.includes('armed'),null,{timeout:5000});await settle(p);
  assert.equal(await decide.getAttribute('aria-disabled'),null);
  await p.evaluate(()=>document.querySelector('[data-signaling-decide]').click());assert.equal((await outcomes(p)).at(-1),'untrusted','a synthetic click never decides');
  await decide.click();assert.equal((await outcomes(p)).at(-1),'decided');
  // Losing focus re-arms: the next click is refused until the delay has passed again.
  await p.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});await press();assert.equal((await outcomes(p)).at(-1),'refused');
  await settle(p);assert.equal(await decide.getAttribute('aria-disabled'),'true');
  await p.waitForFunction(()=>window.outcomes.filter(o=>o==='armed').length>=2,null,{timeout:5000});
  await decide.focus();await p.keyboard.press('Enter');assert.equal((await outcomes(p)).at(-1),'decided','a keyboard activation that starts while armed decides');
  assert.deepEqual(errors,[]);
 }finally{await p.close();}
});

for(const name of ['chromium','firefox'])for(const locale of ['en','es'])for(const [page,width,colorScheme] of [['approve',360,'dark'],['approve-self',1280,'light'],['pair',360,'light'],['pair-review',1280,'dark'],['pairing',360,'dark'],['overview',360,'light'],['overview',1280,'dark'],['service',360,'light']])test(`signaling page ${page} ${name} ${locale} ${width} ${colorScheme}`,async()=>{
 const {p,errors}=await open(name,{page,locale,width,colorScheme});const t=(en,es)=>locale==='es'?es:en;
 try{
  const text=await p.locator('.signaling-pages').innerText();
  assert.match(text,locale==='es'?/Conexiones directas/:/Direct connections/);
  if(page==='approve')assert.match(text,locale==='es'?/Esta app verá quién se conecta/:/This app will see who is connecting/);
  if(page==='pair-review')assert.match(text,locale==='es'?/Este proveedor solo puede hacer cumplir tu lado/:/This provider can enforce only your side/);
  if(page==='overview')assert.match(text,locale==='es'?/Emparejamientos con otras cuentas[\s\S]*Ofertas activas/:/Pairings with other accounts[\s\S]*Live offers/);
  await noSideScroll(p);
  for(const selector of ['.signaling-pages h2','.signaling-pages .field-help','.signaling-pages .signaling-facts dt','.signaling-pages button.primary'].filter(Boolean)){const ratio=await contrast(p,selector);if(ratio!==null)assert.ok(ratio>=4.5,`${selector} contrast ${ratio.toFixed(2)} in ${colorScheme}`);}
  const bg=await p.evaluate(()=>getComputedStyle(document.querySelector('.signaling-pages .panel')).backgroundColor);assert.equal(colorScheme==='dark'?/rgb\((\d+)/.exec(bg)[1]<80:/rgb\((\d+)/.exec(bg)[1]>200,true,`panel background ${bg} follows the ${colorScheme} scheme`);
  if(page==='pair'){
   // Keyboard: every choice is reachable; no radio is chosen until the owner chooses one; arrow keys move within a group.
   assert.equal(await p.locator('input[type=radio]:checked').count(),0);
   await p.locator('input[name=with][value=self]').focus();await p.keyboard.press('Space');assert.equal(await p.locator('input[name=with][value=self]').isChecked(),true);
   await p.keyboard.press('ArrowDown');assert.equal(await p.locator('input[name=with][value=principal]').evaluate(e=>e.checked&&document.activeElement===e),true);
  }
  if(['approve','pair-review','service'].includes(page)){
   // The decision control is reachable by Tab and never focused first.
   const order=[];await p.locator('.signaling-pages h2').first().focus();for(let i=0;i<40&&!order.includes('decide');i++){await p.keyboard.press('Tab');order.push(await p.evaluate(()=>document.activeElement?.dataset?.signalingDecide==='true'?'decide':document.activeElement?.tagName));}
   assert.ok(order.includes('decide'),'reachable by Tab: '+order.join(','));
   const box=await p.locator('[data-signaling-decide]').first().boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+0.5,'inside the viewport');
  }
  if(page==='overview'){await p.locator('button',{hasText:t('Revoke every offer','Revocar todas las ofertas')}).click();assert.deepEqual(await p.evaluate(()=>window.intents.at(-1)),{kind:'open-modal',modal:{kind:'signaling-confirm',action:'revoke-offers',input:{all:true}}});}
  assert.deepEqual(errors,[]);
 }finally{await p.close();}
});
