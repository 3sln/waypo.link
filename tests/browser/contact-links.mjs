import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
// Contact-link landing and hand-off after messaging left the core (2026-10-27). The public page shows the owner-permitted
// profile and hands the link to the visitor's own messaging app (intent router or their provider, links §6.4). The
// console never composes, signs or delivers a message, and calls no removed messaging API.
const window=new Window({url:'https://space.example/'});
const names=['document','HTMLElement','CustomEvent','Event','EventTarget','ErrorEvent','Node','Element','location'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)Object.defineProperty(globalThis,name,{value:window[name],configurable:true,writable:true});
const {Engine,Provider,dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {forEachSeed}=await import('../helpers/chaos.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {createAPI}=await import('../../apps/web/src/providers/api.mjs');
const {contactCapture,contactReturn,handoffCapture,parseIntent}=await import('../../apps/web/src/providers/browser.mjs');
const {DiscoverProvider,ContinueWithProvider,ContactAuth,ContactHandoff,StartHandoff,ReloadContactPage}=await import('../../apps/web/src/bl/contact-link.mjs');
const {LoadDeveloperContact,OpenDeveloperContact}=await import('../../apps/web/src/bl/incoming.mjs');
const {SignOut,CreateRule}=await import('../../apps/web/src/bl/release.mjs');
const {contactPage}=await import('../../apps/web/src/ui/release-contact.mjs');
const {developerContact}=await import('../../apps/web/src/ui/release-developer-contact.mjs');
const {tagPill}=await import('../../apps/web/src/ui/tag-pill.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)Object.defineProperty(globalThis,name,{value:previous[name],configurable:true,writable:true});});
const origin='https://space.example',contactId='11111111-1111-4111-8111-111111111111',path=`/users/ray/contact/${contactId}`,b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
// A structurally valid link meta (signature bytes are not checked client-side), so intent values can be derived from it.
const meta=`${b64({alg:'ES256',kid:'k1',typ:'bindle-link-meta+jwt'})}.${b64({bindle:'link-meta',v:1,type:'https://spec.bindle.example/links/contact/v1',iss:origin,aud:origin+path,sub:'550e8400-e29b-41d4-a716-446655440009',jti:'a1b2c3d4-0000-4000-8000-000000000001',iat:1767225600,exp:1830297600})}.${Buffer.alloc(64,1).toString('base64url')}`;
const link=`${origin}${path}?bindle_meta=${meta}`,account={id:'550e8400-e29b-41d4-a716-446655440001',handle:'n.ab'},other={id:'550e8400-e29b-41d4-a716-446655440002',handle:'n.cd'};
const render=(view,state,locale='en')=>{const root=document.createElement('main');dodo.reconcile(root,[localize(view(state),createLocalization({locale}))]);return root;};
const base={loading:false,locale:'en',view:'inbox',config:{origin,localDevelopment:true,handleOriginHost:'space.example'},brand:{name:'3sln.me',host:'space.example'},route:{kind:'contact',recipient:'ray'}};
const withIntents=state=>({...state,config:{...state.config,intentLinksEnabled:true}});
async function fixture(patch={},api={}){const secrets={contactEndpoint:link},calls=[],nav=[],saved=[];let pendingHandoff=null;
 const browser={id:()=>crypto.randomUUID(),now:()=>Date.now(),secret:k=>secrets[k],storeSecret:(k,v)=>secrets[k]=v,navigate:u=>nav.push(u),saveContactHandoff:v=>saved.push(v),takeContactHandoff:()=>{const v=pendingHandoff;pendingHandoff=null;return v;},consumeSubmission(){throw Error('none');},restoreFocus(){},clearOwnerContext(){},cancelDeviceEntry(){},setCaptchaAction(){},installCaptcha(){},focus(){},copy:async()=>{},pushSubscriptionId:async()=>'P'.repeat(43)};
 const client={get:async p=>{calls.push({path:p});throw Error(p);},request:async(p,b,m)=>{calls.push({path:p,body:b,method:m});throw Error(p);},contactLanding:async()=>{calls.push({path:'landing'});return {valid:true,profile:null};},...api};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(client),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const read=()=>engine.container.use(['state'],({state})=>state.snapshot()),write=p=>engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,p)));await write({...base,...patch});
 return {engine,secrets,calls,nav,saved,browser,api:client,read,write,handoff:v=>{pendingHandoff=v;},act:a=>engine.dispatch(a).next('complete'),close:()=>engine.dispose()};}
const page={link,checked:true,profile:null,signup:{open:true,free:true,paid:true,waitlist:false}};
const removed=/\/api\/(contacts|contact-links|conversations|incoming|messages$)|\/api\/links\/(envelope|respond)/;

test('capture keeps only the canonical capability; handoff accepts a fragment or a web+bindle intent only',()=>{
 assert.deepEqual(contactCapture({origin,pathname:path,search:`?utm_source=x&bindle_meta=${meta}&bindle_data=${meta}`}),{url:link,data:meta});
 for(const search of [`?bindle_meta=${meta}&bindle_meta=${meta}`,`?sig=a&bindle_meta=${meta}`,'?bindle_data='+meta,''])assert.equal(contactCapture({origin,pathname:path,search}),null);
 assert.equal(contactReturn(link),true);for(const url of ['https://evil.example'+path+'?bindle_meta='+meta,link+'&x=1',`${origin}/console`,link+'#frag',`${origin}${path}?sig=not-a-jws`])assert.equal(contactReturn(url),false);
 assert.deepEqual(handoffCapture({pathname:'/console',search:'',hash:'#contact='+encodeURIComponent(link)+'&intent=send-message'}),{link,intent:'send-message'});
 assert.deepEqual(handoffCapture({pathname:'/console',search:'?intent='+encodeURIComponent('web+bindle://add-contact?contact-url='+encodeURIComponent(link)),hash:''}),{link,intent:'add-contact'});
 for(const intent of ['bindle+intent://add-contact?contact-url='+encodeURIComponent(link),'web+bindle://delete?contact-url='+encodeURIComponent(link)])assert.equal(handoffCapture({pathname:'/console',search:'?intent='+encodeURIComponent(intent),hash:''}),null);
 assert.equal(handoffCapture({pathname:'/console',search:'',hash:'#contact='+encodeURIComponent(link)+'&intent=pay'}),null);
});

test('bindle_intent is untrusted: exact shape, bounded, same-origin or HTTPS contact links; foreign links are flagged',()=>{
 const intent=(i,url)=>'web+bindle://'+i+'?contact-url='+encodeURIComponent(url),q=v=>'?bindle_intent='+encodeURIComponent(v);
 assert.deepEqual(handoffCapture({pathname:'/console',search:q(intent('send-message',link)),hash:''}),{link,intent:'send-message'});
 assert.deepEqual(parseIntent(intent('add-contact','https://other.example'+path+'?bindle_meta='+meta)),{foreign:true,intent:'add-contact'});
 for(const value of [intent('send-message','http://other.example'+path+'?bindle_meta='+meta),intent('send-message',link+'&x=1'),intent('send-message',link)+'&contact-url=x',intent('send-message',link)+'&next=1',intent('send-message',intent('send-message',link)),intent('pay',link),'https://space.example/?contact-url='+encodeURIComponent(link),intent('send-message',link)+'#f',intent('send-message',link+'x'.repeat(8200))])assert.equal(parseIntent(value),null,value);
});

test('landing load: the profile representation verifies the link; refused links and failures are distinct; no messaging API',async()=>{
 let answer=async()=>({valid:true,profile:{displayName:'Ray',bio:'<b>hi</b>'}});
 const f=await fixture({},{contactLanding:async endpoint=>{f.calls.push({path:'landing',endpoint});return answer();},get:async p=>{f.calls.push({path:p});return {signupOpen:true,freeSignupOpen:false,paidSignupOpen:true,waitlistEnabled:false};}});
 try{await f.act(new ReloadContactPage());await new Promise(resolve=>setTimeout(resolve,0));let s=await f.read();assert.equal(s.contactPage.checked,true);assert.deepEqual(s.contactPage.profile,{displayName:'Ray',bio:'<b>hi</b>'});assert.deepEqual(s.contactPage.signup,{open:true,free:false,paid:true,waitlist:false});
  assert.deepEqual(f.calls.map(c=>c.path),['landing','/api/signup/status']);assert.equal(f.calls[0].endpoint,link);
  const root=render(contactPage,s);assert.match(root.textContent,/Send a message to ⁨Ray⁩\./);assert.equal(root.querySelector('b'),null);assert.equal(root.querySelector('textarea'),null);
  // A refused link (expired, revoked, invalid) is final; a transient failure offers "Try again", which retries from memory.
  answer=async()=>({valid:false});await f.write({contactPage:null,error:''});await f.act(new ReloadContactPage());s=await f.read();assert.equal(s.error,'This contact link is expired, revoked, or invalid.');assert.equal(s.contactPage.checked,false);assert.equal(s.contactPage.refused,true);assert.equal([...render(contactPage,s).querySelectorAll('button')].some(b=>b.textContent==='Try again'),false,'a refused link is final');
  answer=async()=>{throw Object.assign(new Error('Too many requests. Wait a moment, then try again.'),{status:429,code:'rate_limited',retryAfter:120});};await f.write({contactPage:null,error:''});await f.act(new ReloadContactPage());s=await f.read();assert.equal(s.error.source,'Please wait and try again {time}.');assert.equal(s.error.variables.time,'in 2 minutes');
  assert.ok([...render(contactPage,s).querySelectorAll('button')].some(b=>b.textContent==='Try again'));
  answer=async()=>({valid:true,profile:null});await f.write({error:''});await f.act(new ReloadContactPage());s=await f.read();assert.equal(s.contactPage.checked,true);assert.equal(s.error,'');
  assert.equal(f.calls.some(c=>removed.test(c.path??'')),false);
 }finally{await f.close();}
});

test('contactLanding: credentialless profile request; 400/404/406/410 refuse, other failures are retryable',async t=>{
 const prior=globalThis.fetch;t.after(()=>globalThis.fetch=prior);const requests=[];let reply;
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return reply();};const api=createAPI();
 const profileType={'content-type':'application/vnd.bindle.contact-profile+json'};
 reply=()=>new Response(JSON.stringify({identityURI:origin+'/users/ray',profile:{displayName:'Ray',avatar:'https://user:pw@evil.example/a.png'}}),{headers:profileType});
 assert.deepEqual(await api.contactLanding(link),{valid:true,profile:{displayName:'Ray'}});
 const sent=requests[0];assert.equal(sent.url,link);assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.referrerPolicy,'no-referrer');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.headers.Accept,'application/vnd.bindle.contact-profile+json');assert.equal(sent.options.method,undefined);
 reply=()=>new Response(JSON.stringify({profile:{}}),{headers:profileType});assert.deepEqual(await api.contactLanding(link),{valid:true,profile:null});
 for(const status of [400,404,406,410]){reply=()=>new Response('{}',{status,headers:{'content-type':'application/json'}});assert.deepEqual(await api.contactLanding(link),{valid:false},String(status));}
 reply=()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}});await assert.rejects(api.contactLanding(link),error=>error.code==='rate_limited'&&error.retryAfter===60);
 reply=()=>new Response('{}',{status:503});await assert.rejects(api.contactLanding(link),/could not be checked/);
 reply=()=>new Response('<html>',{headers:{'content-type':'text/html'}});await assert.rejects(api.contactLanding(link),/could not be checked/);
 reply=()=>new Response('x'.repeat(9000),{headers:profileType});await assert.rejects(api.contactLanding(link),/could not be checked/);
 reply=()=>{throw new TypeError('Failed to fetch');};await assert.rejects(api.contactLanding(link),error=>error.code==='network_unavailable');
 assert.equal(await api.contactProfile(link),null,'the profile shortcut never throws');
 for(const name of ['contactIntake','contactInspect','contactDeliver'])assert.equal(name in api,false,name+' left the client with messaging');
});

test('foreign-provider handle: definite declaration offers an exact hand-off; any failure falls back without redirecting',async()=>{
 const manifest={version:'0',issuer:'https://other.example',login_presentation:['redirect'],authorization_endpoint:'https://other.example/oauth/authorize',token_endpoint:'https://other.example/oauth/token',rpc_endpoint:'https://other.example/rpc',jwks_uri:'https://other.example/jwks',authorization_request_endpoint:'https://other.example/oauth/request',preferences_contract:'https://other.example/preferences',features:{'intents.v1':{intents:['send-message','add-contact'],login_endpoint:'https://other.example/console'},'future-thing.v3':{x:1}}};
 let reply=()=>new Response(JSON.stringify(manifest),{headers:{'content-type':'application/json'}});const fetched=[];
 const f=await fixture({contactPage:page,config:{...base.config,localDevelopment:false}});f.browser.fetcher=async(url,options)=>{fetched.push([url,options]);return reply();};
 try{await f.act(new DiscoverProvider({values:{handle:'alex@other.example'}}));assert.deepEqual(fetched[0][0],'https://other.example/.well-known/bindle/manifest.json');assert.equal(fetched[0][1].credentials,'omit');
  let s=await f.read();assert.deepEqual(s.contactPage.provider.intents,['send-message','add-contact']);let root=render(contactPage,s);assert.ok(root.textContent.includes('will be sent to'));assert.equal(f.nav.length,0);
  await f.act(new ContinueWithProvider({intent:'send-message'}));assert.equal(f.nav[0],'https://other.example/console?bindle_intent='+encodeURIComponent('web+bindle://send-message?contact-url='+encodeURIComponent(link)));
  for(const broken of [{...manifest,features:{'intents.v2':manifest.features['intents.v1']}},{...manifest,features:{'intents.v1':{...manifest.features['intents.v1'],login_endpoint:'https://evil.example/console'}}},{...manifest,features:{'intents.v1':{...manifest.features['intents.v1'],login_endpoint:'http://other.example/console'}}},{...manifest,features:{'intents.v1':{intents:['other'],login_endpoint:'https://other.example/console'}}},{...manifest,version:'9'}]){reply=()=>new Response(JSON.stringify(broken),{headers:{'content-type':'application/json'}});f.nav.length=0;await f.act(new DiscoverProvider({values:{handle:'alex@other.example'}}));const s=await f.read();assert.equal(s.contactPage.provider,null);assert.ok(String(s.contactPage.providerError).includes('other.example'));await f.act(new ContinueWithProvider({intent:'send-message'}));assert.equal(f.nav.length,0);assert.ok(render(contactPage,s).querySelector('a.contact-intent'));}
  reply=()=>{throw new TypeError('Failed to fetch');};await f.act(new DiscoverProvider({values:{handle:'alex@other.example'}}));assert.equal((await f.read()).contactPage.provider,null);assert.equal(f.nav.length,0);
  await f.act(new DiscoverProvider({values:{handle:'me@space.example'}}));assert.deepEqual(f.nav,['/console?signin=1']);assert.deepEqual(f.saved.at(-1),{link,intent:null});
  assert.equal(f.calls.some(c=>removed.test(c.path??'')),false);
 }finally{await f.close();}
});

test('public page: preview and hand-off only; signed-in visitors open their messaging app through the intent router',async()=>{
 const f=await fixture({contactPage:page});try{let root=render(contactPage,await f.read());
  assert.equal(root.querySelector('textarea'),null);assert.deepEqual([...root.querySelectorAll('form input,form textarea')].map(n=>n.name),['handle']);
  const hrefs=[...root.querySelectorAll('a.contact-intent')].map(a=>a.getAttribute('href'));assert.deepEqual(hrefs,['web+bindle://send-message?contact-url='+encodeURIComponent(link),'web+bindle://add-contact?contact-url='+encodeURIComponent(link)]);
  assert.ok(root.textContent.includes('Sign in or sign up with 3sln.me'));assert.doesNotMatch(root.textContent,/Messages per day|Message size|Link expires|Conditional contact link/);
  await f.write({contactPage:{...page,signup:{open:true,free:false,paid:true,waitlist:true}}});root=render(contactPage,await f.read());assert.ok(root.textContent.includes('Create a paid account'));assert.equal(root.textContent.includes('Join the waitlist'),false);
  await f.write({contactPage:{...page,signup:{open:false,free:false,paid:false,waitlist:true}}});root=render(contactPage,await f.read());assert.ok([...root.querySelectorAll('a')].some(a=>a.getAttribute('href')==='/console?waitlist=1'));
  await f.act(new ContactAuth({mode:'signin'}));await f.act(new ContactAuth({mode:'paid'}));assert.deepEqual(f.saved,[{link,intent:null},{link,intent:null}]);assert.deepEqual(f.nav,['/console?signin=1','/console?signup=1&plan=paid']);
  // Signed in without intents: nothing to hand off from here, and the page says where to continue.
  await f.write({session:{account}});root=render(contactPage,await f.read());assert.equal(root.textContent.includes('Sign in or sign up'),false);assert.ok(root.textContent.includes('Signed in as ⁨n.ab@space.example⁩'));
  assert.equal([...root.querySelectorAll('button')].some(b=>b.textContent==='Open in your messaging app'),false);assert.ok(root.querySelector('.contact-signed-in [role=status]'));
  await f.act(new ContactHandoff({intent:'send-message'}));assert.equal(f.nav.length,2);assert.match(String((await f.read()).error),/can’t open messaging apps from here/);
  // With intents: both hand-offs go to the intent router, which asks which app to use.
  await f.write(withIntents({...(await f.read()),error:''}));root=render(contactPage,await f.read());assert.deepEqual([...root.querySelectorAll('.contact-signed-in button')].map(b=>b.textContent),['Open in your messaging app','Add to contacts']);
  await f.act(new ContactHandoff({intent:'send-message'}));await f.act(new ContactHandoff({intent:'add-contact'}));await f.act(new ContactHandoff({intent:'pay'}));assert.equal(f.nav.length,4);for(const target of f.nav.slice(2))assert.match(target,/^\/i#bintent=[A-Za-z0-9_-]+$/);
  const es=render(contactPage,await f.read(),'es');assert.notEqual(createLocalization({locale:'es'}).t('Open in your messaging app'),'Open in your messaging app');assert.ok(es.textContent.includes(createLocalization({locale:'es'}).t('Open in your messaging app')));
  assert.equal(f.calls.some(c=>removed.test(c.path??'')),false);
 }finally{await f.close();}
});

test('console arrival hands a pending link to the intent router, or explains where to continue; never composes',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account}});
 try{f.handoff({link,intent:'send-message'});await f.act(new StartHandoff());let s=await f.read();assert.match(s.notice,/Open this contact link in your messaging app/);assert.equal(s.view,'inbox');assert.equal('handoff' in s,false);
  await f.write(withIntents(await f.read()));f.handoff({link,intent:'add-contact'});await f.act(new StartHandoff());assert.match(f.nav.at(-1),/^\/i#bintent=/);
  f.handoff({link,intent:null});await f.act(new StartHandoff());assert.match(f.nav.at(-1),/^\/i#bintent=/);assert.equal(f.nav.length,2);
  // A link the intent router already routed back here (the built-in handler) must not loop back to the router.
  f.handoff({link,intent:'send-message',fromIntent:true});await f.act(new StartHandoff());assert.equal(f.nav.length,2);assert.match((await f.read()).notice,/Open this contact link in your messaging app/);
  f.handoff({foreign:true,intent:'add-contact'});await f.act(new StartHandoff());assert.match((await f.read()).notice,/other services/);assert.equal(f.nav.length,2);
  f.handoff({lost:true});await f.act(new StartHandoff());assert.match((await f.read()).notice,/expired/);
  await f.write({session:null,config:base.config});f.handoff({link,intent:'add-contact'});await f.act(new StartHandoff());assert.deepEqual(f.saved.at(-1),{link,intent:'add-contact'});assert.equal((await f.read()).auth,'login');
  assert.equal(f.calls.length,0,'arrival calls no API at all');
 }finally{await f.close();}
});

test('seeded arrivals: only the same link ever reaches the intent router, and no API is called',async()=>{
 await forEachSeed(60,async random=>{
  const f=await fixture({route:{kind:'home'},session:random.chance(.8)?{account:random.pick([account,other])}:null,config:{...base.config,intentLinksEnabled:random.chance(.6)}});
  try{for(let step=0;step<6;step++){const pending=random.pick([null,{lost:true},{foreign:true,intent:'send-message'},{link,intent:random.pick(['send-message','add-contact',null,'pay'])},{link,intent:'send-message',fromIntent:true}]);f.handoff(pending);await f.act(new StartHandoff());
    if(random.chance(.3))await f.write({session:random.chance(.5)?{account}:null});if(random.chance(.2))await f.write({config:{...base.config,intentLinksEnabled:random.chance(.5)}});}
   for(const target of f.nav){assert.match(target,/^\/i#bintent=[A-Za-z0-9_-]+$/);}
   assert.equal(f.calls.length,0);const s=await f.read();assert.notEqual(s.view,'contact-send');assert.equal('handoff' in s,false);for(const entry of f.saved)assert.equal(entry.link,link);
  }finally{await f.close();}
 });
});

test('developer contact: occupant mode only; the legacy shape and malformed links are unavailable',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account}});try{
  f.api.get=async()=>({available:true,url:link,expiresAt:Date.now()+86400000,eligibility:{state:'eligible'}});await f.act(new LoadDeveloperContact());let state=await f.read();assert.deepEqual(state.developerContact,{available:false,reason:'contact-unavailable'});assert.equal(f.secrets.developerContactURL,null);
  f.api.get=async()=>({available:true,mode:'occupant',intent:'send-message',url:link,expiresAt:Date.now()+86400000,policy:'https://3sln.example/policies/developer-contact/v1',recipientBadge:{role:'developer'},eligibility:{state:'ineligible',reason:'paid-required'}});await f.act(new LoadDeveloperContact());state=await f.read();assert.equal(state.developerContact.eligibility.state,'ineligible');assert.equal(f.secrets.developerContactURL.url,link);assert.equal(JSON.stringify(state).includes(meta),false);
  const root=render(developerContact,state);assert.ok(root.textContent.includes('not currently eligible'));assert.ok(root.textContent.includes('Developer contact is currently available to paid accounts.'));
  f.api.get=async()=>({available:false,reason:'developer-unavailable'});await f.act(new LoadDeveloperContact());assert.match(render(developerContact,await f.read()).textContent,/not ready to receive messages/);
  f.api.get=async()=>({available:true,mode:'occupant',url:link.replace('bindle_meta','sig'),eligibility:{state:'eligible'}});await f.act(new LoadDeveloperContact());assert.match((await f.read()).error,/not available/);
 }finally{await f.close();}
});

test('developer contact hands off a send-message intent, or opens the landing page without intents, in every locale',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account}});try{f.api.get=async()=>({available:true,mode:'occupant',intent:'send-message',url:link,expiresAt:Date.now()+86400000,eligibility:{state:'eligible',tier:'free'}});await f.act(new LoadDeveloperContact());const state=await f.read();assert.equal(state.developerContact.mode,'occupant');
  const intents=withIntents(state);
  const en=render(developerContact,intents);assert.ok(en.textContent.includes('Write with your messaging app'));assert.ok(en.textContent.includes('Your messaging app opens to write to the developer.'));assert.equal(en.textContent.includes('Open developer contact'),false);
  const es=render(developerContact,intents,'es');assert.ok(es.textContent.includes('Escribir con tu app de mensajería'));assert.equal(es.textContent.includes('Write with your messaging app'),false);
  // Review I2: without intents the button opens the link's landing page, so the copy is the link copy in every locale.
  const enOff=render(developerContact,state);assert.ok(enOff.textContent.includes('Open developer contact'));assert.ok(enOff.textContent.includes('The contact link opens'));assert.equal(enOff.textContent.includes('Write with your messaging app'),false);
  const t=createLocalization({locale:'es'}).t,esOff=render(developerContact,state,'es');for(const source of ['Open developer contact','The contact link opens, so you can continue in your messaging app. Tags identify your plan and topic; they do not guarantee a response time.']){assert.notEqual(t(source),source);assert.ok(esOff.textContent.includes(t(source)));}
  await f.act(new OpenDeveloperContact());assert.equal(f.nav.at(-1),link);await f.write(withIntents(await f.read()));await f.act(new OpenDeveloperContact());assert.match(f.nav.at(-1),/^\/i#bintent=/);
 }finally{await f.close();}
});

test('developer contact rate limit is mapped from a code to translated client copy',async()=>{const f=await fixture({route:{kind:'home'},session:{account}});try{f.api.get=async()=>{throw Object.assign(Error('rate_limited'),{code:'rate_limited',status:429});};await f.act(new LoadDeveloperContact());const state=await f.read();assert.equal(state.error,'Please wait before checking again.');assert.equal(state.developerContactLoading,false);assert.equal(createLocalization({locale:'es'}).t(state.error),'Espera antes de volver a comprobarlo.');}finally{await f.close();}});

test('tag pills render owner labels literally and system tags with system and suspected classes',()=>{
 const state={data:{tagLabels:{labels:{'t.abc':'Clients'}}}},root=document.createElement('div');dodo.reconcile(root,[localize(tagPill('t.abc',state),createLocalization({locale:'es'})),localize(tagPill('sys:spam',state),createLocalization({locale:'en'})),localize(tagPill('sys:suspected.spam',state),createLocalization({locale:'en'}))]);
 const [user,system,suspected]=root.children;assert.equal(user.textContent,'Clients');assert.equal(user.getAttribute('translate'),'no');assert.ok(system.classList.contains('system-tag'));assert.equal(system.classList.contains('suspected-tag'),false);assert.ok(suspected.classList.contains('suspected-tag'));assert.equal(suspected.textContent,'Suspected Spam');
});

test('rules carry addTags/removeTags but no contact-link match, and sign-out removes this device push subscription',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account},data:{rules:[]}});try{const calls=[];f.api.request=async(p,b,m)=>{calls.push({path:p,body:b,method:m});return {};};f.api.get=async()=>({rules:[]});
  await f.act(new CreateRule({values:{name:'R',grantId:contactId,addTags:'a, b',removeTags:'sys:suspected.social',classification:'unclassified'}}));const rule=calls[0].body.rules[0];assert.deepEqual(rule.actions.addTags,['a','b']);assert.deepEqual(rule.actions.removeTags,['sys:suspected.social']);assert.equal(rule.actions.tags,undefined);assert.equal('grantId' in rule.match,false);
  await f.act(new SignOut());assert.deepEqual(calls.at(-1),{path:'/api/auth/logout',body:{pushSubscription:'P'.repeat(43)},method:undefined});
 }finally{await f.close();}
});

test('Spanish catalogue covers security, device access, contact hand-off, browser permission and every shortcut command',async()=>{const {catalogues}=await import('../../packages/i18n/catalogues.mjs'),{builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');const sources=['Password enabled','Open in your messaging app','Sharing on your contact links','Choose shared fields','App sign-ins and preference grants are listed separately. Revoking a sign-in ends its refresh and access tokens.','Browser permission: denied.','Browser permission: granted.','Browser permission: not requested.','Browser permission: unavailable.',...builtInModules.flatMap(module=>module.contributions.commands??[]).map(command=>command.title)];for(const source of sources){assert.equal(catalogues.en[''][source],source,source+' English coverage');assert.equal(typeof catalogues.es[''][source],'string',source+' Spanish coverage');assert.notEqual(catalogues.es[''][source],source,source+' Spanish translation');}
 for(const gone of ['active links','New contact link','Open conversations','Save signed contact','Edit this link’s tags.','Your message is on its way.'])assert.equal(gone in catalogues.en[''],false,gone+' left with the removed UI');});
