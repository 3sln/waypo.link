import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launch,baseURL,waitForApp,screenshot,passkeySignup,softWebAuthn} from './browser.mjs';
import {verifyNameAssignment} from '../../packages/recovery/identity-backup.mjs';

test('actual Worker signup freshness and inline step-up preserve identity and public name certificates',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const config=await (await context.request.get(baseURL+'/api/config')).json();
 const post=(path,data)=>context.request.post(baseURL+path,{headers:{Origin:baseURL},data});
 const {pending,authenticator,send}=await passkeySignup(context.request,{body:{termsVersion:config.termsVersion}});await softWebAuthn(context,authenticator);
 assert.match(pending.account.handle,/^n\.[0-9abcdefghjkmnpqrstvwxyz]+$/);
 const file=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();const backup=JSON.parse(file.content);assert.equal(backup.handle,undefined);assert.equal(backup.nameAssignment,undefined);assert.equal(backup.version,3);assert.equal(backup.keychain,undefined);
 const activated=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:file.recoveryToken,downloadConfirmed:true});assert.equal(activated.status(),200);const session=await activated.json();
 const page=await context.newPage();await page.goto(baseURL+'/console');await waitForApp(page);await page.getByRole('button',{name:'Account & security',exact:true}).click();
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download canonical name certificate'}).click();const download=await downloading;
 const cert=JSON.parse(await readFile(await download.path(),'utf8'));const authority=await (await context.request.get(baseURL+'/api/recovery/authority')).json();
 await verifyNameAssignment(cert,authority,{issuer:baseURL,entity:session.account.id,handle:session.account.handle});assert.equal(cert.keychain,undefined);assert.equal(cert.recoveryToken,undefined);
 const claim=async()=>{await page.getByLabel('Custom handle',{exact:true}).fill('123');await page.getByRole('checkbox',{name:'I understand this is my one permanent custom handle.'}).check();await page.getByRole('button',{name:'Claim permanent handle',exact:true}).click();};
 // Signup registered this passkey; claiming reaches the billing gate immediately.
 await claim();await page.getByText('Billing is not enabled.',{exact:true}).waitFor();
 // Recovery also installs a session, but replacement credentials do not make it fresh.
 const recovering=await (await post('/api/auth/recover',{recoveryToken:file.recoveryToken,turnstileToken:'local-browser-test-token'})).json();assert(recovering.pendingToken);
 assert.equal(recovering.credentialRequired,true);const options=await send('/api/auth/passkey/register/begin',{pendingToken:recovering.pendingToken});await send('/api/auth/passkey/register',{pendingToken:recovering.pendingToken,response:await authenticator.register(options.registrationOptions)});
 const replacement=await (await post('/api/auth/recovery/download',{pendingToken:recovering.pendingToken})).json();
 assert.equal((await post('/api/auth/recovery/confirm',{pendingToken:recovering.pendingToken,recoveryToken:replacement.recoveryToken,downloadConfirmed:true})).status(),200);
 await page.reload();await waitForApp(page);await page.getByRole('button',{name:'Account & security',exact:true}).click();await claim();
 await page.getByRole('heading',{name:"Confirm it's you",exact:true}).waitFor();assert.equal((await (await context.request.get(baseURL+'/api/session')).json()).account.paidHandle,null);
 const step=page.waitForResponse(response=>response.url().endsWith('/api/auth/step-up'));
 await page.locator('.step-up').getByRole('button',{name:'Confirm with passkey',exact:true}).click();assert.equal((await step).status(),200);
 await page.getByText('Billing is not enabled.',{exact:true}).waitFor();assert.equal(await page.locator('.step-up').count(),0);
 const logged=await (await context.request.get(baseURL+'/api/session')).json();assert.equal(logged.account.id,session.account.id);assert.equal(logged.account.handle,session.account.handle);assert.equal(logged.account.paidHandle,null);
 await screenshot(page,'identity-names-desktop');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot(page,'identity-names-mobile');
});

test('the browser recovery provider refuses withdrawn (v2 keychain) and foreign payloads before any KDF work, with no authority fetch',async t=>{
 const browser=await launch();t.after(()=>browser.close());const context=await browser.newContext();const page=await context.newPage();await page.goto(baseURL+'/console');
 let authorityFetches=0;await page.route('**/api/recovery/authority',async route=>{authorityFetches++;await route.continue();});
 const result=await page.evaluate(async()=>{
  const {default:RecoveryProvider}=await import('/src/providers/recovery-file.mjs');const provider=await new RecoveryProvider().obtain();
  const NativeWorker=window.Worker;let starts=0;window.Worker=class extends NativeWorker{constructor(...args){super(...args);starts++;}};
  const entity=crypto.randomUUID(),questions=[{id:'phrase',type:'passphrase',prompt:'Private passphrase'}],answers=['Strong private test passphrase'];
  const v2={version:2,issuer:location.origin,entity,recoveryToken:entity+'.'+'x'.repeat(43),warning:'w',keychain:{version:1},proof:{}};
  const foreign={version:3,issuer:'https://other.example',entity,recoveryToken:entity+'.'+'x'.repeat(43),fileId:'AAAAAAAAAAAAAAAAAAAAAA',issuedAt:1};
  const outcome=async payload=>provider.encrypt(payload,questions,structuredClone(answers),location.origin).then(()=>'encrypted',error=>error.code??error.message);
  return {v2:await outcome(v2),foreign:await outcome(foreign),starts};
 });
 assert.equal(result.v2,'recovery_file_invalid');assert.match(result.foreign,/another service/);assert.equal(result.starts,0);assert.equal(authorityFetches,0);
});
