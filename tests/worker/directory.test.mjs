import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {createHarness} from './harness.mjs';

test('actual Worker directory port screens every DNS answer, sends no credentials and bounds hostile responses',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'directory-worker-')),out=join(dir,'worker.mjs');t.after(()=>rm(dir,{recursive:true,force:true}));
 await build({stdin:{contents:`import {createWorkerDirectoryFetch} from './apps/worker/directory-fetch.mjs';import {IdentityDirectory} from './packages/federation/directory.mjs';export default {async fetch(request){const rows=new Map(),store={transaction:async fn=>fn({get:async k=>rows.get(k),set:async(k,v)=>rows.set(k,v)})},port=createWorkerDirectoryFetch({publicRouting:true}),directory=new IdentityDirectory({enabled:true,issuers:['https://home.example'],store,fetch:port,limits:{timeoutMs:1000}});try{const result=await directory.json('https://home.example/directory?sub=opaque',1024);return Response.json(result);}catch{return Response.json({error:'refused'},{status:502});}}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['node:*'],outfile:out,logLevel:'silent'});
 let mode='ok',dnsRound=0;const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({name:'directory-egress-audit',modulesRoot:dir,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['global_fetch_strictly_public','nodejs_compat'],log:new Log(LogLevel.ERROR),outboundService:async request=>{
  calls.push({url:request.url,headers:Object.fromEntries(request.headers),method:request.method,redirect:request.redirect});const u=new URL(request.url);
  if(u.origin==='https://cloudflare-dns.com'){
   const type=Number(u.searchParams.get('type'));if(type===1)dnsRound++;
   const privateTarget=mode==='private'||mode==='rebind'&&dnsRound>1,answer=type===1?[{type,data:privateTarget?'169.254.169.254':'8.8.8.8'}]:mode==='private-v6'?[{type,data:'::ffff:127.0.0.1'}]:[];
   return Response.json({Status:0,Question:[{name:'home.example.',type}],Answer:answer},{headers:{'Content-Type':'application/dns-json'}});
  }
  assert.equal(u.href,'https://home.example/directory?sub=opaque');
  if(mode==='redirect')return new Response(null,{status:308,headers:{Location:'https://127.0.0.1/private'}});
  if(mode==='oversize')return new Response('x'.repeat(1025),{headers:{'Content-Type':'application/json'}});
  if(mode==='slow'){await new Promise(resolve=>setTimeout(resolve,2000));return Response.json({late:true});}
  return Response.json({ok:true});
 }}));t.after(()=>mf.dispose());
 const request=()=>mf.dispatchFetch('https://provider.example/check',{headers:{Cookie:'secret',Authorization:'secret',Referer:'https://private.example/'}});
 assert.equal((await request()).status,200);assert.equal(calls.length,3);for(const c of calls){assert.equal(c.headers.cookie,undefined);assert.equal(c.headers.authorization,undefined);assert.equal(c.headers.referer,undefined);assert.equal(c.method,'GET');}
 for(const scenario of ['private','private-v6','redirect','oversize','slow']){mode=scenario;calls.length=0;assert.equal((await request()).status,502,scenario);assert.equal(calls.filter(c=>!c.url.startsWith('https://cloudflare-dns.com')).length,scenario==='private'||scenario==='private-v6'?0:1);}
 mode='rebind';dnsRound=0;assert.equal((await request()).status,200);assert.equal((await request()).status,502);
 // The rebinding test verifies per-call screening. Connection-time private routing is supplied by workerd's
 // strictly-public flag, not proven by this outboundService fixture; production egress remains gated.
});

test('actual Worker directory publisher has uniform absence and exposes public keys only',async t=>{
 const h=await createHarness({bindings:{APP_ORIGIN:'https://provider.example',DIRECTORY_ENABLED:'true',LOCAL_DEVELOPMENT:'true'}});t.after(()=>h.close());
 const sub='22222222-2222-4222-8222-222222222222',handle='directory_worker';assert(await h.directory.create({id:sub,handle,status:'active',kind:'organization',revision:0}));
 const account=h.accounts.get(h.accounts.idFromName(sub));await account.seed(sub,[]);
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey),kid='directory-key';
 await account.seed(sub,[['signing-key',{owner:sub,kid}],['contact-key/'+sub+'/'+kid+'/',{owner:sub,kid,alg:'ES256',publicJwk:jwk,state:'active',active:true,purpose:'signing'}]]);
 const probe=await account.invoke({method:'directoryDocument',args:[sub,{id:sub,kind:'organization',handle}]});assert.ok(probe?.keys,JSON.stringify(probe));
 const found=await h.request('/bindle/directory?handle='+handle+'%40provider.example');assert.equal(found.status,200,await found.clone().text());assert.deepEqual(await found.json(),{iss:h.origin,sub,identity:h.origin+'/identity/'+sub});
 const document=await h.request('/identity/'+sub+'/identity.json');assert.equal(document.status,200,await document.clone().text());assert.equal((await document.json()).kind,'organization');assert.equal(document.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(document.headers.get('Access-Control-Allow-Credentials'),null);
 const missing=await h.request('/bindle/directory?sub=33333333-3333-4333-8333-333333333333'),expected=await missing.text();
 await account.seed(sub,[['deletion/fence-v1',{owner:sub}]]);
 // Use the real deletion fence key imported by the harness consumer below in the Node test as well.
 const record=await h.directory.get(sub);await h.directory.compareAndSwap(sub,record.revision,{...record,status:'suspended',revision:record.revision+1});
 const suspended=await h.request('/bindle/directory?sub='+sub);assert.equal(suspended.status,404);assert.equal(await suspended.text(),expected);assert.equal(suspended.headers.get('Cache-Control'),'no-store');
});
