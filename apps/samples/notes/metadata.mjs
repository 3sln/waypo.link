// Notes' OAuth client-id metadata document (client-id-metadata.v1), served at https://<notes host>/bindle/client.json.
// A public browser client (no secret, no keys): DPoP-bound refresh tokens, and a minimal `bindle_integration` that
// carries only the clean-removal declaration (app-removal §3, amendment AR-1).
export const SYNC_FRAGMENT='https://notes.example/fragments/sync/v1';
export const STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1';
export const MESSAGES_FRAGMENT='https://3sln.me/artefacts/preferences/app-messages/v1';
export const MESSAGES_CONTRACT='https://3sln.me/artefacts/contracts/app-messages/v1';

/** The fragment Notes asks for at sign-in. Providers preload it (an operator-reviewed schema). */
export const syncFragment={id:SYNC_FRAGMENT,title:'Notes sync',description:'Where Notes keeps a synced copy of your notes, and how it lists them.',publisher:'https://notes.example',
 fields:{store:{title:'Notes storage',type:'resource',contracts:[STORAGE_CONTRACT],cardinality:{min:1,max:1}},sort:{title:'Sort notes by',type:'enum',values:['updated','title']}}};

export function clientMetadata(origin){
 const at=path=>new URL(path,origin).href;
 return {client_id:at('/bindle/client.json'),client_name:'Notes',client_uri:at('/'),logo_uri:at('/apps/samples/notes/web/icon.svg'),
  redirect_uris:[at('/bindle/callback')],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],
  bindle_integration:{v:1,removal:{uri:at('/bindle/remove'),cleanup_seconds:900}}};
}
