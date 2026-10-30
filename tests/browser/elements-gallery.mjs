// Elements gallery (ui-elements-audit W1): every visual state of the @3sln/bindle elements and the embed islands,
// captured in Chromium and Firefox, light and dark, 390 and 1280 wide, en and es, plus probes that fail on
// regressions: text and control-boundary contrast, focus-ring visibility, double rings, horizontal overflow (page and
// inside island frames), avatar-island clip and alignment, and the fixed island sizes of C1/C2 (embedder-chosen
// frame sizes identical in every account state, constant switcher scroll height).
//
// app.example serves the SDK from this checkout via Playwright routes; the provider is testing.mjs's in-page mock;
// embed.provider.example serves the REAL island runtime (apps/embed boot, shell.css, parts.css) with a fake island
// worker that answers start/render/remove and paints tiles with the real worker/avatar.mjs encoder. This is local
// rendering evidence only: nothing here says anything about the deployed embed origin, leader election or flows.
//
// Run:   npm run test:elements-gallery
// Env:   GALLERY_FILTER=<regexp>  GALLERY_ENGINES=chromium,firefox  GALLERY_OUT=<dir>  GALLERY_CONCURRENCY=4
// Output: artifacts/browser/elements-gallery/ (gitignored): one PNG per scenario × engine, probes.json, index.html.
// A filtered run keeps earlier PNGs, but its index.html and probes.json cover only the scenarios it ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {chromium,firefox} from 'playwright';

const project=resolve(new URL('../..',import.meta.url).pathname);
const out=resolve(process.env.GALLERY_OUT??resolve(project,'artifacts/browser/elements-gallery'));
const APP='https://app.example',EMBED='https://embed.provider.example',ISSUER='https://provider.example';
const filter=process.env.GALLERY_FILTER?new RegExp(process.env.GALLERY_FILTER):null;
const engines=(process.env.GALLERY_ENGINES??'chromium,firefox').split(',').map(s=>s.trim()).filter(Boolean);
const concurrency=Math.max(1,Number.parseInt(process.env.GALLERY_CONCURRENCY??'4',10)||4);

// A pleasant "photo" for granted pictures (SVG served from the issuer origin).
const photoSVG=(hue=210)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 70%)"/><stop offset="1" stop-color="hsl(${hue+40} 60% 40%)"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><circle cx="48" cy="38" r="17" fill="hsl(30 40% 80%)"/><path d="M14 96c4-22 18-32 34-32s30 10 34 32z" fill="hsl(${hue+180} 35% 35%)"/></svg>`;

const appBoot=`import {BindleClient} from '/packages/sdk/src/identity.mjs';
import {createMockProvider,memoryStorage,componentsDeclaration} from '/packages/sdk/src/testing.mjs';
import '/packages/sdk/src/define.mjs';
const S=window.S,ISSUER='${ISSUER}',APP='${APP}';
const accounts=(S.accounts??[{handle:'ada',displayName:'Ada Lovelace'}]).map(a=>({...a,subject:a.subject??ISSUER+'/people/'+a.handle}));
const provider=createMockProvider({issuer:ISSUER,accounts,profile:S.profile!==false,picture:!!S.picture,clients:[{clientId:APP+'/client',redirectUris:[APP+'/callback']}],supportedIntents:S.intents??['login','select-account','reauthenticate','end-session','grant-more','configure'],components:S.islands?componentsDeclaration(ISSUER,{parts:S.parts??['avatar','account-switcher','sign-in','request']}):false,popup:true});
window.provider=provider;window.events=[];window.ISSUER=ISSUER;
// S.restoring: a session store whose read never finishes, so the elements stay in the W11 restoring state.
const restoring={list:()=>new Promise(()=>{}),get:async()=>null,put:async()=>{},replace:async()=>false,remove:async()=>null,clear:async()=>[],lock:(name,signal,fn)=>fn(),subscribe:()=>()=>{},close(){}};
const client=new BindleClient({clientId:APP+'/client',redirectUri:APP+'/callback',storage:memoryStorage(),history:{replaceState(){}},defaultHost:'provider.example',...S.restoring?{sessionStore:restoring}:{},fetcher:async(input,init)=>{const req=new Request(input,init),url=new URL(req.url);
  if(S.manifestDelay&&url.pathname.includes('manifest'))await new Promise(r=>setTimeout(r,S.manifestDelay));
  if(url.origin!==ISSUER)throw new TypeError('Failed to fetch');return provider.fetch(req);}});
if(!S.noDiscover)await client.discoverHost('provider.example');
for(const index of S.signIn??[]){const begun=await client.beginAuthorization({intent:'login',dpop:false});await client.completeLogin(provider.authorize(begun.authorizationUrl,{account:provider.accounts[index]}));}
if(S.popupBlocked)window.open=()=>null;
if(S.popupStub)window.open=()=>({closed:false,close(){},focus(){},location:{replace(){},assign(){},href:''},postMessage(){}});
const slot=document.getElementById('slot');
const session=document.createElement('bindle-session');
session.client=client;
for(const [k,v] of Object.entries(S.session??{}))session.setAttribute(k,v);
session.innerHTML=S.markup;
slot.append(session);
for(const type of ['bindle-session-change','bindle-sign-in-end','bindle-account-change','bindle-menu-toggle','bindle-request-end','bindle-sessions-change','bindle-account-select','bindle-account-reauth'])document.addEventListener(type,e=>window.events.push(type));
if(!S.restoring)await session.ready;
for(const el of document.querySelectorAll('bindle-request')){el.config={INCREMENTAL_AUTH_ENABLED:S.requestFlag!==false};el.request=el.kind==='configure'?{target:{fragment:'https://tasks.example/preferences/v1',fields:['day']}}:{requests:[{fragment:'https://tasks.example/preferences/v1',fields:['day']}]};}
// <bindle-account> loads its view lazily; wait until every one has attached, so no later render replaces focus targets.
const settled=Date.now()+5000;while(!S.skipSettle&&[...document.querySelectorAll('bindle-account')].some(el=>!el.session)&&Date.now()<settled)await new Promise(r=>setTimeout(r,20));
window.ready=true;`;

const fakeWorker=`import {monogramPNG,transparentPNG} from '/apps/embed/src/worker/avatar.mjs';
let scheme='light',views=[],cfg={};
async function photo(size,hue){const c=new OffscreenCanvas(size,size),x=c.getContext('2d');const g=x.createLinearGradient(0,0,size,size);g.addColorStop(0,'hsl('+hue+' 70% 70%)');g.addColorStop(1,'hsl('+(hue+40)+' 60% 40%)');x.fillStyle=g;x.fillRect(0,0,size,size);x.fillStyle='hsl(30 40% 80%)';x.beginPath();x.arc(size/2,size*.4,size*.18,0,7);x.fill();x.fillStyle='hsl('+(hue+180)+' 35% 35%)';x.beginPath();x.ellipse(size/2,size*1.05,size*.38,size*.36,0,0,7);x.fill();return c.convertToBlob({type:'image/png'});}
const emit=()=>postMessage({event:'views',views:views.map(({subject,handle,name})=>({subject,handle,name,delivered:true})),issuedAt:Date.now()});
onmessage=async({data:{id,op,args}})=>{let value=true;try{
 if(op==='start'){scheme=args.scheme;cfg=await (await fetch('/fixture-views')).json();views=cfg.views??[];setTimeout(emit,cfg.delay??0);}
 else if(op==='scheme')scheme=args;
 else if(op==='render')value=await Promise.all(args.subjects.map(s=>{if(!s)return transparentPNG(args.bucket);const v=views.find(v=>v.subject===s);if(v&&v.photo)return photo(args.bucket,v.photo);return args.fallback==='none'?transparentPNG(args.bucket):monogramPNG(s,{size:args.bucket,scheme});}));
 else if(op==='remove'||op==='forget'){views=views.filter(v=>args.subject!==undefined&&v.subject!==args.subject);emit();}
 else if(op==='createEntry')value='e'.repeat(43);else if(op==='proof')value='proof';
}catch(e){if(id!==undefined)postMessage({id,ok:false});return;}if(id!==undefined)postMessage({id,ok:true,value});};`;

const shell=parts=>`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title></title>
<link rel="stylesheet" href="/apps/embed/styles/shell.css"><link rel="stylesheet" href="/apps/embed/styles/parts.css">
<script type="application/json" id="config">${JSON.stringify({v:1,issuer:ISSUER,clientId:APP+'/client',origins:[APP],parts,worker:'/embed/assets/fixture-worker.mjs'})}</script>
<script type="module" src="/island-boot.mjs"></script></head><body><div class="part" id="avatar.v1"></div><div class="part" id="account-switcher.v1"></div><div class="part" id="sign-in.v1"></div><div class="part" id="request.v1"></div></body></html>`;

// Page chrome: a plausible app header with the element slot at the inline end, and some body text.
const appPage=S=>`<!doctype html><html lang="${S.lang??'en'}" dir="${S.dir??'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Notes</title>
<style>
:root{color-scheme:${S.pageScheme??'light dark'}}
body{margin:0;font:15px/1.45 ${S.font??'system-ui,-apple-system,"Segoe UI",sans-serif'};background:${S.pageBg??'Canvas'};color:${S.pageFg??'CanvasText'}}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-block-end:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.brand{font-weight:700;font-size:17px}
main{padding:16px;max-inline-size:720px}
main p{opacity:.65}
.stage{padding:16px;display:flex;flex-wrap:wrap;gap:16px;align-items:center}
${S.css??''}
</style><script>window.S=${JSON.stringify(S)}</script>
<script type="module" src="/app-boot.mjs"></script></head>
<body>${S.layout==='stage'?`<div class="stage" id="slot"></div>`:`<header><span class="brand">Notes</span><div id="slot"></div></header><main><h2>${S.heading??'Shopping list'}</h2><p>Milk, eggs, flour, and a small jar of honey for the weekend.</p><p>Remember to call the bakery about Saturday's order.</p></main>`}</body></html>`;

async function context(browser,S,{width=390,height=600,scheme='light',scale=2,motion=false,forced=false}={}){
  const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:scale,colorScheme:scheme,locale:S.lang??'en',ignoreHTTPSErrors:true,reducedMotion:motion?'no-preference':'reduce',...forced?{forcedColors:'active'}:{}});
  await ctx.route('https://**/*',async route=>{const req=route.request(),url=new URL(req.url());try{
    if(url.origin===APP&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:appPage(S)});
    if(url.origin===APP&&url.pathname==='/app-boot.mjs'){if(S.bootDelay)await new Promise(r=>setTimeout(r,S.bootDelay));return route.fulfill({contentType:'text/javascript',body:appBoot});}
    if(url.origin===ISSUER&&url.pathname.startsWith('/avatars/'))return route.fulfill({contentType:'image/svg+xml',body:photoSVG(S.photoHue??210)});
    if(url.origin===ISSUER&&url.pathname==='/oauth/authorize')return route.fulfill({contentType:'text/html',body:'<h1>Provider</h1>'});
    if(url.origin===EMBED&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:shell(S.parts??['avatar','account-switcher','sign-in','request'])});
    if(url.origin===EMBED&&url.pathname==='/island-boot.mjs'){if(S.islandDelay)await new Promise(r=>setTimeout(r,S.islandDelay));return route.fulfill({contentType:'text/javascript',body:"import '/apps/embed/src/boot.mjs';"});}
    if(url.origin===EMBED&&url.pathname==='/embed/assets/fixture-worker.mjs')return route.fulfill({contentType:'text/javascript',body:fakeWorker});
    if(url.origin===EMBED&&url.pathname==='/fixture-views')return route.fulfill({json:{views:(S.views??[]).map(v=>({...v,subject:v.subject??ISSUER+'/people/'+v.handle.split('@')[0]})),delay:S.viewsDelay??0}});
    if(!['/packages/','/vendor/','/apps/embed/'].some(p=>url.pathname.startsWith(p)))return route.abort();
    const file=resolve(project,'.'+url.pathname);if(!file.startsWith(project+'/'))return route.abort();
    // Slow lazy modules (S.moduleDelay {basename: ms}) expose upgrade-order races such as the lazy account view.
    const delay=S.moduleDelay?.[url.pathname.split('/').pop()];if(delay)await new Promise(r=>setTimeout(r,delay));
    return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:await readFile(file)});
  }catch(error){return route.fulfill({status:500,body:String(error)}).catch(()=>{});}});
  const page=await ctx.newPage();page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(20000);
  return {ctx,page};
}
const waitIdle=(page,ms=350)=>page.waitForTimeout(ms);
const islandFrame=(page,part)=>page.frames().find(f=>f.url().startsWith(EMBED)&&f.url().includes('#'+part));

// ---------------------------------------------------------------------------------------------------------------
// Scenarios. `probes` names the scenario-specific probes (generic overflow and contrast probes run everywhere);
// `group` keys C1/C2 invariants: every scenario in a group must report identical island frame sizes.
const ada={handle:'ada',displayName:'Ada Lovelace'};
const accountsMany=[ada,{handle:'grace',displayName:'Grace Hopper'},{handle:'maxi',displayName:'Maximiliana Alexandra Featherstonehaugh-Wolfeschlegelsteinhausen'},{handle:'fox',displayName:'🦊 Fox ✨'},{handle:'layla',displayName:'ليلى أحمد'}];
const scenarios=[];
const add=(name,S,run,opts={},extra={})=>scenarios.push({name,S,run,opts,...extra});
const sizes=[[390,560,2],[1280,440,1]];
const stage360=inner=>`<div style="max-inline-size:360px;inline-size:100%">${inner}</div>`;
const tab=async(page,n=1)=>{for(let i=0;i<n;i++){await page.keyboard.press('Tab');await page.waitForTimeout(120);}};
// Keyboard-only: Tab until the focused control inside the named island matches the selector.
const tabUntil=async(page,part,selector,max=8,key='Tab')=>{for(let i=0;i<max;i++){await page.keyboard.press(key);await page.waitForTimeout(150);const frame=islandFrame(page,part);if(frame&&await frame.evaluate(sel=>!!document.activeElement?.matches(sel),selector).catch(()=>false))return true;}throw new Error(`keyboard focus never reached ${part} ${selector}`);};
const openMenu=async page=>{await page.getByRole('button',{name:/^(Account|Cuenta): /}).click();await waitIdle(page,400);};

// 1. Signed out compositions (islands off)
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)for(const lang of ['en','es'])
  add(`E01-signed-out-account-slot-${scheme}-${w}-${lang}`,{lang,markup:`<bindle-account><bindle-sign-in slot="signed-out"></bindle-sign-in></bindle-account>`},page=>waitIdle(page,500),{width:w,height:h,scale:s,scheme});
for(const scheme of ['light','dark'])for(const lang of ['en','es'])add(`E02-sign-in-standalone-${scheme}-${lang}`,{lang,layout:'stage',markup:stage360(`<bindle-sign-in><h2 slot="heading" style="margin:0 0 12px">${lang==='es'?'Inicia sesión en Notes':'Sign in to Notes'}</h2></bindle-sign-in>`)},page=>waitIdle(page,500),{width:390,height:440,scheme});
add('E02b-sign-in-identity-required',{layout:'stage',markup:stage360('<bindle-sign-in identity-required></bindle-sign-in>')},page=>waitIdle(page,500),{width:390,height:320});
add('E02c-sign-in-no-default-host',{layout:'stage',markup:stage360('<bindle-sign-in default-host="none"></bindle-sign-in>')},page=>waitIdle(page,500),{width:390,height:320});
add('E02d-sign-in-standalone-1280',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,500),{width:1280,height:360,scale:1});
for(const scheme of ['light','dark'])add(`E03-account-bare-signed-out-${scheme}`,{markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,400),{width:390,height:240,scheme});
// Loading: before the SDK loads (light DOM fallback) and while discovery is slow.
add('E04-preupgrade-fallback',{bootDelay:4000,markup:''},null,{width:390,height:300});
add('E04b-discovery-pending',{layout:'stage',noDiscover:true,manifestDelay:20000,markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,800),{width:390,height:320});
// Errors and flow notices.
for(const scheme of ['light','dark'])add(`E05-invalid-handle-${scheme}`,{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').fill('ada @@ bad');await page.getByRole('button',{name:'Continue',exact:true}).click();await waitIdle(page);},{width:390,height:380,scheme});
add('E05b-unknown-provider',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').fill('ada@nowhere.example');await page.getByRole('button',{name:'Continue',exact:true}).click();await waitIdle(page,1500);},{width:390,height:400});
for(const scheme of ['light','dark'])add(`E05c-popup-blocked-prompt-${scheme}`,{layout:'stage',popupBlocked:true,session:{'popup-fallback':'prompt',presentation:'popup'},markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByRole('button',{name:/Continue with/}).click();await waitIdle(page,1200);},{width:390,height:480,scheme});
for(const scheme of ['light','dark'])add(`E05d-popup-waiting-${scheme}`,{layout:'stage',popupStub:true,session:{presentation:'popup'},markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByRole('button',{name:/Continue with/}).click();await waitIdle(page,2600);},{width:390,height:480,scheme});
add('E05e-popup-waiting-account',{popupStub:true,session:{presentation:'popup'},markup:'<bindle-account signed-out="button"></bindle-account>'},async page=>{await page.getByRole('button',{name:'Sign in'}).click();await waitIdle(page,2600);},{width:390,height:420});

// 2. Signed-in triggers
const triggers=[['initials',{accounts:[ada]}],['picture',{accounts:[ada],picture:true}],['no-profile',{accounts:[ada],profile:false}],['long-name',{accounts:[accountsMany[2]]}],['emoji-name',{accounts:[accountsMany[3]]}],['rtl-name',{accounts:[accountsMany[4]]}]];
for(const [label,base] of triggers)for(const scheme of ['light','dark'])add(`E06-signed-in-${label}-${scheme}`,{...base,signIn:[0],markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,600),{width:390,height:220,scheme});
add('E06b-signed-in-avatar-only',{accounts:[ada],picture:true,signIn:[0],markup:'<bindle-account trigger="avatar"></bindle-account>'},page=>waitIdle(page,600),{width:390,height:220});
add('E06c-signed-in-long-name-1280',{accounts:[accountsMany[2]],signIn:[0],markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,600),{width:1280,height:220,scale:1});
add('E06d-signed-in-initials-es',{lang:'es',accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,600),{width:390,height:220});
// 3. Menu open
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)for(const lang of ['en','es'])add(`E07-menu-default-${scheme}-${w}-${lang}`,{lang,accounts:[ada],signIn:[0],markup:`<bindle-account><a slot="menu-start" href="#settings">${lang==='es'?'Ajustes':'Settings'}</a></bindle-account>`},openMenu,{width:w,height:h,scale:s,scheme});
for(const scheme of ['light','dark'])add(`E07b-menu-all-actions-${scheme}`,{accounts:[ada],picture:true,signIn:[0],markup:'<bindle-account actions="switch provider reauth sign-out provider-sign-out manage"><a slot="menu-start" href="#settings">Settings</a><a slot="menu-end" href="#help">Help</a></bindle-account>'},openMenu,{width:390,height:640,scheme});
add('E07c-menu-all-actions-es-dark',{lang:'es',accounts:[ada],signIn:[0],markup:'<bindle-account actions="switch provider reauth sign-out provider-sign-out manage"></bindle-account>'},openMenu,{width:390,height:640,scheme:'dark'});
add('E07d-menu-multi-held-sessions',{accounts:accountsMany.slice(0,3),signIn:[0,1,2],markup:'<bindle-account actions="switch sign-out manage"></bindle-account>'},openMenu,{width:390,height:520});
add('E08-menu-handle-form',{accounts:[ada],signIn:[0],markup:'<bindle-account actions="switch provider sign-out"></bindle-account>'},async page=>{await openMenu(page);await page.getByRole('button',{name:'Use a different provider'}).click();await waitIdle(page);await page.getByRole('button',{name:'Continue',exact:true}).click();await waitIdle(page);},{width:390,height:520});
// 4. Focus / hover / keyboard
for(const scheme of ['light','dark'])add(`E09-trigger-focus-${scheme}`,{accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},page=>tab(page,1).then(()=>waitIdle(page)),{width:390,height:200,scheme},{probes:['focus']});
add('E09b-trigger-hover',{accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},async page=>{await page.getByRole('button',{name:/^Account: /}).hover();await waitIdle(page);},{width:390,height:200});
for(const scheme of ['light','dark'])add(`E09c-menu-keyboard-${scheme}`,{accounts:[ada],signIn:[0],markup:'<bindle-account actions="switch reauth sign-out manage"></bindle-account>'},async page=>{await page.getByRole('button',{name:/^Account: /}).focus();await page.keyboard.press('ArrowDown');await waitIdle(page);await tab(page,1);await waitIdle(page);},{width:390,height:460,scheme},{probes:['focus']});
for(const scheme of ['light','dark'])add(`E09d-menu-item-hover-${scheme}`,{accounts:[ada],signIn:[0],markup:'<bindle-account actions="switch reauth sign-out manage"></bindle-account>'},async page=>{await openMenu(page);await page.getByRole('button',{name:'Sign out of this app'}).hover();await waitIdle(page);},{width:390,height:460,scheme});
for(const scheme of ['light','dark'])add(`E09e-sign-in-focus-${scheme}`,{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').focus();await page.keyboard.type('ada');await waitIdle(page);},{width:390,height:360,scheme},{probes:['focus','single-ring']});
for(const scheme of ['light','dark'])add(`E09g-sign-in-button-focus-${scheme}`,{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>tab(page,1).then(()=>waitIdle(page)),{width:390,height:360,scheme},{probes:['focus']});
add('E09f-sign-in-pressed',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{const b=page.getByRole('button',{name:/Continue with/});await b.hover();await page.mouse.down();await waitIdle(page);},{width:390,height:360});
// 5. Avatar and monogram
for(const scheme of ['light','dark'])add(`E10-avatars-${scheme}`,{layout:'stage',accounts:[ada],signIn:[0],markup:[24,32,40,48,64,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')+'<span style="flex-basis:100%"></span>'+[24,32,40,48,64,96].map(s=>`<bindle-monogram subject="https://provider.example/people/ada" style="--bindle-monogram-size:${s}px"></bindle-monogram>`).join('')},page=>waitIdle(page,600),{width:390,height:260,scheme});
add('E10b-avatars-picture',{layout:'stage',accounts:[ada],picture:true,signIn:[0],markup:[24,32,40,48,64,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')},page=>waitIdle(page,800),{width:390,height:200});
add('E10c-avatar-signed-out',{layout:'stage',markup:'<span>Avatar signed out:</span><bindle-avatar size="48" style="outline:1px dashed red"></bindle-avatar>'},page=>waitIdle(page,400),{width:390,height:140});
// 6. Request element (islands off)
for(const scheme of ['light','dark'])add(`E11-request-${scheme}`,{layout:'stage',accounts:[ada],signIn:[0],markup:'<div style="inline-size:100%"><p style="margin:0 0 8px">Share your calendar to see free slots.</p><bindle-request></bindle-request></div><div style="inline-size:100%"><bindle-request kind="configure"></bindle-request></div><div style="inline-size:100%"><bindle-request disabled></bindle-request></div>'},page=>waitIdle(page,800),{width:390,height:320,scheme});
add('E11b-request-signed-out',{layout:'stage',markup:'<div style="inline-size:100%"><bindle-request></bindle-request></div>'},page=>waitIdle(page,600),{width:390,height:160});
// 7. Embedder theming
add('E12-theming-tokens',{layout:'stage',accounts:[ada],signIn:[0],css:'.brandy{--bindle-accent:#0f766e;--bindle-on-accent:#fff;--bindle-radius:2;--bindle-surface:#f0fdfa;--bindle-border:#0f766e;font-family:Georgia,serif}.round{--bindle-radius:22;--bindle-accent:#7c3aed}',markup:'<div class="brandy" style="inline-size:100%"><bindle-account></bindle-account></div><div class="round" style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},page=>waitIdle(page,600),{width:390,height:460});
add('E12b-dark-embedder-page-theme-dark',{layout:'stage',pageScheme:'dark',pageBg:'#0b1220',pageFg:'#e5e7eb',markup:'<div style="inline-size:100%"><bindle-sign-in theme="dark"></bindle-sign-in></div>'},page=>waitIdle(page,600),{width:390,height:360});
// G17b (W9, not yet fixed): an embedder color-scheme:dark without theme keeps the light element palette (it still
// meets the contrast probes; the evidence is visual).
add('E12d-dark-embedder-page-light-os',{layout:'stage',pageScheme:'dark',pageBg:'#0b1220',pageFg:'#e5e7eb',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},page=>waitIdle(page,600),{width:390,height:360});
add('E12c-serif-page-font',{layout:'stage',font:'Georgia,serif',accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account><bindle-sign-in style="inline-size:100%"></bindle-sign-in>'},page=>waitIdle(page,600),{width:390,height:400});
// The lazy <bindle-account> view must never replace a control the user already focused (focus loss seen in Firefox):
// focus the pre-upgrade "Sign in" button and the slotted sign-in field before the view has loaded.
add('E14-early-focus-account-button',{skipSettle:true,moduleDelay:{'account-view.mjs':1200},markup:'<bindle-account></bindle-account>'},async page=>{await page.locator('bindle-account').evaluate(el=>el.shadowRoot.querySelector('button').focus());await waitIdle(page,2000);},{width:390,height:240},{probes:['focus']});
add('E14b-early-focus-slotted-field',{skipSettle:true,moduleDelay:{'account-view.mjs':1200},markup:'<bindle-account signed-out="button"><bindle-sign-in slot="signed-out"></bindle-sign-in></bindle-account>'},async page=>{await page.locator('bindle-sign-in input').focus();await page.keyboard.type('ada');await waitIdle(page,2000);},{width:390,height:420},{probes:['focus']});
add('E14c-early-focus-signed-in',{skipSettle:true,moduleDelay:{'account-view.mjs':1200},accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},async page=>{await page.locator('bindle-account').evaluate(el=>el.shadowRoot.querySelector('button').focus());await waitIdle(page,2000);},{width:390,height:240},{probes:['focus']});

// 9. Header patterns (W4): signed-out="panel" (G1), held accounts as rows (G4) with per-row sign-out (G5), sign-out
// cause notices (G6) and flow notices in a bubble (G9), busy trigger (G16), reserved avatar box (V33).
const header=(extra='')=>`<bindle-account signed-out="panel"${extra}></bindle-account>`;
const openSignIn=async page=>{await page.getByRole('button',{name:/^(Sign in|Iniciar sesión)$/}).click();await waitIdle(page,600);};
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)add(`E15-header-panel-closed-${scheme}-${w}`,{markup:header()},page=>waitIdle(page,500),{width:w,height:Math.min(h,240),scale:s,scheme});
for(const scheme of ['light','dark'])for(const lang of ['en','es'])add(`E15b-header-panel-open-${scheme}-${lang}`,{lang,markup:header()},openSignIn,{width:390,height:560,scheme});
add('E15b-header-panel-open-1280',{markup:header()},openSignIn,{width:1280,height:560,scale:1});
add('E15c-header-panel-keyboard',{markup:header()},async page=>{await tab(page,1);await page.keyboard.press('Enter');await waitIdle(page,600);},{width:390,height:560},{probes:['focus']});
add('E15d-header-panel-slotted-sign-in',{markup:'<bindle-account signed-out="panel"><bindle-sign-in slot="signed-out"><h2 slot="heading" style="margin:0 0 8px;font-size:16px">Welcome back</h2></bindle-sign-in></bindle-account>'},openSignIn,{width:390,height:600});
add('E15e-header-panel-waiting',{popupStub:true,session:{presentation:'popup'},markup:header()},async page=>{await openSignIn(page);await page.locator('bindle-account').getByRole('button',{name:/Continue with/}).click();await waitIdle(page,2600);},{width:390,height:600});
const many3={accounts:accountsMany.slice(0,3),signIn:[0,1,2]};
for(const scheme of ['light','dark'])add(`E16-menu-accounts-${scheme}`,{...many3,markup:'<bindle-account actions="accounts switch sign-out manage"><a slot="menu-start" href="#settings">Settings</a></bindle-account>'},openMenu,{width:390,height:640,scheme});
add('E16b-menu-accounts-es',{...many3,lang:'es',markup:'<bindle-account></bindle-account>'},openMenu,{width:390,height:640});
add('E16c-menu-accounts-row-focus',{...many3,markup:'<bindle-account></bindle-account>'},async page=>{await page.getByRole('button',{name:/^Account: /}).focus();await page.keyboard.press('ArrowDown');await waitIdle(page,400);for(let i=0;i<6;i++){if(await page.evaluate(()=>document.querySelector('bindle-account').shadowRoot.activeElement?.matches('.row-out')))break;await tab(page,1);}await waitIdle(page,300);},{width:390,height:640},{probes:['focus']});
add('E16d-menu-accounts-after-row-sign-out',{...many3,markup:'<bindle-account></bindle-account>'},async page=>{await openMenu(page);await page.getByRole('button',{name:/^Sign out of Grace/}).click();await waitIdle(page,500);const active=await page.evaluate(()=>document.querySelector('bindle-account').shadowRoot.activeElement?.closest('.account-row')?.dataset.subject??document.querySelector('bindle-account').shadowRoot.activeElement?.className);if(!/people\/(ada|maxi)/.test(String(active)))throw new Error('focus did not move to the next row: '+active);},{width:390,height:640});
add('E16e-accounts-after-select',{...many3,markup:'<bindle-account></bindle-account>'},async page=>{await openMenu(page);await page.getByRole('button',{name:/^Switch to Ada/}).click();await waitIdle(page,500);},{width:390,height:220});
const endBy=cause=>async page=>{await page.evaluate(async cause=>{const s=document.querySelector('bindle-session');if(cause==='revoked'){const c=s.client.session;await window.provider.fetch(new Request(window.ISSUER+'/oauth/revoke',{method:'POST',body:new URLSearchParams({token:c.refresh_token})}));await s.client.refresh().catch(()=>{});}else s.forgetSession({subject:s.session.subject,cause});},cause);await waitIdle(page,700);};
for(const scheme of ['light','dark'])add(`E17-notice-revoked-${scheme}`,{accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},endBy('revoked'),{width:390,height:260,scheme});
add('E17b-notice-removed-panel-mode',{accounts:[ada],signIn:[0],markup:header()},endBy('removed'),{width:390,height:260});
add('E17c-notice-revoked-next-account',{...many3,markup:'<bindle-account></bindle-account>'},endBy('revoked'),{width:390,height:260});
add('E17d-notice-removed-es',{lang:'es',accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'},endBy('removed'),{width:390,height:260});
add('E18-trigger-busy-switching',{accounts:[ada],signIn:[0],popupStub:true,session:{presentation:'popup'},markup:'<bindle-account></bindle-account>'},async page=>{await openMenu(page);await page.getByRole('button',{name:'Use another account'}).click();await waitIdle(page,2600);},{width:390,height:420});
add('E18b-header-button-waiting',{popupStub:true,session:{presentation:'popup'},markup:'<bindle-account signed-out="button"></bindle-account>'},async page=>{await page.getByRole('button',{name:'Sign in'}).click();await waitIdle(page,2600);},{width:1280,height:300,scale:1});
add('E10d-avatar-signed-out-reserved',{layout:'stage',markup:'<span>Empty:</span><bindle-avatar size="40" style="outline:1px dashed #c33"></bindle-avatar><span>Glyph:</span><bindle-avatar size="40" signed-out="glyph"></bindle-avatar><bindle-avatar size="64" signed-out="glyph"></bindle-avatar>'},page=>waitIdle(page,400),{width:390,height:160});
add('E10e-avatar-signed-out-glyph-dark',{layout:'stage',markup:'<bindle-avatar size="40" signed-out="glyph"></bindle-avatar><bindle-avatar size="64" signed-out="glyph"></bindle-avatar>'},page=>waitIdle(page,400),{width:390,height:140,scheme:'dark'});
// 10. Gate (W7, G2) and the signed-in sign-in summary (G2b).
const gate=`<bindle-gate><main style="padding:16px"><h2 style="margin:0 0 8px">Your notes</h2><p>Milk, eggs, flour.</p></main></bindle-gate>`;
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)add(`E19-gate-signed-out-${scheme}-${w}`,{layout:'stage',markup:`<div style="inline-size:100%">${gate}</div>`},page=>waitIdle(page,600),{width:w,height:520,scale:s,scheme});
add('E19b-gate-signed-in',{layout:'stage',accounts:[ada],signIn:[0],markup:`<bindle-account></bindle-account><div style="inline-size:100%">${gate}</div>`},page=>waitIdle(page,600),{width:390,height:320});
// W11 restoring: persisted sessions are being read; every element shows a loading state, never signed-out content.
for(const scheme of ['light','dark'])add(`E19f-restoring-sign-in-${scheme}`,{layout:'stage',restoring:true,skipSettle:true,markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await waitIdle(page,600);const text=await page.locator('bindle-sign-in').evaluate(el=>el.shadowRoot.textContent);if(!/Restoring your session/.test(text)||/Your handle/.test(text))throw new Error('sign-in is not in its restoring state: '+text);},{width:390,height:200,scheme});
add('E19g-restoring-header-and-gate',{restoring:true,skipSettle:true,markup:`<bindle-account signed-out="panel"></bindle-account>`,heading:'Restoring'},async page=>{await waitIdle(page,600);const busy=await page.locator('bindle-account').evaluate(el=>el.shadowRoot.querySelector('[aria-busy]')?.getAttribute('aria-busy'));if(busy!=='true')throw new Error('header control is not busy while restoring: '+busy);},{width:390,height:220});
add('E19h-restoring-gate',{layout:'stage',restoring:true,skipSettle:true,markup:`<div style="inline-size:100%">${gate}</div>`},async page=>{await waitIdle(page,600);const state=await page.locator('bindle-gate').getAttribute('state');if(state!=='loading')throw new Error('gate is not loading while restoring: '+state);},{width:390,height:220});
add('E19c-gate-loading',{layout:'stage',skipSettle:true,moduleDelay:{'flows.mjs':4000},markup:`<div style="inline-size:100%">${gate}</div>`},page=>waitIdle(page,300),{width:390,height:220});
add('E19d-gate-custom-slots-es',{lang:'es',layout:'stage',markup:'<div style="inline-size:100%"><bindle-gate><h2 slot="heading" style="margin:0 0 4px">Entra en Notas</h2><p slot="lead" style="margin:0 0 16px">Tus notas te esperan.</p><main>Contenido</main></bindle-gate></div>'},page=>waitIdle(page,600),{width:390,height:520});
add('E19e-gate-sign-in-focus-moves',{layout:'stage',popupStub:false,markup:`<div style="inline-size:100%">${gate}</div>`},async page=>{const input=page.locator('bindle-gate').getByLabel('Your handle');await input.focus();await page.evaluate(async()=>{const s=document.querySelector('bindle-session'),c=s.client,p=window.provider;const begun=await c.beginAuthorization({intent:'login',dpop:false});await c.completeLogin(p.authorize(begun.authorizationUrl,{account:p.accounts[0]}));s.controller.refresh();});await waitIdle(page,600);const where=await page.evaluate(()=>{const g=document.querySelector('bindle-gate');return document.activeElement===g&&g.shadowRoot.activeElement?.classList.contains('content')||`${document.activeElement?.tagName} ${g.shadowRoot.activeElement?.tagName} ${g.getAttribute('state')}`;});if(where!==true)throw new Error('focus did not move to the gate content: '+where);},{width:390,height:320});
for(const scheme of ['light','dark'])add(`E13b-sign-in-accounts-one-${scheme}`,{layout:'stage',accounts:[ada],picture:true,signIn:[0],markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,700),{width:390,height:240,scheme});
add('E13c-sign-in-accounts-es-no-profile',{lang:'es',layout:'stage',accounts:[ada],profile:false,signIn:[0],markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,700),{width:390,height:240});
add('E13d-sign-in-signed-in-hide',{layout:'stage',accounts:[ada],signIn:[0],markup:'<span>Hidden:</span>'+stage360('<bindle-sign-in signed-in="hide" style="outline:1px dashed #c33"></bindle-sign-in>')},page=>waitIdle(page,600),{width:390,height:160});
add('E13-sign-in-while-signed-in',{layout:'stage',accounts:[ada],signIn:[0],markup:'<bindle-account></bindle-account>'+stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,600),{width:390,height:420});

// 8. Islands live (real shell, fake worker)
const ISL={islands:true};
add('I07-header-panel-island',{...ISL,markup:header()},async page=>{await waitIdle(page,800);await openSignIn(page);await waitIdle(page,1400);},{width:390,height:420},{probes:['frames']});

// 12. Default trigger (owner direction 2026-10-29): signed in, the avatar alone (label opt-in); signed out, a
// placeholder avatar of the same size with an attention bead, a tooltip prompt and the sign-in panel.
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)add(`E21-trigger-signed-out-avatar-${scheme}-${w}`,{markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,500),{width:w,height:200,scale:s,scheme});
for(const scheme of ['light','dark'])add(`E21b-trigger-signed-out-tooltip-hover-${scheme}`,{markup:'<bindle-account></bindle-account>'},async page=>{await page.getByRole('button',{name:'Sign in'}).hover();await waitIdle(page,500);},{width:390,height:220,scheme});
add('E21c-trigger-signed-out-tooltip-focus-es',{lang:'es',markup:'<bindle-account></bindle-account>'},async page=>{await tab(page,1);await waitIdle(page,400);},{width:390,height:220},{probes:['focus']});
add('E21d-trigger-signed-out-custom-prompt',{markup:'<bindle-account sign-in-prompt="Sign in to sync your notes"></bindle-account>'},async page=>{await page.getByRole('button',{name:'Sign in'}).hover();await waitIdle(page,500);},{width:390,height:220});
for(const scheme of ['light','dark'])add(`E21e-trigger-signed-out-panel-${scheme}`,{markup:'<bindle-account sign-in-prompt="Sign in to sync your notes"></bindle-account>'},async page=>{await page.getByRole('button',{name:'Sign in'}).click();await waitIdle(page,600);},{width:390,height:600,scheme});
add('E21f-trigger-signed-out-panel-1280-es',{lang:'es',markup:'<bindle-account></bindle-account>'},async page=>{await page.getByRole('button',{name:'Iniciar sesión'}).click();await waitIdle(page,600);},{width:1280,height:600,scale:1});
add('E21g-trigger-sizes-signed-out-vs-in',{layout:'stage',accounts:[ada],signIn:[0],markup:'<span>In:</span><bindle-account></bindle-account>'},async page=>{await page.evaluate(()=>{const s=document.createElement('bindle-session');s.setAttribute('client-id','https://app.example/client');s.setAttribute('redirect-uri','https://app.example/callback');s.setAttribute('default-host','provider.example');s.innerHTML='<span>Out:</span><bindle-account></bindle-account>';document.getElementById('slot').append(s);});await waitIdle(page,900);const sizes=await page.evaluate(()=>[...document.querySelectorAll('bindle-account')].map(el=>{const r=el.shadowRoot.querySelector('.trigger').getBoundingClientRect();return [r.width,r.height];}));if(JSON.stringify(sizes[0])!==JSON.stringify(sizes[1]))throw new Error('trigger size differs between states: '+JSON.stringify(sizes));},{width:390,height:200});
for(const scheme of ['light','dark'])add(`E06e-trigger-variants-${scheme}`,{layout:'stage',accounts:[accountsMany[0]],picture:true,signIn:[0],markup:'<bindle-account></bindle-account><bindle-account trigger="avatar-label"></bindle-account><bindle-account trigger="auto"></bindle-account>'},page=>waitIdle(page,700),{width:1280,height:160,scale:1,scheme});
// 13. Organization context (owner direction 2026-10-29; synthetic entities, the entity API is not implemented):
// person + entity in the single avatar's fixed box; entity prominent by default, person prominent on request; RTL.
const acme={subject:'https://provider.example/orgs/acme',name:'Acme Robotics'},acmePic={...acme,picture:'https://provider.example/avatars/acme'};
const withEntity=entity=>async page=>{await page.evaluate(entity=>{for(const el of document.querySelectorAll('bindle-avatar,bindle-account'))el.entity=entity;},entity);await waitIdle(page,600);};
for(const scheme of ['light','dark'])add(`E22-composed-avatars-${scheme}`,{layout:'stage',accounts:[ada],signIn:[0],markup:[24,32,40,48,64,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')+'<span style="flex-basis:100%"></span>'+[24,32,40,48,64,96].map(s=>`<bindle-avatar size="${s}" prominent="person"></bindle-avatar>`).join('')},withEntity(acme),{width:390,height:260,scheme});
add('E22b-composed-avatars-pictures',{layout:'stage',accounts:[ada],picture:true,signIn:[0],photoHue:20,markup:[24,32,40,64,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')},withEntity(acmePic),{width:390,height:200});
add('E22c-composed-avatars-rtl',{layout:'stage',dir:'rtl',accounts:[accountsMany[4]],signIn:[0],markup:[32,48,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')},withEntity({subject:'https://provider.example/orgs/nour',name:'مؤسسة النور'}),{width:390,height:200});
for(const scheme of ['light','dark'])add(`E22d-trigger-entity-${scheme}`,{accounts:[ada],signIn:[0],markup:'<bindle-account trigger="avatar-label"></bindle-account>'},async page=>{await withEntity(acme)(page);await page.getByRole('button',{name:/Acme Robotics — signed in as Ada/}).click();await waitIdle(page,500);},{width:390,height:560,scheme});
add('E22e-trigger-entity-person-prominent',{accounts:[ada],picture:true,signIn:[0],markup:'<bindle-account prominent="person"></bindle-account>'},withEntity(acmePic),{width:390,height:200});
// 11. The sign-in form component (owner direction 2026-10-29): suffix affixed after the typed text until "@", paste,
// RTL page, invalid, busy (submit and create account), several held accounts as the main UI, "Add account".
add('E20-sign-in-typing-other-provider',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{const input=page.getByLabel('Your handle');await input.focus();await page.keyboard.type('ada@other.exa',{delay:30});await waitIdle(page);const suffix=await page.locator('bindle-sign-in').evaluate(el=>!!el.shadowRoot.querySelector('#suffix'));if(suffix)throw new Error('suffix still visible after @');},{width:390,height:400},{probes:['focus','single-ring']});
add('E20b-sign-in-typing-name',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').focus();await page.keyboard.type('ada.lovelace',{delay:20});await waitIdle(page);},{width:390,height:400},{probes:['focus']});
add('E20c-sign-in-paste-full-handle',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').fill('grace@3sln.example');await waitIdle(page);},{width:390,height:400});
add('E20d-sign-in-rtl-page',{layout:'stage',dir:'rtl',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').focus();await page.keyboard.type('ada',{delay:20});await waitIdle(page);},{width:390,height:400},{probes:['focus']});
for(const scheme of ['light','dark'])add(`E20e-sign-in-create-busy-${scheme}`,{layout:'stage',popupStub:true,session:{presentation:'popup'},markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByRole('button',{name:/^Create a /}).click();await waitIdle(page,600);},{width:390,height:520,scheme});
add('E20f-sign-in-submit-busy',{layout:'stage',popupStub:true,session:{presentation:'popup'},markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').fill('ada');await page.getByRole('button',{name:'Continue',exact:true}).click();await waitIdle(page,600);},{width:390,height:520});
add('E20g-sign-in-1280-es',{lang:'es',layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Tu identificador').focus();await page.keyboard.type('ada',{delay:20});await waitIdle(page);},{width:1280,height:440,scale:1});
for(const scheme of ['light','dark'])add(`E13e-sign-in-accounts-several-${scheme}`,{layout:'stage',...many3,picture:true,markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,700),{width:390,height:420,scheme});
add('E13e-sign-in-accounts-several-es-1280',{lang:'es',layout:'stage',...many3,markup:stage360('<bindle-sign-in></bindle-sign-in>')},page=>waitIdle(page,700),{width:1280,height:420,scale:1});
add('E13f-sign-in-add-account',{layout:'stage',...many3,markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByRole('button',{name:'Add account'}).click();await waitIdle(page,300);await page.keyboard.type('alan',{delay:20});await waitIdle(page);},{width:390,height:560},{probes:['focus']});
add('E13g-sign-in-accounts-keyboard',{layout:'stage',...many3,markup:'<button>Before</button>'+stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await tab(page,2);await waitIdle(page,300);},{width:390,height:420},{probes:['focus']});
add('I08-sign-in-island-with-create',{...ISL,layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},page=>waitIdle(page,1800),{width:390,height:320},{probes:['frames']});
for(const scheme of ['light','dark'])for(const [w,h,s] of sizes)for(const lang of ['en','es'])
  add(`I01-signed-out-sign-in-island-${scheme}-${w}-${lang}`,{...ISL,lang,markup:'<bindle-account><bindle-sign-in slot="signed-out"></bindle-sign-in></bindle-account>'},page=>waitIdle(page,1600),{width:w,height:h,scale:s,scheme},{probes:['frames']});
for(const scheme of ['light','dark'])add(`I01b-sign-in-island-standalone-variants-${scheme}`,{...ISL,layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div><div style="inline-size:100%"><bindle-sign-in island-variant="outline" island-label="sign-in"></bindle-sign-in></div><div style="inline-size:100%"><bindle-sign-in island-label="sign-up"></bindle-sign-in></div>'},page=>waitIdle(page,1800),{width:390,height:560,scheme},{probes:['frames']});
add('I01c-sign-in-island-armed-hover',{...ISL,layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},async page=>{await waitIdle(page,1200);await page.frameLocator('bindle-sign-in iframe').locator('button').hover();await waitIdle(page,900);},{width:390,height:320},{probes:['frames'],group:'signin-stage-light'});
for(const scheme of ['light','dark'])add(`I01d-sign-in-island-keyboard-focus-${scheme}`,{...ISL,layout:'stage',markup:'<button>Before</button><div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},async page=>{await waitIdle(page,1200);await tabUntil(page,'sign-in','button');await waitIdle(page,400);},{width:390,height:320,scheme},{probes:['focus','frames'],group:`signin-stage-${scheme}`});
for(const scheme of ['light','dark'])add(`I01g-sign-in-island-outline-focus-${scheme}`,{...ISL,layout:'stage',markup:'<button>Before</button><div style="inline-size:100%"><bindle-sign-in island-variant="outline"></bindle-sign-in></div>'},async page=>{await waitIdle(page,1200);await tabUntil(page,'sign-in','button');await waitIdle(page,400);},{width:390,height:320,scheme},{probes:['focus','frames'],group:`signin-stage-${scheme}`});
add('I01e-island-skeleton',{...ISL,islandDelay:30000,layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},page=>waitIdle(page,1500),{width:390,height:320});
add('I01f-island-pending-flow',{...ISL,layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div>'},async page=>{await waitIdle(page,1200);await tab(page,1);await page.keyboard.press('Enter');await waitIdle(page,800);},{width:390,height:420},{probes:['frames'],group:'signin-stage-light'});
const signedInIsl=(extra={})=>({...ISL,accounts:accountsMany,signIn:[0],views:[{handle:'ada@provider.example',name:'Ada Lovelace',photo:200}],...extra});
for(const scheme of ['light','dark'])add(`I02-avatar-island-${scheme}`,{...signedInIsl(),markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,1800),{width:390,height:220,scheme},{probes:['avatar-island']});
add('I02-avatar-island-1280',{...signedInIsl(),markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,1800),{width:1280,height:220,scale:1},{probes:['avatar-island']});
add('I02b-avatar-island-no-binding',{...signedInIsl({views:[]}),markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,1800),{width:390,height:220},{probes:['avatar-island']});
add('I02c-avatar-island-sizes',{...signedInIsl(),layout:'stage',markup:[24,40,64,96].map(s=>`<bindle-avatar size="${s}"></bindle-avatar>`).join('')},page=>waitIdle(page,2000),{width:390,height:200},{probes:['avatar-island']});
add('I02d-avatar-island-avatar-only',{...signedInIsl(),markup:'<bindle-account trigger="avatar"></bindle-account>'},page=>waitIdle(page,1800),{width:390,height:220},{probes:['avatar-island']});
const views8=[{handle:'ada@provider.example',name:'Ada Lovelace',photo:200},{handle:'grace@provider.example',name:'Grace Hopper'},{handle:'maxi@provider.example',name:'Maximiliana Alexandra Featherstonehaugh-Wolfeschlegelsteinhausen'},{handle:'fox@provider.example',name:'🦊 Fox ✨',photo:20},{handle:'layla@provider.example',name:'ليلى أحمد'},{handle:'alan@provider.example',name:'Alan Turing'},{handle:'edsger@provider.example',name:'Edsger Dijkstra'},{handle:'barbara@provider.example',name:'Barbara Liskov'},{handle:'donald@provider.example',name:'Donald Knuth'},{handle:'ken@provider.example',name:'Ken Thompson'}];
const openIsl=async page=>{await waitIdle(page,1200);const trigger=page.getByRole('button',{name:/^(Account|Cuenta): /});await trigger.hover();await waitIdle(page,900);await trigger.click();await waitIdle(page,1500);};
const swProbes=['switcher-fit','frames','avatar-island'];
for(const [label,views] of [['none',[]],['one',views8.slice(0,1)],['three',views8.slice(0,3)],['many',views8]])for(const scheme of ['light','dark'])
  add(`I03-switcher-${label}-${scheme}`,{...signedInIsl({views}),markup:'<bindle-account actions="switch sign-out manage"><a slot="menu-start" href="#settings">Settings</a></bindle-account>'},openIsl,{width:390,height:640,scheme},{probes:swProbes,group:'switcher-390-regular'});
for(const scheme of ['light','dark'])add(`I03b-switcher-1280-${scheme}`,{...signedInIsl({views:views8.slice(0,4)}),markup:'<bindle-account actions="switch reauth sign-out provider-sign-out manage"></bindle-account>'},openIsl,{width:1280,height:640,scale:1,scheme},{probes:swProbes,group:'switcher-1280-regular'});
for(const scheme of ['light','dark'])add(`I03c-switcher-compact-es-${scheme}`,{...signedInIsl({views:views8.slice(0,4)}),lang:'es',markup:'<bindle-account density="compact"></bindle-account>'},openIsl,{width:390,height:560,scheme},{probes:swProbes,group:'switcher-390-compact'});
add('I03c-switcher-compact-en',{...signedInIsl({views:views8.slice(0,1)}),markup:'<bindle-account density="compact"></bindle-account>'},openIsl,{width:390,height:560},{probes:swProbes,group:'switcher-390-compact'});
add('I03d-switcher-no-binding',{...signedInIsl({views:[]}),markup:'<bindle-account></bindle-account>'},openIsl,{width:390,height:560},{probes:swProbes,group:'switcher-390-regular'});
add('I03e-switcher-remove-confirm',{...signedInIsl({views:views8.slice(0,3)}),markup:'<bindle-account></bindle-account>'},async page=>{await openIsl(page);await page.frameLocator('bindle-account iframe[src*="account-switcher"]').getByRole('button',{name:'Remove from this site'}).focus();await page.keyboard.press('Enter');await waitIdle(page,500);},{width:390,height:560},{probes:swProbes,group:'switcher-390-regular'});
for(const scheme of ['light','dark'])add(`I03f-switcher-keyboard-${scheme}`,{...signedInIsl({views:views8.slice(0,4)}),markup:'<bindle-account></bindle-account>'},async page=>{await waitIdle(page,1200);await tab(page,1);await waitIdle(page,600);await page.keyboard.press('ArrowDown');await waitIdle(page,1500);await tabUntil(page,'account-switcher','.list .row',8,'Shift+Tab');await page.keyboard.press('ArrowDown');await waitIdle(page,400);},{width:390,height:560,scheme},{probes:['focus',...swProbes],group:'switcher-390-regular'});
for(const scheme of ['light','dark'])add(`I03h-switcher-action-focus-${scheme}`,{...signedInIsl({views:views8.slice(0,4)}),markup:'<bindle-account></bindle-account>'},async page=>{await openIsl(page);await page.frameLocator('bindle-account iframe[src*="account-switcher"]').getByRole('button',{name:'Remove from this site'}).focus();await waitIdle(page,300);},{width:390,height:560,scheme},{probes:['focus',...swProbes],group:'switcher-390-regular'});
// Motion on (§4.5): the panel finishes its open transition fully opaque, and the switcher island still arms for
// pointer input after the 400 ms dwell (C4) although it faded in inside the panel.
add('I03m-switcher-motion-armed',{...signedInIsl({views:views8.slice(0,3)}),markup:'<bindle-account></bindle-account>'},async page=>{await openIsl(page);await page.frameLocator('bindle-account iframe[src*="account-switcher"]').locator('.card').hover();await waitIdle(page,900);},{width:390,height:560,motion:true},{probes:[...swProbes,'armed'],group:'switcher-390-regular'});
// Forced colours (Chromium emulates them; Firefox renders its normal palette here).
add('X01-forced-colors-sign-in',{layout:'stage',markup:stage360('<bindle-sign-in></bindle-sign-in>')},async page=>{await page.getByLabel('Your handle').focus();await waitIdle(page);},{width:390,height:380,forced:true});
add('X02-forced-colors-switcher',{...signedInIsl({views:views8.slice(0,3)}),markup:'<bindle-account actions="switch sign-out manage"></bindle-account>'},openIsl,{width:390,height:640,forced:true},{probes:swProbes});
add('X03-forced-colors-islands',{...signedInIsl(),signIn:[],layout:'stage',markup:'<div style="inline-size:100%"><bindle-sign-in></bindle-sign-in></div><div style="inline-size:100%"><bindle-sign-in island-variant="outline"></bindle-sign-in></div>'},page=>waitIdle(page,1800),{width:390,height:400,forced:true},{probes:['frames']});
add('I03g-switcher-rtl-page',{...signedInIsl({views:views8.slice(0,4)}),dir:'rtl',markup:'<bindle-account></bindle-account>'},openIsl,{width:390,height:560},{probes:swProbes,group:'switcher-390-regular'});
for(const scheme of ['light','dark'])add(`I04-request-island-${scheme}`,{...signedInIsl(),layout:'stage',markup:'<div style="inline-size:100%"><p style="margin:0 0 8px">Share your calendar to see free slots.</p><bindle-request></bindle-request></div><div style="inline-size:100%"><bindle-request kind="configure" island-variant="outline"></bindle-request></div>'},page=>waitIdle(page,2200),{width:390,height:300,scheme},{probes:['frames']});
for(const scheme of ['light','dark'])add(`I04b-request-island-focus-${scheme}`,{...signedInIsl(),layout:'stage',markup:'<button>Before</button><div style="inline-size:100%"><bindle-request></bindle-request></div>'},async page=>{await waitIdle(page,2200);await tabUntil(page,'request','button');await waitIdle(page,400);},{width:390,height:240,scheme},{probes:['focus','frames']});
add('I05-island-fallback-unreachable',{...signedInIsl(),parts:[],markup:'<bindle-account></bindle-account>'},page=>waitIdle(page,4500),{width:390,height:220});
add('I06-islands-vs-embedder-tokens',{...signedInIsl({views:views8.slice(0,3)}),signIn:[],layout:'stage',css:'.round{--bindle-radius:22;--bindle-accent:#7c3aed;font-family:Georgia,serif}',markup:'<div class="round" style="inline-size:100%"><p style="margin:0 0 6px">Element (islands off):</p><bindle-session-proxy></bindle-session-proxy></div><div class="round" style="inline-size:100%"><p style="margin:0 0 6px">Island (provider defaults, no tokens):</p><bindle-sign-in></bindle-sign-in></div>'},async page=>{await page.evaluate(()=>{const p=document.querySelector('bindle-session-proxy');const s=document.createElement('bindle-session');s.setAttribute('islands','off');s.setAttribute('client-id','https://app.example/client');s.setAttribute('redirect-uri','https://app.example/callback');s.setAttribute('default-host','provider.example');s.innerHTML='<bindle-sign-in></bindle-sign-in>';p.replaceWith(s);});await waitIdle(page,2500);},{width:390,height:520});

// ---------------------------------------------------------------------------------------------------------------
// Probes. One function, evaluated in every frame (the app document and each island document), returns findings.
// Colours are resolved from computed styles; backgrounds are composited up the composed tree (shadow hosts, slots).
const frameProbe=({kind,checks})=>{
  const findings=[],metrics={};
  const parse=value=>{
    if(!value)return null;value=value.trim();
    let m=/^#([0-9a-f]{3,8})$/i.exec(value);
    if(m){let h=m[1];if(h.length<=4)h=[...h].map(c=>c+c).join('');const n=[0,2,4,6].map(i=>h.length>i?Number.parseInt(h.slice(i,i+2),16):255);return [n[0],n[1],n[2],n[3]/255];}
    m=/^rgba?\(([^)]+)\)$/.exec(value);
    if(m){const p=m[1].split(/[\s,/]+/).filter(Boolean).map(s=>s.endsWith('%')?Number.parseFloat(s)/100:Number(s));return [p[0],p[1],p[2],p[3]??1];}
    m=/^color\(srgb ([^)]+)\)$/.exec(value);
    if(m){const p=m[1].split(/[\s/]+/).filter(Boolean).map(Number);return [p[0]*255,p[1]*255,p[2]*255,p[3]??1];}
    if(value==='transparent')return [0,0,0,0];
    return null;
  };
  const over=(top,bottom)=>{const a=top[3]+bottom[3]*(1-top[3]);if(!a)return [0,0,0,0];return [0,1,2].map(i=>(top[i]*top[3]+bottom[i]*bottom[3]*(1-top[3]))/a).concat(a);};
  const lum=c=>{const ch=v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*ch(c[0])+0.7152*ch(c[1])+0.0722*ch(c[2]);};
  const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);};
  const hex=c=>c?'#'+c.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')+(c[3]<1?`/${c[3].toFixed(2)}`:''):'?';
  const parent=node=>node.assignedSlot??node.parentElement??node.parentNode?.host??null;
  const style=el=>getComputedStyle(el);
  // Base colour behind the top-level document (or behind an island document, whose root is transparent).
  const base=()=>{
    if(kind==='island'){const s=parse(style(document.documentElement).getPropertyValue('--c-surface'));if(s)return s;}
    const body=parse(style(document.body).backgroundColor),root=parse(style(document.documentElement).backgroundColor);
    for(const c of [body,root])if(c&&c[3]>0)return over(c,[255,255,255,1]);
    return matchMedia('(prefers-color-scheme: dark)').matches?[18,18,18,1]:[255,255,255,1];
  };
  const bgOf=(el,{skipSelf=false}={})=>{
    const layers=[];let node=skipSelf?parent(el):el,opacity=1;
    while(node&&node.nodeType===1){const s=style(node),c=parse(s.backgroundColor);if(c&&c[3]>0){layers.push(c);if(c[3]>=1)break;}node=parent(node);}
    let color=layers.length&&layers.at(-1)[3]>=1?layers.pop():base();
    while(layers.length)color=over(layers.pop(),color);
    return color;
  };
  const opacityOf=el=>{let o=1,node=el;while(node&&node.nodeType===1){o*=Number(style(node).opacity);node=parent(node);}return o;};
  const visible=el=>{const r=el.getBoundingClientRect(),s=style(el);return r.width>1&&r.height>1&&s.visibility==='visible'&&!el.closest('[aria-hidden=true]');};
  const label=el=>{let s=el.tagName.toLowerCase();if(el.id)s+='#'+el.id;if(el.classList?.length)s+='.'+[...el.classList].join('.');const host=el.getRootNode()?.host;return host?host.tagName.toLowerCase()+'>>'+s:s;};
  // Roots to walk: the island document, or the shadow roots of bindle-* elements (nested ones included).
  const roots=[];
  const collect=root=>{for(const el of root.querySelectorAll('*')){if(el.shadowRoot&&(kind==='island'||el.tagName.startsWith('BINDLE-'))){roots.push(el.shadowRoot);collect(el.shadowRoot);}}};
  if(kind==='island')roots.push(document.body);collect(document);

  if(checks.includes('contrast')){
    for(const root of roots){
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      const seen=new Set();
      for(let n=walker.nextNode();n;n=walker.nextNode()){
        const el=n.parentElement;if(!el||seen.has(el)||!n.textContent.trim())continue;seen.add(el);
        if(['STYLE','SCRIPT','TEMPLATE','OPTION'].includes(el.tagName)||!visible(el))continue;
        if(el.closest('.visually-hidden'))continue;
        // Disabled controls are exempt from 1.4.3; they still must be legible, so 3:1 is required.
        const disabled=!!el.closest('button:disabled,[aria-disabled=true]');
        const s=style(el),fg=parse(s.color),bg=bgOf(el),o=opacityOf(el);if(!fg)continue;
        const shown=over([...fg.slice(0,3),fg[3]*o],bg),size=Number.parseFloat(s.fontSize),weight=Number(s.fontWeight)||400;
        const min=disabled?3:size>=24||size>=18.66&&weight>=700?3:4.5,r=ratio(shown,bg);
        if(r<min-0.005)findings.push({probe:'contrast',target:label(el),text:n.textContent.trim().slice(0,40),fg:hex(shown),bg:hex(bg),ratio:+r.toFixed(2),min});
      }
      // 1.4.11: a control whose fill does not stand out from its surround needs a boundary that does.
      // Ghost controls (menu items, the trigger, switcher rows and actions) are identified by their text and position;
      // a hover or press tint on them is not a boundary.
      for(const el of root.querySelectorAll('button,.identity,.button,.control')){
        if(!visible(el)||el.matches(':disabled,[aria-disabled=true],.item,.trigger,.row,.card,.action,.ghost'))continue;
        const s=style(el),fill=parse(s.backgroundColor);if(!fill||fill[3]===0)continue; // ghost controls are identified by their text
        const surround=bgOf(el,{skipSelf:true}),own=over(fill,surround);
        if(ratio(own,surround)>=3)continue;
        const width=Number.parseFloat(s.borderTopWidth),border=parse(s.borderTopColor);
        const shadowRing=/inset/.test(s.boxShadow)?null:s.boxShadow;
        if(width>0&&border&&border[3]>0&&ratio(over(border,surround),surround)>=3)continue;
        findings.push({probe:'boundary',target:label(el),fill:hex(own),surround:hex(surround),border:width>0?hex(border):'none',shadow:shadowRing??'none'});
      }
    }
  }
  if(checks.includes('overflow')){
    const doc=document.documentElement;
    if(doc.scrollWidth>innerWidth+0.5)findings.push({probe:'overflow',target:kind,scrollWidth:doc.scrollWidth,innerWidth});
  }
  if(checks.includes('island-fit')&&kind==='island'){
    // Nothing inside an island may extend outside its frame (the root clips; clipped controls are unreachable).
    for(const el of document.querySelectorAll('.part:target *, html[data-part] .part *')){
      if(!visible(el)||el.closest('.list'))continue;
      const r=el.getBoundingClientRect();
      if(r.left<-0.5||r.right>innerWidth+0.5)findings.push({probe:'island-fit',target:label(el),left:+r.left.toFixed(1),right:+r.right.toFixed(1),innerWidth});
    }
    for(const el of document.querySelectorAll('.list .row:not([data-empty])')){const r=el.getBoundingClientRect();const list=el.closest('.list').getBoundingClientRect();if(r.left<list.left-0.5||r.right>list.right+0.5)findings.push({probe:'island-fit',target:label(el),left:r.left,right:r.right,list:[list.left,list.right]});}
    // Truncated text must show an ellipsis (or wrap), never a hard clip.
    for(const el of document.querySelectorAll('.name,.handle,.action,.label,.warn')){
      if(!visible(el))continue;const s=style(el);
      if(el.scrollWidth>el.clientWidth+1&&s.textOverflow!=='ellipsis'&&s.whiteSpace==='nowrap')findings.push({probe:'island-fit',target:label(el),issue:'clipped without ellipsis',text:el.textContent.slice(0,40)});
    }
    for(const el of document.querySelectorAll('.actions .action')){const r=el.getBoundingClientRect();if(visible(el)&&(r.width<44||r.height<24))findings.push({probe:'island-fit',target:label(el),issue:'action below target size',w:r.width,h:r.height});}
    const list=document.querySelector('.list');if(list)metrics.list={rows:list.querySelectorAll('li').length,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight};
  }
  if(checks.includes('focus')){
    // The deep active element of this document (through shadow roots); an iframe active element is reported for
    // the caller to follow into that frame.
    let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;
    if(a&&a!==document.body&&a.tagName!=='IFRAME'){
      // A field's ring may be drawn by its wrapper (:focus-within) instead of the input itself.
      const ringOf=el=>{const s=style(el),width=Number.parseFloat(s.outlineWidth)||0;return s.outlineStyle!=='none'&&width>=2?el:null;};
      let ringed=ringOf(a);if(!ringed&&a.tagName==='INPUT'){let node=parent(a);while(node&&node.nodeType===1&&node.getRootNode()===a.getRootNode()){if(ringOf(node)){ringed=node;break;}node=parent(node);}}
      const el=ringed??a,s=style(el),width=Number.parseFloat(s.outlineWidth)||0,offset=Number.parseFloat(s.outlineOffset)||0,ring=ringed?parse(s.outlineColor):null;
      const info={target:label(a),ringOn:label(el),outline:`${s.outlineStyle} ${width}px ${hex(ring)} offset ${offset}`,shadow:s.boxShadow};
      if(!ring)findings.push({probe:'focus',...info,issue:'no visible focus outline'});
      else{
        const own=bgOf(el),surround=bgOf(el,{skipSelf:true}),neighbours=offset<0?[own]:[surround];
        // An inset ring that sits inside an inset box-shadow ring is judged against that ring as well.
        const shadowColor=/inset/.test(s.boxShadow)?parse((s.boxShadow.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+)/i)??[])[1]):null;
        if(offset<0&&shadowColor&&Math.abs(offset)>=width)neighbours.push(over(shadowColor,own));
        const ratios=neighbours.map(n=>ratio(over(ring,n),n));info.ratios=ratios.map(r=>+r.toFixed(2));
        if(Math.min(...ratios)<3)findings.push({probe:'focus',...info,issue:'focus ring contrast below 3:1'});
        metrics.focus=info;
      }
      if(checks.includes('single-ring')){
        // V12: one ring per focused control (the wrapper's :focus-within ring or the control's own, never both).
        let node=parent(a);const ringed=[];while(node&&node.nodeType===1&&node!==a.getRootNode().host){const ns=style(node);if(ns.outlineStyle!=='none'&&Number.parseFloat(ns.outlineWidth)>0)ringed.push(label(node));node=parent(node);}
        if(ringOf(a)&&ringed.length)findings.push({probe:'single-ring',target:label(a),also:ringed,issue:'double focus ring'});
      }
      metrics.active=label(a);
    }
    metrics.activeIsFrame=a?.tagName==='IFRAME';
  }
  if(checks.includes('avatar-island')&&kind==='app'){
    // V1: the avatar island box must coincide with the standard avatar it covers, and be clipped to its circle.
    const hosts=[...document.querySelectorAll('bindle-account,bindle-avatar,bindle-session bindle-account')].filter(h=>h.shadowRoot);
    for(const host of new Set(hosts)){
      const root=host.shadowRoot,box=root.querySelector('.avatar-island:not([hidden]),.island'),avatar=root.querySelector('.avatar');
      const frame=box?.querySelector('iframe'),shown=avatar&&avatar.getBoundingClientRect().width>0&&style(avatar).visibility==='visible';if(!box||!frame||!shown)continue;
      const a=avatar.getBoundingClientRect(),f=frame.getBoundingClientRect(),s=style(box);
      const delta=Math.max(Math.abs(a.left-f.left),Math.abs(a.top-f.top),Math.abs(a.width-f.width),Math.abs(a.height-f.height));
      (metrics.avatars??=[]).push({host:host.tagName.toLowerCase(),avatar:[a.left,a.top,a.width,a.height].map(v=>+v.toFixed(2)),frame:[f.left,f.top,f.width,f.height].map(v=>+v.toFixed(2))});
      if(delta>0.75)findings.push({probe:'avatar-island',target:host.tagName.toLowerCase(),issue:'island box misaligned with the standard avatar',delta:+delta.toFixed(2)});
      const clipped=/circle|ellipse/.test(s.clipPath)||(s.overflow!=='visible'&&Number.parseFloat(s.borderTopLeftRadius)>=Math.min(f.width,f.height)/2-0.5)||s.borderTopLeftRadius==='50%';
      if(!clipped)findings.push({probe:'avatar-island',target:host.tagName.toLowerCase(),issue:'island not clipped to the avatar circle',clipPath:s.clipPath,radius:s.borderTopLeftRadius,overflow:s.overflow});
    }
  }
  if(checks.includes('frames')&&kind==='app'){
    // Island frame boxes (C1): recorded for the group invariants and the fixed-height rules.
    const frames=[];const walk=root=>{for(const el of root.querySelectorAll('*')){if(el.tagName==='IFRAME'){const r=el.getBoundingClientRect();if(r.width>0)frames.push({part:(el.src.match(/#([a-z-]+)/)??[])[1],w:+r.width.toFixed(2),h:+r.height.toFixed(2)});}if(el.shadowRoot)walk(el.shadowRoot);}};walk(document);
    metrics.frames=frames;
  }
  return {findings,metrics};
};

async function probe(page,sc){
  const checks=['contrast','overflow',...sc.probes??[]];
  const app=await page.evaluate(frameProbe,{kind:'app',checks});
  const findings=[...app.findings],metrics={app:app.metrics,islands:{}};
  for(const frame of page.frames()){
    if(frame===page.mainFrame()||!frame.url().startsWith(EMBED))continue;
    const part=(frame.url().match(/#([a-z-]+)/)??[])[1]??'?';
    const islandChecks=['contrast','overflow',...(checks.includes('switcher-fit')&&part==='account-switcher'?['island-fit']:[]),...(checks.includes('focus')?['focus']:[])];
    if(part==='avatar')islandChecks.splice(islandChecks.indexOf('contrast'),1);
    // Skeletons and frames hidden behind the standard composition are not judged.
    const shown=await frame.frameElement().then(e=>e.isVisible()).catch(()=>false);if(!shown)continue;
    const result=await frame.evaluate(frameProbe,{kind:'island',checks:islandChecks}).catch(()=>null);if(!result)continue;
    for(const f of result.findings)findings.push({...f,frame:part});
    (metrics.islands[part]??=[]).push(result.metrics);
  }
  if(checks.includes('armed')){
    const opacity=await page.evaluate(()=>{const panel=document.querySelector('bindle-account')?.shadowRoot?.querySelector('.panel');return panel?getComputedStyle(panel).opacity:null;});
    if(opacity!=='1')findings.push({probe:'motion',issue:'panel not fully opaque after opening',opacity});
    const armed=await islandFrame(page,'account-switcher')?.evaluate(()=>document.documentElement.dataset.armed).catch(()=>null);
    if(armed!=='true')findings.push({probe:'armed',issue:'switcher island never armed after the pointer dwelt on it',armed});
  }
  // A focus scenario must end with a focused control somewhere (app or island) that passed the ring check.
  if(checks.includes('focus')){
    const focused=metrics.app.focus||Object.values(metrics.islands).flat().some(m=>m.focus);
    if(!focused&&!findings.some(f=>f.probe==='focus'))findings.push({probe:'focus',issue:'no focused control with a measurable ring',active:metrics.app.active??null});
  }
  // Fixed island heights (C1): sign-in 44/48, request 44/48, switcher 320/248, set by the element.
  for(const f of metrics.app.frames??[]){
    if(['sign-in','request'].includes(f.part)&&![44,48].includes(Math.round(f.h)))findings.push({probe:'fixed-size',target:f.part,issue:'island height not 44/48',h:f.h});
    if(f.part==='account-switcher'&&![320,248].includes(Math.round(f.h)))findings.push({probe:'fixed-size',target:f.part,issue:'switcher height not 320/248',h:f.h});
  }
  return {findings,metrics};
}

// ---------------------------------------------------------------------------------------------------------------
async function runScenario(browser,engineName,sc){
  const name=engineName==='chromium'?sc.name:`${sc.name}-${engineName}`,file=resolve(out,`${name}.png`);
  const {ctx,page}=await context(browser,sc.S,sc.opts);
  const result={name,scenario:sc.name,engine:engineName,file:relative(out,file),opts:sc.opts,group:sc.group??null,findings:[],metrics:{},errors:[]};
  try{
    const nav=page.goto(APP+'/');
    if(!sc.run){await page.waitForLoadState('domcontentloaded').catch(()=>{});await waitIdle(page,800);await page.screenshot({path:file});await nav.catch(()=>{});}
    else{
      await nav;await page.waitForFunction(()=>window.ready,null,{timeout:10000});if((sc.probes??[]).includes('focus'))await page.bringToFront();await sc.run(page);await page.screenshot({path:file});
      Object.assign(result,await probe(page,sc));
    }
  }catch(error){result.findings.push({probe:'run',issue:error.message.split('\n')[0]});try{await page.screenshot({path:file});}catch{}}
  finally{result.errors=page.errors.slice();for(const message of page.errors)result.findings.push({probe:'pageerror',issue:message});await ctx.close();}
  return result;
}
async function pool(items,size,fn){const results=[];let next=0;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i]);}}));return results;}

// Group invariants (C1/C2): island frame sizes and switcher scroll geometry identical across account states.
function groupFindings(results){
  const findings=[],groups=new Map();
  for(const r of results)if(r.group&&r.metrics.app)(groups.get(`${r.engine} ${r.group}`)??groups.set(`${r.engine} ${r.group}`,[]).get(`${r.engine} ${r.group}`)).push(r);
  for(const [key,members] of groups){
    const shape=r=>JSON.stringify({frames:(r.metrics.app.frames??[]).filter(f=>f.part!=='avatar').map(f=>[f.part,f.w,f.h]).sort(),list:(r.metrics.islands['account-switcher']??[]).map(m=>m.list&&[m.list.rows,m.list.scrollHeight,m.list.clientHeight])});
    const first=shape(members[0]);
    for(const r of members.slice(1)){const s=shape(r);if(s!==first){const f={probe:'fixed-size',issue:`island geometry differs within group ${key}`,expected:first,actual:s,against:members[0].name};r.findings.push(f);findings.push({...f,name:r.name});}}
  }
  return findings;
}

function indexHTML(results){
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  const byScenario=new Map();for(const r of results)(byScenario.get(r.scenario)??byScenario.set(r.scenario,[]).get(r.scenario)).push(r);
  const failing=results.filter(r=>r.findings.length).length;
  const cards=[...byScenario].map(([scenario,rs])=>`<section class="card${rs.some(r=>r.findings.length)?' fail':''}" data-name="${esc(scenario)}"><h2>${esc(scenario)}</h2><div class="shots">${rs.map(r=>`<figure><a href="${esc(r.file)}"><img loading="lazy" src="${esc(r.file)}" alt="${esc(r.name)}"></a><figcaption>${esc(r.engine)} · ${r.opts.width??390}px · ${esc(r.opts.scheme??'light')}${r.findings.length?` · <b>${r.findings.length} finding(s)</b>`:' · ok'}</figcaption>${r.findings.length?`<pre>${esc(r.findings.map(f=>JSON.stringify(f)).join('\n'))}</pre>`:''}</figure>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elements gallery</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5b6270;--bad:#b42318;--line:#e3e6eb}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--card:#1b1d22;--text:#eceef2;--muted:#a9b0bb;--bad:#ff8a7a;--line:#343840}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui,sans-serif}header{position:sticky;top:0;z-index:1;background:var(--bg);padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap;align-items:center}
h1{font-size:18px;margin:0}input{font:inherit;padding:6px 10px;border:1px solid var(--muted);border-radius:8px;background:var(--card);color:var(--text);min-width:min(320px,100%)}main{padding:16px;display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.card.fail{border-color:var(--bad)}h2{font-size:14px;margin:0 0 8px}.shots{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;max-width:100%}img{display:block;max-width:min(100%,640px);max-height:420px;border:1px solid var(--line);border-radius:6px}figcaption{color:var(--muted);font-size:12px;margin-top:4px}b{color:var(--bad)}pre{white-space:pre-wrap;font-size:11px;color:var(--bad);max-width:640px}</style></head>
<body><header><h1>Elements gallery</h1><span>${results.length} captures · ${failing} with findings · ${esc(new Date().toISOString())}</span><input type="search" placeholder="Filter scenarios" oninput="for(const c of document.querySelectorAll('.card'))c.hidden=!c.dataset.name.includes(this.value)"><label><input type="checkbox" style="min-width:0" onchange="for(const c of document.querySelectorAll('.card'))c.style.display=this.checked&&!c.classList.contains('fail')?'none':''"> findings only</label></header><main>${cards}</main></body></html>`;
}

const selected=scenarios.filter(sc=>!filter||filter.test(sc.name));
const all=[];
test.before(async()=>{if(!filter&&!process.env.GALLERY_KEEP)await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});});
test.after(async()=>{
  await writeFile(resolve(out,'probes.json'),JSON.stringify(all.map(({name,engine,file,group,findings,retried,metrics})=>({name,engine,file,group,findings,retried,metrics})),null,1));
  await writeFile(resolve(out,'index.html'),indexHTML(all));
});
for(const engineName of engines)test(`elements gallery (${engineName})`,async t=>{
  const engine=engineName==='firefox'?firefox:chromium;
  let browser;try{browser=await engine.launch({headless:true,...engineName==='firefox'?{firefoxUserPrefs:{'accessibility.tabfocus':7}}:{}});}catch(error){t.skip(`${engineName} unavailable: ${error.message.split('\n')[0]}`);return;}
  try{
    // Keyboard-focus scenarios run one at a time: a headless browser gives document focus to one page at a time.
    const focus=sc=>(sc.probes??[]).includes('focus');
    // A navigation or wait that times out on a loaded machine is retried once; the retry is recorded in probes.json.
    const run=async sc=>{const first=await runScenario(browser,engineName,sc);if(!first.findings.some(f=>f.probe==='run'&&/Timeout/.test(f.issue)))return first;return {...await runScenario(browser,engineName,sc),retried:first.findings};};
    const results=[...await pool(selected.filter(sc=>!focus(sc)),concurrency,run),...await pool(selected.filter(focus),1,run)];
    all.push(...results);
    const grouped=groupFindings(results);
    const failures=results.filter(r=>r.findings.length);
    for(const r of failures)t.diagnostic(`${r.name}: ${r.findings.map(f=>JSON.stringify(f)).join(' | ')}`);
    assert.equal(failures.length,0,`${failures.length} capture(s) with findings (${grouped.length} group invariant(s)); see ${relative(project,resolve(out,'index.html'))}:\n${failures.map(r=>`  ${r.name}: ${r.findings.map(f=>f.probe+(f.issue?' ('+f.issue+')':'')+(f.target?' '+f.target:'')).join('; ')}`).join('\n')}`);
  }finally{await browser.close();}
});
