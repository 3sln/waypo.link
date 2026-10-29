// The signaling owner-page adapters over the durable Node runtime and real HTTP (packages/runtime/routes/
// signaling-owner.mjs; packages/signaling/owner-pages.mjs; release gate "Signaling", owner pages): the JSON routes are
// reachable only as the pages' adapters. A widening action needs the session, Origin and CSRF of the console page, a
// review taken first and the review's server-side arming time; a cross-entity pairing needs recent authentication,
// which a passkey step-up restores. The organization route is checked as an adapter over a recording writer. Local
// behaviour only; reserved .example hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {accountHandle} from '../packages/runtime/routes/shared.mjs';
import {digestJSON,versionRecord,parseEnvelope} from '../packages/core/artefacts.mjs';
import {SIGNALING_FRAGMENT} from '../packages/signaling/extension.mjs';
import {stages,allowedMethods,splitReview} from '../packages/runtime/routes/signaling-owner.mjs';
import {PAGE_REVIEW} from '../packages/signaling/owner-pages.mjs';
import {kindBody,CHAT,SYNC} from './helpers/signaling-fixture.mjs';
import {reviewedHTTP} from './helpers/signaling-owner-review.mjs';
import {softAuthenticator,registerPending,passkeyStepUp} from './helpers/soft-passkey.mjs';

const ORIGIN='https://signaling-pages.example',APP='https://app.example/client',APP2='https://other.example/client';
const envelope=spec=>({bindle_artefact:1,id:spec.line,kind:'intent',versions:[{version:1,prev:null,body:kindBody(spec)}]});
const KINDS=[{line:CHAT,parties:'any'},{line:SYNC,parties:'self'}],ENVELOPES=Object.fromEntries(KINDS.flatMap(k=>{const e=envelope(k);return [[k.line,e],[k.line+'/envelope',e]];}));
const REF=Object.fromEntries(await Promise.all(KINDS.map(async k=>{const e=ENVELOPES[k.line];return [k.line,{artefact:k.line,version:1,digest:await digestJSON(versionRecord(parseEnvelope(e,{id:k.line}),e.versions[0]))}];})));
const CLIENTS=JSON.stringify([{id:APP,name:'App',origin:'https://app.example',redirectUris:['https://app.example/callback']},{id:APP2,name:'Other app',origin:'https://other.example',redirectUris:['https://other.example/callback']}]);
const ON={EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:CLIENTS,FEDERATION_CONTRACTS:JSON.stringify(ENVELOPES),SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function host(t){
 const directory=await mkdtemp(join(tmpdir(),'signaling-pages-'));let network=1;
 const app=await createNodeServer({directory,config:{...ON,APP_ORIGIN:ORIGIN,LOCAL_DEVELOPMENT:'true',WORK_LIMITS_ENABLED:'false'}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const fetch=(path,{user,method='GET',value,csrf=true,origin=true}={})=>app.fetch(new Request(ORIGIN+path,{method,headers:{'CF-Connecting-IP':'192.0.2.'+(network++%250+1),...user?{Cookie:user.cookie}:{},...user&&csrf?{'X-CSRF-Token':user.csrf}:{},...origin?{Origin:ORIGIN}:{},...value===undefined?{}:{'Content-Type':'application/json'}},...value===undefined?{}:{body:JSON.stringify(value)}}));
 const call=async(user,method,path,value,options={})=>{const r=await fetch(path,{user,method,value,...options});const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body};};
 const person=async handle=>{
  const post=(path,value)=>fetch(path,{method:'POST',value});
  const pending=await (await post('/api/auth/signup',{handle,method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();
  const authenticator=softAuthenticator({origin:ORIGIN});await registerPending(authenticator,async(path,value)=>(await post(path,value)).json(),pending);
  const recovery=await (await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
  const r=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await r.json();
  return {id:session.account.id,handle:session.account.handle,cookie:r.headers.get('Set-Cookie').split(';')[0],csrf:session.csrfToken,authenticator,principal:{iss:ORIGIN,sub:session.account.id}};
 };
 const grant=async(user,clientId=APP)=>{const id='g'+Math.random().toString(36).slice(2);await app.resources.federationShard(user.id).metadata.transaction(tx=>tx.set('federation/grant/'+id,{id,active:true,subject:`${ORIGIN}/entities/${user.id}`,clientId,fragment:SIGNALING_FRAGMENT,fields:['signaling'],resources:{},methods:{},createdAt:Date.now()}));};
 return {app,fetch,call,person,grant};
}

test('owner pages over HTTP: the review and the decision need the console session, Origin and CSRF; the decision waits for the server arming time and is single-use',async t=>{
 const h=await host(t),a=await h.person('sig_page_a');await h.grant(a);
 const input={action:'session-approve',input:{clientId:APP,kind:CHAT}};
 assert.equal((await h.call(null,'POST','/api/signaling/review',input)).status,401,'no session');
 assert.deepEqual((await h.call(a,'POST','/api/signaling/review',input,{csrf:false})).body.error,'csrf');
 assert.deepEqual((await h.call(a,'POST','/api/signaling/review',input,{origin:false})).body.error,'csrf');
 assert.equal((await h.call(a,'GET','/api/signaling/review')).status,405);
 const r=await h.call(a,'POST','/api/signaling/review',input);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual(r.body.input,{clientId:APP,kind:REF[CHAT]});assert.ok(r.body.armAt-Date.now()<=PAGE_REVIEW.dwellMs);
 // The decision: CSRF first, then the arming time (the review survives an early click), then exactly once.
 const decide=(options,extra={})=>h.call(a,'POST','/api/intents/session-approve',{...r.body.input,review:r.body.review,...extra},options);
 assert.deepEqual((await decide({csrf:false})).body.error,'csrf');
 const early=await decide();assert.deepEqual([early.status,early.body.error],[409,'decision_not_armed']);
 await sleep(Math.max(0,r.body.armAt-Date.now())+10);
 assert.deepEqual((await decide({},{review:'not-a-review'})).body.error,'review_required','a malformed review id is no review');
 assert.deepEqual((await decide({},{actor:{kind:'owner',owner:a.id,parties:[APP2]}})).status,400,'never an actor from the body');
 const ok=await decide();assert.deepEqual([ok.status,ok.body.kind],[200,CHAT]);
 assert.deepEqual((await decide()).body.error,'review_required','single use');
 // Another person's review id authorizes nothing for this owner.
 const b=await h.person('sig_page_b');await h.grant(b);
 const theirs=await h.call(b,'POST','/api/signaling/review',{action:'session-approve',input:{clientId:APP,kind:SYNC}});await sleep(PAGE_REVIEW.dwellMs+10);
 assert.deepEqual((await h.call(a,'POST','/api/intents/session-approve',{...theirs.body.input,review:theirs.body.review})).body.error,'review_required');
 // Narrowing never needs a review.
 assert.deepEqual((await h.call(a,'POST','/api/intents/session-unapprove',{clientId:APP,kind:CHAT})).body,{removed:true,ended:0});
});

test('owner pages over HTTP: a cross-entity pairing needs recent authentication; a passkey step-up restores it; the pairing page read and the by-peer data',async t=>{
 const h=await host(t),a=await h.person('sig_fresh_a'),b=await h.person('sig_fresh_b');await h.grant(a);
 const post=(path,value)=>h.call(a,'POST',path,value);
 await reviewedHTTP(post,[{path:'/api/intents/session-approve',action:'session-approve',input:{clientId:APP,kind:CHAT}}]);
 const cross={action:'pairing-create',input:{kind:CHAT,local:{client_id:APP},peer:{handle:b.handle},opens:'local',label:'Bob'}};
 // Six minutes later the session is no longer fresh.
 const realNow=Date.now;Date.now=()=>realNow()+360000;t.after(()=>{Date.now=realNow;});
 const stale=await post('/api/signaling/review',cross);assert.deepEqual([stale.status,stale.body.error],[403,'reauthentication_required']);
 const confirmed=await passkeyStepUp(a.authenticator,async(path,value)=>{const r=await post(path,value);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;});assert.ok(Number.isSafeInteger(confirmed.stepUpUntil));
 const r=await post('/api/signaling/review',cross);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual(r.body.disclosure.peer,{principal:b.principal,issuerOrigin:ORIGIN,handle:b.handle,sameProvider:true});assert.equal(r.body.disclosure.activateNow,true);
 await sleep(Math.max(0,r.body.armAt-Date.now())+10);
 const created=await post('/api/signaling/pairing-create',{...r.body.input,activate:true,review:r.body.review});assert.deepEqual([created.status,created.body.state],[200,'live']);
 const page=await h.call(a,'GET','/api/signaling/pairing?id='+created.body.id);
 assert.equal(page.status,200);assert.equal(page.body.pairing.id,created.body.id);assert.equal(page.body.peer.handle,b.handle);assert.deepEqual(page.body.parties,[{client_id:APP,connected:true,approved:true}]);
 assert.equal((await h.call(a,'GET','/api/signaling/pairing?id=pr_'+'A'.repeat(22))).status,404);
 const settings=(await h.call(a,'GET','/api/signaling/settings')).body;
 assert.deepEqual(settings.pairings.filter(p=>p.peer.principal).map(p=>[p.peer.principal.sub,p.kind.artefact,p.state]),[[b.id,CHAT,'live']],'the by-peer list is built from the cross-entity pairings');
});

test('organization designation route: an adapter over the organization owner interface (acting authority), review evidence lifted out of the body, widening 404 while off',async()=>{
 const org='0a0a0a0a-0000-4000-8000-0000000000c1',seen=[];
 const object={orgsActingAuthority:async(owner,x)=>{seen.push(['authority',owner,x.power,x.widen,x.actor.entity]);return {authTime:null};},signalingDispatch:async(owner,x)=>{seen.push(['dispatch',owner,structuredClone(x)]);return {ok:true};}};
 const env={APP_ORIGIN:ORIGIN,ORGANIZATIONS_ENABLED:'true',SIGNALING_ENABLED:'true',SESSION_KINDS_ENABLED:'true',EXTENSIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true'};
 const actor={principal:{iss:ORIGIN,sub:'0a0a0a0a-0000-4000-8000-0000000000a1'},entity:{kind:'person',id:'0a0a0a0a-0000-4000-8000-0000000000a1'},authTime:Date.now(),epoch:0};
 const stage=async(method,value,extra={})=>{const path=`/api/orgs/${org}/signaling`,r=await stages.owner({request:new Request(ORIGIN+path,{method,...value===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}}),env:{...env,...extra},url:new URL(ORIGIN+path),path,id:org,object,actor,context:{},owner:{}});return {status:r.status,body:await r.json()};};
 assert.deepEqual(allowedMethods(`/api/orgs/${org}/signaling`),['GET','POST']);
 assert.deepEqual(await stage('GET'),{status:200,body:{ok:true,enabled:true}});
 assert.deepEqual(seen.splice(0),[['authority',org,'admin',false,{kind:'organization',id:org}],['dispatch',org,{operation:'signaling.service',actor:{kind:'owner',owner:org}}]]);
 await stage('POST',{operation:'review',input:{action:'set-service',input:{designated:true,revision:0}}});
 assert.deepEqual(seen.splice(0),[['authority',org,'admin',true,{kind:'organization',id:org}],['dispatch',org,{operation:'signaling.review',actor:{kind:'owner',owner:org},input:{action:'set-service',input:{designated:true,revision:0}}}]]);
 await stage('POST',{operation:'set-service',input:{designated:true,revision:0},review:'rv_'+'a'.repeat(22)});
 assert.deepEqual(seen.splice(0).at(-1),['dispatch',org,{operation:'signaling.set-service',actor:{kind:'owner',owner:org,review:'rv_'+'a'.repeat(22)},input:{designated:true,revision:0}}]);
 await stage('POST',{operation:'set-service',input:{designated:false,revision:1}});
 assert.deepEqual(seen.splice(0),[['authority',org,'admin',false,{kind:'organization',id:org}],['dispatch',org,{operation:'signaling.set-service',actor:{kind:'owner',owner:org},input:{designated:false,revision:1}}]],'removal is narrowing');
 assert.equal((await stage('POST',{operation:'review',input:{action:'session-approve',input:{}}})).status,400,'only the designation is reviewed here');
 assert.equal((await stage('POST',{operation:'set-policy',input:{}})).status,400);
 assert.equal((await stage('POST',{operation:'set-service',input:{},actor:{}})).status,400,'no member beyond operation, input and review');
 seen.length=0;assert.deepEqual(await stage('POST',{operation:'set-service',input:{designated:true,revision:0}},{SIGNALING_ENABLED:'false'}),{status:404,body:{error:'not_found'}});
 assert.deepEqual(await stage('POST',{operation:'set-service',input:{designated:false,revision:0}},{SIGNALING_ENABLED:'false'}),{status:200,body:{ok:true}},'narrowing stays available while off');
 const refused={...object,orgsActingAuthority:async()=>{throw Object.assign(new Error('Not found.'),{code:'not_found',status:404});}};
 const path=`/api/orgs/${org}/signaling`,r=await stages.owner({request:new Request(ORIGIN+path),env,url:new URL(ORIGIN+path),path,id:org,object:refused,actor,context:{},owner:{}});
 assert.deepEqual([r.status,await r.json()],[404,{error:'not_found'}],'a person without the organization\'s admin power learns nothing');
 assert.deepEqual(splitReview({a:1,review:'rv_'+'b'.repeat(22)}),{input:{a:1},review:'rv_'+'b'.repeat(22)});assert.deepEqual(splitReview({a:1,review:'x'}),{input:{a:1},review:null});assert.deepEqual(splitReview([1]),{input:[1],review:undefined});
});
