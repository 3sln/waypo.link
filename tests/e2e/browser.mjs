import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {softAuthenticator,signupBody,registerPending,passkeyStepUp,passkeySignIn} from '../helpers/soft-passkey.mjs';

export const baseURL=process.env.E2E_BASE_URL || 'http://localhost:8787';
export const artifacts=path.resolve(process.env.E2E_ARTIFACTS || '/tmp/3sln-e2e');
mkdirSync(artifacts,{recursive:true});
export async function launch(options={}){
  const localChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const pinnedChrome=chromium.executablePath();
  const executablePath=process.env.E2E_CHROME || (existsSync(pinnedChrome)?undefined:existsSync(localChrome)?localChrome:undefined);
  return chromium.launch({...options,headless:true,executablePath});
}
export async function virtualAuthenticator(context,page){
  const cdp=await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  return {cdp,authenticatorId};
}
export async function waitForApp(page){
  await page.goto(baseURL+'/console');
  await page.locator('.auth-card,.app-shell').first().waitFor();
}
export async function screenshot(page,name){await page.evaluate(async()=>{await document.fonts.ready;if(document.activeElement?.matches('.skip-link'))document.activeElement.blur();window.scrollTo({top:0,left:0,behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:path.join(artifacts,`${name}.png`),fullPage:true,animations:'disabled'});}
export async function publicAssetCache(page){
  return page.evaluate(async()=>{
    const names=await caches.keys();const urls=[];
    for(const name of names)for(const request of await (await caches.open(name)).keys())urls.push(request.url);
    return urls;
  });
}

// Traverse actual public signup questions; this does not create or activate an account.
export async function completeSignupQuestions(page,{email,channel='email'}={}){
 for(let count=0;count<8;count++){
  const card=page.locator('.signup-wizard');await card.waitFor();
  if(await card.getByRole('button',{name:/^(Create my account|Crear mi cuenta)$/,exact:true}).count())return;
  const heading=await card.locator('.wizard-heading').textContent();
  if(await card.getByRole('button',{name:/^(Use email|Usar correo)$/,exact:true}).count())await card.getByRole('button',{name:channel==='push'?/^(Use notifications|Usar notificaciones)$/:/^(Use email|Usar correo)$/,exact:true}).click();
  if(await card.locator('input[name=noticeEmail]').count()){if(!email)throw new Error('Signup fixture requires an email for the selected contact channel');await card.locator('input[name=noticeEmail]').fill(email);}
  if(await card.locator('input[name=termsAccepted]').count()){await card.locator('input[name=ageConfirmed]').check();await card.locator('input[name=termsAccepted]').check();}
  await card.getByRole('button',{name:/^(Continue|Continuar)$/,exact:true}).click();
  await page.waitForFunction(previous=>document.querySelector('.signup-wizard .wizard-heading')?.textContent!==previous,heading);
 }
 throw new Error('Signup questions did not reach the credential screen');
}

// Passwords were dropped (owner approval 2026-10-28): test accounts sign up and confirm with a passkey. HTTP-only setup
// uses the soft authenticator (tests/helpers/soft-passkey.mjs), whose responses the real Worker/Node adapter verifies.
export {softAuthenticator,passkeyStepUp,passkeySignIn};
/** `send(path,data)` over a Playwright APIRequestContext: posts JSON with Origin (plus `headers`, or a function of the
 * call returning extra headers) and resolves the parsed body, throwing on a non-2xx answer. */
export function requestSender(request,{origin=baseURL,headers={}}={}){return async(path,data)=>{const response=await request.post(origin+path,{headers:{Origin:origin,...(typeof headers==='function'?headers():headers)},data});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={raw:text};}if(!response.ok())throw Object.assign(new Error(`${path} answered ${response.status()}: ${text.slice(0,300)}`),{status:response.status(),value});return value;};}
/** A pending passkey signup with its passkey registered (ready for the recovery download). */
export async function passkeySignup(request,{origin=baseURL,headers={},body={},authenticator=softAuthenticator({origin}),path='/api/auth/signup'}={}){
 const send=requestSender(request,{origin,headers});
 const pending=await send(path,signupBody({ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token',...body}));
 if(!pending.registrationOptions)throw new Error('signup returned no registrationOptions: '+JSON.stringify(pending));
 const registered=await registerPending(authenticator,send,pending);
 return {pending,registered,authenticator,credentialId:[...authenticator.credentials.keys()].at(-1),send};
}
/** An active account: passkey signup, recovery download and confirmation. Cookies land in `request`'s jar. */
export async function passkeyAccount(request,options={}){
 const signed=await passkeySignup(request,options),{send,pending}=signed;
 const file=await send('/api/auth/recovery/download',{pendingToken:pending.pendingToken});
 const session=await send('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:file.recoveryToken,downloadConfirmed:true});
 return {...signed,file,session,account:session.account};
}
/** Routes the page's (or every page of a context's) WebAuthn calls to a soft authenticator in this test process, so a
 * browser ceremony uses the same credential as HTTP setup. Works in Chromium and Firefox; FedCM and other
 * non-publicKey requests fall through to the browser. */
export async function softWebAuthn(target,authenticator){
 await target.exposeFunction('__softPasskeyCreate',options=>authenticator.register(options));
 await target.exposeFunction('__softPasskeyGet',options=>authenticator.authenticate(options,options.allowCredentials?.find(c=>authenticator.credentials.has(c.id))?.id));
 await target.addInitScript(()=>{
  const enc=value=>{const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const plain=publicKey=>{const out={...publicKey,challenge:enc(publicKey.challenge)};if(publicKey.user)out.user={...publicKey.user,id:enc(publicKey.user.id)};for(const name of ['allowCredentials','excludeCredentials'])if(publicKey[name])out[name]=publicKey[name].map(item=>({...item,id:enc(item.id)}));return out;};
  const wrap=json=>({id:json.id,type:'public-key',toJSON:()=>json});
  const proto=globalThis.CredentialsContainer?.prototype;if(!proto)return;const get=proto.get,create=proto.create;
  proto.get=async function(options){if(!options?.publicKey)return get.call(this,options);return wrap(await globalThis.__softPasskeyGet(plain(options.publicKey)));};
  proto.create=async function(options){if(!options?.publicKey)return create.call(this,options);return wrap(await globalThis.__softPasskeyCreate(plain(options.publicKey)));};
 });
}
/** Registration options a mocked `/api/auth/signup` (or onboarding/bootstrap) answer can carry; the client creates a
 * passkey from them (a virtual authenticator or `softWebAuthn`) and posts it to `/api/auth/passkey/register`, which the
 * mock must also fulfil. */
export const fixtureRegistrationOptions=(name='n.fixture',rpId=new URL(baseURL).hostname)=>({challenge:'Zml4dHVyZS1yZWdpc3RyYXRpb24tY2hhbGxlbmdl',rp:{id:rpId,name:'3sln.me'},user:{id:'Zml4dHVyZS11c2Vy',name,displayName:name},pubKeyCredParams:[{type:'public-key',alg:-7}],timeout:60000,attestation:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'}});
