export {HostedEmailBudget} from './email-budget-object.mjs';
import {documentationResponse} from './documentation.mjs';
// Isolated composition: public Waypo ports only; no historical hosted app graph.
import WaypoWorker,{WaypoInstallation} from '@3sln/waypo/worker';
import {hostedWorkerEnvironment,createWaypoLinkExtensionFactory,createHostedSignupGuard} from './composition.mjs';
export class HostedInstallation extends WaypoInstallation{
 constructor(ctx,env,{siteverifyTransport}={}){const composed=hostedWorkerEnvironment(env);super(ctx,composed.env,{siteverifyTransport,regionEligibility:createHostedSignupGuard(composed.settings),createProviderExtension:createWaypoLinkExtensionFactory(composed.settings)});}
}
export default {async fetch(request,env){const documentation=documentationResponse(request);if(documentation)return documentation;const composed=hostedWorkerEnvironment(env),response=await WaypoWorker.fetch(request,composed.env),headers=new Headers(response.headers);headers.set('X-Robots-Tag','noindex');return new Response(response.body,{status:response.status,statusText:response.statusText,headers,...response.webSocket?{webSocket:response.webSocket}:{}});}};
