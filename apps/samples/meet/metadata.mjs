// Meet's client-id metadata document and its sample session kind (sample-only). Meet is a public browser client: no
// keys, DPoP-bound tokens. The call kind is a sample intent artefact published by meet.example (simulation spike §8 Q6:
// samples define their own kinds); providers hold it as an operator-registered artefact, because a session kind must be
// held by both providers before a call between them can be admitted (signaling §9.2).
import {CALL_KIND} from './web/constants.mjs';
export {SIGNALING_FRAGMENT,SIGNALING_CONTRACT,SIGNALING_METHODS,CALL_KIND} from './web/constants.mjs';

/** The session-kind body (intents §4.1 with the `session` member, signaling §20.1.1). */
export const callKind=Object.freeze({id:CALL_KIND,title:{en:'Video call',es:'Videollamada'},summary:{en:'A video call with someone you invite to a meeting.',es:'Una videollamada con alguien a quien invitas a una reunión.'},
 publisher:'https://meet.example',effect:'join',capability:false,max_bytes:64,data:{type:'object',properties:{},required:[]},disclosure:{categories:['personal-data'],fields:{}},
 session:{v:1,parties:'other',profiles:{webrtc:{}},bases:['offer']}});
/** The artefact envelope (artefacts §2) the operator registers under the line and line + '/envelope'. */
export const callKindEnvelope=Object.freeze({bindle_artefact:1,id:CALL_KIND,kind:'intent',versions:[{version:1,prev:null,body:callKind}]});

export function clientMetadata(origin){
 const at=path=>new URL(path,origin).href;
 return {client_id:at('/bindle/client.json'),client_name:'Meet',client_uri:at('/'),logo_uri:at('/apps/samples/meet/web/icon.svg'),
  redirect_uris:[at('/bindle/callback')],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
}
