import HostedWorker,{HostedAccountData} from '../worker.mjs';
import {FixtureHostedInstallation} from './hosted-worker.fixture.mjs';
// Installation/governance and client registration are trusted test fixtures;
// users, email/session proofs and app tokens come from maintained HTTP paths.
export class FixtureHostedStorageInstallation extends FixtureHostedInstallation{
 async configureStorageClientFixture(){const context=await(await this.getApplication()).provider.auth.$context;await context.adapter.create({model:'oauthClient',data:{clientId:'https://storage-app.example/client.json',clientName:'Storage fixture',redirectUris:['https://storage-app.example/callback'],grantTypes:['authorization_code','refresh_token'],responseTypes:['code'],tokenEndpointAuthMethod:'none',scopes:['openid','offline_access','logs:read','logs:append','logs:trim','blobs:read','blobs:write'],disabled:false,createdAt:new Date()}});return true;}
 async storageShapeFixture(subject){const issuer=JSON.parse(this.environment.WAYPO_CONFIG).issuer,routes=await this.ctx.storage.list({prefix:'storage-routing/v1/',limit:16}),route=[...routes.values()].find(row=>row.userId===subject),rows=await this.ctx.storage.list({prefix:'services/',limit:16});return {routeId:route?.routeId??null,controlCatalogRows:[...rows.keys()].filter(key=>/^services\/[a-f0-9]{64}(?:$|\/patch\/)/.test(key)||['services/checkpoints/v1','services/gc/v1'].includes(key)).length,controlWorkRows:[...rows.keys()].filter(key=>key.startsWith('services/work-budget/')).length};}
}
export class FixtureHostedAccountData extends HostedAccountData{
 async inspectComposedFixture(){return {mode:this.config.policy.mode,storageBytes:this.config.policy.freeServices.storageBytes,retentionExecute:this.config.policy.retention.execute,keys:[...(await this.ctx.storage.list({limit:128})).keys()],tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name)};}
}
export default HostedWorker;
