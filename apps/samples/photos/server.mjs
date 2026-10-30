// Photos sample server: static files, client metadata and the single-page routes. Photos keeps no server-side data.
import {createAppServer} from '../kit/server.mjs';
import {clientMetadata} from './metadata.mjs';
export function createPhotosServer({origin='https://photos.example',log}={}){
 return createAppServer({origin,web:'apps/samples/photos/web',metadata:clientMetadata,pages:['/','/library','/bindle/callback'],log});
}
