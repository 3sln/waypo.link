// Settings → email addresses in a real browser (sign-in and intents spike §3, §6.1; owner approval 2026-10-28): each
// address shows its state (unverified, verified, sign-in email) and only the controls that state allows; the controls
// reach the identity routes through the console's Actions; English and Spanish, light and dark, phone to desktop widths,
// keyboard reachable, no horizontal scroll. The server's rules are covered at engine level (tests/sign-in-emails.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const root=resolve('.');let server,browser,origin;
const now=Date.UTC(2026,9,28,12),DAY=86400000;
const emails=[{address:'signin@mail.example',state:'sign-in',verifiedAt:now-20*DAY,signInSince:now-2*DAY,notices:true,recent:true},{address:'verified@mail.example',state:'verified',verifiedAt:now-DAY,notices:false},{address:'pending@mail.example',state:'unverified',expiresAt:now+DAY,notices:false}];
const state=(locale='en',removal=true)=>({locale,view:'security',brand:{name:'Fixture space',host:'provider.example'},loading:false,session:{account:{id:'owner',handle:'n.emails',emails,noticeEmail:'signin@mail.example',signInEmail:true},sessionContext:'ctx'},config:{emailEnabled:true,origin:'https://provider.example'},beamGeneration:1,route:{kind:'home'},data:{account:{id:'owner',handle:'n.emails',emails,noticeEmail:'signin@mail.example',signInEmail:true,passkeyCount:1},features:{emailRemovalEnabled:removal},devices:[],grants:[],credentials:[],messages:[],views:[],resources:[],collections:[]}});let current=state();
const boot=`import {Engine,Provider,dodo} from '/apps/web/src/shared/stack.mjs';import StateProvider from '/apps/web/src/providers/browser-state.mjs';import {NavigateSpace,SetEmailSignIn,SetNoticeEmail,RemovePendingEmail,RemoveEmail} from '/apps/web/src/bl/release.mjs';import createApp from '/apps/web/src/ui/release-app.mjs';import localize from '/apps/web/src/ui/localize.mjs';import {createLocalization} from '/apps/web/src/shared/i18n.mjs';
const model=await(await fetch('/fixture')).json(),root=document.getElementById('app'),calls=[];window.calls=calls;let focus;
const api={get:async path=>{calls.push({path,method:'GET'});if(path==='/api/account')return model.data;return {};},request:async(path,body,method='POST')=>{calls.push({path,body,method});return {currentSessionRevoked:false};}};
const browser={captureFocus:()=>{focus=document.activeElement;},modalFocus:()=>setTimeout(()=>root.querySelector('[role=dialog] input,[role=dialog] button')?.focus(),10),restoreFocus:()=>setTimeout(()=>focus?.focus(),10),storeSecret(){},clearOwnerContext(){},cancelDeviceEntry(){},setCaptchaAction(){},installCaptcha(){},consumeSubmission:id=>window.submissions?.[id]};
const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});await engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,model)));const read=()=>engine.container.use(['state'],({state})=>state.snapshot());
const paint=async()=>{const s=await read(),i18n=createLocalization({locale:s.locale});document.documentElement.lang=s.locale;dodo.reconcile(root,[createApp({localize:t=>localize(t,i18n)})(s)]);};engine.feed.addEventListener('browser-state-updated',paint);
root.addEventListener('3sln-intent',async event=>{event.stopPropagation();const d=event.detail,map={'email-sign-in':SetEmailSignIn,'email-notices':SetNoticeEmail,'remove-pending-email':RemovePendingEmail,'remove-email':RemoveEmail};let detail=d;if(d.form){const data=new FormData(d.form);detail={...d,values:Object.fromEntries(data.entries())};delete detail.form;}await engine.dispatch(map[d.kind]?new map[d.kind](detail):new NavigateSpace(detail)).next('complete');});await paint();window.ready=true;`;
test.before(async()=>{server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;if(path==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(current));return;}if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/apps/web/styles.css"></head><body><div id="app"></div><script type="module" src="/boot.mjs"></script></body></html>');return;}if(path==='/boot.mjs'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}const file=resolve(root,'.'+path);if(!file.startsWith(root+'/')||!['/apps/web/','/packages/','/vendor/'].some(p=>path.startsWith(p))){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',extname(file)==='.css'?'text/css':extname(file)==='.svg'?'image/svg+xml':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});});
test.after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
const T={en:{signIn:'Sign-in email',verified:'Verified',unverified:'Unverified',use:'Use for sign-in',stop:'Stop using for sign-in',notices:'Send notices here',cancel:'Cancel',remove:'Remove',removeAddress:'Remove address',confirm:'I want to remove this address'},es:{signIn:'Correo de acceso',verified:'Verificado',unverified:'Sin verificar',use:'Usar para iniciar sesión',stop:'Dejar de usar para iniciar sesión',notices:'Enviar avisos aquí',cancel:'Cancelar',remove:'Quitar',removeAddress:'Quitar dirección',confirm:'Quiero quitar esta dirección'}};
const calls=page=>page.evaluate(()=>window.calls.filter(c=>c.method!=='GET'));
for(const locale of ['en','es'])for(const colorScheme of ['light','dark'])for(const width of [320,1440])test(`email list ${locale} ${colorScheme} ${width}: states, allowed controls, actions reach the identity routes`,async()=>{
 current=state(locale);const t=T[locale],page=await browser.newPage({viewport:{width,height:1100},colorScheme}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));try{
  await page.goto(origin);await page.waitForFunction(()=>window.ready);
  const rows=page.locator('.email-addresses .email-row');assert.equal(await rows.count(),3);
  const row=address=>page.locator('.email-addresses .email-row',{hasText:address});
  assert.equal(await row('signin@mail.example').getAttribute('data-email-state'),'sign-in');
  assert.match(await row('signin@mail.example').textContent(),new RegExp(t.signIn));
  assert.match(await row('verified@mail.example').textContent(),new RegExp(t.verified));
  assert.match(await row('pending@mail.example').textContent(),new RegExp(t.unverified));
  // Only a verified address offers sign-in; an unverified one offers only Cancel; the notice address offers no notice move.
  assert.equal(await row('verified@mail.example').getByRole('button',{name:t.use,exact:true}).count(),1);
  assert.equal(await row('pending@mail.example').getByRole('button',{name:t.use,exact:true}).count(),0);
  assert.deepEqual(await row('pending@mail.example').getByRole('button').allTextContents(),[t.cancel]);
  assert.equal(await row('signin@mail.example').getByRole('button',{name:t.notices}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll: '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&!e.closest('nav')).slice(0,8).map(e=>[e.tagName,e.className,Math.round(e.getBoundingClientRect().right),e.textContent.slice(0,40)]))));
  // Keyboard: Use for sign-in.
  await row('verified@mail.example').getByRole('button',{name:t.use,exact:true}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.calls.some(c=>c.path==='/api/auth/email/login/settings'));
  assert.deepEqual((await calls(page)).at(-1),{path:'/api/auth/email/login/settings',body:{address:'verified@mail.example',enabled:true},method:'POST'});
  await row('verified@mail.example').getByRole('button',{name:t.notices}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.path==='/api/auth/email/notices'));
  assert.deepEqual((await calls(page)).at(-1).body,{address:'verified@mail.example'});
  await row('pending@mail.example').getByRole('button',{name:t.cancel}).click();
  await page.waitForFunction(()=>window.calls.some(c=>c.path==='/api/auth/email/remove'));
  assert.deepEqual((await calls(page)).at(-1).body,{address:'pending@mail.example',confirmed:true});
  // Turning a sign-in email off asks first.
  await row('signin@mail.example').getByRole('button',{name:t.stop}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.textContent(),/signin@mail\.example/);
  await dialog.getByRole('button',{name:t.stop}).click();
  await page.waitForFunction(()=>window.calls.filter(c=>c.path==='/api/auth/email/login/settings').length===2);
  assert.deepEqual((await calls(page)).filter(c=>c.path==='/api/auth/email/login/settings').at(-1).body,{address:'signin@mail.example',enabled:false});
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

test('email list: without EMAIL_REMOVAL_ENABLED confirmed addresses offer no Remove; at three verified addresses Add is replaced by a hint',async()=>{
 current=state('en',false);current.data.account.emails=[...emails.slice(0,2),{address:'third@mail.example',state:'verified',verifiedAt:now,notices:false}];current.session.account.emails=current.data.account.emails;
 const page=await browser.newPage({viewport:{width:390,height:1000}});try{
  await page.goto(origin);await page.waitForFunction(()=>window.ready);
  assert.equal(await page.locator('.email-addresses').getByRole('button',{name:'Remove',exact:true}).count(),0);
  assert.equal(await page.locator('.email-addresses').getByRole('button',{name:'Add email address'}).count(),0);
  assert.match(await page.locator('.email-addresses').textContent(),/three verified addresses/);
 }finally{await page.close();}
});
