import {contactIntentValue,canonicalContactLink} from '../../../../packages/links/preview.mjs';
import {Action} from '../shared/stack.mjs';
import {interfaceText} from '../ui/interface-text.mjs';
import {parseIdentity,discoverIdentity} from '../../../../packages/sdk/src/identity.mjs';
import {EXT,readExtensions} from '../../../../packages/core/extensions.mjs';
// Contact links (docs/spec/links.md §9). Contact links are created and served by the owner's apps; the core only
// describes a link (its owner-permitted profile) and hands it off to the visitor's own messaging app through the
// intent router or their provider (links §6.4). Nothing here composes, signs or delivers a message, and the
// capability stays in browser memory.
const snapshot=r=>r.state.snapshot();
const publish=(r,ctx,patch)=>{r.state.transition(next=>Object.assign(next,patch));ctx.engineFeed.dispatchEvent(new Event('browser-state-updated'));};
const patch=(r,ctx,key,value)=>publish(r,ctx,{[key]:{...snapshot(r)[key],...value}});
const INTENTS=['send-message','add-contact'];
export const intentLink=(intent,link)=>`web+bindle://${intent}?contact-url=${encodeURIComponent(link)}`;
const intentEnabled=s=>(s.data?.features??s.session?.account?.consoleFeatures??s.config)?.intentLinksEnabled===true;
const modernValue=(s,intent,link)=>{if(!intentEnabled(s))return null;try{return contactIntentValue(intent,link);}catch{return null;}};
const intentTarget=(s,intent,link)=>{if(!intentEnabled(s)||!['send-message','add-contact'].includes(intent))return null;const value=modernValue(s,intent,link);if(value)return '/i#bintent='+value;try{const url=new URL(link);if(typeof link==='string'&&link.length<=18000&&(url.protocol==='https:'||s.config?.localDevelopment===true&&url.origin===s.config.origin)&&canonicalContactLink(url.origin,link)?.link===link)return '/i#legacy='+encodeURIComponent(intentLink(intent,link));}catch{}return null;};
/** The intent-router target that hands a contact link to the signed-in user's own messaging app as `send-message`
 * (developer contact in occupant mode), or null when intents are unavailable for this account. */
export const sendMessageTarget=(s,link)=>intentTarget(s,'send-message',link);
/** Whether the signed-in visitor can hand this link to their own messaging app from here. */
export const handoffAvailable=(s,link)=>Boolean(s.session?.account&&intentTarget(s,'send-message',link));
/** Whether intent handoffs are available for this account (the console copy follows it, review I2). */
export const intentsAvailable=s=>intentEnabled(s);
const failures={link_malformed:'This contact link is malformed. Ask the sender for a fresh link.',link_invalid:'This contact link is expired, revoked, or invalid.',unauthorized:'This contact link is expired, revoked, or invalid.',not_acceptable:'This contact link is expired, revoked, or invalid.',rate_limited:'Please wait before trying again.'};
const later={rate_limited:'Please wait and try again {time}.'};
export const contactFailure=(error,locale='en')=>{if(error?.retryAfter&&later[error.code]){const minutes=Math.max(1,Math.ceil(error.retryAfter/60));return interfaceText(later[error.code],{time:new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(minutes,'minute')});}return failures[error?.code]??(error?.message||'The request could not be completed. Please try again.');};
// Public page: description only (the owner-permitted profile + signup capacity). The profile representation also
// verifies the link: an expired, revoked or invalid link is refused, and captured bindle_data is never evaluated.
export async function loadContactPage(r,ctx,endpoint,live){publish(r,ctx,{contactPage:{link:endpoint,checked:false,profile:null,signup:null}});const result=await r.api.contactLanding(endpoint);if(!live())return;if(!result?.valid){patch(r,ctx,'contactPage',{refused:true});throw Object.assign(new Error(failures.link_invalid),{code:'link_invalid'});}patch(r,ctx,'contactPage',{checked:true,profile:result.profile??null});
 if(intentEnabled(snapshot(r))){const remembered=r.browser.rememberedIntentProvider?.();if(remembered){let target;try{target=new URL(remembered.endpoint);}catch{}if(target?.protocol==='https:'&&!target.username&&!target.password&&!target.search&&!target.hash&&target.hostname===remembered.host){const intents=INTENTS.filter(i=>modernValue(snapshot(r),i,endpoint));if(intents.length)patch(r,ctx,'contactPage',{provider:{host:target.host,login:target.href,intents,modern:true,armedAt:(r.browser.now?.()??Date.now())+1000}});}}}
 r.api.get('/api/signup/status',{context:null}).then(signup=>{if(live())patch(r,ctx,'contactPage',{signup:{open:signup?.signupOpen===true,free:signup?.freeSignupOpen===true,paid:signup?.paidSignupOpen===true,waitlist:signup?.waitlistEnabled===true}});}).catch(()=>{});}
class PublicFlow extends Action {
 static deps={state:{write:true},browser:{}};
 constructor(detail={}){super();this.detail=detail;}
 async execute(r,ctx){const s=snapshot(r),endpoint=r.browser.secret('contactEndpoint');if(s.route.kind!=='contact')return;if(!endpoint){publish(r,ctx,{error:'This contact link is incomplete. Open the original link again.'});return;}try{await this.perform(r,ctx,this.detail,endpoint);}catch(error){publish(r,ctx,{error:error.message});}}
}
// Signed in: hand the link to the visitor's own messaging app through the intent router (it chooses the app).
export class ContactHandoff extends PublicFlow {async perform(r,ctx,d,endpoint){if(!INTENTS.includes(d.intent)||!snapshot(r).session?.account)return;const target=intentTarget(snapshot(r),d.intent,endpoint);if(!target)throw new Error('Your account can’t open messaging apps from here yet. Open this link from your messaging app instead.');r.browser.navigate(target);}}
// The capability left the address bar when the page opened, so a reload cannot recover a failed
// description; this retries it from memory. Read-only: no credentials.
export class ReloadContactPage extends PublicFlow {static deps={...PublicFlow.deps,api:{}};async perform(r,ctx,d,endpoint){const s=snapshot(r);if(s.contactPage?.checked||s.contactPage?.refused||s.contactPage?.retrying)return;const live=()=>r.browser.secret('contactEndpoint')===endpoint&&snapshot(r).route.kind==='contact'&&snapshot(r).route.recipient===s.route.recipient;publish(r,ctx,{error:'',contactPage:{...snapshot(r).contactPage,retrying:true}});try{await loadContactPage(r,ctx,endpoint,live);}catch(error){if(live())publish(r,ctx,{error:contactFailure(error,snapshot(r).locale)});}finally{if(live())publish(r,ctx,{contactPage:{...snapshot(r).contactPage,retrying:false}});}}}
// Signed out: carry {link} in session storage through sign-in or sign-up; the console then hands it off.
export class ContactAuth extends PublicFlow {async perform(r,ctx,d,endpoint){r.browser.saveContactHandoff({link:endpoint,intent:null});r.browser.navigate(d.mode==='signup'?'/console?signup=1':d.mode==='paid'?'/console?signup=1&plan=paid':'/console?signin=1');}}
// Handle on another provider: discovery reuses the SDK limits (HTTPS, size, timeout, no redirects, no credentials).
// Only a definite intents (or, with intent links enabled, intent-links) extension declaration with a same-origin
// endpoint enables a hand-off (extensions §2): unknown extensions are ignored, an invalid entry is absent, the former
// `features` container is ignored, and any failure falls back.
export class DiscoverProvider extends PublicFlow {async perform(r,ctx,d,endpoint){const s=snapshot(r),local=s.config.localDevelopment===true,home=new URL(s.config.origin??location.origin).host,value=String(d.values?.handle??'').trim();patch(r,ctx,'contactPage',{provider:null,providerError:''});
 let identity;try{identity=parseIdentity(value,home,{allowInsecureLocalhost:local});}catch{patch(r,ctx,'contactPage',{providerError:'Enter a handle like alex@provider.example.'});return;}
 if(identity.host===home){await new ContactAuth({mode:'signin'}).perform(r,ctx,{mode:'signin'},endpoint);return;}
 const fail=()=>patch(r,ctx,'contactPage',{providerError:interfaceText('{host} could not be used for this contact link. Use a Bindle app link instead.',{host:'\u2066'+identity.host+'\u2069'})});
 try{const found=await discoverIdentity(value,{fetcher:r.browser.fetcher??fetch,allowInsecureLocalhost:local,defaultHost:home}),m=found.manifest,declared=found.kind==='provider'?readExtensions(m,{issuer:m.issuer,allowInsecureLocalhost:local}).extensions:new Map(),modern=intentEnabled(s)&&declared.get(EXT.intentLinks);if(found.kind==='provider'&&typeof modern?.endpoint==='string'){const target=new URL(modern.endpoint),supported=INTENTS.filter(i=>modernValue(s,i,endpoint));if(target.origin===m.issuer&&target.protocol==='https:'&&!target.username&&!target.password&&!target.search&&!target.hash&&target.href===modern.endpoint&&supported.length){patch(r,ctx,'contactPage',{provider:{host:target.host,login:target.href,intents:supported,modern:true,armedAt:(r.browser.now?.()??Date.now())+1000}});return;}}const feature=declared.get(EXT.intents);if(found.kind!=='provider'||!Array.isArray(feature?.intents)||!feature.intents.length||typeof feature.login_endpoint!=='string')return fail();const login=new URL(feature.login_endpoint),supported=INTENTS.filter(i=>feature.intents.includes(i));
  if(login.href!==feature.login_endpoint||login.origin!==m.issuer||login.protocol!=='https:'&&!(local&&login.hostname==='localhost')||login.username||login.password||login.search||login.hash||!supported.length)return fail();patch(r,ctx,'contactPage',{provider:{host:identity.host,login:login.href,intents:supported}});}catch{fail();}}}
export class ContinueWithProvider extends PublicFlow {async perform(r,ctx,d,endpoint){const p=snapshot(r).contactPage?.provider;if(!p?.intents.includes(d.intent))return;if(p.modern){if((r.browser.now?.()??Date.now())<(p.armedAt??Infinity))return;const value=modernValue(snapshot(r),d.intent,endpoint);if(value&&typeof r.browser.postIntent==='function')r.browser.postIntent(p.login,value);return;}r.browser.navigate(p.login+'?bindle_intent='+encodeURIComponent(intentLink(d.intent,endpoint)));}}
// Console arrival with a pending contact link (after sign-in, or from the intent router): hand it to the account's
// messaging app through the intent router. Nothing is signed or sent; the core has no composer.
export class StartHandoff extends Action {
 static deps={state:{write:true},browser:{}};
 async execute(r,ctx){const taken=r.browser.takeContactHandoff({modern:intentEnabled(snapshot(r))});if(!taken)return;if(taken.lost){publish(r,ctx,{notice:'The contact link from before sign-in has expired. Open it again to continue.'});return;}
  const intent=INTENTS.includes(taken.intent)?taken.intent:'send-message';
  if(!taken.fromIntent&&!taken.foreign){const target=intentTarget(snapshot(r),intent,taken.link);if(target){r.browser.navigate(target);return;}}
  if(taken.foreign){publish(r,ctx,{notice:'Contact links on other services can’t be opened from here yet.',error:''});return;}
  if(!snapshot(r).session?.account){r.browser.saveContactHandoff(taken);publish(r,ctx,{...snapshot(r).route?.auth==='signup'?{}:{auth:'login'},notice:'Sign in or create an account to open this contact link in your messaging app.'});return;}
  publish(r,ctx,{notice:'Open this contact link in your messaging app to write a message or save the contact.',error:''});}
}
