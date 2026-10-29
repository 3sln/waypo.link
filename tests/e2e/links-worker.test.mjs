import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,baseURL,screenshot,passkeyAccount} from './browser.mjs';

// Real Chromium against the local Worker (wrangler.local.jsonc only): tag labels, the account profile (display name and
// avatar) in Account & security, and a former contact-link URL. Contact links, their public landing, per-link sharing and
// the disclosure switch were removed in contacts phase 4, so the console offers no link management, composer or delivery.
let browser,network=40;
test.before(async()=>{const url=new URL(baseURL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'local Worker required');assert.equal((await (await fetch(`${baseURL}/api/config`)).json()).localDevelopment,true);browser=await launch();});
test.after(async()=>{await browser?.close();});
async function context(t){const value=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'CF-Connecting-IP':`198.51.100.${network++}`}});t.after(()=>value.close());const page=await value.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[],'No browser runtime errors'));await page.route('https://challenges.cloudflare.com/**',route=>route.abort());return {context:value,page};}
// Account creation through the real identity API in the given cookie jar (no UI under test here).
async function signup(request){return (await passkeyAccount(request)).account;}
const owner=(page,path,body,method='GET')=>page.evaluate(async({path,body,method})=>{const session=await (await fetch('/api/session')).json(),response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'X-Bindle-Account':session.account.id,'X-Bindle-Session-Context':session.sessionContext},...method==='GET'?{}:{body:JSON.stringify(body)}});return {status:response.status,body:await response.json()};},{path,body,method});

test('owner labels a tag and saves the profile; the console offers no contact-link management, sharing or composer',async t=>{
 const {context:ownerContext,page}=await context(t);await signup(ownerContext.request);
 await page.goto(baseURL+'/console');await page.locator('.app-shell').waitFor();
 await page.getByRole('button',{name:'Rules',exact:true}).click();await page.locator('.tag-labels-panel').getByRole('button',{name:'New tag',exact:true}).click();
 await page.getByLabel('Label',{exact:true}).fill('Clients');await page.getByRole('button',{name:'Save label',exact:true}).click();await page.locator('.tag-labels-panel').getByText('Clients',{exact:true}).first().waitFor();await screenshot(page,'links-tag-labels');
 const labels=(await owner(page,'/api/tags/labels')).body,clients=Object.keys(labels.labels).find(id=>labels.labels[id]==='Clients');assert.match(clients,/^t\./);
 assert.equal(await page.getByRole('button',{name:'Contact links',exact:true}).count(),0,'no Contact links view');assert.equal(await page.getByRole('button',{name:'Conversations',exact:true}).count(),0,'no Conversations view');
 await page.keyboard.press('g');await page.keyboard.press('c');await page.getByRole('heading',{name:'Organize messages with rules.',exact:true}).waitFor();
 await page.getByRole('button',{name:'Account & security',exact:true}).click();const profile=page.locator('.contact-profile-settings');await profile.locator('form[aria-busy=false]').waitFor();
 assert.deepEqual(await profile.locator('input').evaluateAll(inputs=>inputs.map(input=>input.name)),['displayName','avatar'],'display name and avatar only: no bio or disclosure switch');assert.equal(await profile.locator('.link-sharing').count(),0);
 const saved=page.waitForResponse(response=>response.url().endsWith('/api/profile')&&response.request().method()==='PUT');
 await profile.getByLabel('Display name',{exact:true}).fill('Project desk');await profile.getByRole('button',{name:'Save profile',exact:true}).click();const put=await saved;assert.equal(put.status(),200);
 const sent=put.request().postDataJSON();assert.deepEqual(Object.keys(sent).filter(key=>key!=='expectedRevision').sort(),['avatar','displayName'],'only display name and avatar are sent');await page.getByText('Profile saved.').waitFor();
 const stored=(await owner(page,'/api/profile')).body;assert.equal(stored.displayName,'Project desk');assert.equal('bio' in stored,false);assert.equal('discloseToContacts' in stored,false);
 await page.reload();await page.locator('.contact-profile-settings form[aria-busy=false]').waitFor();assert.equal(await page.locator('.contact-profile-settings input[name=displayName]').inputValue(),'Project desk');assert.doesNotMatch(await profile.textContent(),/contact link/i);
 await page.locator('.developer-contact-panel').waitFor();await screenshot(page,'links-contact-profile');
});

test('a former contact-link URL is not served and enters no contact view; the removed link endpoints are gone',async t=>{
 const {page}=await context(t),signed=[];page.on('request',request=>{if(request.url().includes('/api/links/'))signed.push(request.url());});
 const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),id='44444444-1111-4111-8111-111111111111',path=`/users/nobody/contact/${id}`;
 const meta=`${b64({alg:'ES256',kid:'k1',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:'https://spec.bindle.example/links/contact/v1',iss:baseURL,aud:baseURL+path,sub:crypto.randomUUID(),jti:id,iat:1767225600,exp:1830297600})}.${Buffer.alloc(64,1).toString('base64url')}`;
 // The removed route falls through: either a 404 or the ordinary console shell, which scrubs the capability-shaped query.
 const response=await page.goto(`${baseURL}${path}?bindle_meta=${meta}`);assert.ok([200,404].includes(response.status()),String(response.status()));
 if(response.status()===200){await page.locator('#app').waitFor();await page.waitForFunction(()=>location.search==='');}
 assert.equal(await page.locator('.contact-recipient-heading,.contact-signin,.contact-signed-in,a.contact-intent,textarea').count(),0,'no contact view');assert.doesNotMatch(await page.locator('body').textContent(),/PERSONAL INVITATION|Send a message to|contact link/i);
 const described=await page.request.get(`${baseURL}${path}?bindle_meta=${meta}`,{headers:{Accept:'application/vnd.bindle.contact-profile+json'}});assert.notEqual((described.headers()['content-type']??'').split(';')[0],'application/vnd.bindle.contact-profile+json','no profile representation');
 assert.ok([404,405].includes((await page.request.post(`${baseURL}${path}?bindle_meta=${meta}`,{headers:{Origin:baseURL},data:{}})).status()),'contact links accept no delivery');
 assert.ok([401,404,405].includes((await page.request.post(baseURL+'/api/links/respond',{headers:{Origin:baseURL},data:{}})).status()),'/api/links/respond');assert.equal((await page.request.get(baseURL+'/i/contact')).status(),404,'/i/contact');
 assert.equal(signed.length,0);await screenshot(page,'links-removed-landing');
});
