import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,baseURL,screenshot} from './browser.mjs';

// Real Chromium against the local Worker (wrangler.local.jsonc only): tag labels, the contact profile in Account &
// security, and the public landing of a contact link the service cannot verify. Contact links are issued by the owner's
// apps since messaging left the core (2026-10-27), so the console offers no link management, composer or delivery.
const password='Private links browser password 2026!';
let browser,network=40;
test.before(async()=>{const url=new URL(baseURL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'local Worker required');assert.equal((await (await fetch(`${baseURL}/api/config`)).json()).localDevelopment,true);browser=await launch();});
test.after(async()=>{await browser?.close();});
async function context(t){const value=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${network++}`}});t.after(()=>value.close());const page=await value.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[],'No browser runtime errors'));await page.route('https://challenges.cloudflare.com/**',route=>route.abort());return {context:value,page};}
// Account creation through the real identity API in the given cookie jar (no UI under test here).
async function signup(request){const post=(path,data)=>request.post(baseURL+path,{headers:{Origin:baseURL},data});const start=await post('/api/auth/signup',{method:'password',password,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'});assert.equal(start.status(),200,await start.text());const pending=await start.json(),recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json(),active=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true});assert.equal(active.status(),200,await active.text());return (await active.json()).account;}
const owner=(page,path,body,method='GET')=>page.evaluate(async({path,body,method})=>{const session=await (await fetch('/api/session')).json(),response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'X-Bindle-Account':session.account.id,'X-Bindle-Session-Context':session.sessionContext},...method==='GET'?{}:{body:JSON.stringify(body)}});return {status:response.status,body:await response.json()};},{path,body,method});

test('owner labels a tag and saves the contact profile; the console offers no contact-link management or composer',async t=>{
 const {context:ownerContext,page}=await context(t);await signup(ownerContext.request);
 await page.goto(baseURL+'/console');await page.locator('.app-shell').waitFor();
 await page.getByRole('button',{name:'Rules',exact:true}).click();await page.locator('.tag-labels-panel').getByRole('button',{name:'New tag',exact:true}).click();
 await page.getByLabel('Label',{exact:true}).fill('Clients');await page.getByRole('button',{name:'Save label',exact:true}).click();await page.locator('.tag-labels-panel').getByText('Clients',{exact:true}).first().waitFor();await screenshot(page,'links-tag-labels');
 const labels=(await owner(page,'/api/tags/labels')).body,clients=Object.keys(labels.labels).find(id=>labels.labels[id]==='Clients');assert.match(clients,/^t\./);
 assert.equal(await page.getByRole('button',{name:'Contact links',exact:true}).count(),0,'no Contact links view');assert.equal(await page.getByRole('button',{name:'Conversations',exact:true}).count(),0,'no Conversations view');
 await page.keyboard.press('g');await page.keyboard.press('c');await page.getByRole('heading',{name:'Organize messages with rules.',exact:true}).waitFor();
 await page.getByRole('button',{name:'Account & security',exact:true}).click();const profile=page.locator('.contact-profile-settings');await profile.locator('form[aria-busy=false]').waitFor();
 await profile.getByLabel('Display name',{exact:true}).fill('Project desk');await profile.getByLabel('About you',{exact:true}).fill('Replies within a week');await profile.getByRole('button',{name:'Save contact profile',exact:true}).click();await page.getByText('Contact profile saved.').waitFor();
 const stored=(await owner(page,'/api/profile')).body;assert.equal(stored.displayName,'Project desk');assert.equal(stored.bio,'Replies within a week');assert.equal(stored.discloseToContacts,false,'sharing stays off unless switched on');
 await page.reload();await page.locator('.contact-profile-settings form[aria-busy=false]').waitFor();assert.equal(await page.locator('.contact-profile-settings input[name=displayName]').inputValue(),'Project desk');assert.match(await profile.textContent(),/None of your apps has created a contact link yet\./);
 await page.locator('.developer-contact-panel').waitFor();await screenshot(page,'links-contact-profile');
});

test('a contact link the service cannot verify lands on a final refusal with no composer, hand-off or signing',async t=>{
 const {page}=await context(t),signed=[];page.on('request',request=>{if(request.url().includes('/api/links/'))signed.push(request.url());});
 const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),id='44444444-1111-4111-8111-111111111111',path=`/users/nobody/contact/${id}`;
 const meta=`${b64({alg:'ES256',kid:'k1',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:'https://spec.bindle.example/links/contact/v1',iss:baseURL,aud:baseURL+path,sub:crypto.randomUUID(),jti:id,iat:1767225600,exp:1830297600})}.${Buffer.alloc(64,1).toString('base64url')}`;
 const response=await page.goto(`${baseURL}${path}?bindle_meta=${meta}`);assert.equal(response.status(),404,'an unverified link is not described');
 await page.getByText('This contact link is expired, revoked, or invalid.').first().waitFor();assert.equal(new URL(page.url()).search,'','the capability left the address bar');
 assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.locator('a.contact-intent').count(),0);assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0);assert.equal(signed.length,0);
 assert.equal((await page.request.post(`${baseURL}${path}?bindle_meta=${meta}`,{headers:{Origin:baseURL},data:{}})).status(),405,'contact links accept no delivery');
 await screenshot(page,'links-unverified-landing');
});
