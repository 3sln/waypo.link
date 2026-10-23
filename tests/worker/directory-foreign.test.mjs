// ORG-7/ORG-4 integration in workerd: the foreign-issuer directory built by the account object's construction path
// (apps/worker/objects.mjs injects workerDirectoryEgress(); packages/runtime/account/foreign-directory.mjs gates it)
// over the real strictly-public fetch. Every outbound request is observed by outboundService.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';

const issuer='https://home.example',org='55555555-5555-4555-8555-555555555555',subject='66666666-6666-4666-8666-666666666666';
const ON={APP_ORIGIN:'https://provider.example',DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',ORG_FOREIGN_MEMBERS_ENABLED:'true',ORG_FOREIGN_ISSUERS:JSON.stringify([issuer])};
const source=`import {workerDirectoryEgress} from './apps/worker/directory-fetch.mjs';import {foreignDirectory} from './packages/runtime/account/foreign-directory.mjs';
export default {async fetch(request,env){const rows=new Map(),store={transaction:fn=>fn({get:async k=>rows.get(k),put:async(k,v)=>rows.set(k,v)})};
 const config={...env,DIRECTORY_EGRESS:workerDirectoryEgress()},directory=foreignDirectory(config,{store,owner:${JSON.stringify(org)}});if(!directory)return Response.json({directory:null});
 const target=new URL(request.url).searchParams.get('issuer');try{await directory.refresh({issuer:target,subject:${JSON.stringify(subject)}});return Response.json({ok:true});}catch(error){return Response.json({error:error.code??'refused',issuers:[...directory.issuers]});}}};`;

async function worker(t,bindings){
 const dir=await mkdtemp(join(tmpdir(),'directory-foreign-worker-')),out=join(dir,'worker.mjs');t.after(()=>rm(dir,{recursive:true,force:true}));
 await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['node:*'],outfile:out,logLevel:'silent'});
 const net={answer:'8.8.8.8',dns:[],dials:[]};
 const mf=new Miniflare(convertV4MiniflareOptions({name:'directory-foreign-audit',modulesRoot:dir,modules:[{type:'ESModule',path:out}],bindings,compatibilityDate:'2026-10-11',compatibilityFlags:['global_fetch_strictly_public','nodejs_compat'],log:new Log(LogLevel.ERROR),outboundService:async request=>{
  const u=new URL(request.url);
  if(u.origin==='https://cloudflare-dns.com'){const type=Number(u.searchParams.get('type'));net.dns.push(u.searchParams.get('name'));const v6=net.answer.includes(':');return Response.json({Status:0,Question:[{name:u.searchParams.get('name')+'.',type}],Answer:type===(v6?28:1)?[{type,data:net.answer}]:[]},{headers:{'Content-Type':'application/dns-json'}});}
  net.dials.push(request.url);return new Response('missing',{status:404});
 }}));t.after(()=>mf.dispose());
 return {net,refresh:async target=>(await mf.dispatchFetch('https://provider.example/check?issuer='+encodeURIComponent(target))).json()};
}

test('the Worker runtime constructs the foreign directory only behind both flags, with an empty default allowlist',async t=>{
 for(const off of ['DIRECTORY_ENABLED','ORG_FOREIGN_MEMBERS_ENABLED']){const {[off]:_,...bindings}=ON;const w=await worker(t,bindings);assert.deepEqual(await w.refresh(issuer),{directory:null},off);}
 const {ORG_FOREIGN_ISSUERS:_,...bindings}=ON,w=await worker(t,bindings);assert.deepEqual(await w.refresh(issuer),{error:'issuer_refused',issuers:[]});
 assert.deepEqual([w.net.dns.length,w.net.dials.length],[0,0]);
});

test('the Worker runtime directory refuses private, loopback and metadata answers and non-allowlisted issuers without dialing',async t=>{
 const w=await worker(t,ON);
 // Control: a public answer is dialed, so the refusals below are meaningful.
 assert.deepEqual(await w.refresh(issuer),{error:'invalid_manifest',issuers:[issuer]});assert.deepEqual(w.net.dials,[issuer+'/.well-known/bindle/manifest.json']);
 for(const answer of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.200','172.16.0.1','192.168.0.1','0.0.0.0','::1','::ffff:127.0.0.1','64:ff9b::a9fe:a9fe','fd00::1']){
  w.net.answer=answer;w.net.dns.length=0;w.net.dials.length=0;const result=await w.refresh(issuer);
  assert.notEqual(result.ok,true,answer);assert.ok(w.net.dns.length>0,answer);assert.equal(w.net.dials.length,0,answer);
 }
 w.net.answer='8.8.8.8';w.net.dns.length=0;
 for(const other of ['https://other.example','https://127.0.0.1','https://169.254.169.254','https://[::1]','https://[::ffff:127.0.0.1]','https://[64:ff9b::a9fe:a9fe]','http://home.example'])assert.equal((await w.refresh(other)).error,'issuer_refused',other);
 assert.deepEqual([w.net.dns.length,w.net.dials.length],[0,0]);
 const bad=await worker(t,{...ON,ORG_FOREIGN_ISSUERS:JSON.stringify([issuer,'https://169.254.169.254'])});assert.deepEqual(await bad.refresh(issuer),{error:'issuer_refused',issuers:[]});assert.deepEqual([bad.net.dns.length,bad.net.dials.length],[0,0]);
});
