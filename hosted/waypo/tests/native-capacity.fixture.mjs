import {tokenWorkProfile} from './work-policy.fixture.mjs';
// Engineering test values only; never an economic or deployment recommendation.
export function nativeCapacityProfile(){return {
 tokenWork:tokenWorkProfile(),
 nativeCredentials:{revision:'fixture-v1',installationAccessRows:65536,installationRefreshRows:65536,installationFamilies:65536,accountAccessRows:64,accountRefreshRows:64,clientAccessRows:64,clientRefreshRows:64,accountFamilies:32,clientFamilies:32,retryMs:60000},
 nativeRetainedLimits:{sessionInstallation:65536,sessionOwner:64,keyInstallation:65536,keyOwner:32},
 nativeStorageCapacity:{maxBytes:100000000,headroomBytes:8000000,retryMs:1000},
 sessionSecurity:{enabled:true,revision:'fixture-v1',maxOwners:128,reviewBytes:16384,proofBytes:2048,humanBytes:2048,mailPolicy:{owner:{maxSends:6,windowMs:600000,cooldownMs:60000},review:{maxSends:3,minResendMs:60000,maxCodeAttempts:8}}}
};}
// Local fixture initialization includes the authority seed required by secured
// startup. It does not represent a completed production bootstrap ceremony.
export async function seedInitializedFixture(tx,issuer){
 const marker=await tx.get('bootstrap/installation'),at=Date.now();
 await tx.put('bootstrap/installation',{...marker,status:'initialized'});
 await tx.put('admin/initial-authority',{version:1,role:'policy-authority',principal:{issuer,subject:'fixture-bootstrap-authority'},createdAt:at,assertionAt:at});
}
export async function createFixtureAuthority(app){
 const context=await app.provider.auth.$context,email='bootstrap-authority@fixture.example';
 await app.provider.withAccountCreationCredit({pool:'public',binding:{field:'email',value:email}},()=>context.adapter.create({model:'user',data:{id:'fixture-bootstrap-authority',name:'Fixture bootstrap authority',email,emailVerified:true,createdAt:new Date(),updatedAt:new Date()},forceAllowId:true}));
}
