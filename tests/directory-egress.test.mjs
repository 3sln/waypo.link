import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNodeDirectoryFetch} from '../packages/federation/node-directory-fetch.mjs';
const origin='https://home.example';
function port({records=[{address:'8.8.8.8',family:4}],status=200,chunks=['{}'],headers={'content-type':'application/json'},stall=false}={}){
 const calls=[];let lookups=0;const fetch=createNodeDirectoryFetch({allowedOrigins:[origin],timeoutMs:25,maxBytes:1024,lookup:async()=>{lookups++;return typeof records==='function'?records(lookups):records;},request:(options,callback)=>{
  calls.push(options);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{if(stall)return;const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.destroy=()=>{};callback(res);for(const chunk of chunks)res.emit('data',Buffer.from(chunk));res.emit('end');});return req;
 }});return {fetch,calls};
}
test('Node directory egress pins screened address and preserves query and TLS hostname without credentials',async()=>{
 const f=port();await f.fetch(origin+'/directory?sub=opaque',{headers:{Accept:'application/json',Cookie:'secret',Authorization:'secret'}});const dial=f.calls[0];assert.equal(dial.path,'/directory?sub=opaque');assert.equal(dial.servername,'home.example');assert.equal(dial.rejectUnauthorized,true);assert.equal(dial.agent,false);assert.equal(dial.headers.Cookie,undefined);assert.equal(dial.headers.Authorization,undefined);
 await new Promise(resolve=>dial.lookup('home.example',{},(e,address,family)=>{assert.equal(e,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);resolve();}));
});
test('Node directory refuses every private/mixed DNS set and revalidates on every request',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1']){const f=port({records:[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}]});await assert.rejects(f.fetch(origin+'/directory'));assert.equal(f.calls.length,0);}
 const f=port({records:n=>[{address:n===1?'8.8.8.8':'127.0.0.1',family:4}]});await f.fetch(origin+'/directory');await assert.rejects(f.fetch(origin+'/directory'));assert.equal(f.calls.length,1);
});
test('Node directory never follows redirects and refuses oversized, compressed and slow responses',async()=>{
 for(const options of [{status:308,headers:{location:'https://127.0.0.1/private'}},{status:302},{chunks:['x'.repeat(1025)]},{headers:{'content-encoding':'gzip'}},{headers:{'content-length':'1025'}},{stall:true}]){const f=port(options);await assert.rejects(f.fetch(origin+'/directory'));assert.equal(f.calls.length,1);}
});
