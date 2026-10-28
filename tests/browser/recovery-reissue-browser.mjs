// Active-account recovery reissue in real Chromium and Firefox against the real Node runtime: real routes, the shipped
// console bundle, on-device encryption and test-unlock, the step-up prompt and a real file download. The only
// out-of-band step is making the password look 8 days old in the identity record, which a browser test cannot wait for.
// Run `npm run build:assets` first.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,firefox} from 'playwright';
import {createNodeServer} from '../../apps/node/server.mjs';
import {recoveryCredential} from '../../packages/identity/service.mjs';

const PASSWORD='Browser reissue test password 2026!',ANSWER='Private reissue passphrase 2026!',CHALLENGE='local-browser-test-token',DAY=86400000;
let app,directory,origin,signups=0;const mail=[];
test.before(async()=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 origin='http://localhost:'+port;directory=await mkdtemp(join(tmpdir(),'3sln-reissue-browser-'));
 app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true',SIGNUP_REGION_HOURLY_LIMIT:'20'},mailer:{sendSecurityAlert:async value=>{mail.push(value);}}});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
});
test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});

const post=async(path,input,headers={})=>{const response=await app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}));return {status:response.status,value:await response.json(),cookies:response.headers.getSetCookie()};};
/** An active account (API setup, as the signup suites cover the UI), its first file, and the session cookies. */
async function account({aged=true}={}){
 // Each fixture signs up from its own address: the per-network signup windows would otherwise refuse the later ones.
 const pending=await post('/api/auth/signup',{method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:CHALLENGE},{'CF-Connecting-IP':`198.51.100.${++signups}`});assert.equal(pending.status,200,pending.value.error);
 const file=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});assert.equal(file.status,200);
 const active=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:file.value.recoveryToken,downloadConfirmed:true});assert.equal(active.status,200,active.value.error);
 const id=pending.value.account.id,repository=app.resources.repository;
 if(aged){const record=await repository.get(id);assert.equal(await repository.compareAndSwap(id,record.revision,{...record,passwordSetAt:Date.now()-8*DAY,revision:record.revision+1}),true);}
 const cookies=active.cookies.map(header=>{const [pair]=header.split(';'),index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:origin};});
 return {id,cookies,csrfToken:active.value.csrfToken,file:{recoveryToken:file.value.recoveryToken,backup:JSON.parse(file.value.content)},identity:()=>repository.get(id),patch:async mutate=>{for(let attempt=0;attempt<5;attempt++){const record=await repository.get(id);if(await repository.compareAndSwap(id,record.revision,{...mutate(record),revision:record.revision+1}))return;}assert.fail('patch lost every race');}};
}
async function open(browserType,fixture,{locale='en',width=1280}={}){
 const browser=await browserType.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,locale,viewport:{width,height:1000}});
 await context.addCookies(fixture.cookies);const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/console?lang='+locale);
 // Narrow layouts tuck the navigation behind a menu button.
 const nav=page.getByRole('button',{name:locale==='es'?'Cuenta y seguridad':'Account & security'}).or(page.getByRole('link',{name:locale==='es'?'Cuenta y seguridad':'Account & security'})).first();
 if(!await nav.isVisible().catch(()=>false))await page.getByRole('button',{name:/menu|menú/i}).first().click().catch(()=>{});
 await nav.click();
 return {browser,context,page,errors};
}

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: replace the recovery file end to end; confirmation opens the 7-day window, which this earlier device can cancel`,async t=>{
 const fixture=await account(),{browser,page,errors}=await open(browserType,fixture);t.after(()=>browser.close());
 const before=await fixture.identity();
 await page.getByRole('heading',{name:'Recovery file',exact:true}).waitFor();
 await page.getByRole('button',{name:'Replace recovery file'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByText('Your old recovery file stops working').waitFor();
 await dialog.getByText('A pending move of your identity to another provider will be cancelled.').waitFor();
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await dialog.getByText('Confirm that your current recovery file will stop working.').waitFor();
 await dialog.getByLabel('I understand my old recovery file will stop working.').check();await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 // The step-up prompt (no step-up yet), then the server stages the file.
 await page.getByRole('heading',{name:"Confirm it's you"}).waitFor();await page.getByLabel('Password',{exact:true}).fill(PASSWORD);await page.getByRole('button',{name:'Confirm with password'}).click();
 await page.getByRole('heading',{name:'Keep a way back in.',exact:true}).waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'staging leaves the current file working');
 await page.getByLabel('What is my private recovery passphrase?',{exact:true}).fill(ANSWER);await page.getByRole('button',{name:'Encrypt recovery file',exact:true}).click();
 await page.getByRole('heading',{name:'Save your new recovery file.',exact:true}).waitFor();
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download new recovery file',exact:true}).click();const download=await downloading;
 const saved=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(saved.format,'3sln-recovery');assert.equal(JSON.stringify(saved).includes(ANSWER),false,'answers never reach the file');
 await page.getByRole('heading',{name:'Test your new recovery file.',exact:true}).waitFor();
 await page.getByLabel('What is my private recovery passphrase?',{exact:true}).fill(ANSWER);await page.getByRole('button',{name:'Test unlock',exact:true}).click();
 await page.getByRole('heading',{name:'Replace your old recovery file.',exact:true}).waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'still unchanged before confirmation');
 await page.getByLabel('I saved my new recovery file in a safe place.').check();await page.getByRole('button',{name:'Replace my recovery file',exact:true}).click();
 await page.getByRole('heading',{name:'Your new recovery file is active.',exact:true}).waitFor();
 const after=await fixture.identity();
 assert.notEqual(after.recoveryHash,before.recoveryHash);assert.equal(after.recoveryStaged,undefined);
 assert.notEqual(recoveryCredential(after).keyKid,fixture.file.backup.keychain.signing.kid,'the signing key rotated (P15)');
 assert.ok(Date.now()-recoveryCredential(after).issuedAt<60000,'P14: the new file starts its 7 days now');
 // Wargame 2026-10-23 #1: during the window the old file can only cancel and the new one cannot recover yet.
 const old=await post('/api/auth/recover',{recoveryToken:fixture.file.recoveryToken,identityBackup:fixture.file.backup,turnstileToken:CHALLENGE});assert.equal(old.status,409);assert.equal(old.value.error,'recovery_reissue_pending');
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('recoveryToken')),false,'no file secret in browser storage');
 await page.getByRole('button',{name:'Back to security',exact:true}).click();await page.getByRole('heading',{name:'Recovery file',exact:true}).waitFor();
 // The console shows the window; this device was signed in before the replacement began, so it can cancel.
 await page.getByText('Your recovery file was replaced recently.').waitFor();
 assert.equal(await page.getByRole('button',{name:'Replace recovery file'}).count(),0,'no second replacement during the window');
 await page.getByRole('button',{name:'Cancel the replacement',exact:true}).click();
 // This device also staged and confirmed the replacement, and a cancel ends those sessions (DEVLOG 2026-10-23
 // "Cancel sessions"), so the console signs out with the outcome rather than reporting an expired session.
 await page.getByText('Replacement cancelled. Your previous recovery file works again and the new one never will. This device made the replacement, so it was signed out. Sign in again.').waitFor();
 await page.getByRole('heading',{name:'Accounts in this browser'}).waitFor();
 assert.equal(await page.getByText('Your session expired. Sign in again.').count(),0);
 const record=await fixture.identity();
 assert.equal(record.recoveryHash,before.recoveryHash,'the previous credential is current again');assert.equal(record.recoveryPrevious,undefined);
 assert.deepEqual(errors,[]);
});

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: the emailed cancel link removes its token from the address bar and cancels only on an explicit press, without signing in`,async t=>{
 const fixture=await account();await fixture.patch(record=>({...record,verifiedEmail:`owner-${fixture.id.slice(0,8)}@reissue.example`,emailVerifiedAt:Date.now()-30*DAY}));
 const before=await fixture.identity(),cookie=fixture.cookies.map(entry=>`${entry.name}=${entry.value}`).join('; '),headers={Cookie:cookie,'X-CSRF-Token':fixture.csrfToken,'X-Bindle-Account':fixture.id};
 assert.equal((await post('/api/auth/step-up',{method:'password',password:PASSWORD},headers)).status,200);
 const begun=await post('/api/auth/recovery/reissue/begin',{acknowledged:true},headers);assert.equal(begun.status,200,begun.value.error);
 assert.equal((await post('/api/auth/recovery/reissue/confirm',{recoveryToken:begun.value.recoveryToken,downloadConfirmed:true},headers)).status,200);
 const token=mail.filter(entry=>entry.owner===fixture.id&&entry.type==='recovery-reissued').at(-1)?.cancelToken;assert.ok(token,'the earlier email received a cancel link');
 const browser=await browserType.launch({headless:true});t.after(()=>browser.close());const page=await (await browser.newContext()).newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/account/recovery/cancel#token='+token);
 await page.getByRole('heading',{name:'Cancel recovery file replacement'}).waitFor();
 assert.equal(new URL(page.url()).hash,'','the capability left the address bar');
 assert.notEqual((await fixture.identity()).recoveryHash,before.recoveryHash,'opening the page changed nothing');
 await page.getByRole('button',{name:'Cancel replacement'}).click();
 await page.getByText(/Replacement cancelled/).waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash);
 assert.equal((await page.context().cookies()).length,0,'no session was created');
 assert.deepEqual(errors,[]);
});

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: a credential under 7 days old is refused before anything is staged or rotated (es, 320 px)`,async t=>{
 const fixture=await account({aged:false}),{browser,page,errors}=await open(browserType,fixture,{locale:'es',width:320});t.after(()=>browser.close());
 const before=await fixture.identity();
 await page.getByRole('heading',{name:'Archivo de recuperación',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll at 320 px');
 // The console shows when replacement becomes possible and disables the action (display metadata,
 // packages/runtime/recovery-eligibility.mjs); the server still refuses a direct request.
 await page.getByText(/Puedes reemplazar tu archivo de recuperación a partir del/).waitFor();
 assert.equal(await page.getByRole('button',{name:'Reemplazar archivo de recuperación'}).isDisabled(),true);
 const headers={Cookie:fixture.cookies.map(entry=>`${entry.name}=${entry.value}`).join('; '),'X-CSRF-Token':fixture.csrfToken,'X-Bindle-Account':fixture.id};
 assert.equal((await post('/api/auth/step-up',{method:'password',password:PASSWORD},headers)).status,200);
 const refused=await post('/api/auth/recovery/reissue/begin',{acknowledged:true},headers);assert.equal(refused.value.error,'credential_too_new');
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash);assert.equal((await fixture.identity()).recoveryStaged,undefined,'nothing staged, nothing rotated');
 assert.deepEqual(errors,[]);
});
