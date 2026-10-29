// Active-account recovery reissue in real Chromium and Firefox against the real Node runtime: real routes, the shipped
// console bundle, on-device encryption and test-unlock, the step-up prompt, a real file download and the re-upload
// acknowledgement (recovery file v3: the saved file is selected again and compared by hash, never decrypted). The only
// out-of-band step is making the passkey look 8 days old in the identity record, which a browser test cannot wait for.
// Passwords were dropped (owner approval 2026-10-28): accounts sign up with a soft passkey (tests/helpers/soft-passkey.mjs)
// and the browsers' WebAuthn calls reach the same authenticator (softWebAuthn, tests/e2e/browser.mjs).
// Run `npm run build:assets` first.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,firefox} from 'playwright';
import {createNodeServer} from '../../apps/node/server.mjs';
import {recoveryCredential} from '../../packages/identity/service.mjs';
import {catalogues} from '../../packages/i18n/catalogues.mjs';
import {softAuthenticator,signupBody,registerPending,passkeyStepUp} from '../helpers/soft-passkey.mjs';
import {softWebAuthn} from '../e2e/browser.mjs';

const ANSWER='Private reissue passphrase 2026!',CHALLENGE='local-browser-test-token',DAY=86400000;
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
 const authenticator=softAuthenticator({origin}),address={'CF-Connecting-IP':`198.51.100.${++signups}`},send=async(path,input)=>{const result=await post(path,input,address);assert.equal(result.status,200,`${path}: ${result.value.error}`);return result.value;};
 const pending=await post('/api/auth/signup',signupBody({ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:CHALLENGE}),address);assert.equal(pending.status,200,pending.value.error);
 assert.equal((await registerPending(authenticator,send,pending.value)).readyForRecovery,true);
 const file=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});assert.equal(file.status,200);
 const active=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:file.value.recoveryToken,downloadConfirmed:true});assert.equal(active.status,200,active.value.error);
 const id=pending.value.account.id,repository=app.resources.repository;
 if(aged){const record=await repository.get(id);assert.equal(await repository.compareAndSwap(id,record.revision,{...record,credentials:record.credentials.map(credential=>({...credential,createdAt:Date.now()-8*DAY})),revision:record.revision+1}),true);}
 const cookies=active.cookies.map(header=>{const [pair]=header.split(';'),index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:origin};});

 const stepUp=headers=>passkeyStepUp(authenticator,async(path,input)=>{const result=await post(path,input,headers);assert.equal(result.status,200,`${path}: ${result.value.error}`);return result.value;});
 return {id,authenticator,stepUp,cookies,csrfToken:active.value.csrfToken,file:{recoveryToken:file.value.recoveryToken,fileId:file.value.fileId},identity:()=>repository.get(id),patch:async mutate=>{for(let attempt=0;attempt<5;attempt++){const record=await repository.get(id);if(await repository.compareAndSwap(id,record.revision,{...mutate(record),revision:record.revision+1}))return;}assert.fail('patch lost every race');}};
}
async function open(browserType,fixture,{locale='en',width=1280}={}){
 const browser=await browserType.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,locale,viewport:{width,height:1000}});
 await context.addCookies(fixture.cookies);await softWebAuthn(context,fixture.authenticator);const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/console?lang='+locale);
 // Narrow layouts tuck the navigation behind a menu button.
 const nav=page.getByRole('button',{name:locale==='es'?'Cuenta y seguridad':'Account & security'}).or(page.getByRole('link',{name:locale==='es'?'Cuenta y seguridad':'Account & security'})).first();
 if(!await nav.isVisible().catch(()=>false))await page.getByRole('button',{name:/menu|menú/i}).first().click().catch(()=>{});
 await nav.click();
 return {browser,context,page,errors};
}

for(const [name,browserType,locale]of [['chromium',chromium,'en'],['firefox',firefox,'en'],['chromium',chromium,'es']])test(`${name} (${locale}): replace the recovery file end to end; the saved file must be selected again; confirmation opens the 7-day window, which this earlier device can cancel`,async t=>{
 // Source strings are the catalogue keys; the Spanish run reads the shipped translations.
 const L=key=>{const value=catalogues[locale]['']?.[key];assert.ok(value||locale==='en',`missing ${locale} string: ${key}`);return value??key;};
 const fixture=await account(),{browser,page,errors}=await open(browserType,fixture,{locale});t.after(()=>browser.close());
 const before=await fixture.identity();
 await page.getByRole('heading',{name:L('Recovery file'),exact:true}).waitFor();
 await page.getByRole('button',{name:L('Replace recovery file')}).click();
 const dialog=page.getByRole('dialog');await dialog.getByText(L('Your old recovery file stops working')).waitFor();
 await dialog.getByText(L('A pending move of your identity to another provider will be cancelled.')).waitFor();
 await dialog.getByRole('button',{name:L('Continue'),exact:true}).click();
 await dialog.getByText(L('Confirm that your current recovery file will stop working.')).waitFor();
 await dialog.getByLabel(L('I understand my old recovery file will stop working.')).check();await dialog.getByRole('button',{name:L('Continue'),exact:true}).click();
 // The step-up prompt (no step-up yet), then the server stages the file.
 await page.getByRole('heading',{name:L("Confirm it's you")}).waitFor();assert.equal(await page.locator('.step-up input[name=password]').count(),0,'passkey only');await page.getByRole('button',{name:L('Confirm with passkey')}).click();
 await page.getByRole('heading',{name:L('Keep a way back in.'),exact:true}).waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'staging leaves the current file working');
 await page.getByLabel(L('What is my private recovery passphrase?'),{exact:true}).fill(ANSWER);await page.getByRole('button',{name:L('Encrypt recovery file'),exact:true}).click();
 await page.getByRole('heading',{name:L('Save your new recovery file.'),exact:true}).waitFor();
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:L('Download new recovery file'),exact:true}).click();const download=await downloading;
 const saved=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(saved.format,'3sln-recovery');assert.equal(JSON.stringify(saved).includes(ANSWER),false,'answers never reach the file');
 await page.getByRole('heading',{name:L('Test your new recovery file.'),exact:true}).waitFor();
 await page.getByLabel(L('What is my private recovery passphrase?'),{exact:true}).fill(ANSWER);await page.getByRole('button',{name:L('Test unlock'),exact:true}).click();
 // The acknowledgement: select the saved file again. Another file (here: the same JSON re-serialized) is refused.
 await page.getByRole('heading',{name:L('Select the file you saved.'),exact:true}).waitFor();
 const other=join(directory,`other-${locale}-${name}.json`);await writeFile(other,JSON.stringify(saved));
 await page.locator('input[type=file][name=file]').setInputFiles(other);await page.getByRole('button',{name:L('Check the saved file'),exact:true}).click();
 await page.getByText(L('This is not the file you just downloaded. Choose the new recovery file you saved on this device.')).first().waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'a refused acknowledgement changes nothing');
 await page.locator('input[type=file][name=file]').setInputFiles(await download.path());await page.getByRole('button',{name:L('Check the saved file'),exact:true}).click();
 await page.getByRole('heading',{name:L('Replace your old recovery file.'),exact:true}).waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'still unchanged before confirmation');
 await page.getByLabel(L('I saved my new recovery file in a safe place.')).check();await page.getByRole('button',{name:L('Replace my recovery file'),exact:true}).click();
 await page.getByRole('heading',{name:L('Your new recovery file is active.'),exact:true}).waitFor();
 const after=await fixture.identity();
 assert.notEqual(after.recoveryHash,before.recoveryHash);assert.equal(after.recoveryStaged,undefined);
 assert.equal(recoveryCredential(after).fileId,saved.fileId,'the confirmed file is the one saved and selected again');assert.equal(after.recoveryKeyKid,undefined);
 assert.equal(JSON.stringify(saved).includes('keychain'),false);
 assert.ok(Date.now()-recoveryCredential(after).issuedAt<60000,'P14: the new file starts its 7 days now');
 // Wargame 2026-10-23 #1: during the window the old file cannot recover. The fixture's passkey predates the old file,
 // so this passkey-confirmed reissue is file-proof (service.mjs fileProofReissue) and the old file is locked out entirely.
 const old=await post('/api/auth/recover',{recoveryToken:fixture.file.recoveryToken,turnstileToken:CHALLENGE});assert.equal(old.status,409);assert.equal(old.value.error,'recovery_reissue_locked');
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('recoveryToken')),false,'no file secret in browser storage');
 await page.getByRole('button',{name:L('Back to security'),exact:true}).click();await page.getByRole('heading',{name:L('Recovery file'),exact:true}).waitFor();
 // The console shows the window; this device was signed in before the replacement began, so it can cancel.
 await page.getByText(L('Your recovery file was replaced recently.')).waitFor();
 assert.equal(await page.getByRole('button',{name:L('Replace recovery file')}).count(),0,'no second replacement during the window');
 await page.getByRole('button',{name:L('Cancel the replacement'),exact:true}).click();
 // The button only opens a warning: nothing is cancelled until it is confirmed, and dismissing changes nothing.
 const warning=page.getByRole('dialog');await warning.locator('.recovery-reissue-warnings li').nth(1).waitFor();
 await warning.getByRole('button',{name:L('Keep waiting'),exact:true}).click();await warning.waitFor({state:'detached'});
 assert.ok((await fixture.identity()).recoveryPrevious,'dismissing the warning cancels nothing');
 await page.getByRole('button',{name:L('Cancel the replacement'),exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:L('Cancel the replacement'),exact:true}).click();
 // This device also staged and confirmed the replacement, and a cancel ends those sessions (DEVLOG 2026-10-23
 // "Cancel sessions"), so the console signs out with the outcome rather than reporting an expired session.
 await page.getByText(L('Replacement cancelled. Your previous recovery file works again and the new one never will. This device made the replacement, so it was signed out. Sign in again.')).waitFor();
 await page.getByRole('heading',{name:L('Accounts in this browser')}).waitFor();
 assert.equal(await page.getByText(locale==='es'?/sesión (caducó|expiró)/i:'Your session expired. Sign in again.').count(),0);
 const record=await fixture.identity();
 assert.equal(record.recoveryHash,before.recoveryHash,'the previous credential is current again');assert.equal(record.recoveryPrevious,undefined);
 assert.deepEqual(errors,[]);
});

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: the emailed cancel link removes its token from the address bar and cancels only on an explicit press, without signing in`,async t=>{
 const fixture=await account();await fixture.patch(record=>({...record,verifiedEmail:`owner-${fixture.id.slice(0,8)}@reissue.example`,emailVerifiedAt:Date.now()-30*DAY}));
 const before=await fixture.identity(),cookie=fixture.cookies.map(entry=>`${entry.name}=${entry.value}`).join('; '),headers={Cookie:cookie,'X-CSRF-Token':fixture.csrfToken,'X-Bindle-Account':fixture.id};
 await fixture.stepUp(headers);
 const begun=await post('/api/auth/recovery/reissue/begin',{acknowledged:true},headers);assert.equal(begun.status,200,begun.value.error);
 assert.equal((await post('/api/auth/recovery/reissue/confirm',{recoveryToken:begun.value.recoveryToken,fileId:begun.value.fileId,downloadConfirmed:true},headers)).status,200);
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
 await fixture.stepUp(headers);
 const refused=await post('/api/auth/recovery/reissue/begin',{acknowledged:true},headers);assert.equal(refused.value.error,'credential_too_new');
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash);assert.equal((await fixture.identity()).recoveryStaged,undefined,'nothing staged, nothing rotated');
 assert.deepEqual(errors,[]);
});
