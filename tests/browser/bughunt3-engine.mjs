// Browser bug hunt round 3 (DEVLOG 2026-10-27) driven through the real ngin engine and Actions: B1 a stale profile
// save that only withdrew sharing is explained, B4 the identity `step_up_required` answer opens the owner
// confirmation and retries once, B9 a failure clears an earlier success notice. B2/B3 live in release-state.mjs and
// B7 in organizations-engine.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {within} from '../helpers/async.mjs';
import {Window} from 'happy-dom';
const window=new Window({url:'https://space.example/console'}),names=['document','HTMLElement','CustomEvent','Event','EventTarget','Node','Element','FormData'];
const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));for(const name of names)globalThis[name]=window[name];
const {Engine,Provider}=await import('../../apps/web/src/shared/stack.mjs');
const {default:StateProvider}=await import('../../apps/web/src/providers/browser-state.mjs');
const {SaveProfile}=await import('../../apps/web/src/bl/contact-profile.mjs');
const {OwnerFlow}=await import('../../apps/web/src/bl/owner-flow.mjs');
const {ConfirmOwner}=await import('../../apps/web/src/bl/step-up.mjs');
test.after(async()=>{await window.happyDOM.close();for(const name of names)globalThis[name]=previous[name];});

const OWNER='550e8400-e29b-41d4-a716-446655440001',REVISION='a'.repeat(32);
async function fixture({get,request,submissions={}}={}){
 const calls=[],effects=[];
 const api={async get(path){calls.push({method:'GET',path});return get?get(path):{};},async request(path,body,method='POST'){calls.push({method,path,body});return request?request(path,body,method):{};}};
 const browser={consumeSubmission:id=>submissions[id],secret:()=>undefined,storeSecret(){},captureFocus:()=>effects.push(['captureFocus']),restoreFocus:()=>effects.push(['restoreFocus']),focus:selector=>effects.push(['focus',selector]),setCaptchaAction(){},installCaptcha(){}};
 const engine=new Engine({providers:{state:StateProvider,api:Provider.fromSingleton(api),browser:Provider.fromSingleton(browser),portalContributions:Provider.fromSingleton({}),recoveryFile:Provider.fromSingleton({})}});
 const write=patch=>engine.container.use({state:{write:true}},({state})=>state.transition(next=>Object.assign(next,patch))),read=()=>engine.container.use(['state'],({state})=>state.snapshot());
 await write({loading:false,locale:'en',view:'contacts',route:{kind:'home'},config:{},session:{account:{id:OWNER},sessionContext:'ctx'},beamGeneration:1,data:{collections:[],devices:[]}});
 return {engine,calls,effects,write,read,dispatch:action=>engine.dispatch(action).next('complete'),act:action=>within(engine.dispatch(action).next('complete'),action.constructor.name),close:()=>engine.dispose()};
}

// B1 (a stale save that only withdrew sharing) retired with the disclosure switch in contacts phase 4: the profile is
// display name and avatar only, so a save the server stored as sent is a plain success and carries no other member.
test('B1 a profile save stores only display name and avatar and reports a plain success',async()=>{
 const g=await fixture({request:async(path,body)=>({displayName:body.displayName,avatar:body.avatar,revision:'e'.repeat(32)})});
 try{await g.write({contactProfile:{profile:{displayName:'Old',avatar:'',revision:REVISION},status:'loaded',epoch:0}});await g.act(new SaveProfile({values:{displayName:'Mine',bio:'stale',avatar:'',discloseToContacts:'on'}}));const s=await g.read();assert.equal(s.notice,'Profile saved.');assert.equal(s.error??'','');
  assert.deepEqual(g.calls.find(c=>c.method==='PUT').body,{displayName:'Mine',avatar:'',expectedRevision:REVISION});assert.deepEqual(s.contactProfile.profile,{displayName:'Mine',avatar:'',revision:'e'.repeat(32)});}finally{await g.close();}
});

class Export extends OwnerFlow {async perform(r,ctx){const job=await r.api.request('/api/exports',{purpose:'owner'});r.state.transition(next=>Object.assign(next,{notice:'exported:'+job.id}));}}
test('B4 identity step_up_required opens the owner confirmation; confirming retries the request once',async()=>{
 let confirmed=false;
 const f=await fixture({submissions:{pw:{password:'correct horse'}},request:async path=>{
  if(path==='/api/exports'){if(!confirmed)throw Object.assign(Error('Confirm your password or passkey to continue.'),{code:'step_up_required',status:400});return {id:'job-1'};}
  if(path==='/api/auth/step-up/begin')return {password:true,passkey:false};if(path==='/api/auth/step-up'){confirmed=true;return {};}throw Error('unexpected '+path);}});
 try{
  const pending=f.dispatch(new Export());
  for(let i=0;i<200&&!(await f.read()).stepUp;i++)await new Promise(resolve=>setTimeout(resolve,0));
  const prompt=(await f.read()).stepUp;assert.ok(prompt,'the confirmation is shown instead of a generic refusal');assert.equal(prompt.password,true);assert.deepEqual(f.effects.at(-1),['focus','.step-up h2']);
  await f.act(new ConfirmOwner({id:prompt.id,method:'password',operationId:'pw'}));await within(pending,'Export');
  const s=await f.read();assert.equal(s.stepUp,null);assert.equal(s.notice,'exported:job-1');assert.equal(f.calls.filter(c=>c.path==='/api/exports').length,2,'one refused attempt, one retry');
  assert.deepEqual(f.calls.find(c=>c.path==='/api/auth/step-up').body,{method:'password',password:'correct horse'});
 }finally{await f.close();}
});

test('B9 a failed action clears the previous success notice so the two never show together',async()=>{
 const f=await fixture({request:async()=>{throw Object.assign(Error('Use an HTTPS avatar URL.'),{code:'profile_invalid',status:400});}});
 try{await f.write({notice:'Profile saved.',contactProfile:{profile:{displayName:'',avatar:'',revision:REVISION},status:'loaded',epoch:0}});
  await f.act(new SaveProfile({values:{displayName:'',avatar:'http://x.example/a.png'}}));const s=await f.read();assert.equal(s.error,'Use an HTTPS avatar URL.');assert.equal(s.notice,'');}finally{await f.close();}
 class Fails extends OwnerFlow {async perform(r){await r.api.request('/api/nope',{});}}
 const g=await fixture({request:async()=>{throw Object.assign(Error('Nope.'),{status:409,code:'conflict'});}});
 try{await g.write({notice:'Saved.'});await g.act(new Fails());const s=await g.read();assert.equal(s.error,'Nope.');assert.equal(s.notice,'');}finally{await g.close();}
 // A partial success this action published itself (for example one of two revocations) stays beside the error.
 class Partial extends OwnerFlow {async perform(r,ctx){r.state.transition(next=>Object.assign(next,{notice:'App access revoked.'}));await r.api.request('/api/nope',{});}}
 const h=await fixture({request:async()=>{throw Object.assign(Error('Temporary failure'),{status:409,code:'conflict'});}});
 try{await h.write({notice:'Saved.'});await h.act(new Partial());const s=await h.read();assert.equal(s.error,'Temporary failure');assert.equal(s.notice,'App access revoked.');}finally{await h.close();}
});
