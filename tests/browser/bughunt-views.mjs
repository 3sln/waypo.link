// Browser bug hunt fixes (DEVLOG 2026-10-27), rendered through the real console renderer and catalogue in happy-dom.
// F2: no attribute ever renders as the literal "null" or "undefined" across the main views, dialogs and view changes.
// F8: the Spanish catalogue covers the interface text those views pass to the translator. The remaining tests pin the
// smaller view fixes (F1, F3, F9, F11, F12, F13, F15, F16, F17, F18). Real-browser checks of the same surfaces were run
// against the local Worker and are recorded in DEVLOG.
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
const {envBanner}=await import('../../apps/web/src/ui/admin-flags.mjs');
const {consentKit}=await import('../../apps/web/src/ui/authorize-entry-consent.mjs');
const {authorizeLocalization}=await import('../../packages/i18n/authorize-catalogue.mjs');
const {builtInModules}=await import('../../apps/web/src/shared/portal-modules.mjs');
const appMessagesSchema=JSON.parse(await readFile(new URL('../../docs/artefacts/app-message-preferences-v1.json',import.meta.url),'utf8'));
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const OWNER='550e8400-e29b-41d4-a716-446655440001',now=Date.UTC(2026,9,20,12);
const app={principal:'https://issuer.example#https://calendar.example/client',name:'Calendar',origin:'https://calendar.example',clientId:'https://calendar.example/client'};
const legacyId='660e8400-e29b-41d4-a716-000000000001';
function fixture({locale='en',view='inbox',activity=false,modal=null,extra={}}={}){
 const account={id:OWNER,handle:'n.fixture',verifiedEmail:'owner@example.com',termsVersion:'2026-10-11'};
 const messages=[{id:legacyId,owner:OWNER,collection:'c1',mimeType:'text/plain',size:12,receivedAt:now,readAt:null,tags:['app-message','receipt'],grantId:null,senderMetadata:{subject:'Build finished'},appNotification:{name:'Calendar',origin:'https://calendar.example',clientId:app.clientId}},{id:'660e8400-e29b-41d4-a716-000000000002',owner:OWNER,collection:'c1',mimeType:'text/plain',size:7,receivedAt:now-1000,readAt:now,tags:[],grantId:'770e8400-e29b-41d4-a716-000000000001',senderMetadata:{subject:'Hello'}}];
 const views=[{id:'all',name:'All messages',builtin:true,revision:1,filter:{version:1},sort:'activity-desc'},{id:'unread',name:'Unread',builtin:true,revision:1,filter:{version:1,read:false},sort:'activity-desc'},{id:'custom',name:'Receipts',revision:2,filter:{version:1,tagsAll:['receipt']},sort:'activity-desc'}];
 const contacts=[{id:'770e8400-e29b-41d4-a716-000000000001',name:'Website form',active:true,quarantined:false,createdAt:now-86400000,expiresAt:now+86400000*30,collections:['c1'],mimeTypes:['text/plain'],form:'link',kinds:['one-off'],profileFields:[],messagesUsed:1,maxMessages:100,bytesUsed:10,maxBytes:100000}];
 const devices=[{id:'d1',label:'Laptop',current:true,createdAt:now-86400000,lastUsedAt:now,expiresAt:now+86400000*30},{id:'d2',label:null,current:false,createdAt:now-86400000*2,lastUsedAt:now-3600000,expiresAt:now+86400000*20}];
 const incoming=activity?{activityV2:true,owner:OWNER,generation:1,items:[{id:'880e8400-e29b-41d4-a716-000000000001',app,subject:'Native item',revision:1,receivedAt:now,updatedAt:now,state:'active',read:false,archived:false,tags:[{namespace:'app',app:app.principal,id:'receipt'}]},{id:legacyId,legacy:true,app,subject:'Build finished',revision:1,receivedAt:now,updatedAt:now,state:'active',read:false,archived:false,verified:false,tags:[]}],filters:{},pages:[],cursor:null,facets:{apps:[{...app,count:1,unread:1}],tags:[]}}:{items:messages.map(m=>({...m,type:'message'})),cursor:null};
 return {locale,view,modal,brand:{name:'3sln.me'},loading:false,busy:false,offline:false,route:{kind:'home'},filter:'all',search:'',beamGeneration:1,commands:[{id:'messaging.collection',title:'Create view'}],
  session:{account,sessionContext:'ctx'},config:{origin:'https://space.example',termsVersion:'2026-10-11',activityV2Enabled:activity,pushEnabled:false,signupEnabled:true,localDevelopment:true},
  data:{account,features:{},messages,views,contacts,collections:[{id:'c1',name:'Inbox'}],resources:[],rules:[],devices,pushDevices:[],storage:{plan:'free',usedBytes:1000,storageBytes:1000000}},
  incoming,incomingView:'all',contactBook:{directory:[{peer:'990e8400-e29b-41d4-a716-000000000001',grantId:'aa0e8400-e29b-41d4-a716-000000000001',url:'https://other.example/users/river/contact/x?bindle_meta=abc.def',profile:{displayName:'River'}}],profile:{displayName:'Ray',bio:'',avatar:'',discloseToContacts:false,revision:'0'.repeat(32)},profileStatus:'loaded'},
  developerContact:{available:false,reason:'developer-unavailable'},...extra};
}
const MAIN_VIEWS=['inbox','conversations','contacts','resources','rules','notifications','security','connected-apps','automation','billing','settings','space-search'];
const MODALS=[{kind:'rename-device',device:{id:'d2',label:null}},{kind:'remove-saved-contact',contact:{peer:'990e8400-e29b-41d4-a716-000000000001',name:'River'}},{kind:'contact-permissions',contact:{id:'770e8400-e29b-41d4-a716-000000000001',profileFields:[]}},{kind:'command-palette'}];
function renderer(locale,{seen,missing}={}){
 const base=createLocalization({locale,onMissing:(_,id)=>missing?.add(id)}),localization={...base,t:(key,variables)=>{seen?.add(String(key));return base.t(key,variables);}};
 const app=createApp({localize:tree=>localizeTree(tree,localization)}),root=document.createElement('main');
 return {root,render:state=>{dodo.reconcile(root,[app(state)]);return root;}};
}
const literalAttributes=root=>[...root.querySelectorAll('*')].flatMap(node=>[...node.attributes].filter(a=>a.value==='null'||a.value==='undefined').map(a=>`${node.tagName.toLowerCase()}[${a.name}="${a.value}"]`));

test('F2 no attribute renders as "null" or "undefined" across the main views, dialogs and view changes',()=>{
 for(const locale of ['en','es'])for(const activity of [false,true]){
  const fresh=[];for(const view of MAIN_VIEWS){const {render}=renderer(locale);fresh.push(...literalAttributes(render(fixture({locale,view,activity}))).map(x=>`${view}: ${x}`));}
  assert.deepEqual(fresh,[],`first render (${locale}, activity ${activity})`);
  // One root walked through every view, then every dialog: the update path must remove, not stringify, absent values.
  const {render}=renderer(locale),changed=[];for(const view of [...MAIN_VIEWS,...MAIN_VIEWS.slice().reverse()])changed.push(...literalAttributes(render(fixture({locale,view,activity}))).map(x=>`${view}: ${x}`));
  for(const modal of MODALS)changed.push(...literalAttributes(render(fixture({locale,view:'security',activity,modal}))).map(x=>`${modal.kind}: ${x}`));
  changed.push(...literalAttributes(render(fixture({locale,view:'inbox',activity}))).map(x=>`after dialogs: ${x}`));
  assert.deepEqual(changed,[],`view changes (${locale}, activity ${activity})`);
 }
 // The navigation marks only the current view; the others carry no aria-current at all.
 const root=renderer('en').render(fixture({view:'contacts'}));const current=[...root.querySelectorAll('.nav-item')].filter(n=>n.hasAttribute('aria-current'));
 assert.equal(current.length,1);assert.equal(current[0].getAttribute('aria-current'),'page');
});

test('F8 the Spanish catalogue covers the interface text of the main views and dialogs',()=>{
 const seen=new Set(),missing=new Set(),en=renderer('en',{seen}),es=renderer('es',{missing});
 for(const activity of [false,true]){for(const view of MAIN_VIEWS){en.render(fixture({view,activity}));es.render(fixture({locale:'es',view,activity}));}for(const modal of MODALS){en.render(fixture({view:'security',activity,modal}));es.render(fixture({locale:'es',view:'security',activity,modal}));}}
 for(const extra of [{contactBook:{directory:[],profile:{},profileStatus:'loading'}},{contactBook:{directory:[],profile:{},profileStatus:'error'}}]){en.render(fixture({view:'contacts',extra}));es.render(fixture({locale:'es',view:'contacts',extra}));}
 // Untranslated interface text is a key the English render also passed to the translator. Data (numbers, dates,
 // handles, the brand domain) and URL placeholders are not interface text.
 const untranslated=[...missing].filter(key=>seen.has(key)&&/[A-Za-z]{3,}/.test(key)&&!/^https?:/.test(key)&&!/^[\w-]+(?:\.[\w-]+)+$/.test(key));
 assert.deepEqual(untranslated,[]);
 assert.match(es.render(fixture({locale:'es',view:'security'})).textContent,/Última actividad .* · Vence /);
});

test('F1 the profile form disables Save and is aria-busy until the profile loads; loaded values arrive as defaults',()=>{
 const {render}=renderer('en'),loading=render(fixture({view:'contacts',extra:{contactBook:{directory:[],profile:{},profileStatus:'loading'}}})),form=loading.querySelector('.contact-profile-settings form');
 assert.equal(form.getAttribute('aria-busy'),'true');assert.equal(form.querySelector('button[type=submit]').disabled,true);assert.match(form.textContent,/Loading your contact profile/);
 const name=form.querySelector('input[name=displayName]');assert.equal(name.disabled,false,'fields stay editable while loading');
 const loaded=render(fixture({view:'contacts',extra:{contactBook:{directory:[],profile:{displayName:'Stored',bio:'About',avatar:'',discloseToContacts:true,revision:'a'.repeat(32)},profileStatus:'loaded'}}})).querySelector('.contact-profile-settings form');
 assert.equal(loaded,form,'the same form element is kept across the load');assert.equal(loaded.getAttribute('aria-busy'),'false');assert.equal(loaded.querySelector('button[type=submit]').disabled,false);
 assert.equal(name.defaultValue,'Stored','the stored value is the field default; a field the owner already edited keeps its text');
 assert.equal(loaded.querySelector('input[name=discloseToContacts]').checked,true);
 const failed=render(fixture({view:'contacts',extra:{contactBook:{directory:[],profile:{},profileStatus:'error'}}})).querySelector('.contact-profile-settings form');assert.equal(failed.querySelector('button[type=submit]').disabled,true);
});

test('F3 legacy app messages render as earlier app messages, open through the message API and count in the nav badge',()=>{
 const root=renderer('en').render(fixture({view:'inbox',activity:true})),rows=[...root.querySelectorAll('.activity-row')];
 assert.equal(rows.length,2);const legacy=rows.find(row=>row.textContent.includes('Earlier app message'));assert.ok(legacy);assert.match(legacy.textContent,/Unverified app history/);
 assert.equal([...legacy.querySelectorAll('button')].some(b=>/Archive/.test(b.textContent)),false,'legacy rows cannot be archived');
 const events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));legacy.querySelector('.activity-subject').click();assert.equal(events.at(-1).activityAction,'open-legacy');assert.equal(events.at(-1).id,legacyId);
 assert.equal(root.querySelector('.nav-item .counter').textContent,'2','one native unread (facet) plus one unread legacy app message; the peer message is not shown by the activity view');
});

test('F9 an error shows once: the shell alert region steps aside while a dialog is open',()=>{
 const {render}=renderer('en'),error='A device name is required. Enter a name for this device.';
 const open=render(fixture({view:'security',modal:MODALS[0],extra:{error}}));assert.equal([...open.querySelectorAll('[role=alert]')].filter(n=>n.textContent.includes(error)).length,1);
 const closed=render(fixture({view:'security',extra:{error}}));assert.equal([...closed.querySelectorAll('[role=alert]')].filter(n=>n.textContent.includes(error)).length,1);
});

test('F11 and F12 removing a saved contact asks first; the add field shows the bindle_meta form and a full-link hint',()=>{
 const {render}=renderer('en'),root=render(fixture({view:'contacts'})),events=[];root.addEventListener('3sln-intent',event=>events.push(event.detail));
 const remove=[...root.querySelectorAll('.saved-contact button')].find(b=>b.textContent==='Remove saved contact');remove.click();
 assert.equal(events.at(-1).kind,'open-modal');assert.equal(events.at(-1).modal.kind,'remove-saved-contact');assert.equal(events.at(-1).modal.contact.peer,'990e8400-e29b-41d4-a716-000000000001');
 const dialog=render(fixture({view:'contacts',modal:events.at(-1).modal}));assert.match(dialog.textContent,/Remove this saved contact\?/);const confirm=[...dialog.querySelectorAll('.modal button, [role=dialog] button')].find(b=>b.textContent==='Remove saved contact');assert.ok(confirm,'the dialog has its own confirm button');
 const url=root.querySelector('.saved-contacts input[name=url]');assert.match(url.placeholder,/\?bindle_meta=…$/);assert.match(root.querySelector('.saved-contacts').textContent,/Paste the full link/);
});

test('F13 the developer panel follows the page heading and its static unavailable text is not a live region',()=>{
 const root=renderer('en').render(fixture({view:'contacts'})),main=root.querySelector('#main-content')??root;
 const h1=main.querySelector('h1'),panel=main.querySelector('.developer-contact-panel');assert.ok(h1&&panel);assert.ok(h1.compareDocumentPosition(panel)&window.Node.DOCUMENT_POSITION_FOLLOWING,'panel after the h1');
 assert.equal(panel.querySelector('[role=status]'),null);assert.match(panel.textContent,/not ready to receive messages/);
});

test('F15 inbox rows separate the app name from its origin, and the app-message tag has a readable label',()=>{
 const root=renderer('en').render(fixture({view:'inbox'})),row=[...root.querySelectorAll('.message-row')].find(r=>r.textContent.includes('Build finished'));
 assert.match(row.textContent,/Calendar · https:\/\/calendar\.example/);assert.equal([...row.querySelectorAll('.pill')].some(p=>p.textContent==='app-message'),false);assert.ok([...row.querySelectorAll('.pill')].some(p=>p.textContent==='App message'));
 assert.match(renderer('es').render(fixture({locale:'es',view:'inbox'})).textContent,/Mensaje de app/);
});

test('F16 first-party consent schema text is localized; third-party schema text stays literal',()=>{
 const root=document.createElement('div'),model={selection:new Map(),drafts:new Map(),dirty:new Set(),busy:false,error:''},{t}=authorizeLocalization('es'),kit=consentKit({model,t,root,rerender(){},onConfigure(){},locale:'es'});
 const request=(schema,fragment)=>({fragment,required:true,fields:['messages'],revision:'r1',values:{},methods:{},resources:[],affectedApps:[],consumerDigest:'d',purpose:'Send reminders',schema});
 dodo.reconcile(root,[kit.requestCard(request(appMessagesSchema,appMessagesSchema.id))]);assert.match(root.textContent,/Mensajes de apps conectadas/);assert.match(root.textContent,/Elige el recurso local de mensajes/);assert.match(root.textContent,/Mensajes de apps/);
 const outside={...structuredClone(appMessagesSchema),id:'https://schema.example/messages/v1',publisher:'https://schema.example'};
 dodo.reconcile(root,[kit.requestCard(request(outside,outside.id))]);assert.match(root.textContent,/Messages from connected apps/);assert.doesNotMatch(root.textContent,/Mensajes de apps conectadas/);
});

test('F17 and F18 small copy and live-region fixes',()=>{
 const command=builtInModules.flatMap(m=>m.contributions?.commands??[]).find(c=>c.id==='messaging.collection');assert.equal(command.title,'Create view');
 const listed=document.createElement('div');dodo.reconcile(listed,[envBanner({env:{state:'kill'}})]);assert.equal(listed.querySelector('[role=alert]'),null,'page-load banner is plain text');assert.match(listed.textContent,/KILL \(env\)/);
 const live=document.createElement('div');dodo.reconcile(live,[envBanner({env:{state:'kill'}},{live:true})]);assert.ok(live.querySelector('[role=alert]'),'the live edit form keeps the alert');
});
