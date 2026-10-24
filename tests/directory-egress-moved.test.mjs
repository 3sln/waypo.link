// Wargame 2026-10-23 F3: the Node directory egress must carry a spec-valid moved identity document (identity
// portability §7, at most MAX_MOVES_DOCUMENT_BYTES); its default and ceiling come from identity/document-budget.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNodeDirectoryFetch} from '../packages/federation/node-directory-fetch.mjs';
import {MAX_MOVES,MAX_STATEMENT_BYTES,MAX_ATTESTATION_BYTES,MAX_MOVES_DOCUMENT_BYTES} from '../packages/identity/document-budget.mjs';
import {fixture,issuer,subject,manifest,identity} from './directory-helpers.mjs';
import {validateDirectoryDocument} from '../packages/federation/directory.mjs';

test('Node directory egress carries a moved identity document above 128 KiB within MAX_MOVES_DOCUMENT_BYTES',async t=>{
 const base=(await fixture()).state.document;
 const moves=Array.from({length:MAX_MOVES},()=>({statement:'s'.repeat(MAX_STATEMENT_BYTES),attestation:'a'.repeat(MAX_ATTESTATION_BYTES)}));
 const skeleton={...base,features:{pad:''},moves},doc={...skeleton,features:{pad:'p'.repeat(140000-Buffer.byteLength(JSON.stringify(skeleton)))}};
 const body=JSON.stringify(doc);assert.ok(body.length>131072&&body.length<=MAX_MOVES_DOCUMENT_BYTES,String(body.length));
 assert.ok(await validateDirectoryDocument(doc,{issuer,subject}));
 const respond=url=>url.endsWith('manifest.json')?JSON.stringify(manifest):url.includes('?sub=')?JSON.stringify({iss:issuer,sub:subject,identity}):body;
 const egress=createNodeDirectoryFetch({allowedOrigins:[issuer],lookup:async()=>[{address:'8.8.8.8',family:4}],request:(options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json','cache-control':'max-age=300'};res.destroy=()=>{};callback(res);
   const text=respond('https://'+options.hostname+options.path);for(let i=0;i<text.length;i+=16384)res.emit('data',Buffer.from(text.slice(i,i+16384)));res.emit('end');});return req;}});
 const f=await fixture({fetch:(url,init)=>egress(url,init)});t.after(()=>f.engine.dispose());
 const refreshed=await f.refresh();assert.equal(refreshed.moves.length,MAX_MOVES);
});
test('the Node egress body limit accepts exactly the protocol budget and refuses more',()=>{
 assert.doesNotThrow(()=>createNodeDirectoryFetch({allowedOrigins:[issuer],maxBytes:MAX_MOVES_DOCUMENT_BYTES}));
 assert.throws(()=>createNodeDirectoryFetch({allowedOrigins:[issuer],maxBytes:MAX_MOVES_DOCUMENT_BYTES+1}));
});
