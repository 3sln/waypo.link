// MCP grants and app connections end with every identity authority reset (review 2026-10-23 item 3): each MCP grant is
// bound to the identity's app-grant epoch (`federationEpoch`: the recovery credential plus `federationGeneration`) and
// verify, execute, exchange and refresh compare it with the live record; the identity's `severConnections` port
// (reason 'recovery') ends connections and key delegations. Engine level over the Node runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeResources} from '../apps/node/resources.mjs';
import {digest} from '../packages/core/records.mjs';
import {federationEpoch} from '../packages/runtime/federation.mjs';
import {authorityGrantEpoch} from '../packages/runtime/grant-epoch.mjs';
import {McpAuthorization} from '../packages/mcp/service.mjs';
const origin='http://localhost:8788',client={id:'agent.example',name:'Example agent',redirectUris:['https://agent.example/callback'],origins:['https://agent.example']};
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'3sln-mcp-epoch-'));const config={APP_ORIGIN:origin,LOCAL_DEVELOPMENT:'true',MCP_ENABLED:'true',MCP_LAYOUT:'mcp-auth-v1-64',MCP_CLIENTS:JSON.stringify([client]),KEY_ENCRYPTION_KEY:Buffer.alloc(32,42).toString('base64'),WORK_LIMITS_ENABLED:'false'};const resources=await nodeResources({directory,config});const owner=crypto.randomUUID();await resources.repository.create({id:owner,assignmentId:crypto.randomUUID(),handle:'mcp_epoch',status:'active',termsVersion:'2026-10-11',recoveryHash:'hash-1',revision:1});const account=resources.accounts.get(owner);await account.mcpCollections(owner);const source=await account.addResource(owner,{name:'Agent files',provider:'hosted'});t.after(async()=>{resources.close();await rm(directory,{recursive:true,force:true});});
 const patch=async mutate=>{const record=await resources.repository.get(owner);assert.equal(await resources.repository.compareAndSwap(owner,record.revision,{...mutate(structuredClone(record)),revision:record.revision+1}),true);};
 return {owner,storage:`resource:${source.id}`,account,mcp:resources.mcp,resources,patch};}
async function authorize(f){const verifier='A'.repeat(43),challenge=await digest(crypto,verifier);const {requestId}=await f.mcp.begin({client_id:client.id,redirect_uri:client.redirectUris[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:crypto.randomUUID(),scope:'mcp:collections_list mcp:item_read',resource:`${origin}/mcp`});await f.mcp.inspect(f.owner,requestId);const grant=await f.mcp.approve(f.owner,{requestId,permissions:[{collectionId:f.storage,tools:['collections_list','item_read']}]});const code=new URL(grant.redirectUri).searchParams.get('code');return f.mcp.exchange({grant_type:'authorization_code',code,code_verifier:verifier,client_id:client.id,redirect_uri:client.redirectUris[0],resource:`${origin}/mcp`});}
const refresh=token=>({grant_type:'refresh_token',refresh_token:token,client_id:client.id,resource:`${origin}/mcp`});

test('the dependency-free grant epoch equals federationEpoch',async()=>{
 for(const account of [{id:'a',assignmentId:'b',recoveryHash:'h'},{id:'a',assignmentId:'b',recoveryHash:null},{id:'a',recoveryHash:'h',federationGeneration:3},{id:'a',assignmentId:'b',recoveryHash:'h',federationGeneration:0}])assert.equal(await authorityGrantEpoch(account),await federationEpoch(account));
});

for(const [name,reset]of [['a new recovery credential (recovery start, reissue)',a=>({...a,recoveryHash:'hash-2'})],['a federationGeneration bump (reissue cancellation, suspension)',a=>({...a,federationGeneration:1})]])
test(`an MCP grant ends with ${name}: verify, execute and refresh refuse`,async t=>{
 const f=await fixture(t),a=await authorize(f);
 assert.equal((await f.mcp.verify(a.access_token)).owner,f.owner);
 await f.patch(reset);
 await assert.rejects(f.mcp.verify(a.access_token),{code:'invalid_token'});
 await assert.rejects(f.mcp.execute(a.access_token,'collections_list',{}),{code:'invalid_token'});
 await assert.rejects(f.mcp.exchange(refresh(a.refresh_token)),{code:'invalid_grant'});
 // A fresh authorization under the new epoch works.
 const b=await authorize(f);assert.equal((await f.mcp.verify(b.access_token)).owner,f.owner);
});

test('a grant without a recorded epoch (minted before this binding) fails closed once an authority port exists',async()=>{
 const service=new McpAuthorization({metadata:{transaction:async fn=>fn({})},config:{APP_ORIGIN:'https://3sln.example',MCP_CLIENTS:'[]'}});
 assert.equal(await service.currentAuthority({owner:'o'}),true,'no port: unchanged behaviour');
 service.authority=async()=>'epoch-1';
 assert.equal(await service.currentAuthority({owner:'o'}),false);
 assert.equal(await service.currentAuthority({owner:'o',authorityEpoch:'epoch-0'}),false);
 assert.equal(await service.currentAuthority({owner:'o',authorityEpoch:'epoch-1'}),true);
 service.authority=async()=>{throw new Error('unavailable');};
 assert.equal(await service.currentAuthority({owner:'o',authorityEpoch:'epoch-1'}),false,'an unreadable identity fails closed');
});

test("severing with reason 'recovery' ends the MCP app connection and revokes every key delegation",async t=>{
 const f=await fixture(t),a=await authorize(f);
 const revoked=[];let severedFirst=null;const original=f.account.revokeDelegationsFor;f.account.revokeDelegationsFor=async function(owner,input){revoked.push(input);if(input?.clientId===undefined&&severedFirst===null)severedFirst=await f.mcp.verify(a.access_token).then(()=>false,()=>true);return original.call(this,owner,input);};
 await f.account.connectionsSeverAccount(f.owner,{reason:'recovery'});
 assert.ok(revoked.some(input=>input?.reason==='system'&&input.clientId===undefined),'every delegation (no clientId) is revoked');
 // Re-verification 2026-10-23: connections are severed first, then the remaining delegations.
 assert.equal(severedFirst,true,'the connection was already severed when the account-wide delegation revocation ran');
 await assert.rejects(f.mcp.verify(a.access_token),error=>['invalid_token','forbidden','not_found'].includes(error.code),'the severed connection no longer authorizes MCP');
});
