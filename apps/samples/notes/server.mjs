// Notes sample server: static files, client metadata and the single-page routes. Notes keeps no server-side data.
import {createAppServer} from '../kit/server.mjs';
import {clientMetadata} from './metadata.mjs';
export function createNotesServer({origin='https://notes.example',log}={}){
 return createAppServer({origin,web:'apps/samples/notes/web',metadata:clientMetadata,pages:['/','/bindle/callback','/bindle/remove','/settings'],log});
}
