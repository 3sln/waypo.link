// Wargame 2026-10-23 F1 (provisional): one signed-in person must not be able to spend the process-wide Node directory
// egress budget. Consent-screen lookups are cache-only (a miss warms the person's own shared directory in the
// background), each controller shares one directory (manifest cache and limiter), the Node egress budgets per tenant and
// issuer with a reserved share for background refresh, and the acquire route has a per-owner limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {foreignDirectory} from '../packages/runtime/account/foreign-directory.mjs';
import {methods} from '../packages/runtime/account/member-certificates.mjs';
import {createNodeDirectoryFetch} from '../packages/federation/node-directory-fetch.mjs';
import {stages,MEMBER_ACQUIRE_PER_MINUTE} from '../packages/runtime/routes/member-certificates.mjs';

const issuer='https://home.example',org='55555555-5555-4555-8555-555555555555',person='99999999-9999-4999-8999-999999999999',member='66666666-6666-4666-8666-666666666666';
const ON={APP_ORIGIN:'https://provider.example',DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',ORG_FOREIGN_MEMBERS_ENABLED:'true',ORG_FOREIGN_ISSUERS:JSON.stringify([issuer])};
const manifest={version:'0',issuer,authorization_request_endpoint:issuer+'/r',authorization_endpoint:issuer+'/a',token_endpoint:issuer+'/t',rpc_endpoint:issuer+'/rpc',jwks_uri:issuer+'/jwks',preferences_contract:'https://contracts.example/p',login_presentation:['redirect'],dpop_signing_alg_values_supported:['ES256'],extensions:[{spec:'https://spec.bindle.example/extensions/directory/v1',options:{directory_url:issuer+'/directory'}}]};
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function world(t){
 const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['verify','sign']);const {x,y}=await crypto.subtle.exportKey('jwk',p.publicKey);
 const doc={v:1,iss:issuer,sub:member,kind:'person',keys:[{kid:'k1',use:'sig',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x,y},state:'active',predecessor:null,continuity:null}]};
 const net={dials:[]},dir=await mkdtemp(join(tmpdir(),'dir-tenant-'));
 const answer=path=>path.endsWith('manifest.json')?[200,manifest]:path===`/directory?sub=${member}`?[200,{iss:issuer,sub:member,identity:`${issuer}/identity/${member}`}]:path===`/identity/${member}/identity.json`?[200,doc]:[404,{error:'not_found'}];
 const app=await createNodeServer({directory:dir,config:{...ON,DIRECTORY_DNS_LOOKUP:async()=>[{address:'8.8.8.8',family:4}],DIRECTORY_HTTPS_REQUEST:(options,callback)=>{
  net.dials.push(options.path);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const [status,body]=answer(options.path);const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':'application/json','cache-control':'max-age=300'};res.destroy=()=>{};callback(res);res.emit('data',Buffer.from(JSON.stringify(body)));res.emit('end');});return req;}}});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 return {net,personAccount:app.resources.accounts.get(person),orgAccount:app.resources.accounts.get(org)};
}
test('one person viewing consent screens cannot starve an organization\'s foreign directory refresh',async t=>{
 const w=await world(t);
 for(let i=0;i<40;i++)await methods.memberCertificateOrganization.call(w.personAccount,person,`${issuer}/identity/${crypto.randomUUID()}`);
 await settle();
 const d=foreignDirectory(w.orgAccount.config,{store:w.orgAccount.metadata,owner:org});
 const result=await d.refresh({issuer,subject:member});
 assert.equal(result?.sub,member,'the organization refresh is served from its own budget');
});
test('consent inspections share one directory: the manifest is fetched once',async t=>{
 const w=await world(t);
 for(let i=0;i<5;i++){const r=await methods.memberCertificateOrganization.call(w.personAccount,person,`${issuer}/identity/${crypto.randomUUID()}`);assert.equal(r.verified,false);}
 await settle();
 assert.equal(w.net.dials.filter(p=>p.endsWith('manifest.json')).length,1);
 assert.equal(foreignDirectory(w.personAccount.config,{store:w.personAccount.metadata,owner:person}),foreignDirectory(w.personAccount.config,{store:w.personAccount.metadata,owner:person}),'one directory per controller');
});
const stub=()=>(o,cb)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=404;res.headers={};res.destroy=()=>{};cb(res);res.emit('end');});return req;};
test('a budget one caller spent recovers within an hour (no flat process-wide day budget)',async()=>{
 let now=0;const egress=createNodeDirectoryFetch({allowedOrigins:[issuer],clock:()=>now,lookup:async()=>[{address:'8.8.8.8',family:4}],request:stub()});
 for(let i=0;i<200;i++){now=i*2001;await egress(`${issuer}/directory?sub=${crypto.randomUUID()}`,{}).catch(()=>{});}
 now+=3600000;await assert.doesNotReject(egress(`${issuer}/directory?sub=${member}`,{}));
});
test('per-tenant egress: an exhausted interactive tenant leaves other tenants and background refresh untouched',async()=>{
 let now=1000;const egress=createNodeDirectoryFetch({allowedOrigins:[issuer],clock:()=>now,lookup:async()=>[{address:'8.8.8.8',family:4}],request:stub()});
 const call=budget=>egress(`${issuer}/directory?sub=${crypto.randomUUID()}`,{budget});let refused=0;
 for(let i=0;i<100;i++)await call({tenant:'attacker',priority:'interactive'}).catch(()=>refused++);
 assert.ok(refused>=80,`attacker refused ${refused}/100`);
 await assert.doesNotReject(call({tenant:'other',priority:'interactive'}));
 await assert.doesNotReject(call({tenant:'org',priority:'background',allowance:30}));
 // Many interactive tenants together still leave the background half of the global window.
 const small=createNodeDirectoryFetch({allowedOrigins:[issuer],clock:()=>now,maxRequestsPerMinute:20,lookup:async()=>[{address:'8.8.8.8',family:4}],request:stub()});
 for(let i=0;i<40;i++)await small(`${issuer}/directory?sub=${crypto.randomUUID()}`,{budget:{tenant:'t'+i,priority:'interactive'}}).catch(()=>{});
 let background=0;for(let i=0;i<10;i++)await small(`${issuer}/directory?sub=${crypto.randomUUID()}`,{budget:{tenant:'org'+i,priority:'background'}}).then(()=>background++,()=>{});
 assert.equal(background,10,'background keeps its reserved half');
});
test('the acquire route limits each owner',async()=>{
 const seen=[];const env={APP_ORIGIN:'https://provider.example',ABUSE_HASH_KEY:'k',ABUSE:{consume:async(key,limits)=>{seen.push([key,limits.limit]);return false;}}};
 const response=await stages.owner({request:new Request('https://provider.example/api/member-certificates/acquire?aud=x'),env,path:'/api/member-certificates/acquire',id:person,object:{}});
 assert.equal(response.status,429);assert.equal((await response.json()).error,'rate_limited');
 assert.ok(seen.some(([key,limit])=>key.startsWith('member-acquire/owner/')&&!key.includes(person)&&limit===MEMBER_ACQUIRE_PER_MINUTE));
});
