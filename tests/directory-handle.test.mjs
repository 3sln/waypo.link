// Wargame 2026-10-23 F2 and review follow-up: a foreign provider vouches only for handles on its own host.
// validateDirectoryDocument drops a handle with invalid grammar or another host (the keys stay usable), and the ORG-6a
// consent screen shows a directory handle only qualified as local@<issuer host>, never bare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDirectoryDocument,directoryHandle} from '../packages/federation/directory.mjs';
import {methods} from '../packages/runtime/account/member-certificates.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const evil='https://evil.example',org='77777777-7777-4777-8777-777777777777',person='88888888-8888-4888-8888-888888888888';
const keypair=async()=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {x,y}=await crypto.subtle.exportKey('jwk',p.publicKey);return {kty:'EC',crv:'P-256',x,y};};
const document=async handle=>({v:1,iss:evil,sub:org,kind:'organization',...handle===undefined?{}:{handle},keys:[{kid:'k1',use:'sig',alg:'ES256',jwk:await keypair(),state:'active',predecessor:null,continuity:null}]});
async function evilFetch(handle){
 const manifest={version:'0',issuer:evil,authorization_request_endpoint:evil+'/r',authorization_endpoint:evil+'/a',token_endpoint:evil+'/t',rpc_endpoint:evil+'/rpc',jwks_uri:evil+'/jwks',preferences_contract:'https://contracts.example/p',login_presentation:['redirect'],dpop_signing_alg_values_supported:['ES256'],extensions:[{spec:'https://spec.bindle.example/extensions/directory/v1',options:{directory_url:evil+'/directory'}}]};
 const doc=await document(handle);
 return async url=>Response.json(url.endsWith('manifest.json')?manifest:url.includes('?sub=')?{iss:evil,sub:org,identity:`${evil}/identity/${org}`}:doc,{headers:{'Cache-Control':'max-age=300'}});
}
test('the directory drops a handle on another host or with invalid grammar, keeping the document',async()=>{
 for(const handle of ['payroll@bigbank.example','payroll@evil.example.bigbank.example','a b','pay/roll','@evil.example','x'.repeat(65),'',7]){
  const accepted=await validateDirectoryDocument(await document(handle),{issuer:evil,subject:org});assert.equal(accepted.handle,undefined,String(handle));assert.equal(accepted.keys.length,1);}
 for(const handle of ['payroll','payroll@evil.example','Payroll@EVIL.example'])assert.equal((await validateDirectoryDocument(await document(handle),{issuer:evil,subject:org})).handle,handle);
 assert.ok(await validateDirectoryDocument(await document(undefined),{issuer:evil,subject:org}));
 assert.equal(directoryHandle('payroll@evil.example',evil),'payroll');assert.equal(directoryHandle('payroll@bigbank.example',evil),null);
});
async function describe(t,handle){
 const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());const fetch=await evilFetch(handle);
 const ctx={config:{APP_ORIGIN:'https://provider.example',DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',ORG_FOREIGN_MEMBERS_ENABLED:'true',ORG_FOREIGN_ISSUERS:JSON.stringify([evil]),DIRECTORY_EGRESS:()=>fetch},metadata};
 const first=await methods.memberCertificateOrganization.call(ctx,person,`${evil}/identity/${org}`);
 assert.equal(first.verified,false,'a cold cache answers unverified (cache-only, F1)');
 await new Promise(resolve=>setTimeout(resolve,20));
 return methods.memberCertificateOrganization.call(ctx,person,`${evil}/identity/${org}`);
}
test('the consent screen does not present another host\'s handle as verified',async t=>{
 const described=await describe(t,'payroll@bigbank.example');
 assert.ok(!/bigbank/.test(described.handle??''),JSON.stringify(described));
 assert.deepEqual(described,{name:null,handle:null,verified:true,source:'directory'},'the organization verifies; its foreign-host handle is dropped');
});
test('the issuer\'s own handle is shown verified, qualified as local@host',async t=>{
 assert.deepEqual(await describe(t,'payroll@evil.example'),{name:null,handle:'payroll@evil.example',verified:true,source:'directory'});
});
test('a bare foreign handle is never shown bare',async t=>{
 assert.deepEqual(await describe(t,'payroll'),{name:null,handle:'payroll@evil.example',verified:true,source:'directory'});
});
