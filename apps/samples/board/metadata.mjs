// Board's OAuth client-id metadata document and the fragments it asks for (sample-only). A public browser client:
// DPoP-bound tokens, no secret, no keys. Providers preload the fragments as operator-reviewed schemas.
export const BOARD_FRAGMENT='https://board.example/fragments/boards/v1';
export const BUS_FRAGMENT='https://board.example/buses/board-changes/v1';
export const STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1';
export const EVENT_BUS_CONTRACT='https://spec.bindle.example/contracts/event-bus/v1';

/** Where Board keeps the board documents. */
export const boardFragment={id:BOARD_FRAGMENT,title:'Boards',description:'Where Board keeps your boards and cards.',publisher:'https://board.example',
 fields:{store:{title:'Board storage',type:'resource',contracts:[STORAGE_CONTRACT],cardinality:{min:1,max:1}}}};

/** A bus manifest (events §2): one record each time a card is added, moved or assigned. */
export const busManifest={id:BUS_FRAGMENT,title:'Board changes',description:'A record each time a card is added, moved or assigned on a board.',publisher:'https://board.example',
 fields:{bus:{title:'Board changes feed',type:'resource',cardinality:{min:0,max:1},contracts:[EVENT_BUS_CONTRACT]}},
 slot:{v:1,crit:['bus'],field:'bus',selection:'exclusive',consumers:['application'],bus:{v:1,types:['added','moved','assigned'],
  payload:{type:'object',additionalProperties:false,required:['card'],properties:{card:{type:'string',maxLength:64},column:{type:'string',maxLength:64},title:{type:'string',maxLength:120},rev:{type:'integer',minimum:0}}},
  max_record_bytes:1024,retention:{min_seconds:3600,max_seconds:604800},publishers:['application'],readers:['application'],history:'owner-choice',categories:['personal-data'],
  effects:{read:{en:'See board changes as they happen.'},write:{en:'Add board changes that your open boards see.'}}}}};

export function clientMetadata(origin){
 const at=path=>new URL(path,origin).href;
 return {client_id:at('/bindle/client.json'),client_name:'Board',client_uri:at('/'),logo_uri:at('/apps/samples/board/web/icon.svg'),
  redirect_uris:[at('/bindle/callback')],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
}
