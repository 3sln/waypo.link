import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {EXT,extensionOptions} from '../packages/core/extensions.mjs';
const entry=(manifest,spec)=>manifest.extensions?.find(e=>e.spec===spec)?.options;
const origin='https://provider.example',sub='44444444-4444-4444-8444-444444444444',handle='directory_person';
async function fixture(t,flags={}){
 const directory=await mkdtemp(join(tmpdir(),'directory-node-')),app=await createNodeServer({directory,config:{APP_ORIGIN:origin,DIRECTORY_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_CLIENTS:JSON.stringify([{id:'directory-client',name:'Directory fixture',origin:'https://client.example',redirectUris:['https://client.example/callback']}]),...flags}});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 assert(await app.resources.repository.create({id:sub,handle,kind:'person',status:'active',revision:0}));const account=app.resources.accounts.get(sub);await account.warm(sub);
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey),kid='public-key';
 await account.metadata.put('signing-key',{owner:sub,kid});await account.metadata.put('contact-key/'+sub+'/'+kid+'/',{owner:sub,kid,alg:'ES256',publicJwk:jwk,state:'active',active:true});
 return {app,account,fetch:(path,method='GET')=>app.fetch(new Request(origin+path,{method,headers:{Cookie:'ignored',Origin:'https://client.example'}}))};
}
test('Node publisher mounts directory and documents without memberships, and gates advertisements',async t=>{
 const f=await fixture(t),lookup=await f.fetch('/bindle/directory?handle='+handle+'%40provider.example');assert.equal(lookup.status,200,await lookup.clone().text());assert.deepEqual(await lookup.json(),{iss:origin,sub,identity:origin+'/identity/'+sub});
 const document=await f.fetch('/identity/'+sub+'/identity.json');assert.equal(document.status,200);const d=await document.json();assert.deepEqual(Object.keys(d).sort(),['handle','iss','keys','kind','sub','v']);assert.equal(d.keys[0].jwk.d,undefined);assert.equal(document.headers.get('Vary'),null);assert.equal(document.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(document.headers.get('Access-Control-Allow-Credentials'),null);
 const manifest=await f.fetch('/.well-known/bindle/manifest.json');assert.equal(manifest.status,200,await manifest.clone().text());const m=await manifest.json();assert.equal(m.features,undefined);assert.deepEqual(extensionOptions(m,EXT.directory),{directory_url:origin+'/bindle/directory'});assert.equal(entry(m,EXT.portability),undefined);
 const head=await f.fetch('/identity/'+sub+'/identity.json','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 const options=await f.fetch('/bindle/directory','OPTIONS');assert.equal(options.status,204);
});
test('Node lookup and document uniformly conceal inactive identities and the committed account fence',async t=>{
 const f=await fixture(t),missing=await f.fetch('/bindle/directory?sub=55555555-5555-4555-8555-555555555555'),body=await missing.text();assert.equal(missing.status,404);
 await f.account.metadata.put(FENCE_KEY,{owner:sub});
 for(const path of ['/bindle/directory?sub='+sub,'/identity/'+sub+'/identity.json']){const r=await f.fetch(path);assert.equal(r.status,404);assert.equal(await r.text(),body);assert.equal(r.headers.get('Cache-Control'),'no-store');}
 await f.account.metadata.delete(FENCE_KEY);
 for(const status of ['suspended','deleting','deleted','moved']){const current=await f.app.resources.repository.get(sub);assert(await f.app.resources.repository.compareAndSwap(sub,current.revision,{...current,status,revision:current.revision+1}));for(const path of ['/bindle/directory?sub='+sub,'/identity/'+sub+'/identity.json']){const r=await f.fetch(path);assert.equal(r.status,404);assert.equal(await r.text(),body);}}
});
test('Node directory remains default off even with active account data',async t=>{
 const f=await fixture(t,{DIRECTORY_ENABLED:undefined});assert.equal((await f.fetch('/bindle/directory?sub='+sub)).status,404);assert.equal((await f.fetch('/identity/'+sub+'/identity.json')).status,404);assert.equal(entry(await (await f.fetch('/.well-known/bindle/manifest.json')).json(),EXT.directory),undefined);
});
test('directory advertises attested portability only with its mounted source and valid keys; moved lookup uses PORT-3',async t=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.privateKey),f=await fixture(t,{IDENTITY_TRANSFER_OUT_ENABLED:'true',IDENTITY_ATTESTATION_KEY:JSON.stringify({kid:'attestation',jwk})});
 const m=await (await f.fetch('/.well-known/bindle/manifest.json')).json();assert.deepEqual(extensionOptions(m,EXT.portability),{move_endpoint:origin+'/bindle/portability/move',attestation_jwks_uri:origin+'/bindle/portability/attestation-keys'});
 const current=await f.app.resources.repository.get(sub),now=Date.now(),moved={to:{iss:'https://destination.example',identity:'https://destination.example/identity/'+sub},redirectBase:'https://destination.example/.moved/provider/',statement:'opaque-statement',attestation:'opaque-attestation',committedAt:now,redirectUntil:now+86400000};
 assert(await f.app.resources.repository.compareAndSwap(sub,current.revision,{...current,status:'moved',moved,revision:current.revision+1}));
 const path='/bindle/directory?sub='+sub,r=await f.fetch(path);assert.equal(r.status,308);assert.equal(r.headers.get('Location'),moved.redirectBase+path.slice(1));assert.deepEqual((await r.json()).moved,{statement:moved.statement,attestation:moved.attestation});assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
 const doc=await f.fetch('/identity/'+sub+'/identity.json');assert.equal(doc.status,308);assert.equal((await doc.json()).sub,sub);
});
