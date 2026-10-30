// Browsers for the simulation: Chromium routed through the run's CONNECT proxy (real https .example origins on 443),
// one context per simulated person, page-health capture for gate G2, and the interaction helpers the provider pages'
// anti-clickjacking rules require (a focused, visible document and a pointer that rests before an approval click).
import {chromium} from 'playwright';
import {existsSync} from 'node:fs';
import {Keyring} from './passkeys.mjs';
import {decode as decodeCbor} from '../../packages/core/cbor.mjs';

export async function launchBrowser(network,{headed=false}={}){
 const pinned=chromium.executablePath(),local='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.SIM_CHROME||(existsSync(pinned)?undefined:existsSync(local)?local:undefined);
 return chromium.launch({headless:!headed,executablePath,proxy:{server:'per-context'},
  args:['--ignore-certificate-errors','--disable-background-networking','--disable-component-update','--no-first-run','--disable-features=OptimizationGuideModelDownloading,Translate,MediaRouter']});
}

/** One person's browser: a context with their soft-passkey keyring and health capture on every page. */
export async function personContext(browser,{name,locale='en-US',viewport={width:1280,height:900},health,proxy}){
 const context=await browser.newContext({proxy:{server:proxy},ignoreHTTPSErrors:true,acceptDownloads:true,locale,viewport,colorScheme:'light',reducedMotion:'reduce'});
 const keyring=new Keyring();await keyring.attach(context);
 await context.exposeBinding('__simReport',({frame},kind,text)=>health.push({actor:name,origin:safeOrigin(frame.url()),kind,text:String(text).slice(0,500)}));
 await context.addInitScript(()=>{
  addEventListener('securitypolicyviolation',e=>{try{globalThis.__simReport?.('csp',`${e.violatedDirective} ${e.blockedURI}`);}catch{}});
  addEventListener('unhandledrejection',e=>{try{globalThis.__simReport?.('unhandled-rejection',String(e.reason?.message??e.reason));}catch{}});
 });
 const watch=page=>{
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>health.push({actor:name,origin:safeOrigin(page.url()),kind:'pageerror',text:String(error.message).slice(0,500)}));
  page.on('response',response=>{if(response.status()>=400){let u;try{u=new URL(response.url());}catch{return;}const entry={actor:name,origin:safeOrigin(page.url()),kind:'http-'+response.status(),text:`${response.request().method()} ${u.origin}${u.pathname}`,info:true};health.push(entry);
   // Only the provider's coded JSON error is kept (never bodies of other answers, which may carry identifiers).
   if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/oauth/'))response.json().then(b=>{if(typeof b?.error==='string')entry.error=`${b.error}: ${String(b.message??'').slice(0,160)}`;}).catch(()=>{});
   // The CBOR RPC answers a coded `{err|error, description}` map; only that code and description are kept.
   else if(u.pathname==='/bindle/rpc'&&/cbor/.test(response.headers()['content-type']??''))response.body().then(bytes=>{const b=decodeCbor(new Uint8Array(bytes)),code=b?.error??b?.err;if(typeof code==='string')entry.error=`${code}: ${String(b.description??b.message??'').slice(0,160)}`;}).catch(()=>{});}});
  page.on('console',message=>{if(message.type()==='error')health.push({actor:name,origin:safeOrigin(page.url()),kind:'console-error',text:message.text().slice(0,500)});});
 };
 context.on('page',watch);
 return {name,context,keyring,async page(){const page=await context.newPage();return page;},close:()=>context.close()};
}
const safeOrigin=url=>{try{return new URL(url).origin;}catch{return 'about:blank';}};

/** A click on a provider approval control: bring the document to the front (focus), rest the pointer, then click. */
export async function armedClick(page,locator,{rest=800}={}){
 await page.bringToFront();await locator.waitFor({state:'visible'});
 await page.waitForFunction(()=>document.hasFocus()&&document.visibilityState==='visible',null,{timeout:5000}).catch(()=>{});
 await locator.hover();await page.waitForTimeout(rest);await locator.click();
}
/** A click inside a provider island (pointer arming: the pointer must be over the island for 400 ms first). */
export async function islandClick(page,frameLocator,locator){
 await locator.waitFor({state:'visible'});await locator.hover();await page.waitForTimeout(700);await locator.click();
}
/** Waits for a new page (popup) opened by `action` and returns it once it has a URL. */
export async function popupFrom(context,action){
 const [popup]=await Promise.all([context.waitForEvent('page'),action()]);await popup.waitForLoadState('domcontentloaded');return popup;
}
