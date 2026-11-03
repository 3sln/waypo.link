// Native local test harness only; never selected by the hosted deployment config.
import HostedWorker,{HostedInstallation} from '../worker.mjs';
let polarTransport;const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin==='https://sandbox-api.polar.sh'){if(!polarTransport)throw Error('Fixture transport unavailable');return polarTransport.fetch(new Request(input,init));}return originalFetch(input,init);};
export class FixtureHostedInstallation extends HostedInstallation{
 constructor(ctx,env){super(ctx,env);polarTransport=env.POLAR_FIXTURE;}
 async fetch(request){if(new URL(request.url).pathname==='/__fixture/seed'){if(this.environment.HOSTED_TEST_ONLY!=='true'||request.headers.get('x-fixture-secret')!==this.environment.FIXTURE_SECRET)return new Response(null,{status:403});await this.provisionFromOperator();await this.database.store.transaction(async tx=>{const marker=await tx.get('bootstrap/installation');await tx.put('bootstrap/installation',{...marker,status:'initialized'});});const app=await this.getApplication(),context=await app.provider.auth.$context,user=await context.adapter.create({model:'user',data:{id:'native-worker-owner',name:'Native Worker billing owner',email:'worker-owner@mail.example',emailVerified:true,createdAt:new Date(),updatedAt:new Date()},forceAllowId:true});await app.policyBridge.ensureAccount(user);return Response.json({seeded:true});}return super.fetch(request);}
}
export default HostedWorker;
