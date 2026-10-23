// ORG-7/ORG-4 integration: the foreign-issuer directory as the Node adapter constructs it (createNodeServer's account
// controller config, DIRECTORY_EGRESS -> createNodeDirectoryFetch), gated by DIRECTORY_ENABLED and
// ORG_FOREIGN_MEMBERS_ENABLED, with an empty allowlist by default. Only DNS and the socket are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {foreignDirectory} from '../packages/runtime/account/foreign-directory.mjs';
import {directoryIssuerKeys} from '../packages/orgs/certificates.mjs';
const issuer='https://home.example',org='55555555-5555-4555-8555-555555555555',subject='66666666-6666-4666-8666-666666666666';
const ON={APP_ORIGIN:'https://provider.example',DIRECTORY_ENABLED:'true',ORGANIZATIONS_ENABLED:'true',ORG_FOREIGN_MEMBERS_ENABLED:'true',ORG_FOREIGN_ISSUERS:JSON.stringify([issuer])};
async function fixture(t,config){
 const net={answer:[{address:'8.8.8.8',family:4}],lookups:[],dials:[]},directory=await mkdtemp(join(tmpdir(),'directory-foreign-'));
 const app=await createNodeServer({directory,config:{...config,DIRECTORY_DNS_LOOKUP:async host=>{net.lookups.push(host);return net.answer;},DIRECTORY_HTTPS_REQUEST:(options,callback)=>{
  net.dials.push(options);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=404;res.headers={};res.destroy=()=>{};callback(res);res.emit('end');});return req;}}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const account=app.resources.accounts.get(org);return {net,account,directory:()=>foreignDirectory(account.config,{store:account.metadata,owner:org})};
}

test('the Node runtime constructs the foreign directory only behind DIRECTORY_ENABLED and ORG_FOREIGN_MEMBERS_ENABLED',async t=>{
 for(const off of ['DIRECTORY_ENABLED','ORG_FOREIGN_MEMBERS_ENABLED','ORGANIZATIONS_ENABLED']){const f=await fixture(t,{...ON,[off]:undefined});assert.equal(typeof f.account.config.DIRECTORY_EGRESS,'function');assert.equal(f.directory(),null,off);}
 const f=await fixture(t,{...ON,ORG_FOREIGN_ISSUERS:undefined}),d=f.directory();assert.ok(d);assert.equal(d.issuers.size,0,'the allowlist is empty by default');
 await assert.rejects(d.refresh({issuer,subject}),{code:'issuer_refused'});assert.equal(await directoryIssuerKeys(d).resolve({issuer,subject,kid:'k'}),null);
 assert.deepEqual([f.net.lookups.length,f.net.dials.length],[0,0]);
});

test('the Node runtime directory refuses private, loopback and metadata answers and non-allowlisted issuers without dialing',async t=>{
 const f=await fixture(t,ON),d=f.directory();
 // Control: a public answer is dialed (the stub's 404 manifest is then refused), so the refusals below are meaningful.
 await assert.rejects(d.refresh({issuer,subject}),{code:'invalid_manifest'});assert.equal(f.net.dials.length,1);assert.equal(f.net.dials[0].servername,'home.example');
 const fresh=f.directory();f.net.dials.length=0;
 for(const answer of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.200','172.16.0.1','192.168.0.1','0.0.0.0','::1','::ffff:127.0.0.1','64:ff9b::a9fe:a9fe','fd00::1']){
  f.net.answer=[{address:'8.8.8.8',family:4},{address:answer,family:answer.includes(':')?6:4}];f.net.lookups.length=0;
  await assert.rejects(fresh.refresh({issuer,subject}),answer);assert.equal(f.net.lookups.length,1,answer);assert.equal(f.net.dials.length,0,answer);
 }
 f.net.answer=[{address:'8.8.8.8',family:4}];f.net.lookups.length=0;
 for(const other of ['https://other.example','https://127.0.0.1','https://169.254.169.254','https://[::1]','https://[::ffff:127.0.0.1]','https://[64:ff9b::a9fe:a9fe]','http://home.example'])await assert.rejects(fresh.refresh({issuer:other,subject}),{code:'issuer_refused'},other);
 assert.deepEqual([f.net.lookups.length,f.net.dials.length],[0,0]);
});

test('an allowlist naming an address literal or a non-https origin is refused as a whole',async t=>{
 for(const bad of ['https://127.0.0.1','https://10.0.0.1','https://169.254.169.254','https://[::1]','https://[64:ff9b::a9fe:a9fe]','http://home.example','https://home.example:8443','https://localhost']){
  const f=await fixture(t,{...ON,ORG_FOREIGN_ISSUERS:JSON.stringify([issuer,bad])}),d=f.directory();assert.equal(d.issuers.size,0,bad);
  await assert.rejects(d.refresh({issuer,subject}),{code:'issuer_refused'});assert.deepEqual([f.net.lookups.length,f.net.dials.length],[0,0],bad);
 }
});
