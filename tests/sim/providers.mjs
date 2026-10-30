// Real 3sln.me providers on the Node adapter (apps/node/server.mjs createNodeServer), in process, behind the
// simulation network. Only the documented injection seams receive simulation values: DNS and the socket
// (DIRECTORY_*, PORTABILITY_*), and the egress factories built from them (CLIENT_METADATA_FETCH, APP_METADATA_FETCH,
// SIGNALING_EGRESS, INTEGRATION_EGRESS). Each factory is the production one; only its lookup/request pair is ours.
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createNodeServer} from '../../apps/node/server.mjs';
import {createNodeClientMetadataFetch} from '../../packages/federation/node-client-metadata-fetch.mjs';
import {createNodeMetadataFetch} from '../../packages/apps/node-metadata-fetch.mjs';
import {createNodeIntegrationEgress} from '../../packages/federation/node-integration-egress.mjs';
import {PROFILES,OPERATOR_SETTINGS} from './flags.mjs';

/** Names of the config members that are code (seams), recorded in the manifest by name only. */
export const SEAMS=['DIRECTORY_DNS_LOOKUP','DIRECTORY_HTTPS_REQUEST','PORTABILITY_DNS_LOOKUP','PORTABILITY_HTTPS_REQUEST','CLIENT_METADATA_FETCH','APP_METADATA_FETCH','SIGNALING_EGRESS','INTEGRATION_EGRESS'];

async function appMessageKeys(){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),kid='sim-'+crypto.randomUUID();
 return {APP_NOTIFICATION_SIGNING_JWK:JSON.stringify({...await crypto.subtle.exportKey('jwk',pair.privateKey),kid,alg:'ES256',use:'sig'}),APP_NOTIFICATION_PUBLIC_JWKS:JSON.stringify({keys:[{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256',use:'sig'}]})};
}

/**
 * Starts one provider. `name` is a label (alpha, beta), `host` its account host, `embedHost` its embed origin host.
 * `schemas` are operator-preloaded fragment documents (FEDERATION_SCHEMAS); `appOrigins` the sample origins whose
 * presentation metadata the provider may fetch. Returns {name, origin, embedOrigin, app, config, close}.
 */
export async function startProvider(network,{name,host,embedHost,brand,profile='sim',schemas={},appOrigins=[],foreignIssuers=[],extra={}}){
 const directory=await mkdtemp(join(tmpdir(),`3sln-sim-${name}-`));
 const origin=`https://${host}`,embedOrigin=`https://${embedHost}`;
 const seam={lookup:network.lookup,request:network.request};
 const flags=PROFILES[profile];if(!flags)throw new Error(`Unknown flag profile ${profile}.`);
 const recorded={APP_ORIGIN:origin,EMBED_ORIGIN:embedOrigin,BRAND_NAME:brand,...flags,...OPERATOR_SETTINGS,
  SIGNALING_FOREIGN_ISSUERS:JSON.stringify(foreignIssuers),ORG_FOREIGN_ISSUERS:JSON.stringify(foreignIssuers),
  FEDERATION_SCHEMAS_KEYS:Object.keys(schemas),...extra};
 const config={...recorded,FEDERATION_SCHEMAS:JSON.stringify(schemas),
  KEY_ENCRYPTION_KEY:randomBytes(32).toString('base64'),SESSION_COOKIE_KEY:randomBytes(32).toString('base64url'),...await appMessageKeys(),
  DIRECTORY_DNS_LOOKUP:seam.lookup,DIRECTORY_HTTPS_REQUEST:seam.request,PORTABILITY_DNS_LOOKUP:seam.lookup,PORTABILITY_HTTPS_REQUEST:seam.request,
  CLIENT_METADATA_FETCH:createNodeClientMetadataFetch(seam),
  ...appOrigins.length?{APP_METADATA_FETCH:createNodeMetadataFetch({allowedOrigins:appOrigins,...seam})}:{},
  SIGNALING_EGRESS:createNodeIntegrationEgress({issuer:origin,reserved:[embedHost],...seam}),
  INTEGRATION_EGRESS:createNodeIntegrationEgress({issuer:origin,reserved:[embedHost],...seam})};
 delete config.FEDERATION_SCHEMAS_KEYS;
 const logs=[];
 const app=await createNodeServer({directory,config});
 const handler=app.server.listeners('request')[0];
 const errors=[];
 // G3: any 5xx a provider answers is recorded with its path (never its body, which may carry identifiers).
 await network.serve([host,embedHost],(req,res)=>{
  const started=Date.now(),path=String(req.url).split('?')[0];
  res.once('finish',()=>{logs.push({provider:name,host:req.headers.host,method:req.method,path,status:res.statusCode,ms:Date.now()-started});if(logs.length>50000)logs.shift();if(res.statusCode>=500)errors.push({provider:name,method:req.method,path,status:res.statusCode});});
  // The trusted client-IP header comes only from the simulation's own listener (any client copy is replaced).
  delete req.headers['x-sim-client-ip'];const address=network.clientAddress(req.socket);if(address)req.headers['x-sim-client-ip']=address;
  handler(req,res);
 });
 return {name,host,embedHost,origin,embedOrigin,brand,app,config:recorded,logs,errors,directory,
  async close(){await app.close();await rm(directory,{recursive:true,force:true});}};
}

/** Fragment documents the operator preloads (spike §2.6: preloading sample artefacts is allowed and recorded). */
export async function operatorSchemas(extra={}){
 return {'https://3sln.me/artefacts/preferences/app-messages/v1':JSON.parse(await readFile(new URL('../../docs/artefacts/app-message-preferences-v1.json',import.meta.url),'utf8')),...extra};
}
