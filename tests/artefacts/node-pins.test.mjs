import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../../apps/node/server.mjs';
import {versionRecord,versionDigest} from '../../packages/core/artefacts.mjs';
const ID='https://node-pins.example/preferences',owners=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
test('Node adapter shares durable version pins across owner shards and process restart',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'art4-node-')),body={id:ID,title:'Preferences',description:'Owner choices.',publisher:'https://node-pins.example',fields:{enabled:{title:'Enabled',type:'boolean',cardinality:{min:0,max:1}}}},entry={version:1,prev:null,body},digest=await versionDigest(versionRecord({id:ID,kind:'fragment'},entry)),reference={artefact:ID,version:1,digest},config={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_ENABLED:'true',FEDERATION_SCHEMAS:{[ID]:body,[ID+'/envelope']:{bindle_artefact:1,id:ID,kind:'fragment',versions:[entry]}}};
 let server=await createNodeServer({directory,config});t.after(async()=>{await server.close();await rm(directory,{recursive:true,force:true});});
 const pin=await server.resources.federationShard(owners[0]).service.schema(reference);assert.equal(pin.version,1);assert.equal(pin.digest,digest);
 assert.deepEqual(await server.resources.federationShard(owners[1]).service.schema(reference),pin);
 await server.close();delete config.FEDERATION_SCHEMAS[ID+'/envelope'];config.FEDERATION_SCHEMAS[ID]={...body,title:'Unavailable origin copy'};
 server=await createNodeServer({directory,config});assert.deepEqual(await server.resources.federationShard(owners[1]).service.schema(reference),pin);
});
