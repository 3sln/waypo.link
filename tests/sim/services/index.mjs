// Extra simulation services beside the two providers and the Notes/Photos samples. Each module owns its hosts and
// exports one descriptor (test-only; nothing here is imported by production code):
//   {name, hosts:[host...], appOrigins?:[origin...]   origins whose client metadata providers may fetch,
//    schemas?:{id:document}                             operator-preloaded fragment documents (FEDERATION_SCHEMAS),
//    providerConfig?(provider)->object                  extra provider config (recorded in the manifest by key),
//    start(network,{providers,log})->{origin?,close?(),describe?()}}
import board from './board.mjs';
import meet from './meet.mjs';
import parlay from './parlay.mjs';
import second from './second.mjs';
export const SERVICES=Object.freeze([second,board,meet,parlay]);
