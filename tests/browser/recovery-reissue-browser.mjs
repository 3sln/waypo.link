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
let app,directory,origin;
test.before(async()=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 origin='http://localhost:'+port;directory=await mkdtemp(join(tmpdir(),'3sln-reissue-browser-'));
 app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true'}});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
});
test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});

const post=async(path,input,headers={})=>{const response=await app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}));return {status:response.status,value:await response.json(),cookies:response.headers.getSetCookie()};};
/** An active account (API setup, as the signup suites cover the UI), its first file, and the session cookies. */
async function account({aged=true}={}){
 const pending=await post('/api/auth/signup',{method:'password',password:PASSWORD,ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:CHALLENGE});assert.equal(pending.status,200,pending.value.error);
 const file=await post('/api/auth/recovery/download',{pendingToken:pending.value.pendingToken});assert.equal(file.status,200);
 const active=await post('/api/auth/recovery/confirm',{pendingToken:pending.value.pendingToken,recoveryToken:file.value.recoveryToken,downloadConfirmed:true});assert.equal(active.status,200,active.value.error);
 const id=pending.value.account.id,repository=app.resources.repository;
 if(aged){const record=await repository.get(id);assert.equal(await repository.compareAndSwap(id,record.revision,{...record,passwordSetAt:Date.now()-8*DAY,revision:record.revision+1}),true);}
 const cookies=active.cookies.map(header=>{const [pair]=header.split(';'),index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:origin};});
 return {id,cookies,file:{recoveryToken:file.value.recoveryToken,backup:JSON.parse(file.value.content)},identity:()=>repository.get(id)};
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

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: replace the recovery file end to end; the old file stops working only at confirmation`,async t=>{
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
 await page.getByRole('heading',{name:'Replace your old recovery file.',exact:true}).waitFor();await page.getByText('Your old recovery file stops working now.').waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash,'still unchanged before confirmation');
 await page.getByLabel('I saved my new recovery file in a safe place.').check();await page.getByRole('button',{name:'Replace my recovery file',exact:true}).click();
 await page.getByRole('heading',{name:'Your new recovery file is active.',exact:true}).waitFor();
 const after=await fixture.identity();
 assert.notEqual(after.recoveryHash,before.recoveryHash);assert.equal(after.recoveryStaged,undefined);
 assert.notEqual(recoveryCredential(after).keyKid,fixture.file.backup.keychain.signing.kid,'the signing key rotated (P15)');
 assert.ok(Date.now()-recoveryCredential(after).issuedAt<60000,'P14: the new file starts its 7 days now');
 const old=await post('/api/auth/recover',{recoveryToken:fixture.file.recoveryToken,identityBackup:fixture.file.backup,turnstileToken:CHALLENGE});assert.equal(old.status,401,'the old file no longer recovers');
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('recoveryToken')),false,'no file secret in browser storage');
 await page.getByRole('button',{name:'Back to security',exact:true}).click();await page.getByRole('heading',{name:'Recovery file',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
});

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: a credential under 7 days old is refused before anything is staged or rotated (es, 320 px)`,async t=>{
 const fixture=await account({aged:false}),{browser,page,errors}=await open(browserType,fixture,{locale:'es',width:320});t.after(()=>browser.close());
 const before=await fixture.identity();
 await page.getByRole('heading',{name:'Archivo de recuperación',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal scroll at 320 px');
 await page.getByRole('button',{name:'Reemplazar archivo de recuperación'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Entiendo que mi archivo de recuperación anterior dejará de funcionar.').check();await dialog.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByLabel('Contraseña',{exact:true}).fill(PASSWORD);await page.getByRole('button',{name:/contraseña/i}).first().click();
 await page.getByText(/at least 7 days|al menos 7 días/).first().waitFor();
 assert.equal((await fixture.identity()).recoveryHash,before.recoveryHash);assert.equal((await fixture.identity()).recoveryStaged,undefined,'nothing staged, nothing rotated');
 assert.deepEqual(errors,[]);
});
