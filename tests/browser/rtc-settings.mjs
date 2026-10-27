// RTC-g "Calls & connections" view, its confirmation dialogs and the portal ring, rendered through the real console
// renderer, portal module and catalogue in happy-dom: English and Spanish, loading/error/loaded states, no literal
// "null"/"undefined" attribute, keyboard-reachable controls with described choices, flag-off invisibility, only
// pre-claim data in the ring, and the layout rules for 360 px, desktop and dark mode. Real-browser layout, keyboard and
// colour-scheme checks of the same surfaces are in tests/browser/rtc-settings-browser.mjs (playwright).
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
const {compilePortalModules}=await import('../../packages/portal/index.mjs');
const {default:rtcSettingsView,rtcDialog,principalLabel}=await import('../../apps/web/src/ui/rtc-settings.mjs');
const {rtcRing,withRtcSurface,safeOrigin}=await import('../../apps/web/src/ui/rtc-ring.mjs');
const {SETTINGS}=await import('../helpers/rtc-settings-fixture.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const OWNER='550e8400-e29b-41d4-a716-446655440001',OTHER='550e8400-e29b-41d4-a716-446655440002',ORIGIN='https://space.example',now=Date.now();
const CALL='https://spec.bindle.example/rtc-purposes/call/v1',SYNC='https://spec.bindle.example/rtc-purposes/device-sync/v1',APP='https://app.example/client';
const peer={iss:ORIGIN,sub:OTHER},foreign={iss:'https://far.example',sub:'990e8400-e29b-41d4-a716-000000000009'};
const CONTACT='770e8400-e29b-41d4-a716-000000000001';
const full={...structuredClone(SETTINGS),contacts:[{parent:CONTACT,purposes:[CALL]}],
 sessions:[{sid:'s'.repeat(22),role:'callee',state:'connected',own:false,peer,peerHandle:'river',purpose:CALL,media:['audio','video'],createdAt:now-60000,ringUntil:now,endsAt:now+86400000,held:false,claimed:true},{sid:'o'.repeat(22),role:'caller',state:'ringing',own:true,peer:{iss:ORIGIN,sub:OWNER},peerHandle:null,purpose:SYNC,media:['data'],createdAt:now,ringUntil:now+60000,endsAt:now+86400000}],
 missed:[{id:'m1',caller:foreign,callerHandle:null,purpose:CALL,kind:'held',at:now-3600000},{id:'m2',caller:peer,callerHandle:'river',purpose:CALL,kind:'missed',at:now-7200000}],
 blocked:[{principal:foreign,at:now,handle:null}],tickets:[{jti:'t1',purposes:[CALL],uses:3,usesLeft:2,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true},{jti:'t2',purposes:[CALL],uses:1,usesLeft:0,principal:peer,expiresAt:now+86400000,revoked:false,callback:true,live:false}],
 endpoints:[{endpoint:'ep_'+'a'.repeat(22),clientId:APP,origin:'https://app.example',label:null,purposes:[CALL],lastSeen:now-1000},{endpoint:'ep_'+'b'.repeat(22),clientId:APP,origin:'https://app.example',label:'Laptop',purposes:[CALL,SYNC],lastSeen:now}]};
const invite={sid:'r'.repeat(22),caller:peer,callerHandle:'river',callerOrigin:'https://caller.example',purpose:CALL,title:{en:'Call',es:'Llamada'},media:['audio','video'],ringUntil:now+60000,apps:[{clientId:APP,origin:'https://app.example'},{clientId:'evil',origin:'javascript:alert(1)'}]};
const registry=compilePortalModules(builtInModules),navigation=registry.list('navigation').map(({id,title,view,icon,order,module})=>({id,title,view,icon,order,module}));
function fixture({locale='en',enabled=true,rtc=full,status='loaded',modal=null,ring=[invite],extra={}}={}){
 const account={id:OWNER,handle:'n.fixture',termsVersion:'2026-10-11',consoleFeatures:{rtcSignalingEnabled:enabled}};
 return {locale,view:'calls',modal,navigation,brand:{name:'3sln.me'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[],
  session:{account,sessionContext:'ctx'},config:{origin:ORIGIN,termsVersion:'2026-10-11',pushEnabled:false,signupEnabled:true,localDevelopment:false},
  data:{account,features:{rtcSignalingEnabled:enabled},messages:[],views:[],contacts:[{id:CONTACT,name:'Website form',active:true},{id:'770e8400-e29b-41d4-a716-000000000002',name:'Old link',active:false}],collections:[],resources:[],rules:[],devices:[],pushDevices:[],storage:{plan:'free',usedBytes:0,storageBytes:1000000}},
  rtc:rtc&&{...rtc,owner:OWNER,generation:1,status},rtcRing:{owner:OWNER,generation:1,invites:ring,dismissed:[]},...extra};
}
function renderer(locale,{seen,missing}={}){
 const base=createLocalization({locale,onMissing:(_,id)=>missing?.add(id)}),localization={...base,t:(key,variables)=>{seen?.add(String(key));return base.t(key,variables);}};
 const localize=tree=>localizeTree(tree,localization),app=withRtcSurface(createApp({views:{calls:state=>localize(rtcSettingsView(state))},localize})),root=document.createElement('main'),ringRoot=document.createElement('div');
 return {root,ringRoot,render:state=>{dodo.reconcile(root,[app(state)]);const ringTree=rtcRing(state);dodo.reconcile(ringRoot,ringTree?[localize(ringTree)]:[]);return root;}};
}
const literalAttributes=root=>[...root.querySelectorAll('*')].flatMap(node=>[...node.attributes].filter(a=>a.value==='null'||a.value==='undefined').map(a=>`${node.tagName.toLowerCase()}[${a.name}="${a.value}"]`));
const MODALS=[...['end-session','revoke-ticket','revoke-endpoint','block','clear-missed','narrow-app'].map(action=>({kind:'rtc-confirm',action,input:{}})),{kind:'rtc-confirm',action:'narrow-app',input:{clientId:APP,purposes:[CALL]}},
 // Wargame M2/M6: the provider block and the bulk revocations have their own wording.
 {kind:'rtc-confirm',action:'block',input:{issuer:'https://far.example'}},{kind:'rtc-confirm',action:'revoke-ticket',input:{clientId:APP}},{kind:'rtc-confirm',action:'revoke-ticket',input:{clientId:null}},{kind:'rtc-confirm',action:'revoke-ticket',input:{all:true}}];
// Wargame M2/M6: call links from a known app, a removed app and no known app (legacy); a blocked provider; every mute kind.
const spam={...structuredClone(full),blockedIssuers:[{issuer:'https://far.example',at:now}],
 muted:[{kind:'principal',value:foreign,at:now},{kind:'purpose',value:CALL,at:now},{kind:'app',value:APP,at:now},{kind:'issuer',value:'https://spam.example',at:now},{kind:'origin',value:'https://dialer.example',at:now},
  // Review R3: app and origin mutes for callers on another provider name it (`issuer`).
  {kind:'origin',value:'https://dialer.example',issuer:'https://far.example',at:now},{kind:'app',value:APP,issuer:'https://far.example',at:now}],
 tickets:[{jti:'t1',purposes:[CALL],uses:3,usesLeft:2,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true,clientId:APP,origin:'https://app.example'},
  {jti:'t3',purposes:[CALL],uses:1000,usesLeft:1000,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true,clientId:'https://gone.example/client',origin:'https://gone.example'},
  {jti:'t4',purposes:[CALL],uses:5,usesLeft:5,principal:null,expiresAt:now+86400000,revoked:false,callback:false,live:true,clientId:null,origin:null},
  {jti:'t5',purposes:[CALL],uses:1,usesLeft:0,principal:null,expiresAt:now+86400000,revoked:true,callback:false,live:false,clientId:APP,origin:'https://app.example'}]};
const farInvite={...invite,sid:'f'.repeat(22),caller:foreign,callerHandle:null,callerOrigin:'https://dialer.example',callerOriginReportedBy:'far.example',callerProvider:'https://far.example'};
const STATES=[{},{status:'loading'},{status:'error'},{rtc:{...structuredClone(SETTINGS),apps:[]},ring:[]},{rtc:null},{ring:[{...invite,callerOriginReportedBy:'beta.example'}]},{rtc:spam,ring:[farInvite]}];

test('every state, dialog and the ring render in English and Spanish without "null" or "undefined" attributes',()=>{
 for(const locale of ['en','es']){
  const {render,root,ringRoot}=renderer(locale),bad=[];
  for(const options of [...STATES,...MODALS.map(modal=>({modal}))]){render(fixture({locale,...options}));bad.push(...literalAttributes(root).concat(literalAttributes(ringRoot)).map(x=>`${JSON.stringify(options).slice(0,40)}: ${x}`));}
  const fresh=renderer(locale);fresh.render(fixture({locale}));bad.push(...literalAttributes(fresh.root),...literalAttributes(fresh.ringRoot));
  assert.deepEqual(bad,[],locale);
 }
});

test('the Spanish catalogue covers every interface string of the view, its dialogs and the ring',()=>{
 const seen=new Set(),missing=new Set(),en=renderer('en',{seen}),es=renderer('es',{missing});
 for(const options of [...STATES,...MODALS.map(modal=>({modal}))]){en.render(fixture(options));es.render(fixture({locale:'es',...options}));}
 const untranslated=[...missing].filter(key=>seen.has(key)&&/[A-Za-z]{3,}/.test(key)&&!/^https?:/.test(key)&&!/^[\w-]+(?:\.[\w-]+)+$/.test(key));
 assert.deepEqual(untranslated,[]);
 const root=es.render(fixture({locale:'es'})),text=root.textContent+es.ringRoot.textContent;
 for(const pattern of [/Llamadas y conexiones/,/Privacidad de red/,/Solo a través de relé \(recomendado\)/,/Quién puede llamarte/,/Llamadas perdidas y solicitudes retenidas/,/Enlaces de llamada/,/Comprueba con quién hablas/,/Llamada entrante|Entrante/,/Abrir en/])assert.match(text,pattern);
 assert.match(text,/Llamada/,'purpose titles come from the artefact in the interface language');assert.doesNotMatch(text,/\b[a-z]+(?:_[a-z]+)+\b/,'no internal codes');
});

test('privacy choices state the trade-off, are labelled and described, and relay-only is selected by default',()=>{
 const root=renderer('en').render(fixture()),panel=root.querySelector('.rtc-privacy'),radios=[...panel.querySelectorAll('input[type=radio]')];
 assert.deepEqual(radios.map(r=>`${r.name}=${r.value}${r.checked?'*':''}`),['other=relay*','other=public','self=all*','self=public','self=relay']);
 for(const radio of radios){const help=root.querySelector('#'+radio.getAttribute('aria-describedby'));assert.ok(help&&help.textContent.length>40,'each choice explains itself');assert.ok(radio.closest('label'),'each choice is labelled');assert.ok(radio.closest('fieldset').querySelector('legend'));}
 assert.match(panel.textContent,/never sees your IP address/);assert.match(panel.textContent,/can reveal your approximate location/);assert.match(panel.textContent,/cannot read calls or files/);
 // Own-device purposes never appear where other people are concerned.
 for(const selector of ['.rtc-contacts','.rtc-requests'])assert.doesNotMatch(root.querySelector(selector).textContent,/Device sync/,selector);
 assert.equal(root.querySelectorAll('.rtc-contact').length,1,'only active contact links are configurable');
 assert.equal(root.querySelector('.rtc-contact input[type=checkbox]').checked,true);
});

test('every control is a native, keyboard-reachable button, link or input; destructive ones open a confirmation',()=>{
 const {render}=renderer('en'),root=render(fixture()),events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));
 const view=root.querySelector('.rtc-settings');assert.equal(view.getAttribute('aria-busy'),'false');
 for(const control of view.querySelectorAll('button')){assert.ok(['button','submit'].includes(control.type));assert.ok(control.textContent.trim().length>1,'every button has a visible name');assert.notEqual(control.tabIndex,-1);}
 for(const section of view.querySelectorAll('section.rtc-panel'))assert.ok(root.querySelector('#'+section.getAttribute('aria-labelledby')),'each section is labelled by its heading');
 const click=label=>{const b=[...view.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(b,label);b.click();return events.at(-1);};
 assert.deepEqual(click('End'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'end-session',input:{sid:'s'.repeat(22),caller:peer}}});
 assert.deepEqual(click('Revoke'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'revoke-ticket',input:{jti:'t1'}}});
 assert.equal([...view.querySelectorAll('.rtc-tickets .rtc-row button')].length,1,'an ended link has no revoke');
 assert.deepEqual(click('Clear the list'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'clear-missed',input:{}}});
 assert.deepEqual(click('Remove from list'),{kind:'rtc-action',action:'clear-missed',input:{id:'m1'}});
 assert.deepEqual(click('Unblock'),{kind:'rtc-action',action:'unblock',input:{principal:foreign}});
 const dialog=render(fixture({modal:{kind:'rtc-confirm',action:'revoke-endpoint',input:{endpoint:'ep_'+'a'.repeat(22)}}})).querySelector('[role=dialog]');
 assert.equal(dialog.getAttribute('aria-modal'),'true');assert.match(dialog.textContent,/Remove this device from calls\?/);
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Remove device').click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'revoke-endpoint',input:{endpoint:'ep_'+'a'.repeat(22)}});
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Cancel').click();assert.equal(events.at(-1).kind,'close-modal');
 assert.equal(rtcDialog({modal:{kind:'rtc-confirm',action:'unblock',input:{}}}),null,'only destructive actions have a dialog');
});

test('loading is aria-busy with a status message; an error offers a retry',()=>{
 const {render}=renderer('en'),loading=render(fixture({status:'loading'})).querySelector('.rtc-settings');
 assert.equal(loading.getAttribute('aria-busy'),'true');assert.match(loading.querySelector('[role=status]').textContent,/Loading call settings/);
 const failed=render(fixture({status:'error'})).querySelector('.rtc-settings');assert.equal(failed.getAttribute('aria-busy'),'false');const retry=[...failed.querySelectorAll('button')].find(b=>b.textContent==='Try again');assert.ok(retry);
});

test('flag off: no navigation entry, no view content and no ring, whatever state lingers',()=>{
 const {render,ringRoot}=renderer('en'),on=render(fixture());
 assert.ok([...on.querySelectorAll('.nav-item')].some(n=>n.textContent==='Calls & connections'),'the entry is present while enabled');assert.ok(ringRoot.querySelector('.rtc-ring'));
 const root=render(fixture({enabled:false}));
 assert.equal([...root.querySelectorAll('.nav-item')].some(n=>/Calls/.test(n.textContent)),false);
 assert.equal(root.querySelector('.rtc-privacy'),null);assert.doesNotMatch(root.textContent,/Network privacy|Call links|Incoming/);assert.match(root.textContent,/This page is not available/);
 assert.equal(ringRoot.children.length,0);assert.equal(rtcRing(fixture({enabled:false})),null);
 assert.equal(rtcRing(fixture({extra:{route:{kind:'contact'}}})),null,'the ring belongs to the console only');assert.equal(rtcRing(fixture({extra:{offline:true}})),null);
});

test('the ring shows only pre-claim data and hands the invite to a verified app origin',()=>{
 const {render,ringRoot}=renderer('en');render(fixture({ring:[{...invite,context:{files:3},link:'https://x.example/l',callerOrigin:'https://caller.example'}]}));
 const ring=ringRoot.querySelector('.rtc-ring');assert.ok(ring);assert.equal(ringRoot.querySelector('[role=region]').getAttribute('aria-label'),'Incoming calls');
 assert.match(ring.textContent,/Incoming Call/);assert.match(ring.textContent,/From @river/);assert.match(ring.textContent,/Audio, Video/);
 assert.doesNotMatch(ring.textContent,/files|x\.example/,'never context or links');
 // RTC-17 (provisional; spec §9.1): the calling app's verified origin, shown as owner data (never translated, never a link).
 const via=[...ring.querySelectorAll('p')].find(p=>/Calling app:/.test(p.textContent));assert.ok(via,'the calling app is named');assert.equal(via.querySelector('[translate=no]').textContent,'caller.example');
 assert.ok(![...ring.querySelectorAll('a')].some(a=>/caller\.example/.test(a.getAttribute('href'))),'the caller app is never linked');
 assert.doesNotMatch(via.textContent,/reported by/,'a same-host caller\'s origin is unlabelled');
 // RTCs follow-up (a): a foreign caller's origin is only what its provider certified, so it is labelled as reported by it.
 render(fixture({ring:[{...invite,callerOriginReportedBy:'beta.example'}]}));
 const reported=[...ringRoot.querySelectorAll('p')].find(p=>/Calling app/.test(p.textContent));assert.match(reported.textContent,/^Calling app \(reported by beta\.example\): caller\.example$/);assert.equal(reported.querySelector('[translate=no]').textContent,'caller.example');
 const es=renderer('es');es.render(fixture({locale:'es',ring:[{...invite,callerOriginReportedBy:'beta.example'}]}));assert.match(es.ringRoot.textContent,/App que llama \(según beta\.example\): caller\.example/);
 render(fixture({ring:[{...invite,callerOrigin:null,callerOriginReportedBy:'beta.example'}]}));assert.doesNotMatch(ringRoot.textContent,/Calling app/,'nothing when the origin is unknown');
 render(fixture({ring:[{...invite,context:{files:3},link:'https://x.example/l',callerOrigin:'https://caller.example'}]}));
 const links=[...ring.querySelectorAll('a')];assert.equal(links.length,1,'a non-https origin is never linked');assert.equal(links[0].getAttribute('href'),'https://app.example/');assert.equal(links[0].getAttribute('rel'),'noopener noreferrer');assert.match(links[0].textContent,/Open in app\.example/);
 const events=[];ringRoot.addEventListener('3sln-intent',event=>events.push(event.detail));const press=label=>{[...ring.querySelectorAll('button')].find(b=>b.textContent===label).click();return events.at(-1);};
 assert.deepEqual(press('Decline'),{kind:'rtc-action',action:'end-session',input:{sid:'r'.repeat(22),caller:peer,silent:true},ring:true,until:invite.ringUntil},'Decline is the silent local end (review F1)');
 assert.deepEqual(press('Not now'),{kind:'dismiss-rtc-ring',sid:'r'.repeat(22)});
 assert.deepEqual(press('Block caller'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'block',input:{principal:peer}}});
 render(fixture({ring:[{...invite,apps:[]}]}));assert.match(ringRoot.textContent,/None of your apps is ready/);
 assert.equal(principalLabel(foreign,null),'far.example · 990e8400');assert.equal(principalLabel(peer,'river'),'@river');
 assert.equal(safeOrigin('http://localhost:8787',{local:true}),'http://localhost:8787/');assert.equal(safeOrigin('http://localhost:8787'),null);assert.equal(safeOrigin('https://u:p@app.example'),null);
});

test('layout rules: one column at phone widths, the ring fits a 360 px screen, colours come from the theme tokens',async()=>{
 const css=await readFile(new URL('../../apps/web/styles.css',import.meta.url),'utf8'),rtc=css.slice(css.indexOf('/* RTC-g'));
 assert.match(rtc,/\.rtc-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(rtc,/@media\(max-width:760px\)\{\.rtc-grid\{grid-template-columns:1fr/);
 assert.match(rtc,/\.rtc-ring-root\{position:fixed;right:16px;bottom:16px;z-index:40;width:min\(380px,calc\(100vw - 32px\)\)/,'the ring never exceeds the viewport minus the gutters');
 assert.doesNotMatch(rtc.replace(/box-shadow:[^;}]*/g,''),/#[0-9a-f]{3,6}\b/i,'no fixed colours apart from shadows: light and dark come from the tokens');
 for(const rule of ['overflow-wrap:anywhere','min-width:0'])assert.ok(rtc.includes(rule),rule);
});

// ——— Review follow-ups (2026-10-27): F1, F5, F6 and F8 in the rendered view ———
test('F1: held requests offer Remove and Block, unanswered invites Decline, answered or outgoing sessions End; nothing says the caller is told',()=>{
 const held={sid:'h'.repeat(22),role:'callee',state:'ringing',own:false,peer:foreign,peerHandle:null,purpose:CALL,media:['audio'],createdAt:now,ringUntil:now+60000,endsAt:now+86400000,held:true,claimed:false};
 const ringing={...held,sid:'g'.repeat(22),peer,peerHandle:'river',held:false};
 const {render}=renderer('en'),root=render(fixture({rtc:{...full,sessions:[...full.sessions,held,ringing]}})),events=[];root.addEventListener('3sln-intent',e=>events.push(e.detail));
 const rows=[...root.querySelectorAll('.rtc-sessions .rtc-row')],labels=row=>[...row.querySelectorAll('button')].map(b=>b.textContent);
 const rowOf=sid=>rows.find(r=>r.textContent.includes(sid===held.sid?'far.example':'@river')&&(sid!==ringing.sid||r.textContent.includes('Ringing')));
 assert.deepEqual(labels(rowOf(held.sid)),['Remove','Block'],'no End for a held request');assert.match(rowOf(held.sid).textContent,/Held request/);
 assert.deepEqual(labels(rowOf(ringing.sid)),['Decline']);
 assert.deepEqual(rows.filter(r=>labels(r).includes('End')).length,2,'the connected and the outgoing session keep End');
 [...rowOf(held.sid).querySelectorAll('button')].find(b=>b.textContent==='Remove').click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'end-session',input:{sid:held.sid,caller:foreign,silent:true},until:held.ringUntil});
 [...rowOf(held.sid).querySelectorAll('button')].find(b=>b.textContent==='Block').click();assert.deepEqual(events.at(-1),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'block',input:{principal:foreign}}});
 [...rowOf(ringing.sid).querySelectorAll('button')].find(b=>b.textContent==='Decline').click();assert.deepEqual(events.at(-1).input,{sid:ringing.sid,caller:peer,silent:true});
 // Declined in this tab: hidden until the deadline.
 const after=render(fixture({rtc:{...full,sessions:[...full.sessions,held,ringing]},extra:{rtcRing:{owner:OWNER,generation:1,invites:[],dismissed:[],declined:[{sid:held.sid,until:now+60000}]}}}));
 assert.equal([...after.querySelectorAll('.rtc-sessions .rtc-row')].length,3);assert.doesNotMatch(after.querySelector('.rtc-sessions').textContent,/Held request/);
 const {render:ring,ringRoot}=renderer('en');ring(fixture());assert.doesNotMatch(ringRoot.textContent+after.textContent,/tells the caller the call|caller the call ended|caller is told/i);assert.match(ringRoot.textContent,/not told whether you declined/);
});

test('F5: each ring heading is the focus target the bl names after a Decline or Not now',()=>{
 const {render,ringRoot}=renderer('en'),sids=['a','b','c'].map(x=>x.repeat(22));render(fixture({ring:sids.map(sid=>({...invite,sid}))}));
 for(const sid of sids){const heading=ringRoot.querySelector(`[id="rtc-ring-${sid}"]`);assert.ok(heading,sid);assert.equal(heading.tagName,'H2');assert.equal(heading.tabIndex,-1,'programmatically focusable, not in the Tab order');}
});

test('F6: the 6-digit code, relay and local-address texts say what each party can still see, in English and Spanish',()=>{
 const en=renderer('en').render(fixture()).textContent,es=renderer('es').render(fixture({locale:'es'})).textContent;
 assert.match(en,/no provider or network in between can listen in\. The app you use can still see the call\./);assert.doesNotMatch(en,/not even your providers/);
 assert.match(en,/never sees your IP address; the relay does/);assert.match(en,/A relay sees your IP address/);
 assert.match(en,/your provider carries them briefly to set up the connection and then deletes them/);
 assert.match(es,/ningún proveedor ni red intermedia puede escuchar\. La app que usas sí puede ver la llamada\./);assert.match(es,/el relé sí la ve/);assert.match(es,/Un relé ve tu dirección IP/);assert.match(es,/tu proveedor las transporta brevemente/);
});

test('F8: the ring stack is bounded and scrolls instead of covering the screen',async()=>{
 const css=await readFile(new URL('../../apps/web/styles.css',import.meta.url),'utf8'),rule=/\.rtc-ring-stack\{[^}]*\}/.exec(css)?.[0]??'';
 assert.match(rule,/max-height:min\(70vh,calc\(100vh - 32px\)\)/);assert.match(rule,/overflow-y:auto/);assert.match(rule,/overscroll-behavior:contain/);
});

// ——— Service follow-ups (2026-10-27): narrowing an app's approved purposes ———
test('narrowing: an app with several purposes offers checked boxes and a review button; one purpose is listed only; the dialog names what is lost',()=>{
 for(const locale of ['en','es']){
  const {render}=renderer(locale),root=render(fixture({locale})),app=root.querySelector('.rtc-app'),boxes=[...app.querySelectorAll('input[type=checkbox]')].filter(b=>b.name.startsWith('keep:'));
  assert.deepEqual(boxes.map(b=>[b.name,b.checked]),[[`keep:${CALL}`,true],[`keep:${SYNC}`,true]],locale);
  for(const box of boxes)assert.ok(box.closest('label'),'each purpose is labelled');
  const form=boxes[0].closest('form'),submit=form.querySelector('button[type=submit],button:not([type])');assert.ok(submit,'a native submit button');
  assert.match(submit.textContent,locale==='en'?/Approve fewer purposes/:/Aprobar menos fines/);
  assert.match(app.textContent,locale==='en'?/To remove the app completely/:/Para quitar la app por completo/);
 }
 const events=[],{render}=renderer('en'),root=render(fixture());root.addEventListener('3sln-intent',event=>events.push(event.detail));
 const form=root.querySelector('.rtc-app form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 const sent=events.find(e=>e.kind==='review-rtc-narrow');assert.ok(sent,'the form bubbles its review intent');assert.equal(sent.clientId,APP);
 // One approved purpose: nothing to narrow, no checkbox.
 const single=render(fixture({rtc:{...structuredClone(SETTINGS),apps:[{clientId:APP,name:'Caller',origin:'https://app.example',purposes:[CALL]}]}}));
 assert.equal(single.querySelectorAll('.rtc-app input[name^="keep:"]').length,0);assert.match(single.querySelector('.rtc-app').textContent,/Call/);
 // The dialog: removed and kept purposes as owner data, and its confirm button sends the same input.
 const dialog=rtcDialog(fixture({modal:{kind:'rtc-confirm',action:'narrow-app',input:{clientId:APP,purposes:[CALL]}}}));assert.equal(dialog.title,'Approve fewer purposes for this app?');
 const holder=document.createElement('div');dodo.reconcile(holder,[dialog.body]);
 assert.match(holder.textContent,/No longer approved\s*Device sync/);assert.match(holder.textContent,/Still approved\s*Call/);assert.match(holder.textContent,/Caller/);
 for(const node of holder.querySelectorAll('li'))assert.ok(node.querySelector('[translate=no]'),'purpose titles are owner data');
 const intents=[];holder.addEventListener('3sln-intent',event=>intents.push(event.detail));[...holder.querySelectorAll('button')].find(b=>b.textContent==='Approve fewer purposes').click();
 assert.deepEqual(intents.at(-1),{kind:'rtc-action',action:'narrow-app',input:{clientId:APP,purposes:[CALL]}});
});

test('wargame M2: call links are grouped by the app that created them, with per-app and all-links revocation',()=>{
 const {render}=renderer('en'),root=render(fixture({rtc:spam})),events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));
 const groups=[...root.querySelectorAll('.rtc-tickets .rtc-ticket-app')];
 assert.deepEqual(groups.map(g=>g.querySelector('h3').textContent),['Caller','gone.example','Unknown app'],'the approved app by name, a removed app by origin, legacy links as unknown');
 assert.equal(groups[0].querySelector('h3 [translate=no]').textContent,'Caller','app names are owner data');assert.equal(groups[2].querySelector('h3 [translate=no]'),null,'"Unknown app" is interface text');
 assert.match(groups[1].textContent,/Created by an app you no longer approve/);assert.match(groups[2].textContent,/Created before call links recorded which app made them/);
 assert.equal(groups[0].querySelectorAll('.rtc-row').length,2,'live and revoked links of one app stay together');
 const press=(scope,label)=>{const b=[...scope.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(b,label);b.click();return events.at(-1);};
 assert.deepEqual(press(groups[0],'Revoke all from this app'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'revoke-ticket',input:{clientId:APP}}});
 assert.deepEqual(press(groups[2],'Revoke all from unknown apps'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'revoke-ticket',input:{clientId:null}}});
 assert.deepEqual(press(root.querySelector('.rtc-tickets'),'Revoke all call links'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'revoke-ticket',input:{all:true}}});
 // No bulk control without a live link.
 const ended=render(fixture({rtc:{...spam,tickets:[spam.tickets[3]]}}));assert.deepEqual([...ended.querySelectorAll('.rtc-tickets button')].map(b=>b.textContent),[]);
 for(const [input,title,confirm] of [[{clientId:APP},/Revoke every call link from this app\?/,'Revoke links'],[{clientId:null},/Revoke every call link from unknown apps\?/,'Revoke links'],[{all:true},/Revoke all call links\?/,'Revoke all'],[{jti:'t1'},/Revoke this call link\?/,'Revoke call link']]){
  const dialog=render(fixture({rtc:spam,modal:{kind:'rtc-confirm',action:'revoke-ticket',input}})).querySelector('[role=dialog]');assert.match(dialog.textContent,title);
  [...dialog.querySelectorAll('button')].find(b=>b.textContent===confirm).click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'revoke-ticket',input});}
});

test('wargame M6: blocked providers and every mute are listed and removable; the ring offers a provider block only for a foreign caller',()=>{
 const {render,ringRoot}=renderer('en'),root=render(fixture({rtc:spam,ring:[farInvite,invite]})),events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));ringRoot.addEventListener('3sln-intent',event=>events.push(event.detail));
 const panel=root.querySelector('.rtc-blocked');assert.match(panel.querySelector('h2').textContent,/Blocked and muted/);
 assert.deepEqual([...panel.querySelectorAll('h3')].map(x=>x.textContent),['People','Providers','Muted']);
 const rows=[...panel.querySelectorAll('.rtc-row')].map(r=>r.textContent);
 assert.ok(rows.includes('far.exampleUnblock'),'a blocked provider by host');
 for(const text of ['Person far.example · 990e8400','Purpose Call','App Caller','Provider spam.example','Calling app dialer.example'])assert.ok(rows.some(r=>r.startsWith(text)),text);
 const unblock=[...panel.querySelectorAll('.rtc-row')].find(r=>r.textContent==='far.exampleUnblock').querySelector('button');unblock.click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'unblock',input:{issuer:'https://far.example'}});
 const unmute=[...panel.querySelectorAll('.rtc-row')].find(r=>r.textContent.startsWith('Calling app')).querySelector('button');unmute.click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'unmute',input:{kind:'origin',value:'https://dialer.example'}});
 // Review R3: a scoped mute names its provider (interface text around owner data) and unmutes in that scope; a foreign
 // client_id is shown as asserted, never matched to one of the owner's own apps.
 const scoped=[...panel.querySelectorAll('.rtc-row')].filter(r=>/reported by/.test(r.textContent));
 assert.deepEqual(scoped.map(r=>r.textContent),['Calling app dialer.example (reported by far.example)Unmute',`App ${APP} (reported by far.example)Unmute`]);
 assert.equal(scoped[0].querySelector('.rtc-mute-provider').getAttribute('translate'),null,'the provider label is interface text');
 scoped[0].querySelector('button').click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'unmute',input:{kind:'origin',value:'https://dialer.example',issuer:'https://far.example'}});
 scoped[1].querySelector('button').click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'unmute',input:{kind:'app',value:APP,issuer:'https://far.example'}});
 const empty=render(fixture()).querySelector('.rtc-blocked');assert.match(empty.textContent,/No provider is blocked\./);assert.match(empty.textContent,/Nothing is muted\./);
 // The ring: a foreign caller (callerProvider) gets "Block this provider"; a same-host caller never does. "reported by" stays.
 render(fixture({rtc:spam,ring:[farInvite,invite]}));
 const [far,near]=[...ringRoot.querySelectorAll('.rtc-ring')];
 assert.match(far.textContent,/Calling app \(reported by far\.example\): dialer\.example/);
 const labels=n=>[...n.querySelectorAll('button')].map(b=>b.textContent);
 assert.deepEqual(labels(far),['Decline','Not now','Block caller','Block this provider','Mute this app']);
 assert.deepEqual(labels(near),['Decline','Not now','Block caller','Mute this app'],'no provider block for a caller on this host');
 const press=(n,label)=>{[...n.querySelectorAll('button')].find(b=>b.textContent===label).click();return events.at(-1);};
 assert.deepEqual(press(far,'Block this provider'),{kind:'open-modal',modal:{kind:'rtc-confirm',action:'block',input:{issuer:'https://far.example'}}});
 assert.deepEqual(press(far,'Mute this app'),{kind:'rtc-action',action:'mute',input:{kind:'origin',value:'https://dialer.example',issuer:'https://far.example'},ring:true,sid:'f'.repeat(22)},'review R3: scoped to the caller\'s provider');
 assert.deepEqual(press(near,'Mute this app').input,{kind:'origin',value:invite.callerOrigin},'a same-host caller\'s app mute is unscoped');
 const dialog=render(fixture({rtc:spam,modal:{kind:'rtc-confirm',action:'block',input:{issuer:'https://far.example'}}})).querySelector('[role=dialog]');
 assert.match(dialog.textContent,/Block this provider\?/);assert.match(dialog.textContent,/including people you know there/);assert.equal(dialog.querySelector('strong [translate=no]').textContent,'far.example');
 [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Block provider').click();assert.deepEqual(events.at(-1),{kind:'rtc-action',action:'block',input:{issuer:'https://far.example'}});
 render(fixture({ring:[{...farInvite,callerOrigin:null,callerOriginReportedBy:null}]}));assert.deepEqual(labels(ringRoot.querySelector('.rtc-ring')),['Decline','Not now','Block caller','Block this provider'],'no app mute without a calling app origin');
});
