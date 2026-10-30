// Photos' client-id metadata document: a public browser client (no keys, no integration manifest).
export const LIBRARY_FRAGMENT='https://photos.example/fragments/library/v1';
export const STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1';
/** Asked for only when the person first adds a photo (incremental authorization). Providers preload it. */
export const libraryFragment={id:LIBRARY_FRAGMENT,title:'Photo library',description:'Where Photos keeps the photos you add.',publisher:'https://photos.example',
 fields:{library:{title:'Photo storage',type:'resource',contracts:[STORAGE_CONTRACT],cardinality:{min:1,max:1}}}};
export function clientMetadata(origin){
 const at=path=>new URL(path,origin).href;
 return {client_id:at('/bindle/client.json'),client_name:'Photos',client_uri:at('/'),logo_uri:at('/apps/samples/photos/web/icon.svg'),redirect_uris:[at('/bindle/callback')],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
}
