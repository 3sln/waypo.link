import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {targetSurfaces,credentialSurfaces,cases,credentialCases,requestFor,snapshot} from '../helpers/public-unknown.mjs';
test('U404 workerd: target boundaries conceal target lifecycle; credential boundaries refuse lifecycle-faulted credentials as invalid',{timeout:60000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'u404-'));t.after(()=>rm(directory,{recursive:true,force:true}));const outfile=join(directory,'worker.mjs');
 await build({stdin:{contents:`import {fixture} from './tests/helpers/public-unknown.mjs';export default {fetch:request=>fixture(request.headers.get('X-Fixture-Case')).fetch(request)};`,resolveDir:process.cwd()},outfile,bundle:true,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','node:*'],logLevel:'silent',banner:{js:"import {createRequire} from 'node:module';const require=createRequire('file:///u404/worker.mjs');"}});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'u404-boundaries',modulesRoot:directory,modules:[{type:'ESModule',path:outfile}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR)}));t.after(()=>mf.dispose());
 for(const [surface,names,statuses] of [...targetSurfaces.map(s=>[s,cases,[404]]),...credentialSurfaces.map(s=>[s,credentialCases,[400,401]])]){let expected;for(const name of names){const request=await requestFor(surface,name);request.headers.set('X-Fixture-Case',name);const result=await snapshot(await mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...request.body?{body:await request.arrayBuffer()}:{}}));assert.ok(statuses.includes(result.status),surface.name+' '+name+' '+JSON.stringify(result));expected??=result;assert.deepEqual(result,expected,surface.name+' '+name);}}
});
