// RTC-c consent UI: AMD-X1 bound options in the shared consent kit (happy-dom). Each requested value is shown with its
// facts, nothing is preselected, approval stays blocked below the minimum, and only checked values are sent.
import test from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';
const window=new Window({url:'https://provider.example/oauth/authorize?request_id=x'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(n=>[n,globalThis[n]]));for(const n of names)globalThis[n]=window[n];
const {dodo}=await import('../../apps/web/src/shared/stack.mjs');
const {consentKit}=await import('../../apps/web/src/ui/authorize-entry-consent.mjs');
const {authorizeLocalization}=await import('../../packages/i18n/authorize-catalogue.mjs');
const {RTC_SIGNALING_SLOT_MANIFEST}=await import('../../packages/rtc/extension.mjs');
const {REGISTERED_PURPOSES,RTC_PURPOSE_REFERENCES,purposeDisclosure}=await import('../../packages/rtc/purposes.mjs');
test.after(async()=>{await window.happyDOM.close();for(const n of names)globalThis[n]=previous[n];});
const [CALL,,FILES]=RTC_PURPOSE_REFERENCES.map(r=>r.artefact);
const request=(extra={})=>({fragment:RTC_SIGNALING_SLOT_MANIFEST.id,required:false,fields:['signaling'],revision:'r1',values:{},methods:{},resources:[],affectedApps:[],consumerDigest:'d',purpose:'Ring you',schema:structuredClone(RTC_SIGNALING_SLOT_MANIFEST),
 options:{purposes:[CALL,FILES]},bound:{schema:{purposes:RTC_SIGNALING_SLOT_MANIFEST.slot.options.consumer.purposes},versions:{[CALL]:{version:1,digest:RTC_PURPOSE_REFERENCES[0].digest},[FILES]:{version:1,digest:RTC_PURPOSE_REFERENCES[2].digest}},disclosure:{[CALL]:purposeDisclosure(REGISTERED_PURPOSES[0].versions[0].body),[FILES]:purposeDisclosure(REGISTERED_PURPOSES[2].versions[0].body)}},...extra});
function setup(locale='en'){const model={selection:new Map(),drafts:new Map(),dirty:new Set(),busy:false,error:''},root=document.createElement('div');document.body.append(root);const {t}=authorizeLocalization(locale);let kit;const render=r=>dodo.reconcile(root,[kit.requestCard(r)]);kit=consentKit({model,t,root,rerender:()=>render(current),onConfigure(){}});let current;return {model,root,kit,show:r=>{current=r;render(r);}};}

test('bound purposes are listed with plain facts, none preselected, and approval waits for a choice',()=>{
 const {root,kit,show}=setup(),r=request(),view={requests:[r]};show(r);
 const box=root.querySelector('[data-bound-options="true"]');assert.ok(box,'bound options fieldset');const values=[...box.querySelectorAll('[data-bound-value]')].map(n=>n.getAttribute('data-bound-value'));assert.deepEqual(values,[CALL,FILES]);
 const inputs=[...box.querySelectorAll('input[type=checkbox]')];assert.equal(inputs.length,2);assert.ok(inputs.every(i=>!i.checked),'no preselection');
 assert.match(box.textContent,/Call · spec\.bindle\.example/);assert.match(box.textContent,/Can ring you/);assert.match(box.textContent,/Your devices and other people/);assert.match(box.textContent,/Shown before you answer: bytes, files/);assert.match(box.textContent,/call\/v1 · v1/);
 assert.equal(kit.approvalBlocked(view),true,'below the minimum of one purpose');
 inputs[1].checked=true;inputs[1].dispatchEvent(new Event('change'));assert.equal(kit.approvalBlocked(view),false);
 assert.deepEqual(JSON.parse(JSON.stringify(kit.approvedSelections(view))),[{fragment:r.fragment,revision:'r1',fields:['signaling'],resources:{signaling:[]},methods:{signaling:{}},options:{purposes:[FILES]}}]);
});

test('declining the fragment sends no options; untrusted titles render as text; Spanish copy',()=>{
 const {root,kit,model,show}=setup('es'),r=request();r.bound.disclosure[CALL]={...r.bound.disclosure[CALL],title:'<img src=x onerror=alert(1)>'};show(r);
 assert.equal(root.querySelector('img'),null,'publisher text is never markup');assert.match(root.textContent,/<img src=x/);assert.match(root.textContent,/Elige lo que esta app puede hacer/);
 model.selection.get(r.fragment).declined=true;assert.deepEqual(kit.approvedSelections({requests:[r]}),[]);assert.equal(kit.approvalBlocked({requests:[r]}),false);
 // A request without bound options keeps its previous shape (no `options` member).
 const fresh=setup(),plain=request();delete plain.options;delete plain.bound;fresh.show(plain);assert.equal(fresh.root.querySelector('[data-bound-options]'),null);assert.equal(Object.hasOwn(fresh.kit.approvedSelections({requests:[plain]})[0],'options'),false);assert.equal(fresh.kit.approvalBlocked({requests:[plain]}),false);
});
