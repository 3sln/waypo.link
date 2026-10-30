// Found by the multi-provider simulation (tests/sim): a public client whose metadata carries only the clean-removal
// manifest (app-removal AR-1) could not be approved, because the connection pin asked the client directory for a key
// set and `resolveKeys` refuses public clients. The pin needs keys only for private_key_jwt clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {validateClientMetadata} from '../packages/federation/client-metadata.mjs';

test('the Node adapter pins a public client with a removal-only manifest without resolving keys',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'snapshot-public-'));
 const app=await createNodeServer({directory,config:{APP_ORIGIN:'https://provider.example',FEDERATION_ENABLED:'true',CLIENT_METADATA_ENABLED:'true',INTEGRATIONS_ENABLED:'true',BROKERING_ENABLED:'true'}});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const id='https://notes.example/bindle/client.json';
 const client=validateClientMetadata({client_id:id,redirect_uris:['https://notes.example/bindle/callback'],token_endpoint_auth_method:'none',bindle_integration:{v:1,removal:{uri:'https://notes.example/bindle/remove',cleanup_seconds:900}}},id,{integrations:true});
 assert.equal(client.integration.status,'valid');
 const snapshot=await app.resources.integrationConfig.INTEGRATION_CLIENT_SNAPSHOT(client);
 assert.equal(snapshot.authMethod,'none');assert.equal(snapshot.thumbprints,undefined);
 assert.equal(snapshot.manifest.removal.uri,'https://notes.example/bindle/remove');
});
