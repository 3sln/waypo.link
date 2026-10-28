// Review follow-ups to the 2026-10-23 directory wargame fixes (DEVLOG "Links, Beam, device and directory wargame
// fixes"): F1 one tenant cannot spend the global Node egress (background budget per tenant across origins, class
// isolation, daily share, server-side allowance clamp); F5 the document cache is bounded by bytes; refused claimed
// refreshes spend no global tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNodeDirectoryFetch,NODE_DIRECTORY_BUDGETS} from '../packages/federation/node-directory-fetch.mjs';
import {IdentityDirectory,DIRECTORY_LIMITS} from '../packages/federation/directory.mjs';

const origins=['https://a.example','https://b.example','https://c.example','https://d.example'];
function egress(){
 let now=1_000_000;const request=(options,cb)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json'};res.destroy=()=>{};cb(res);res.emit('data',Buffer.from('{}'));res.emit('end');});return req;};
 const f=createNodeDirectoryFetch({allowedOrigins:origins,lookup:async()=>[{address:'8.8.8.8',family:4}],request,clock:()=>now});
 const call=(o,budget)=>f(o+'/x.json',{method:'GET',headers:{Accept:'application/json'},budget}).then(()=>true,e=>e.code||e.message);
 return {call,advance:ms=>{now+=ms;}};
}
test('F1: one tenant\'s background traffic across all origins is capped per minute and per day; others keep their share',async()=>{
 const e=egress();let minute=0;
 for(const o of origins)for(let i=0;i<200;i++)if(await e.call(o,{tenant:'evil-org',priority:'background',allowance:100000})===true)minute++;
 const classMinute=NODE_DIRECTORY_BUDGETS.perMinute/2;
 assert.ok(minute<=classMinute/NODE_DIRECTORY_BUDGETS.tenantMinuteShare,`one tenant took ${minute} background requests in a minute across origins`);
 assert.equal(await e.call(origins[0],{tenant:'victim-org',priority:'background',allowance:30}),true);
 assert.equal(await e.call(origins[0],{tenant:'person',priority:'interactive'}),true);
 let total=minute;for(let m=1;m<200;m++){e.advance(60000);for(const o of origins)for(let i=0;i<150;i++)if(await e.call(o,{tenant:'evil-org',priority:'background',allowance:100000})===true)total++;}
 assert.ok(total<=NODE_DIRECTORY_BUDGETS.perDay/2/NODE_DIRECTORY_BUDGETS.tenantDayShare,`one tenant took ${total} requests in a day`);
 e.advance(60000);assert.equal(await e.call(origins[0],{tenant:'victim-org',priority:'background',allowance:30}),true,'another organization still refreshes');
});
test('F1: background traffic together is capped at half of every window, so interactive keeps a guaranteed half',async()=>{
 const e=egress();let background=0;
 for(let t=0;t<40;t++)for(let i=0;i<100;i++)if(await e.call(origins[i%4],{tenant:'org-'+t,priority:'background',allowance:100000})===true)background++;
 assert.ok(background<=NODE_DIRECTORY_BUDGETS.perMinute/2,`${background} background requests in one minute`);
 let interactive=0;for(let t=0;t<40;t++)for(let i=0;i<10;i++)if(await e.call(origins[i%4],{tenant:'person-'+t,priority:'interactive'})===true)interactive++;
 assert.ok(interactive>=NODE_DIRECTORY_BUDGETS.perMinute/2-1,`interactive got only ${interactive} after background saturated`);
});

const issuer='https://home.example',subject=()=>crypto.randomUUID();
const manifest={version:'0',issuer,authorization_request_endpoint:issuer+'/r',authorization_endpoint:issuer+'/a',token_endpoint:issuer+'/t',rpc_endpoint:issuer+'/rpc',jwks_uri:issuer+'/jwks',preferences_contract:'https://contracts.example/p',login_presentation:['redirect'],dpop_signing_alg_values_supported:['ES256'],extensions:[{spec:'https://spec.bindle.example/extensions/directory/v1',options:{directory_url:issuer+'/directory'}}]};
const store=()=>{const rows=new Map();return {transaction:async fn=>fn({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));}})};};
async function documentFor(sub,padding){const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',p.publicKey);
 return {v:1,iss:issuer,sub,kind:'person',...padding?{features:{pad:'x'.repeat(padding)}}:{},keys:[{kid:'k1',use:'sig',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x,y},state:'active'}]};}
function directoryWith(limits,docs,limiter){
 const fetch=async url=>{const u=new URL(url);if(u.pathname.endsWith('manifest.json'))return Response.json(manifest,{headers:{'Cache-Control':'max-age=3600'}});
  if(u.pathname==='/directory'){const sub=u.searchParams.get('sub');return Response.json({iss:issuer,sub,identity:`${issuer}/identity/${sub}`},{headers:{'Cache-Control':'max-age=300'}});}
  const sub=u.pathname.split('/')[2];return Response.json(docs.get(sub),{headers:{'Cache-Control':'max-age=300'}});};
 return new IdentityDirectory({store:store(),fetch,enabled:true,issuers:[issuer],limits,...limiter?{limiter}:{}});
}
test('F5: the document cache is bounded by bytes, not only by entry count',async()=>{
 const docs=new Map(),subs=[];for(let i=0;i<20;i++){const s=subject();subs.push(s);docs.set(s,await documentFor(s,20000));}
 const d=directoryWith({cacheBytes:100000,perSite:{windowMs:60000,limit:1000},global:{windowMs:60000,limit:1000}},docs);
 for(const s of subs)await d.refresh({issuer,subject:s});
 const bytes=[...d.cache.values()].reduce((n,e)=>n+(e.bytes??new TextEncoder().encode(JSON.stringify(e.document??null)).length),0);
 assert.ok(bytes<=100000,`${bytes} cached document bytes against a 100,000-byte budget (${d.cache.size} entries)`);
 assert.ok(d.peek({issuer,subject:subs.at(-1)}),'the newest document is cached');
 assert.ok(DIRECTORY_LIMITS.cacheBytes>0);
});
test('a claimed refresh refused by the claimed limiter spends no global token',async()=>{
 const spent=[];const windows=new Map();
 const limiter={async consume(name,{limit}){const n=windows.get(name)??0;if(n>=limit)return false;windows.set(name,n+1);spent.push(name);return true;}};
 const docs=new Map(),subs=[];for(let i=0;i<12;i++){const s=subject();subs.push(s);docs.set(s,await documentFor(s));}
 const d=directoryWith({perSite:{windowMs:60000,limit:9},global:{windowMs:60000,limit:1000}},docs,limiter);
 for(const s of subs)await d.refresh({issuer,subject:s,priority:'claimed'}).catch(()=>{});
 const claimed=spent.filter(n=>n.startsWith('directory/claimed/')).length,global=spent.filter(n=>n==='directory/global').length;
 assert.equal(claimed,3,'claimed refreshes use a third of the per-site budget');
 assert.ok(global<=claimed,`${global} global tokens for ${claimed} admitted claimed requests`);
});
