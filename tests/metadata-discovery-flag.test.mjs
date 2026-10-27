// Wargame 3 (2026-10-23) F7: APP_METADATA_DISCOVERY_ENABLED (default off) gates app-metadata egress. The MCP consent
// inspection checks it per client before handing any injected APP_METADATA_FETCH port to the collector; the Node host
// wires its DNS-pinned fetch port and the shards evaluate the flag per request through the flags runtime; the Worker wires no metadata egress port at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeResources} from '../apps/node/resources.mjs';
import {McpAuthorization} from '../packages/mcp/service.mjs';
import {MemoryMessagingStore,digest} from '../packages/core/records.mjs';

const origin='https://app.example',client={id:'app.example',name:'Registered app',redirectUris:[origin+'/callback'],origins:[origin],metadataSources:{webAppManifest:origin+'/manifest'}};
async function inspect(extra){
 const store=new MemoryMessagingStore();let calls=0;
 const service=new McpAuthorization({metadata:{transaction:fn=>store.transaction(fn)},config:{APP_ORIGIN:'https://identity.example',MCP_CLIENTS:JSON.stringify([client]),...extra,APP_METADATA_FETCH:async()=>{calls++;return new Response('{"name":"Fetched"}',{headers:{'Content-Type':'application/json'}});}}});
 const {requestId}=await service.begin({client_id:client.id,redirect_uri:client.redirectUris[0],response_type:'code',code_challenge:await digest(crypto,'A'.repeat(43)),code_challenge_method:'S256',state:'s'.repeat(16),scope:'mcp:items_list',resource:'https://identity.example/mcp'});
 const view=await service.inspect('owner',requestId);return {calls,view};
}

test('MCP consent inspection performs no metadata egress while APP_METADATA_DISCOVERY_ENABLED is off',async()=>{
 for(const extra of [{},{APP_METADATA_DISCOVERY_ENABLED:'false'}]){const {calls,view}=await inspect(extra);assert.equal(calls,0,`discovery egress with ${JSON.stringify(extra)}`);assert.equal(view.client.registeredName,'Registered app');}
 assert.equal((await inspect({APP_METADATA_DISCOVERY_ENABLED:'true'})).calls,1,'the enabled flag still permits the injected port');
});

test('Node evaluates the discovery flag per request, not once at boot',async()=>{
 const src=await readFile(new URL('../apps/node/server.mjs',import.meta.url),'utf8');
 const line=src.split('\n').find(l=>l.includes('settings.APP_METADATA_FETCH=createNodeMetadataFetch'));
 assert.ok(line,'the Node metadata fetch wiring moved');
 // A boot-time gate would ignore later console records; the per-request gate is McpAuthorization.discovery.
 assert.doesNotMatch(line,/APP_METADATA_DISCOVERY_ENABLED/,'the wiring line must not freeze the flag at boot');
});

// Review follow-up 7 (2026-10-23): a console flag record (not only env) turns discovery on for Node MCP shards. The
// shards already read flags through config.FLAGS_RUNTIME (set by nodeResources); this pins that behaviour.
test('Node MCP shards honour a console flag record for APP_METADATA_DISCOVERY_ENABLED',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'metadata-flag-'));let calls=0;
 const local={id:'app.example',name:'Registered app',redirectUris:[origin+'/callback'],origins:[origin],metadataSources:{webAppManifest:origin+'/manifest'}};
 const resources=await nodeResources({directory,config:{APP_ORIGIN:'https://identity.example',MCP_ENABLED:'true',MCP_CLIENTS:JSON.stringify([local]),KEY_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),APP_METADATA_FETCH:async()=>{calls++;return new Response('{"name":"Fetched"}',{headers:{'Content-Type':'application/json'}});}}});
 t.after(async()=>{resources.close();await rm(directory,{recursive:true,force:true});});
 const owner=crypto.randomUUID();await resources.repository.create({id:owner,handle:'flag_fixture',status:'active',termsVersion:'2026-10-11',revision:1});
 const consent=async()=>{const {requestId}=await resources.mcp.begin({client_id:local.id,redirect_uri:local.redirectUris[0],response_type:'code',code_challenge:await digest(crypto,'A'.repeat(43)),code_challenge_method:'S256',state:'s'.repeat(16),scope:'mcp:items_list',resource:'https://identity.example/mcp'});return resources.mcp.inspect(owner,requestId);};
 await consent();assert.equal(calls,0,'discovery ran with the flag off');
 await resources.flagsRuntime.publish({v:1,version:1,issuedAt:0,flags:{APP_METADATA_DISCOVERY_ENABLED:{rev:1,on:true,onValue:true,fallthrough:true,salt:'metadata-salt'}}});
 await consent();assert.equal(calls,1,'a console record enabling discovery was ignored by the MCP shard');
});

test('the Worker wires no app-metadata egress port',async()=>{
 const dir=new URL('../apps/worker/',import.meta.url);
 for(const name of (await readdir(dir)).filter(n=>n.endsWith('.mjs'))){const src=await readFile(new URL(name,dir),'utf8');assert.equal(/APP_METADATA_FETCH\s*[:=]/.test(src),false,`${name} injects APP_METADATA_FETCH`);}
});
