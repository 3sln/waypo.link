// Board sample server: static files, client metadata and the single-page routes. Board keeps no server-side data:
// boards live in the person's (or, once organizations connect apps, the organization's) storage.
import {createAppServer} from '../kit/server.mjs';
import {clientMetadata} from './metadata.mjs';
export function createBoardServer({origin='https://board.example',log}={}){
 return createAppServer({origin,web:'apps/samples/board/web',metadata:clientMetadata,pages:['/','/bindle/callback'],log});
}
