import integration from '../integration.json' with {type:'json'};
import {APP_BRAND} from './brand.mjs';
import {fault} from '../../../packages/messaging-engine/faults.mjs';
import {importVerifyKey} from '../../../packages/messaging-protocol/index.mjs';
// The file is an integration manifest, carried inside client metadata, never an alternative discovery endpoint.
// Reserved identifiers remain publication placeholders. A configured instance rewrites endpoint URLs only;
// fragment, slot, contract and event identifiers retain their immutable document identities.
export function clientMetadata(clientId='https://messages.example/bindle/client.json',{removal=false,intents=false}={}){
 const client=new URL(clientId);if(client.protocol!=='https:'||client.username||client.password||client.search||client.hash||client.pathname!=='/bindle/client.json')fault('recipient_unavailable','Client metadata unavailable.',503);
 const bindle=structuredClone(integration),endpoint=path=>new URL('/bindle/'+path,client.origin).href;
 if(intents)bindle.intents=[['send-message','sha256-lWZkE2SQRlCcsCRMZ2ven529CrbjGNAsgxHWSyIF4MU'],['add-contact','sha256-Nu6S97f-t26Tk_KCTwaHtaWgxUGSOJ3JUIn4gdBeaZs'],['open-conversation','sha256-BVp7Z5PiP2NNpO9cb-mxI_8uyZWO1PKJ5PsKgPZNU70']].map(([name,digest])=>({kind:`https://spec.bindle.example/intents/${name}/v1`,version:1,digest,route:endpoint('intent')}));
 if(removal)bindle.removal={uri:endpoint('remove'),cleanup_seconds:900};
 bindle.management_url=endpoint('manage');bindle.events_endpoint=endpoint('events');bindle.resources.rpc_endpoint=endpoint('rpc');bindle.resources.discovery_endpoint=endpoint('resources');
 return {client_id:clientId,client_name:APP_BRAND,redirect_uris:[endpoint('callback')],initiate_login_uri:endpoint('start'),token_endpoint_auth_method:'private_key_jwt',jwks_uri:endpoint('jwks.json'),bindle_integration:bindle};
}
export function metadataPort({clientId,services,APP_CLEAN_REMOVAL_ENABLED=false,INTENT_LINKS_ENABLED=false}={}){return async path=>{
 if(path==='/bindle/client.json')return clientMetadata(clientId,{intents:[true,'true'].includes(INTENT_LINKS_ENABLED),removal:[true,'true'].includes(APP_CLEAN_REMOVAL_ENABLED)&&typeof services?.verifyRemoval==='function'});
 if(typeof services?.publicJwks!=='function')fault('recipient_unavailable','Client key set unavailable.',503);
 const value=await services.publicJwks(),keys=[],seen=new Set();if(!value||!Array.isArray(value.keys)||!value.keys.length||value.keys.length>16)fault('recipient_unavailable','Client key set unavailable.',503);
 for(const k of value.keys){if(!k||typeof k.kid!=='string'||!k.kid||k.kid.length>128||seen.has(k.kid)||['d','k','p','q','dp','dq','qi'].some(name=>Object.hasOwn(k,name))||k.alg!==undefined&&k.alg!=='ES256'||k.use!==undefined&&k.use!=='sig')fault('recipient_unavailable','Client key set unavailable.',503);const publicKey={kty:k.kty,crv:k.crv,x:k.x,y:k.y};if(!await importVerifyKey(publicKey))fault('recipient_unavailable','Client key set unavailable.',503);keys.push({...publicKey,kid:k.kid,alg:'ES256',use:'sig'});seen.add(k.kid);}return {keys};
};}
