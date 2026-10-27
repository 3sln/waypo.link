// Browser bug hunt fixes (DEVLOG 2026-10-27), server side: F16 /oauth/authorize?request_id= accepts one bounded `lang`
// and nothing else extra; F18 an unknown page path answers one fixed minimal 404 document. (F1's profile revision
// guard is tested in contact-profile.test.mjs; F4's verified legacy projection in app-messages-family.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeQueryAllowed} from '../packages/federation/http.mjs';
import {stages,NOT_FOUND_PAGE} from '../packages/runtime/routes/site.mjs';

const id='0123456789abcdef0123456789abcdef0123456789a';
test('F16 /oauth/authorize?request_id= tolerates one bounded lang parameter and refuses every other extra',()=>{
 for(const query of [`request_id=${id}`,`request_id=${id}&lang=es`,`lang=en&request_id=${id}`,`request_id=${id}&lang=es-MX`])assert.equal(authorizeQueryAllowed(new URLSearchParams(query)),true,query);
 for(const query of ['',`request_id=${id}&request_id=${id}`,`request_id=${id}&lang=es&lang=en`,`request_id=${id}&lang=`,`request_id=${id}&lang=<script>`,`request_id=${id}&lang=${'a'.repeat(40)}`,`request_id=${id}&state=x`,`request_id=${id}&client_id=x`,'lang=es'])assert.equal(authorizeQueryAllowed(new URLSearchParams(query)),false,query);
});

test('F18 an unknown page path gets the same minimal not-found document; assets and non-HTML requests keep the asset answer',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('',{status:404,headers:{'Content-Type':'text/plain'}})}};
 const page=async(path,{accept='text/html,application/xhtml+xml',method='GET'}={})=>{const url=new URL('https://space.example'+path);return stages.pages({request:new Request(url,{method,headers:{Accept:accept}}),env,url,path});};
 const bodies=new Set();for(const path of ['/nope-404','/users-but-not','/docs/missing.html','/another/deep/path']){const response=await page(path);assert.equal(response.status,404,path);assert.match(response.headers.get('Content-Type'),/text\/html/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy'));bodies.add(await response.text());}
 assert.equal(bodies.size,1,'one identical body for every unknown path');assert.match([...bodies][0],/Page not found/);assert.match(NOT_FOUND_PAGE,/<meta name="robots" content="noindex">/);
 assert.equal(await (await page('/assets/scripts/missing.0123456789.js')).text(),'','immutable asset misses are untouched');
 assert.equal(await (await page('/nope.json',{accept:'application/json'})).text(),'','non-navigation requests are untouched');
 assert.equal((await page('/nope',{method:'HEAD'})).status,404);
 // Review I-1: both unknown-path variants vary on Accept so a shared cache never serves one for the other.
 assert.match((await page('/nope')).headers.get('Vary')||'',/Accept/);assert.match((await page('/nope.json',{accept:'*/*'})).headers.get('Vary')||'',/Accept/);
});
