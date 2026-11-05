import {readHostedAsset} from './branding.mjs';
// Core supplies capacity, cleanup/export guidance and signaling permission.
// No commercial presentation means no purchase/funding UI, customer, ledger,
// checkout, webhook, vendor credential or vendor transport in this mode.
export function createFreeHostedExtensionFactory(){return async()=>({
 readAsset:readHostedAsset,
 userLinks:[],
 async handle(request){const path=new URL(request.url).pathname;if(path==='/account/billing'||path.startsWith('/account/billing.')||path.startsWith('/api/hosted/billing/')||path==='/api/hosted/polar/webhook')return Response.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}});return null;},
});}
