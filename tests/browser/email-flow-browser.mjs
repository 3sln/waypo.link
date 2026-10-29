// "Continue with email" in real Chromium and Firefox against the real Node runtime (sign-in and intents spike §4, P3,
// EMAIL_FLOW_V2 and EMAIL_SIGNUP_ENABLED on in this server only): the shipped console (original tab R) and the helper
// page H, real routes, the HttpOnly browser marker, BroadcastChannel and polling.
//   - same-browser fast path: R and H in one browser context; H's armed "Yes" approves, the tagged wake-up reaches R, R
//     redeems with its secret and signs in; the queue shows the passkey suggestion; H says it is done (or closes);
//   - copy-code fallback: R and H in two browser contexts (the phone has no marker); H reveals a code after the
//     warning, the person types it into R;
//   - the closed original tab: H offers "sign in here instead", which signs H's tab in;
//   - email sign-up from R reaches the recovery-file step with no passkey step.
// Mail goes to a capturing test double (nothing is sent). Run `npm run build:assets` first.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,firefox} from 'playwright';
import {createNodeServer} from '../../apps/node/server.mjs';
import {catalogues} from '../../packages/i18n/catalogues.mjs';
import {createFlowSecret} from '../../apps/web/src/shared/email-flow.mjs';

const CHALLENGE='local-browser-test-token';
let app,directory,origin,accounts=0;const mail=[];
test.before(async()=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 origin='http://localhost:'+port;directory=await mkdtemp(join(tmpdir(),'3sln-email-flow-browser-'));
 app=await createNodeServer({directory,config:{APP_ORIGIN:origin,BRAND_NAME:'3sln.me',SIGNUP_ENABLED:'true',EMAIL_FLOW_V2:'true',EMAIL_SIGNUP_ENABLED:'true',SIGNUP_IP_WINDOW_MS:'1000',SIGNUP_IP_DAILY_LIMIT:'50',SIGNUP_SUBNET_DAILY_LIMIT:'50',SIGNUP_REGION_HOURLY_LIMIT:'50'},mailer:{sendEmailFlow:async value=>{mail.push(value);},sendVerification:async()=>{},sendSecurityAlert:async()=>{}}});
 await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
});
test.after(async()=>{await app?.close();if(directory)await rm(directory,{recursive:true,force:true});});

const post=async(path,input,ip)=>{const response=await app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify(input)}));return {status:response.status,value:await response.json()};};
const waitMail=async(predicate,timeout=10000)=>{const until=Date.now()+timeout;while(Date.now()<until){const found=mail.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('no mail');};
/** An account created by email sign-up over HTTP (the UI path has its own test): its sign-in email is `address`. */
async function emailAccount(address){
 const ip=`198.51.100.${++accounts}`,proofs=await createFlowSecret(),browser=`${'K'.repeat(41)}${String(accounts).padStart(2,'0')}`;
 const cookie={'Cookie':`bindle_email_flow=${browser}`};
 const call=async(path,input)=>{const response=await app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,...cookie},body:JSON.stringify(input)}));return response.json();};
 const started=await call('/api/auth/email/flow/start',{email:address,secretHash:proofs.secretHash,channelTag:proofs.channelTag,turnstileToken:CHALLENGE});
 const link=await waitMail(item=>item.email===address&&item.purpose==='sign-up');
 await call('/api/auth/email/link/approve',{t:link.token,confirmed:true});
 const redeemed=await call('/api/auth/email/flow/redeem',{flowId:started.flowId,secret:proofs.secret,confirmed:true});
 const pending=await call('/api/auth/email/signup',{signupToken:redeemed.signup.signupToken,termsAccepted:true,termsVersion:'2026-10-11',ageConfirmed:18});
 const file=await call('/api/auth/recovery/download',{pendingToken:pending.pendingToken});
 const active=await call('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:file.recoveryToken,downloadConfirmed:true});
 assert.equal(active.account?.status,'active',JSON.stringify(active));
 return {handle:active.account.handle,id:active.account.id};
}
const L=locale=>key=>{const value=catalogues[locale]['']?.[key];assert.ok(value||locale==='en',`missing ${locale} string: ${key}`);return value??key;};
async function startOnR(page,address,t){
 await page.goto(origin+'/console?signin=1');
 await page.getByRole('button',{name:t('Continue with email'),exact:true}).click();
 await page.getByLabel(t('Email address')).fill(address);
 const before=mail.length;await page.getByRole('button',{name:t('Continue with email'),exact:true}).click();
 await page.getByRole('heading',{name:t('Check your email.')}).waitFor();
 return waitMail(item=>mail.indexOf(item)>=before&&item.email===address&&item.token);
}
/** Opens the mailed link in `page` (H) and presses an armed control once the arming delay has passed. */
async function openLink(page,link,lang){await page.goto(`${origin}/email/link${lang==='es'?'?lang=es':''}#t=${link.token}`);await page.waitForFunction(()=>!location.hash,null,{timeout:5000});}
async function armedClick(page,name){await page.bringToFront();await page.waitForTimeout(800);await page.getByRole('button',{name,exact:true}).click();}

for(const [name,browserType,locale]of [['chromium',chromium,'en'],['firefox',firefox,'en'],['chromium',chromium,'es']])test(`${name} (${locale}): same-browser fast path — H approves, the wake-up reaches R, R signs in and shows the passkey suggestion`,async t=>{
 const T=L(locale),address=`same-${name}-${locale}@mail.example`,account=await emailAccount(address);
 const browser=await browserType.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({locale:locale==='es'?'es-ES':'en-US'}),errors=[];const R=await context.newPage();R.on('pageerror',error=>errors.push(error.message));R.setDefaultTimeout(20000);
 if(locale==='es')await R.goto(origin+'/console?lang=es');
 const link=await startOnR(R,address,T);assert.equal(link.purpose,'sign-in');
 assert.equal((await context.cookies()).find(c=>c.name==='bindle_email_flow')?.httpOnly,true,'the marker is HttpOnly');
 const H=await context.newPage();H.on('pageerror',error=>errors.push(error.message));H.setDefaultTimeout(20000);
 await openLink(H,link,locale);
 await H.getByRole('heading',{name:new RegExp(T('Sign in to 3sln.me as {handle}?').replace('{handle}','.*').replace(/[?¿]/g,'.'))}).waitFor();
 await H.getByText(T('This browser asked for this link.')).waitFor();
 // Controls are inert before the arming delay: an immediate press does nothing.
 await H.getByRole('button',{name:T('Yes, this is me'),exact:true}).click({noWaitAfter:true});
 assert.equal(await H.getByRole('button',{name:T('Yes, this is me'),exact:true}).count(),1,'not yet armed');
 const closed=new Promise(resolve=>H.once('close',()=>resolve(true)));
 await armedClick(H,T('Yes, this is me'));
 const outcome=await Promise.race([closed,H.getByText(T('You can close this tab and return to the other one.')).waitFor().then(()=>'done')]);
 assert.ok(outcome===true||outcome==='done');
 await R.bringToFront();
 await R.getByText(T('Make signing in easier: add a passkey')).waitFor({timeout:20000});
 await R.getByText(new RegExp(account.handle.replace('.','\\.'))).first().waitFor();
 assert.deepEqual(errors,[]);
});

for(const [name,browserType]of [['chromium',chromium],['firefox',firefox]])test(`${name}: copy-code fallback — two browser contexts; H warns, reveals the code, R takes it`,async t=>{
 const T=L('en'),address=`code-${name}@mail.example`,account=await emailAccount(address);
 const browser=await browserType.launch({headless:true});t.after(()=>browser.close());
 const tv=await browser.newContext(),phone=await browser.newContext(),R=await tv.newPage(),H=await phone.newPage();R.setDefaultTimeout(20000);H.setDefaultTimeout(20000);
 const link=await startOnR(R,address,T);
 await openLink(H,link);
 await H.getByText(T('Another device asked for this link.')).waitFor();
 await H.getByText(/Only continue if you are signing in on that device right now/).waitFor();
 await armedClick(H,T('Yes, this is me'));
 const shown=(await H.locator('.device-code').textContent()).trim();assert.match(shown,/^\d{3} \d{3}$/);
 await H.getByText(/Never read it out or send it to anyone/).waitFor();
 await R.bringToFront();
 await R.getByText(T('Enter the code shown on your other device.')).first().waitFor({timeout:15000});
 await R.getByLabel(T('Code from your other device')).fill('000 000'===shown?'111 111':'000 000');await R.locator('.email-flow-code').getByRole('button',{name:T('Continue'),exact:true}).click();
 await R.getByText(/That code does not match/).waitFor();
 await R.getByLabel(T('Code from your other device')).fill(shown);await R.locator('.email-flow-code').getByRole('button',{name:T('Continue'),exact:true}).click();
 await R.getByText(T('Make signing in easier: add a passkey')).waitFor();
 assert.equal((await phone.cookies()).some(c=>/session|account/.test(c.name)),false,'the phone never signs in');
 void account;
});

test('chromium: the original tab was closed — H offers to sign in here; the session lands in H\'s tab',async t=>{
 const T=L('en'),address='closed@mail.example';await emailAccount(address);
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(),R=await context.newPage();R.setDefaultTimeout(20000);
 const link=await startOnR(R,address,T);await R.close();
 const H=await context.newPage();H.setDefaultTimeout(20000);await openLink(H,link);
 await armedClick(H,T('Yes, this is me'));
 await H.getByRole('heading',{name:T('The tab that asked for this is closed.')}).waitFor();
 await armedClick(H,T('Sign in here'));
 await H.waitForURL(/\/console/);
 await H.getByText(T('Make signing in easier: add a passkey')).waitFor();
});

test('chromium: email sign-up from the original tab — create-account link, terms and age, then the recovery file (no passkey step)',async t=>{
 const T=L('en'),address='brand-new@mail.example';
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext(),R=await context.newPage();R.setDefaultTimeout(20000);
 const link=await startOnR(R,address,T);assert.equal(link.purpose,'sign-up');
 const H=await context.newPage();await openLink(H,link);
 await H.getByRole('heading',{name:/Create a 3sln\.me account for .?b•••@mail\.example/}).waitFor();
 await armedClick(H,T('Yes, this is me'));
 await R.bringToFront();
 await R.getByRole('heading',{name:T('Create your account.')}).waitFor();
 await R.locator('input[name=ageConfirmed]').check();await R.locator('input[name=termsAccepted]').check();
 await R.getByRole('button',{name:T('Create account'),exact:true}).click();
 await R.waitForURL(/\/recovery\/setup/);
 // The recovery-file questions (the only setup step), not a passkey prompt.
 await R.getByLabel(T('What is my private recovery passphrase?'),{exact:true}).waitFor();
 assert.equal(await R.getByRole('button',{name:/Set up a passkey/}).count(),0,'no passkey step');
});
