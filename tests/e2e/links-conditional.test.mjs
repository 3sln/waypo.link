import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../../apps/node/server.mjs';
import {signSystemInvitation} from '../../packages/identity/system-bootstrap.mjs';
import {launch,screenshot} from './browser.mjs';

// Real Node identity/runtime + real Chromium. A local wrangler Worker cannot bootstrap the
// protected developer identity (it needs a configured email or push provider), so the
// developer-contact panel runs on the Node adapter with a loopback-only captured mailer. No debug routes are added.
// Developer contact is occupant-only since messaging left the core (2026-10-27): the link belongs to the developer's
// messaging app. This host runs no messaging app, so the service answers unavailable and the console says so; the
// eligible hand-off (`send-message` intent) is covered at engine level in tests/browser/contact-links.mjs.
const password='Private conditional browser password 2026!',secret=Buffer.alloc(32,61).toString('base64url');
let browser;const servers=[];
test.before(async()=>{browser=await launch();});
test.after(async()=>{await browser?.close();for(const s of servers){await s.app.close();await rm(s.directory,{recursive:true,force:true});}});
async function server(config={}){
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const origin='http://localhost:'+port,directory=await mkdtemp(join(tmpdir(),'3sln-links-browser-')),mailbox=[];
 const app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true',SYSTEM_BOOTSTRAP_KEY:secret,...config},mailer:{async sendSetupCode(value){mailbox.push(value);}}});
 await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));const entry={app,directory,origin,mailbox};servers.push(entry);
 // Operator bootstrap of the protected `ray` developer identity through the real public API.
 const post=(path,input,cookie)=>app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.250',...cookie?{Cookie:cookie}:{}},body:JSON.stringify(input)}));
 const begin=await post('/api/auth/system/bootstrap/begin',{});const cookie=begin.headers.get('Set-Cookie').split(';')[0],now=Date.now();
 const token=await signSystemInvitation({version:1,purpose:'bindle-system-account-setup',issuer:origin,handle:'ray',role:'developer',owner:crypto.randomUUID(),assignmentId:crypto.randomUUID(),nonce:crypto.randomUUID(),issuedAt:now,expiresAt:now+3600000},secret);
 const pending=await (await post('/api/auth/system/bootstrap',{bootstrapToken:token,method:'password',password,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'},cookie)).json();assert.equal(pending.account.systemBadge.role,'developer');
 const file=await (await post('/api/auth/recovery/download',pending,cookie)).json();await post('/api/auth/setup/email/start',{...pending,email:'developer@links.example'},cookie);
 assert.equal((await post('/api/auth/setup/email/confirm',{...pending,code:mailbox.at(-1).code},cookie)).status,200);assert.equal((await post('/api/auth/recovery/confirm',{...pending,...file,downloadConfirmed:true},cookie)).status,200);
 // The scheduled census normally completes the active-population baseline; step it here so policy is decidable.
 for(let i=0;i<20&&!(await app.resources.population.censusStep()).complete;i++);
 return entry;
}
let network=10;
async function person(t,s,{signedIn=true}={}){
 const context=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${network++}`}});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[],'No browser runtime errors'));
 let account=null;if(signedIn){const request=(path,data)=>context.request.post(s.origin+path,{headers:{Origin:s.origin},data});const pending=await (await request('/api/auth/signup',{method:'password',password,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json(),recovery=await (await request('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json(),active=await request('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true});assert.equal(active.status(),200,await active.text());account=(await active.json()).account;}
 return {context,page,account};
}
async function developerLink(page,s){await page.goto(s.origin+'/console');await page.locator('.app-shell').waitFor();return page.evaluate(async()=>{const session=await (await fetch('/api/session')).json();return (await fetch('/api/developer-contact',{headers:{'X-Bindle-Account':session.account.id,'X-Bindle-Session-Context':session.sessionContext}})).json();});}

test('developer contact without a messaging app is shown as unavailable in Account & security and signs nothing',async t=>{
 const s=await server(),alice=await person(t,s),signs=[];alice.page.on('request',request=>{if(/\/api\/links\/(respond|envelope)$/.test(request.url()))signs.push(request.url());});
 const developer=await developerLink(alice.page,s);assert.deepEqual(developer,{available:false,reason:'contact-unavailable'});
 await alice.page.getByRole('button',{name:'Account & security',exact:true}).click();const panel=alice.page.locator('.developer-contact-panel');
 await panel.getByText('The developer contact link is unavailable right now.').waitFor();assert.equal(await panel.getByRole('button',{name:'Write with your messaging app',exact:true}).count(),0);assert.equal(await panel.getByRole('button',{name:'Open developer contact',exact:true}).count(),0);
 await panel.getByRole('button',{name:'Check eligibility again',exact:true}).click();await panel.getByText('The developer contact link is unavailable right now.').waitFor();assert.equal(await alice.page.locator('[role=alert]').count(),0);
 assert.equal(signs.length,0);await screenshot(alice.page,'links-developer-contact-unavailable');
});

test('the contact profile saves on the Node adapter and reloads with its stored values in Spanish',async t=>{
 const s=await server(),bob=await person(t,s);await bob.page.goto(s.origin+'/console?view=security&lang=es');const profile=bob.page.locator('.contact-profile-settings');await profile.locator('form[aria-busy=false]').waitFor();
 await profile.locator('input[name=displayName]').fill('Bob');await profile.locator('input[name=discloseToContacts]').check();await profile.locator('button[type=submit]').click();await bob.page.getByText('Perfil de contacto guardado.').waitFor();
 await bob.page.reload();await profile.locator('form[aria-busy=false]').waitFor();assert.equal(await profile.locator('input[name=displayName]').inputValue(),'Bob');assert.equal(await profile.locator('input[name=discloseToContacts]').isChecked(),true);
 await profile.getByText('Ninguna de tus apps ha creado todavía un enlace de contacto.').waitFor();assert.equal(await bob.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot(bob.page,'links-contact-profile-es');
});
