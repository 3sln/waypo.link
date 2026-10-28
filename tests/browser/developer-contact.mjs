import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
// "Message the developer" after contacts phase 4 (contacts spike CR-C5/CR-C8; provisional, unsigned): an eligibility
// read, a minted single-use `connect` invitation bound to this account, and a hand-off to the user's own messaging app
// through the provider's `/i#bintent=` route when intent links are on, or the web+bindle scheme URL otherwise. The
// contact-link landing, the console contact hand-off and the occupant developer card are gone.
const window=new Window({url:'https://space.example/'});
const names=['document','HTMLElement','CustomEvent','Event','EventTarget','ErrorEvent','Node','Element','FormData','location','history','navigator','sessionStorage','MutationObserver'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)Object.defineProperty(globalThis,name,{value:window[name],configurable:true,writable:true});
const {Engine,Provider,dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {LoadDeveloperContact,OpenDeveloperContact,CopyDeveloperContact}=await import('../../apps/web/src/bl/incoming.mjs');
const {SignOut,CreateRule}=await import('../../apps/web/src/bl/release.mjs');
const {developerContact}=await import('../../apps/web/src/ui/release-developer-contact.mjs');
const {tagPill}=await import('../../apps/web/src/ui/tag-pill.mjs');
const {default:localize}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../packages/i18n/index.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)Object.defineProperty(globalThis,name,{value:previous[name],configurable:true,writable:true});});
const origin='https://space.example',contactId='11111111-1111-4111-8111-111111111111';
const account={id:'550e8400-e29b-41d4-a716-446655440001',handle:'n.ab'},other={id:'550e8400-e29b-41d4-a716-446655440002',handle:'n.cd'};
const render=(view,state,locale='en')=>{const root=document.createElement('main');dodo.reconcile(root,[localize(view(state),createLocalization({locale}))]);return root;};
const base={loading:false,locale:'en',view:'inbox',config:{origin,localDevelopment:true,handleOriginHost:'space.example'},brand:{name:'3sln.me',host:'space.example'},route:{kind:'home'}};
const withIntents=state=>({...state,config:{...state.config,intentLinksEnabled:true}});
async function fixture(patch={},api={}){const secrets={},calls=[],nav=[],copied=[];
 const browser={origin,id:()=>crypto.randomUUID(),now:()=>Date.now(),secret:k=>secrets[k],storeSecret:(k,v)=>secrets[k]=v,navigate:u=>nav.push(u),consumeSubmission(){throw Error('none');},restoreFocus(){},clearOwnerContext(){},cancelDeviceEntry(){},setCaptchaAction(){},installCaptcha(){},focus(){},copy:async text=>{copied.push(text);},pushSubscriptionId:async()=>'P'.repeat(43)};
 const client={get:async p=>{calls.push({path:p});throw Error(p);},request:async(p,b,m)=>{calls.push({path:p,body:b,method:m});throw Error(p);},...api};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(client),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const read=()=>engine.container.use(['state'],({state})=>state.snapshot()),write=p=>engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,p)));await write({...base,...patch});
 return {engine,secrets,calls,nav,copied,browser,api:client,read,write,act:a=>engine.dispatch(a).next('complete'),close:()=>engine.dispose()};}
const CONNECT={artefact:'https://spec.bindle.example/messaging/v1/intents/connect',version:1,digest:'sha256-oCyJ6fKE_vJrmdRY5bF5U_R8t_pfE2HZoZy81yG7H-g'},inviteToken='T'.repeat(32);
const connectAnswer=async({kind=CONNECT,expiresAt=Date.now()+3600000,url,route}={})=>{const {encodeIntent}=await import('../../packages/intents/format.mjs'),exp=Math.floor(expiresAt/1000),value=encodeIntent({bintent:1,kind,data:{inviter:{iss:origin,sub:'550e8400-e29b-41d4-a716-446655440009'},token:inviteToken,delegation:'a.b.c',expires_at:exp},exp});return {intent:{value,url:url??'web+bindle://intent?bintent='+value,...route===undefined?{}:{route:typeof route==='function'?route(value):route}},expiresAt:exp*1000};};
const buttons=root=>[...root.querySelectorAll('button')].map(b=>b.textContent);

test('developer contact: an eligibility read only; ineligible accounts get no button and never mint; old link fields are dropped',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account}});try{
  f.api.get=async()=>({available:true,eligibility:{state:'ineligible',reason:'paid-required',tier:'free'},recipientBadge:{role:'developer'}});await f.act(new LoadDeveloperContact());let state=await f.read();
  assert.deepEqual(state.developerContact,{available:true,eligibility:{state:'ineligible',reason:'paid-required',tier:'free'},recipientBadge:{role:'developer'}});assert.equal(f.secrets.developerContactURL,null);
  const root=render(developerContact,state);assert.ok(root.textContent.includes('not currently eligible'));assert.ok(root.textContent.includes('Developer contact is currently available to paid accounts.'));assert.deepEqual(buttons(root),['Check eligibility again']);
  await f.act(new OpenDeveloperContact());assert.equal(f.calls.some(c=>c.method==='POST'),false);assert.deepEqual(f.nav,[]);
  f.api.get=async()=>({available:false,reason:'developer-unavailable'});await f.act(new LoadDeveloperContact());assert.match(render(developerContact,await f.read()).textContent,/not ready to receive messages/);
  // A pre-CR-C5 occupant answer: the link, its URL and policy never reach state; only eligibility does.
  const occupantLink=`${origin}/users/ray/contact/${contactId}?bindle_meta=occupant.meta.sig`;
  f.api.get=async()=>({available:true,mode:'occupant',intent:'send-message',url:occupantLink,policy:'https://3sln.example/policies/developer-contact/v1',eligibility:{state:'eligible'}});await f.act(new LoadDeveloperContact());state=await f.read();
  assert.deepEqual(state.developerContact,{available:true,eligibility:{state:'eligible'}});assert.equal(JSON.stringify(state).includes('occupant.meta.sig'),false);assert.equal(f.secrets.developerContactURL,null);
  f.api.get=async()=>({available:true,eligibility:{state:'maybe'}});await f.act(new LoadDeveloperContact());assert.equal((await f.read()).developerContact.eligibility.state,'unavailable');
 }finally{await f.close();}
});

test('Message the developer mints a bound invitation and hands it off; the token stays in browser secret storage, in every locale',async()=>{
 const f=await fixture({route:{kind:'home'},session:{account}});try{
  f.api.get=async()=>({available:true,eligibility:{state:'eligible',tier:'free'},recipientBadge:{role:'developer'}});await f.act(new LoadDeveloperContact());let state=await f.read();
  const en=render(developerContact,state);assert.deepEqual(buttons(en),['Message the developer','Check eligibility again']);assert.ok(en.textContent.includes('one-time invitation'));
  const t=createLocalization({locale:'es'}).t,es=render(developerContact,withIntents(state),'es');for(const source of ['Message the developer','Your messaging app opens with a one-time invitation from the developer, valid for one hour. The developer sees your plan as a label; it does not guarantee a response time.']){assert.notEqual(t(source),source);assert.ok(es.textContent.includes(t(source)));}
  const answer=await connectAnswer(),posts=[];f.api.request=async(p,b,m)=>{posts.push([p,b,m]);return answer;};
  // Without intents the scheme URL goes to the browser's registered messaging app.
  await f.act(new OpenDeveloperContact());assert.deepEqual(posts,[['/api/developer-contact',{},'POST']]);assert.equal(f.nav.at(-1),answer.intent.url);
  state=await f.read();assert.deepEqual(state.developerContact.invitation,{expiresAt:answer.expiresAt});for(const secret of [inviteToken,answer.intent.value])assert.equal(JSON.stringify(state).includes(secret),false);
  assert.deepEqual(f.secrets.developerContactURL,{...answer.intent,expiresAt:answer.expiresAt,owner:account.id,generation:state.beamGeneration??0});
  const minted=render(developerContact,state);assert.deepEqual(buttons(minted),['Open in your messaging app','Copy invitation link','Check eligibility again']);assert.ok(minted.textContent.includes('works once'));
  // Reopening reuses this session's unexpired invitation; without a minted route it keeps the scheme URL.
  await f.write(withIntents(state));await f.act(new OpenDeveloperContact());assert.equal(posts.length,1);assert.equal(f.nav.at(-1),answer.intent.url);
  // Rechecking eligibility forgets the invitation.
  await f.act(new LoadDeveloperContact());assert.equal(f.secrets.developerContactURL,null);assert.equal((await f.read()).developerContact.invitation,undefined);
  // Malformed answers are refused without navigation or storage.
  const navs=f.nav.length;
  for(const bad of [await connectAnswer({url:'web+bindle://intent?bintent=other'}),await connectAnswer({kind:{...CONNECT,artefact:'https://spec.bindle.example/intents/send-message/v1'}}),await connectAnswer({expiresAt:Date.now()+7200000}),{intent:{value:'!',url:'web+bindle://intent?bintent=!'},expiresAt:Date.now()+1000}]){
   f.api.request=async()=>bad;await f.write({error:''});await f.act(new OpenDeveloperContact());assert.match((await f.read()).error,/not available right now/);assert.equal(f.nav.length,navs);assert.equal(f.secrets.developerContactURL,null);}
  // The server's recheck wins: an ineligible answer updates the card and explains.
  f.api.request=async()=>{throw Object.assign(Error('not_eligible'),{code:'not_eligible',status:403});};await f.write({error:''});await f.act(new OpenDeveloperContact());state=await f.read();
  assert.equal(state.developerContact.eligibility.state,'ineligible');assert.equal(state.error,'Your account is not currently eligible to message the developer.');assert.equal(f.nav.length,navs);
  // An account switch while minting never hands the previous owner's invitation off or stores it.
  await f.write({developerContact:{available:true,eligibility:{state:'eligible',tier:'free'}},error:''});let release;f.api.request=()=>new Promise(resolve=>{release=()=>resolve(answer);});
  const pending=f.act(new OpenDeveloperContact());while(!release)await new Promise(resolve=>setTimeout(resolve,1));await f.write({session:{account:other}});release();await pending;
  assert.equal(f.nav.length,navs);assert.equal(f.secrets.developerContactURL,null);
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

test('Spanish catalogue covers security, device access, developer contact, browser permission and every shortcut command',async()=>{const {catalogues}=await import('../../packages/i18n/catalogues.mjs'),{builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');const sources=['Password enabled','Open in your messaging app','Message the developer','App sign-ins and preference grants are listed separately. Revoking a sign-in ends its refresh and access tokens.','Browser permission: denied.','Browser permission: granted.','Browser permission: not requested.','Browser permission: unavailable.',...builtInModules.flatMap(module=>module.contributions.commands??[]).map(command=>command.title)];for(const source of sources){assert.equal(catalogues.en[''][source],source,source+' English coverage');assert.equal(typeof catalogues.es[''][source],'string',source+' Spanish coverage');assert.notEqual(catalogues.es[''][source],source,source+' Spanish translation');}
 for(const gone of ['active links','New contact link','Open conversations','Save signed contact','Edit this link’s tags.','Your message is on its way.'])assert.equal(gone in catalogues.en[''],false,gone+' left with the removed UI');});

test('with intent links on, the minted provider route opens the invitation in the intent router; the scheme URL stays the fallback',async()=>{
 const f=await fixture(withIntents({session:{account},developerContact:{available:true,eligibility:{state:'eligible'}}}));try{
  const answer=await connectAnswer({route:value=>origin+'/i#bintent='+value}),posts=[];f.api.request=async(p,b,m)=>{posts.push([p,b,m]);return answer;};
  await f.act(new OpenDeveloperContact());assert.deepEqual(posts,[['/api/developer-contact',{},'POST']]);
  assert.equal(f.nav.at(-1),origin+'/i#bintent='+answer.intent.value);assert.equal((await f.read()).error,'');
  // The bearer value and route stay in browser secret storage only.
  const state=await f.read();assert.deepEqual(f.secrets.developerContactURL,{...answer.intent,expiresAt:answer.expiresAt,owner:account.id,generation:state.beamGeneration??0});
  for(const secret of [inviteToken,answer.intent.value,answer.intent.route])assert.equal(JSON.stringify(state).includes(secret),false);
  // Reopening reuses the stored invitation and its route; copying still offers the portable scheme URL.
  await f.act(new OpenDeveloperContact());assert.equal(posts.length,1);assert.equal(f.nav.at(-1),answer.intent.route);
  await f.act(new CopyDeveloperContact());assert.deepEqual(f.copied,[answer.intent.url]);
 }finally{await f.close();}
});

test('a foreign or mismatched provider route refuses the whole minted answer: no navigation, nothing stored',async()=>{
 const f=await fixture(withIntents({session:{account},developerContact:{available:true,eligibility:{state:'eligible'}}}));try{
  const routes=[
   value=>'https://evil.example/i#bintent='+value,
   value=>'http://space.example/i#bintent='+value,
   value=>origin+'/i?bintent='+value,
   value=>origin+'/i/contact#bintent='+value,
   value=>origin+'/i#bintent='+value+'x',
   value=>origin+'/i#bintent='+value+'&next=/console',
   value=>'web+bindle://intent?bintent='+value,
   ()=>origin+'/i#bintent=AAAA',
   ()=>null,
   ()=>''];
  for(const route of routes){const answer=await connectAnswer({route});f.api.request=async()=>answer;await f.write({error:''});await f.act(new OpenDeveloperContact());
   assert.match((await f.read()).error,/not available right now/,String(answer.intent.route));assert.deepEqual(f.nav,[]);assert.equal(f.secrets.developerContactURL,undefined);}
  // Without a known document origin no route can be checked, so a routed answer is refused too.
  f.browser.origin=undefined;const answer=await connectAnswer({route:value=>origin+'/i#bintent='+value});f.api.request=async()=>answer;await f.write({error:''});await f.act(new OpenDeveloperContact());
  assert.match((await f.read()).error,/not available right now/);assert.deepEqual(f.nav,[]);
  // An unrouted answer still opens the scheme URL.
  const plain=await connectAnswer();f.api.request=async()=>plain;await f.write({error:''});await f.act(new OpenDeveloperContact());assert.deepEqual(f.nav,[plain.intent.url]);
 }finally{await f.close();}
});

test('contact-link landing is gone: a former contact URL enters no contact view, and its capability is still scrubbed',async()=>{
 const {access}=await import('node:fs/promises');
 for(const removed of ['../../apps/web/src/bl/contact-link.mjs','../../apps/web/src/ui/release-contact.mjs'])await assert.rejects(access(new URL(removed,import.meta.url)),{code:'ENOENT'});
 const {default:BrowserProvider}=await import('../../apps/web/src/providers/browser.mjs');
 const meta='aaa.bbb.ccc',contactURL=`${origin}/users/ray/contact/${contactId}?bindle_meta=${meta}&bindle_data=ddd.eee.fff`;
 try{
  sessionStorage.clear();sessionStorage.setItem('3sln-contact-handoff',JSON.stringify({link:contactURL,intent:null,expiresAt:Date.now()+60000}));
  window.happyDOM.setURL(contactURL);let provider=new BrowserProvider(),browser=await provider.obtain();
  const route=browser.route();assert.equal(route.kind,'home');assert.equal('recipient' in route,false);assert.equal(browser.secret('contactEndpoint'),undefined);
  for(const gone of ['saveContactHandoff','takeContactHandoff','peekContactHandoff','postIntent','rememberedIntentProvider'])assert.equal(gone in browser,false,gone);
  assert.equal(location.search,'');assert.equal(location.href.includes(meta),false);assert.equal(sessionStorage.getItem('3sln-contact-handoff'),null,'a stale hand-off entry is dropped unread');
  provider.dispose();
  // The legacy console bootstrap is no longer captured; the capability-shaped query is still removed from history.
  const legacy='web+bindle://send-message?contact-url='+encodeURIComponent(contactURL);
  window.happyDOM.setURL(`${origin}/console?intent=${encodeURIComponent(legacy)}#contact=${encodeURIComponent(contactURL)}&intent=send-message`);provider=new BrowserProvider();browser=await provider.obtain();
  assert.equal(browser.route().kind,'home');assert.equal(location.href.includes(meta),false);assert.equal(location.hash,'');assert.equal(location.search,'');assert.equal(sessionStorage.length,0);
  provider.dispose();
 }finally{sessionStorage.clear();window.happyDOM.setURL(origin+'/');}
 // The public page has no contact branch; a stale contact route renders no contact view.
 const {default:publicPage}=await import('../../apps/web/src/ui/release-public.mjs');
 const root=render(publicPage,{...base,route:{kind:'contact',recipient:'ray'},alerts:[]});assert.equal(/contact link|PERSONAL INVITATION|Send a message to/i.test(root.textContent),false);
});
