// Signaling owner pages (console view `signaling`, apps/web/src/ui/signaling-pages.mjs; signaling.md rev 3.2 §20.1.4,
// §5.8, §14.1, §4.3) through the real console renderer, portal modules and catalogue in happy-dom: every page and
// decision surface in English and Spanish without literal "null"/"undefined" attributes; the disclosures each page
// must show; decision controls that stay aria-disabled until armed and send their native click; nothing preselected;
// the by-peer list; live offers without tokens; and nothing at all while the account's signaling feature is off.
// Real-browser layout, keyboard and arming checks are tests/browser/signaling-pages-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {default:createApp}=await import('../../apps/web/src/ui/release-app.mjs');
const {default:localizeTree}=await import('../../apps/web/src/ui/localize.mjs');
const {createLocalization}=await import('../../apps/web/src/shared/i18n.mjs');
const {builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');
const {compilePortalModules,composePortalViews}=await import('../../packages/portal/index.mjs');
const {signalingPageDialog}=await import('../../apps/web/src/ui/signaling-pages.mjs');
const {catalogues}=await import('../../packages/i18n/catalogues.mjs');
const F=await import('../helpers/signaling-pages-fixture.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const registry=compilePortalModules(builtInModules),navigation=registry.list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
function state({locale='en',page='overview',enabled=true,modal=null,...extra}={}){
 const account={id:F.OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{signalingEnabled:enabled}};
 return {locale,view:'signaling',modal,navigation,brand:{name:'3sln.me',host:'space.example'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],session:{account,sessionContext:'ctx'},
  config:{origin:F.ORIGIN,termsVersion:'2026-10-11',integrationsEnabled:true},data:{account,features:{signalingEnabled:enabled},messages:[],views:[],contacts:[],collections:[],resources:[],rules:[],devices:[],pushDevices:[],credentials:[],grants:[],storage:{plan:'free',usedBytes:0,storageBytes:1}},
  signaling:{...structuredClone(F.SETTINGS_WITH_PEERS),owner:F.OWNER,generation:1,status:'loaded'},signalingPage:{owner:F.OWNER,generation:1,page,params:{},status:'ready',review:null,refusal:null,detail:null,service:null,armed:false,...extra}};
}
const SURFACES=[
 ['overview',{}],['approve',{review:F.APPROVE_REVIEW}],['approve',{review:F.SYNC_REVIEW}],['approve',{status:'error'}],['approve',{done:{action:'session-approve'}}],['auto-connect',{review:{...F.SYNC_REVIEW,action:'session-auto-connect'}}],
 ['pair',{}],['pair',{params:{client:F.APP,kind:F.CHAT}}],['pair',{refusal:{code:'pairing_exists',existing:F.PENDING_ID}}],['pair',{review:F.PAIR_REVIEW}],['pair',{review:F.OWN_PAIR_REVIEW}],
 ['pairing',{detail:F.DETAIL}],['pairing',{detail:F.LIVE_DETAIL}],['pairing',{detail:F.DETAIL,review:F.ACTIVATE_REVIEW}],['pairing',{detail:F.LIVE_DETAIL,review:F.RENEW_REVIEW}],['pairing',{status:'loading'}],
 ['service',{service:F.SERVICE}],['service',{service:F.SERVICE,review:F.SERVICE_REVIEW}],['service',{service:{...F.SERVICE,designated:true,longOffers:2}}],['service',{service:{...F.SERVICE,eligible:false}}],['service',{status:'loading'}],
 ['overview',{status:'error'}]];
function renderer(locale,{seen,missing}={}){
 const base=createLocalization({locale,onMissing:(_,id)=>missing?.add(id)}),localization={...base,t:(key,variables)=>{seen?.add(String(key));return base.t(key,variables);}};
 const localize=tree=>localizeTree(tree,localization),views=composePortalViews(registry,{t:localization.t,number:localization.number,date:localization.date,localize}),app=createApp({views,localize}),root=document.createElement('main');
 return {root,render:s=>{dodo.reconcile(root,[app(s)]);return root;}};
}
const literalAttributes=root=>[...root.querySelectorAll('*')].flatMap(node=>[...node.attributes].filter(a=>a.value==='null'||a.value==='undefined').map(a=>`${node.tagName.toLowerCase()}[${a.name}="${a.value}"]`));
const intents=root=>{const events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));return events;};
const PUNCTUATION=/^[\s·()↔“”'’,.:-]*$/;

test('every page and decision surface renders in English and Spanish without "null" or "undefined" attributes, and the Spanish catalogue covers them',async()=>{
 const SOURCE=(await readFile(new URL('../../apps/web/src/ui/signaling-pages.mjs',import.meta.url),'utf8'))+(await readFile(new URL('../../apps/web/src/bl/signaling-pages.mjs',import.meta.url),'utf8'));
 for(const locale of ['en','es']){
  const missing=new Set(),{render,root}=renderer(locale,{missing}),bad=[];
  for(const [page,extra] of SURFACES){render(state({locale,page,...extra}));bad.push(...literalAttributes(root).map(x=>`${page}: ${x}`));assert.ok(root.querySelector('.signaling-pages'),page);}
  render(state({locale,page:'service',service:{...F.SERVICE,designated:true,longOffers:2},modal:{kind:'signaling-page-confirm',action:'service-remove'}}));
  assert.deepEqual(bad,[],locale);
  if(locale==='es')assert.deepEqual([...missing].filter(id=>SOURCE.includes(`'${id}'`)&&!PUNCTUATION.test(id)),[],'every interface string of the pages has a Spanish entry');
 }
 // Every catalogue key this surface uses exists in both languages.
 const keys=Object.keys(catalogues.en['']).filter(k=>SOURCE.includes(`'${k}'`));assert.ok(keys.length>150);
 for(const k of keys)assert.ok(Object.hasOwn(catalogues.es[''],k),k);
});

test('approval page: the disclosures of §20.1.4 and intents §7.1, an unchecked auto-connect control, links to activatable pairings, and an armed decision',()=>{
 const {render}=renderer('en');let root=render(state({page:'approve',review:F.APPROVE_REVIEW})),events=intents(root);
 const text=root.querySelector('.signaling-decision').textContent;
 for(const pattern of [/For your account @n\.fixture/,/Studio/,/Verified address: https:\/\/app\.example/,/“Chat”/,/Described by kinds\.example\. This provider has not reviewed this description\./,/“Chat sessions\.”/,
  /Between your own devices, and with other people and accounts/,/A direct connection/,/Small data messages/,/Personal data/,/Risk\s*Medium/,/This app will see who is connecting \(their verified identity\), the app they say they use, and the details sent/,
  /Pairings waiting for this approval/,/Approving does not activate them/,/Desk to phone/])assert.match(text,pattern);
 assert.doesNotMatch(text,/service organization/,'no service disclosure for a person\'s app');
 assert.equal(root.querySelector('input[name=autoConnect]'),null,'auto-connect only for a self kind');
 const decide=root.querySelector('[data-signaling-decide]');assert.equal(decide.textContent,'Approve');assert.equal(decide.getAttribute('aria-disabled'),'true','unarmed');assert.equal(decide.getAttribute('aria-describedby'),'signaling-arming-help');
 assert.notEqual(root.ownerDocument.activeElement,decide,'never default focus');
 decide.click();const sent=events.at(-1);assert.equal(sent.kind,'signaling-decide');assert.equal(sent.autoConnect,false);assert.ok(sent.nativeEvent,'the native click goes with the intent (release.mjs requires a trusted one)');
 [...root.querySelectorAll('.signaling-decision button')].find(b=>b.textContent==='Review activation').click();assert.deepEqual(events.at(-1),{kind:'signaling-page',page:'pairing',params:{id:'pr_'+'p'.repeat(22)}});
 [...root.querySelectorAll('.signaling-decision button')].find(b=>b.textContent==='Cancel').click();assert.deepEqual(events.at(-1),{kind:'signaling-cancel-review'});
 // Armed: no aria-disabled; a self kind of a service organization: the service disclosure and an unchecked box.
 root=render(state({page:'approve',review:F.SYNC_REVIEW,armed:true,surface:F.SYNC_REVIEW.review}));events=intents(root);
 const box=root.querySelector('input[name=autoConnect]');assert.equal(box.checked,false,'nothing preselected');
 assert.match(root.textContent,/open offers lasting up to 90 days and single-use offers for one person lasting up to 7 days/);assert.match(root.textContent,/already approved for version 0\.[\s\S]*more kinds of data/);
 assert.equal(root.querySelector('[data-signaling-decide]').hasAttribute('aria-disabled'),false);
 box.checked=true;root.querySelector('[data-signaling-decide]').click();assert.equal(events.at(-1).autoConnect,true);
});

test('pairing creation page: nothing preselected; the review shows the §5.8 disclosures for a cross-entity and an own-entity pairing',()=>{
 const {render}=renderer('en');let root=render(state({page:'pair'}));
 assert.deepEqual([...root.querySelectorAll('input[type=radio]')].filter(r=>r.checked).map(r=>r.name),[],'no radio choice is made for the owner');
 assert.deepEqual([...root.querySelectorAll('select[name=kind],select[name=local],select[name=peerApp]')].map(s=>s.value),['','',''],'no app or kind is chosen');
 assert.deepEqual([...root.querySelectorAll('select[name=kind] option')].map(o=>o.textContent),['Choose…','Chat','Device sync']);
 root=render(state({page:'pair',params:{client:F.APP,kind:F.CHAT}}));assert.deepEqual([root.querySelector('select[name=kind]').value,root.querySelector('select[name=local]').value],[F.CHAT,F.APP],'an app\'s own entry may name itself and a kind');
 root=render(state({page:'pair',refusal:{code:'pairing_exists',existing:F.PENDING_ID}}));const events=intents(root);
 assert.match(root.querySelector('[role=alert]').textContent,/already have a pairing with this account/);root.querySelector('[role=alert] button').click();assert.deepEqual(events.at(-1),{kind:'signaling-page',page:'pairing',params:{id:F.PENDING_ID}});
 root=render(state({page:'pair',review:F.PAIR_REVIEW}));let text=root.textContent;
 for(const pattern of [/990e8400-e29b-41d4-a716-000000000009/,/at far\.example/,/Their provider\s*https:\/\/far\.example/,/Studio starts connections; the other side answers\./,/will connect automatically, with no prompt, whenever the side that starts connections is running/,
  /may open a direct connection with Studio without asking, and exchange data with it/,/That data can include:\s*Personal data/,/can tell when Studio is running/,/This provider can enforce only your side of this pairing/,/Expires\s*[A-Z][a-z]{2} \d+, \d{4}/,/Create and activate pairing/])assert.match(text,pattern);
 root=render(state({page:'pair',review:F.OWN_PAIR_REVIEW}));text=root.textContent;
 for(const pattern of [/Your other app\s*Other app/,/Either side starts connections\./,/whenever either is running/,/Not approved for this type/,/stays inactive until you activate it/,/No expiry/])assert.match(text,pattern);
 assert.doesNotMatch(text,/can tell when|enforce only your side/,'own-entity pairings carry neither peer disclosure');
 assert.equal(root.querySelector('[data-signaling-decide]').textContent,'Create pairing');
});

test('pairing page: P1 status, activation only when every party qualifies, renewal and re-confirmation reviews, relabel and removal',()=>{
 const {render}=renderer('en');let root=render(state({page:'pairing',detail:F.DETAIL})),events=intents(root);
 assert.match(root.textContent,/Not active yet/);assert.match(root.textContent,/Every app has its own access and approval/);
 const review=[...root.querySelectorAll('button')].find(b=>b.textContent==='Review activation');assert.equal(review.disabled,false);review.click();assert.deepEqual(events.at(-1),{kind:'signaling-review',action:'pairing-activate'});
 root=render(state({page:'pairing',detail:{...F.DETAIL,parties:[{client_id:F.APP,connected:true,approved:false}]}}));
 assert.equal([...root.querySelectorAll('button')].find(b=>b.textContent==='Review activation').disabled,true,'available only once every party holds what P1 requires');
 assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='Review approval'),'a link to the missing approval');
 root=render(state({page:'pairing',detail:F.LIVE_DETAIL}));events=intents(root);const text=root.textContent;
 assert.match(text,/Active/);assert.match(text,/Version 3 of this connection type is available[\s\S]*more kinds of data/);
 assert.ok(root.querySelector('form select[name=days]'),'renewal for a cross-entity pairing');
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Remove pairing').click();assert.deepEqual(events.at(-1),{kind:'open-modal',modal:{kind:'signaling-confirm',action:'pairing-remove',input:{id:F.PENDING_ID}}});
 assert.equal(root.querySelector('input[name=label]').getAttribute('translate'),'no');
 root=render(state({page:'pairing',detail:F.DETAIL,review:F.ACTIVATE_REVIEW}));assert.equal(root.querySelector('[data-signaling-decide]').textContent,'Activate pairing');
 root=render(state({page:'pairing',detail:F.LIVE_DETAIL,review:F.RENEW_REVIEW}));assert.equal(root.querySelector('[data-signaling-decide]').textContent,'Renew pairing');assert.match(root.textContent,/The pairing will now expire on/);
 root=render(state({page:'pairing',detail:F.DETAIL,review:{...F.ACTIVATE_REVIEW,disclosure:{...F.ACTIVATE_REVIEW.disclosure,activateNow:false}}}));assert.equal(root.querySelector('[data-signaling-decide]'),null,'no activation control while a party is missing');
 // A pairing removed elsewhere: the page says so instead of acting on stale data.
 const gone=state({page:'pairing',detail:F.DETAIL});gone.signaling.pairings=[];root=render(gone);assert.match(root.textContent,/This pairing no longer exists\./);
});

test('overview: pairings by peer principal (handle only with a verified binding), own-app pairings, pending activations and live offers without tokens',()=>{
 const {render}=renderer('en'),root=render(state()),events=intents(root);
 const peers=[...root.querySelectorAll('.signaling-peer h3')].map(h=>h.textContent);
 assert.equal(peers.length,2,'one group per peer principal');
 assert.ok(peers.includes('@river'),'a verified same-host handle');assert.ok(peers.some(p=>/990e8400-e29b-41d4-a716-000000000009 at far\.example/.test(p)),'a foreign principal in full');
 assert.match(root.querySelector('#signaling-own-title').parentElement.textContent,/Desk to phone/);
 assert.match(root.querySelector('#signaling-pending-title').parentElement.textContent,/Bob/);
 const offers=root.querySelector('#signaling-offers-title').parentElement;assert.match(offers.textContent,/Anyone with the offer[\s\S]*3 of 10 uses spent/);assert.doesNotMatch(offers.textContent,/of_open|of_bound/);
 [...offers.querySelectorAll('button')].find(b=>b.textContent==='Revoke every offer').click();assert.deepEqual(events.at(-1),{kind:'open-modal',modal:{kind:'signaling-confirm',action:'revoke-offers',input:{all:true}}});
 [...root.querySelectorAll('.page-heading button')].find(b=>b.textContent==='Pair apps').click();assert.deepEqual(events.at(-1),{kind:'signaling-page',page:'pair',params:{}});
 assert.equal(root.querySelector('.breadcrumb').textContent.includes('Direct connections'),true);
});

test('service designation page and its removal dialog; nothing renders while the signaling feature is off',()=>{
 const {render}=renderer('en');let root=render(state({page:'service',service:F.SERVICE,review:F.SERVICE_REVIEW}));
 assert.match(root.textContent,/open offers lasting up to 90 days and offers for one person lasting up to 7 days[\s\S]*can tell when the app is running/);assert.equal(root.querySelector('[data-signaling-decide]').textContent,'Designate as a service');
 root=render(state({page:'service',service:{...F.SERVICE,designated:true,longOffers:2}}));const events=intents(root);assert.match(root.textContent,/revokes 2 offers that last longer than 15 minutes/);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Remove designation').click();assert.deepEqual(events.at(-1),{kind:'open-modal',modal:{kind:'signaling-page-confirm',action:'service-remove'}});
 const dialog=signalingPageDialog(state({page:'service',service:{...F.SERVICE,designated:true,longOffers:2},modal:{kind:'signaling-page-confirm',action:'service-remove'}}));assert.equal(dialog.title,'Remove the service designation?');
 assert.equal(signalingPageDialog(state({modal:{kind:'signaling-page-confirm',action:'other'}})),null);
 root=render(state({page:'service',service:{...F.SERVICE,eligible:false}}));assert.match(root.textContent,/Only an organization can be a service/);assert.equal([...root.querySelectorAll('button')].some(b=>/designation/i.test(b.textContent)),false);
 for(const page of ['overview','approve','pair']){root=render(state({page,enabled:false,review:F.APPROVE_REVIEW}));assert.match(root.querySelector('.signaling-pages').textContent,/This page is not available right now\./);assert.equal(root.querySelector('[data-signaling-decide]'),null);}
});
