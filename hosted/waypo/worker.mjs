// Isolated composition: public Waypo ports only; no historical hosted app graph.
import WaypoWorker,{WaypoInstallation} from '@3sln/waypo/worker';
import {hostedWorkerEnvironment,createHostedExtensionFactory} from './composition.mjs';
export class HostedInstallation extends WaypoInstallation{
 constructor(ctx,env){const composed=hostedWorkerEnvironment(env);super(ctx,composed.env,{createProviderExtension:createHostedExtensionFactory(composed.settings)});}
}
export default {fetch(request,env){const composed=hostedWorkerEnvironment(env);return WaypoWorker.fetch(request,composed.env);}};
