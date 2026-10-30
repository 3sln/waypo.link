import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {publicArtifacts,publicContracts,publicFragments,artifactIdentifier} from '../packages/core/public-contracts.mjs';
import application from '../packages/runtime/http.mjs';
const origin='https://bindle.example';
async function build(t){const out=await mkdtemp(join(tmpdir(),'bindle-contract-registry-'));t.after(()=>rm(out,{recursive:true,force:true}));await mkdir(join(out,'artefacts/contracts/obsolete'),{recursive:true});await writeFile(join(out,'artefacts/contracts/obsolete/v1.json'),'{}');const result=spawnSync(process.execPath,['scripts/build-docs.mjs'],{env:{...process.env,PUBLIC_DOCS_OUTPUT:out},encoding:'utf8'});assert.equal(result.status,0,result.stderr);return out;}
function host(out){const calls=[];const env={APP_ORIGIN:origin,ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;calls.push(path);try{return new Response(await readFile(join(out,path)),{headers:{'Content-Type':path.endsWith('.html')?'text/html':'application/json'}});}catch{return new Response('missing',{status:404});}}},IDENTITY_ENGINE:()=>{throw Error('Public contract must not instantiate identity');}};return {calls,env,request:(path,options={})=>application.fetch(new Request(origin+path,options),env)};}

test('registry publishes exact existing JSON definitions of resource contracts and preference fragments',async t=>{
 const out=await build(t),index=JSON.parse(await readFile(join(out,'artefacts/contracts/index.json'),'utf8')),html=await readFile(join(out,'artefacts/contracts/index.html'),'utf8');
 assert.equal(index.contracts.length,6);assert.deepEqual(Object.keys(index).sort(),['contracts','description','fragments','version']);assert.deepEqual(index.fragments.map(entry=>entry.id),['https://3sln.me/artefacts/preferences/app-messages/v1']);
 assert.equal(publicContracts.length,6);assert(!publicContracts.some(entry=>entry.id.endsWith('/preferences/v1')),'preferences/v1 was dropped');assert.equal(publicFragments.length,1);assert(publicArtifacts.every(artifact=>artifact.status==='draft'));
 for(const artifact of publicArtifacts){const original=await readFile(artifact.source,'utf8'),emitted=await readFile(join(out,artifact.path),'utf8');assert.equal(emitted,original);assert.equal(artifactIdentifier(artifact,JSON.parse(emitted)),artifact.id);if(artifact.kind!=='preferences-fragment')assert(JSON.parse(emitted).$schema);assert(html.includes('href="'+artifact.path+'"'));assert(index.contracts.concat(index.fragments).some(entry=>entry.schema===artifact.path&&entry.id===artifact.id));}
 await assert.rejects(access(join(out,'artefacts/contracts/obsolete/v1.json')));await assert.rejects(access(join(out,'artefacts/contracts/conversation/v2.json')));await assert.rejects(access(join(out,'artefacts/automation-v1.json')));
 assert.match(await readFile(join(out,'docs/index.html'),'utf8'),/href="\/artefacts\/contracts\/">Contract registry/);
 // Pre-release artefacts are rewritten in place, not kept as withdrawn-but-resolvable (owner direction 2026-10-28): the
 // conversation v1 schema, the 3sln.me item-classifier fragment and slot, and the components profile are not published.
 await assert.rejects(access(join(out,'docs/spec/conversations.html')));
 for(const path of ['artefacts/conversation-v1-body.json','artefacts/fragments/item-classifier/v1.json','artefacts/slots/item-classifier/v1.json','artefacts/profiles/components/v1.json'])await assert.rejects(access(join(out,path)),path);
 const agent=await readFile(join(out,'llms.txt'),'utf8');for(const artifact of publicArtifacts)assert(agent.includes(artifact.path));
});

test('canonical IDs, explicit JSON and legacy source aliases return identical machine JSON even to browsers',async t=>{
 const out=await build(t),h=host(out);
 for(const artifact of publicArtifacts)for(const path of new Set([new URL(artifact.id).pathname,artifact.path,'/'+artifact.source,`/artefacts/${artifact.name}-${artifact.version}.json`]))for(const accept of ['text/html','application/schema+json','*/*']){
  const response=await h.request(path,{headers:{Accept:accept,Cookie:'private=irrelevant'}});assert.equal(response.status,200,path);assert.equal(response.headers.get('Content-Type'),artifact.kind==='preferences-fragment'?'application/json':'application/schema+json');assert.equal(await response.text(),await readFile(artifact.source,'utf8'));assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Content-Location'),artifact.path);assert.match(response.headers.get('Cache-Control'),/^public/);assert.equal(response.headers.get('Set-Cookie'),null);
 }
 for(const artifact of publicArtifacts){const head=await h.request(artifact.path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');const before=h.calls.length;assert.equal((await h.request(artifact.path,{method:'OPTIONS'})).status,204);assert.equal(h.calls.length,before);assert.equal((await h.request(artifact.path,{method:'POST'})).status,405);}
});

test('directory links all resolve to JSON and missing/proposed contracts stay errors',async t=>{
 const out=await build(t),h=host(out);assert.equal((await h.request('/artefacts/contracts')).headers.get('Location'),'/artefacts/contracts/');
 const page=await h.request('/artefacts/contracts/');assert.equal(page.status,200);assert.match(page.headers.get('Content-Type'),/text\/html/);const html=await page.text();
 const targets=[...html.matchAll(/href="([^"#]+\.json)"/g)].map(match=>match[1]);assert.equal(targets.length,8,'the registry JSON, six contracts and one fragment');
 for(const target of targets){const response=await h.request(target,{headers:{Accept:'text/html'}});assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/json/);await response.json();}
 for(const path of ['/artefacts/contracts/conversation/v2','/artefacts/contracts/made-up/v1.json','/docs/artefacts/automation-v1.json','/artefacts/conversation-v1.json','/artefacts/conversation-v1-body.json','/artefacts/fragments/item-classifier/v1','/artefacts/slots/item-classifier/v1','/artefacts/profiles/components/v1','/artefacts/contracts/preferences/v1','/artefacts/contracts/preferences/v1.json','/artefacts/preferences-v1.json'])assert.equal((await h.request(path)).status,404);
 h.env.ASSETS.fetch=async()=>new Response(null,{status:304,headers:{ETag:'"schema"'}});const unchanged=await h.request(publicContracts[0].path,{headers:{'If-None-Match':'"schema"'}});assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');assert.equal(unchanged.headers.get('ETag'),'"schema"');
 h.env.ASSETS.fetch=async()=>new Response('missing',{status:404});assert.equal((await h.request(publicContracts[0].path)).status,404);
});

test('locked publication emits transition envelopes and immutable records without flipping canonical bodies',async t=>{
 const {artefactPublication,assembleArtefacts}=await import('../packages/core/public-contracts.mjs'),core=await import('../packages/core/artefacts.mjs'),{strictJSON}=await import('../packages/core/strict-json.mjs'),lock=strictJSON(await readFile('docs/artefacts/artefacts.lock.json')),out=await build(t),options={read:path=>readFile(path),core:{...core,strictJSON}};
 const registry=JSON.parse(await readFile(join(out,'artefacts/contracts/index.json'),'utf8'));
 for(const artifact of publicArtifacts){const published=Object.values(registry).filter(Array.isArray).flat().find(entry=>entry.id===artifact.id);assert.equal(published.envelope,artifact.id+'/envelope');assert.deepEqual(published.artefact_versions,[{version:1,digest:lock.find(line=>line.id===artifact.id).versions[0],record:artifact.id+'/versions/1'}]);const paths=artefactPublication(artifact),envelope=strictJSON(await readFile(join(out,paths.envelope))),verified=await core.verifyChain(envelope);assert.equal(verified.id,artifact.id);assert.equal(verified.digest,lock.find(line=>line.id===artifact.id).versions[0]);assert.deepEqual(verified.body,JSON.parse(await readFile(artifact.source,'utf8')));assert.deepEqual(core.parseVersionRecord(await readFile(join(out,paths.record(1)))),verified.record);assert.deepEqual(JSON.parse(await readFile(join(out,paths.body(1)),'utf8')),verified.body);assert.equal(await (await host(out).request(new URL(artifact.id).pathname)).text(),await readFile(artifact.source,'utf8'));}
 await assert.rejects(assembleArtefacts(lock.slice(1),options));const changed=structuredClone(lock);changed[0].versions[0]='sha256-'+'A'.repeat(43);await assert.rejects(assembleArtefacts(changed,options),/history differs/);
 await assert.rejects(assembleArtefacts(lock,{...options,read:async path=>path===publicArtifacts[0].source?' {"$id":"duplicate","$id":"again"}':readFile(path)}));
 const addition=structuredClone(lock);addition[0].versions.push('sha256-'+'A'.repeat(43));await assert.rejects(assembleArtefacts(addition,options));
});
