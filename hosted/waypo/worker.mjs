export {HostedEmailBudget} from './email-budget-object.mjs';
import {documentationResponse} from './documentation.mjs';
// Isolated composition: public Waypo ports only; no historical hosted app graph.
import WaypoWorker,{WaypoInstallation,WaypoAccountData} from '@3sln/waypo/worker';
import {hostedWorkerEnvironment,createWaypoLinkExtensionFactory,createHostedSignupGuard} from './composition.mjs';
export class HostedInstallation extends WaypoInstallation{
 constructor(ctx,env,{siteverifyTransport}={}){const composed=hostedWorkerEnvironment(env);super(ctx,composed.env,{siteverifyTransport,regionEligibility:createHostedSignupGuard(composed.settings),createProviderExtension:createWaypoLinkExtensionFactory(composed.settings)});}
}
// Data actors receive the same composed policy/entitlements as the control actor.
// Exporting this class does not enable its binding or automatic retention.
export class HostedAccountData extends WaypoAccountData{
 constructor(ctx,env){super(ctx,hostedWorkerEnvironment(env).env);}
}
// Only the configured public issuer origin may serve marketing/documentation.
// This intentionally does not instantiate the provider or touch native storage.
export function publicDocumentationOrigin(env){try{const value=JSON.parse(env?.WAYPO_CONFIG),issuer=new URL(value.issuer);if(!['https:','http:'].includes(issuer.protocol)||issuer.username||issuer.password||issuer.search||issuer.hash)throw Error('Invalid issuer');return issuer.origin;}catch{return 'https://waypo.link';}}
export default {async fetch(request,env){const documentation=documentationResponse(request,{publicOrigin:publicDocumentationOrigin(env)});if(documentation)return documentation;if(!env?.WAYPO_CONFIG)return new Response('Provider unavailable',{status:503,headers:{'X-Robots-Tag':'noindex','Cache-Control':'no-store'}});const composed=hostedWorkerEnvironment(env),response=await WaypoWorker.fetch(request,composed.env),headers=new Headers(response.headers);headers.set('X-Robots-Tag','noindex');return new Response(response.body,{status:response.status,statusText:response.statusText,headers,...response.webSocket?{webSocket:response.webSocket}:{}});}};
