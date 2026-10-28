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
// Developer contact mints principal-bound invitations (contacts spike CR-C5; provisional): GET is an eligibility read and
// POST asks the developer identity's Parlay, through the host mint hook DEVELOPER_CONTACT_MINT, for a single-use
// invitation bound to the requesting user. No adapter carries that request to Parlay yet, so without the hook the
// service answers developer-unavailable; with a loopback test double the eligible hand-off runs end to end.
const password='Private conditional browser password 2026!',secret=Buffer.alloc(32,61).toString('base64url');
let browser;const servers=[];
test.before(async()=>{browser=await launch();});
test.after(async()=>{await browser?.close();for(const s of servers){await s.app.close();await rm(s.directory,{recursive:true,force:true});}});
async function server(config={}){
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const origin='http://localhost:'+port,directory=await mkdtemp(join(tmpdir(),'3sln-links-browser-')),mailbox=[];
 const app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true',SYSTEM_BOOTSTRAP_KEY:secret,DEVELOPER_CONTACT_HANDLE:'ray',...config},mailer:{async sendSetupCode(value){mailbox.push(value);}}});
 await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));const entry={app,directory,origin,mailbox};servers.push(entry);
 // Operator bootstrap of the protected `ray` developer identity through the real public API; developer contact is off
 // unless DEVELOPER_CONTACT_HANDLE names it (no built-in default since the 2026-10-27 cleanup).
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

test('developer contact without a mint hook is shown as unavailable in Account & security and mints nothing',async t=>{
 const s=await server(),alice=await person(t,s),posts=[];alice.page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(developer-contact|links\/(respond|envelope))$/.test(request.url()))posts.push(request.url());});
 const developer=await developerLink(alice.page,s);assert.deepEqual(developer,{available:false,reason:'developer-unavailable'});
 await alice.page.getByRole('button',{name:'Account & security',exact:true}).click();const panel=alice.page.locator('.developer-contact-panel');
 await panel.getByText('The platform developer account is not ready to receive messages.').waitFor();assert.equal(await panel.getByRole('button',{name:'Message the developer',exact:true}).count(),0);
 await panel.getByRole('button',{name:'Check eligibility again',exact:true}).click();await panel.getByText('The platform developer account is not ready to receive messages.').waitFor();assert.equal(await alice.page.locator('[role=alert]').count(),0);
 assert.equal(posts.length,0);await screenshot(alice.page,'links-developer-contact-unavailable');
});

test('Message the developer mints a bound invitation through the host hook and hands off its connect intent',async t=>{
 const mints=[];let token;
 const s=await server({DEVELOPER_CONTACT_MINT:async input=>{mints.push(structuredClone(input));token=Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');return {inviter:{iss:s.origin,sub:input.developer.id},token,delegation:'eyJhbGciOiJFUzI1NiJ9.e30.'+'A'.repeat(86),expires_at:Math.floor((Date.now()+input.expiresIn)/1000)};}});
 const alice=await person(t,s),eligibility=await developerLink(alice.page,s);assert.equal(eligibility.available,true);assert.deepEqual(eligibility.eligibility,{state:'eligible',tier:'free'});assert.equal(mints.length,0,'the eligibility read mints nothing');
 await alice.page.getByRole('button',{name:'Account & security',exact:true}).click();const panel=alice.page.locator('.developer-contact-panel');
 const button=panel.getByRole('button',{name:'Message the developer',exact:true});await button.waitFor();
 const minted=alice.page.waitForResponse(response=>response.url().endsWith('/api/developer-contact')&&response.request().method()==='POST');await button.focus();await alice.page.keyboard.press('Enter');const response=await minted;
 assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');const body=await response.json();assert.equal(body.intent.url,'web+bindle://intent?bintent='+body.intent.value);assert.equal('route' in body.intent,false,'no provider route while intent links are off');
 assert.deepEqual(mints,[{developer:{id:mints[0].developer.id,handle:mints[0].developer.handle},principal:{issuer:s.origin,subject:alice.account.id},tier:'free',expiresIn:3600000}]);
 await panel.getByText(/Your invitation works once and is valid until/).waitFor();await panel.getByRole('button',{name:'Copy invitation link',exact:true}).waitFor();
 // The token is a bearer capability: never in the console's persisted state or the page markup.
 assert.equal((await alice.page.content()).includes(token),false);assert.equal((await alice.page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage}))).includes(token),false);
 for(const [name,width]of [['links-developer-contact-invited',1440],['links-developer-contact-invited-390',390],['links-developer-contact-invited-320',320]]){await alice.page.setViewportSize({width,height:900});assert.equal(await alice.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot(alice.page,name);}
});

test('with intent links on, Message the developer opens the minted connect intent in this provider\'s /i router',async t=>{
 let token;
 const s=await server({ARTEFACT_VERSIONS_ENABLED:'true',INTENT_LINKS_ENABLED:'true',DEVELOPER_CONTACT_MINT:async input=>{token=Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');return {inviter:{iss:s.origin,sub:input.developer.id},token,delegation:'eyJhbGciOiJFUzI1NiJ9.e30.'+'A'.repeat(86),expires_at:Math.floor((Date.now()+input.expiresIn)/1000)};}});
 const alice=await person(t,s);await developerLink(alice.page,s);
 await alice.page.getByRole('button',{name:'Account & security',exact:true}).click();const panel=alice.page.locator('.developer-contact-panel');
 const button=panel.getByRole('button',{name:'Message the developer',exact:true});await button.waitFor();
 const navigations=[];alice.page.on('framenavigated',frame=>{if(frame===alice.page.mainFrame())navigations.push(frame.url());});
 // The answer is read in transit: the page navigates away as soon as it has checked it.
 let body;await alice.page.route('**/api/developer-contact',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();body=await response.json();return route.fulfill({response,json:body});});
 const arrived=alice.page.waitForURL(url=>url.pathname==='/i');await button.click();await arrived;
 assert.equal(body.intent.route,s.origin+'/i#bintent='+body.intent.value,'the route is exactly this origin\'s /i fragment for the minted value');
 assert.ok(navigations.some(url=>url===body.intent.route),navigations.join(' '));
 // The intent page scrubs the capability from the address bar before rendering.
 await alice.page.waitForFunction(()=>location.hash==='');assert.equal((await alice.page.content()).includes(token),false);
});

test('the profile saves display name only on the Node adapter and reloads with its stored values in Spanish',async t=>{
 const s=await server(),bob=await person(t,s);await bob.page.goto(s.origin+'/console?view=security&lang=es');const profile=bob.page.locator('.contact-profile-settings');await profile.locator('form[aria-busy=false]').waitFor();
 assert.deepEqual(await profile.locator('input').evaluateAll(inputs=>inputs.map(input=>input.name)),['displayName','avatar']);
 const saved=bob.page.waitForResponse(response=>response.url().endsWith('/api/profile')&&response.request().method()==='PUT');
 await profile.locator('input[name=displayName]').fill('Bob');await profile.locator('button[type=submit]').click();const put=await saved;assert.equal(put.status(),200);assert.deepEqual(Object.keys(put.request().postDataJSON()).filter(key=>key!=='expectedRevision').sort(),['avatar','displayName']);
 await bob.page.reload();await profile.locator('form[aria-busy=false]').waitFor();assert.equal(await profile.locator('input[name=displayName]').inputValue(),'Bob');
 assert.equal(await bob.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot(bob.page,'links-profile-es');
});
