import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import application from '../../packages/runtime/http.mjs';
import {publicArtifacts} from '../../packages/core/public-contracts.mjs';
import {versionDigest,parseEnvelope} from '../../packages/core/artefacts.mjs';
test('transition HTTP serves generated envelopes and exact records, preserving canonical legacy bytes with either flag',async t=>{
 const out=await mkdtemp(join(tmpdir(),'art4-serving-'));t.after(()=>rm(out,{recursive:true,force:true}));const build=spawnSync(process.execPath,['scripts/build-docs.mjs'],{env:{...process.env,PUBLIC_DOCS_OUTPUT:out},encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const origin='https://provider.example',env={APP_ORIGIN:origin,ARTEFACT_VERSIONS_ENABLED:'false',ASSETS:{async fetch(request){try{return new Response(await readFile(join(out,new URL(request.url).pathname)),{headers:{ETag:'"generated"'}});}catch{return new Response('Missing',{status:404});}}}},request=(path,method='GET')=>application.fetch(new Request(origin+path,{method,headers:{Accept:'text/html'}}),env);
 for(const flag of ['false','true']){env.ARTEFACT_VERSIONS_ENABLED=flag;
  for(const artifact of publicArtifacts){const base=new URL(artifact.id).pathname,canonical=await request(base);assert.equal(canonical.status,200);assert.equal(await canonical.text(),await readFile(artifact.source,'utf8'));
   for(const suffix of ['/envelope','/versions/1']){
    const response=await request(base+suffix);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/json');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Content-Location'),base+suffix);assert.equal(response.headers.get('ETag'),'"generated"');const value=await response.json();
    if(suffix==='/envelope'){assert.equal(parseEnvelope(value).id,artifact.id);assert.equal(value.versions[0].version,1);assert.equal(response.headers.get('Cache-Control'),'public, max-age=300');}
    else{assert.equal(value.id,artifact.id);assert.equal(value.version,1);assert.match(await versionDigest(value),/^sha256-/);assert.match(response.headers.get('Cache-Control'),/immutable/);}
    const head=await request(base+suffix,'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal((await request(base+suffix,'OPTIONS')).status,204);const post=await request(base+suffix,'POST');assert.equal(post.status,405);assert.equal(post.headers.get('Allow'),'GET, HEAD, OPTIONS');assert.equal(post.headers.get('Cache-Control'),'no-store');
   }
   for(const suffix of ['/versions/0','/versions/01','/versions/-1','/versions/1/x','/versions/1025','/versions/2'])assert.equal((await request(base+suffix)).status,404,base+suffix);
  }
 }
});
