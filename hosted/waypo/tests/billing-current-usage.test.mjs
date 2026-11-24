import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createPolarHostedAdapter} from '../polar-adapter.mjs';
import {createHostedExtensionFactory} from '../extension.mjs';
import {TransactionStore} from '../../../../waypo/tests/engine/helpers/transaction-store.mjs';
const issuer='https://identity.example/api/auth',origin=new URL(issuer).origin,owner={issuer,subject:'owner',sessionId:'session'};
const options={environment:'sandbox',organizationId:'org',productId:'product',webhookSecret:'fixture',paidPlansEnabled:false,subscriptionServicingEnabled:true,enableActions:false,sdk:{}};
function snapshotEntries(store){const value=store.snapshot();assert.ok(value instanceof Map,'maintained store snapshot must be a Map');return [...value.entries()];}
function fixture(usedBytes){const store=new TransactionStore(),policyEvents={authorizeBillingPurchase:async()=>true,accountCapacity:async()=>({maxAccountBytes:500000000,maxAdditionalBytes:1000000000,mayWrite:true,...usedBytes===undefined?{}:{usedBytes}}),recordVerifiedBillingInTransaction:async()=>({recorded:true})};return{store,policyEvents};}
test('current prebilling storage is projected read-only without inventing a billing ledger or historical usage',async()=>{
 const f=fixture(421),before=snapshotEntries(f.store),adapter=createPolarHostedAdapter({...options,...f,issuer,returnUrl:origin+'/account/billing',authorizeOwner:async()=>({allowed:true})});
 const result=await adapter.inspect({subject:owner.subject,context:{}});assert.equal(result.storageUsedBytes,421);assert.equal(result.storageAllowanceBytes,500000000);assert.equal(result.ledger.usage.usedBytes,0);assert.deepEqual(snapshotEntries(f.store),before);
});
test('missing or invalid trusted current usage remains unknown instead of falling back to historical zero',async()=>{
 for(const value of[undefined,null,-1,NaN,Infinity,'421']){const f=fixture(value),adapter=createPolarHostedAdapter({...options,...f,issuer,returnUrl:origin+'/account/billing',authorizeOwner:async()=>({allowed:true})});assert.equal((await adapter.inspect({subject:owner.subject,context:{}})).storageUsedBytes,null);assert.equal(snapshotEntries(f.store).length,0);}
});
async function renderedUsage(t,value){
 const f=fixture(value),extension=await createHostedExtensionFactory(options)({...f,config:{issuer},resolveOwner:async()=>owner});t.after(()=>extension.close());
 const script=await(await extension.handle(new Request(origin+'/account/billing.js'))).text(),elements=new Map();let finish,timer;const ready=new Promise(resolve=>{finish=resolve;});
 class Element{
  constructor(name){this.name=name;this.children=[];this.text='';this.disabled=false;this.hidden=false;}
  set textContent(value){this.text=String(value);this.children=[];if(this.name==='#status'&&this.text)finish();}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.text='';this.children=children;}
  setAttribute(){}
 }
 const get=name=>{if(!elements.has(name))elements.set(name,new Element(name));return elements.get(name);};
 const document={hidden:false,querySelector:get,createElement:name=>new Element(name),addEventListener(){}},window={addEventListener(){}};
 const fetch=async path=>path==='/api/auth/get-session'?Response.json({user:{id:owner.subject},session:{id:owner.sessionId}}):extension.handle(new Request(origin+path));
 try{runInNewContext(script,{document,window,fetch,Intl,Date,confirm:()=>false},{timeout:1000});await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owner usage UI did not settle')),1000);})]);}finally{clearTimeout(timer);}
 const details=get('#details').children,usage=details[details.findIndex(element=>element.textContent==='Storage used')+1]?.textContent;
 return{usage,capacity:get('#capacity').textContent,portalHidden:get('#portal').hidden,records:snapshotEntries(f.store).length};
}
test('served owner UI shows actual prebilling bytes and keeps unknown usage distinct from zero',async t=>{
 const known=await renderedUsage(t,421);assert.equal(known.usage,'421 B of 500 MB');assert.equal(known.portalHidden,true);assert.equal(known.records,0);
 const unknown=await renderedUsage(t,undefined);assert.equal(unknown.usage,'Not available right now');assert.match(unknown.capacity,/Storage usage is not available right now/);assert.doesNotMatch(unknown.capacity,/remaining|full/);assert.equal(unknown.records,0);
 const zero=await renderedUsage(t,0);assert.equal(zero.usage,'0 B of 500 MB');assert.match(zero.capacity,/500 MB remaining/);
});
