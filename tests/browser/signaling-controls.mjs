// Signaling owner controls re-homed into existing surfaces (signaling.md rev 3.2 §14.1, Appendix C.3), rendered
// through the real console renderer, portal modules and catalogue in happy-dom: connection privacy and the blocked
// lists in Account & security, and each app's approvals, devices, offers and pairings in Apps & integrations and in
// Connected apps, plus the confirmation dialog. English and Spanish, no literal "null"/"undefined" attribute, flag-off
// invisibility, no call UI left in core, native keyboard-reachable controls, and no widening control offered.
// Real-browser layout, keyboard and colour-scheme checks are in tests/browser/signaling-controls-browser.mjs.
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
const {signalingDialog,signalingAppControls,signalingOtherApps,signalingPrivacyPanel}=await import('../../apps/web/src/ui/signaling-controls.mjs');
const {signalingAppAnchor}=await import('../../apps/web/src/bl/signaling-controls.mjs');
const {catalogues}=await import('../../packages/i18n/catalogues.mjs');
const {SETTINGS,OWNER,ORIGIN,APP,APP2,LOOSE,CHAT,SYNC,FAR}=await import('../helpers/signaling-controls-fixture.mjs');
// Interface text this surface publishes from its Actions (bl/signaling-controls.mjs).
const await_bl=['This setting is not available right now.','Review the change in the dialog, then confirm.','These settings changed somewhere else. Review the latest choices and save again.','Your change was saved, but the latest settings could not be loaded. Reload to see them.','Connection privacy saved.','Unblocked.','Provider unblocked.','Device removed.','Offer revoked.','Offers revoked.','Pairing removed.','Connection type removed.','Automatic connection turned off.'];
// Every interface string in apps/web/src/ui/signaling-controls.mjs (the catalogue block added for it).
const SOURCE_TEXT=await readFile(new URL('../../apps/web/src/ui/signaling-controls.mjs',import.meta.url),'utf8');
const SIGNALING_TEXT=new Set(Object.keys(catalogues.en['']).filter(key=>SOURCE_TEXT.includes(`'${key}'`)));
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const registry=compilePortalModules(builtInModules),navigation=registry.list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
function fixture({locale='en',view='security',enabled=true,signaling=SETTINGS,status='loaded',modal=null,integrations=true,extra={}}={}){
 const account={id:OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{signalingEnabled:enabled}};
 return {locale,view,modal,navigation,brand:{name:'3sln.me',host:'space.example'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],
  session:{account,sessionContext:'ctx'},config:{origin:ORIGIN,termsVersion:'2026-10-11',pushEnabled:false,signupEnabled:true,localDevelopment:false,integrationsEnabled:integrations,emailEnabled:false},
  data:{account,features:{signalingEnabled:enabled},messages:[],views:[],contacts:[],collections:[],resources:[],rules:[],devices:[],pushDevices:[],credentials:[],grants:[],storage:{plan:'free',usedBytes:0,storageBytes:1000000}},
  connectionsConsole:{owner:OWNER,session:'ctx',generation:1,connections:[{id:'c1',clientId:APP,name:'Studio',state:'active',integration:{kind:'external'}},{id:'c2',clientId:APP2,name:'Other app',state:'active',integration:{kind:'external'}}],offerings:[],fields:[],features:[],notices:[]},
  mcpGrants:{phase:'ready',appsPhase:'ready',grantsPhase:'ready',bindlePhase:'ready',apps:[{id:'m1',clientId:APP,name:'Studio',status:'active',resourceURI:'https://app.example/mcp',provenance:{issuer:ORIGIN},connectedAt:Date.now(),notifications:{enabled:false},generation:1}],items:[],bindle:[]},
  signaling:signaling&&{...structuredClone(signaling),owner:OWNER,generation:1,status},...extra};
}
function renderer(locale,{seen,missing}={}){
 const base=createLocalization({locale,onMissing:(_,id)=>missing?.add(id)}),localization={...base,t:(key,variables)=>{seen?.add(String(key));return base.t(key,variables);}};
 const localize=tree=>localizeTree(tree,localization),views=composePortalViews(registry,{t:localization.t,number:localization.number,date:localization.date,localize}),app=createApp({views,localize}),root=document.createElement('main');
 return {root,render:state=>{dodo.reconcile(root,[app(state)]);return root;}};
}
const literalAttributes=root=>[...root.querySelectorAll('*')].flatMap(node=>[...node.attributes].filter(a=>a.value==='null'||a.value==='undefined').map(a=>`${node.tagName.toLowerCase()}[${a.name}="${a.value}"]`));
const MODALS=[['session-unapprove',{clientId:APP,kind:CHAT}],['revoke-endpoint',{endpoint:'ep_'+'a'.repeat(22)}],['revoke-offers',{id:'of_open'}],['revoke-offers',{clientId:APP}],['pairing-remove',{id:'pr_peer'}]].map(([action,input])=>({kind:'signaling-confirm',action,input}));
const SURFACES=[{view:'security'},{view:'connections'},{view:'connected-apps',integrations:false}];
const STATES=[{},{status:'loading'},{status:'error'},{signaling:null},{signaling:{...SETTINGS,enabled:false}},{signaling:{...SETTINGS,apps:[],blocked:[],blockedIssuers:[]}},{enabled:false}];
const intents=root=>{const events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));return events;};

test('every surface, state and dialog renders in English and Spanish without "null" or "undefined" attributes',()=>{
 for(const locale of ['en','es']){
  const {render,root}=renderer(locale),bad=[];
  for(const surface of SURFACES)for(const options of [...STATES,...MODALS.map(modal=>({modal}))]){render(fixture({locale,...surface,...options}));bad.push(...literalAttributes(root).map(x=>`${surface.view} ${JSON.stringify(options).slice(0,50)}: ${x}`));}
  assert.deepEqual(bad,[],locale);
 }
});

test('the Spanish catalogue covers every interface string of the controls and their dialogs',()=>{
 const seen=new Set(),missing=new Set(),en=renderer('en',{seen}),es=renderer('es',{missing});
 for(const surface of SURFACES)for(const options of [...STATES,...MODALS.map(modal=>({modal}))]){en.render(fixture({...surface,...options}));es.render(fixture({locale:'es',...surface,...options}));}
 // Notices and errors the Actions publish are interface text too.
 const bl=await_bl;for(const key of bl)assert.ok(Object.hasOwn(catalogues.es[''],key),'catalogue has '+key);
 const own=[...seen].filter(key=>SIGNALING_TEXT.has(key));assert.ok(own.length>=40,`the fixtures exercise the controls' strings (${own.length})`);
 const untranslated=[...missing].filter(key=>SIGNALING_TEXT.has(key));
 assert.deepEqual(untranslated,[]);
 const root=es.render(fixture({locale:'es'})),text=root.textContent;
 for(const pattern of [/Conexiones directas/,/Solo a través de relé \(recomendado\)/,/Entre tus propios dispositivos/,/Personas y proveedores bloqueados/,/Nadie|desbloquear|Desbloquear/,/Ningún proveedor|spam\.example/])assert.match(text,pattern);
 const apps=es.render(fixture({locale:'es',view:'connections'})).textContent;
 for(const pattern of [/Tipos de conexión/,/Charla/,/Versión 2/,/Se conecta automáticamente entre tus dispositivos/,/Cualquiera con la oferta/,/3 de 10 usos gastados/,/Emparejamientos/,/Sin vencimiento/,/Otras apps con conexiones directas/])assert.match(apps,pattern);
});

test('nothing signaling-related renders while the flag is off, and no call UI remains in core',async()=>{
 const {render}=renderer('en');
 for(const surface of SURFACES){const root=render(fixture({...surface,enabled:false}));assert.equal(root.querySelector('.signaling-panel,.signaling-app,.signaling-other'),null,surface.view);assert.doesNotMatch(root.textContent,/Direct connections|Connection types|Pairings/,surface.view);}
 const root=render(fixture());
 assert.equal(navigation.some(item=>item.view==='calls'||item.id==='calls'),false,'the calls portal module is gone');
 assert.doesNotMatch(root.textContent,/Calls & connections|Incoming call|Missed calls|call link/i);assert.equal(root.querySelector('.rtc-settings,.rtc-ring,.rtc-ring-root,.rtc-panel'),null);
 assert.equal(signalingPrivacyPanel(fixture({enabled:false})),null);assert.equal(signalingAppControls(fixture({enabled:false}),APP),null);assert.equal(signalingOtherApps(fixture({enabled:false}),[]),null);
 // The settings say signaling is not enabled: no per-app controls, while privacy and the blocked lists (narrowing) stay.
 const disabled=render(fixture({view:'connections',signaling:{...SETTINGS,enabled:false}}));assert.equal(disabled.querySelector('.signaling-app'),null);
 assert.ok(render(fixture({signaling:{...SETTINGS,enabled:false}})).querySelector('.signaling-panel form'));
 const css=await readFile(new URL('../../apps/web/styles.css',import.meta.url),'utf8');assert.doesNotMatch(css,/\.rtc-/);
 for(const name of ['ui/rtc-ring.mjs','ui/rtc-settings.mjs','bl/rtc-settings.mjs','bl/rtc-ring-poll.mjs'])await assert.rejects(readFile(new URL('../../apps/web/src/'+name,import.meta.url)),{code:'ENOENT'},name);
 const release=await readFile(new URL('../../apps/web/src/release.mjs',import.meta.url),'utf8');assert.doesNotMatch(release,/\brtc|Rtc|'calls'/);
});

test('connection privacy: labelled, described choices from the loaded policy, and the blocked lists with Unblock',()=>{
 const {render}=renderer('en'),root=render(fixture()),events=intents(root),panel=root.querySelector('.signaling-panel');
 assert.ok(panel,'the panel is in Account & security');assert.equal(panel.closest('.settings-grid')!==null,true);
 const radios=[...panel.querySelectorAll('input[type=radio]')];
 assert.deepEqual(radios.map(r=>`${r.name}=${r.value}${r.checked?'*':''}`),['other=relay*','other=public','self=relay','self=public','self=all*']);
 for(const radio of radios){const help=root.querySelector('#'+radio.getAttribute('aria-describedby'));assert.ok(help&&help.textContent.length>40,'each choice explains itself');assert.ok(radio.closest('label'));assert.ok(radio.closest('fieldset').querySelector('legend'));}
 assert.match(panel.textContent,/never sees your IP address/);assert.match(panel.textContent,/cannot read what is sent/);assert.doesNotMatch(panel.textContent,/\bcalls?\b/i,'no call wording');
 panel.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(events.at(-1).kind,'save-signaling-policy');assert.ok(events.at(-1).form);
 const rows=[...panel.querySelectorAll('.signaling-row')].map(r=>r.textContent);assert.deepEqual(rows,['far.example · 990e8400Unblock','@riverUnblock','spam.exampleUnblock']);
 for(const [n,input] of [[0,{principal:FAR}],[2,{issuer:'https://spam.example'}]]){panel.querySelectorAll('.signaling-row button')[n].click();assert.deepEqual(events.at(-1),{kind:'signaling-action',action:'unblock',input});}
 assert.equal(panel.querySelectorAll('.signaling-row [translate=no]').length,3,'owner data is never translated');
 // No block control: blocking is not offered from these lists.
 assert.doesNotMatch(panel.textContent,/\bBlock\b/);
 const empty=render(fixture({signaling:{...SETTINGS,blocked:[],blockedIssuers:[]}}));assert.match(empty.querySelector('.signaling-panel').textContent,/Nobody is blocked\.[\s\S]*No provider is blocked\./);
 const loading=render(fixture({status:'loading'})).querySelector('.signaling-panel');assert.equal(loading.getAttribute('aria-busy'),'true');assert.equal(loading.querySelector('form'),null);
 const error=render(fixture({status:'error'})),retry=error.querySelector('.signaling-panel button');const e2=intents(error);retry.click();assert.deepEqual(e2.at(-1),{kind:'load-signaling-settings'});
});

test('each app\'s controls sit with its entry in Apps & integrations, with other apps listed after; none for an app without state',()=>{
 const {render}=renderer('en'),root=render(fixture({view:'connections'})),events=intents(root);
 const studio=root.querySelector('[data-connection="c1"]'),other=root.querySelector('[data-connection="c2"]');
 const controls=studio.querySelector('.signaling-app');assert.ok(controls,'with the matching connection');assert.equal(other.querySelector('.signaling-app'),null,'an app with no approvals, devices, offers or pairings shows nothing');
 assert.equal(controls.querySelector('h4').id,signalingAppAnchor(APP));assert.equal(controls.dataset.signalingApp,APP);
 const text=controls.textContent;
 for(const pattern of [/Connection types/,/Chat/,/Version 2/,/Device sync/,/Connects automatically between your devices/,/Devices/,/Laptop/,/Unnamed device/,/Last seen/,/Offers/,/Anyone with the offer/,/space\.example · 550e8400/,/3 of 10 uses spent/,/0 of 1 uses spent/,/Expires/,/Pairings/,/Desk to phone/,/Your own app/,/Other app/,/far\.example · 990e8400/,/Either side opens it/,/This app opens it/,/Active/,/Waiting for confirmation/,/No expiry/])assert.match(text,pattern);
 assert.doesNotMatch(text,/of_open|of_bound|pr_self|ep_a/,'never an offer token or internal id');
 // Exactly one Turn off (only the auto-connect approval), and nothing that widens: no turn on, create, pair or activate.
 const labels=[...controls.querySelectorAll('button')].map(b=>b.textContent);
 assert.deepEqual(labels,['Remove','Turn off','Remove','Remove','Remove','Revoke','Revoke','Revoke all offers from this app','Remove','Remove']);
 assert.doesNotMatch(text,/Turn on|Activate|Create|Pair a|Connect automatically\b/);
 const buttons=[...controls.querySelectorAll('button')];
 buttons[1].click();assert.deepEqual(events.at(-1),{kind:'signaling-action',action:'session-auto-connect',input:{clientId:APP,kind:SYNC}});
 buttons[0].click();assert.deepEqual(events.at(-1),{kind:'open-modal',modal:{kind:'signaling-confirm',action:'session-unapprove',input:{clientId:APP,kind:CHAT}}});
 buttons[3].click();assert.deepEqual(events.at(-1).modal,{kind:'signaling-confirm',action:'revoke-endpoint',input:{endpoint:'ep_'+'a'.repeat(22)}});
 buttons[5].click();assert.deepEqual(events.at(-1).modal,{kind:'signaling-confirm',action:'revoke-offers',input:{id:'of_open'}});
 buttons[7].click();assert.deepEqual(events.at(-1).modal,{kind:'signaling-confirm',action:'revoke-offers',input:{clientId:APP}});
 buttons[9].click();assert.deepEqual(events.at(-1).modal,{kind:'signaling-confirm',action:'pairing-remove',input:{id:'pr_peer'}});
 const others=root.querySelector('.signaling-other');assert.ok(others);assert.deepEqual([...others.querySelectorAll('.signaling-app h3')].map(h=>h.textContent),['loose.example'],'an app with state but no connection, named by its host');
 assert.match(others.textContent,/kinds\.example\/session\/device-sync\/v1|Device sync/,'a kind without a title from this app falls back to another app\'s title or its URL');
 for(const view of [fixture({view:'connections',status:'loading'}),fixture({view:'connections',signaling:{...SETTINGS,enabled:false}})])assert.equal(render(view).querySelector('.signaling-app,.signaling-other'),null);
});

test('Connected apps (integrations off) shows the same controls with the app and the other apps after',()=>{
 const {render}=renderer('en'),root=render(fixture({view:'connected-apps',integrations:false}));
 const card=root.querySelector('.app-connection');assert.ok(card.querySelector('.signaling-app'),'with the connected app');
 assert.ok(root.querySelector('.signaling-other'));assert.equal(root.querySelectorAll('.signaling-app').length,2);
});

test('the confirmation dialog names the change and the app, and confirms exactly the reviewed input',()=>{
 const {render}=renderer('en');
 const expected={'session-unapprove':/Remove this connection type\?[\s\S]*Studio[\s\S]*Chat/,'revoke-endpoint':/Remove this device\?/,'revoke-offers':/Revoke this offer\?|Revoke every offer from this app\?[\s\S]*Studio/,'pairing-remove':/Remove this pairing\?/};
 for(const modal of MODALS){
  const root=render(fixture({view:'connections',modal})),events=intents(root),dialog=root.querySelector('[role=dialog]');assert.ok(dialog,modal.action);
  assert.match(dialog.textContent,expected[modal.action]);
  const [confirm,cancel]=[...dialog.querySelectorAll('.signaling-confirm button')];confirm.click();assert.deepEqual(events.at(-1),{kind:'signaling-action',action:modal.action,input:modal.input});
  cancel.click();assert.deepEqual(events.at(-1),{kind:'close-modal'});
  assert.ok(confirm.classList.contains('danger-button'));
 }
 assert.equal(signalingDialog(fixture({modal:{kind:'signaling-confirm',action:'unblock',input:{issuer:'https://x.example'}}})),null,'unblock has no dialog');
 for(const [action,input] of [['block',{principal:FAR}],['revoke-offers',{all:true}],['end-session',{sid:'s'}],['pairing-remove',{}]])assert.equal(signalingDialog(fixture({modal:{kind:'signaling-confirm',action,input}})),null,action);
});

test('every control is a native, keyboard-reachable button or input with a visible name',()=>{
 const {render}=renderer('en');
 for(const surface of SURFACES){
  const root=render(fixture(surface));
  for(const scope of root.querySelectorAll('.signaling-panel,.signaling-app,.signaling-other'))for(const control of scope.querySelectorAll('button,input')){
   if(control.tagName==='BUTTON'){assert.ok(['button','submit'].includes(control.type));assert.ok(control.textContent.trim().length>1,'visible name');}
   assert.notEqual(control.tabIndex,-1);
  }
 }
 // The headings focus moves to after an action are focusable without joining the tab order.
 const root=render(fixture({view:'connections'}));assert.equal(root.querySelector('#'+signalingAppAnchor(APP)).tabIndex,-1);
 assert.equal(render(fixture()).querySelector('#signaling-blocked-title').tabIndex,-1);
});
